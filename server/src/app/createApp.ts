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
import { FriendshipCache } from "../friendship/FriendshipCache.js";
import { Router as RoutingRouter } from "../router/Router.js";
import { SendKeyService } from "../sendkey/SendKeyService.js";
import { PendingKeyCreations } from "../sendkey/PendingKeyCreations.js";
import { registerSendKeyRoutes } from "../sendkey/sendKeyRoutes.js";
import { registerSendRoutes } from "../sendkey/sendRoutes.js";
import {
  DEFAULT_RATE_LIMITS,
  registerRateLimits,
  type RateLimitConfig,
} from "./rateLimits.js";

export type AppDeps = {
  config: Config;
  prisma: PrismaClient;
  /** Optional override for tests; default starts a real BotManager. */
  botManager?: BotManager;
  /** Optional override; default empty cache. */
  friendshipCache?: FriendshipCache;
  /** Optional override; default values are the production limits. */
  rateLimits?: RateLimitConfig;
};

/**
 * Builds a Fastify instance with all routes mounted.
 * Pure factory: does not call `.listen()`.
 */
export async function createApp(deps: AppDeps): Promise<FastifyInstance> {
  const isTest = deps.config.nodeEnv === "test" || process.env.VITEST === "true";
  const app = Fastify({ logger: !isTest });

  registerRateLimits(app, deps.rateLimits ?? DEFAULT_RATE_LIMITS);

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

  const friendshipCache = deps.friendshipCache ?? new FriendshipCache();
  const router = new RoutingRouter();
  const pendingKeys = new PendingKeyCreations();

  const botManager =
    deps.botManager ??
    new BotManager({
      prisma: deps.prisma,
      clientFactory: (opts) => new OneBotClient(opts),
      friendshipCache,
      pendingKeys,
    });
  await botManager.start();
  app.addHook("onClose", async () => {
    await botManager.stop();
  });

  const sendKeyService = new SendKeyService({
    prisma: deps.prisma,
    botManager,
    friendshipCache,
    router,
    pendingKeys,
    bcryptCost: deps.config.nodeEnv === "test" ? 4 : undefined,
  });

  registerBotAdminRoutes(app, { prisma: deps.prisma, manager: botManager });
  registerSendKeyRoutes(app, sendKeyService);
  registerSendRoutes(app, {
    botManager,
    sendKeyService,
    router,
    friendshipCache,
  });

  if (deps.config.nodeEnv !== "production") {
    registerProbeRoute(app);
  }

  return app;
}
