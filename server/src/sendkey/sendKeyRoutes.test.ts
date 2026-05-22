import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app/createApp.js";
import { BotManager, type BotStatus, type ClientFactory } from "../bot/BotManager.js";
import { FriendshipCache } from "../friendship/FriendshipCache.js";
import { getTestPrisma, resetDb } from "../../test/db.js";
import type { Config } from "../config/loadConfig.js";
import type { OneBotClient } from "../onebot/OneBotClient.js";

const inviteCode = "test-invite";
const config: Config = {
  databaseUrl: "ignored-tests-use-injected-prisma",
  jwtSecret: "test-secret",
  inviteCode,
  adminUsername: "admin",
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
  bots: Array<{ botId: number; qq: number; alive: boolean }>;
}): BotManager {
  const m = new BotManager({ prisma: opts.prisma, clientFactory: stubFactory });
  (m as unknown as { listStatus: () => BotStatus[] }).listStatus = () =>
    opts.bots.map((b) => ({
      botId: b.botId,
      qq: b.qq,
      name: `bot-${b.botId}`,
      enabled: true,
      wsState: "open",
      lastHeartbeatAt: Date.now(),
      heartbeatInterval: 5000,
      online: true,
      alive: b.alive,
      friendCount: 0,
    }));
  return m;
}

describe("/api/me/keys handshake flow", () => {
  const prisma = getTestPrisma();
  let app: FastifyInstance;
  let token: string;
  let cache: FriendshipCache;
  let botId: number;

  beforeEach(async () => {
    await resetDb(prisma);
    if (app) await app.close();
    cache = new FriendshipCache();

    const bot = await prisma.bot.create({
      data: { name: "primary", qq: BigInt(20001), wsUrl: "ws://x" },
    });
    botId = bot.id;

    app = await createApp({
      config,
      prisma,
      botManager: makeFakeManager({
        prisma,
        bots: [{ botId: bot.id, qq: 20001, alive: true }],
      }),
      friendshipCache: cache,
    });

    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "hunter2hunter2", inviteCode },
    });
    token = reg.json().data.token;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it("POST /api/me/keys returns 202 with hostBotQq when no friendship exists", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "ci", targetQq: 999 },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      code: 202,
      message: "needs_handshake",
      data: { hostBotQq: 20001 },
    });

    expect(await prisma.sendKey.findMany()).toHaveLength(0);
  });

  it("POST /api/me/keys/finalize 202s while still waiting", async () => {
    await app.inject({
      method: "POST",
      url: "/api/me/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "ci", targetQq: 999 },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/me/keys/finalize",
      headers: { authorization: `Bearer ${token}` },
      payload: { targetQq: 999 },
    });

    expect(res.statusCode).toBe(202);
  });

  it("POST /api/me/keys/finalize succeeds once the friendship is in cache", async () => {
    await app.inject({
      method: "POST",
      url: "/api/me/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "ci", targetQq: 999 },
    });

    cache.add(botId, 999);

    const res = await app.inject({
      method: "POST",
      url: "/api/me/keys/finalize",
      headers: { authorization: `Bearer ${token}` },
      payload: { targetQq: 999 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.plaintext).toMatch(/^sk_/);
  });

  it("POST /api/me/keys/finalize 404s without an active pending entry", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/keys/finalize",
      headers: { authorization: `Bearer ${token}` },
      payload: { targetQq: 999 },
    });

    expect(res.statusCode).toBe(404);
  });
});
