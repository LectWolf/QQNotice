import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

type AdminUser = {
  id: number;
  username: string;
  isOperator: boolean;
  sendKeyCount: number;
  createdAt: string;
};

type AdminSendKey = {
  id: number;
  userId: number;
  username: string;
  name: string;
  targetQq: number;
  botId: number;
  state: "active" | "disabled";
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export function AdminUsers(): JSX.Element {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await api.listUsers();
    if (res.code === 0 && res.data) setUsers(res.data);
    else setError(res.message);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2 style={{ margin: 0 }}>用户管理(Operator)</h2>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!users ? (
        <p>加载中…</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th>用户名</th>
              <th>角色</th>
              <th>SendKey 数</th>
              <th>注册时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.isOperator ? <strong>Operator</strong> : "User"}</td>
                <td>{u.sendKeyCount}</td>
                <td>{new Date(u.createdAt).toLocaleString()}</td>
                <td>
                  {u.isOperator ? (
                    <button disabled title="不能删除 Operator">
                      删除
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        if (
                          !confirm(
                            `确认删除用户「${u.username}」吗?其全部 SendKey 也会被删除,无法恢复。`,
                          )
                        ) {
                          return;
                        }
                        const res = await api.deleteUser(u.id);
                        if (res.code !== 0) alert(res.message);
                        refresh();
                      }}
                    >
                      删除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function AdminKeys(): JSX.Element {
  const [keys, setKeys] = useState<AdminSendKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [refreshSummary, setRefreshSummary] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await api.listAllSendKeys();
    if (res.code === 0 && res.data) setKeys(res.data);
    else setError(res.message);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const filtered = keys
    ? keys.filter(
        (k) =>
          !filter ||
          k.username.toLowerCase().includes(filter.toLowerCase()) ||
          String(k.targetQq).includes(filter),
      )
    : null;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>所有 SendKey(Operator)</h2>
        <input
          placeholder="按用户名或目标 QQ 过滤"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          onClick={async () => {
            setRefreshSummary("刷新中…");
            const res = await api.refreshFriendships();
            if (res.code === 0 && res.data) {
              setRefreshSummary(
                `好友列表已刷新:成功 ${res.data.refreshed},跳过 ${res.data.skipped},耗时 ${res.data.durationMs} ms`,
              );
            } else {
              setRefreshSummary(`刷新失败:${res.message}`);
            }
          }}
        >
          立即刷新好友列表
        </button>
      </header>
      {refreshSummary && <p style={{ color: "#666" }}>{refreshSummary}</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!filtered ? (
        <p>加载中…</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th>归属</th>
              <th>名称</th>
              <th>目标 QQ</th>
              <th>绑定 Bot</th>
              <th>前缀</th>
              <th>状态</th>
              <th>创建</th>
              <th>上次使用</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((k) => (
              <tr key={k.id}>
                <td>{k.username}</td>
                <td>{k.name}</td>
                <td>{k.targetQq}</td>
                <td>{k.botId}</td>
                <td>
                  <code>{k.prefix}…</code>
                </td>
                <td
                  style={{
                    color: k.state === "active" ? "#1a8" : "#a33",
                  }}
                >
                  {k.state}
                </td>
                <td>{new Date(k.createdAt).toLocaleString()}</td>
                <td>
                  {k.lastUsedAt
                    ? new Date(k.lastUsedAt).toLocaleString()
                    : "—"}
                </td>
                <td>
                  <button
                    onClick={async () => {
                      const next =
                        k.state === "active" ? "disabled" : "active";
                      const res = await api.updateAdminSendKey(k.id, next);
                      if (res.code !== 0) alert(res.message);
                      refresh();
                    }}
                  >
                    {k.state === "active" ? "禁用" : "启用"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const tableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  fontSize: "0.9rem",
};
