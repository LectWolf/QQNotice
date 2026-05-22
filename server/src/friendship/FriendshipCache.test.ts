import { describe, expect, it } from "vitest";
import { FriendshipCache } from "./FriendshipCache.js";

describe("FriendshipCache", () => {
  it("reports no friendships before anything is added", () => {
    const cache = new FriendshipCache();

    expect(cache.has(1, 100)).toBe(false);
    expect(cache.findFriendlyBots(100, [1, 2, 3])).toEqual([]);
  });

  it("remembers an added (botId, qq) and leaves siblings alone", () => {
    const cache = new FriendshipCache();

    cache.add(1, 100);

    expect(cache.has(1, 100)).toBe(true);
    expect(cache.has(1, 101)).toBe(false); // different qq, same bot
    expect(cache.has(2, 100)).toBe(false); // same qq, different bot
  });

  describe("findFriendlyBots", () => {
    function setup(pairs: Array<[botId: number, qq: number]>): FriendshipCache {
      const cache = new FriendshipCache();
      for (const [b, q] of pairs) cache.add(b, q);
      return cache;
    }

    type Case = {
      name: string;
      pairs: Array<[number, number]>;
      qq: number;
      alive: number[];
      expected: number[];
    };

    const cases: Case[] = [
      {
        name: "no friends → []",
        pairs: [],
        qq: 100,
        alive: [1, 2, 3],
        expected: [],
      },
      {
        name: "one alive bot is a friend → [that bot]",
        pairs: [[1, 100]],
        qq: 100,
        alive: [1, 2, 3],
        expected: [1],
      },
      {
        name: "friend exists but bot is not alive → []",
        pairs: [[1, 100]],
        qq: 100,
        alive: [2, 3],
        expected: [],
      },
      {
        name: "multiple friends, only intersection with alive returned",
        pairs: [
          [1, 100],
          [2, 100],
          [3, 100],
        ],
        qq: 100,
        alive: [2, 3, 4],
        expected: [2, 3],
      },
      {
        name: "different qq does not contribute",
        pairs: [
          [1, 100],
          [1, 200],
          [2, 200],
        ],
        qq: 100,
        alive: [1, 2],
        expected: [1],
      },
      {
        name: "alive list is empty → []",
        pairs: [[1, 100]],
        qq: 100,
        alive: [],
        expected: [],
      },
    ];

    for (const c of cases) {
      it(c.name, () => {
        const cache = setup(c.pairs);
        expect(cache.findFriendlyBots(c.qq, c.alive).sort()).toEqual(
          c.expected.slice().sort(),
        );
      });
    }
  });

  it("drops a single (botId, qq) without affecting other entries", () => {
    const cache = new FriendshipCache();
    cache.add(1, 100);
    cache.add(1, 101);
    cache.add(2, 100);

    cache.drop(1, 100);

    expect(cache.has(1, 100)).toBe(false);
    expect(cache.has(1, 101)).toBe(true); // sibling on same bot survived
    expect(cache.has(2, 100)).toBe(true); // same qq on other bot survived
  });

  it("drop is idempotent for a non-existent pair", () => {
    const cache = new FriendshipCache();
    cache.add(1, 100);

    expect(() => cache.drop(99, 999)).not.toThrow();
    expect(cache.has(1, 100)).toBe(true);
  });

  describe("replaceAllForBot", () => {
    it("installs the new friend set when the bot was previously empty", () => {
      const cache = new FriendshipCache();

      cache.replaceAllForBot(1, [100, 101, 102]);

      expect(cache.has(1, 100)).toBe(true);
      expect(cache.has(1, 101)).toBe(true);
      expect(cache.has(1, 102)).toBe(true);
    });

    it("removes friends that no longer appear in the new list", () => {
      const cache = new FriendshipCache();
      cache.add(1, 100);
      cache.add(1, 200);

      cache.replaceAllForBot(1, [100, 300]); // 200 removed, 300 added

      expect(cache.has(1, 100)).toBe(true);
      expect(cache.has(1, 200)).toBe(false);
      expect(cache.has(1, 300)).toBe(true);
    });

    it("does not touch any other bot's friend list", () => {
      const cache = new FriendshipCache();
      cache.add(1, 100);
      cache.add(2, 100);
      cache.add(2, 200);

      cache.replaceAllForBot(1, []);

      expect(cache.has(1, 100)).toBe(false);
      expect(cache.has(2, 100)).toBe(true);
      expect(cache.has(2, 200)).toBe(true);
    });

    it("clears the bot's friend list when given an empty array", () => {
      const cache = new FriendshipCache();
      cache.add(1, 100);
      cache.add(1, 200);

      cache.replaceAllForBot(1, []);

      expect(cache.has(1, 100)).toBe(false);
      expect(cache.has(1, 200)).toBe(false);
      expect(cache.findFriendlyBots(100, [1])).toEqual([]);
    });
  });
});
