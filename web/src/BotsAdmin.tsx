import { useCallback, useEffect, useState } from "react";
import { api, type BotStatus } from "./api.js";
import { translateError } from "./errors.js";
import { ErrorAlert, PopConfirm } from "./ui.js";

type BotFormState = {
  name: string;
  qq: string;
  wsUrl: string;
  accessToken: string;
};

const EMPTY_FORM: BotFormState = {
  name: "",
  qq: "",
  wsUrl: "ws://127.0.0.1:3001",
  accessToken: "",
};

type EditTarget =
  | { kind: "create" }
  | { kind: "edit"; botId: number; initial: BotFormState };

export function BotsAdmin(): JSX.Element {
  const [bots, setBots] = useState<BotStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditTarget | null>(null);

  const refresh = useCallback(async () => {
    const res = await api.listBots();
    if (res.code === 0 && res.data) setBots(res.data);
    else setError(translateError(res.message, res.code));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">机器人池</h2>
          <p className="mt-1 text-sm text-slate-500">
            管理 OneBot(NapCat)连接,列表每 3 秒自动刷新。新建后会立即尝试连接。
          </p>
        </div>
        <button
          onClick={() =>
            setEdit(edit?.kind === "create" ? null : { kind: "create" })
          }
          className={
            edit?.kind === "create" ? "btn-secondary" : "btn-primary"
          }
        >
          {edit?.kind === "create" ? "取消" : "+ 添加机器人"}
        </button>
      </div>

      {edit && (
        <div className="card">
          <div className="card-body">
            <BotForm
              key={edit.kind === "edit" ? edit.botId : "new"}
              mode={edit.kind}
              initial={edit.kind === "edit" ? edit.initial : EMPTY_FORM}
              onCancel={() => setEdit(null)}
              onSaved={() => {
                setEdit(null);
                refresh();
              }}
              botId={edit.kind === "edit" ? edit.botId : undefined}
            />
          </div>
        </div>
      )}

      {error && <ErrorAlert>{error}</ErrorAlert>}

      {!bots ? (
        <div className="text-center text-slate-400 py-12 text-sm">加载中…</div>
      ) : bots.length === 0 ? (
        <div className="card">
          <div className="card-body text-center py-16">
            <div className="text-4xl mb-3">🤖</div>
            <h3 className="font-semibold text-slate-700">还没有任何机器人</h3>
            <p className="mt-1 text-sm text-slate-500">
              点 “+ 添加机器人” 注册第一个 NapCat 实例。
            </p>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>QQ</th>
                <th>连接</th>
                <th>启用</th>
                <th>状态</th>
                <th>心跳</th>
                <th>好友数</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {bots.map((b) => (
                <BotRow
                  key={b.botId}
                  bot={b}
                  onChanged={refresh}
                  onEdit={(initial) =>
                    setEdit({ kind: "edit", botId: b.botId, initial })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BotRow({
  bot,
  onChanged,
  onEdit,
}: {
  bot: BotStatus;
  onChanged: () => void;
  onEdit: (initial: BotFormState) => void;
}): JSX.Element {
  return (
    <tr>
      <td className="font-medium text-slate-900">{bot.name}</td>
      <td className="font-mono text-xs">{bot.qq}</td>
      <td>
        <span
          className={
            bot.wsState === "open"
              ? "badge-success"
              : bot.wsState === "connecting"
                ? "badge-warn"
                : "badge-danger"
          }
        >
          {bot.wsState === "open"
            ? "已连接"
            : bot.wsState === "connecting"
              ? "连接中"
              : "已断开"}
        </span>
      </td>
      <td>
        <Toggle
          checked={bot.enabled}
          onChange={async (next) => {
            await api.updateBot(bot.botId, { enabled: next });
            onChanged();
          }}
        />
      </td>
      <td>
        {bot.alive ? (
          <span className="badge-success">● 在线</span>
        ) : (
          <span className="badge-danger">● 离线</span>
        )}
      </td>
      <td className="text-slate-500 text-xs">
        {bot.heartbeatInterval ? `${bot.heartbeatInterval}ms` : "—"}
      </td>
      <td className="text-slate-600 font-mono text-xs">{bot.friendCount}</td>
      <td className="text-right whitespace-nowrap">
        <button
          className="btn-ghost btn-sm"
          onClick={() =>
            onEdit({
              name: bot.name,
              qq: String(bot.qq),
              wsUrl: "",
              accessToken: "",
            })
          }
          title="编辑"
        >
          编辑
        </button>
        <PopConfirm
          title={`确认删除「${bot.name}」?`}
          desc={`机器人 QQ ${bot.qq} 将从池中移除。`}
          confirmText="删除"
          onConfirm={async () => {
            await api.deleteBot(bot.botId);
            onChanged();
          }}
        >
          {(open) => (
            <button
              onClick={open}
              className="btn-ghost btn-sm text-rose-600 hover:bg-rose-50 hover:text-rose-700 ml-1"
            >
              删除
            </button>
          )}
        </PopConfirm>
      </td>
    </tr>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? "bg-brand-500" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function BotForm({
  mode,
  initial,
  onCancel,
  onSaved,
  botId,
}: {
  mode: "create" | "edit";
  initial: BotFormState;
  onCancel: () => void;
  onSaved: () => void;
  botId?: number;
}): JSX.Element {
  const [form, setForm] = useState<BotFormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function up<K extends keyof BotFormState>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement>): void => {
      setForm((s) => ({ ...s, [key]: e.target.value }));
    };
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    if (mode === "create") {
      const res = await api.createBot({
        name: form.name,
        qq: Number(form.qq),
        wsUrl: form.wsUrl,
        accessToken: form.accessToken || null,
      });
      setBusy(false);
      if (res.code === 0) onSaved();
      else setError(translateError(res.message, res.code));
    } else if (botId !== undefined) {
      // For edit, only send fields the user actually filled in. The
      // current row's name/qq are pre-filled in the form initial state;
      // wsUrl/accessToken start empty and are only sent when changed.
      const patch: Record<string, unknown> = {};
      if (form.name) patch.name = form.name;
      if (form.qq) patch.qq = Number(form.qq);
      if (form.wsUrl) patch.wsUrl = form.wsUrl;
      if (form.accessToken) patch.accessToken = form.accessToken;
      const res = await api.updateBot(botId, patch);
      setBusy(false);
      if (res.code === 0) onSaved();
      else setError(translateError(res.message, res.code));
    }
  }

  const isEdit = mode === "edit";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">{isEdit ? "编辑机器人" : "添加机器人"}</h3>
        {isEdit && (
          <span className="text-xs text-slate-500">#{botId}</span>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">名称</label>
          <input
            className="input"
            value={form.name}
            onChange={up("name")}
            required
            placeholder="例如 primary"
          />
        </div>
        <div>
          <label className="label">机器人 QQ 号</label>
          <input
            className="input"
            type="number"
            value={form.qq}
            onChange={up("qq")}
            required
            min={1}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">
            OneBot WebSocket 地址
            {isEdit && (
              <span className="text-slate-400 text-xs font-normal ml-1">
                留空表示不修改
              </span>
            )}
          </label>
          <input
            className="input font-mono text-xs"
            value={form.wsUrl}
            onChange={up("wsUrl")}
            required={!isEdit}
            placeholder="ws://host:port 或 wss://..."
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">
            Access Token
            <span className="text-slate-400 text-xs font-normal ml-1">
              {isEdit ? "留空表示不修改" : "可选"}
            </span>
          </label>
          <input
            className="input font-mono text-xs"
            value={form.accessToken}
            onChange={up("accessToken")}
            placeholder="留空则不发送 Authorization header"
          />
        </div>
      </div>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "保存中…" : isEdit ? "保存修改" : "创建"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          取消
        </button>
      </div>
    </form>
  );
}
