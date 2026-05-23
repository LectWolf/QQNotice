#!/usr/bin/env node
/**
 * One-shot maintenance script: re-enable any SendKeys that were previously
 * marked `disabled` by the buggy startup-reconcile race (now fixed). Safe
 * to re-run; the underlying behaviour is `state = active` for all rows.
 *
 * Also prints how many rows have a stored plaintext (newly-created keys do,
 * legacy ones don't — those need delete + re-create to become re-copyable).
 *
 * Reads DB_* env vars from server/.env via with-db-url.mjs convention.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, "..", ".env");

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

const enc = encodeURIComponent;
process.env.DATABASE_URL = `mysql://${enc(process.env.DB_USER)}:${enc(
  process.env.DB_PASSWORD,
)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const reactivated = await prisma.sendKey.updateMany({
  where: { state: "disabled" },
  data: { state: "active" },
});
console.log(`Reactivated ${reactivated.count} disabled SendKey row(s).`);

const total = await prisma.sendKey.count();
const withPlain = await prisma.sendKey.count({
  where: { keyPlaintext: { not: null } },
});
console.log(
  `${withPlain}/${total} SendKey rows have a stored plaintext (re-copyable).`,
);
console.log(
  total > 0 && withPlain < total
    ? `Note: ${total - withPlain} legacy row(s) without plaintext can only be re-copied by delete + re-create.`
    : "",
);
await prisma.$disconnect();
