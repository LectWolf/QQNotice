import { describe, expect, it } from "vitest";
import { FriendshipCache } from "../friendship/FriendshipCache.js";
import { Router, type RouterSnapshot } from "./Router.js";

function snapshot(opts: {
  bots: Array<{ id: number; alive: boolean }>;
  friendships: Array<[botId: number, qq: number]>;
}): RouterSnapshot {
  const cache = new FriendshipCache();
  for (const [b, q] of opts.friendships) cache.add(b, q);
  return { bots: opts.bots, cache };
}

describe("Router.decideOnCreate", () => {
  it("returns needsHandshake when no alive bot is friends with the target", () => {
    const router = new Router();
    const snap = snapshot({
      bots: [
        { id: 1, alive: true }, // alive but not a friend
        { id: 2, alive: false }, // friend but dead
      ],
      friendships: [[2, 999]],
    });

    const decision = router.decideOnCreate(999, snap);

    expect(decision).toEqual({ kind: "needsHandshake" });
  });

  it("binds to the only alive friendly bot when there is exactly one", () => {
    const router = new Router();
    const snap = snapshot({
      bots: [
        { id: 1, alive: true },
        { id: 2, alive: true },
        { id: 3, alive: false },
      ],
      friendships: [
        [1, 999], // friendly, alive — should win
        [3, 999], // friendly, dead — ineligible
      ],
    });

    const decision = router.decideOnCreate(999, snap);

    expect(decision).toEqual({ kind: "bind", botId: 1 });
  });

  it("uses the injected RNG to pick among multiple alive friendly bots", () => {
    const candidates = [10, 20, 30];
    // Force the RNG to pick index 1 every time (i.e. botId=20).
    const router = new Router({ pickIndex: (n) => (n === 3 ? 1 : 0) });
    const snap = snapshot({
      bots: candidates.map((id) => ({ id, alive: true })),
      friendships: candidates.map((id) => [id, 999] as [number, number]),
    });

    const decision = router.decideOnCreate(999, snap);

    expect(decision).toEqual({ kind: "bind", botId: 20 });
  });
});

describe("Router.decideOnSend", () => {
  it("sends through the bound bot when it is alive and still friends with the target", () => {
    const router = new Router();
    const snap = snapshot({
      bots: [
        { id: 1, alive: true },
        { id: 2, alive: true },
      ],
      friendships: [
        [1, 999],
        [2, 999],
      ],
    });

    const decision = router.decideOnSend(
      { boundBotId: 1, targetQq: 999 },
      snap,
    );

    expect(decision).toEqual({ kind: "send", botId: 1 });
  });

  it("trusts the bound bot when it is alive, even if the friend cache is empty for that pair", () => {
    // Per CONTEXT.md, the Router does NOT pre-check the friendship cache when
    // the bound bot is alive. The friendship-lost case is detected by an
    // actual `send_private_msg` failure: the caller then drops the cache
    // entry and re-routes. A stale or merely-empty cache must never make
    // us refuse a send the bot could have made.
    const router = new Router();
    const snap = snapshot({
      bots: [{ id: 1, alive: true }],
      friendships: [], // cache empty for (1, 999)
    });

    const decision = router.decideOnSend(
      { boundBotId: 1, targetQq: 999 },
      snap,
    );

    expect(decision).toEqual({ kind: "send", botId: 1 });
  });

  it("rebinds to another alive friendly bot when the bound bot is dead", () => {
    const router = new Router();
    const snap = snapshot({
      bots: [
        { id: 1, alive: false }, // bound, but dead
        { id: 2, alive: true }, // alive and friendly — the rescue
        { id: 3, alive: true }, // alive but not a friend
      ],
      friendships: [
        [1, 999],
        [2, 999],
      ],
    });

    const decision = router.decideOnSend(
      { boundBotId: 1, targetQq: 999 },
      snap,
    );

    expect(decision).toEqual({ kind: "rebindAndSend", newBotId: 2 });
  });

  it("fails 502 no_alive_friendly_bot when bound bot is dead and no other alive bot is friends", () => {
    const router = new Router();
    const snap = snapshot({
      bots: [
        { id: 1, alive: false }, // bound, dead
        { id: 2, alive: true }, // alive but not a friend
        { id: 3, alive: false }, // friendly but dead
      ],
      friendships: [
        [1, 999],
        [3, 999],
      ],
    });

    const decision = router.decideOnSend(
      { boundBotId: 1, targetQq: 999 },
      snap,
    );

    expect(decision).toEqual({
      kind: "fail",
      httpCode: 502,
      reason: "no_alive_friendly_bot",
    });
  });

  it("fails 503 bot_pool_empty when there are no Bots in the pool at all", () => {
    const router = new Router();
    const snap = snapshot({
      bots: [],
      friendships: [],
    });

    const decision = router.decideOnSend(
      { boundBotId: 999, targetQq: 999 },
      snap,
    );

    expect(decision).toEqual({
      kind: "fail",
      httpCode: 503,
      reason: "bot_pool_empty",
    });
  });
});

describe("Router.decideOnStartup", () => {
  it("leaves a SendKey alone when its bound bot is alive and the cache shows the friendship intact", () => {
    const router = new Router();
    const snap = snapshot({
      bots: [
        { id: 1, alive: true },
        { id: 2, alive: true },
      ],
      friendships: [[1, 999]],
    });

    const decision = router.decideOnStartup(
      { boundBotId: 1, targetQq: 999 },
      snap,
    );

    expect(decision).toEqual({ kind: "leave" });
  });

  it("rebinds when the bound bot lost the friendship but another alive bot has it", () => {
    const router = new Router();
    const snap = snapshot({
      bots: [
        { id: 1, alive: true }, // bound, alive, but no friendship anymore
        { id: 2, alive: true }, // alive, friendly — the rescue
      ],
      friendships: [[2, 999]],
    });

    const decision = router.decideOnStartup(
      { boundBotId: 1, targetQq: 999 },
      snap,
    );

    expect(decision).toEqual({ kind: "rebind", newBotId: 2 });
  });

  it("rebinds when the bound bot is dead but another alive bot is friends with the target", () => {
    const router = new Router();
    const snap = snapshot({
      bots: [
        { id: 1, alive: false }, // bound, dead
        { id: 2, alive: true }, // alive and friendly
      ],
      friendships: [
        [1, 999],
        [2, 999],
      ],
    });

    const decision = router.decideOnStartup(
      { boundBotId: 1, targetQq: 999 },
      snap,
    );

    expect(decision).toEqual({ kind: "rebind", newBotId: 2 });
  });

  it("disables the SendKey when no alive bot is friends with the target", () => {
    const router = new Router();
    const snap = snapshot({
      bots: [
        { id: 1, alive: false }, // dead, was the bound bot
        { id: 2, alive: true }, // alive but not a friend
        { id: 3, alive: false }, // friendly but dead
      ],
      friendships: [
        [1, 999],
        [3, 999],
      ],
    });

    const decision = router.decideOnStartup(
      { boundBotId: 1, targetQq: 999 },
      snap,
    );

    expect(decision).toEqual({ kind: "disable" });
  });
});
