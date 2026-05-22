import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { requireAuth, UnauthenticatedError } from "../auth/authPlugin.js";
import type { BotManager } from "../bot/BotManager.js";

class ForbiddenError extends Error {
  constructor() {
    super("forbidden");
    this.name = "ForbiddenError";
  }
}

function requireOperator(req: FastifyRequest): void {
  const user = requireAuth(req);
  if (!user.isOperator) throw new ForbiddenError();
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
  return false;
}

export function registerKeyAdminRoutes(
  app: FastifyInstance,
  deps: { prisma: PrismaClient; manager: BotManager },
): void {
  app.get("/api/admin/keys", async (req, reply) => {
    try {
      requireOperator(req);
      const rows = await deps.prisma.sendKey.findMany({
        orderBy: { id: "asc" },
        include: { user: { select: { username: true } } },
      });
      return reply.send({
        code: 0,
        message: "ok",
        data: rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          username: r.user.username,
          name: r.name,
          targetQq: Number(r.targetQq),
          botId: r.botId,
          state: r.state,
          prefix: r.prefix,
          createdAt: r.createdAt.toISOString(),
          lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        })),
      });
    } catch (err) {
      if (handleErr(reply, err)) return;
      throw err;
    }
  });

  app.patch<{
    Params: { id: string };
    Body: { state?: "active" | "disabled" };
  }>(
    "/api/admin/keys/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", pattern: "^[0-9]+$" } },
        },
        body: {
          type: "object",
          properties: {
            state: { type: "string", enum: ["active", "disabled"] },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        requireOperator(req);
        const id = Number(req.params.id);
        const data: Record<string, unknown> = {};
        if (req.body.state !== undefined) data.state = req.body.state;
        try {
          await deps.prisma.sendKey.update({ where: { id }, data });
          return reply.send({ code: 0, message: "ok" });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2025"
          ) {
            return reply
              .status(404)
              .send({ code: 404, message: "send_key_not_found" });
          }
          throw err;
        }
      } catch (err) {
        if (handleErr(reply, err)) return;
        throw err;
      }
    },
  );

  app.post("/api/admin/friendships/refresh", async (req, reply) => {
    try {
      requireOperator(req);
      const summary = await deps.manager.refreshAllFriendsNow();
      return reply.send({ code: 0, message: "ok", data: summary });
    } catch (err) {
      if (handleErr(reply, err)) return;
      throw err;
    }
  });
}
