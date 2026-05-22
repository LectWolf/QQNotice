import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { InvalidTokenError, verifyToken } from "./jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    user: { id: number; username: string; isOperator: boolean } | null;
  }
}

/**
 * Decorates `request.user` with the authenticated User (or null) by
 * inspecting the `Authorization: Bearer <jwt>` header. Routes that need
 * auth call `requireAuth(req, reply)` themselves.
 */
export function registerAuthPlugin(
  app: FastifyInstance,
  deps: { prisma: PrismaClient; jwtSecret: string },
): void {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (req) => {
    const auth = req.headers.authorization;
    if (!auth) return;
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return;

    let payload: { sub: number; isOperator: boolean };
    try {
      payload = verifyToken(m[1]!.trim(), deps.jwtSecret);
    } catch (err) {
      if (err instanceof InvalidTokenError) return; // leave request unauthenticated
      throw err;
    }

    const user = await deps.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) return;

    req.user = {
      id: user.id,
      username: user.username,
      isOperator: user.isOperator,
    };
  });
}

export function requireAuth(
  req: FastifyRequest,
): { id: number; username: string; isOperator: boolean } {
  if (!req.user) {
    throw new UnauthenticatedError();
  }
  return req.user;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("unauthenticated");
    this.name = "UnauthenticatedError";
  }
}
