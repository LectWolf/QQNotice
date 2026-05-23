import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  api,
  getToken,
  type AdminSendLogEntry,
  type MySendLogEntry,
  type SendLogEntry,
} from "./api.js";
import { translateError } from "./errors.js";
import { ErrorAlert } from "./ui.js";

type AnyLog = SendLogEntry | MySendLogEntry | AdminSendLogEntry;
type LogFilter = "all" | "ok" | "fail" | "file";

const REFRESH_MS = 5_000;

/**
 * Apply the current filter to a list of logs. `file` matches only entries
 * with a stored attachment.
 */
function applyFilter<T extends AnyLog>(logs: T[], filter: LogFilter): T[] {
  return logs.filter((l) => {
    if (filter === "ok") return l.statusCode === 0;
    if (filter === "fail") return l.statusCode !== 0;
    if (filter === "file") return l.hasAttachment;
    return true;
  });
}

/**
 * Build the URL to download an attachment, choosing the right endpoint
 * based on whether the caller is the owner or an operator viewing
 * cross-user logs.
 */
function attachmentUrl(scope: "me" | "admin", logId: number): string {
  return scope === "admin"
    ? `/api/admin/logs/${logId}/file`
    : `/api/me/logs/${logId}/file`;
}

/**
 * Trigger a download of the attachment with the JWT in an Authorization
 * header. We can't put it on a plain `<a download>` link because the API
 * is JWT-gated, not cookie-gated, so we fetch the bytes ourselves and
 * hand a Blob URL to a synthetic anchor.
 */
async function downloadAttachment(
  scope: "me" | "admin",
  logId: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const token = getToken();
  if (!token) return { ok: false, reason: "unauthenticated" };
  const res = await fetch(attachmentUrl(scope, logId), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let reason = `download_failed_${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) reason = body.message;
    } catch {
      /* ignore body parse failure */
    }
    return { ok: false, reason };
  }
  const blob = await res.blob();
  // Pull the filename out of Content-Disposition; fall back to a generic
  // name when the server omitted it.
  const disp = res.headers.get("content-disposition") ?? "";
  let filename = "download";
  const utf8 = disp.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      filename = decodeURIComponent(utf8[1]!);
    } catch {
      /* keep fallback */
    }
  } else {
    const ascii = disp.match(/filename\s*=\s*"?([^";]+)"?/i);
    if (ascii) filename = ascii[1]!;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { ok: true };
}

/** Per-SendKey log drawer used inside the SendKeys table. */
export function SendKeyLogsDrawer({
  sendKeyId,
  keyName,
  onClose,
}: {
  sendKeyId: number;
  keyName: string;
  onClose: () => void;
}): JSX.Element {
  const [logs, setLogs] = useState<SendLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogFilter>("all");

  const refresh = useCallback(async () => {
    const res = await api.listSendKeyLogs(sendKeyId, 100);
    if (res.code === 0 && res.data) {
      setLogs(res.data);
      setError(null);
    } else {
      setError(translateError(res.message, res.code));
    }
  }, [sendKeyId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const filtered = useMemo(
    () => (logs ? applyFilter(logs, filter) : null),
    [logs, filter],
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white shadow-2xl flex flex-col h-full"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-slate-100 flex-none space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-900">发送日志</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                SendKey · {keyName}
                <span className="ml-2 text-slate-300">|</span>
                <span className="ml-2">每 5 秒自动刷新</span>
              </p>
            </div>
            <button onClick={onClose} className="btn-ghost btn-sm">
              关闭
            </button>
          </div>
          <FilterTabs value={filter} onChange={setFilter} />
        </header>
        <div className="flex-1 min-h-0 overflow-auto px-6 py-4 space-y-2">
          {error && <ErrorAlert>{error}</ErrorAlert>}
          {!filtered ? (
            <div className="text-center text-slate-400 py-12 text-sm">加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-slate-400 py-12 text-sm">
              {filter === "all"
                ? "这个 key 还没有任何调用记录。"
                : "没有符合该筛选的记录。"}
            </div>
          ) : (
            filtered.map((log) => (
              <LogCard key={log.id} log={log} scope="me" />
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Cross-key user-facing audit page. Mounted at `/me/logs`. */
export function MyLogs(): JSX.Element {
  const [logs, setLogs] = useState<MySendLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogFilter>("all");

  const refresh = useCallback(async () => {
    const res = await api.listMyLogs(200);
    if (res.code === 0 && res.data) {
      setLogs(res.data);
      setError(null);
    } else {
      setError(translateError(res.message, res.code));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const filtered = useMemo(
    () => (logs ? applyFilter(logs, filter) : null),
    [logs, filter],
  );

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">我的发送日志</h2>
        <p className="mt-1 text-sm text-slate-500">
          每次通过 SendKey 调用 /send 接口的记录。展示最近 200 条,每 5 秒自动刷新。
        </p>
      </div>

      <FilterTabs value={filter} onChange={setFilter} />

      {error && <ErrorAlert>{error}</ErrorAlert>}

      {!filtered ? (
        <div className="text-center text-slate-400 py-12 text-sm">加载中…</div>
      ) : filtered.length === 0 ? (
        <EmptyLogs />
      ) : (
        <div className="space-y-2">
          {filtered.map((log) => (
            <LogCard key={log.id} log={log} scope="me" showKeyName />
          ))}
        </div>
      )}
    </section>
  );
}

/** Operator-only cross-user audit page. Mounted at `/admin/logs`. */
export function AdminLogs(): JSX.Element {
  const [logs, setLogs] = useState<AdminSendLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    const res = await api.listAdminLogs(500);
    if (res.code === 0 && res.data) {
      setLogs(res.data);
      setError(null);
    } else {
      setError(translateError(res.message, res.code));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const filtered = useMemo(() => {
    if (!logs) return null;
    return applyFilter(logs, filter).filter((l) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        l.username.toLowerCase().includes(q) ||
        l.keyName.toLowerCase().includes(q) ||
        String(l.targetQq).includes(q) ||
        (l.title ?? "").toLowerCase().includes(q) ||
        l.content.toLowerCase().includes(q)
      );
    });
  }, [logs, filter, search]);

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">所有发送日志</h2>
        <p className="mt-1 text-sm text-slate-500">
          跨用户审计每一次 /send 调用。最多展示最近 500 条,每 5 秒自动刷新。
        </p>
      </div>

      <div className="card">
        <div className="card-body flex flex-wrap items-center gap-3">
          <input
            className="input flex-1 min-w-48"
            placeholder="按用户名 / key 名 / 目标 QQ / 内容过滤"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <FilterTabs value={filter} onChange={setFilter} />
        </div>
      </div>

      {error && <ErrorAlert>{error}</ErrorAlert>}

      {!filtered ? (
        <div className="text-center text-slate-400 py-12 text-sm">加载中…</div>
      ) : filtered.length === 0 ? (
        <EmptyLogs />
      ) : (
        <div className="space-y-2">
          {filtered.map((log) => (
            <LogCard
              key={log.id}
              log={log}
              scope="admin"
              showKeyName
              showOwner={log.username}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FilterTabs({
  value,
  onChange,
}: {
  value: LogFilter;
  onChange: (next: LogFilter) => void;
}): JSX.Element {
  const tabs: Array<{ key: LogFilter; label: string }> = [
    { key: "all", label: "全部" },
    { key: "ok", label: "成功" },
    { key: "fail", label: "失败" },
    { key: "file", label: "文件" },
  ];
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-1 text-sm">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-3 py-1 rounded-md transition-colors ${
            value === t.key
              ? "bg-white shadow-sm text-slate-900"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function LogCard({
  log,
  scope,
  showKeyName,
  showOwner,
}: {
  log: AnyLog;
  scope: "me" | "admin";
  showKeyName?: boolean;
  showOwner?: string;
}): JSX.Element {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const ok = log.statusCode === 0;

  // Pull "filename (size)" out of the "[文件] xxx (1.2 KB)" content prefix
  // we wrote at send time. That's the cheapest way to surface the filename
  // here without an extra round-trip to /attachment metadata. Falls back to
  // a generic label if the prefix doesn't match.
  const fileMeta = log.hasAttachment ? parseFileMeta(log.content) : null;
  const messageBody = log.hasAttachment ? null : log.content;

  async function handleDownload(): Promise<void> {
    setDownloading(true);
    setDownloadError(null);
    const r = await downloadAttachment(scope, log.id);
    setDownloading(false);
    if (!r.ok) setDownloadError(translateError(r.reason));
  }

  return (
    <article
      className={`rounded-xl ring-1 px-4 py-3 ${
        ok
          ? "bg-emerald-50/40 ring-emerald-100"
          : "bg-rose-50/40 ring-rose-100"
      }`}
    >
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {ok ? (
            <span className="badge-success">✓ 成功</span>
          ) : (
            <span className="badge-danger">× {log.statusCode}</span>
          )}
          {!ok && log.reason && (
            <span className="text-xs text-rose-700 font-medium">
              {translateError(log.reason, log.statusCode)}
            </span>
          )}
          {showOwner && (
            <span className="text-xs text-slate-500">
              用户 <code className="code-chip">{showOwner}</code>
            </span>
          )}
          {showKeyName && "keyName" in log && (
            <span className="text-xs text-slate-500">
              key <code className="code-chip">{log.keyName}</code>
            </span>
          )}
          <span className="text-xs text-slate-500">
            → <code className="code-chip">{log.targetQq}</code>
          </span>
        </div>
        <div className="text-xs text-slate-400 whitespace-nowrap">
          {new Date(log.createdAt).toLocaleString()}
          <span className="ml-2 text-slate-300">·</span>
          <span className="ml-2 font-mono">{log.durationMs}ms</span>
        </div>
      </header>
      <div className="mt-2 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0 text-sm text-slate-800 break-words">
          {log.title && (
            <span className="font-semibold mr-1">【{log.title}】</span>
          )}
          {messageBody !== null && (
            <span className="whitespace-pre-wrap">{messageBody}</span>
          )}
          {log.hasAttachment && fileMeta && (
            <span className="text-slate-500 text-xs">
              发送了一个文件
            </span>
          )}
        </div>
        {log.hasAttachment && fileMeta && (
          <FileChip
            fileName={fileMeta.fileName}
            sizeLabel={fileMeta.sizeLabel}
            onClick={handleDownload}
            busy={downloading}
            error={downloadError}
          />
        )}
      </div>
    </article>
  );
}

/**
 * Right-aligned file chip rendered as a clickable card. Shows the filename
 * + human-readable size with a download glyph that animates on hover.
 */
function FileChip({
  fileName,
  sizeLabel,
  onClick,
  busy,
  error,
}: {
  fileName: string;
  sizeLabel: string;
  onClick: () => void;
  busy: boolean;
  error: string | null;
}): JSX.Element {
  const ext = extOf(fileName);
  return (
    <div className="flex flex-col items-end gap-1 max-w-[18rem] flex-none">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        title="点击下载"
        className="group flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white/80 px-3 py-2 hover:border-brand-300 hover:bg-brand-50/40 hover:shadow-sm disabled:opacity-60 disabled:cursor-wait transition-all w-full text-left"
      >
        <span className="relative flex h-9 w-9 flex-none items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-accent-500 text-white text-[10px] font-bold uppercase tracking-tight shadow-sm">
          {ext || "FILE"}
        </span>
        <span className="flex-1 min-w-0">
          <span
            className="block text-sm font-medium text-slate-800 truncate group-hover:text-brand-700"
            title={fileName}
          >
            {fileName}
          </span>
          <span className="block text-[11px] text-slate-500 mt-0.5">
            {busy ? "下载中…" : `${sizeLabel} · 点击下载`}
          </span>
        </span>
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-100 text-slate-500 group-hover:bg-brand-500 group-hover:text-white transition-colors">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="none"
            className="h-3.5 w-3.5"
            aria-hidden
          >
            <path
              d="M8 2v9m0 0L4.5 7.5M8 11l3.5-3.5M3 13h10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}

const FILE_META_RE = /^\[文件\]\s+(.+?)\s*\(([^)]+)\)$/;

/**
 * Parse the "[文件] <name> (<size>)" envelope we write to SendLog.content
 * back into its parts. Returns null when the content doesn't match (e.g.
 * a file send that failed before we knew the size).
 */
function parseFileMeta(
  content: string,
): { fileName: string; sizeLabel: string } | null {
  const m = content.match(FILE_META_RE);
  if (!m) return null;
  return { fileName: m[1]!, sizeLabel: m[2]! };
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase().slice(0, 4);
}

function EmptyLogs(): JSX.Element {
  return (
    <div className="card">
      <div className="card-body text-center py-16">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-slate-100 text-3xl">
          📜
        </div>
        <h3 className="font-semibold text-slate-700">还没有任何调用记录</h3>
        <p className="mt-1 text-sm text-slate-500">
          调用 SendKey 发一条消息后,这里就会出现日志。
        </p>
      </div>
    </div>
  );
}
