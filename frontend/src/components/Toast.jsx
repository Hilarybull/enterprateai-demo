import { useEffect, useRef, useState } from "react";

// The one toast look (22 Oct): a white card, a coloured bar and icon on the left (green success, amber pending, red
// error), a bold title, a grey detail line, actions on the right. Bottom right from 768px; full width at the bottom on a
// phone, above the chat button. Errors stay until closed; the rest close after 5 s, paused on hover or focus.

const ICONS = {
  error: <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>,
  success: <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>,
  pending: <span className="mt-0.5 inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-200 border-t-amber-500" />,
  warn: <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
  info: <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>,
};
const BAR = { error: "before:bg-rose-500", success: "before:bg-emerald-500", pending: "before:bg-amber-500", warn: "before:bg-amber-500", info: "before:bg-brand-500" };
const ICON_TONE = { error: "text-rose-600", success: "text-emerald-600", pending: "text-amber-600", warn: "text-amber-600", info: "text-brand-600" };
const TITLES = { error: "Something needs your attention", success: "Done", pending: "Working on it…", warn: "Heads up", info: "Info" };
const DISMISS_MS = 5000;

export default function Toast({ message, kind = "info", title, actions = [], onClose }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(DISMISS_MS);
  const started = useRef(Date.now());
  const persist = kind === "error";
  useEffect(() => {
    if (persist || paused) return undefined;
    started.current = Date.now();
    const t = setTimeout(onClose, left.current);
    return () => { clearTimeout(t); left.current = Math.max(800, left.current - (Date.now() - started.current)); };
  }, [persist, paused, onClose, kind, title, message]);
  useEffect(() => { left.current = DISMISS_MS; }, [kind, title, message]);      // replaced in place: a fresh 5 s
  if (!message && !title) return null;
  return (
    <div role={persist ? "alert" : "status"} aria-live={persist ? "assertive" : "polite"} data-toast={kind}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      className={`pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white py-3 pl-4 pr-2 shadow-lg before:absolute before:inset-y-0 before:left-0 before:w-1 ${BAR[kind] || BAR.info} motion-safe:animate-[toast-in_0.25s_ease-out] dark:border-slate-700 dark:bg-slate-900 md:max-w-[400px]`}>
      <span className={`mt-0.5 ${ICON_TONE[kind] || ICON_TONE.info}`}>{ICONS[kind] || ICONS.info}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-bold leading-snug text-slate-900 dark:text-slate-100">{title || TITLES[kind]}</p>
        {message && <p className="mt-0.5 text-[12.5px] leading-snug text-slate-600 dark:text-slate-300">{message}</p>}
      </div>
      {actions.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 self-center">
          {actions.map((a) => (
            <button key={a.label} type="button" onClick={() => { onClose(); a.onClick?.(); }} data-toast-action={a.label}
              className="rounded-lg px-2 py-1 text-[12.5px] font-semibold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-slate-800">{a.label}</button>
          ))}
        </div>
      )}
      <button type="button" onClick={onClose} aria-label="Close" data-toast-close
        className="shrink-0 self-start rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

/** The host, once in Layout: at most the 2 newest; bottom right from 768px, full width above the chat button below it. */
export function ToastContainer({ toasts = [], onClose }) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-24 z-[200] flex flex-col items-stretch gap-2 md:inset-x-auto md:bottom-6 md:right-24 md:items-end" data-toasts>
      {toasts.slice(-2).map((t) => (
        <Toast key={t.id} message={t.message} kind={t.kind} title={t.title} actions={t.actions} onClose={() => onClose(t.id)} />
      ))}
    </div>
  );
}
