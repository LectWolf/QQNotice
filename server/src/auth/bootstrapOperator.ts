import type { PrismaClient } from "@prisma/client";

/**
 * Idempotently ensure the user matching `adminUsername` has
 * `isOperator = true`. If no such user exists yet, do nothing — the same
 * call will succeed once that user registers and the next boot runs this
 * hook again.
 *
 * Returns `true` if a row was actually updated, `false` otherwise.
 */
export async function bootstrapOperator(
  prisma: PrismaClient,
  adminUsername: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { username: adminUsername } });
  if (!user) return false;
  if (user.isOperator) return false;
  await prisma.user.update({
    where: { id: user.id },
    data: { isOperator: true },
  });
  return true;
}
