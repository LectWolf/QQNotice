import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { translateError } from "./errors.js";
import { copyToClipboard } from "./clipboard.js";
import { ErrorAlert, PopConfirm, useToast } from "./ui.js";

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
  plaintext: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

export function AdminUsers(): JSX.Element {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    const res = await api.listUsers();
    if (res.code === 0 && res.data) setUsers(res.data);
    else setError(translateError(res.message, res.code));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">用户管理</h2>
        <p className="mt-1 text-sm text-slate-500">
          查看所有注册用户。删除会级联删除其全部 SendKey。
        </p>
      </div>

      {error && <ErrorAlert>{error}</ErrorAlert>}

      {!users ? (
        <div className="text-center text-slate-400 py-12 text-sm">加载中…</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>角色</th>
                <th>SendKey 数</th>
                <th>注册时间</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium text-slate-900">{u.username}</td>
                  <td>
                    {u.isOperator ? (
                      <span className="badge-brand">管理员</span>
                    ) : (
                      <span className="badge-muted">普通用户</span>
                    )}
                  </td>
                  <td>{u.sendKeyCount}</td>
                  <td className="text-slate-500 text-xs">
                    {new Date(u.createdAt).toLocaleString()}
                  </td>
                  <td className="text-right">
                    {u.isOperator ? (
                      <button
                        disabled
                        title="不能删除 Operator"
                        className="btn-ghost btn-sm text-slate-300 disabled:hover:bg-transparent cursor-not-allowed"
                      >
                        删除
                      </button>
                    ) : (
                      <PopConfirm
                        title={`确认删除「${u.username}」?`}
                        desc="该用户的全部 SendKey 也会被一并删除,无法恢复。"
                        confirmText="删除"
                        onConfirm={async () => {
                          const res = await api.deleteUser(u.id);
                          if (res.code !== 0) {
                            toast.error(translateError(res.message, res.code));
                          } else {
                            toast.success(`已删除用户 ${u.username}`);
                          }
                          refresh();
                        }}
                      >
                        {(open) => (
                          <button
                            onClick={open}
                            className="btn-ghost btn-sm text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          >
                            删除
                          </button>
                        )}
                      </PopConfirm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function AdminKeys(): JSX.Element {
  const [keys, setKeys] = useState<AdminSendKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const toast = useToast();

  const refresh = useCallback(async () => {
    const res = await api.listAllSendKeys();
    if (res.code === 0 && res.data) setKeys(res.data);
    else setError(translateError(res.message, res.code));
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
    <section className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">所有 SendKey</h2>
        <p className="mt-1 text-sm text-slate-500">每 30 秒自动刷新。</p>
      </div>

      <div className="card">
        <div className="card-body flex flex-wrap items-center gap-3">
          <input
            className="input flex-1 min-w-48"
            placeholder="按用户名或目标 QQ 过滤"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            className="btn-secondary"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              const res = await api.refreshFriendships();
              setRefreshing(false);
              if (res.code === 0 && res.data) {
                toast.success(
                  `刷新完成 · 成功 ${res.data.refreshed} · 跳过 ${res.data.skipped} · ${res.data.durationMs}ms`,
                );
              } else {
                toast.error(
                  `刷新失败:${translateError(res.message, res.code)}`,
                );
              }
            }}
          >
            {refreshing ? "刷新中…" : "🔄 立即刷新好友列表"}
          </button>
        </div>
      </div>

      {error && <ErrorAlert>{error}</ErrorAlert>}

      {!filtered ? (
        <div className="text-center text-slate-400 py-12 text-sm">加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="card-body text-center text-slate-500 py-10">
            没有符合条件的 SendKey。
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>归属</th>
                <th>名称</th>
                <th>目标 QQ</th>
                <th>Bot</th>
                <th>Key</th>
                <th>状态</th>
                <th>创建</th>
                <th>上次使用</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((k) => (
                <tr key={k.id}>
                  <td className="text-slate-700">{k.username}</td>
                  <td className="font-medium text-slate-900">{k.name}</td>
                  <td>
                    <button
                      onClick={async () => {
                        const ok = await copyToClipboard(String(k.targetQq));
                        if (ok) toast.success(`已复制目标 QQ ${k.targetQq}`);
                        else toast.error("复制失败");
                      }}
                      className="font-mono text-xs text-slate-700 hover:text-brand-600 hover:underline underline-offset-2 transition-colors"
                      title="点击复制 QQ"
                    >
                      {k.targetQq}
                    </button>
                  </td>
                  <td className="text-slate-500">#{k.botId}</td>
                  <td>
                    <button
                      onClick={async () => {
                        if (k.plaintext) {
                          const ok = await copyToClipboard(k.plaintext);
                          if (ok) toast.success("已复制完整 SendKey");
                          else toast.error("复制失败");
                        } else {
                          const ok = await copyToClipboard(k.prefix);
                          if (ok)
                            toast.info(
                              "仅复制了前缀,完整 key 需删除后重新创建",
                            );
                          else toast.error("复制失败");
                        }
                      }}
                      className="group inline-flex items-center gap-1.5 rounded-md bg-slate-100 hover:bg-brand-50 hover:ring-1 hover:ring-brand-200 px-2 py-1 transition-colors"
                      title={
                        k.plaintext
                          ? "点击复制完整 SendKey"
                          : "完整 key 不可用(老数据);删除后重新创建即可获得"
                      }
                    >
                      <code className="font-mono text-[0.78rem] text-slate-700 group-hover:text-brand-700">
                        {k.prefix}…
                      </code>
                      <span className="text-[10px] text-slate-400 group-hover:text-brand-500 transition-colors">
                        📋
                      </span>
                    </button>
                  </td>
                  <td>
                    {k.state === "active" ? (
                      <span className="badge-success">● 正常</span>
                    ) : (
                      <span className="badge-danger">● 已禁用</span>
                    )}
                  </td>
                  <td className="text-slate-500 text-xs">
                    {new Date(k.createdAt).toLocaleString()}
                  </td>
                  <td className="text-slate-500 text-xs">
                    {k.lastUsedAt
                      ? new Date(k.lastUsedAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="text-right">
                    <button
                      className="btn-ghost btn-sm"
                      onClick={async () => {
                        const next =
                          k.state === "active" ? "disabled" : "active";
                        const res = await api.updateAdminSendKey(k.id, next);
                        if (res.code !== 0) {
                          toast.error(translateError(res.message, res.code));
                        } else {
                          toast.success(
                            next === "active" ? "已启用" : "已禁用",
                          );
                        }
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
        </div>
      )}
    </section>
  );
}
