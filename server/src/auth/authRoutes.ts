import type { FastifyInstance } from "fastify";
import { AuthError, type AuthService } from "./AuthService.js";

export function registerAuthRoutes(
  app: FastifyInstance,
  service: AuthService,
): void {
  app.post<{
    Body: { username?: string; password?: string; inviteCode?: string };
  }>(
    "/api/auth/register",
    {
      schema: {
        body: {
          type: "object",
          required: ["username", "password", "inviteCode"],
          properties: {
            username: { type: "string", minLength: 3, maxLength: 32 },
            password: { type: "string", minLength: 8, maxLength: 72 },
            inviteCode: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const result = await service.register({
          username: req.body.username!,
          password: req.body.password!,
          inviteCode: req.body.inviteCode!,
        });
        return reply.send({ code: 0, message: "ok", data: result });
      } catch (err) {
        if (err instanceof AuthError) {
          return reply
            .status(err.httpCode)
            .send({ code: err.httpCode, message: err.reason });
        }
        throw err;
      }
    },
  );

  app.post<{ Body: { username?: string; password?: string } }>(
    "/api/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string", minLength: 1 },
            password: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const result = await service.login({
          username: req.body.username!,
          password: req.body.password!,
        });
        return reply.send({ code: 0, message: "ok", data: result });
      } catch (err) {
        if (err instanceof AuthError) {
          return reply
            .status(err.httpCode)
            .send({ code: err.httpCode, message: err.reason });
        }
        throw err;
      }
    },
  );
}
