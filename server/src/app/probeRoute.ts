import type { FastifyInstance } from "fastify";
import { OneBotClient } from "../onebot/OneBotClient.js";

type ProbeBody = {
  wsUrl: string;
  accessToken?: string | null;
  targetQq: number;
  content: string;
};

/**
 * Dev-only diagnostic. Opens a one-shot OneBotClient against a NapCat
 * endpoint, waits for the first heartbeat, sends `send_private_msg`, and
 * returns the heartbeat payload alongside the result.
 *
 * Mounted only when NODE_ENV !== "production".
 */
export function registerProbeRoute(app: FastifyInstance): void {
  app.post<{ Body: ProbeBody }>(
    "/api/dev/probe",
    {
      schema: {
        body: {
          type: "object",
          required: ["wsUrl", "targetQq", "content"],
          properties: {
            wsUrl: { type: "string", minLength: 1 },
            accessToken: { type: ["string", "null"] },
            targetQq: { type: "integer" },
            content: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      const { wsUrl, accessToken, targetQq, content } = req.body;
      const client = new OneBotClient({ url: wsUrl, accessToken });

      const heartbeat = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("timeout waiting for heartbeat")),
          15_000,
        );
        client.on("heartbeat", (p) => {
          clearTimeout(timer);
          resolve(p);
        });
        client.on("disconnected", () => {
          clearTimeout(timer);
          reject(new Error("disconnected before heartbeat"));
        });
        client.connect();
      }).catch((err: unknown) => {
        client.disconnect();
        throw err;
      });

      app.log.info({ heartbeat, wsUrl }, "first heartbeat from probe");

      try {
        await client.request("send_private_msg", {
          user_id: targetQq,
          message: content,
        });
        return reply.send({ code: 0, message: "ok", heartbeat });
      } finally {
        client.disconnect();
      }
    },
  );
}
