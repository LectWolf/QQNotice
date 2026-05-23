import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app/createApp.js";
import { loadConfig } from "./config/loadConfig.js";
import { bootstrapOperator } from "./auth/bootstrapOperator.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  // Make the composed URL available to anything reading process.env.DATABASE_URL
  // directly — Prisma Client is the main consumer.
  process.env.DATABASE_URL = config.databaseUrl;

  const prisma = new PrismaClient();
  await prisma.$connect();

  // Promote the configured admin user to operator if they exist already.
  // No-op when they have not registered yet — re-runs on next start.
  const promoted = await bootstrapOperator(prisma, config.adminUsername);

  const app = await createApp({ config, prisma });

  if (promoted) {
    app.log.info(`Promoted ${config.adminUsername} to operator`);
  }

  // Reconcile every SendKey against the current snapshot. Bots take a few
  // seconds to connect → heartbeat → pull friend list, and the reconcile
  // logic disables any key whose bound bot isn't currently alive-and-friendly.
  // To avoid mass-disabling on every restart, wait until at least one bot
  // is alive (with a generous cap), then run reconcile. If the cap elapses
  // and still no bot is alive, the reconcile itself short-circuits with
  // `skipped: true` rather than disabling everything.
  void waitForFirstAliveBot(app, 60_000)
    .then(() => {
      const service = (app as unknown as {
        sendKeyService?: import("./sendkey/SendKeyService.js").SendKeyService;
      }).sendKeyService;
      if (!service) return;
      return service.reconcileOnStartup().then((summary) => {
        app.log.info(summary, "startup reconcile complete");
      });
    })
    .catch((err) => {
      app.log.error({ err }, "startup reconcile failed");
    });

  // Serve the built React app from `web/dist` under the root path whenever
  // it's actually present on disk. Was previously gated on NODE_ENV =
  // production, but that's a footgun: deployers who forget to set it land
  // on a 404 at `/`. The presence of `web/dist/index.html` is the real
  // signal that the build artifact is co-located with the server. API
  // routes are scoped to `/api/*` and `/send*` so there is no overlap.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(here, "../../web/dist");
  if (existsSync(path.join(webDist, "index.html"))) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      wildcard: false,
    });

    // SPA fallback: any unmatched GET that does NOT start with /api or /send
    // returns index.html so client-side routing works.
    app.setNotFoundHandler((req, reply) => {
      if (
        req.method === "GET" &&
        !req.url.startsWith("/api") &&
        !req.url.startsWith("/send")
      ) {
        return reply.sendFile("index.html");
      }
      return reply.status(404).send({ code: 404, message: "not found" });
    });
    app.log.info({ webDist }, "serving web bundle from disk");
  } else {
    app.log.warn(
      { webDist },
      "web/dist not found — running API-only. Build the web bundle and re-deploy if you expected the UI here.",
    );
  }

  await app.listen({ host: "0.0.0.0", port: config.port });
  app.log.info(`QQNotice listening on :${config.port} (${config.nodeEnv})`);

  // Graceful shutdown
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      app.log.info(`Received ${sig}, shutting down`);
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

/**
 * Polls the BotManager status until at least one bot is `alive` (open WS +
 * fresh heartbeat), or `maxWaitMs` elapses. Resolves either way; the caller
 * decides what to do next.
 */
async function waitForFirstAliveBot(
  app: import("fastify").FastifyInstance,
  maxWaitMs: number,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  const manager = (app as unknown as {
    botManager?: import("./bot/BotManager.js").BotManager;
  }).botManager;

  while (Date.now() < deadline) {
    const status = manager?.listStatus() ?? [];
    if (status.some((s) => s.alive)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
