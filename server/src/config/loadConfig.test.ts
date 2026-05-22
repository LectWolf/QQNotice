import { describe, expect, it } from "vitest";
import { loadConfig } from "./loadConfig.js";

const validEnv = {
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "qqnotice",
  DB_USER: "root",
  DB_PASSWORD: "cloud123",
  JWT_SECRET: "shhh",
  INVITE_CODE: "let-me-in",
  ADMIN_USERNAME: "lectwolf",
};

describe("loadConfig", () => {
  for (const key of [
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "JWT_SECRET",
    "INVITE_CODE",
    "ADMIN_USERNAME",
  ] as const) {
    it(`throws with the missing key name when ${key} is absent`, () => {
      const env = { ...validEnv, [key]: undefined };
      expect(() => loadConfig(env)).toThrow(new RegExp(key));
    });

    it(`throws when ${key} is set to an empty string`, () => {
      const env = { ...validEnv, [key]: "   " };
      expect(() => loadConfig(env)).toThrow(new RegExp(key));
    });
  }

  it("composes a Prisma-compatible MySQL URL from the parts", () => {
    const cfg = loadConfig({ ...validEnv });
    expect(cfg.databaseUrl).toBe(
      "mysql://root:cloud123@127.0.0.1:3306/qqnotice",
    );
  });

  it("URL-encodes special characters in user and password", () => {
    const cfg = loadConfig({
      ...validEnv,
      DB_USER: "weird user",
      DB_PASSWORD: "p@ss:word/with#chars",
    });
    expect(cfg.databaseUrl).toBe(
      "mysql://weird%20user:p%40ss%3Aword%2Fwith%23chars@127.0.0.1:3306/qqnotice",
    );
  });

  it("returns a structured config when all required vars are present", () => {
    expect(loadConfig({ ...validEnv })).toEqual({
      databaseUrl: "mysql://root:cloud123@127.0.0.1:3306/qqnotice",
      jwtSecret: validEnv.JWT_SECRET,
      inviteCode: validEnv.INVITE_CODE,
      adminUsername: validEnv.ADMIN_USERNAME,
      port: 3000,
      nodeEnv: "development",
    });
  });

  it("rejects a non-numeric DB_PORT", () => {
    expect(() => loadConfig({ ...validEnv, DB_PORT: "abc" })).toThrow(/DB_PORT/);
  });

  it("uses PORT from the env when present and valid", () => {
    expect(loadConfig({ ...validEnv, PORT: "4001" }).port).toBe(4001);
  });

  it("rejects invalid PORT values", () => {
    expect(() => loadConfig({ ...validEnv, PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ ...validEnv, PORT: "-1" })).toThrow(/PORT/);
  });

  it("propagates NODE_ENV", () => {
    expect(loadConfig({ ...validEnv, NODE_ENV: "production" }).nodeEnv).toBe(
      "production",
    );
  });
});
