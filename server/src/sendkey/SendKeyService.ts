import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { type PrismaClient } from "@prisma/client";
import type { Router } from "../router/Router.js";
import type { FriendshipCache } from "../friendship/FriendshipCache.js";
import type { BotManager } from "../bot/BotManager.js";

export class SendKeyError extends Error {
  constructor(
    public readonly httpCode: 400 | 401 | 404 | 409,
    public readonly reason: string,
  ) {
    super(reason);
    this.name = "SendKeyError";
  }
}

export type SendKeyServiceDeps = {
  prisma: PrismaClient;
  botManager: BotManager;
  friendshipCache: FriendshipCache;
  router: Router;
  /** Optional bcrypt cost override; tests use 4 for speed. */
  bcryptCost?: number;
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
  private readonly bcryptCost: number;

  constructor(deps: SendKeyServiceDeps) {
    this.prisma = deps.prisma;
    this.botManager = deps.botManager;
    this.friendshipCache = deps.friendshipCache;
    this.router = deps.router;
    this.bcryptCost = deps.bcryptCost ?? 10;
  }

  async create(input: CreateSendKeyInput): Promise<CreateSendKeyResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
    });
    if (!user) throw new SendKeyError(401, "unauthenticated");

    const snapshot = {
      bots: this.botManager.listStatus().map((s) => ({
        id: s.botId,
        alive: s.alive,
      })),
      cache: this.friendshipCache,
    };

    const decision = this.router.decideOnCreate(input.targetQq, snapshot);
    if (decision.kind === "needsHandshake") {
      throw new SendKeyError(409, "needs_handshake");
    }

    const plaintext = generatePlaintext();
    const prefix = plaintext.slice(0, PREFIX_LENGTH);
    const keyHash = await bcrypt.hash(plaintext, this.bcryptCost);

    const row = await this.prisma.sendKey.create({
      data: {
        userId: input.userId,
        name: input.name,
        targetQq: BigInt(input.targetQq),
        botId: decision.botId,
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
