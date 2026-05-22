import { useCallback, useEffect, useState } from "react";
import { api, type BotStatus } from "./api.js";

export function BotsAdmin(): JSX.Element {
  const [bots, setBots] = useState<BotStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const refresh = useCallback(async () => {
    const res = await api.listBots();
    if (res.code === 0 && res.data) setBots(res.data);
    else setError(res.message);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <h2 style={{ margin: 0 }}>机器人池(Operator)</h2>
        <button onClick={() => setShowAdd((s) => !s)}>
          {showAdd ? "取消" : "添加机器人"}
        </button>
      </header>

      {showAdd && (
        <AddBotForm
          onCreated={() => {
            setShowAdd(false);
            refresh();
          }}
        />
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {!bots ? (
        <p>加载中…</p>
      ) : bots.length === 0 ? (
        <p style={{ color: "#666" }}>当前没有任何机器人。</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th>名称</th>
              <th>QQ</th>
              <th>WS</th>
              <th>启用</th>
              <th>存活</th>
              <th>心跳间隔</th>
              <th>上次心跳</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {bots.map((b) => (
              <BotRow key={b.botId} bot={b} onChanged={refresh} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function BotRow({
  bot,
  onChanged,
}: {
  bot: BotStatus;
  onChanged: () => void;
}): JSX.Element {
  const aliveColor = bot.alive ? "#1a8" : "#a33";
  return (
    <tr>
      <td>{bot.name}</td>
      <td>{bot.qq}</td>
      <td>{bot.wsState}</td>
      <td>
        <input
          type="checkbox"
          checked={bot.enabled}
          onChange={async (e) => {
            await api.updateBot(bot.botId, { enabled: e.target.checked });
            onChanged();
          }}
        />
      </td>
      <td style={{ color: aliveColor, fontWeight: "bold" }}>
        {bot.alive ? "alive" : "dead"}
      </td>
      <td>{bot.heartbeatInterval ?? "—"}</td>
      <td>
        {bot.lastHeartbeatAt
          ? new Date(bot.lastHeartbeatAt).toLocaleTimeString()
          : "—"}
      </td>
      <td>
        <button
          onClick={async () => {
            if (!confirm(`确认删除机器人 ${bot.name}(QQ ${bot.qq})吗?`)) return;
            await api.deleteBot(bot.botId);
            onChanged();
          }}
        >
          删除
        </button>
      </td>
    </tr>
  );
}

function AddBotForm({ onCreated }: { onCreated: () => void }): JSX.Element {
  const [name, setName] = useState("");
  const [qq, setQq] = useState("");
  const [wsUrl, setWsUrl] = useState("ws://127.0.0.1:3001");
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await api.createBot({
      name,
      qq: Number(qq),
      wsUrl,
      accessToken: accessToken || null,
    });
    setBusy(false);
    if (res.code === 0) {
      setName("");
      setQq("");
      setWsUrl("ws://127.0.0.1:3001");
      setAccessToken("");
      onCreated();
    } else {
      setError(res.message);
    }
  }

  return (
    <form onSubmit={submit} style={formStyle}>
      <Field label="名称">
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="机器人 QQ 号">
        <input
          type="number"
          value={qq}
          onChange={(e) => setQq(e.target.value)}
          required
          min={1}
        />
      </Field>
      <Field label="OneBot WebSocket 地址">
        <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} required />
      </Field>
      <Field label="Access Token(可选)">
        <input
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
        />
      </Field>
      <button type="submit" disabled={busy}>
        {busy ? "创建中…" : "创建"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <span style={{ fontSize: "0.9rem", color: "#444" }}>{label}</span>
      {children}
    </label>
  );
}

const tableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  fontSize: "0.9rem",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  padding: "0.75rem",
  background: "#fafafa",
  border: "1px solid #eee",
  borderRadius: 4,
};
