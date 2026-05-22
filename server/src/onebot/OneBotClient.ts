import { WebSocket } from "ws";

/**
 * Owns one forward-WebSocket connection to a NapCat (OneBot v11) endpoint.
 * Public surface is intentionally narrow; everything internal can be refactored
 * without touching tests.
 */
export interface OneBotClientOptions {
  url: string;
  accessToken?: string | null;
}

export type OneBotEventMap = {
  heartbeat: (payload: unknown) => void;
  lifecycle: (sub: "connect" | "enable" | "disable") => void;
  friendRequest: (qq: number, flag: string) => void;
  disconnected: () => void;
};

type Listener<E extends keyof OneBotEventMap> = OneBotEventMap[E];

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

export class OneBotClient {
  private readonly url: string;
  private readonly accessToken: string | null;
  private ws: WebSocket | null = null;
  private listeners: { [E in keyof OneBotEventMap]?: Array<Listener<E>> } = {};
  private pending = new Map<string, Pending>();
  private echoSeq = 0;

  constructor(opts: OneBotClientOptions) {
    this.url = opts.url;
    this.accessToken = opts.accessToken ?? null;
  }

  connect(): void {
    if (this.ws) return;
    const headers: Record<string, string> = {};
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    const ws = new WebSocket(this.url, { headers });
    this.ws = ws;

    ws.on("message", (raw) => this.handleMessage(raw.toString()));
    ws.on("close", () => this.handleClose());
    ws.on("error", () => {
      /* errors arrive as close events too; suppress unhandled noise */
    });
  }

  disconnect(): void {
    if (!this.ws) return;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  request<T>(action: string, params?: unknown, timeoutMs = 3000): Promise<T> {
    if (!this.ws) {
      return Promise.reject(new Error("not connected"));
    }
    const ws = this.ws;
    const echo = `r${++this.echoSeq}`;
    const frame = JSON.stringify({ action, params, echo });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error(`timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(echo, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(frame);
      } else {
        ws.once("open", () => {
          if (this.pending.has(echo)) ws.send(frame);
        });
      }
    });
  }

  on<E extends keyof OneBotEventMap>(event: E, cb: OneBotEventMap[E]): void {
    const bucket = (this.listeners[event] ??= [] as Array<Listener<E>>) as Array<
      Listener<E>
    >;
    bucket.push(cb);
  }

  private emit<E extends keyof OneBotEventMap>(
    event: E,
    ...args: Parameters<OneBotEventMap[E]>
  ): void {
    const bucket = this.listeners[event] as Array<Listener<E>> | undefined;
    if (!bucket) return;
    for (const cb of bucket) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }

  private handleClose(): void {
    this.ws = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("disconnected"));
    }
    this.pending.clear();
    this.emit("disconnected");
  }

  private handleMessage(text: string): void {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return;
    }
    if (!json || typeof json !== "object") return;
    const obj = json as Record<string, unknown>;

    if (typeof obj.echo === "string") {
      const p = this.pending.get(obj.echo);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(obj.echo);
        p.resolve(obj.data);
      }
      return;
    }

    if (
      obj.post_type === "meta_event" &&
      obj.meta_event_type === "heartbeat"
    ) {
      this.emit("heartbeat", obj);
      return;
    }

    if (
      obj.post_type === "meta_event" &&
      obj.meta_event_type === "lifecycle"
    ) {
      const sub = obj.sub_type;
      if (sub === "connect" || sub === "enable" || sub === "disable") {
        this.emit("lifecycle", sub);
      }
      return;
    }

    if (obj.post_type === "request" && obj.request_type === "friend") {
      const qq = typeof obj.user_id === "number" ? obj.user_id : Number(obj.user_id);
      const flag = typeof obj.flag === "string" ? obj.flag : "";
      if (Number.isFinite(qq) && flag) {
        this.emit("friendRequest", qq, flag);
      }
      return;
    }
  }
}
