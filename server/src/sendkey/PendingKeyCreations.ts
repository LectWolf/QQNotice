/**
 * Registry of in-flight SendKey creations awaiting a friend handshake.
 * Pure: no clock — `now` is injected on every call. Never persisted.
 *
 * Keyed by `(userId, targetQq)`: the same user re-opening for the same
 * target overwrites the prior entry. Two different users handshaking the
 * same target QQ in parallel each get their own entry, so a friend request
 * arriving for that target satisfies whichever was registered first.
 */
export type PendingEntry = {
  userId: number;
  targetQq: number;
  hostBotId: number;
  name: string;
  expiresAt: number;
};

export const TTL_MS = 15 * 60 * 1000;

type Key = string;
function keyOf(userId: number, targetQq: number): Key {
  return `${userId}:${targetQq}`;
}

export class PendingKeyCreations {
  private byOwner = new Map<Key, PendingEntry>();

  open(args: {
    userId: number;
    targetQq: number;
    name: string;
    aliveBotIds: number[];
    pickIndex?: (n: number) => number;
    now: number;
  }): PendingEntry {
    if (args.aliveBotIds.length === 0) {
      throw new Error("no alive bots available to host the handshake");
    }
    const pickIndex =
      args.pickIndex ?? ((n: number) => Math.floor(Math.random() * n));
    const idx = pickIndex(args.aliveBotIds.length);
    const hostBotId = args.aliveBotIds[idx]!;
    const entry: PendingEntry = {
      userId: args.userId,
      targetQq: args.targetQq,
      hostBotId,
      name: args.name,
      expiresAt: args.now + TTL_MS,
    };
    this.byOwner.set(keyOf(args.userId, args.targetQq), entry);
    return entry;
  }

  isPending(targetQq: number, botId: number, now: number): boolean {
    for (const entry of this.byOwner.values()) {
      if (entry.expiresAt <= now) continue;
      if (entry.targetQq === targetQq && entry.hostBotId === botId) return true;
    }
    return false;
  }

  findByOwner(
    userId: number,
    targetQq: number,
    now: number,
  ): PendingEntry | null {
    const entry = this.byOwner.get(keyOf(userId, targetQq));
    if (!entry || entry.expiresAt <= now) return null;
    return entry;
  }

  /**
   * Find the active entry by `targetQq` only. Used by the friend-request
   * handler which only knows the QQ that just sent the request.
   */
  findByTarget(targetQq: number, now: number): PendingEntry | null {
    for (const entry of this.byOwner.values()) {
      if (entry.expiresAt <= now) continue;
      if (entry.targetQq === targetQq) return entry;
    }
    return null;
  }

  consume(
    userId: number,
    targetQq: number,
    now: number,
  ): PendingEntry | null {
    const k = keyOf(userId, targetQq);
    const entry = this.byOwner.get(k);
    if (!entry || entry.expiresAt <= now) return null;
    this.byOwner.delete(k);
    return entry;
  }

  gcExpired(now: number): void {
    for (const [k, entry] of Array.from(this.byOwner.entries())) {
      if (entry.expiresAt <= now) this.byOwner.delete(k);
    }
  }
}
