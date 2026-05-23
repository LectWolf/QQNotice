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
async function makeAliveManager(
  prisma: ReturnType<typeof getTestPrisma>,
  aliveBotIds: number[],
): Promise<BotManager> {
  const m = new BotManager({ prisma, clientFactory: stubFactory });
  const rows = await prisma.bot.findMany({
    where: { id: { in: aliveBotIds } },
  });
  const qqByBotId = new Map(rows.map((r) => [r.id, Number(r.qq)]));
  (m as unknown as {
    listStatus: () => Array<{ botId: number; qq: number; alive: boolean }>;
  }).listStatus = () =>
    aliveBotIds.map((id) => ({
      botId: id,
      qq: qqByBotId.get(id) ?? 0,
      alive: true,
    }));
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
      botManager: await makeAliveManager(prisma, [bot.id]),
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

  it("returns a needsHandshake result with the host bot QQ when no alive bot is friends with the target but at least one alive bot exists", async () => {
    const bot = await prisma.bot.create({
      data: { name: "host-candidate", qq: BigInt(20001), wsUrl: "ws://x" },
    });
    const friendshipCache = new FriendshipCache();
    const service = new SendKeyService({
      prisma,
      botManager: await makeAliveManager(prisma, [bot.id]),
      friendshipCache,
      router: new Router(),
      bcryptCost: 4,
    });

    await expect(
      service.create({ userId, name: "ci", targetQq: 999 }),
    ).rejects.toMatchObject({
      httpCode: 202,
      reason: "needs_handshake",
      hostBotQq: 20001,
    });

    // No DB row should exist yet.
    expect(await prisma.sendKey.findMany()).toHaveLength(0);
  });

  it("throws no_alive_bot when there are zero alive bots in the pool", async () => {
    const friendshipCache = new FriendshipCache();
    const service = new SendKeyService({
      prisma,
      botManager: await makeAliveManager(prisma, []),
      friendshipCache,
      router: new Router(),
      bcryptCost: 4,
    });

    await expect(
      service.create({ userId, name: "ci", targetQq: 999 }),
    ).rejects.toMatchObject({
      httpCode: 503,
      reason: "no_alive_bot",
    });
  });

  it("rejects creating a SendKey for a non-existent user with 401", async () => {
    const friendshipCache = new FriendshipCache();
    const service = new SendKeyService({
      prisma,
      botManager: await makeAliveManager(prisma, []),
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
      botManager: await makeAliveManager(prisma, [botId]),
      friendshipCache,
      router: new Router({ pickIndex: () => 0 }),
      bcryptCost: 4,
    });
  });

  it("returns the caller's keys with plaintext (re-copyable) but never the hash", async () => {
    const created = await service.create({
      userId: aliceId,
      name: "ci",
      targetQq: 999,
    });
    await service.create({ userId: aliceId, name: "ha", targetQq: 999 });
    await service.create({ userId: bobId, name: "bobs", targetQq: 999 });

    const list = await service.listForUser(aliceId);

    expect(list).toHaveLength(2);
    for (const item of list) {
      expect(item).not.toHaveProperty("keyHash");
      expect(item).toMatchObject({ targetQq: 999, state: "active" });
      expect(item.prefix).toMatch(/^sk_[A-Za-z0-9_-]{5}$/);
      expect(item.plaintext).toMatch(/^sk_/);
    }
    const ciItem = list.find((k) => k.name === "ci");
    expect(ciItem!.plaintext).toBe(created.plaintext);
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
      botManager: await makeAliveManager(prisma, [botId]),
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
      botManager: await makeAliveManager(prisma, [botId]),
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

describe("SendKeyService.finalize", () => {
  const prisma = getTestPrisma();
  let aliceId: number;
  let botId: number;
  let cache: FriendshipCache;
  let service: SendKeyService;

  beforeEach(async () => {
    await resetDb(prisma);
    aliceId = (
      await prisma.user.create({
        data: { username: "alice", passwordHash: "x" },
      })
    ).id;
    const bot = await prisma.bot.create({
      data: { name: "primary", qq: BigInt(20001), wsUrl: "ws://x" },
    });
    botId = bot.id;
    cache = new FriendshipCache();
    service = new SendKeyService({
      prisma,
      botManager: await makeAliveManager(prisma, [botId]),
      friendshipCache: cache,
      router: new Router({ pickIndex: () => 0 }),
      bcryptCost: 4,
    });
  });

  it("404s when there is no pending entry for (user, target)", async () => {
    await expect(service.finalize(aliceId, 999)).rejects.toMatchObject({
      httpCode: 404,
      reason: "no_pending_handshake",
    });
  });

  it("throws PendingHandshakeError while waiting for the friendship to land", async () => {
    // Open a pending entry by attempting to create — friendship cache empty.
    await expect(
      service.create({ userId: aliceId, name: "ci", targetQq: 999 }),
    ).rejects.toMatchObject({ httpCode: 202 });

    // Cache still doesn't know about the friendship.
    await expect(service.finalize(aliceId, 999)).rejects.toMatchObject({
      httpCode: 202,
      hostBotQq: 20001,
    });
  });

  it("persists the SendKey and returns plaintext after the friendship is added", async () => {
    await expect(
      service.create({ userId: aliceId, name: "ci", targetQq: 999 }),
    ).rejects.toMatchObject({ httpCode: 202 });

    // Simulate the friend-request handler: the host bot is now friends.
    cache.add(botId, 999);

    const result = await service.finalize(aliceId, 999);

    expect(result.botId).toBe(botId);
    expect(result.targetQq).toBe(999);
    expect(result.name).toBe("ci");
    expect(result.plaintext).toMatch(/^sk_/);

    const stored = await prisma.sendKey.findUnique({
      where: { id: result.id },
    });
    expect(stored).not.toBeNull();
    expect(stored!.botId).toBe(botId);
  });

  it("a second finalize for the same target 404s after the first consumed the entry", async () => {
    await expect(
      service.create({ userId: aliceId, name: "ci", targetQq: 999 }),
    ).rejects.toMatchObject({ httpCode: 202 });

    cache.add(botId, 999);
    await service.finalize(aliceId, 999);

    await expect(service.finalize(aliceId, 999)).rejects.toMatchObject({
      httpCode: 404,
    });
  });
});

describe("SendKeyService.reconcileOnStartup", () => {
  const prisma = getTestPrisma();
  let aliceId: number;

  beforeEach(async () => {
    await resetDb(prisma);
    aliceId = (
      await prisma.user.create({
        data: { username: "alice", passwordHash: "x" },
      })
    ).id;
  });

  it("leaves keys whose bound bot is alive and still friends", async () => {
    const bot = await prisma.bot.create({
      data: { name: "A", qq: BigInt(10001), wsUrl: "ws://x" },
    });
    const key = await prisma.sendKey.create({
      data: {
        userId: aliceId,
        name: "ci",
        targetQq: BigInt(999),
        botId: bot.id,
        keyHash: "h",
        prefix: "p",
      },
    });
    const cache = new FriendshipCache();
    cache.add(bot.id, 999);

    const service = new SendKeyService({
      prisma,
      botManager: await makeAliveManager(prisma, [bot.id]),
      friendshipCache: cache,
      router: new Router(),
      bcryptCost: 4,
    });

    const summary = await service.reconcileOnStartup();
    expect(summary).toEqual({ leftAlone: 1, rebound: 0, disabled: 0, skipped: false });

    const after = await prisma.sendKey.findUniqueOrThrow({
      where: { id: key.id },
    });
    expect(after.botId).toBe(bot.id);
    expect(after.state).toBe("active");
  });

  it("rebinds to another alive friendly bot when the bound bot is dead", async () => {
    const dead = await prisma.bot.create({
      data: { name: "dead", qq: BigInt(10001), wsUrl: "ws://x" },
    });
    const alive = await prisma.bot.create({
      data: { name: "alive", qq: BigInt(10002), wsUrl: "ws://y" },
    });
    const key = await prisma.sendKey.create({
      data: {
        userId: aliceId,
        name: "ci",
        targetQq: BigInt(999),
        botId: dead.id,
        keyHash: "h",
        prefix: "p",
      },
    });
    const cache = new FriendshipCache();
    cache.add(alive.id, 999);

    const service = new SendKeyService({
      prisma,
      botManager: await makeAliveManager(prisma, [alive.id]), // dead not in alive list
      friendshipCache: cache,
      router: new Router({ pickIndex: () => 0 }),
      bcryptCost: 4,
    });

    const summary = await service.reconcileOnStartup();
    expect(summary).toEqual({ leftAlone: 0, rebound: 1, disabled: 0, skipped: false });

    const after = await prisma.sendKey.findUniqueOrThrow({
      where: { id: key.id },
    });
    expect(after.botId).toBe(alive.id);
    expect(after.state).toBe("active");
  });

  it("disables a key when no alive bot is friends with the target", async () => {
    const dead = await prisma.bot.create({
      data: { name: "dead", qq: BigInt(10001), wsUrl: "ws://x" },
    });
    const alive = await prisma.bot.create({
      data: { name: "alive", qq: BigInt(10002), wsUrl: "ws://y" },
    });
    const key = await prisma.sendKey.create({
      data: {
        userId: aliceId,
        name: "ci",
        targetQq: BigInt(999),
        botId: dead.id,
        keyHash: "h",
        prefix: "p",
      },
    });
    const cache = new FriendshipCache(); // empty — alive bot not friends with 999

    const service = new SendKeyService({
      prisma,
      botManager: await makeAliveManager(prisma, [alive.id]),
      friendshipCache: cache,
      router: new Router(),
      bcryptCost: 4,
    });

    const summary = await service.reconcileOnStartup();
    expect(summary).toEqual({ leftAlone: 0, rebound: 0, disabled: 1, skipped: false });

    const after = await prisma.sendKey.findUniqueOrThrow({
      where: { id: key.id },
    });
    expect(after.state).toBe("disabled");
  });

  it("skips reconcile when no bot is currently alive (startup race) — keys remain active", async () => {
    const bot = await prisma.bot.create({
      data: { name: "A", qq: BigInt(10001), wsUrl: "ws://x" },
    });
    const key = await prisma.sendKey.create({
      data: {
        userId: aliceId,
        name: "ci",
        targetQq: BigInt(999),
        botId: bot.id,
        keyHash: "h",
        prefix: "p",
      },
    });
    const cache = new FriendshipCache();
    const service = new SendKeyService({
      prisma,
      botManager: await makeAliveManager(prisma, []), // pool not yet ready
      friendshipCache: cache,
      router: new Router(),
      bcryptCost: 4,
    });

    const summary = await service.reconcileOnStartup();
    expect(summary).toEqual({
      leftAlone: 0,
      rebound: 0,
      disabled: 0,
      skipped: true,
    });

    const after = await prisma.sendKey.findUniqueOrThrow({
      where: { id: key.id },
    });
    expect(after.state).toBe("active");
  });

  it("skips already-disabled keys", async () => {
    const bot = await prisma.bot.create({
      data: { name: "A", qq: BigInt(10001), wsUrl: "ws://x" },
    });
    await prisma.sendKey.create({
      data: {
        userId: aliceId,
        name: "old",
        targetQq: BigInt(999),
        botId: bot.id,
        keyHash: "h",
        prefix: "p",
        state: "disabled",
      },
    });
    const cache = new FriendshipCache();
    const service = new SendKeyService({
      prisma,
      botManager: await makeAliveManager(prisma, [bot.id]),
      friendshipCache: cache,
      router: new Router(),
      bcryptCost: 4,
    });

    const summary = await service.reconcileOnStartup();
    expect(summary).toEqual({ leftAlone: 0, rebound: 0, disabled: 0, skipped: false });
  });
});
