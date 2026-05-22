import { describe, expect, it } from "vitest";
import { computeBotAlive, type BotHealthSnapshot } from "./computeBotAlive.js";

const NOW = 1_000_000;

function snap(overrides: Partial<BotHealthSnapshot> = {}): BotHealthSnapshot {
  return {
    wsState: "open",
    lastHeartbeatAt: NOW - 1000,
    lastHeartbeatInterval: 5000,
    online: true,
    sendFailureShortCircuitUntil: 0,
    now: NOW,
    ...overrides,
  };
}

describe("computeBotAlive", () => {
  it("is alive when WS is open, heartbeat is recent, and online=true", () => {
    expect(computeBotAlive(snap())).toBe(true);
  });

  it("is dead when WS is not open", () => {
    expect(computeBotAlive(snap({ wsState: "closed" }))).toBe(false);
    expect(computeBotAlive(snap({ wsState: "connecting" }))).toBe(false);
  });

  it("is dead when no heartbeat has arrived yet", () => {
    expect(
      computeBotAlive(
        snap({ lastHeartbeatAt: null, lastHeartbeatInterval: null }),
      ),
    ).toBe(false);
  });

  it("is dead when the last heartbeat is older than 2 × interval", () => {
    // interval=5000, so window is 10000 ms.
    expect(
      computeBotAlive(snap({ lastHeartbeatAt: NOW - 10_001 })),
    ).toBe(false);
  });

  it("is alive when the last heartbeat is exactly within the window", () => {
    expect(computeBotAlive(snap({ lastHeartbeatAt: NOW - 9_999 }))).toBe(true);
  });

  it("is dead when the heartbeat reported online=false", () => {
    expect(computeBotAlive(snap({ online: false }))).toBe(false);
  });

  it("is dead when a send-failure short-circuit is still in effect", () => {
    expect(
      computeBotAlive(snap({ sendFailureShortCircuitUntil: NOW + 5_000 })),
    ).toBe(false);
  });

  it("becomes alive again once the short-circuit window has elapsed", () => {
    expect(
      computeBotAlive(snap({ sendFailureShortCircuitUntil: NOW - 1 })),
    ).toBe(true);
  });
});
