import jwt from "jsonwebtoken";

/**
 * Symmetric JWT signing and verification.
 * Pure: takes the secret as an argument; no env access.
 */
export type JwtPayload = {
  sub: number;
  isOperator: boolean;
};

export type SignOptions = {
  /** Token lifetime in seconds. Defaults to 30 days. */
  expiresInSeconds?: number;
};

const DEFAULT_LIFETIME_SECONDS = 60 * 60 * 24 * 30;

export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(`invalid token: ${reason}`);
    this.name = "InvalidTokenError";
  }
}

export function signToken(
  payload: JwtPayload,
  secret: string,
  opts: SignOptions = {},
): string {
  const expiresIn = opts.expiresInSeconds ?? DEFAULT_LIFETIME_SECONDS;
  return jwt.sign(
    { sub: payload.sub, isOperator: payload.isOperator },
    secret,
    { algorithm: "HS256", expiresIn },
  );
}

export function verifyToken(token: string, secret: string): JwtPayload {
  let decoded: jwt.JwtPayload | string;
  try {
    decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch (err) {
    throw new InvalidTokenError((err as Error).message);
  }
  if (typeof decoded !== "object" || decoded === null) {
    throw new InvalidTokenError("payload is not an object");
  }
  const sub = decoded.sub;
  const isOperator = (decoded as Record<string, unknown>).isOperator;
  if (typeof sub !== "number" || typeof isOperator !== "boolean") {
    throw new InvalidTokenError("payload missing fields");
  }
  return { sub, isOperator };
}
