import { PrismaClient } from "@prisma/client";

let cached: PrismaClient | null = null;

/**
 * Returns a Prisma client pointed at the test database. The URL is
 * resolved from `process.env.TEST_DATABASE_URL` which the vitest global
 * setup populates.
 *
 * Tests are responsible for cleaning relevant tables in `beforeEach` so
 * runs are isolated.
 */
export function getTestPrisma(): PrismaClient {
  if (cached) return cached;
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Did vitest globalSetup run?",
    );
  }
  cached = new PrismaClient({ datasources: { db: { url } } });
  return cached;
}

/**
 * Truncates every table the auth + send-key flows touch. Cheaper than
 * `prisma migrate reset` for per-test isolation.
 *
 * Wrapped in a transaction so the FOREIGN_KEY_CHECKS toggle stays scoped
 * to the same MySQL connection across all five statements (otherwise
 * Prisma may pick a different connection from the pool between calls and
 * the truncates fail with FK errors).
 */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=0"),
    prisma.$executeRawUnsafe("TRUNCATE TABLE Friendship"),
    prisma.$executeRawUnsafe("TRUNCATE TABLE SendKey"),
    prisma.$executeRawUnsafe("TRUNCATE TABLE Bot"),
    prisma.$executeRawUnsafe("TRUNCATE TABLE User"),
    prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=1"),
  ]);
}
