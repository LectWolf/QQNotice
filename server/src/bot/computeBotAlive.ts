/**
 * Inputs needed to decide whether a Bot is currently `alive`.
 * Pure: no clock access — `now` is passed in.
 */
export type BotHealthSnapshot = {
  wsState: "open" | "connecting" | "closed";
  /** Epoch ms of the most recent heartbeat received, or null if none yet. */
  lastHeartbeatAt: number | null;
  /** `interval` field reported by the most recent heartbeat (ms), or null. */
  lastHeartbeatInterval: number | null;
  /** `status.online` from the most recent heartbeat. */
  online: boolean;
  /**
   * Epoch ms until which a send-failure short-circuit overrides everything
   * and the bot is reported `dead`. Set to 0 (or any past value) when not in
   * effect.
   */
  sendFailureShortCircuitUntil: number;
  /** Current time, epoch ms. */
  now: number;
};

/**
 * Per CONTEXT.md: a Bot is alive only when WS is open, the most recent
 * heartbeat is within `2 × interval`, and `status.online === true`. A
 * send-failure short-circuit overrides everything to `dead` until the
 * deadline elapses.
 */
export function computeBotAlive(s: BotHealthSnapshot): boolean {
  if (s.sendFailureShortCircuitUntil > s.now) return false;
  if (s.wsState !== "open") return false;
  if (!s.online) return false;
  if (s.lastHeartbeatAt === null || s.lastHeartbeatInterval === null) {
    return false;
  }
  const window = 2 * s.lastHeartbeatInterval;
  return s.now - s.lastHeartbeatAt <= window;
}
