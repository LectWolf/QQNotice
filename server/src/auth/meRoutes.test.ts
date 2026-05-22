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

describe("/api/me", () => {
  let app: FastifyInstance;
  const prisma = getTestPrisma();
  let token: string;

  beforeEach(async () => {
    await resetDb(prisma);
    if (app) await app.close();
    app = await createApp({ config, prisma });

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

  it("GET /api/me returns the user when given a valid token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      username: "alice",
      isOperator: false,
    });
  });

  it("GET /api/me returns 401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/me returns 401 with a malformed/forged token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: "Bearer garbage" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/me/password rotates the password successfully", async () => {
    const change = await app.inject({
      method: "POST",
      url: "/api/me/password",
      headers: { authorization: `Bearer ${token}` },
      payload: { oldPassword: "hunter2hunter2", newPassword: "newpassword123" },
    });
    expect(change.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "hunter2hunter2" },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "newpassword123" },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it("POST /api/me/password rejects on the wrong oldPassword", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/password",
      headers: { authorization: `Bearer ${token}` },
      payload: { oldPassword: "WRONG", newPassword: "newpassword123" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/me/password requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/password",
      payload: { oldPassword: "x", newPassword: "newpassword123" },
    });
    expect(res.statusCode).toBe(401);
  });
});
