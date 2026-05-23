import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Inline error banner. Wider footprint than a one-liner so error reasons
 * have room to breathe; rounded, soft tinted background, leading icon.
 */
export function ErrorAlert({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-700 backdrop-blur-sm"
    >
      <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-rose-100 text-rose-600 text-xs font-bold">
        !
      </span>
      <div className="flex-1 leading-relaxed">{children}</div>
    </div>
  );
}

export function InfoAlert({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
      <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-200 text-slate-600 text-xs font-bold">
        i
      </span>
      <div className="flex-1 leading-relaxed">{children}</div>
    </div>
  );
}

export function WarnAlert({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-amber-200 text-amber-700 text-xs font-bold">
        ⚠
      </span>
      <div className="flex-1 leading-relaxed">{children}</div>
    </div>
  );
}

/**
 * Toast manager. Mount `<ToastProvider>` once at the app root, then call
 * `useToast()` inside any component to push transient feedback messages.
 *
 *   const toast = useToast();
 *   toast.success("已复制");
 *   toast.error("发送失败");
 *   toast.info("已刷新");
 *
 * Toasts auto-dismiss after ~3s and stack vertically in the top-right.
 */
type ToastKind = "success" | "error" | "info";

type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
};

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_TTL_MS = 3000;

export function ToastProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++idRef.current;
      setItems((prev) => [...prev, { id, kind, message }]);
      window.setTimeout(() => remove(id), TOAST_TTL_MS);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="fixed top-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
          {items.map((t) => (
            <ToastItemView key={t.id} item={t} onClose={() => remove(t.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Soft fallback: no provider mounted (e.g. early bootstrap) — log only.
    return {
      success: (m) => console.info("[toast:success]", m),
      error: (m) => console.warn("[toast:error]", m),
      info: (m) => console.info("[toast:info]", m),
    };
  }
  return ctx;
}

function ToastItemView({
  item,
  onClose,
}: {
  item: ToastItem;
  onClose: () => void;
}): JSX.Element {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // Trigger the enter animation on next frame.
    const r = requestAnimationFrame(() => setVisible(true));
    const t = window.setTimeout(() => setVisible(false), TOAST_TTL_MS - 300);
    return () => {
      cancelAnimationFrame(r);
      clearTimeout(t);
    };
  }, []);

  const styles = STYLES[item.kind];
  return (
    <div
      className={`pointer-events-auto transform transition-all duration-200 ease-out ${
        visible
          ? "opacity-100 translate-x-0"
          : "opacity-0 translate-x-2"
      }`}
    >
      <div
        className={`flex items-center gap-3 rounded-xl px-4 py-3 shadow-xl ring-1 min-w-[16rem] max-w-md ${styles.bg}`}
      >
        <span
          className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-sm font-bold ${styles.icon}`}
        >
          {styles.glyph}
        </span>
        <span className={`text-sm flex-1 ${styles.text}`}>{item.message}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs ${styles.text} opacity-50 hover:opacity-100 transition-opacity`}
        >
          ×
        </button>
      </div>
    </div>
  );
}

const STYLES: Record<
  ToastKind,
  { bg: string; icon: string; text: string; glyph: string }
> = {
  success: {
    bg: "bg-emerald-50 ring-emerald-200",
    icon: "bg-emerald-100 text-emerald-700",
    text: "text-emerald-800",
    glyph: "✓",
  },
  error: {
    bg: "bg-rose-50 ring-rose-200",
    icon: "bg-rose-100 text-rose-600",
    text: "text-rose-700",
    glyph: "!",
  },
  info: {
    bg: "bg-slate-50 ring-slate-200",
    icon: "bg-slate-200 text-slate-700",
    text: "text-slate-700",
    glyph: "i",
  },
};

/**
 * Legacy single-toast component kept for compatibility; new code should use
 * `useToast()` instead.
 */
export function Toast({
  kind,
  message,
  onDone,
}: {
  kind: "success" | "error";
  message: string;
  onDone: () => void;
}): JSX.Element {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 2500);
    const t2 = setTimeout(onDone, 2900);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [onDone]);
  return (
    <div
      className={`fixed top-6 right-6 z-50 transition-all duration-300 ${
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 -translate-y-2 pointer-events-none"
      }`}
    >
      <div
        className={`flex items-center gap-3 rounded-xl px-4 py-3 shadow-xl ring-1 ${
          kind === "success"
            ? "bg-emerald-50 ring-emerald-200 text-emerald-800"
            : "bg-rose-50 ring-rose-200 text-rose-700"
        }`}
      >
        <span
          className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-sm font-bold ${
            kind === "success"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-rose-100 text-rose-600"
          }`}
        >
          {kind === "success" ? "✓" : "!"}
        </span>
        <span className="text-sm">{message}</span>
      </div>
    </div>
  );
}

/**
 * PopConfirm: a small popover anchored to a trigger element. Click → opens
 * the popover with a question + 取消/确认; click outside or escape to dismiss.
 *
 * Usage:
 *   <PopConfirm
 *     title="确认删除?"
 *     desc="此操作无法恢复"
 *     onConfirm={async () => doDelete()}
 *   >
 *     {(open) => (
 *       <button onClick={open} className="btn-ghost btn-sm">删除</button>
 *     )}
 *   </PopConfirm>
 */
export function PopConfirm({
  title,
  desc,
  confirmText = "确认",
  cancelText = "取消",
  tone = "danger",
  onConfirm,
  children,
}: {
  title: string;
  desc?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void | Promise<void>;
  children: (open: () => void) => ReactNode;
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right,
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onClick(e: MouseEvent): void {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        popRef.current?.contains(t)
      ) {
        return;
      }
      setIsOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setIsOpen(false);
    }
    function onScroll(): void {
      // Re-anchor on scroll/resize so the popover stays attached to its trigger.
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [isOpen]);

  return (
    <span ref={triggerRef} className="relative inline-block">
      {children(() => setIsOpen(true))}
      {isOpen && pos &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-[100] w-72 rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 p-4 animate-[fade-in_120ms_ease-out]"
          >
            <div className="flex items-start gap-2.5">
              <span
                className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-bold ${
                  tone === "danger"
                    ? "bg-rose-100 text-rose-600"
                    : "bg-brand-100 text-brand-600"
                }`}
              >
                ?
              </span>
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900">
                  {title}
                </div>
                {desc && (
                  <div className="mt-1 text-xs text-slate-500 leading-relaxed">
                    {desc}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="btn-secondary btn-sm"
                disabled={busy}
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onConfirm();
                  } finally {
                    setBusy(false);
                    setIsOpen(false);
                  }
                }}
                className={
                  tone === "danger" ? "btn-danger btn-sm" : "btn-primary btn-sm"
                }
                disabled={busy}
              >
                {busy ? "处理中…" : confirmText}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
