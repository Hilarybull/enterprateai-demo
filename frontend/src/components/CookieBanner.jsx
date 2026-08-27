import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

const COOKIE_KEY = "ea_cookie_consent";

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(COOKIE_KEY)) setVisible(true);
    } catch {}
  }, []);

  function accept() {
    try { localStorage.setItem(COOKIE_KEY, "accepted"); } catch {}
    setVisible(false);
  }

  function reject() {
    try { localStorage.setItem(COOKIE_KEY, "rejected"); } catch {}
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      style={{ zIndex: 9990 }}
      className="pointer-events-auto fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white px-4 py-4 shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-sm sm:rounded-2xl sm:border sm:shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-400">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/>
            <path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Cookies &amp; Privacy</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">
            We use essential cookies to keep the platform running and optional ones to improve your experience. See our{" "}
            <Link to="/legal/privacy" className="text-brand-600 underline hover:text-brand-700 dark:text-brand-400">Privacy Policy</Link>.
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={reject}
          className="flex-1 rounded-xl border border-slate-200 py-2 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          Reject optional
        </button>
        <button
          onClick={accept}
          className="flex-[1.4] rounded-xl bg-brand-600 py-2 text-[12px] font-semibold text-white transition hover:bg-brand-700"
        >
          Accept all
        </button>
      </div>
    </div>
  );
}
