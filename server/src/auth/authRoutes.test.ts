import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app/createApp.js";
import { getTestPrisma, resetDb } from "../../test/db.js";
import type { Config } from "../config/loadConfig.js";

const inviteCode = "test-invite";
const config: Config = {
  databaseUrl: "ignored-tests-use-injected-prisma",
  jwtSecret: "test-secret",
  inviteCode,
  adminUsername: "admin",
  port: 0,
  nodeEnv: "test",
};

describe("POST /api/auth/register", () => {
  let app: FastifyInstance;
  const prisma = getTestPrisma();

  beforeEach(async () => {
    await resetDb(prisma);
    if (app) await app.close();
    app = await createApp({ config, prisma });
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it("creates the user and returns a token + user envelope on the happy path", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "hunter2hunter2", inviteCode },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBe(0);
    expect(body.data.token).toEqual(expect.any(String));
    expect(body.data.user).toMatchObject({
      username: "alice",
      isOperator: false,
    });
    expect(body.data.user.id).toEqual(expect.any(Number));

    const stored = await prisma.user.findUnique({ where: { username: "alice" } });
    expect(stored).not.toBeNull();
    expect(stored!.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it("rejects an unknown invite code with 400 and creates no user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: "bob",
        password: "hunter2hunter2",
        inviteCode: "wrong-code",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 400,
      message: "invalid_invite_code",
    });
    const stored = await prisma.user.findUnique({ where: { username: "bob" } });
    expect(stored).toBeNull();
  });

  it("rejects a username that is already taken with 409", async () => {
    const payload = {
      username: "carol",
      password: "hunter2hunter2",
      inviteCode,
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload,
    });

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      code: 409,
      message: "username_taken",
    });
  });

  it("rejects malformed input with 400 from the schema layer", async () => {
    const tooShortPassword = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "dan", password: "short", inviteCode },
    });
    expect(tooShortPassword.statusCode).toBe(400);

    const tooShortUsername = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "ab", password: "hunter2hunter2", inviteCode },
    });
    expect(tooShortUsername.statusCode).toBe(400);

    const missingInvite = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "evan", password: "hunter2hunter2" },
    });
    expect(missingInvite.statusCode).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  let app: FastifyInstance;
  const prisma = getTestPrisma();

  beforeEach(async () => {
    await resetDb(prisma);
    if (app) await app.close();
    app = await createApp({ config, prisma });

    // Register a user we can log in as.
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "hunter2hunter2", inviteCode },
    });
    expect(reg.statusCode).toBe(200);
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it("returns a fresh token + user envelope on the happy path", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "hunter2hunter2" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBe(0);
    expect(body.data.token).toEqual(expect.any(String));
    expect(body.data.user).toMatchObject({
      username: "alice",
      isOperator: false,
    });
  });

  it("returns 401 on the wrong password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "WRONG" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 401 });
  });

  it("returns 401 on an unknown username (no enumeration)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "ghost", password: "hunter2hunter2" },
    });

    expect(res.statusCode).toBe(401);
  });
});
