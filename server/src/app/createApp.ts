import Fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "../config/loadConfig.js";
import { registerProbeRoute } from "./probeRoute.js";
import { registerAuthRoutes } from "../auth/authRoutes.js";
import { registerMeRoutes } from "../auth/meRoutes.js";
import { registerAuthPlugin } from "../auth/authPlugin.js";
import { AuthService } from "../auth/AuthService.js";
import { BotManager } from "../bot/BotManager.js";
import { OneBotClient } from "../onebot/OneBotClient.js";
import { registerBotAdminRoutes } from "../admin/botRoutes.js";

export type AppDeps = {
  config: Config;
  prisma: PrismaClient;
  /** Optional override for tests; default starts a real BotManager. */
  botManager?: BotManager;
};

/**
 * Builds a Fastify instance with all routes mounted.
 * Pure factory: does not call `.listen()`.
 */
export async function createApp(deps: AppDeps): Promise<FastifyInstance> {
  const isTest = deps.config.nodeEnv === "test" || process.env.VITEST === "true";
  const app = Fastify({ logger: !isTest });

  app.get("/api/ping", async () => ({ code: 0, message: "ok" }));

  registerAuthPlugin(app, {
    prisma: deps.prisma,
    jwtSecret: deps.config.jwtSecret,
  });

  const authService = new AuthService({
    prisma: deps.prisma,
    jwtSecret: deps.config.jwtSecret,
    inviteCode: deps.config.inviteCode,
    adminUsername: deps.config.adminUsername,
    bcryptCost: deps.config.nodeEnv === "test" ? 4 : undefined,
  });
  registerAuthRoutes(app, authService);
  registerMeRoutes(app, authService);

  const botManager =
    deps.botManager ??
    new BotManager({
      prisma: deps.prisma,
      clientFactory: (opts) => new OneBotClient(opts),
    });
  await botManager.start();
  app.addHook("onClose", async () => {
    await botManager.stop();
  });

  registerBotAdminRoutes(app, { prisma: deps.prisma, manager: botManager });

  if (deps.config.nodeEnv !== "production") {
    registerProbeRoute(app);
  }

  return app;
}
