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
};
