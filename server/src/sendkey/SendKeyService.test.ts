import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getTestPrisma, resetDb } from "../../test/db.js";
import { Router } from "../router/Router.js";
import { FriendshipCache } from "../friendship/FriendshipCache.js";
import { BotManager, type ClientFactory } from "../bot/BotManager.js";
import type { OneBotClient } from "../onebot/OneBotClient.js";
import { SendKeyError, SendKeyService } from "./SendKeyService.js";

class StubClient {
  url: string;
  accessToken: string | null;
  constructor(opts: { url: string; accessToken: string | null }) {
    this.url = opts.url;
    this.accessToken = opts.accessToken;
  }
  connect(): void {}
  disconnect(): void {}
  request(): Promise<unknown> {
    throw new Error("not used");
  }
  on(): void {}
}

const stubFactory: ClientFactory = (opts) =>
  new StubClient(opts) as unknown as OneBotClient;

/**
 * Helper: build a BotManager that lies about alive bots without a real WS.
 * For SendKeyService tests we only care that listAliveBotIds returns what
 * we say it does. We override listStatus indirectly by stubbing the method.
 */
function makeAliveManager(prisma: ReturnType<typeof getTestPrisma>, aliveBotIds: number[]): BotManager {
  const m = new BotManager({ prisma, clientFactory: stubFactory });
  // BotManager's listStatus is the Router's source for alive bots; but
  // SendKeyService receives a BotManager and asks for status. We simulate
  // by stubbing the method.
  (m as unknown as {
    listStatus: () => Array<{ botId: number; alive: boolean }>;
  }).listStatus = () =>
    aliveBotIds.map((id) => ({ botId: id, alive: true }));
  return m;
}

describe("SendKeyService.create", () => {
  const prisma = getTestPrisma();
  let userId: number;

  beforeEach(async () => {
    await resetDb(prisma);
    const user = await prisma.user.create({
      data: { username: "alice", passwordHash: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a SendKey on the fast path and returns the plaintext exactly once", async () => {
    const bot = await prisma.bot.create({
      data: { name: "primary", qq: BigInt(10001), wsUrl: "ws://x" },
    });
    const friendshipCache = new FriendshipCache();
    friendshipCache.add(bot.id, 999);
    const service = new SendKeyService({
      prisma,
      botManager: makeAliveManager(prisma, [bot.id]),
      friendshipCache,
      router: new Router({ pickIndex: () => 0 }),
      bcryptCost: 4,
    });

    const result = await service.create({
      userId,
      name: "ci",
      targetQq: 999,
    });

    expect(result).toMatchObject({
      name: "ci",
      targetQq: 999,
      botId: bot.id,
      state: "active",
    });
    expect(result.plaintext).toMatch(/^sk_[A-Za-z0-9_-]{20,}$/);
    expect(result.prefix).toBe(result.plaintext.slice(0, 8));

    const stored = await prisma.sendKey.findUnique({ where: { id: result.id } });
    expect(stored).not.toBeNull();
    expect(stored!.prefix).toBe(result.prefix);
    expect(stored!.keyHash).toMatch(/^\$2[aby]\$/);
    expect(stored!.botId).toBe(bot.id);
    expect(stored!.state).toBe("active");
  });

  it("throws needs_handshake (409) when no alive bot is friends with the target", async () => {
    const friendshipCache = new FriendshipCache();
    const service = new SendKeyService({
      prisma,
      botManager: makeAliveManager(prisma, []),
      friendshipCache,
      router: new Router(),
      bcryptCost: 4,
    });

    await expect(
      service.create({ userId, name: "ci", targetQq: 999 }),
    ).rejects.toMatchObject({
      httpCode: 409,
      reason: "needs_handshake",
    });

    const rows = await prisma.sendKey.findMany();
    expect(rows).toHaveLength(0);
  });

  it("rejects creating a SendKey for a non-existent user with 401", async () => {
    const friendshipCache = new FriendshipCache();
    const service = new SendKeyService({
      prisma,
      botManager: makeAliveManager(prisma, []),
      friendshipCache,
      router: new Router(),
      bcryptCost: 4,
    });

    const result = service.create({
      userId: 999_999,
      name: "ci",
      targetQq: 999,
    });

    await expect(result).rejects.toBeInstanceOf(SendKeyError);
  });
});

describe("SendKeyService.listForUser", () => {
  const prisma = getTestPrisma();
  let aliceId: number;
  let bobId: number;
  let botId: number;
  let service: SendKeyService;

  beforeEach(async () => {
    await resetDb(prisma);
    aliceId = (
      await prisma.user.create({
        data: { username: "alice", passwordHash: "x" },
      })
    ).id;
    bobId = (
      await prisma.user.create({
        data: { username: "bob", passwordHash: "x" },
      })
    ).id;
    const bot = await prisma.bot.create({
      data: { name: "primary", qq: BigInt(10001), wsUrl: "ws://x" },
    });
    botId = bot.id;
    const friendshipCache = new FriendshipCache();
    friendshipCache.add(botId, 999);
    service = new SendKeyService({
      prisma,
      botManager: makeAliveManager(prisma, [botId]),
      friendshipCache,
      router: new Router({ pickIndex: () => 0 }),
      bcryptCost: 4,
    });
  });

  it("returns the caller's keys without plaintext or hash", async () => {
    await service.create({ userId: aliceId, name: "ci", targetQq: 999 });
    await service.create({ userId: aliceId, name: "ha", targetQq: 999 });
    await service.create({ userId: bobId, name: "bobs", targetQq: 999 });

    const list = await service.listForUser(aliceId);

    expect(list).toHaveLength(2);
    for (const item of list) {
      expect(item).not.toHaveProperty("plaintext");
      expect(item).not.toHaveProperty("keyHash");
      expect(item).toMatchObject({ targetQq: 999, state: "active" });
      expect(item.prefix).toMatch(/^sk_[A-Za-z0-9_-]{5}$/);
    }
    const names = list.map((k) => k.name).sort();
    expect(names).toEqual(["ci", "ha"]);
  });

  it("returns an empty list for a user with no keys", async () => {
    const list = await service.listForUser(aliceId);
    expect(list).toEqual([]);
  });
});

describe("SendKeyService.delete", () => {
  const prisma = getTestPrisma();
  let aliceId: number;
  let bobId: number;
  let botId: number;
  let service: SendKeyService;

  beforeEach(async () => {
    await resetDb(prisma);
    aliceId = (
      await prisma.user.create({
        data: { username: "alice", passwordHash: "x" },
      })
    ).id;
    bobId = (
      await prisma.user.create({
        data: { username: "bob", passwordHash: "x" },
      })
    ).id;
    const bot = await prisma.bot.create({
      data: { name: "primary", qq: BigInt(10001), wsUrl: "ws://x" },
    });
    botId = bot.id;
    const friendshipCache = new FriendshipCache();
    friendshipCache.add(botId, 999);
    service = new SendKeyService({
      prisma,
      botManager: makeAliveManager(prisma, [botId]),
      friendshipCache,
      router: new Router({ pickIndex: () => 0 }),
      bcryptCost: 4,
    });
  });

  it("deletes the caller's own key", async () => {
    const created = await service.create({
      userId: aliceId,
      name: "ci",
      targetQq: 999,
    });

    await service.delete(aliceId, created.id);

    const stored = await prisma.sendKey.findUnique({ where: { id: created.id } });
    expect(stored).toBeNull();
  });

  it("refuses to delete another user's key with 404", async () => {
    const bobsKey = await service.create({
      userId: bobId,
      name: "bobs",
      targetQq: 999,
    });

    await expect(service.delete(aliceId, bobsKey.id)).rejects.toMatchObject({
      httpCode: 404,
    });

    const stored = await prisma.sendKey.findUnique({
      where: { id: bobsKey.id },
    });
    expect(stored).not.toBeNull();
  });
});

describe("SendKeyService.authenticate", () => {
  const prisma = getTestPrisma();
  let aliceId: number;
  let botId: number;
  let service: SendKeyService;

  beforeEach(async () => {
    await resetDb(prisma);
    aliceId = (
      await prisma.user.create({
        data: { username: "alice", passwordHash: "x" },
      })
    ).id;
    const bot = await prisma.bot.create({
      data: { name: "primary", qq: BigInt(10001), wsUrl: "ws://x" },
    });
    botId = bot.id;
    const friendshipCache = new FriendshipCache();
    friendshipCache.add(botId, 999);
    service = new SendKeyService({
      prisma,
      botManager: makeAliveManager(prisma, [botId]),
      friendshipCache,
      router: new Router({ pickIndex: () => 0 }),
      bcryptCost: 4,
    });
  });

  it("returns the SendKey row for a valid plaintext", async () => {
    const created = await service.create({
      userId: aliceId,
      name: "ci",
      targetQq: 999,
    });

    const found = await service.authenticate(created.plaintext);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe("ci");
  });

  it("returns null for a wrong plaintext", async () => {
    await service.create({ userId: aliceId, name: "ci", targetQq: 999 });
    expect(await service.authenticate("sk_totallybogusvaluexxxxxxx")).toBeNull();
    expect(await service.authenticate("not-even-a-key")).toBeNull();
    expect(await service.authenticate("")).toBeNull();
  });
});
