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
 */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  // Order matters: child tables first.
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=0");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE Friendship");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE SendKey");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE Bot");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE User");
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=1");
}
