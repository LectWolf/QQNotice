import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { BotManager } from "../bot/BotManager.js";
import type { SendKeyService } from "./SendKeyService.js";
import type { Router as RoutingRouter } from "../router/Router.js";
import type { FriendshipCache } from "../friendship/FriendshipCache.js";

const MAX_TITLE_LENGTH = 100;
const MAX_CONTENT_LENGTH = 4000;

type SendPayload = {
  key: string | null;
  title: string | null;
  content: string | null;
};

/**
 * Resolution order for the SendKey: Authorization: Bearer header → JSON
 * `key` field → query `?key=` → path `/send/:sendkey`. First non-empty wins.
 */
function resolveKey(
  req: FastifyRequest,
  body: { key?: unknown } | undefined,
): string | null {
  const auth = req.headers.authorization;
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1]!.trim();
  }
  if (body && typeof body.key === "string" && body.key.length > 0) {
    return body.key;
  }
  const query = req.query as Record<string, unknown> | undefined;
  if (query && typeof query.key === "string" && query.key.length > 0) {
    return query.key;
  }
  const params = req.params as Record<string, unknown> | undefined;
  if (
    params &&
    typeof params.sendkey === "string" &&
    params.sendkey.length > 0
  ) {
    return params.sendkey;
  }
  return null;
}

function readField(
  req: FastifyRequest,
  body: Record<string, unknown> | undefined,
  field: "title" | "content",
): string | null {
  if (body && typeof body[field] === "string") return body[field] as string;
  const query = req.query as Record<string, unknown> | undefined;
  if (query && typeof query[field] === "string") return query[field] as string;
  return null;
}

function readPayload(req: FastifyRequest): SendPayload {
  const body = (req.body ?? undefined) as Record<string, unknown> | undefined;
  return {
    key: resolveKey(req, body),
    title: readField(req, body, "title"),
    content: readField(req, body, "content"),
  };
}

/**
 * Render rule per CONTEXT.md: when title is present, the QQ message body is
 * `【{title}】\n{content}`; when absent, `{content}` verbatim.
 */
export function renderMessage(title: string | null, content: string): string {
  if (title && title.length > 0) return `【${title}】\n${content}`;
  return content;
}

export type SendRouteDeps = {
  prisma: PrismaClient;
  botManager: BotManager;
  sendKeyService: SendKeyService;
  router: RoutingRouter;
  friendshipCache: FriendshipCache;
};

/**
 * Mounts the five accepted forms of the send endpoint:
 *   GET  /send/:sendkey
 *   GET  /send
 *   POST /send/:sendkey
 *   POST /send
 *
 * All forms are normalised through one handler.
 */
export function registerSendRoutes(
  app: FastifyInstance,
  deps: SendRouteDeps,
): void {
  const handle = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const payload = readPayload(req);

    if (!payload.key) {
      reply.status(400).send({ code: 400, message: "missing_key" });
      return;
    }
    if (!payload.content || payload.content.length === 0) {
      reply.status(400).send({ code: 400, message: "missing_content" });
      return;
    }
    if (payload.content.length > MAX_CONTENT_LENGTH) {
      reply.status(400).send({ code: 400, message: "content_too_long" });
      return;
    }
    if (payload.title && payload.title.length > MAX_TITLE_LENGTH) {
      reply.status(400).send({ code: 400, message: "title_too_long" });
      return;
    }

    const auth = await deps.sendKeyService.authenticate(payload.key);
    if (!auth) {
      reply.status(401).send({ code: 401, message: "invalid_send_key" });
      return;
    }
    if (auth.state !== "active") {
      reply.status(401).send({ code: 401, message: "send_key_disabled" });
      return;
    }

    const decision = deps.router.decideOnSend(
      { boundBotId: auth.botId, targetQq: auth.targetQq },
      {
        bots: deps.botManager.listStatus().map((s) => ({
          id: s.botId,
          alive: s.alive,
        })),
        cache: deps.friendshipCache,
      },
    );

    if (decision.kind === "fail") {
      reply
        .status(decision.httpCode)
        .send({ code: decision.httpCode, message: decision.reason });
      return;
    }

    const message = renderMessage(payload.title, payload.content);
    const targetBotId =
      decision.kind === "send" ? decision.botId : decision.newBotId;

    // Persist the re-bind BEFORE attempting the send so a transient failure
    // here doesn't leave us routing through a dead bot on the next request.
    if (decision.kind === "rebindAndSend") {
      await deps.prisma.sendKey.update({
        where: { id: auth.id },
        data: { botId: decision.newBotId },
      });
    }

    try {
      await deps.botManager.request(targetBotId, "send_private_msg", {
        user_id: auth.targetQq,
        message,
      });
    } catch (err) {
      // Send-time failure recovery (CONTEXT.md "Bound Bot is alive but the
      // actual send_private_msg call fails"): drop the friendship from the
      // cache, mark the bot dead, and re-route once. Maximum one retry per
      // inbound request.
      deps.friendshipCache.drop(targetBotId, auth.targetQq);
      deps.botManager.markSendFailure(targetBotId);

      const retryDecision = deps.router.decideOnSend(
        { boundBotId: targetBotId, targetQq: auth.targetQq },
        {
          bots: deps.botManager.listStatus().map((s) => ({
            id: s.botId,
            alive: s.alive,
          })),
          cache: deps.friendshipCache,
        },
      );

      if (retryDecision.kind === "fail") {
        reply
          .status(retryDecision.httpCode)
          .send({
            code: retryDecision.httpCode,
            message: retryDecision.reason,
          });
        return;
      }

      const retryBotId =
        retryDecision.kind === "send"
          ? retryDecision.botId
          : retryDecision.newBotId;

      if (retryDecision.kind === "rebindAndSend") {
        await deps.prisma.sendKey.update({
          where: { id: auth.id },
          data: { botId: retryDecision.newBotId },
        });
      }

      try {
        await deps.botManager.request(retryBotId, "send_private_msg", {
          user_id: auth.targetQq,
          message,
        });
      } catch {
        reply.status(502).send({ code: 502, message: "send_failed" });
        return;
      }
    }

    // (lastUsedAt → slice 0007 admin work.)
    reply.send({ code: 0, message: "ok" });
  };

  app.get<{ Params: { sendkey: string } }>(
    "/send/:sendkey",
    async (req, reply) => handle(req, reply),
  );
  app.get("/send", async (req, reply) => handle(req, reply));

  const postSchema = {
    body: {
      anyOf: [
        { type: "object" },
        { type: "string" },
        { type: "null" },
      ],
    },
  };
  app.post<{ Params: { sendkey: string } }>(
    "/send/:sendkey",
    { schema: postSchema },
    async (req, reply) => handle(req, reply),
  );
  app.post("/send", { schema: postSchema }, async (req, reply) =>
    handle(req, reply),
  );
}
