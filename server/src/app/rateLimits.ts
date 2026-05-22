import type { FastifyInstance, FastifyRequest } from "fastify";

export type RateLimitConfig = {
  /** Per-SendKey, per-minute on /send*. */
  perSendKeyPerMinute: number;
  /** Per-IP, per-minute on /send*. */
  perIpSendPerMinute: number;
  /** Per-IP, per-15-minutes on /api/auth/*. */
  perIpAuthPer15Minutes: number;
};

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  perSendKeyPerMinute: 60,
  perIpSendPerMinute: 1000,
  perIpAuthPer15Minutes: 10,
};

type Bucket = { count: number; resetAt: number };

function takeSlot(
  buckets: Map<string, Bucket>,
  key: string,
  windowMs: number,
  max: number,
  now: number,
): { allowed: boolean; retryAfterSeconds: number } {
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  if (b.count > max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Resolves the SendKey embedded in a /send* request the same way the
 * pipeline does. Returned `null` falls through to per-IP limiting.
 */
function rateLimitKeyForSend(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return `sk:${m[1]!.trim().slice(0, 16)}`;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.key === "string" && body.key.length > 0) {
    return `sk:${body.key.slice(0, 16)}`;
  }
  const query = req.query as Record<string, unknown>;
  if (typeof query?.key === "string" && query.key.length > 0) {
    return `sk:${query.key.slice(0, 16)}`;
  }
  const params = req.params as Record<string, unknown>;
  if (typeof params?.sendkey === "string" && params.sendkey.length > 0) {
    return `sk:${params.sendkey.slice(0, 16)}`;
  }
  return null;
}

/**
 * Mounts the three rate-limit buckets per CONTEXT.md as Fastify hooks.
 * Counters are in-process; sufficient for single-instance deployments.
 *
 * Hooks fire on `preHandler` (after the body is parsed and route params /
 * query are available, which is critical for SendKey resolution).
 */
export function registerRateLimits(
  app: FastifyInstance,
  config: RateLimitConfig,
): void {
  const sendKeyBuckets = new Map<string, Bucket>();
  const ipSendBuckets = new Map<string, Bucket>();
  const ipAuthBuckets = new Map<string, Bucket>();

  app.addHook("preHandler", async (req, reply) => {
    const url = req.raw.url ?? "";
    const now = Date.now();

    if (url.startsWith("/send")) {
      // Per-SendKey first (so a flooded key doesn't pollute per-IP for
      // unrelated callers behind the same NAT).
      const skKey = rateLimitKeyForSend(req);
      if (skKey) {
        const r = takeSlot(
          sendKeyBuckets,
          skKey,
          60_000,
          config.perSendKeyPerMinute,
          now,
        );
        if (!r.allowed) {
          reply
            .status(429)
            .header("Retry-After", String(r.retryAfterSeconds))
            .send({ code: 429, message: "rate_limit_exceeded" });
          return;
        }
      }

      const r = takeSlot(
        ipSendBuckets,
        `ip:${req.ip}`,
        60_000,
        config.perIpSendPerMinute,
        now,
      );
      if (!r.allowed) {
        reply
          .status(429)
          .header("Retry-After", String(r.retryAfterSeconds))
          .send({ code: 429, message: "rate_limit_exceeded_ip" });
        return;
      }
    }

    if (url.startsWith("/api/auth/")) {
      const r = takeSlot(
        ipAuthBuckets,
        `ip:${req.ip}`,
        15 * 60_000,
        config.perIpAuthPer15Minutes,
        now,
      );
      if (!r.allowed) {
        reply
          .status(429)
          .header("Retry-After", String(r.retryAfterSeconds))
          .send({ code: 429, message: "rate_limit_exceeded_auth" });
        return;
      }
    }
  });
}
