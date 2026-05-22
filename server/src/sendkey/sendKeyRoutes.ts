import type { FastifyInstance } from "fastify";
import { requireAuth, UnauthenticatedError } from "../auth/authPlugin.js";
import {
  PendingHandshakeError,
  SendKeyError,
  type SendKeyService,
} from "./SendKeyService.js";

export function registerSendKeyRoutes(
  app: FastifyInstance,
  service: SendKeyService,
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
}
