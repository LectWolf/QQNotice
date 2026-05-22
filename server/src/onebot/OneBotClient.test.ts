import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeNapcat, heartbeatPayload } from "./__tests__/fakeNapcat.js";
import { OneBotClient } from "./OneBotClient.js";

describe("OneBotClient", () => {
  let napcat: FakeNapcat;

  beforeEach(async () => {
    napcat = await FakeNapcat.start();
  });

  afterEach(async () => {
    await napcat.stop();
  });

  it("emits the heartbeat payload it receives from NapCat", async () => {
    const client = new OneBotClient({ url: napcat.url });

    const heartbeats: unknown[] = [];
    client.on("heartbeat", (p) => heartbeats.push(p));

    client.connect();
    await napcat.waitForConnection();

    const payload = heartbeatPayload({ selfId: 12345, interval: 5000 });
    napcat.send(payload);

    // Allow the message to flush through the socket.
    await new Promise((r) => setTimeout(r, 20));

    expect(heartbeats).toHaveLength(1);
    expect(heartbeats[0]).toEqual(payload);

    client.disconnect();
  });

  it("resolves a request even when the WS handshake has not yet completed at call time", async () => {
    const client = new OneBotClient({ url: napcat.url });

    napcat.onAnyConnection((conn) => {
      conn.socket.on("message", (raw) => {
        const req = JSON.parse(raw.toString()) as { echo: string };
        conn.socket.send(JSON.stringify({ data: { ok: true }, echo: req.echo }));
      });
    });

    client.connect();
    // Issue the request *before* awaiting the connection — exercises the
    // race that can happen when callers don't synchronise on connect().
    const result = await client.request<{ ok: true }>("get_login_info");

    expect(result).toEqual({ ok: true });

    client.disconnect();
  });

  it("resolves a request by matching the OneBot `echo` field", async () => {
    const client = new OneBotClient({ url: napcat.url });
    client.connect();
    const conn = await napcat.waitForConnection();

    // Echo every action back with a successful response.
    conn.socket.on("message", (raw) => {
      const req = JSON.parse(raw.toString()) as {
        action: string;
        params: unknown;
        echo: string;
      };
      conn.socket.send(
        JSON.stringify({
          status: "ok",
          retcode: 0,
          data: { received: req.params },
          echo: req.echo,
        }),
      );
    });

    const result = await client.request<{ received: { user_id: number } }>(
      "send_private_msg",
      { user_id: 999, message: "hi" },
    );

    expect(result).toEqual({ received: { user_id: 999, message: "hi" } });

    client.disconnect();
  });

  it("rejects a request with a timeout error when no echo arrives in time", async () => {
    const client = new OneBotClient({ url: napcat.url });
    client.connect();
    await napcat.waitForConnection();
    // The fake NapCat does NOT echo back, so the request must time out.

    const start = Date.now();
    await expect(
      client.request("get_login_info", undefined, 50),
    ).rejects.toThrow(/timeout/i);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(500);

    client.disconnect();
  });

  it("sends the access token as a Bearer Authorization header on the WS upgrade", async () => {
    const client = new OneBotClient({
      url: napcat.url,
      accessToken: "secret-123",
    });
    client.connect();
    const conn = await napcat.waitForConnection();

    expect(conn.upgradeHeaders.authorization).toBe("Bearer secret-123");

    client.disconnect();
  });

  it("does not send an Authorization header when no access token is given", async () => {
    const client = new OneBotClient({ url: napcat.url });
    client.connect();
    const conn = await napcat.waitForConnection();

    expect(conn.upgradeHeaders.authorization).toBeUndefined();

    client.disconnect();
  });

  it("emits `disconnected` and rejects pending requests when the server closes the connection", async () => {
    const client = new OneBotClient({ url: napcat.url });

    let disconnectedCount = 0;
    client.on("disconnected", () => disconnectedCount++);

    client.connect();
    await napcat.waitForConnection();

    const pending = client.request("get_login_info", undefined, 5000);
    // Give the request a moment to register before we yank the connection.
    await new Promise((r) => setTimeout(r, 10));
    napcat.closeConnection();

    await expect(pending).rejects.toThrow(/disconnect/i);
    // Allow the close event to fully flush.
    await new Promise((r) => setTimeout(r, 20));
    expect(disconnectedCount).toBe(1);
  });

  it("emits `lifecycle` for OneBot lifecycle meta-events", async () => {
    const client = new OneBotClient({ url: napcat.url });
    const subs: string[] = [];
    client.on("lifecycle", (sub) => subs.push(sub));

    client.connect();
    await napcat.waitForConnection();

    napcat.send({
      time: 1700000000,
      self_id: 12345,
      post_type: "meta_event",
      meta_event_type: "lifecycle",
      sub_type: "connect",
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(subs).toEqual(["connect"]);

    client.disconnect();
  });

  it("emits `friendRequest` with qq and flag when a request.friend arrives", async () => {
    const client = new OneBotClient({ url: napcat.url });
    const seen: Array<{ qq: number; flag: string }> = [];
    client.on("friendRequest", (qq, flag) => seen.push({ qq, flag }));

    client.connect();
    await napcat.waitForConnection();

    napcat.send({
      time: 1700000000,
      self_id: 12345,
      post_type: "request",
      request_type: "friend",
      user_id: 99887766,
      comment: "hi let's be friends",
      flag: "abc-flag-xyz",
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([{ qq: 99887766, flag: "abc-flag-xyz" }]);

    client.disconnect();
  });
});
