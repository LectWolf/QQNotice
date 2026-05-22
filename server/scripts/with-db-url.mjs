#!/usr/bin/env node
/**
 * Wraps a child command after deriving DATABASE_URL from the discrete
 * DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD vars in `.env`.
 *
 * Used to invoke the Prisma CLI: Prisma's `datasource db { url = env(...) }`
 * must be a single string, but our public env contract uses parts.
 *
 * Usage:  node scripts/with-db-url.mjs prisma migrate deploy
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, "..", ".env");

if (existsSync(envPath)) {
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const required = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const enc = encodeURIComponent;
process.env.DATABASE_URL = `mysql://${enc(process.env.DB_USER)}:${enc(
  process.env.DB_PASSWORD,
)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

const [, , cmd, ...args] = process.argv;
if (!cmd) {
  console.error("usage: with-db-url.mjs <command> [args...]");
  process.exit(1);
}

const child = spawn(cmd, args, { stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
