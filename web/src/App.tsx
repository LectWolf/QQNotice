import { useEffect, useState } from "react";
import { api, getToken, setToken, type AuthUser } from "./api.js";

type View = "loading" | "login" | "register" | "home";

export function App(): JSX.Element {
  const [view, setView] = useState<View>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setView("login");
      return;
    }
    api.me().then((res) => {
      if (res.code === 0 && res.data) {
        setUser(res.data);
        setView("home");
      } else {
        setToken(null);
        setView("login");
      }
    });
  }, []);

  function handleAuthSuccess(u: AuthUser, token: string): void {
    setToken(token);
    setUser(u);
    setView("home");
  }

  function handleLogout(): void {
    setToken(null);
    setUser(null);
    setView("login");
  }

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={{ margin: 0 }}>QQNotice</h1>
        <p style={{ margin: "0.25rem 0 0", color: "#666" }}>
          Server酱 风格的 QQ 通知服务
        </p>
      </header>
      {view === "loading" ? (
        <p>加载中…</p>
      ) : view === "login" ? (
        <LoginForm
          onSuccess={handleAuthSuccess}
          onSwitchToRegister={() => setView("register")}
        />
      ) : view === "register" ? (
        <RegisterForm
          onSuccess={handleAuthSuccess}
          onSwitchToLogin={() => setView("login")}
        />
      ) : (
        <Home user={user!} onLogout={handleLogout} />
      )}
    </main>
  );
}

function LoginForm({
  onSuccess,
  onSwitchToRegister,
}: {
  onSuccess: (u: AuthUser, token: string) => void;
  onSwitchToRegister: () => void;
}): JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await api.login({ username, password });
    setBusy(false);
    if (res.code === 0 && res.data) onSuccess(res.data.user, res.data.token);
    else setError(res.message);
  }

  return (
    <form onSubmit={submit} style={formStyle}>
      <h2>登录</h2>
      <Field label="用户名">
        <input value={username} onChange={(e) => setUsername(e.target.value)} required />
      </Field>
      <Field label="密码">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <button type="submit" disabled={busy}>
        {busy ? "登录中…" : "登录"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <p>
        还没有账号?{" "}
        <a href="#" onClick={(e) => (e.preventDefault(), onSwitchToRegister())}>
          注册
        </a>
      </p>
    </form>
  );
}

function RegisterForm({
  onSuccess,
  onSwitchToLogin,
}: {
  onSuccess: (u: AuthUser, token: string) => void;
  onSwitchToLogin: () => void;
}): JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await api.register({ username, password, inviteCode });
    setBusy(false);
    if (res.code === 0 && res.data) onSuccess(res.data.user, res.data.token);
    else setError(res.message);
  }

  return (
    <form onSubmit={submit} style={formStyle}>
      <h2>注册</h2>
      <Field label="用户名(3–32 位字母数字下划线连字符)">
        <input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={32} />
      </Field>
      <Field label="密码(至少 8 位)">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={72} />
      </Field>
      <Field label="邀请码">
        <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required />
      </Field>
      <button type="submit" disabled={busy}>
        {busy ? "提交中…" : "注册"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        没有邮箱找回:密码丢了只能重新注册一个用户名。
      </p>
      <p>
        已经有账号?{" "}
        <a href="#" onClick={(e) => (e.preventDefault(), onSwitchToLogin())}>
          登录
        </a>
      </p>
    </form>
  );
}

function Home({ user, onLogout }: { user: AuthUser; onLogout: () => void }): JSX.Element {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p>
        欢迎,<strong>{user.username}</strong>
        {user.isOperator && (
          <span style={badgeStyle}>Operator</span>
        )}
      </p>
      <p style={{ color: "#666" }}>
        SendKey 管理界面会在后续切片中加入。当前阶段你可以通过
        <code> /api/dev/probe </code> 与 NapCat 联调。
      </p>
      <button onClick={onLogout}>退出登录</button>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <span style={{ fontSize: "0.9rem", color: "#444" }}>{label}</span>
      {children}
    </label>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  maxWidth: 480,
  margin: "2rem auto",
  padding: "0 1rem",
  display: "flex",
  flexDirection: "column",
  gap: "1.5rem",
};

const headerStyle: React.CSSProperties = {
  borderBottom: "1px solid #eee",
  paddingBottom: "1rem",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
};

const badgeStyle: React.CSSProperties = {
  marginLeft: "0.5rem",
  padding: "0.125rem 0.5rem",
  borderRadius: 4,
  background: "#fee",
  color: "#a33",
  fontSize: "0.8rem",
};
