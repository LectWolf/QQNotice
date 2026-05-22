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
});
