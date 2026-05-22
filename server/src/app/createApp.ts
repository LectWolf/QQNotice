import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "../config/loadConfig.js";
import { registerProbeRoute } from "./probeRoute.js";

export type AppDeps = {
  config: Config;
};

/**
 * Builds a Fastify instance with all routes mounted.
 * Pure factory: does not call `.listen()`.
 */
export async function createApp(deps: AppDeps): Promise<FastifyInstance> {
  const isTest = deps.config.nodeEnv === "test" || process.env.VITEST === "true";
  const app = Fastify({ logger: !isTest });

  app.get("/api/ping", async () => ({ code: 0, message: "ok" }));

  if (deps.config.nodeEnv !== "production") {
    registerProbeRoute(app);
  }

  return app;
}
