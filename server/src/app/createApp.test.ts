import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./createApp.js";
import type { Config } from "../config/loadConfig.js";
import { getTestPrisma } from "../../test/db.js";

function configWith(overrides: Partial<Config> = {}): Config {
  return {
    databaseUrl: "ignored-tests-use-injected-prisma",
    jwtSecret: "x",
    inviteCode: "x",
    adminUsername: "admin",
    port: 0,
    nodeEnv: "test",
    ...overrides,
  };
}

describe("createApp", () => {
  let app: FastifyInstance;
  const prisma = getTestPrisma();

  afterEach(async () => {
    if (app) await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("responds to GET /api/ping with the Server酱 envelope", async () => {
    app = await createApp({ config: configWith(), prisma });

    const res = await app.inject({ method: "GET", url: "/api/ping" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ code: 0, message: "ok" });
  });

  it("mounts /api/dev/probe in non-production environments", async () => {
    app = await createApp({
      config: configWith({ nodeEnv: "development" }),
      prisma,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/dev/probe",
      payload: {}, // empty body — should be rejected with 400, NOT 404
    });

    expect(res.statusCode).not.toBe(404);
  });

  it("does NOT mount /api/dev/probe in production", async () => {
    app = await createApp({
      config: configWith({ nodeEnv: "production" }),
      prisma,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/dev/probe",
      payload: { wsUrl: "ws://x", targetQq: 1, content: "x" },
    });

    expect(res.statusCode).toBe(404);
  });
});
