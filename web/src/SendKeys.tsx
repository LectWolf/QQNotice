import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SendKey } from "./api.js";

export function SendKeys(): JSX.Element {
  const [keys, setKeys] = useState<SendKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [justCreated, setJustCreated] = useState<{
    name: string;
    plaintext: string;
  } | null>(null);
  const [handshake, setHandshake] = useState<{
    name: string;
    targetQq: number;
    hostBotQq: number;
    expiresAt: number;
  } | null>(null);

  const refresh = useCallback(async () => {
    const res = await api.listSendKeys();
    if (res.code === 0 && res.data) setKeys(res.data);
    else setError(res.message);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <h2 style={{ margin: 0 }}>我的 SendKey</h2>
        <button onClick={() => setShowAdd((s) => !s)}>
          {showAdd ? "取消" : "新增 SendKey"}
        </button>
      </header>

      {showAdd && !handshake && (
        <AddSendKeyForm
          onBound={(name, plaintext) => {
            setShowAdd(false);
            setJustCreated({ name, plaintext });
            refresh();
          }}
          onPending={(name, targetQq, hostBotQq, expiresAt) => {
            setShowAdd(false);
            setHandshake({ name, targetQq, hostBotQq, expiresAt });
          }}
        />
      )}

      {handshake && (
        <HandshakePanel
          {...handshake}
          onFinalised={(plaintext) => {
            setJustCreated({ name: handshake.name, plaintext });
            setHandshake(null);
            refresh();
          }}
          onCancelled={() => setHandshake(null)}
        />
      )}

      {justCreated && (
        <PlaintextModal
          name={justCreated.name}
          plaintext={justCreated.plaintext}
          onDismiss={() => setJustCreated(null)}
        />
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {!keys ? (
        <p>加载中…</p>
      ) : keys.length === 0 ? (
        <p style={{ color: "#666" }}>还没有创建任何 SendKey。</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th>名称</th>
              <th>目标 QQ</th>
              <th>前缀</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>上次使用</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <SendKeyRow
                key={k.id}
                item={k}
                onChanged={refresh}
                onRecreate={(name, targetQq) => {
                  // Pre-fill the form by toggling it open and seeding state
                  // via a re-render. Simplest path: just open the form so
                  // the user retypes.
                  setShowAdd(true);
                  // Could lift a "prefill" state up if the UX needs it.
                  void name;
                  void targetQq;
                }}
              />
            ))}
          </tbody>
        </table>
      )}

      <CurlExample />
    </section>
  );
}

function HandshakePanel({
  name,
  targetQq,
  hostBotQq,
  expiresAt,
  onFinalised,
  onCancelled,
}: {
  name: string;
  targetQq: number;
  hostBotQq: number;
  expiresAt: number;
  onFinalised: (plaintext: string) => void;
  onCancelled: () => void;
}): JSX.Element {
  const [secondsLeft, setSecondsLeft] = useState(
    Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
  );
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;

    const tick = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
    }, 1000);

    const poll = setInterval(async () => {
      if (cancelled.current) return;
      const res = await api.finalizeSendKey({ targetQq });
      if (cancelled.current) return;
      if (res.code === 0 && res.data && "plaintext" in res.data) {
        onFinalised(res.data.plaintext);
      } else if (res.code === 404) {
        setError("握手已过期或被取消,请重新创建。");
        clearInterval(poll);
      }
    }, 5000);

    return () => {
      cancelled.current = true;
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [targetQq, expiresAt, onFinalised]);

  return (
    <div style={handshakeBoxStyle}>
      <h3 style={{ marginTop: 0 }}>等待添加好友:{name}</h3>
      <p>
        目标 QQ <strong>{targetQq}</strong> 还不是任何机器人的好友。
        请用 QQ <strong>{targetQq}</strong> 添加机器人 QQ
        <strong> {hostBotQq} </strong>
        为好友。我们会自动同意你的好友请求,然后完成 SendKey 创建。
      </p>
      <p>
        剩余时间: <code>{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</code>
      </p>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <button
        onClick={() => {
          cancelled.current = true;
          onCancelled();
        }}
      >
        取消并放弃
      </button>
    </div>
  );
}

function SendKeyRow({
  item,
  onChanged,
  onRecreate,
}: {
  item: SendKey;
  onChanged: () => void;
  onRecreate: (name: string, targetQq: number) => void;
}): JSX.Element {
  const stateColor = item.state === "active" ? "#1a8" : "#a33";
  return (
    <tr>
      <td>{item.name}</td>
      <td>{item.targetQq}</td>
      <td>
        <code>{item.prefix}…</code>
      </td>
      <td style={{ color: stateColor }}>
        {item.state === "disabled" ? (
          <span title="此 SendKey 绑定的机器人已经无法访问目标 QQ">
            disabled
          </span>
        ) : (
          item.state
        )}
      </td>
      <td>{new Date(item.createdAt).toLocaleString()}</td>
      <td>
        {item.lastUsedAt
          ? new Date(item.lastUsedAt).toLocaleString()
          : "—"}
      </td>
      <td style={{ display: "flex", gap: "0.25rem" }}>
        {item.state === "disabled" && (
          <button onClick={() => onRecreate(item.name, item.targetQq)}>
            重新创建
          </button>
        )}
        <button
          onClick={async () => {
            if (
              !confirm(
                `确认删除 SendKey「${item.name}」吗?删除后无法恢复。`,
              )
            ) {
              return;
            }
            await api.deleteSendKey(item.id);
            onChanged();
          }}
        >
          删除
        </button>
      </td>
    </tr>
  );
}

function AddSendKeyForm({
  onBound,
  onPending,
}: {
  onBound: (name: string, plaintext: string) => void;
  onPending: (
    name: string,
    targetQq: number,
    hostBotQq: number,
    expiresAt: number,
  ) => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [targetQq, setTargetQq] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const targetQqNum = Number(targetQq);
    const res = await api.createSendKey({ name, targetQq: targetQqNum });
    setBusy(false);

    if (res.code === 0 && res.data && "plaintext" in res.data) {
      setName("");
      setTargetQq("");
      onBound(res.data.name, res.data.plaintext);
    } else if (res.code === 202 && res.data && "hostBotQq" in res.data) {
      const submittedName = name;
      setName("");
      setTargetQq("");
      onPending(
        submittedName,
        targetQqNum,
        res.data.hostBotQq,
        res.data.expiresAt,
      );
    } else if (res.code === 503) {
      setError("当前没有任何在线机器人,请联系管理员。");
    } else {
      setError(res.message);
    }
  }

  return (
    <form onSubmit={submit} style={formStyle}>
      <Field label="名称">
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="目标 QQ 号(消息将私聊推到这个号)">
        <input
          type="number"
          value={targetQq}
          onChange={(e) => setTargetQq(e.target.value)}
          required
          min={1}
        />
      </Field>
      <button type="submit" disabled={busy}>
        {busy ? "创建中…" : "创建"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </form>
  );
}

function PlaintextModal({
  name,
  plaintext,
  onDismiss,
}: {
  name: string;
  plaintext: string;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div style={modalBackdropStyle}>
      <div style={modalStyle}>
        <h3 style={{ marginTop: 0 }}>SendKey 已生成: {name}</h3>
        <p style={{ color: "#a33", fontWeight: "bold" }}>
          这是唯一一次显示完整 key 的机会。请立即复制保存,关闭后只能重建。
        </p>
        <div style={keyDisplayStyle}>
          <code style={{ wordBreak: "break-all" }}>{plaintext}</code>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={() => navigator.clipboard.writeText(plaintext)}>
            复制
          </button>
          <button onClick={onDismiss}>我已保存</button>
        </div>
      </div>
    </div>
  );
}

function CurlExample(): JSX.Element {
  return (
    <details style={{ background: "#fafafa", padding: "0.75rem", borderRadius: 4 }}>
      <summary>怎么用我的 SendKey 发消息?</summary>
      <pre style={{ overflowX: "auto", fontSize: "0.85rem" }}>
{`# 最简单(GET):
curl "http://your-host:3000/send/<sendkey>?content=hello"

# 推荐(POST + Bearer):
curl -X POST http://your-host:3000/send \\
  -H "Authorization: Bearer <sendkey>" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"WARN","content":"事情不太对劲"}'`}
      </pre>
    </details>
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

const handshakeBoxStyle: React.CSSProperties = {
  padding: "1rem",
  background: "#fff7e6",
  border: "1px solid #f4c97a",
  borderRadius: 4,
};

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.4)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 100,
};

const modalStyle: React.CSSProperties = {
  background: "white",
  padding: "2rem",
  borderRadius: 8,
  maxWidth: 560,
  width: "100%",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.2)",
};

const keyDisplayStyle: React.CSSProperties = {
  background: "#f4f4f4",
  padding: "0.75rem",
  borderRadius: 4,
  margin: "0.75rem 0",
  fontFamily: "monospace",
};
