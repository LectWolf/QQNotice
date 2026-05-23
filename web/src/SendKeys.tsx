import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PublicBot, type SendKey } from "./api.js";
import { translateError } from "./errors.js";
import { copyToClipboard } from "./clipboard.js";
import { SendKeyLogsDrawer } from "./Logs.js";
import { ErrorAlert, PopConfirm, useToast } from "./ui.js";

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
    else setError(translateError(res.message, res.code));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">我的 SendKey</h2>
          <p className="mt-1 text-sm text-slate-500">
            一个 SendKey 对应一个目标 QQ。点击 Key 列即可随时复制完整凭证。
          </p>
        </div>
        {!handshake && (
          <button
            onClick={() => setShowAdd((s) => !s)}
            className={showAdd ? "btn-secondary" : "btn-primary"}
          >
            {showAdd ? "取消" : "+ 新增 SendKey"}
          </button>
        )}
      </div>

      {showAdd && !handshake && (
        <div className="card">
          <div className="card-body">
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
          </div>
        </div>
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

      {error && <ErrorAlert>{error}</ErrorAlert>}

      {!keys ? (
        <div className="text-center text-slate-400 py-12 text-sm">加载中…</div>
      ) : keys.length === 0 ? (
        <EmptyState
          title="还没有任何 SendKey"
          desc="点右上角 “+ 新增 SendKey” 开始第一次推送。"
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>目标 QQ</th>
                <th>Key</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>上次使用</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <SendKeyRow key={k.id} item={k} onChanged={refresh} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BotPoolPanel />

      <CurlExample />
    </section>
  );
}

function BotPoolPanel(): JSX.Element {
  const [bots, setBots] = useState<PublicBot[] | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    const res = await api.listPublicBots();
    if (res.code === 0 && res.data) setBots(res.data);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!bots) return <></>;

  const live = bots.filter((b) => b.alive).length;

  return (
    <section className="card">
      <div className="card-body space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <span className="text-lg">🤖</span>
              通知机器人池
            </h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              这些是当前可用的推送机器人。把目标 QQ 号添加任一在线机器人为好友,创建 SendKey 时就能直接走最快路径。
            </p>
          </div>
          <span className="badge-muted">
            {live}/{bots.length} 在线
          </span>
        </div>

        {bots.length === 0 ? (
          <div className="text-sm text-slate-500 italic">
            管理员还没添加任何机器人。
          </div>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-2.5">
            {bots.map((b) => (
              <li
                key={b.qq}
                className="flex items-center gap-3 rounded-xl ring-1 ring-slate-200 bg-white/70 px-3 py-2.5 hover:ring-brand-200 hover:bg-brand-50/40 transition-colors"
              >
                <span
                  className={`flex h-2.5 w-2.5 flex-none rounded-full ${
                    b.alive
                      ? "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]"
                      : "bg-slate-300"
                  }`}
                  title={b.alive ? "在线" : "离线"}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {b.name}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await copyToClipboard(String(b.qq));
                      if (ok) toast.success(`已复制 ${b.qq}`);
                      else toast.error("复制失败");
                    }}
                    className="font-mono text-xs text-slate-500 hover:text-brand-600 hover:underline underline-offset-2"
                    title="点击复制 QQ"
                  >
                    {b.qq}
                  </button>
                </div>
                {b.alive ? (
                  <span className="badge-success text-[10px]">在线</span>
                ) : (
                  <span className="badge-muted text-[10px]">离线</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
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
  const toast = useToast();

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

  const min = Math.floor(secondsLeft / 60);
  const sec = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="card border-amber-200 bg-amber-50/60">
      <div className="card-body space-y-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-sm font-bold animate-pulse">
            …
          </span>
          <div>
            <h3 className="font-semibold text-amber-900">等待添加好友</h3>
            <p className="text-xs text-amber-800/80">SendKey: {name}</p>
          </div>
        </div>

        <p className="text-sm text-amber-900/90 leading-relaxed">
          目标 QQ <code className="code-chip">{targetQq}</code> 还不是任何机器人的好友。请用这个 QQ 添加机器人为好友:
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <code className="rounded-lg bg-white border border-amber-200 px-4 py-2 font-mono text-lg font-semibold tracking-wider text-amber-900 shadow-sm">
            {hostBotQq}
          </code>
          <button
            className="btn-secondary btn-sm"
            onClick={async () => {
              const ok = await copyToClipboard(String(hostBotQq));
              if (ok) toast.success("已复制机器人 QQ");
              else toast.error("复制失败,请手动选中复制");
            }}
          >
            复制
          </button>
        </div>

        <div className="text-xs text-amber-800/80">
          我们会自动同意你的好友请求,然后完成 SendKey 创建。剩余时间:
          <code className="ml-1 font-mono">
            {min}:{sec}
          </code>
        </div>

        {error && <ErrorAlert>{error}</ErrorAlert>}

        <div>
          <button
            onClick={() => {
              cancelled.current = true;
              onCancelled();
            }}
            className="btn-ghost btn-sm"
          >
            取消并放弃
          </button>
        </div>
      </div>
    </div>
  );
}

function SendKeyRow({
  item,
  onChanged,
}: {
  item: SendKey;
  onChanged: () => void;
}): JSX.Element {
  const [testing, setTesting] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const toast = useToast();

  async function runTest(): Promise<void> {
    setTesting(true);
    const res = await api.testSendKey(item.id);
    setTesting(false);
    if (res.code === 0) {
      toast.success("已发送测试消息,请到 QQ 查收");
    } else {
      toast.error(translateError(res.message, res.code));
    }
  }

  async function copyTargetQq(): Promise<void> {
    const ok = await copyToClipboard(String(item.targetQq));
    if (ok) toast.success(`已复制目标 QQ ${item.targetQq}`);
    else toast.error("复制失败");
  }

  async function copyKey(): Promise<void> {
    if (item.plaintext) {
      const ok = await copyToClipboard(item.plaintext);
      if (ok) toast.success("已复制完整 SendKey 到剪贴板");
      else toast.error("复制失败,请手动复制");
    } else {
      // Legacy row created before plaintext was persisted in the DB. The
      // bcrypt hash is one-way, so the only path is delete + recreate.
      const ok = await copyToClipboard(item.prefix);
      if (ok) toast.info("仅复制了前缀,完整 key 需删除后重新创建");
      else toast.error("复制失败");
    }
  }

  return (
    <tr>
      <td className="font-medium text-slate-900">{item.name}</td>
      <td>
        <button
          onClick={copyTargetQq}
          className="font-mono text-xs text-slate-700 hover:text-brand-600 hover:underline underline-offset-2 transition-colors"
          title="点击复制 QQ"
        >
          {item.targetQq}
        </button>
      </td>
      <td>
        <button
          onClick={copyKey}
          className="group inline-flex items-center gap-1.5 rounded-md bg-slate-100 hover:bg-brand-50 hover:ring-1 hover:ring-brand-200 px-2 py-1 transition-colors"
          title={
            item.plaintext
              ? "点击复制完整 SendKey"
              : "完整 key 不可用(老数据);删除后重新创建即可获得"
          }
        >
          <code className="font-mono text-[0.78rem] text-slate-700 group-hover:text-brand-700">
            {item.prefix}…
          </code>
          <span className="text-[10px] text-slate-400 group-hover:text-brand-500 transition-colors">
            📋
          </span>
        </button>
      </td>
      <td>
        {item.state === "active" ? (
          <span className="badge-success">● 正常</span>
        ) : (
          <span
            className="badge-danger"
            title="此 SendKey 绑定的机器人已经无法访问目标 QQ"
          >
            ● 已禁用
          </span>
        )}
      </td>
      <td className="text-slate-500 text-xs">
        {new Date(item.createdAt).toLocaleString()}
      </td>
      <td className="text-slate-500 text-xs">
        {item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString() : "—"}
      </td>
      <td className="text-right whitespace-nowrap">
        <button
          className="btn-ghost btn-sm"
          onClick={() => setLogsOpen(true)}
          title="查看这个 key 最近的调用日志"
        >
          日志
        </button>
        <button
          className="btn-ghost btn-sm ml-1"
          onClick={runTest}
          disabled={testing || item.state !== "active"}
          title={
            item.state !== "active"
              ? "已禁用的 key 不能测试"
              : "向目标 QQ 发送一条测试消息"
          }
        >
          {testing ? "发送中…" : "测试"}
        </button>
        <PopConfirm
          title={`确认删除「${item.name}」?`}
          desc="此操作不可恢复。如有正在使用此 key 的脚本,会立即失效。"
          confirmText="删除"
          onConfirm={async () => {
            await api.deleteSendKey(item.id);
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
        {logsOpen && (
          <SendKeyLogsDrawer
            sendKeyId={item.id}
            keyName={item.name}
            onClose={() => setLogsOpen(false)}
          />
        )}
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
    } else {
      setError(translateError(res.message, res.code));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">名称</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="例如 ci-alerts"
          />
        </div>
        <div>
          <label className="label">目标 QQ 号</label>
          <input
            className="input"
            type="number"
            value={targetQq}
            onChange={(e) => setTargetQq(e.target.value)}
            required
            min={1}
            placeholder="消息将私聊推到这个号"
          />
        </div>
      </div>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "创建中…" : "创建"}
      </button>
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
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  async function copy(): Promise<void> {
    const ok = await copyToClipboard(plaintext);
    if (ok) {
      setCopied(true);
      toast.success("已复制 SendKey 到剪贴板");
      setTimeout(() => setCopied(false), 1800);
    } else {
      toast.error("复制失败,请手动选中 key 后复制");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="card w-full max-w-xl">
        <div className="card-body space-y-5">
          <div>
            <div className="badge-success">✓ SendKey 已生成</div>
            <h3 className="mt-2 text-lg font-bold">{name}</h3>
            <p className="mt-1 text-sm text-slate-500">
              点击下方 key 即可复制。任何时候都可以从列表里再点 Key 列复制。
            </p>
          </div>

          <button
            onClick={copy}
            className="group w-full text-left rounded-xl bg-slate-900 hover:bg-slate-800 transition-colors text-slate-100 px-4 py-4 ring-1 ring-slate-700"
            title="点击复制"
          >
            <div className="font-mono text-sm break-all leading-relaxed">
              {plaintext}
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span
                className={
                  copied
                    ? "text-emerald-400 font-medium"
                    : "text-slate-400 group-hover:text-slate-300"
                }
              >
                {copied ? "✓ 已复制到剪贴板" : "📋 点击复制"}
              </span>
            </div>
          </button>

          <div className="flex justify-end gap-2">
            <button onClick={copy} className="btn-secondary">
              {copied ? "已复制" : "复制"}
            </button>
            <button onClick={onDismiss} className="btn-primary">
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CurlExample(): JSX.Element {
  return (
    <details className="card group">
      <summary className="px-6 py-4 cursor-pointer text-sm font-medium text-slate-700 hover:bg-slate-50/60 rounded-2xl select-none flex items-center gap-2">
        <span className="text-base">💡</span>
        怎么用我的 SendKey 发消息?
        <span className="ml-auto text-slate-400 group-open:rotate-180 transition-transform">
          ▾
        </span>
      </summary>
      <div className="px-6 pb-6 -mt-1 border-t border-slate-100 pt-4 space-y-3">
        <p className="text-xs text-slate-500">
          把示例里的 <code className="code-chip">your-host:3000</code> 换成你部署 QQNotice 的地址,
          <code className="code-chip">{`<sendkey>`}</code> 换成创建时拿到的完整 key。
        </p>
        <pre className="overflow-x-auto text-xs bg-slate-900 text-slate-100 rounded-lg p-4 leading-relaxed">
{`# 最简单(GET):
curl "http://your-host:3000/send/<sendkey>?content=hello"

# 推荐(POST + Bearer):
curl -X POST http://your-host:3000/send \\
  -H "Authorization: Bearer <sendkey>" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"WARN","content":"事情不太对劲"}'`}
        </pre>
      </div>
    </details>
  );
}

function EmptyState({
  title,
  desc,
}: {
  title: string;
  desc: string;
}): JSX.Element {
  return (
    <div className="card">
      <div className="card-body text-center py-16">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-accent-50 ring-1 ring-brand-100 text-3xl">
          🔑
        </div>
        <h3 className="font-semibold text-slate-700">{title}</h3>
        <p className="mt-1 text-sm text-slate-500">{desc}</p>
      </div>
    </div>
  );
}
