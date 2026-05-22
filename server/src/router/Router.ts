import type { FriendshipCache } from "../friendship/FriendshipCache.js";

export type BotSnapshot = {
  id: number;
  alive: boolean;
};

export type RouterSnapshot = {
  bots: ReadonlyArray<BotSnapshot>;
  cache: FriendshipCache;
};

export type CreateDecision =
  | { kind: "bind"; botId: number }
  | { kind: "needsHandshake" };

export type SendInput = {
  boundBotId: number;
  targetQq: number;
};

export type SendDecision =
  | { kind: "send"; botId: number }
  | { kind: "rebindAndSend"; newBotId: number }
  | { kind: "fail"; httpCode: 502 | 503; reason: string };

export type StartupDecision =
  | { kind: "leave" }
  | { kind: "rebind"; newBotId: number }
  | { kind: "disable" };

export type RouterOptions = {
  /**
   * Returns an integer index in [0, n). Defaults to a uniform random pick.
   * Injected for deterministic tests.
   */
  pickIndex?: (n: number) => number;
};

/**
 * Pure routing decisions. No IO, no clock. Callers (SendPipeline, startup
 * boot, key creation) apply the decisions to the database / network.
 */
export class Router {
  private readonly pickIndex: (n: number) => number;

  constructor(opts: RouterOptions = {}) {
    this.pickIndex = opts.pickIndex ?? ((n) => Math.floor(Math.random() * n));
  }

  /** Pick a bot for a brand-new SendKey targeting `targetQq`. */
  decideOnCreate(targetQq: number, snapshot: RouterSnapshot): CreateDecision {
    const aliveIds = snapshot.bots.filter((b) => b.alive).map((b) => b.id);
    const friendly = snapshot.cache.findFriendlyBots(targetQq, aliveIds);
    if (friendly.length === 0) return { kind: "needsHandshake" };
    const idx = this.pickIndex(friendly.length);
    return { kind: "bind", botId: friendly[idx]! };
  }

  /** Decide how to deliver a Notification through an existing SendKey. */
  decideOnSend(input: SendInput, snapshot: RouterSnapshot): SendDecision {
    const bot = snapshot.bots.find((b) => b.id === input.boundBotId);
    // The bound bot, if it exists and is alive, is trusted unconditionally.
    // Per CONTEXT.md, friendship-loss is detected only by an actual send
    // failure; the cache must not be used to refuse a send pre-emptively.
    if (bot?.alive) {
      return { kind: "send", botId: bot.id };
    }

    // Bound bot is dead (or unknown). Look for a rescue: any other alive bot
    // that already has the target as a friend in the cache.
    const aliveIds = snapshot.bots.filter((b) => b.alive).map((b) => b.id);
    const friendly = snapshot.cache.findFriendlyBots(input.targetQq, aliveIds);
    if (friendly.length > 0) {
      const idx = this.pickIndex(friendly.length);
      return { kind: "rebindAndSend", newBotId: friendly[idx]! };
    }

    if (snapshot.bots.length === 0) {
      return { kind: "fail", httpCode: 503, reason: "bot_pool_empty" };
    }
    return { kind: "fail", httpCode: 502, reason: "no_alive_friendly_bot" };
  }

  /**
   * Reconcile a SendKey on startup, after a fresh full friendship pull.
   * Unlike `decideOnSend`, this DOES use the cache as authoritative — the
   * boot-time refresh has just renewed it.
   */
  decideOnStartup(input: SendInput, snapshot: RouterSnapshot): StartupDecision {
    const bot = snapshot.bots.find((b) => b.id === input.boundBotId);
    if (bot?.alive && snapshot.cache.has(bot.id, input.targetQq)) {
      return { kind: "leave" };
    }

    const aliveIds = snapshot.bots.filter((b) => b.alive).map((b) => b.id);
    const friendly = snapshot.cache.findFriendlyBots(input.targetQq, aliveIds);
    if (friendly.length > 0) {
      const idx = this.pickIndex(friendly.length);
      return { kind: "rebind", newBotId: friendly[idx]! };
    }

    return { kind: "disable" };
  }
}
