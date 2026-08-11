import { useEffect, useRef } from "react";

const ICONS = {
  error: (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  success: (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  warn: (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  info: (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

const STYLES = {
  error: {
    wrap: "bg-white dark:bg-slate-900 border-l-4 border-l-rose-500 border border-slate-200 dark:border-slate-700",
    icon: "text-rose-500",
    title: "text-rose-700 dark:text-rose-400",
    body: "text-slate-600 dark:text-slate-400",
  },
  success: {
    wrap: "bg-white dark:bg-slate-900 border-l-4 border-l-emerald-500 border border-slate-200 dark:border-slate-700",
    icon: "text-emerald-500",
    title: "text-emerald-700 dark:text-emerald-400",
    body: "text-slate-600 dark:text-slate-400",
  },
  warn: {
    wrap: "bg-white dark:bg-slate-900 border-l-4 border-l-amber-500 border border-slate-200 dark:border-slate-700",
    icon: "text-amber-500",
    title: "text-amber-700 dark:text-amber-400",
    body: "text-slate-600 dark:text-slate-400",
  },
  info: {
    wrap: "bg-white dark:bg-slate-900 border-l-4 border-l-brand-500 border border-slate-200 dark:border-slate-700",
    icon: "text-brand-500",
    title: "text-brand-700 dark:text-brand-400",
    body: "text-slate-600 dark:text-slate-400",
  },
};

const TITLES = {
  error: "Something needs your attention",
  success: "Done",
  warn: "Heads up",
  info: "Info",
};

// Auto-dismiss after this many ms (0 = no auto-dismiss)
const AUTO_DISMISS_MS = {
  error: 6000,
  success: 3500,
  warn: 5000,
  info: 4000,
};

/**
 * Toast — floating branded notification popup.
 *
 * Props:
 *   message  – string (the user-facing message)
 *   kind     – "error" | "success" | "warn" | "info"  (default "info")
 *   title    – optional override for the heading
 *   onClose  – called when dismissed
 */
export default function Toast({ message, kind = "info", title, onClose }) {
  const timerRef = useRef(null);
  const s = STYLES[kind] || STYLES.info;

  useEffect(() => {
    const ms = AUTO_DISMISS_MS[kind] ?? 4000;
    if (ms > 0) {
      timerRef.current = setTimeout(onClose, ms);
    }
    return () => clearTimeout(timerRef.current);
  }, [kind, onClose]);

  if (!message) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`
        pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl p-4 shadow-xl
        ${s.wrap}
        animate-[toast-in_0.25s_ease-out]
      `}
      style={{ animationFillMode: "both" }}
    >
      <span className={`mt-0.5 ${s.icon}`}>{ICONS[kind]}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-bold leading-snug ${s.title}`}>
          {title || TITLES[kind]}
        </p>
        <p className={`mt-0.5 text-[12px] leading-relaxed ${s.body}`}>{message}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="ml-1 mt-0.5 shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition dark:hover:bg-slate-800 dark:hover:text-slate-300"
        aria-label="Dismiss"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/**
 * ToastContainer — fixed portal wrapper.
 * Place once per page; renders all active toasts.
 *
 * Props:
 *   toasts  – array of { id, message, kind, title }
 *   onClose – (id) => void
 */
export function ToastContainer({ toasts = [], onClose }) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[200] flex flex-col items-end gap-3 sm:right-6">
      {toasts.map((t) => (
        <Toast key={t.id} message={t.message} kind={t.kind} title={t.title} onClose={() => onClose(t.id)} />
      ))}
    </div>
  );
}
