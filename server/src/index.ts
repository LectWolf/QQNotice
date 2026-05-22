import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { createApp } from "./app/createApp.js";
import { loadConfig } from "./config/loadConfig.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  // Make the composed URL available to anything reading process.env.DATABASE_URL
  // directly — Prisma Client is the main consumer.
  process.env.DATABASE_URL = config.databaseUrl;

  const app = await createApp({ config });

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
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
