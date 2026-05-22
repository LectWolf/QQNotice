import type { FastifyInstance } from "fastify";
import { requireAuth, UnauthenticatedError } from "./authPlugin.js";
import { AuthError, type AuthService } from "./AuthService.js";

export function registerMeRoutes(
  app: FastifyInstance,
  service: AuthService,
): void {
  app.get("/api/me", async (req, reply) => {
    try {
      const user = requireAuth(req);
      return reply.send({ code: 0, message: "ok", data: user });
    } catch (err) {
      if (err instanceof UnauthenticatedError) {
        return reply.status(401).send({ code: 401, message: "unauthenticated" });
      }
      throw err;
    }
  });

  app.post<{ Body: { oldPassword?: string; newPassword?: string } }>(
    "/api/me/password",
    {
      schema: {
        body: {
          type: "object",
          required: ["oldPassword", "newPassword"],
          properties: {
            oldPassword: { type: "string", minLength: 1 },
            newPassword: { type: "string", minLength: 8, maxLength: 72 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const user = requireAuth(req);
        await service.changePassword(
          user.id,
          req.body.oldPassword!,
          req.body.newPassword!,
        );
        return reply.send({ code: 0, message: "ok" });
      } catch (err) {
        if (err instanceof UnauthenticatedError) {
          return reply
            .status(401)
            .send({ code: 401, message: "unauthenticated" });
        }
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
