import "dotenv/config";
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

  // Reconcile every SendKey against the current snapshot. Bots may not yet
  // have pulled their friend lists at this point — give them a brief grace
  // window so reconcile sees a populated cache. This is best-effort: if the
  // grace window is too short, an early send will trigger the same routing
  // logic dynamically, and the next reconcile (e.g. on next restart) catches
  // up.
  setTimeout(() => {
    const service = (app as unknown as {
      sendKeyService?: import("./sendkey/SendKeyService.js").SendKeyService;
    }).sendKeyService;
    if (!service) return;
    void service
      .reconcileOnStartup()
      .then((summary) => {
        app.log.info(summary, "startup reconcile complete");
      })
      .catch((err) => {
        app.log.error({ err }, "startup reconcile failed");
      });
  }, 5000);

  // In production, also serve the built React app from `web/dist` under the
  // root path. API routes are scoped to `/api/*` and `/send*` so there is no
  // overlap.
  if (config.nodeEnv === "production") {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const webDist = path.resolve(here, "../../web/dist");
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
