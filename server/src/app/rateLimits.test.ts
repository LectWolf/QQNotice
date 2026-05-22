import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./createApp.js";
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
  bots: Array<{ botId: number; alive: boolean }>;
}): BotManager {
  const m = new BotManager({ prisma: opts.prisma, clientFactory: stubFactory });
  (m as unknown as { listStatus: () => BotStatus[] }).listStatus = () =>
    opts.bots.map((b) => ({
      botId: b.botId,
      qq: 10000 + b.botId,
      name: `bot-${b.botId}`,
      enabled: true,
      wsState: "open",
      lastHeartbeatAt: Date.now(),
      heartbeatInterval: 5000,
      online: true,
      alive: b.alive,
      friendCount: 0,
    }));
  (m as unknown as {
    request: (botId: number, action: string, params: unknown) => Promise<unknown>;
  }).request = async () => ({ message_id: 1 });
  return m;
}

describe("rate limiting", () => {
  const prisma = getTestPrisma();
  let app: FastifyInstance;
  let plaintext: string;

  beforeEach(async () => {
    await resetDb(prisma);
    if (app) await app.close();

    const cache = new FriendshipCache();
    const bot = await prisma.bot.create({
      data: { name: "primary", qq: BigInt(10001), wsUrl: "ws://x" },
    });
    cache.add(bot.id, 12345);
    const fakeManager = makeFakeManager({
      prisma,
      bots: [{ botId: bot.id, alive: true }],
    });

    app = await createApp({
      config,
      prisma,
      botManager: fakeManager,
      friendshipCache: cache,
      rateLimits: {
        perSendKeyPerMinute: 3,
        perIpSendPerMinute: 5,
        perIpAuthPer15Minutes: 4,
      },
    });

    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "hunter2hunter2", inviteCode },
    });
    const token = reg.json().data.token;

    const create = await app.inject({
      method: "POST",
      url: "/api/me/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "ci", targetQq: 12345 },
    });
    plaintext = create.json().data.plaintext;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it("returns 429 after exceeding the per-SendKey limit", async () => {
    const send = () =>
      app.inject({
        method: "POST",
        url: "/send",
        payload: { key: plaintext, content: "x" },
      });

    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    const limited = await send();
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe(429);
  });

  it("returns 429 on /api/auth/* after exceeding the per-IP auth limit", async () => {
    // Already used 1 register call in beforeEach, so 3 more will hit the limit.
    const login = () =>
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "alice", password: "wrong" },
      });

    expect((await login()).statusCode).toBe(401);
    expect((await login()).statusCode).toBe(401);
    expect((await login()).statusCode).toBe(401);
    const limited = await login();
    expect(limited.statusCode).toBe(429);
  });
});
