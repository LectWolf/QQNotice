import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import { requireAuth, UnauthenticatedError } from "../auth/authPlugin.js";
import type { BotManager } from "../bot/BotManager.js";
import type { PrismaClient } from "@prisma/client";

class ForbiddenError extends Error {
  constructor() {
    super("forbidden");
    this.name = "ForbiddenError";
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

function handleAuthError(reply: FastifyReply, err: unknown): boolean {
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

export function registerBotAdminRoutes(
  app: FastifyInstance,
  deps: { prisma: PrismaClient; manager: BotManager },
): void {
  app.get("/api/admin/bots", async (req, reply) => {
    try {
      requireOperator(req);
      return reply.send({
        code: 0,
        message: "ok",
        data: deps.manager.listStatus(),
      });
    } catch (err) {
      if (handleAuthError(reply, err)) return;
      throw err;
    }
  });

  // Public-but-authenticated bot listing for end users. Exposes only the
  // fields a user needs to add the bot as a friend (qq, name, alive). No
  // wsUrl, no access token, no heartbeat internals.
  app.get("/api/bots", async (req, reply) => {
    try {
      requireAuth(req);
      const all = deps.manager.listStatus();
      return reply.send({
        code: 0,
        message: "ok",
        data: all
          .filter((b) => b.enabled)
          .map((b) => ({
            qq: b.qq,
            name: b.name,
            alive: b.alive,
          })),
      });
    } catch (err) {
      if (err instanceof UnauthenticatedError) {
        return reply
          .status(401)
          .send({ code: 401, message: "unauthenticated" });
      }
      throw err;
    }
  });

  app.post<{
    Body: {
      name?: string;
      qq?: number;
      wsUrl?: string;
      accessToken?: string | null;
    };
  }>(
    "/api/admin/bots",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "qq", "wsUrl"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 64 },
            qq: { type: "integer", minimum: 1 },
            wsUrl: { type: "string", minLength: 1, maxLength: 255 },
            accessToken: { type: ["string", "null"], maxLength: 255 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        requireOperator(req);
        try {
          const created = await deps.prisma.bot.create({
            data: {
              name: req.body.name!,
              qq: BigInt(req.body.qq!),
              wsUrl: req.body.wsUrl!,
              accessToken: req.body.accessToken ?? null,
            },
          });
          return reply.send({
            code: 0,
            message: "ok",
            data: { id: created.id, qq: Number(created.qq) },
          });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          ) {
            return reply.status(409).send({ code: 409, message: "qq_taken" });
          }
          throw err;
        }
      } catch (err) {
        if (handleAuthError(reply, err)) return;
        throw err;
      }
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      qq?: number;
      wsUrl?: string;
      accessToken?: string | null;
      enabled?: boolean;
    };
  }>(
    "/api/admin/bots/:id",
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
            name: { type: "string", minLength: 1, maxLength: 64 },
            qq: { type: "integer", minimum: 1 },
            wsUrl: { type: "string", minLength: 1, maxLength: 255 },
            accessToken: { type: ["string", "null"], maxLength: 255 },
            enabled: { type: "boolean" },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        requireOperator(req);
        const id = Number(req.params.id);
        const data: Record<string, unknown> = {};
        if (req.body.name !== undefined) data.name = req.body.name;
        if (req.body.qq !== undefined) data.qq = BigInt(req.body.qq);
        if (req.body.wsUrl !== undefined) data.wsUrl = req.body.wsUrl;
        if (req.body.accessToken !== undefined) {
          data.accessToken = req.body.accessToken;
        }
        if (req.body.enabled !== undefined) data.enabled = req.body.enabled;

        try {
          await deps.prisma.bot.update({ where: { id }, data });
          // Reconcile immediately so URL/token changes pick up the new
          // connection without waiting for the next 3-second tick.
          await deps.manager.reconcileNow().catch(() => {});
          return reply.send({ code: 0, message: "ok" });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError) {
            if (err.code === "P2025") {
              return reply
                .status(404)
                .send({ code: 404, message: "bot_not_found" });
            }
            if (err.code === "P2002") {
              return reply.status(409).send({ code: 409, message: "qq_taken" });
            }
          }
          throw err;
        }
      } catch (err) {
        if (handleAuthError(reply, err)) return;
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/admin/bots/:id",
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
        requireOperator(req);
        const id = Number(req.params.id);
        try {
          await deps.prisma.bot.delete({ where: { id } });
          await deps.manager.reconcileNow().catch(() => {});
          return reply.send({ code: 0, message: "ok" });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2025"
          ) {
            return reply
              .status(404)
              .send({ code: 404, message: "bot_not_found" });
          }
          throw err;
        }
      } catch (err) {
        if (handleAuthError(reply, err)) return;
        throw err;
      }
    },
  );
}
