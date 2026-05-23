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

  it("bumps lastUsedAt and writes a successful SendLog row on a successful send", async () => {
    const before = await prisma.sendKey.findFirstOrThrow({
      where: { name: "ci" },
    });
    expect(before.lastUsedAt).toBeNull();

    const res = await app.inject({
      method: "POST",
      url: "/send",
      payload: {
        key: plaintext,
        title: "WARN",
        content: "first send",
      },
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.sendKey.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.lastUsedAt).not.toBeNull();
    expect(after.lastUsedAt!.getTime()).toBeGreaterThan(0);

    const logs = await prisma.sendLog.findMany({
      where: { sendKeyId: before.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      sendKeyId: before.id,
      userId: before.userId,
      title: "WARN",
      content: "first send",
      statusCode: 0,
      reason: null,
    });
    expect(logs[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("writes a SendLog row with the failure reason when the send pipeline gives up with 502", async () => {
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

    await app.inject({
      method: "POST",
      url: "/send",
      payload: { key: plaintext, content: "doomed" },
    });

    const logs = await prisma.sendLog.findMany({
      where: { sendKeyId: initialKey.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      statusCode: 502,
      reason: "no_alive_friendly_bot",
      content: "doomed",
    });

    // lastUsedAt must NOT have been bumped on failure.
    const refreshed = await prisma.sendKey.findUniqueOrThrow({
      where: { id: initialKey.id },
    });
    expect(refreshed.lastUsedAt).toBeNull();
  });

  it("logs even when the SendKey is disabled (so the user sees the attempt)", async () => {
    const initialKey = await prisma.sendKey.findFirstOrThrow({
      where: { name: "ci" },
    });
    await prisma.sendKey.update({
      where: { id: initialKey.id },
      data: { state: "disabled" },
    });

    const r = await app.inject({
      method: "POST",
      url: "/send",
      payload: { key: plaintext, content: "tried" },
    });
    expect(r.statusCode).toBe(401);

    const logs = await prisma.sendLog.findMany({
      where: { sendKeyId: initialKey.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      statusCode: 401,
      reason: "send_key_disabled",
    });
  });
});

/**
 * Build a minimal multipart/form-data payload for `app.inject`. Returns
 * the body Buffer and the matching `Content-Type` header.
 */
function buildMultipart(parts: Array<
  | { kind: "file"; name: string; filename: string; bytes: Buffer; mime?: string }
  | { kind: "field"; name: string; value: string }
>): { body: Buffer; contentType: string } {
  const boundary = `----qqn${Math.random().toString(36).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (p.kind === "file") {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n` +
            `Content-Type: ${p.mime ?? "application/octet-stream"}\r\n\r\n`,
        ),
      );
      chunks.push(p.bytes);
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`,
        ),
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("/send/file", () => {
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

    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: "alice",
        password: "hunter2hunter2",
        inviteCode,
      },
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

  it("forwards a small file to the bot as upload_private_file with base64 content", async () => {
    const bytes = Buffer.from("hello world", "utf8");
    const { body, contentType } = buildMultipart([
      { kind: "file", name: "file", filename: "note.txt", bytes },
    ]);

    const res = await app.inject({
      method: "POST",
      url: `/send/file/${plaintext}`,
      headers: { "content-type": contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ code: 0, message: "ok" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.action).toBe("upload_private_file");
    const params = calls[0]!.params as {
      user_id: number;
      file: string;
      name: string;
    };
    expect(params.user_id).toBe(12345);
    expect(params.name).toBe("note.txt");
    expect(params.file.startsWith("base64://")).toBe(true);
    const decoded = Buffer.from(params.file.slice("base64://".length), "base64");
    expect(decoded.toString("utf8")).toBe("hello world");
  });

  it("honours an explicit `name` form field over the upload filename", async () => {
    const { body, contentType } = buildMultipart([
      {
        kind: "file",
        name: "file",
        filename: "tmpupload.bin",
        bytes: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      },
      { kind: "field", name: "name", value: "report.pdf" },
    ]);

    const res = await app.inject({
      method: "POST",
      url: `/send/file/${plaintext}`,
      headers: { "content-type": contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect((calls[0]!.params as { name: string }).name).toBe("report.pdf");
  });

  it("accepts the SendKey via Authorization: Bearer header", async () => {
    const { body, contentType } = buildMultipart([
      { kind: "file", name: "file", filename: "x.txt", bytes: Buffer.from("hi") },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/send/file",
      headers: {
        "content-type": contentType,
        authorization: `Bearer ${plaintext}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
  });

  it("returns 400 missing_file when no file part is present", async () => {
    const { body, contentType } = buildMultipart([
      { kind: "field", name: "key", value: plaintext },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/send/file",
      headers: { "content-type": contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("missing_file");
  });

  it("returns 400 missing_key when no SendKey is supplied anywhere", async () => {
    const { body, contentType } = buildMultipart([
      { kind: "file", name: "file", filename: "a.txt", bytes: Buffer.from("a") },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/send/file",
      headers: { "content-type": contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("missing_key");
  });

  it("returns 401 invalid_send_key for an unknown key", async () => {
    const { body, contentType } = buildMultipart([
      { kind: "file", name: "file", filename: "a.txt", bytes: Buffer.from("a") },
      { kind: "field", name: "key", value: "sk_definitely-not-a-real-key" },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/send/file",
      headers: { "content-type": contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe("invalid_send_key");
  });

  it("writes a SendLog row on success annotated with [文件] <name> (<size>)", async () => {
    const initialKey = await prisma.sendKey.findFirstOrThrow({
      where: { name: "ci" },
    });
    const { body, contentType } = buildMultipart([
      {
        kind: "file",
        name: "file",
        filename: "report.pdf",
        bytes: Buffer.from("x".repeat(2048)),
      },
    ]);

    const res = await app.inject({
      method: "POST",
      url: `/send/file/${plaintext}`,
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(200);

    const logs = await prisma.sendLog.findMany({
      where: { sendKeyId: initialKey.id },
      include: { attachment: true },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.statusCode).toBe(0);
    expect(logs[0]!.content).toMatch(/^\[文件\] report\.pdf \(2\.0 KB\)$/);
    expect(logs[0]!.title).toBeNull();
    expect(logs[0]!.hasAttachment).toBe(true);
    expect(logs[0]!.attachment).not.toBeNull();
    expect(logs[0]!.attachment!.fileName).toBe("report.pdf");
    expect(logs[0]!.attachment!.byteCount).toBe(2048);
    expect(Buffer.from(logs[0]!.attachment!.data).length).toBe(2048);

    const reloaded = await prisma.sendKey.findUniqueOrThrow({
      where: { id: initialKey.id },
    });
    expect(reloaded.lastUsedAt).not.toBeNull();
  });

  it("rejects a disabled SendKey with 401 and still writes a log row", async () => {
    const initialKey = await prisma.sendKey.findFirstOrThrow({
      where: { name: "ci" },
    });
    await prisma.sendKey.update({
      where: { id: initialKey.id },
      data: { state: "disabled" },
    });

    const { body, contentType } = buildMultipart([
      { kind: "file", name: "file", filename: "x.txt", bytes: Buffer.from("x") },
    ]);

    const res = await app.inject({
      method: "POST",
      url: `/send/file/${plaintext}`,
      headers: { "content-type": contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe("send_key_disabled");

    const logs = await prisma.sendLog.findMany({
      where: { sendKeyId: initialKey.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.reason).toBe("send_key_disabled");
  });
});
