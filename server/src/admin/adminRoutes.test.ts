import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app/createApp.js";
import { BotManager, type BotStatus, type ClientFactory } from "../bot/BotManager.js";
import { FriendshipCache } from "../friendship/FriendshipCache.js";
import { getTestPrisma, resetDb } from "../../test/db.js";
import type { Config } from "../config/loadConfig.js";
import type { OneBotClient } from "../onebot/OneBotClient.js";

const inviteCode = "test-invite";
const adminUsername = "lectwolf";
const config: Config = {
  databaseUrl: "ignored-tests-use-injected-prisma",
  jwtSecret: "test-secret",
  inviteCode,
  adminUsername,
  port: 0,
  nodeEnv: "test",
};

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

function makeFakeManager(opts: {
  prisma: ReturnType<typeof getTestPrisma>;
  refreshSpy?: () => Promise<{
    refreshed: number;
    skipped: number;
    durationMs: number;
  }>;
}): BotManager {
  const m = new BotManager({ prisma: opts.prisma, clientFactory: stubFactory });
  (m as unknown as { listStatus: () => BotStatus[] }).listStatus = () => [];
  if (opts.refreshSpy) {
    (m as unknown as {
      refreshAllFriendsNow: () => Promise<unknown>;
    }).refreshAllFriendsNow = opts.refreshSpy;
  }
  return m;
}

async function loginAs(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<string> {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
  return r.json().data.token;
}

describe("/api/admin/users", () => {
  const prisma = getTestPrisma();
  let app: FastifyInstance;
  let opToken: string;
  let userToken: string;

  beforeEach(async () => {
    await resetDb(prisma);
    if (app) await app.close();
    app = await createApp({
      config,
      prisma,
      botManager: makeFakeManager({ prisma }),
      friendshipCache: new FriendshipCache(),
    });

    // Operator (matches ADMIN_USERNAME so auto-promoted on register).
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: adminUsername,
        password: "hunter2hunter2",
        inviteCode,
      },
    });
    opToken = await loginAs(app, adminUsername, "hunter2hunter2");

    // Regular user.
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "hunter2hunter2", inviteCode },
    });
    userToken = await loginAs(app, "alice", "hunter2hunter2");
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it("GET returns every user with their SendKey count to operators", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${opToken}` },
    });

    expect(res.statusCode).toBe(200);
    const list = res.json().data as Array<{
      username: string;
      isOperator: boolean;
      sendKeyCount: number;
    }>;
    const usernames = list.map((u) => u.username).sort();
    expect(usernames).toEqual(["alice", adminUsername].sort());
    expect(list.find((u) => u.username === adminUsername)!.isOperator).toBe(
      true,
    );
    for (const u of list) expect(u.sendKeyCount).toBe(0);
  });

  it("GET 403s for non-operators", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET 401s without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/users" });
    expect(res.statusCode).toBe(401);
  });

  it("DELETE removes a user and cascades to their SendKeys", async () => {
    // Give alice a SendKey via direct DB write so the cascade is testable.
    const aliceId = (
      await prisma.user.findUniqueOrThrow({ where: { username: "alice" } })
    ).id;
    const bot = await prisma.bot.create({
      data: { name: "B", qq: BigInt(10001), wsUrl: "ws://x" },
    });
    await prisma.sendKey.create({
      data: {
        userId: aliceId,
        name: "ci",
        targetQq: BigInt(999),
        botId: bot.id,
        keyHash: "h",
        prefix: "p",
      },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${aliceId}`,
      headers: { authorization: `Bearer ${opToken}` },
    });
    expect(res.statusCode).toBe(200);

    expect(
      await prisma.user.findUnique({ where: { id: aliceId } }),
    ).toBeNull();
    expect(await prisma.sendKey.findMany({ where: { userId: aliceId } })).toEqual(
      [],
    );
  });

  it("DELETE refuses to delete the operator self", async () => {
    const opUser = await prisma.user.findUniqueOrThrow({
      where: { username: adminUsername },
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${opUser.id}`,
      headers: { authorization: `Bearer ${opToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE 404s for an unknown id", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/9999999`,
      headers: { authorization: `Bearer ${opToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE 403s for non-operators", async () => {
    const aliceId = (
      await prisma.user.findUniqueOrThrow({ where: { username: "alice" } })
    ).id;
    const res = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${aliceId}`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("/api/admin/keys", () => {
  const prisma = getTestPrisma();
  let app: FastifyInstance;
  let opToken: string;
  let userToken: string;
  let keyId: number;

  beforeEach(async () => {
    await resetDb(prisma);
    if (app) await app.close();
    app = await createApp({
      config,
      prisma,
      botManager: makeFakeManager({ prisma }),
      friendshipCache: new FriendshipCache(),
    });

    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: adminUsername,
        password: "hunter2hunter2",
        inviteCode,
      },
    });
    opToken = await loginAs(app, adminUsername, "hunter2hunter2");

    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "hunter2hunter2", inviteCode },
    });
    userToken = await loginAs(app, "alice", "hunter2hunter2");

    // Seed a SendKey owned by alice.
    const alice = await prisma.user.findUniqueOrThrow({
      where: { username: "alice" },
    });
    const bot = await prisma.bot.create({
      data: { name: "B", qq: BigInt(10001), wsUrl: "ws://x" },
    });
    keyId = (
      await prisma.sendKey.create({
        data: {
          userId: alice.id,
          name: "ci",
          targetQq: BigInt(999),
          botId: bot.id,
          keyHash: "h",
          prefix: "p",
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it("GET lists every SendKey with its owner username", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/keys",
      headers: { authorization: `Bearer ${opToken}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json().data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      username: "alice",
      name: "ci",
      targetQq: 999,
      state: "active",
    });
    // plaintext is exposed so operators (and the owning user) can re-copy
    // the key from the management UI; the bcrypt hash never goes over the
    // wire.
    expect(list[0]).toHaveProperty("plaintext");
    expect(list[0]).not.toHaveProperty("keyHash");
  });

  it("PATCH toggles state to disabled", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/admin/keys/${keyId}`,
      headers: { authorization: `Bearer ${opToken}` },
      payload: { state: "disabled" },
    });
    expect(res.statusCode).toBe(200);
    const updated = await prisma.sendKey.findUniqueOrThrow({
      where: { id: keyId },
    });
    expect(updated.state).toBe("disabled");
  });

  it("PATCH 404s on a missing id", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/admin/keys/9999999",
      headers: { authorization: `Bearer ${opToken}` },
      payload: { state: "disabled" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("non-operators get 403 from GET / PATCH", async () => {
    const get = await app.inject({
      method: "GET",
      url: "/api/admin/keys",
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(get.statusCode).toBe(403);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/admin/keys/${keyId}`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { state: "disabled" },
    });
    expect(patch.statusCode).toBe(403);
  });
});

describe("POST /api/admin/friendships/refresh", () => {
  const prisma = getTestPrisma();
  let app: FastifyInstance;
  let opToken: string;
  let userToken: string;
  let refreshCalls: number;

  beforeEach(async () => {
    await resetDb(prisma);
    if (app) await app.close();
    refreshCalls = 0;

    const fake = makeFakeManager({
      prisma,
      refreshSpy: async () => {
        refreshCalls++;
        return { refreshed: 2, skipped: 1, durationMs: 42 };
      },
    });
    app = await createApp({
      config,
      prisma,
      botManager: fake,
      friendshipCache: new FriendshipCache(),
    });

    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: adminUsername,
        password: "hunter2hunter2",
        inviteCode,
      },
    });
    opToken = await loginAs(app, adminUsername, "hunter2hunter2");

    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "hunter2hunter2", inviteCode },
    });
    userToken = await loginAs(app, "alice", "hunter2hunter2");
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it("triggers refreshAllFriendsNow and returns the summary to operators", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/friendships/refresh",
      headers: { authorization: `Bearer ${opToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      refreshed: 2,
      skipped: 1,
      durationMs: 42,
    });
    expect(refreshCalls).toBe(1);
  });

  it("403s for non-operators", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/friendships/refresh",
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(refreshCalls).toBe(0);
  });
});
