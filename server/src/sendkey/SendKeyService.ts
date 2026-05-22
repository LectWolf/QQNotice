import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { type PrismaClient } from "@prisma/client";
import type { Router } from "../router/Router.js";
import type { FriendshipCache } from "../friendship/FriendshipCache.js";
import type { BotManager } from "../bot/BotManager.js";
import { PendingKeyCreations } from "./PendingKeyCreations.js";

export class SendKeyError extends Error {
  constructor(
    public readonly httpCode: 400 | 401 | 404 | 409 | 503,
    public readonly reason: string,
  ) {
    super(reason);
    this.name = "SendKeyError";
  }
}

/**
 * Soft-failure raised by `create` when no alive bot is yet friends with the
 * target QQ but at least one alive bot is available to host the handshake.
 * The HTTP layer responds 202 with the host bot's QQ so the user can add it
 * as a friend; the actual SendKey row is created later by `finalize`.
 */
export class PendingHandshakeError extends Error {
  readonly httpCode = 202 as const;
  readonly reason = "needs_handshake" as const;
  constructor(
    public readonly hostBotQq: number,
    public readonly expiresAt: number,
  ) {
    super("needs_handshake");
    this.name = "PendingHandshakeError";
  }
}

export type SendKeyServiceDeps = {
  prisma: PrismaClient;
  botManager: BotManager;
  friendshipCache: FriendshipCache;
  router: Router;
  pendingKeys?: PendingKeyCreations;
  /** Optional bcrypt cost override; tests use 4 for speed. */
  bcryptCost?: number;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
};

export type CreateSendKeyInput = {
  userId: number;
  name: string;
  targetQq: number;
};

export type CreateSendKeyResult = {
  id: number;
  name: string;
  targetQq: number;
  prefix: string;
  /** Plaintext is returned exactly once at creation; never persisted. */
  plaintext: string;
  botId: number;
  state: "active" | "disabled";
};

export type SendKeyListItem = {
  id: number;
  name: string;
  targetQq: number;
  botId: number;
  prefix: string;
  state: "active" | "disabled";
  createdAt: string;
  lastUsedAt: string | null;
};

export type AuthenticatedSendKey = {
  id: number;
  userId: number;
  name: string;
  targetQq: number;
  botId: number;
  state: "active" | "disabled";
};

const PREFIX_LENGTH = 8;

export class SendKeyService {
  private readonly prisma: PrismaClient;
  private readonly botManager: BotManager;
  private readonly friendshipCache: FriendshipCache;
  private readonly router: Router;
  private readonly pendingKeys: PendingKeyCreations;
  private readonly bcryptCost: number;
  private readonly now: () => number;

  constructor(deps: SendKeyServiceDeps) {
    this.prisma = deps.prisma;
    this.botManager = deps.botManager;
    this.friendshipCache = deps.friendshipCache;
    this.router = deps.router;
    this.pendingKeys = deps.pendingKeys ?? new PendingKeyCreations();
    this.bcryptCost = deps.bcryptCost ?? 10;
    this.now = deps.now ?? (() => Date.now());
  }

  /** Exposed for the friend-request handler in BotManager. */
  getPendingKeys(): PendingKeyCreations {
    return this.pendingKeys;
  }

  async create(input: CreateSendKeyInput): Promise<CreateSendKeyResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
    });
    if (!user) throw new SendKeyError(401, "unauthenticated");

    return this.bindOrPend(input);
  }

  /**
   * After the user has added the host bot as a friend, the UI calls this to
   * finalise the SendKey. Idempotent in spirit: if the friendship is already
   * known we persist the row and return the plaintext; if not yet, we throw
   * a PendingHandshakeError so the UI keeps polling. If the pending entry
   * has expired or never existed, we throw 404.
   */
  async finalize(
    userId: number,
    targetQq: number,
  ): Promise<CreateSendKeyResult> {
    const pending = this.pendingKeys.findByOwner(userId, targetQq, this.now());
    if (!pending) {
      throw new SendKeyError(404, "no_pending_handshake");
    }

    if (!this.friendshipCache.has(pending.hostBotId, targetQq)) {
      // Still waiting on the friend request to land.
      throw new PendingHandshakeError(
        await this.qqOf(pending.hostBotId),
        pending.expiresAt,
      );
    }

    this.pendingKeys.consume(userId, targetQq, this.now());

    return this.persistKey({
      userId,
      name: pending.name,
      targetQq,
      botId: pending.hostBotId,
    });
  }

  private async bindOrPend(
    input: CreateSendKeyInput,
  ): Promise<CreateSendKeyResult> {
    const aliveBots = this.botManager
      .listStatus()
      .filter((s) => s.alive)
      .map((s) => ({ id: s.botId, qq: s.qq }));
    const aliveIds = aliveBots.map((b) => b.id);
    const snapshot = {
      bots: aliveBots.map((b) => ({ id: b.id, alive: true })),
      cache: this.friendshipCache,
    };

    const decision = this.router.decideOnCreate(input.targetQq, snapshot);

    if (decision.kind === "bind") {
      return this.persistKey({
        userId: input.userId,
        name: input.name,
        targetQq: input.targetQq,
        botId: decision.botId,
      });
    }

    // needsHandshake — pick a host bot if any alive bot exists.
    if (aliveIds.length === 0) {
      throw new SendKeyError(503, "no_alive_bot");
    }

    const entry = this.pendingKeys.open({
      userId: input.userId,
      targetQq: input.targetQq,
      name: input.name,
      aliveBotIds: aliveIds,
      now: this.now(),
    });
    const hostQq = aliveBots.find((b) => b.id === entry.hostBotId)?.qq;
    if (!hostQq) {
      // Defensive: aliveBots was used to seed pending so we should always
      // find it. If not, something is racing — undo the pending entry.
      this.pendingKeys.consume(input.userId, input.targetQq, this.now());
      throw new SendKeyError(503, "no_alive_bot");
    }
    throw new PendingHandshakeError(hostQq, entry.expiresAt);
  }

  private async qqOf(botId: number): Promise<number> {
    const status = this.botManager.listStatus().find((s) => s.botId === botId);
    if (status) return status.qq;
    const row = await this.prisma.bot.findUnique({ where: { id: botId } });
    return row ? Number(row.qq) : 0;
  }

  private async persistKey(args: {
    userId: number;
    name: string;
    targetQq: number;
    botId: number;
  }): Promise<CreateSendKeyResult> {
    const plaintext = generatePlaintext();
    const prefix = plaintext.slice(0, PREFIX_LENGTH);
    const keyHash = await bcrypt.hash(plaintext, this.bcryptCost);

    const row = await this.prisma.sendKey.create({
      data: {
        userId: args.userId,
        name: args.name,
        targetQq: BigInt(args.targetQq),
        botId: args.botId,
        keyHash,
        prefix,
      },
    });

    return {
      id: row.id,
      name: row.name,
      targetQq: Number(row.targetQq),
      prefix: row.prefix,
      plaintext,
      botId: row.botId,
      state: row.state as "active" | "disabled",
    };
  }

  async listForUser(userId: number): Promise<SendKeyListItem[]> {
    const rows = await this.prisma.sendKey.findMany({
      where: { userId },
      orderBy: { id: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      targetQq: Number(row.targetQq),
      botId: row.botId,
      prefix: row.prefix,
      state: row.state as "active" | "disabled",
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    }));
  }

  async delete(userId: number, sendKeyId: number): Promise<void> {
    const result = await this.prisma.sendKey.deleteMany({
      where: { id: sendKeyId, userId },
    });
    if (result.count === 0) {
      throw new SendKeyError(404, "send_key_not_found");
    }
  }

  /**
   * Look up a SendKey row by plaintext. Returns null when the key is
   * unknown, malformed, or fails bcrypt verification. Constant-time at the
   * bcrypt level; the prefix lookup is fast and not a timing oracle for
   * attackers who don't already know the prefix.
   */
  async authenticate(plaintext: string): Promise<AuthenticatedSendKey | null> {
    if (!plaintext || plaintext.length < PREFIX_LENGTH + 1) return null;
    const prefix = plaintext.slice(0, PREFIX_LENGTH);
    const row = await this.prisma.sendKey.findFirst({ where: { prefix } });
    if (!row) return null;
    const ok = await bcrypt.compare(plaintext, row.keyHash);
    if (!ok) return null;
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      targetQq: Number(row.targetQq),
      botId: row.botId,
      state: row.state as "active" | "disabled",
    };
  }
}

function generatePlaintext(): string {
  // 24 bytes -> 32 base64url chars; URL-safe and dense.
  return "sk_" + crypto.randomBytes(24).toString("base64url");
}
