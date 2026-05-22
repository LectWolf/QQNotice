import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { requireAuth, UnauthenticatedError } from "../auth/authPlugin.js";

class ForbiddenError extends Error {
  constructor() {
    super("forbidden");
    this.name = "ForbiddenError";
  }
}

class CannotDeleteSelfOrAdminError extends Error {
  constructor() {
    super("cannot_delete_self_or_admin");
    this.name = "CannotDeleteSelfOrAdminError";
  }
}

function requireOperator(req: FastifyRequest): {
  id: number;
  username: string;
  isOperator: boolean;
} {
  const user = requireAuth(req);
  if (!user.isOperator) throw new ForbiddenError();
  return user;
}

function handleErr(reply: FastifyReply, err: unknown): boolean {
  if (err instanceof UnauthenticatedError) {
    reply.status(401).send({ code: 401, message: "unauthenticated" });
    return true;
  }
  if (err instanceof ForbiddenError) {
    reply.status(403).send({ code: 403, message: "forbidden" });
    return true;
  }
  if (err instanceof CannotDeleteSelfOrAdminError) {
    reply.status(400).send({ code: 400, message: err.message });
    return true;
  }
  return false;
}

export function registerUserAdminRoutes(
  app: FastifyInstance,
  deps: { prisma: PrismaClient; adminUsername: string },
): void {
  app.get("/api/admin/users", async (req, reply) => {
    try {
      requireOperator(req);
      const users = await deps.prisma.user.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          username: true,
          isOperator: true,
          createdAt: true,
          _count: { select: { sendKeys: true } },
        },
      });
      return reply.send({
        code: 0,
        message: "ok",
        data: users.map((u) => ({
          id: u.id,
          username: u.username,
          isOperator: u.isOperator,
          createdAt: u.createdAt.toISOString(),
          sendKeyCount: u._count.sendKeys,
        })),
      });
    } catch (err) {
      if (handleErr(reply, err)) return;
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>(
    "/api/admin/users/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", pattern: "^[0-9]+$" } },
        },
      },
    },
    async (req, reply) => {
      try {
        const op = requireOperator(req);
        const id = Number(req.params.id);
        if (id === op.id) throw new CannotDeleteSelfOrAdminError();
        const target = await deps.prisma.user.findUnique({ where: { id } });
        if (!target) {
          return reply
            .status(404)
            .send({ code: 404, message: "user_not_found" });
        }
        if (target.username === deps.adminUsername) {
          throw new CannotDeleteSelfOrAdminError();
        }
        try {
          await deps.prisma.user.delete({ where: { id } });
          return reply.send({ code: 0, message: "ok" });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2025"
          ) {
            return reply
              .status(404)
              .send({ code: 404, message: "user_not_found" });
          }
          throw err;
        }
      } catch (err) {
        if (handleErr(reply, err)) return;
        throw err;
      }
    },
  );
}
