import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

// A native modal keeps keyboard focus inside, supports Escape and restores focus
// to the opening control. Only its content scrolls on narrow or short screens.
export default function Popup({ title, children, footer, onClose }) {
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (node.showModal) node.showModal();
    else node.setAttribute("open", "");
    return () => {
      if (node.close) node.close();
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return createPortal(<dialog ref={dialog} aria-modal="true" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/50 open:flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6 dark:border-slate-800">
      <h2 id={titleId} className="min-w-0 text-lg font-semibold">{title}</h2>
      <button type="button" onClick={onClose} aria-label="Close popup" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800">×</button>
    </header>
    <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">{children}</div>
    {footer && <footer className="shrink-0 border-t border-slate-100 p-4 dark:border-slate-800">{footer}</footer>}
  </dialog>, document.body);
}
