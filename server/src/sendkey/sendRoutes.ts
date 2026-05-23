import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import type { PrismaClient } from "@prisma/client";
import type { BotManager } from "../bot/BotManager.js";
import type { SendKeyService } from "./SendKeyService.js";
import type { Router as RoutingRouter } from "../router/Router.js";
import type { FriendshipCache } from "../friendship/FriendshipCache.js";

const MAX_TITLE_LENGTH = 100;
const MAX_CONTENT_LENGTH = 4000;

/**
 * Hard cap on file uploads. NapCat takes the file content as a base64
 * string in a single WS frame; 30 MB raw → ~40 MB base64 → still fits
 * comfortably in the default `ws` 100 MB frame size, and matches what
 * QQ's own private-file feature accepts. Tunable later via env if needed.
 */
const MAX_FILE_BYTES = 30 * 1024 * 1024;

/**
 * Timeout for `upload_private_file`. NapCat needs to upload the bytes to
 * Tencent's CDN before responding, so the default 3s WS request timeout
 * isn't enough. 60s is plenty for a 30 MB file on a typical link.
 */
const FILE_UPLOAD_TIMEOUT_MS = 60_000;

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
 * Append one row to the SendLog table. Best-effort: a DB hiccup must not
 * propagate back to the user's HTTP response — the message has either been
 * sent or already failed by the time we get here, and the user got their
 * reply. Errors are swallowed.
 */
/**
 * Append one row to the SendLog table. Best-effort: a DB hiccup must not
 * propagate back to the user's HTTP response — the message has either been
 * sent or already failed by the time we get here, and the user got their
 * reply. Errors are swallowed.
 *
 * Optionally accepts an `attachment` payload, written into the SendLogFile
 * sibling table so the management UI can re-download the original file.
 */
async function writeSendLog(
  prisma: PrismaClient,
  entry: {
    sendKeyId: number;
    userId: number;
    botId: number | null;
    targetQq: number;
    title: string | null;
    content: string;
    statusCode: number;
    reason: string | null;
    durationMs: number;
    attachment?: {
      fileName: string;
      mimeType: string | null;
      bytes: Buffer;
    };
  },
): Promise<void> {
  await prisma.sendLog
    .create({
      data: {
        sendKeyId: entry.sendKeyId,
        userId: entry.userId,
        botId: entry.botId,
        targetQq: BigInt(entry.targetQq),
        title: entry.title,
        content: entry.content,
        statusCode: entry.statusCode,
        reason: entry.reason,
        durationMs: entry.durationMs,
        hasAttachment: !!entry.attachment,
        ...(entry.attachment
          ? {
              attachment: {
                create: {
                  fileName: entry.attachment.fileName,
                  mimeType: entry.attachment.mimeType,
                  byteCount: entry.attachment.bytes.length,
                  data: entry.attachment.bytes,
                },
              },
            }
          : {}),
      },
    })
    .catch(() => {
      // Best-effort: send is already done, this is just for the audit log.
    });
}

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
    const startedAt = Date.now();
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
      // Disabled keys still log so the owner sees the attempt.
      await writeSendLog(deps.prisma, {
        sendKeyId: auth.id,
        userId: auth.userId,
        botId: auth.botId,
        targetQq: auth.targetQq,
        title: payload.title,
        content: payload.content,
        statusCode: 401,
        reason: "send_key_disabled",
        durationMs: Date.now() - startedAt,
      });
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
      await writeSendLog(deps.prisma, {
        sendKeyId: auth.id,
        userId: auth.userId,
        botId: auth.botId,
        targetQq: auth.targetQq,
        title: payload.title,
        content: payload.content,
        statusCode: decision.httpCode,
        reason: decision.reason,
        durationMs: Date.now() - startedAt,
      });
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

    let finalBotId = targetBotId;
    let succeeded = false;
    let failureReason: string | null = null;
    let failureStatus = 0;

    try {
      await deps.botManager.request(targetBotId, "send_private_msg", {
        user_id: auth.targetQq,
        message,
      });
      succeeded = true;
    } catch {
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
        failureStatus = retryDecision.httpCode;
        failureReason = retryDecision.reason;
      } else {
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
          succeeded = true;
          finalBotId = retryBotId;
        } catch {
          failureStatus = 502;
          failureReason = "send_failed";
          finalBotId = retryBotId;
        }
      }
    }

    if (succeeded) {
      // Bump lastUsedAt + write the audit log BEFORE responding so test
      // injectors and audit consumers see the side effects atomically with
      // the 200. (`reply.send` resolves the request-lifecycle promise,
      // which is what `app.inject` awaits — anything we want visible at
      // that point must run first.)
      await deps.prisma.sendKey
        .update({
          where: { id: auth.id },
          data: { lastUsedAt: new Date() },
        })
        .catch(() => {});
      await writeSendLog(deps.prisma, {
        sendKeyId: auth.id,
        userId: auth.userId,
        botId: finalBotId,
        targetQq: auth.targetQq,
        title: payload.title,
        content: payload.content,
        statusCode: 0,
        reason: null,
        durationMs: Date.now() - startedAt,
      });
      reply.send({ code: 0, message: "ok" });
    } else {
      await writeSendLog(deps.prisma, {
        sendKeyId: auth.id,
        userId: auth.userId,
        botId: finalBotId,
        targetQq: auth.targetQq,
        title: payload.title,
        content: payload.content,
        statusCode: failureStatus,
        reason: failureReason,
        durationMs: Date.now() - startedAt,
      });
      reply
        .status(failureStatus)
        .send({ code: failureStatus, message: failureReason ?? "send_failed" });
    }
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

  // ---------------------------------------------------------------------
  // File send: POST /send/file[/:sendkey] with multipart/form-data
  //
  // Accepts a single `file` field (binary) up to MAX_FILE_BYTES. Optional
  // form fields:
  //   - `key`     SendKey, when not provided in path or Authorization
  //   - `name`    Display filename forwarded to QQ; defaults to upload name
  //
  // Forwards to NapCat as `upload_private_file` with the bytes encoded in
  // base64 (an OneBot-friendly transport that doesn't require shared FS).
  //
  // Logs a SendLog row whose `content` records "[文件] <name>" so the
  // audit page surfaces the upload alongside text sends.
  // ---------------------------------------------------------------------
  app.register(fastifyMultipart, {
    limits: {
      // Slightly larger than the policy cap so we can return a clean 413
      // ourselves before fastify cuts the stream.
      fileSize: MAX_FILE_BYTES + 1,
      files: 1,
    },
  });

  const handleFile = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const startedAt = Date.now();

    if (!req.isMultipart()) {
      reply
        .status(400)
        .send({ code: 400, message: "expected_multipart_form_data" });
      return;
    }

    let fileBuffer: Buffer | null = null;
    let fileName = "file";
    let fileMime: string | null = null;
    let formKey: string | null = null;
    let truncated = false;

    // Walk the multipart parts. We accept the first `file` field; ignore
    // additional ones. `name` and `key` come in as text fields.
    for await (const part of req.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "file" || fileBuffer !== null) {
          await part.toBuffer().catch(() => {});
          continue;
        }
        try {
          fileBuffer = await part.toBuffer();
        } catch {
          fileBuffer = null;
        }
        if (part.filename) fileName = part.filename;
        if (part.mimetype) fileMime = part.mimetype;
        if (part.file.truncated) truncated = true;
      } else {
        const value =
          typeof part.value === "string"
            ? part.value
            : String(part.value ?? "");
        if (part.fieldname === "key" && value) formKey = value;
        if (part.fieldname === "name" && value) fileName = value;
      }
    }

    // Resolve the SendKey: Authorization → form `key` → path. (Query is
    // unusual for multipart POSTs but we still honour it for symmetry.)
    let key: string | null = null;
    const auth = req.headers.authorization;
    if (auth) {
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (m) key = m[1]!.trim();
    }
    if (!key && formKey) key = formKey;
    if (!key) {
      const params = req.params as Record<string, unknown> | undefined;
      if (
        params &&
        typeof params.sendkey === "string" &&
        params.sendkey.length > 0
      ) {
        key = params.sendkey;
      }
    }
    if (!key) {
      const query = req.query as Record<string, unknown> | undefined;
      if (query && typeof query.key === "string" && query.key.length > 0) {
        key = query.key;
      }
    }

    if (!key) {
      reply.status(400).send({ code: 400, message: "missing_key" });
      return;
    }
    if (!fileBuffer) {
      reply.status(400).send({ code: 400, message: "missing_file" });
      return;
    }
    if (truncated || fileBuffer.length > MAX_FILE_BYTES) {
      reply.status(413).send({ code: 413, message: "file_too_large" });
      return;
    }

    const authed = await deps.sendKeyService.authenticate(key);
    if (!authed) {
      reply.status(401).send({ code: 401, message: "invalid_send_key" });
      return;
    }
    if (authed.state !== "active") {
      await writeSendLog(deps.prisma, {
        sendKeyId: authed.id,
        userId: authed.userId,
        botId: authed.botId,
        targetQq: authed.targetQq,
        title: null,
        content: `[文件] ${fileName}`,
        statusCode: 401,
        reason: "send_key_disabled",
        durationMs: Date.now() - startedAt,
        attachment: {
          fileName,
          mimeType: fileMime,
          bytes: fileBuffer,
        },
      });
      reply.status(401).send({ code: 401, message: "send_key_disabled" });
      return;
    }

    const decision = deps.router.decideOnSend(
      { boundBotId: authed.botId, targetQq: authed.targetQq },
      {
        bots: deps.botManager.listStatus().map((s) => ({
          id: s.botId,
          alive: s.alive,
        })),
        cache: deps.friendshipCache,
      },
    );
    if (decision.kind === "fail") {
      await writeSendLog(deps.prisma, {
        sendKeyId: authed.id,
        userId: authed.userId,
        botId: authed.botId,
        targetQq: authed.targetQq,
        title: null,
        content: `[文件] ${fileName}`,
        statusCode: decision.httpCode,
        reason: decision.reason,
        durationMs: Date.now() - startedAt,
        attachment: {
          fileName,
          mimeType: fileMime,
          bytes: fileBuffer,
        },
      });
      reply
        .status(decision.httpCode)
        .send({ code: decision.httpCode, message: decision.reason });
      return;
    }

    let targetBotId =
      decision.kind === "send" ? decision.botId : decision.newBotId;
    if (decision.kind === "rebindAndSend") {
      await deps.prisma.sendKey.update({
        where: { id: authed.id },
        data: { botId: decision.newBotId },
      });
    }

    const base64 = fileBuffer.toString("base64");
    let succeeded = false;
    let failureStatus = 0;
    let failureReason: string | null = null;

    try {
      await deps.botManager.request(
        targetBotId,
        "upload_private_file",
        {
          user_id: authed.targetQq,
          file: `base64://${base64}`,
          name: fileName,
        },
        FILE_UPLOAD_TIMEOUT_MS,
      );
      succeeded = true;
    } catch {
      // One retry on another alive friendly bot, mirroring the text path.
      deps.friendshipCache.drop(targetBotId, authed.targetQq);
      deps.botManager.markSendFailure(targetBotId);

      const retry = deps.router.decideOnSend(
        { boundBotId: targetBotId, targetQq: authed.targetQq },
        {
          bots: deps.botManager.listStatus().map((s) => ({
            id: s.botId,
            alive: s.alive,
          })),
          cache: deps.friendshipCache,
        },
      );
      if (retry.kind === "fail") {
        failureStatus = retry.httpCode;
        failureReason = retry.reason;
      } else {
        const retryBotId =
          retry.kind === "send" ? retry.botId : retry.newBotId;
        if (retry.kind === "rebindAndSend") {
          await deps.prisma.sendKey.update({
            where: { id: authed.id },
            data: { botId: retry.newBotId },
          });
        }
        try {
          await deps.botManager.request(
            retryBotId,
            "upload_private_file",
            {
              user_id: authed.targetQq,
              file: `base64://${base64}`,
              name: fileName,
            },
            FILE_UPLOAD_TIMEOUT_MS,
          );
          succeeded = true;
          targetBotId = retryBotId;
        } catch {
          failureStatus = 502;
          failureReason = "send_failed";
          targetBotId = retryBotId;
        }
      }
    }

    if (succeeded) {
      await deps.prisma.sendKey
        .update({
          where: { id: authed.id },
          data: { lastUsedAt: new Date() },
        })
        .catch(() => {});
      await writeSendLog(deps.prisma, {
        sendKeyId: authed.id,
        userId: authed.userId,
        botId: targetBotId,
        targetQq: authed.targetQq,
        title: null,
        content: `[文件] ${fileName} (${humanBytes(fileBuffer.length)})`,
        statusCode: 0,
        reason: null,
        durationMs: Date.now() - startedAt,
        attachment: {
          fileName,
          mimeType: fileMime,
          bytes: fileBuffer,
        },
      });
      reply.send({ code: 0, message: "ok" });
    } else {
      await writeSendLog(deps.prisma, {
        sendKeyId: authed.id,
        userId: authed.userId,
        botId: targetBotId,
        targetQq: authed.targetQq,
        title: null,
        content: `[文件] ${fileName} (${humanBytes(fileBuffer.length)})`,
        statusCode: failureStatus,
        reason: failureReason,
        durationMs: Date.now() - startedAt,
        attachment: {
          fileName,
          mimeType: fileMime,
          bytes: fileBuffer,
        },
      });
      reply
        .status(failureStatus)
        .send({
          code: failureStatus,
          message: failureReason ?? "send_failed",
        });
    }
  };

  app.post<{ Params: { sendkey: string } }>(
    "/send/file/:sendkey",
    async (req, reply) => handleFile(req, reply),
  );
  app.post("/send/file", async (req, reply) => handleFile(req, reply));
}

/**
 * Render a byte count as a short human string (e.g. "1.4 MB"). Used in
 * SendLog entries so the audit page shows file size at a glance.
 */
function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
