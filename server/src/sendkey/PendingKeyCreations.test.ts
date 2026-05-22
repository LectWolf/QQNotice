import { describe, expect, it } from "vitest";
import { PendingKeyCreations, TTL_MS } from "./PendingKeyCreations.js";

const NOW = 1_000_000;

describe("PendingKeyCreations.open", () => {
  it("picks a host bot and stores the entry with a 15-minute TTL", () => {
    const reg = new PendingKeyCreations();

    const entry = reg.open({
      userId: 1,
      targetQq: 999,
      name: "ci",
      aliveBotIds: [10, 20, 30],
      pickIndex: (n) => (n === 3 ? 1 : 0),
      now: NOW,
    });

    expect(entry).toEqual({
      userId: 1,
      targetQq: 999,
      hostBotId: 20,
      name: "ci",
      expiresAt: NOW + TTL_MS,
    });
  });

  it("throws when no alive bots are available", () => {
    const reg = new PendingKeyCreations();

    expect(() =>
      reg.open({
        userId: 1,
        targetQq: 999,
        name: "ci",
        aliveBotIds: [],
        now: NOW,
      }),
    ).toThrow();
  });

  it("replaces the existing entry for the same (user, qq) on a second open", () => {
    const reg = new PendingKeyCreations();

    reg.open({
      userId: 1,
      targetQq: 999,
      name: "ci",
      aliveBotIds: [10],
      now: NOW,
    });
    const entry = reg.open({
      userId: 1,
      targetQq: 999,
      name: "renamed",
      aliveBotIds: [20],
      now: NOW + 1,
    });

    expect(entry.hostBotId).toBe(20);
    expect(entry.name).toBe("renamed");
  });
});

describe("PendingKeyCreations.isPending", () => {
  it("matches only the exact (qq, hostBotId) pair from an active entry", () => {
    const reg = new PendingKeyCreations();
    reg.open({
      userId: 1,
      targetQq: 999,
      name: "ci",
      aliveBotIds: [10],
      now: NOW,
    });

    expect(reg.isPending(999, 10, NOW)).toBe(true);
    expect(reg.isPending(999, 20, NOW)).toBe(false); // wrong bot
    expect(reg.isPending(888, 10, NOW)).toBe(false); // wrong qq
  });

  it("does not match an expired entry", () => {
    const reg = new PendingKeyCreations();
    reg.open({
      userId: 1,
      targetQq: 999,
      name: "ci",
      aliveBotIds: [10],
      now: NOW,
    });

    expect(reg.isPending(999, 10, NOW + TTL_MS + 1)).toBe(false);
  });
});

describe("PendingKeyCreations.findByOwner", () => {
  it("returns the active entry for the matching (userId, targetQq)", () => {
    const reg = new PendingKeyCreations();
    reg.open({
      userId: 1,
      targetQq: 999,
      name: "ci",
      aliveBotIds: [10],
      now: NOW,
    });

    const entry = reg.findByOwner(1, 999, NOW);
    expect(entry).not.toBeNull();
    expect(entry!.hostBotId).toBe(10);
  });

  it("returns null when no entry exists", () => {
    expect(new PendingKeyCreations().findByOwner(1, 999, NOW)).toBeNull();
  });

  it("returns null for an expired entry and does not leak state", () => {
    const reg = new PendingKeyCreations();
    reg.open({
      userId: 1,
      targetQq: 999,
      name: "ci",
      aliveBotIds: [10],
      now: NOW,
    });

    expect(reg.findByOwner(1, 999, NOW + TTL_MS + 1)).toBeNull();
  });
});

describe("PendingKeyCreations.consume", () => {
  it("removes the entry and returns it on the first call", () => {
    const reg = new PendingKeyCreations();
    reg.open({
      userId: 1,
      targetQq: 999,
      name: "ci",
      aliveBotIds: [10],
      now: NOW,
    });

    const consumed = reg.consume(1, 999, NOW);
    expect(consumed).not.toBeNull();
    expect(consumed!.hostBotId).toBe(10);

    expect(reg.findByOwner(1, 999, NOW)).toBeNull();
    expect(reg.consume(1, 999, NOW)).toBeNull();
  });

  it("does not consume an expired entry", () => {
    const reg = new PendingKeyCreations();
    reg.open({
      userId: 1,
      targetQq: 999,
      name: "ci",
      aliveBotIds: [10],
      now: NOW,
    });

    expect(reg.consume(1, 999, NOW + TTL_MS + 1)).toBeNull();
  });
});

describe("PendingKeyCreations.gcExpired", () => {
  it("drops expired entries and keeps active ones", () => {
    const reg = new PendingKeyCreations();
    reg.open({
      userId: 1,
      targetQq: 999,
      name: "old",
      aliveBotIds: [10],
      now: NOW,
    });
    reg.open({
      userId: 2,
      targetQq: 888,
      name: "fresh",
      aliveBotIds: [20],
      now: NOW + TTL_MS, // last possible non-expiring open
    });

    reg.gcExpired(NOW + TTL_MS + 1);

    expect(reg.findByOwner(1, 999, NOW + TTL_MS + 1)).toBeNull();
    expect(reg.findByOwner(2, 888, NOW + TTL_MS + 1)).not.toBeNull();
  });
});
