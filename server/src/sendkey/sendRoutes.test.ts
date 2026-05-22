import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app/createApp.js";
import { BotManager, type ClientFactory, type BotStatus } from "../bot/BotManager.js";
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

type SendCall = { botId: number; action: string; params: unknown };

/**
 * Builds a BotManager whose listStatus reports one alive bot, and whose
 * request() records the call into `calls`. Use to test the send pipeline
 * without touching real WS.
 */
function makeFakeManager(opts: {
  prisma: ReturnType<typeof getTestPrisma>;
  bots: Array<{ botId: number; alive: boolean }>;
  calls: SendCall[];
  failBotIds?: Set<number>;
}): BotManager {
  const m = new BotManager({ prisma: opts.prisma, clientFactory: stubFactory });
  // Mutable copy so markSendFailure can flip alive flags.
  const aliveByBot = new Map(opts.bots.map((b) => [b.botId, b.alive]));
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
      alive: aliveByBot.get(b.botId) ?? false,
      friendCount: 0,
    }));
  (m as unknown as {
    request: (botId: number, action: string, params: unknown) => Promise<unknown>;
  }).request = async (botId, action, params) => {
    if (opts.failBotIds?.has(botId)) {
      throw new Error("simulated send failure");
    }
    opts.calls.push({ botId, action, params });
    return { message_id: 1 };
  };
  (m as unknown as {
    markSendFailure: (botId: number) => void;
  }).markSendFailure = (botId) => {
    aliveByBot.set(botId, false);
  };
  return m;
}

describe("/send (5 forms)", () => {
  const prisma = getTestPrisma();
  let app: FastifyInstance;
  let plaintext: string;
  let calls: SendCall[];
  let cache: FriendshipCache;

  beforeEach(async () => {
    await resetDb(prisma);
    if (app) await app.close();
    calls = [];
    cache = new FriendshipCache();

    const bot = await prisma.bot.create({
      data: { name: "primary", qq: BigInt(10001), wsUrl: "ws://x" },
    });
    cache.add(bot.id, 12345);

    const fakeManager = makeFakeManager({
      prisma,
      bots: [{ botId: bot.id, alive: true }],
      calls,
    });

    app = await createApp({
      config,
      prisma,
      botManager: fakeManager,
      friendshipCache: cache,
    });

    // Register a user so we can create a SendKey.
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

  it("GET /send/<key>?content=...", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/send/${plaintext}?content=hello`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ code: 0, message: "ok" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.action).toBe("send_private_msg");
    expect(calls[0]!.params).toMatchObject({ user_id: 12345, message: "hello" });
  });

  it("GET /send?key=...&content=...", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/send?key=${plaintext}&content=hi`,
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toMatchObject({ message: "hi" });
  });

  it("POST /send/<key> with JSON body", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/send/${plaintext}`,
      payload: { content: "hello via post path" },
    });
    expect(res.statusCode).toBe(200);
    expect(calls[0]!.params).toMatchObject({ message: "hello via post path" });
  });

  it("POST /send with Authorization: Bearer header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/send",
      headers: { authorization: `Bearer ${plaintext}` },
      payload: { content: "hello via bearer" },
    });
    expect(res.statusCode).toBe(200);
    expect(calls[0]!.params).toMatchObject({ message: "hello via bearer" });
  });

  it("POST /send with key in body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/send",
      payload: { key: plaintext, content: "hello via body" },
    });
    expect(res.statusCode).toBe(200);
    expect(calls[0]!.params).toMatchObject({ message: "hello via body" });
  });

  it("renders title with the 【title】\\ncontent rule", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/send",
      payload: { key: plaintext, title: "WARN", content: "stuff broken" },
    });
    expect(res.statusCode).toBe(200);
    expect(calls[0]!.params).toMatchObject({
      message: "【WARN】\nstuff broken",
    });
  });

  it("sends content verbatim when title is absent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/send",
      payload: { key: plaintext, content: "verbatim" },
    });
    expect(res.statusCode).toBe(200);
    expect(calls[0]!.params).toMatchObject({ message: "verbatim" });
  });

  it("returns 400 when content is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/send",
      payload: { key: plaintext },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("returns 400 when no key is provided in any location", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/send",
      payload: { content: "hello" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 when the SendKey is unknown", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/send",
      payload: { key: "sk_totallybogusvalue123", content: "hello" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("resolves Authorization header before path-segment when both are present", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/send/sk_wrong000000000000000000`,
      headers: { authorization: `Bearer ${plaintext}` },
      payload: { content: "hello" },
    });
    // header wins -> auth succeeds
    expect(res.statusCode).toBe(200);
  });

  it("rebinds the SendKey to another alive friendly bot when the bound bot is dead, persists the change, and uses the new bot for the send", async () => {
    // Two bots: A and B, both initially alive and friends of target 12345.
    const botB = await prisma.bot.create({
      data: { name: "B", qq: BigInt(10002), wsUrl: "ws://y" },
    });
    cache.add(botB.id, 12345);
    // botA is the existing one (10001) from beforeEach. plaintext is bound
    // to botA via a normal create-key flow.

    // Sanity: the SendKey from beforeEach is bound to bot 10001.
    const initialKey = await prisma.sendKey.findFirstOrThrow({
      where: { name: "ci" },
    });
    const botA = await prisma.bot.findUniqueOrThrow({
      where: { id: initialKey.botId },
    });

    // Now flip botA dead while leaving botB alive. Replace the app with a
    // freshly-built fake manager that reflects this snapshot.
    if (app) await app.close();
    calls = [];
    const fakeManager = makeFakeManager({
      prisma,
      bots: [
        { botId: botA.id, alive: false }, // dead
        { botId: botB.id, alive: true },
      ],
      calls,
    });
    app = await createApp({
      config,
      prisma,
      botManager: fakeManager,
      friendshipCache: cache,
    });

    const send = await app.inject({
      method: "POST",
      url: "/send",
      payload: { key: plaintext, content: "hello" },
    });

    expect(send.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.botId).toBe(botB.id); // routed via the alive bot

    const dbKey = await prisma.sendKey.findUnique({
      where: { id: initialKey.id },
    });
    expect(dbKey!.botId).toBe(botB.id); // persisted re-bind
  });

  it("retries via another alive friendly bot when send_private_msg fails on the bound bot", async () => {
    // botA bound, alive but the underlying send fails (user removed bot
    // as friend). botB also alive and friend.
    const initialKey = await prisma.sendKey.findFirstOrThrow({
      where: { name: "ci" },
    });
    const botA = await prisma.bot.findUniqueOrThrow({
      where: { id: initialKey.botId },
    });
    const botB = await prisma.bot.create({
      data: { name: "B", qq: BigInt(10002), wsUrl: "ws://y" },
    });
    cache.add(botB.id, 12345);

    if (app) await app.close();
    calls = [];
    const fakeManager = makeFakeManager({
      prisma,
      bots: [
        { botId: botA.id, alive: true },
        { botId: botB.id, alive: true },
      ],
      calls,
      failBotIds: new Set([botA.id]),
    });
    app = await createApp({
      config,
      prisma,
      botManager: fakeManager,
      friendshipCache: cache,
    });

    const send = await app.inject({
      method: "POST",
      url: "/send",
      payload: { key: plaintext, content: "retry me" },
    });

    expect(send.statusCode).toBe(200);
    // botA was tried, failed, then botB succeeded — 1 successful call.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.botId).toBe(botB.id);

    // Friendship for (botA, target) was dropped from cache.
    expect(cache.has(botA.id, 12345)).toBe(false);
    expect(cache.has(botB.id, 12345)).toBe(true);

    // SendKey is rebound to botB.
    const dbKey = await prisma.sendKey.findUnique({
      where: { id: initialKey.id },
    });
    expect(dbKey!.botId).toBe(botB.id);
  });

  it("returns 502 when the bound bot's send fails and no other alive friendly bot exists", async () => {
    const initialKey = await prisma.sendKey.findFirstOrThrow({
      where: { name: "ci" },
    });
    const botA = await prisma.bot.findUniqueOrThrow({
      where: { id: initialKey.botId },
    });

    if (app) await app.close();
    calls = [];
    const fakeManager = makeFakeManager({
      prisma,
      bots: [{ botId: botA.id, alive: true }],
      calls,
      failBotIds: new Set([botA.id]),
    });
    app = await createApp({
      config,
      prisma,
      botManager: fakeManager,
      friendshipCache: cache,
    });

    const send = await app.inject({
      method: "POST",
      url: "/send",
      payload: { key: plaintext, content: "doomed" },
    });

    expect(send.statusCode).toBe(502);
    expect(calls).toHaveLength(0);
    // Friendship was still dropped — the next request will skip botA up
    // front.
    expect(cache.has(botA.id, 12345)).toBe(false);
  });

  it("rejects sends through a SendKey whose state is disabled with 401", async () => {
    const initialKey = await prisma.sendKey.findFirstOrThrow({
      where: { name: "ci" },
    });
    await prisma.sendKey.update({
      where: { id: initialKey.id },
      data: { state: "disabled" },
    });

    const send = await app.inject({
      method: "POST",
      url: "/send",
      payload: { key: plaintext, content: "ignored" },
    });

    expect(send.statusCode).toBe(401);
    expect(send.json().message).toBe("send_key_disabled");
    expect(calls).toHaveLength(0);
  });
});
