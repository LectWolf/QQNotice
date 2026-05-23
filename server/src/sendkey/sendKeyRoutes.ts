import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { requireAuth, UnauthenticatedError } from "../auth/authPlugin.js";
import {
  PendingHandshakeError,
  SendKeyError,
  type SendKeyService,
} from "./SendKeyService.js";

/**
 * Stream an attachment row back to the caller as a download. RFC 5987
 * filename* encoding so non-ASCII filenames round-trip correctly.
 */
function sendAttachment(
  reply: FastifyReply,
  att: {
    fileName: string;
    mimeType: string | null;
    byteCount: number;
    data: Buffer;
  },
): FastifyReply {
  const safeAscii = att.fileName.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(att.fileName);
  return reply
    .header("Content-Type", att.mimeType || "application/octet-stream")
    .header("Content-Length", String(att.byteCount))
    .header(
      "Content-Disposition",
      `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`,
    )
    .send(att.data);
}

export function registerSendKeyRoutes(
  app: FastifyInstance,
  service: SendKeyService,
  prisma: PrismaClient,
): void {
  app.get("/api/me/keys", async (req, reply) => {
    try {
      const user = requireAuth(req);
      const list = await service.listForUser(user.id);
      return reply.send({ code: 0, message: "ok", data: list });
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
    Body: { name?: string; targetQq?: number };
  }>(
    "/api/me/keys",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "targetQq"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 64 },
            targetQq: { type: "integer", minimum: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const user = requireAuth(req);
        const result = await service.create({
          userId: user.id,
          name: req.body.name!,
          targetQq: req.body.targetQq!,
        });
        return reply.send({ code: 0, message: "ok", data: result });
      } catch (err) {
        if (err instanceof UnauthenticatedError) {
          return reply
            .status(401)
            .send({ code: 401, message: "unauthenticated" });
        }
        if (err instanceof PendingHandshakeError) {
          return reply.status(202).send({
            code: 202,
            message: "needs_handshake",
            data: {
              hostBotQq: err.hostBotQq,
              expiresAt: err.expiresAt,
            },
          });
        }
        if (err instanceof SendKeyError) {
          return reply
            .status(err.httpCode)
            .send({ code: err.httpCode, message: err.reason });
        }
        throw err;
      }
    },
  );

  app.post<{ Body: { targetQq?: number } }>(
    "/api/me/keys/finalize",
    {
      schema: {
        body: {
          type: "object",
          required: ["targetQq"],
          properties: {
            targetQq: { type: "integer", minimum: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const user = requireAuth(req);
        const result = await service.finalize(user.id, req.body.targetQq!);
        return reply.send({ code: 0, message: "ok", data: result });
      } catch (err) {
        if (err instanceof UnauthenticatedError) {
          return reply
            .status(401)
            .send({ code: 401, message: "unauthenticated" });
        }
        if (err instanceof PendingHandshakeError) {
          return reply.status(202).send({
            code: 202,
            message: "needs_handshake",
            data: {
              hostBotQq: err.hostBotQq,
              expiresAt: err.expiresAt,
            },
          });
        }
        if (err instanceof SendKeyError) {
          return reply
            .status(err.httpCode)
            .send({ code: err.httpCode, message: err.reason });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/me/keys/:id",
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
        const user = requireAuth(req);
        await service.delete(user.id, Number(req.params.id));
        return reply.send({ code: 0, message: "ok" });
      } catch (err) {
        if (err instanceof UnauthenticatedError) {
          return reply
            .status(401)
            .send({ code: 401, message: "unauthenticated" });
        }
        if (err instanceof SendKeyError) {
          return reply
            .status(err.httpCode)
            .send({ code: err.httpCode, message: err.reason });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { content?: string } }>(
    "/api/me/keys/:id/test",
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
            content: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const user = requireAuth(req);
        const content =
          req.body.content && req.body.content.trim().length > 0
            ? req.body.content
            : "这是来自 QQNotice 的测试消息";
        await service.sendTest(user.id, Number(req.params.id), content);
        return reply.send({ code: 0, message: "ok" });
      } catch (err) {
        if (err instanceof UnauthenticatedError) {
          return reply
            .status(401)
            .send({ code: 401, message: "unauthenticated" });
        }
        if (err instanceof SendKeyError) {
          return reply
            .status(err.httpCode)
            .send({ code: err.httpCode, message: err.reason });
        }
        throw err;
      }
    },
  );

  // Per-key send log: returns the most recent N entries for the calling
  // user's key. Used by the "查看日志" drawer in the SendKey table.
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/api/me/keys/:id/logs",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", pattern: "^[0-9]+$" } },
        },
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
        const user = requireAuth(req);
        const keyId = Number(req.params.id);
        // Confirm ownership before returning logs.
        const key = await prisma.sendKey.findFirst({
          where: { id: keyId, userId: user.id },
          select: { id: true },
        });
        if (!key) {
          return reply
            .status(404)
            .send({ code: 404, message: "send_key_not_found" });
        }
        const limit = Math.min(
          200,
          Math.max(1, Number(req.query.limit ?? 50)),
        );
        const rows = await prisma.sendLog.findMany({
          where: { sendKeyId: keyId },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
        return reply.send({
          code: 0,
          message: "ok",
          data: rows.map((r) => ({
            id: r.id,
            sendKeyId: r.sendKeyId,
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
        if (err instanceof UnauthenticatedError) {
          return reply
            .status(401)
            .send({ code: 401, message: "unauthenticated" });
        }
        throw err;
      }
    },
  );

  // All-keys send log for the calling user. Lets the user audit usage
  // across every key from one place.
  app.get<{ Querystring: { limit?: string } }>(
    "/api/me/logs",
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
        const user = requireAuth(req);
        const limit = Math.min(
          500,
          Math.max(1, Number(req.query.limit ?? 100)),
        );
        const rows = await prisma.sendLog.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          take: limit,
          include: { sendKey: { select: { name: true } } },
        });
        return reply.send({
          code: 0,
          message: "ok",
          data: rows.map((r) => ({
            id: r.id,
            sendKeyId: r.sendKeyId,
            keyName: r.sendKey.name,
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
        if (err instanceof UnauthenticatedError) {
          return reply
            .status(401)
            .send({ code: 401, message: "unauthenticated" });
        }
        throw err;
      }
    },
  );

  // Download an attachment for one of the caller's logs. 404 when the log
  // doesn't exist, isn't theirs, or has no attached file.
  app.get<{ Params: { id: string } }>(
    "/api/me/logs/:id/file",
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
        const user = requireAuth(req);
        const log = await prisma.sendLog.findFirst({
          where: { id: Number(req.params.id), userId: user.id },
          include: { attachment: true },
        });
        if (!log || !log.attachment) {
          return reply
            .status(404)
            .send({ code: 404, message: "attachment_not_found" });
        }
        return sendAttachment(reply, log.attachment);
      } catch (err) {
        if (err instanceof UnauthenticatedError) {
          return reply
            .status(401)
            .send({ code: 401, message: "unauthenticated" });
        }
        throw err;
      }
    },
  );
}
