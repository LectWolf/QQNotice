import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");

/**
 * Vitest globalSetup hook. Runs once before any test file.
 *
 * Composes the test DATABASE_URL from DB_TEST_* / DB_* env vars (so users
 * can choose to reuse their existing dev creds against a separate database
 * named `qqnotice_test`), then applies Prisma migrations against it. Tests
 * import `getTestPrisma()` from `test/db.ts` to get a client pointed at this
 * URL.
 */
export async function setup(): Promise<void> {
  const env = process.env;

  const testDbName = env.DB_TEST_NAME ?? "qqnotice_test";
  const host = env.DB_HOST ?? "127.0.0.1";
  const port = env.DB_PORT ?? "3306";
  const user = env.DB_USER ?? "root";
  const password = env.DB_PASSWORD ?? "cloud123";

  const url =
    `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
    `@${host}:${port}/${testDbName}`;

  process.env.TEST_DATABASE_URL = url;

  // Apply migrations to the test DB. We use `migrate deploy` because it is
  // idempotent and does not prompt; if migrations folder is empty for some
  // reason, skip silently.
  const migrationsDir = path.join(serverRoot, "prisma", "migrations");
  if (!existsSync(migrationsDir)) return;

  execSync("pnpm exec prisma migrate deploy", {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}

export async function teardown(): Promise<void> {
  /* no-op for now */
}
