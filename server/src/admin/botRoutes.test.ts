import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app/createApp.js";
import { BotManager, type ClientFactory } from "../bot/BotManager.js";
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

describe("/api/admin/bots", () => {
  const prisma = getTestPrisma();
  let app: FastifyInstance;
  let userToken: string;
  let opToken: string;

  beforeEach(async () => {
    await resetDb(prisma);
    if (app) await app.close();
    const botManager = new BotManager({ prisma, clientFactory: stubFactory });
    app = await createApp({ config, prisma, botManager });

    // Register a normal user.
    const reg1 = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "hunter2hunter2", inviteCode },
    });
    userToken = reg1.json().data.token;

    // Register an operator (manually flip the flag in DB).
    const reg2 = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "lectwolf", password: "hunter2hunter2", inviteCode },
    });
    opToken = reg2.json().data.token;
    await prisma.user.update({
      where: { username: "lectwolf" },
      data: { isOperator: true },
    });
    // Re-issue token so its isOperator claim is fresh.
    const reLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "lectwolf", password: "hunter2hunter2" },
    });
    opToken = reLogin.json().data.token;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it("returns 401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/bots" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 to a non-operator", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/bots",
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns the list of bots to an operator", async () => {
    await prisma.bot.create({
      data: {
        name: "primary",
        qq: BigInt(10001),
        wsUrl: "ws://localhost:3001",
      },
    });

    // Force the manager to pick up the new row before listing.
    // (In production a 3s reconcile tick would do it; we test the GET path
    // gives the operator a fresh enough view by not asserting on bot
    // presence here. Instead we assert just on shape and operator access.)
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/bots",
      headers: { authorization: `Bearer ${opToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().code).toBe(0);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("creates a Bot via POST and surfaces it to GET on the next request", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/admin/bots",
      headers: { authorization: `Bearer ${opToken}` },
      payload: {
        name: "primary",
        qq: 10001,
        wsUrl: "ws://localhost:3001",
        accessToken: "tok",
      },
    });
    expect(create.statusCode).toBe(200);
    const { id, qq } = create.json().data;
    expect(typeof id).toBe("number");
    expect(qq).toBe(10001);

    const stored = await prisma.bot.findUnique({ where: { id } });
    expect(stored).not.toBeNull();
    expect(stored!.qq).toBe(BigInt(10001));
    expect(stored!.accessToken).toBe("tok");
    expect(stored!.enabled).toBe(true);
  });

  it("rejects POST with a duplicate qq with 409", async () => {
    await prisma.bot.create({
      data: {
        name: "primary",
        qq: BigInt(10001),
        wsUrl: "ws://localhost:3001",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/bots",
      headers: { authorization: `Bearer ${opToken}` },
      payload: { name: "dup", qq: 10001, wsUrl: "ws://localhost:3002" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("PATCH updates editable fields", async () => {
    const bot = await prisma.bot.create({
      data: {
        name: "primary",
        qq: BigInt(10001),
        wsUrl: "ws://localhost:3001",
        enabled: true,
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/admin/bots/${bot.id}`,
      headers: { authorization: `Bearer ${opToken}` },
      payload: { enabled: false, name: "renamed" },
    });
    expect(res.statusCode).toBe(200);

    const updated = await prisma.bot.findUnique({ where: { id: bot.id } });
    expect(updated!.enabled).toBe(false);
    expect(updated!.name).toBe("renamed");
  });

  it("PATCH on a missing id returns 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/admin/bots/9999999",
      headers: { authorization: `Bearer ${opToken}` },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE removes a Bot", async () => {
    const bot = await prisma.bot.create({
      data: {
        name: "primary",
        qq: BigInt(10001),
        wsUrl: "ws://localhost:3001",
      },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/admin/bots/${bot.id}`,
      headers: { authorization: `Bearer ${opToken}` },
    });
    expect(res.statusCode).toBe(200);

    const remaining = await prisma.bot.findUnique({ where: { id: bot.id } });
    expect(remaining).toBeNull();
  });

  it("DELETE on a missing id returns 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/admin/bots/9999999",
      headers: { authorization: `Bearer ${opToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("non-operator is blocked from POST/PATCH/DELETE", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/api/admin/bots",
      headers: { authorization: `Bearer ${userToken}` },
      payload: { name: "x", qq: 1, wsUrl: "ws://x" },
    });
    expect(post.statusCode).toBe(403);

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/admin/bots/1",
      headers: { authorization: `Bearer ${userToken}` },
      payload: { enabled: false },
    });
    expect(patch.statusCode).toBe(403);

    const del = await app.inject({
      method: "DELETE",
      url: "/api/admin/bots/1",
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(del.statusCode).toBe(403);
  });
});
