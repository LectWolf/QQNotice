import { useEffect, useState } from "react";
import { api, getToken, setToken, type AuthUser } from "./api.js";
import { BotsAdmin } from "./BotsAdmin.js";
import { SendKeys } from "./SendKeys.js";
import { AdminKeys, AdminUsers } from "./AdminConsole.js";
import { AdminLogs, MyLogs } from "./Logs.js";
import { ErrorAlert, InfoAlert } from "./ui.js";
import { translateError } from "./errors.js";
import { navigate, useRoute } from "./router.js";

type AuthView = "login" | "register";

export function App(): JSX.Element {
  const [bootState, setBootState] = useState<"loading" | "anon" | "auth">(
    "loading",
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authView, setAuthView] = useState<AuthView>("login");
  const route = useRoute();

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setBootState("anon");
      return;
    }
    api.me().then((res) => {
      if (res.code === 0 && res.data) {
        setUser(res.data);
        setBootState("auth");
      } else {
        setToken(null);
        setBootState("anon");
      }
    });
  }, []);

  function handleAuthSuccess(u: AuthUser, token: string): void {
    setToken(token);
    setUser(u);
    setBootState("auth");
    navigate("/");
  }

  function handleLogout(): void {
    setToken(null);
    setUser(null);
    setBootState("anon");
    navigate("/");
  }

  if (bootState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
        <span className="animate-pulse">加载中…</span>
      </div>
    );
  }

  if (bootState === "anon") {
    return (
      <AuthHero>
        {authView === "login" ? (
          <LoginForm
            onSuccess={handleAuthSuccess}
            onSwitchToRegister={() => setAuthView("register")}
          />
        ) : (
          <RegisterForm
            onSuccess={handleAuthSuccess}
            onSwitchToLogin={() => setAuthView("login")}
          />
        )}
      </AuthHero>
    );
  }

  // Authenticated — render based on hash route.
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 bg-white/70 backdrop-blur-md border-b border-slate-200/70">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2.5 group"
          >
            <Logo />
            <span className="text-base font-semibold tracking-tight group-hover:text-brand-600">
              QQNotice
            </span>
          </button>
          {user && (
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden sm:inline text-slate-600">
                {user.username}
              </span>
              {user.isOperator && <span className="badge-brand">管理员</span>}
              <button onClick={handleLogout} className="btn-secondary btn-sm">
                退出
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 w-full">
        <Container>
          <Routes route={route} user={user} />
        </Container>
      </main>

      <footer className="text-center text-xs text-slate-400 py-6">
        Server酱 风格的 QQ 通知服务 · QQNotice
      </footer>
    </div>
  );
}

function Routes({
  route,
  user,
}: {
  route: string;
  user: AuthUser | null;
}): JSX.Element {
  if (!user) return <></>;

  if (route === "/keys")
    return (
      <SubPage onBack={() => navigate("/")}>
        <SendKeys />
      </SubPage>
    );
  if (route === "/me/logs")
    return (
      <SubPage onBack={() => navigate("/")}>
        <MyLogs />
      </SubPage>
    );
  if (route === "/admin/bots" && user.isOperator)
    return (
      <SubPage onBack={() => navigate("/")}>
        <BotsAdmin />
      </SubPage>
    );
  if (route === "/admin/users" && user.isOperator)
    return (
      <SubPage onBack={() => navigate("/")}>
        <AdminUsers />
      </SubPage>
    );
  if (route === "/admin/keys" && user.isOperator)
    return (
      <SubPage onBack={() => navigate("/")}>
        <AdminKeys />
      </SubPage>
    );
  if (route === "/admin/logs" && user.isOperator)
    return (
      <SubPage onBack={() => navigate("/")}>
        <AdminLogs />
      </SubPage>
    );

  // Unknown route or admin route as non-operator → home.
  return <Home user={user} />;
}

function Container({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="mx-auto w-full max-w-6xl px-6 py-8">{children}</div>;
}

function Logo(): JSX.Element {
  return (
    <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 via-brand-500 to-accent-500 text-white font-bold shadow-md shadow-brand-500/30">
      Q
    </span>
  );
}

function AuthHero({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <aside className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-brand-600 via-brand-500 to-accent-600 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30 mix-blend-overlay pointer-events-none">
          <div className="absolute -top-20 -left-20 w-96 h-96 rounded-full bg-white blur-3xl opacity-20" />
          <div className="absolute bottom-0 right-0 w-[28rem] h-[28rem] rounded-full bg-cyan-200 blur-3xl opacity-20" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 backdrop-blur text-white font-bold ring-1 ring-white/20">
              Q
            </span>
            <span className="text-lg font-semibold tracking-tight">QQNotice</span>
          </div>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-3xl font-bold leading-tight">
            一行 curl,把消息推到 QQ。
          </h1>
          <p className="mt-4 text-white/80 text-sm leading-relaxed">
            Server酱 风格的轻量通知服务。注册账号 → 创建 SendKey → 在脚本里调用 HTTP 接口,机器人就会私聊提醒你。
          </p>
          <ul className="mt-6 space-y-2 text-sm text-white/80">
            <li className="flex items-center gap-2">
              <span className="text-white">✓</span> 多机器人池自动路由,挂一个备一个
            </li>
            <li className="flex items-center gap-2">
              <span className="text-white">✓</span> 加好友自动同意,创建即可用
            </li>
            <li className="flex items-center gap-2">
              <span className="text-white">✓</span> 5 种调用形态,GET/POST 都支持
            </li>
          </ul>
        </div>
        <div className="relative text-xs text-white/60">
          基于 OneBot · NapCat · Fastify · React
        </div>
      </aside>
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex items-center justify-center gap-2.5">
            <Logo />
            <span className="text-lg font-semibold tracking-tight">QQNotice</span>
          </div>
          <div className="card">
            <div className="card-body">{children}</div>
          </div>
        </div>
      </section>
    </div>
  );
}

function SubPage({
  onBack,
  children,
}: {
  onBack: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-5">
      <button onClick={onBack} className="btn-ghost btn-sm -ml-2.5">
        ← 返回主页
      </button>
      {children}
    </div>
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
    else setError(translateError(res.message, res.code));
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">欢迎回来</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          登录后即可管理你的 SendKey。
        </p>
      </div>
      <div>
        <label className="label">用户名</label>
        <input
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoFocus
        />
      </div>
      <div>
        <label className="label">密码</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "登录中…" : "登录"}
      </button>
      <p className="text-sm text-slate-500 text-center">
        还没有账号?{" "}
        <button
          type="button"
          onClick={onSwitchToRegister}
          className="font-medium text-brand-600 hover:text-brand-700 hover:underline underline-offset-2"
        >
          立即注册
        </button>
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
    else setError(translateError(res.message, res.code));
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">创建账号</h2>
        <p className="mt-1.5 text-sm text-slate-500">需要管理员发的邀请码。</p>
      </div>
      <div>
        <label className="label">用户名</label>
        <input
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={3}
          maxLength={32}
          autoFocus
        />
        <div className="help">3–32 位字母、数字、下划线、连字符</div>
      </div>
      <div>
        <label className="label">密码</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          maxLength={72}
        />
        <div className="help">至少 8 位</div>
      </div>
      <div>
        <label className="label">邀请码</label>
        <input
          className="input"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          required
        />
      </div>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "提交中…" : "注册"}
      </button>
      <InfoAlert>
        没有邮箱找回:密码丢了只能重新注册一个用户名,SendKey 也会一起失效。
      </InfoAlert>
      <p className="text-sm text-slate-500 text-center">
        已经有账号?{" "}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="font-medium text-brand-600 hover:text-brand-700 hover:underline underline-offset-2"
        >
          直接登录
        </button>
      </p>
    </form>
  );
}

function Home({ user }: { user: AuthUser }): JSX.Element {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-brand-600 font-medium">欢迎回来</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          {user.username}
          {user.isOperator && (
            <span className="badge-brand ml-3 text-xs align-middle">
              管理员
            </span>
          )}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          创建 SendKey,通过 HTTP 接口把消息一行 curl 推到 QQ。
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <NavCard
          title="我的 SendKey"
          desc="创建、查看、删除推送 key,以及调用示例。"
          icon="🔑"
          onClick={() => navigate("/keys")}
        />
        <NavCard
          title="我的发送日志"
          desc="查看每一次 SendKey 调用的详情、目标、用时和成功失败。"
          icon="📜"
          onClick={() => navigate("/me/logs")}
        />
        {user.isOperator && (
          <>
            <NavCard
              title="管理机器人池"
              desc="添加 / 编辑 NapCat 机器人,查看在线状态与好友数。"
              icon="🤖"
              onClick={() => navigate("/admin/bots")}
              tag="管理员"
            />
            <NavCard
              title="用户管理"
              desc="查看所有注册用户,必要时删除账号。"
              icon="👥"
              onClick={() => navigate("/admin/users")}
              tag="管理员"
            />
            <NavCard
              title="所有 SendKey"
              desc="跨用户审计 SendKey,启用 / 禁用,刷新好友列表。"
              icon="📋"
              onClick={() => navigate("/admin/keys")}
              tag="管理员"
            />
            <NavCard
              title="调用日志"
              desc="跨用户查看每一次 /send 调用,定位失败原因。"
              icon="🔍"
              onClick={() => navigate("/admin/logs")}
              tag="管理员"
            />
          </>
        )}
      </div>
    </div>
  );
}

function NavCard({
  title,
  desc,
  onClick,
  icon,
  tag,
}: {
  title: string;
  desc: string;
  onClick: () => void;
  icon: string;
  tag?: string;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="card text-left p-0 hover:border-brand-300 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 group"
    >
      <div className="card-body">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-xl ring-1 ring-brand-100">
              {icon}
            </span>
            <h3 className="font-semibold text-slate-900 group-hover:text-brand-600 transition-colors">
              {title}
            </h3>
          </div>
          {tag && <span className="badge-brand">{tag}</span>}
        </div>
        <p className="mt-3 text-sm text-slate-500 leading-relaxed">{desc}</p>
        <div className="mt-4 text-xs text-brand-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
          打开 →
        </div>
      </div>
    </button>
  );
}
