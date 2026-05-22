import { AddressInfo, type IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

/**
 * In-process WS server that mimics the slice of NapCat's OneBot v11 protocol
 * relevant to OneBotClient. One instance per test for isolation.
 */
export class FakeNapcat {
  private wss: WebSocketServer;
  private connections: Array<{
    socket: WebSocket;
    upgradeHeaders: IncomingMessage["headers"];
  }> = [];

  private constructor(wss: WebSocketServer) {
    this.wss = wss;
    this.wss.on("connection", (socket, req) => {
      this.connections.push({ socket, upgradeHeaders: req.headers });
    });
  }

  static async start(): Promise<FakeNapcat> {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      wss.once("listening", resolve);
      wss.once("error", reject);
    });
    return new FakeNapcat(wss);
  }

  get url(): string {
    const addr = this.wss.address() as AddressInfo;
    return `ws://${addr.address}:${addr.port}`;
  }

  /** Wait until the next client connects (or returns immediately if one already has). */
  async waitForConnection(index = 0): Promise<{
    socket: WebSocket;
    upgradeHeaders: IncomingMessage["headers"];
  }> {
    while (this.connections.length <= index) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return this.connections[index]!;
  }

  /** Send a JSON event/payload to the most recent connection. */
  send(payload: unknown, connectionIndex = 0): void {
    const c = this.connections[connectionIndex];
    if (!c) throw new Error("no connection yet");
    c.socket.send(JSON.stringify(payload));
  }

  closeConnection(connectionIndex = 0): void {
    this.connections[connectionIndex]?.socket.close();
  }

  async stop(): Promise<void> {
    for (const c of this.connections) {
      try {
        c.socket.terminate();
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

export function heartbeatPayload(opts: {
  selfId: number;
  online?: boolean;
  interval?: number;
  time?: number;
}): unknown {
  return {
    time: opts.time ?? Math.floor(Date.now() / 1000),
    self_id: opts.selfId,
    post_type: "meta_event",
    meta_event_type: "heartbeat",
    status: { online: opts.online ?? true, good: true },
    interval: opts.interval ?? 5000,
  };
}
