import type { PrismaClient } from "@prisma/client";
import type { OneBotClient } from "../onebot/OneBotClient.js";
import { computeBotAlive } from "./computeBotAlive.js";
import type { FriendshipCache } from "../friendship/FriendshipCache.js";
import type { PendingKeyCreations } from "../sendkey/PendingKeyCreations.js";

export type BotStatus = {
  botId: number;
  qq: number;
  name: string;
  enabled: boolean;
  wsState: "open" | "connecting" | "closed";
  lastHeartbeatAt: number | null;
  heartbeatInterval: number | null;
  online: boolean;
  alive: boolean;
  friendCount: number;
};

export type ClientFactory = (opts: {
  url: string;
  accessToken: string | null;
}) => OneBotClient;

export type BotManagerDeps = {
  prisma: PrismaClient;
  clientFactory: ClientFactory;
  /**
   * Optional FriendshipCache. When provided, the manager pulls each Bot's
   * friend list (via OneBot `get_friend_list`) the first time it transitions
   * to alive, and writes the result into the cache via `replaceAllForBot`.
   */
  friendshipCache?: FriendshipCache;
  /**
   * Optional PendingKeyCreations. When provided together with
   * `friendshipCache`, incoming `request.friend` events are auto-approved
   * (and the cache updated) only when `(targetQq, botId)` is in the pending
   * registry. Without a registry, friend requests are ignored.
   */
  pendingKeys?: PendingKeyCreations;
  /** Injected so tests can control time; defaults to Date.now. */
  now?: () => number;
  /** How often `reconcile()` runs in the background, ms. Default 3000. */
  reconcileIntervalMs?: number;
  /**
   * How often a full friendship refresh is run, ms. Default 24h. Tests can
   * shorten it; set to 0 to disable.
   */
  friendshipRefreshIntervalMs?: number;
};

type BotEntry = {
  /** Latest known DB row. */
  row: {
    id: number;
    name: string;
    qq: bigint;
    wsUrl: string;
    accessToken: string | null;
    enabled: boolean;
  };
  client: OneBotClient | null;
  /** Identifying fields of the WS the current `client` was opened against. */
  clientUrl: string | null;
  clientToken: string | null;
  wsState: "open" | "connecting" | "closed";
  lastHeartbeatAt: number | null;
  heartbeatInterval: number | null;
  online: boolean;
  sendFailureShortCircuitUntil: number;
  /** First heartbeat already logged so we don't spam. */
  firstHeartbeatSeen: boolean;
  /** Set once we've pulled the friend list for this bot's current connection. */
  friendsPulled: boolean;
};

export class BotManager {
  private readonly prisma: PrismaClient;
  private readonly clientFactory: ClientFactory;
  private readonly friendshipCache: FriendshipCache | null;
  private readonly pendingKeys: PendingKeyCreations | null;
  private readonly now: () => number;
  private readonly reconcileIntervalMs: number;
  private readonly friendshipRefreshIntervalMs: number;
  private bots = new Map<number, BotEntry>();
  private timer: NodeJS.Timeout | null = null;
  private friendshipTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(deps: BotManagerDeps) {
    this.prisma = deps.prisma;
    this.clientFactory = deps.clientFactory;
    this.friendshipCache = deps.friendshipCache ?? null;
    this.pendingKeys = deps.pendingKeys ?? null;
    this.now = deps.now ?? (() => Date.now());
    this.reconcileIntervalMs = deps.reconcileIntervalMs ?? 3000;
    this.friendshipRefreshIntervalMs =
      deps.friendshipRefreshIntervalMs ?? 24 * 60 * 60 * 1000;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.reconcile();
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.reconcile().catch(() => {});
      }, this.reconcileIntervalMs);
    }
    if (!this.friendshipTimer && this.friendshipRefreshIntervalMs > 0) {
      this.friendshipTimer = setInterval(() => {
        void this.refreshAllFriendsNow().catch(() => {});
      }, this.friendshipRefreshIntervalMs);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.friendshipTimer) {
      clearInterval(this.friendshipTimer);
      this.friendshipTimer = null;
    }
    for (const entry of this.bots.values()) {
      entry.client?.disconnect();
      entry.client = null;
      entry.clientUrl = null;
      entry.clientToken = null;
      entry.wsState = "closed";
    }
    this.bots.clear();
  }

  listStatus(): BotStatus[] {
    const now = this.now();
    return Array.from(this.bots.values()).map((entry) => ({
      botId: entry.row.id,
      qq: Number(entry.row.qq),
      name: entry.row.name,
      enabled: entry.row.enabled,
      wsState: entry.wsState,
      lastHeartbeatAt: entry.lastHeartbeatAt,
      heartbeatInterval: entry.heartbeatInterval,
      online: entry.online,
      alive: computeBotAlive({
        wsState: entry.wsState,
        lastHeartbeatAt: entry.lastHeartbeatAt,
        lastHeartbeatInterval: entry.heartbeatInterval,
        online: entry.online,
        sendFailureShortCircuitUntil: entry.sendFailureShortCircuitUntil,
        now,
      }),
      friendCount: this.friendshipCache
        ? Array.from(this.friendshipCache.snapshot().get(entry.row.id) ?? []).length
        : 0,
    }));
  }

  /**
   * Sends an OneBot action through the specified Bot's connected client.
   * Throws if no client is currently open.
   */
  async request<T = unknown>(
    botId: number,
    action: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    const entry = this.bots.get(botId);
    if (!entry || !entry.client) {
      throw new Error(`bot ${botId} not connected`);
    }
    return entry.client.request<T>(action, params, timeoutMs);
  }

  /**
   * Force an immediate reconcile against the DB. The HTTP layer calls this
   * after Bot CRUD so newly-created or edited rows pick up their connection
   * without waiting for the next 3-second tick.
   */
  async reconcileNow(): Promise<void> {
    await this.reconcile();
  }

  /**
   * Pulls get_friend_list for every alive bot and refreshes the friendship
   * cache. Failures on individual bots do not abort the batch.
   */
  async refreshAllFriendsNow(): Promise<{
    refreshed: number;
    skipped: number;
    durationMs: number;
  }> {
    const start = this.now();
    let refreshed = 0;
    let skipped = 0;
    if (!this.friendshipCache) {
      return { refreshed: 0, skipped: this.bots.size, durationMs: 0 };
    }

    for (const entry of this.bots.values()) {
      if (!entry.client || entry.wsState !== "open" || !entry.online) {
        skipped++;
        continue;
      }
      try {
        await this.pullFriends(entry);
        refreshed++;
      } catch {
        skipped++;
      }
    }

    return { refreshed, skipped, durationMs: this.now() - start };
  }

  /**
   * Short-circuits a Bot to `dead` for a brief window after a send failure.
   * The next heartbeat or successful operation lets it recover naturally.
   */
  markSendFailure(botId: number, durationMs = 30_000): void {
    const entry = this.bots.get(botId);
    if (!entry) return;
    entry.sendFailureShortCircuitUntil = this.now() + durationMs;
  }

  /**
   * Reconciles the in-process bot map against the DB. Called by `start()`
   * once and then on a timer.
   */
  private async reconcile(): Promise<void> {
    if (this.stopped) return;
    const rows = await this.prisma.bot.findMany({ orderBy: { id: "asc" } });

    const seen = new Set<number>();
    for (const row of rows) {
      seen.add(row.id);
      let entry = this.bots.get(row.id);
      if (!entry) {
        entry = {
          row,
          client: null,
          clientUrl: null,
          clientToken: null,
          wsState: "closed",
          lastHeartbeatAt: null,
          heartbeatInterval: null,
          online: false,
          sendFailureShortCircuitUntil: 0,
          firstHeartbeatSeen: false,
          friendsPulled: false,
        };
        this.bots.set(row.id, entry);
      } else {
        entry.row = row;
      }

      this.reconcileEntry(entry);
    }

    for (const id of Array.from(this.bots.keys())) {
      if (!seen.has(id)) {
        const entry = this.bots.get(id)!;
        entry.client?.disconnect();
        this.bots.delete(id);
      }
    }
  }

  /**
   * Pulls the bot's current friend list and writes it into the friendship
   * cache. Best-effort: failures are logged via the calling reconcile path.
   */
  private async pullFriends(entry: BotEntry): Promise<void> {
    if (!this.friendshipCache || !entry.client) return;
    type FriendInfo = { user_id: number };
    const friends = await entry.client.request<FriendInfo[]>(
      "get_friend_list",
    );
    const qqs = Array.isArray(friends)
      ? friends
          .map((f) => Number(f.user_id))
          .filter((n) => Number.isFinite(n))
      : [];
    this.friendshipCache.replaceAllForBot(entry.row.id, qqs);
  }

  private reconcileEntry(entry: BotEntry): void {
    const desiredUrl = entry.row.wsUrl;
    const desiredToken = entry.row.accessToken;

    // If disabled, ensure we have no client.
    if (!entry.row.enabled) {
      if (entry.client) {
        entry.client.disconnect();
        entry.client = null;
        entry.clientUrl = null;
        entry.clientToken = null;
        entry.wsState = "closed";
        entry.online = false;
      }
      return;
    }

    // If URL/token changed, tear down and rebuild.
    if (
      entry.client &&
      (entry.clientUrl !== desiredUrl || entry.clientToken !== desiredToken)
    ) {
      entry.client.disconnect();
      entry.client = null;
      entry.clientUrl = null;
      entry.clientToken = null;
      entry.wsState = "closed";
      entry.online = false;
    }

    // If we should have a client and don't, build one.
    if (!entry.client) {
      const client = this.clientFactory({
        url: desiredUrl,
        accessToken: desiredToken,
      });
      entry.client = client;
      entry.clientUrl = desiredUrl;
      entry.clientToken = desiredToken;
      entry.wsState = "connecting";

      client.on("heartbeat", (payload: unknown) => {
        const obj = (payload ?? {}) as Record<string, unknown>;
        const status = (obj.status as Record<string, unknown> | undefined) ?? {};
        const interval = typeof obj.interval === "number" ? obj.interval : null;
        const online = status.online === true;
        const selfId =
          typeof obj.self_id === "number"
            ? obj.self_id
            : Number((obj.self_id as unknown) ?? NaN);

        if (Number.isFinite(selfId) && selfId !== Number(entry.row.qq)) {
          entry.online = false;
          return;
        }

        entry.wsState = "open";
        entry.lastHeartbeatAt = this.now();
        entry.heartbeatInterval = interval;
        entry.online = online;
        if (!entry.firstHeartbeatSeen) {
          entry.firstHeartbeatSeen = true;
        }
        // Pull the friend list once after the bot first becomes alive on
        // this connection. Re-runs on reconnect because friendsPulled is
        // reset there.
        if (online && !entry.friendsPulled) {
          entry.friendsPulled = true;
          void this.pullFriends(entry).catch(() => {
            entry.friendsPulled = false;
          });
        }
      });

      client.on("disconnected", () => {
        entry.wsState = "closed";
        entry.online = false;
        entry.client = null;
        entry.clientUrl = null;
        entry.clientToken = null;
        entry.friendsPulled = false;
      });

      client.on("friendRequest", (qq, flag) => {
        if (!this.friendshipCache || !this.pendingKeys) return;
        if (!this.pendingKeys.isPending(qq, entry.row.id, this.now())) return;
        const c = entry.client;
        if (!c) return;
        void c
          .request("set_friend_add_request", { flag, approve: true })
          .then(() => {
            this.friendshipCache!.add(entry.row.id, qq);
          })
          .catch(() => {});
      });

      client.connect();
    }
  }
}
