/**
 * Reads runtime configuration from a process.env-shaped object.
 * Pure: no side-effects, no `process` access. The entrypoint is responsible
 * for calling `dotenv.config()` and passing `process.env` in.
 *
 * The MySQL connection is configured with discrete env vars
 * (DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD) — friendlier than
 * a hand-crafted DATABASE_URL. We compose a Prisma-compatible URL
 * internally and expose it as `databaseUrl`.
 */
export type Config = {
  databaseUrl: string;
  jwtSecret: string;
  inviteCode: string;
  adminUsername: string;
  port: number;
  nodeEnv: string;
};

const REQUIRED_KEYS = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "JWT_SECRET",
  "INVITE_CODE",
  "ADMIN_USERNAME",
] as const;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  for (const key of REQUIRED_KEYS) {
    if (!env[key] || env[key]!.trim() === "") {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const dbPortRaw = env.DB_PORT!;
  const dbPort = Number(dbPortRaw);
  if (!Number.isFinite(dbPort) || dbPort <= 0) {
    throw new Error(`Invalid DB_PORT: ${dbPortRaw}`);
  }

  const portRaw = env.PORT;
  const port = portRaw ? Number(portRaw) : 3000;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${portRaw}`);
  }

  const databaseUrl =
    `mysql://${encodeURIComponent(env.DB_USER!)}:${encodeURIComponent(env.DB_PASSWORD!)}` +
    `@${env.DB_HOST!}:${dbPort}/${env.DB_NAME!}`;

  return {
    databaseUrl,
    jwtSecret: env.JWT_SECRET!,
    inviteCode: env.INVITE_CODE!,
    adminUsername: env.ADMIN_USERNAME!,
    port,
    nodeEnv: env.NODE_ENV ?? "development",
  };
}

/**
 * Convenience: extract just the Prisma `DATABASE_URL` from the same env
 * inputs `loadConfig` consumes. Used by `scripts/with-db-url.mjs` so the
 * Prisma CLI sees a `DATABASE_URL` derived from the user-friendly parts.
 */
export function databaseUrlFromEnv(env: NodeJS.ProcessEnv): string {
  return loadConfig(env).databaseUrl;
}
