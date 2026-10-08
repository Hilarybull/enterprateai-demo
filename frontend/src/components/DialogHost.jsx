import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { attachDialogHost } from "../lib/dialog";

// Draws the app's own confirm and message dialogs (see lib/dialog.js). One at a time; further
// requests wait their turn. Escape or a click outside cancels; the main button takes focus.
export default function DialogHost() {
  const [queue, setQueue] = useState([]);
  const current = queue[0] || null;
  const mainButton = useRef(null);

  useEffect(() => attachDialogHost((item) => setQueue((q) => [...q, item])), []);

  function close(result) {
    if (!current) return;
    current.resolve(current.kind === "confirm" ? result : undefined);
    setQueue((q) => q.slice(1));
  }

  useEffect(() => {
    if (!current) return undefined;
    mainButton.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [current]);      // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return null;
  const isConfirm = current.kind === "confirm";
  const title = current.title || (isConfirm ? "Please confirm" : current.tone === "info" ? "For your information" : "Something went wrong");
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
      <div role={isConfirm ? "dialog" : "alertdialog"} aria-modal="true" aria-labelledby="ea-dialog-title" aria-describedby="ea-dialog-message"
        className="w-full max-w-sm rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="px-6 pb-4 pt-5">
          <h2 id="ea-dialog-title" className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h2>
          <p id="ea-dialog-message" className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-slate-300">{current.message}</p>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-6 py-4 sm:flex-row sm:justify-end dark:border-slate-800">
          {isConfirm && (
            <button type="button" onClick={() => close(false)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {current.cancelLabel}
            </button>
          )}
          <button ref={mainButton} type="button" onClick={() => close(true)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white ${current.danger ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-600 hover:bg-brand-700"}`}>
            {current.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
