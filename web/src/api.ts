export type Envelope<T = unknown> = {
  code: number;
  message: string;
  data?: T;
};

export type AuthUser = {
  id: number;
  username: string;
  isOperator: boolean;
};

export type AuthData = { token: string; user: AuthUser };

export type BotStatus = {
  botId: number;
  qq: number;
  name: string;
  enabled: boolean;
  wsState: "open" | "connecting" | "closed";
  lastHeartbeatAt: number | null;
  heartbeatInterval: number | null;
  online: boolean;
  alive: boolean;
  friendCount: number;
};

export type SendKey = {
  id: number;
  name: string;
  targetQq: number;
  botId: number;
  prefix: string;
  /**
   * Full plaintext key, when known. New keys (created after plaintext
   * storage was introduced) always have a value here. Legacy rows expose
   * `null` and the UI falls back to a prefix-only chip with a hint.
   */
  plaintext: string | null;
  state: "active" | "disabled";
  createdAt: string;
  lastUsedAt: string | null;
};

export type CreatedSendKey = SendKey & { plaintext: string };

export type PublicBot = {
  qq: number;
  name: string;
  alive: boolean;
};

export type PendingHandshake = {
  hostBotQq: number;
  expiresAt: number;
};

const TOKEN_KEY = "qqnotice.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<Envelope<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await res.json()) as Envelope<T>;
}

export const api = {
  ping: () => request("GET", "/api/ping"),
  register: (input: { username: string; password: string; inviteCode: string }) =>
    request<AuthData>("POST", "/api/auth/register", input),
  login: (input: { username: string; password: string }) =>
    request<AuthData>("POST", "/api/auth/login", input),
  me: () => request<AuthUser>("GET", "/api/me"),
  changePassword: (input: { oldPassword: string; newPassword: string }) =>
    request("POST", "/api/me/password", input),

  // Operator-only
  listBots: () => request<BotStatus[]>("GET", "/api/admin/bots"),
  createBot: (input: {
    name: string;
    qq: number;
    wsUrl: string;
    accessToken?: string | null;
  }) => request<{ id: number; qq: number }>("POST", "/api/admin/bots", input),
  updateBot: (
    id: number,
    input: Partial<{
      name: string;
      qq: number;
      wsUrl: string;
      accessToken: string | null;
      enabled: boolean;
    }>,
  ) => request("PATCH", `/api/admin/bots/${id}`, input),
  deleteBot: (id: number) =>
    request("DELETE", `/api/admin/bots/${id}`),

  // SendKeys
  listPublicBots: () => request<PublicBot[]>("GET", "/api/bots"),
  listSendKeys: () => request<SendKey[]>("GET", "/api/me/keys"),
  createSendKey: (input: { name: string; targetQq: number }) =>
    request<CreatedSendKey | PendingHandshake>("POST", "/api/me/keys", input),
  finalizeSendKey: (input: { targetQq: number }) =>
    request<CreatedSendKey | PendingHandshake>(
      "POST",
      "/api/me/keys/finalize",
      input,
    ),
  deleteSendKey: (id: number) =>
    request("DELETE", `/api/me/keys/${id}`),
  testSendKey: (id: number) =>
    request("POST", `/api/me/keys/${id}/test`, {}),

  // Operator: users / keys / friendships
  listUsers: () =>
    request<
      Array<{
        id: number;
        username: string;
        isOperator: boolean;
        sendKeyCount: number;
        createdAt: string;
      }>
    >("GET", "/api/admin/users"),
  deleteUser: (id: number) => request("DELETE", `/api/admin/users/${id}`),
  listAllSendKeys: () =>
    request<
      Array<{
        id: number;
        userId: number;
        username: string;
        name: string;
        targetQq: number;
        botId: number;
        state: "active" | "disabled";
        prefix: string;
        plaintext: string | null;
        createdAt: string;
        lastUsedAt: string | null;
      }>
    >("GET", "/api/admin/keys"),
  updateAdminSendKey: (id: number, state: "active" | "disabled") =>
    request("PATCH", `/api/admin/keys/${id}`, { state }),
  refreshFriendships: () =>
    request<{ refreshed: number; skipped: number; durationMs: number }>(
      "POST",
      "/api/admin/friendships/refresh",
    ),
};
