import bcrypt from "bcryptjs";

/**
 * Bcrypt-based password hashing. Pure functions: no DB, no env access.
 *
 * Cost is configurable so tests can use a low cost (4) for speed; production
 * defaults to 10. Anything below 4 is rejected by bcryptjs.
 */
export const DEFAULT_COST = 10;

export async function hashPassword(
  plaintext: string,
  cost: number = DEFAULT_COST,
): Promise<string> {
  return bcrypt.hash(plaintext, cost);
}

export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
