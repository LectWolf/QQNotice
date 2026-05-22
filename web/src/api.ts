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
};
