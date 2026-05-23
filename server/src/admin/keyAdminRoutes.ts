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
          plaintext: r.keyPlaintext,
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

  // Cross-user audit log of every /send call. Operator-only.
  app.get<{ Querystring: { limit?: string } }>(
    "/api/admin/logs",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string", pattern: "^[0-9]+$" },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        requireOperator(req);
        const limit = Math.min(
          1000,
          Math.max(1, Number(req.query.limit ?? 200)),
        );
        const rows = await deps.prisma.sendLog.findMany({
          orderBy: { createdAt: "desc" },
          take: limit,
          include: {
            user: { select: { username: true } },
            sendKey: { select: { name: true } },
          },
        });
        return reply.send({
          code: 0,
          message: "ok",
          data: rows.map((r) => ({
            id: r.id,
            sendKeyId: r.sendKeyId,
            keyName: r.sendKey.name,
            userId: r.userId,
            username: r.user.username,
            botId: r.botId,
            targetQq: Number(r.targetQq),
            title: r.title,
            content: r.content,
            statusCode: r.statusCode,
            reason: r.reason,
            durationMs: r.durationMs,
            hasAttachment: r.hasAttachment,
            createdAt: r.createdAt.toISOString(),
          })),
        });
      } catch (err) {
        if (handleErr(reply, err)) return;
        throw err;
      }
    },
  );

  // Operator download of any user's attachment. Same blob the owner sees,
  // surfaced cross-user for audit.
  app.get<{ Params: { id: string } }>(
    "/api/admin/logs/:id/file",
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
        const log = await deps.prisma.sendLog.findUnique({
          where: { id: Number(req.params.id) },
          include: { attachment: true },
        });
        if (!log || !log.attachment) {
          return reply
            .status(404)
            .send({ code: 404, message: "attachment_not_found" });
        }
        const att = log.attachment;
        const safeAscii = att.fileName.replace(/[^\x20-\x7e]/g, "_");
        const encoded = encodeURIComponent(att.fileName);
        return reply
          .header(
            "Content-Type",
            att.mimeType || "application/octet-stream",
          )
          .header("Content-Length", String(att.byteCount))
          .header(
            "Content-Disposition",
            `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`,
          )
          .send(att.data);
      } catch (err) {
        if (handleErr(reply, err)) return;
        throw err;
      }
    },
  );
}
