import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BotManager, type ClientFactory } from "./BotManager.js";
import { getTestPrisma, resetDb } from "../../test/db.js";
import type { OneBotClient as OneBotClientType } from "../onebot/OneBotClient.js";
import { OneBotClient } from "../onebot/OneBotClient.js";
import {
  FakeNapcat,
  heartbeatPayload,
} from "../onebot/__tests__/fakeNapcat.js";

/**
 * Stub OneBotClient that records calls but does no real network IO.
 * The test asserts on BotManager's observable behaviour only.
 */
class StubClient {
  url: string;
  accessToken: string | null;
  connected = false;
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor(opts: { url: string; accessToken: string | null }) {
    this.url = opts.url;
    this.accessToken = opts.accessToken;
  }

  connect(): void {
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  request(): Promise<unknown> {
    throw new Error("not used in this test");
  }

  on(event: string, cb: (...args: unknown[]) => void): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb);
    this.listeners.set(event, arr);
  }
}

const stubFactory: ClientFactory = (opts) =>
  new StubClient(opts) as unknown as OneBotClientType;

describe("BotManager.listStatus", () => {
  const prisma = getTestPrisma();
  let manager: BotManager;

  beforeEach(async () => {
    await resetDb(prisma);
    manager = new BotManager({ prisma, clientFactory: stubFactory });
  });

  afterAll(async () => {
    if (manager) await manager.stop();
    await prisma.$disconnect();
  });

  it("returns an empty list when no bots are configured", async () => {
    await manager.start();
    expect(manager.listStatus()).toEqual([]);
  });

  it("returns one status row per Bot in the database", async () => {
    await prisma.bot.create({
      data: {
        name: "primary",
        qq: BigInt(10001),
        wsUrl: "ws://localhost:3001",
        accessToken: "token-a",
        enabled: true,
      },
    });
    await prisma.bot.create({
      data: {
        name: "spare",
        qq: BigInt(10002),
        wsUrl: "ws://localhost:3002",
        accessToken: null,
        enabled: false,
      },
    });

    await manager.start();
    const status = manager.listStatus().sort((a, b) => a.botId - b.botId);

    expect(status).toHaveLength(2);
    expect(status[0]).toMatchObject({
      qq: 10001,
      name: "primary",
      enabled: true,
      online: false,
      alive: false,
      friendCount: 0,
    });
    expect(status[1]).toMatchObject({
      qq: 10002,
      name: "spare",
      enabled: false,
      alive: false,
    });
  });
});

describe("BotManager liveness via heartbeat", () => {
  const prisma = getTestPrisma();
  let napcat: FakeNapcat;
  let manager: BotManager;

  beforeEach(async () => {
    await resetDb(prisma);
    napcat = await FakeNapcat.start();
  });

  afterAll(async () => {
    if (manager) await manager.stop();
    await prisma.$disconnect();
  });

  async function withRealClients(): Promise<BotManager> {
    const m = new BotManager({
      prisma,
      clientFactory: (opts) => new OneBotClient(opts),
    });
    await m.start();
    return m;
  }

  it("transitions to alive after WS opens and a heartbeat arrives", async () => {
    await prisma.bot.create({
      data: {
        name: "primary",
        qq: BigInt(10001),
        wsUrl: napcat.url,
        enabled: true,
      },
    });

    manager = await withRealClients();

    // Send a heartbeat the moment the manager's client connects.
    napcat.onAnyConnection(() => {
      napcat.send(
        heartbeatPayload({ selfId: 10001, interval: 5000, online: true }),
      );
    });

    // Poll until alive.
    const deadline = Date.now() + 3000;
    let status = manager.listStatus()[0]!;
    while (!status.alive && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      status = manager.listStatus()[0]!;
    }

    expect(status.alive).toBe(true);
    expect(status.online).toBe(true);
    expect(status.wsState).toBe("open");
    expect(status.heartbeatInterval).toBe(5000);

    await manager.stop();
  });

  it("populates the friendship cache from get_friend_list once the bot is alive", async () => {
    const bot = await prisma.bot.create({
      data: {
        name: "primary",
        qq: BigInt(10001),
        wsUrl: napcat.url,
        enabled: true,
      },
    });

    const cache = new (await import("../friendship/FriendshipCache.js")).FriendshipCache();
    manager = new BotManager({
      prisma,
      clientFactory: (opts) => new OneBotClient(opts),
      friendshipCache: cache,
    });
    await manager.start();

    // Stub: respond to get_friend_list, then send a heartbeat.
    napcat.onAnyConnection((conn) => {
      conn.socket.on("message", (raw) => {
        const req = JSON.parse(raw.toString()) as {
          action: string;
          echo: string;
        };
        if (req.action === "get_friend_list") {
          conn.socket.send(
            JSON.stringify({
              status: "ok",
              retcode: 0,
              data: [
                { user_id: 12345, nickname: "alice" },
                { user_id: 67890, nickname: "bob" },
              ],
              echo: req.echo,
            }),
          );
        }
      });
      napcat.send(
        heartbeatPayload({ selfId: 10001, interval: 5000, online: true }),
      );
    });

    // Wait for the cache to be populated.
    const deadline = Date.now() + 3000;
    while (!cache.has(bot.id, 12345) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(cache.has(bot.id, 12345)).toBe(true);
    expect(cache.has(bot.id, 67890)).toBe(true);
    expect(cache.has(bot.id, 99999)).toBe(false);

    await manager.stop();
  });

  it("auto-approves a request.friend for a pending target and adds it to cache", async () => {
    const bot = await prisma.bot.create({
      data: {
        name: "primary",
        qq: BigInt(10001),
        wsUrl: napcat.url,
        enabled: true,
      },
    });

    const { FriendshipCache } = await import(
      "../friendship/FriendshipCache.js"
    );
    const { PendingKeyCreations } = await import(
      "../sendkey/PendingKeyCreations.js"
    );
    const cache = new FriendshipCache();
    const pending = new PendingKeyCreations();
    pending.open({
      userId: 1,
      targetQq: 12345,
      name: "ci",
      aliveBotIds: [bot.id],
      pickIndex: () => 0,
      now: Date.now(),
    });

    manager = new BotManager({
      prisma,
      clientFactory: (opts) => new OneBotClient(opts),
      friendshipCache: cache,
      pendingKeys: pending,
    });
    await manager.start();

    let approveCallSeen = false;

    napcat.onAnyConnection((conn) => {
      conn.socket.on("message", (raw) => {
        const req = JSON.parse(raw.toString()) as {
          action: string;
          params: Record<string, unknown>;
          echo: string;
        };
        if (req.action === "get_friend_list") {
          conn.socket.send(
            JSON.stringify({
              status: "ok",
              retcode: 0,
              data: [],
              echo: req.echo,
            }),
          );
        } else if (req.action === "set_friend_add_request") {
          approveCallSeen = true;
          expect(req.params.flag).toBe("flag-abc");
          expect(req.params.approve).toBe(true);
          conn.socket.send(
            JSON.stringify({ status: "ok", retcode: 0, echo: req.echo }),
          );
        }
      });
      napcat.send(
        heartbeatPayload({ selfId: 10001, interval: 5000, online: true }),
      );
      // Send the friend request after the connection is established.
      setTimeout(() => {
        napcat.send({
          time: 1700000000,
          self_id: 10001,
          post_type: "request",
          request_type: "friend",
          user_id: 12345,
          comment: "hi",
          flag: "flag-abc",
        });
      }, 50);
    });

    const deadline = Date.now() + 3000;
    while (!cache.has(bot.id, 12345) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(approveCallSeen).toBe(true);
    expect(cache.has(bot.id, 12345)).toBe(true);

    await manager.stop();
  });

  it("ignores a request.friend for a target that is NOT in the pending list", async () => {
    const bot = await prisma.bot.create({
      data: {
        name: "primary",
        qq: BigInt(10001),
        wsUrl: napcat.url,
        enabled: true,
      },
    });

    const { FriendshipCache } = await import(
      "../friendship/FriendshipCache.js"
    );
    const { PendingKeyCreations } = await import(
      "../sendkey/PendingKeyCreations.js"
    );
    const cache = new FriendshipCache();
    const pending = new PendingKeyCreations();
    // No `open()` — nobody is pending.

    manager = new BotManager({
      prisma,
      clientFactory: (opts) => new OneBotClient(opts),
      friendshipCache: cache,
      pendingKeys: pending,
    });
    await manager.start();

    let approveCallSeen = false;

    napcat.onAnyConnection((conn) => {
      conn.socket.on("message", (raw) => {
        const req = JSON.parse(raw.toString()) as {
          action: string;
          echo: string;
        };
        if (req.action === "get_friend_list") {
          conn.socket.send(
            JSON.stringify({
              status: "ok",
              retcode: 0,
              data: [],
              echo: req.echo,
            }),
          );
        } else if (req.action === "set_friend_add_request") {
          approveCallSeen = true;
        }
      });
      napcat.send(
        heartbeatPayload({ selfId: 10001, interval: 5000, online: true }),
      );
      setTimeout(() => {
        napcat.send({
          time: 1700000000,
          self_id: 10001,
          post_type: "request",
          request_type: "friend",
          user_id: 99999, // not pending
          comment: "spam",
          flag: "flag-spam",
        });
      }, 50);
    });

    // Give the manager a chance to (incorrectly) auto-approve.
    await new Promise((r) => setTimeout(r, 250));

    expect(approveCallSeen).toBe(false);
    expect(cache.has(bot.id, 99999)).toBe(false);

    await manager.stop();
  });
});

describe("BotManager scheduled friendship refresh", () => {
  const prisma = getTestPrisma();

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("invokes refreshAllFriendsNow on the configured interval", async () => {
    vi.useFakeTimers();
    try {
      let refreshCalls = 0;
      const m = new BotManager({
        prisma,
        clientFactory: stubFactory,
        reconcileIntervalMs: 60_000,
        friendshipRefreshIntervalMs: 1000, // 1s for the test
      });
      // Stub refreshAllFriendsNow so the test doesn't depend on bots.
      (m as unknown as {
        refreshAllFriendsNow: () => Promise<unknown>;
      }).refreshAllFriendsNow = async () => {
        refreshCalls++;
        return { refreshed: 0, skipped: 0, durationMs: 0 };
      };

      await m.start();
      // Initial start() doesn't refresh (only the timer does).
      expect(refreshCalls).toBe(0);

      vi.advanceTimersByTime(1000);
      // setInterval fires the callback synchronously; it kicks a microtask.
      await Promise.resolve();
      expect(refreshCalls).toBe(1);

      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(refreshCalls).toBe(2);

      await m.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start the timer when friendshipRefreshIntervalMs is 0", async () => {
    vi.useFakeTimers();
    try {
      let refreshCalls = 0;
      const m = new BotManager({
        prisma,
        clientFactory: stubFactory,
        reconcileIntervalMs: 60_000,
        friendshipRefreshIntervalMs: 0,
      });
      (m as unknown as {
        refreshAllFriendsNow: () => Promise<unknown>;
      }).refreshAllFriendsNow = async () => {
        refreshCalls++;
        return { refreshed: 0, skipped: 0, durationMs: 0 };
      };

      await m.start();
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
      expect(refreshCalls).toBe(0);

      await m.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
