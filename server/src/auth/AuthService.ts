import { Prisma, type PrismaClient } from "@prisma/client";
import { hashPassword, verifyPassword } from "./password.js";
import { signToken } from "./jwt.js";

export type AuthDeps = {
  prisma: PrismaClient;
  jwtSecret: string;
  inviteCode: string;
  /**
   * Username that should always have isOperator=true. New registrations
   * matching this name are promoted in the same transaction; useful for the
   * very first deploy where ADMIN_USERNAME registers from scratch.
   */
  adminUsername: string;
  /** Optional bcrypt cost override; tests use 4 for speed. */
  bcryptCost?: number;
};

export type RegisterInput = {
  username: string;
  password: string;
  inviteCode: string;
};

export type LoginInput = {
  username: string;
  password: string;
};

export type AuthResult = {
  token: string;
  user: { id: number; username: string; isOperator: boolean };
};

/**
 * Domain errors raised by AuthService. The HTTP layer maps these to
 * Server酱-style `{code, message}` responses.
 */
export class AuthError extends Error {
  constructor(
    public readonly httpCode: 400 | 401 | 409,
    public readonly reason: string,
  ) {
    super(reason);
    this.name = "AuthError";
  }
}

export class AuthService {
  private readonly prisma: PrismaClient;
  private readonly jwtSecret: string;
  private readonly inviteCode: string;
  private readonly adminUsername: string;
  private readonly bcryptCost: number;

  constructor(deps: AuthDeps) {
    this.prisma = deps.prisma;
    this.jwtSecret = deps.jwtSecret;
    this.inviteCode = deps.inviteCode;
    this.adminUsername = deps.adminUsername;
    this.bcryptCost = deps.bcryptCost ?? 10;
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    if (!constantTimeEquals(input.inviteCode, this.inviteCode)) {
      throw new AuthError(400, "invalid_invite_code");
    }

    const passwordHash = await hashPassword(input.password, this.bcryptCost);
    const isOperator = input.username === this.adminUsername;

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          username: input.username,
          passwordHash,
          isOperator,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new AuthError(409, "username_taken");
      }
      throw err;
    }

    return this.issueToken(user);
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { username: input.username },
    });

    if (!user) {
      // Burn time so timing does not leak whether the username exists.
      await verifyPassword(input.password, "$2a$04$" + "x".repeat(53));
      throw new AuthError(401, "invalid_credentials");
    }

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) throw new AuthError(401, "invalid_credentials");

    return this.issueToken(user);
  }

  async changePassword(
    userId: number,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AuthError(401, "unauthenticated");

    const ok = await verifyPassword(oldPassword, user.passwordHash);
    if (!ok) throw new AuthError(401, "invalid_credentials");

    const passwordHash = await hashPassword(newPassword, this.bcryptCost);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  private issueToken(user: {
    id: number;
    username: string;
    isOperator: boolean;
  }): AuthResult {
    const token = signToken(
      { sub: user.id, isOperator: user.isOperator },
      this.jwtSecret,
    );
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        isOperator: user.isOperator,
      },
    };
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
