import { useCallback, useEffect, useState } from "react";
import { api, type SendKey } from "./api.js";

export function SendKeys(): JSX.Element {
  const [keys, setKeys] = useState<SendKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [justCreated, setJustCreated] = useState<{
    name: string;
    plaintext: string;
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

      {showAdd && (
        <AddSendKeyForm
          onCreated={(name, plaintext) => {
            setShowAdd(false);
            setJustCreated({ name, plaintext });
            refresh();
          }}
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
              <SendKeyRow key={k.id} item={k} onChanged={refresh} />
            ))}
          </tbody>
        </table>
      )}

      <CurlExample />
    </section>
  );
}

function SendKeyRow({
  item,
  onChanged,
}: {
  item: SendKey;
  onChanged: () => void;
}): JSX.Element {
  const stateColor = item.state === "active" ? "#1a8" : "#a33";
  return (
    <tr>
      <td>{item.name}</td>
      <td>{item.targetQq}</td>
      <td>
        <code>{item.prefix}…</code>
      </td>
      <td style={{ color: stateColor }}>{item.state}</td>
      <td>{new Date(item.createdAt).toLocaleString()}</td>
      <td>
        {item.lastUsedAt
          ? new Date(item.lastUsedAt).toLocaleString()
          : "—"}
      </td>
      <td>
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
  onCreated,
}: {
  onCreated: (name: string, plaintext: string) => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [targetQq, setTargetQq] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await api.createSendKey({
      name,
      targetQq: Number(targetQq),
    });
    setBusy(false);
    if (res.code === 0 && res.data) {
      setName("");
      setTargetQq("");
      onCreated(res.data.name, res.data.plaintext);
    } else if (res.code === 409) {
      setError("没有任何机器人加了该 QQ 为好友。需要先和机器人加好友(0005 切片完成后会自动引导)。");
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
