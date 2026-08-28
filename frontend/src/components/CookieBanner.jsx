import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

const COOKIE_KEY = "ea_cookie_consent";

export default function CookieBanner() {
  const [state, setState] = useState(null);
  const [analytics, setAnalytics] = useState(true);

  useEffect(() => {
    try {
      const val = localStorage.getItem(COOKIE_KEY);
      setState(val ? "saved" : "pending");
    } catch {
      setState("pending");
    }
  }, []);

  function savePreferences() {
    try { localStorage.setItem(COOKIE_KEY, JSON.stringify({ operational: true, analytics })); } catch {}
    setState("saved");
  }

  function acceptAll() {
    try { localStorage.setItem(COOKIE_KEY, JSON.stringify({ operational: true, analytics: true })); } catch {}
    setState("saved");
  }

  function withdraw() {
    try { localStorage.removeItem(COOKIE_KEY); } catch {}
    setState("pending");
  }

  if (state === null) return null;

  if (state === "saved") {
    return (
      <div style={{ zIndex: 35 }} className="pointer-events-auto fixed bottom-0 left-0 right-0 px-6 py-3">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 text-[13px] text-slate-600 dark:text-slate-400">
          <span>We use cookies on this site to enhance your user experience</span>
          <button onClick={withdraw} className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700 dark:text-brand-400">
            Withdraw consent
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ zIndex: 35 }} className="pointer-events-auto fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-5">

        <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">
          We use cookies on this site to enhance your user experience. You can opt out of these using the settings below.{" "}
          <Link to="/legal/privacy" className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700 dark:text-brand-400">
            Privacy Policy
          </Link>.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              checked
              disabled
              className="mt-0.5 h-4 w-4 shrink-0 cursor-not-allowed accent-brand-600 opacity-40"
            />
            <div>
              <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">Operational</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                These cookies cannot be opted out of as they are essential for the operation of this website.
              </p>
            </div>
          </div>

          <div className="flex cursor-pointer items-start gap-3" onClick={() => setAnalytics(a => !a)}>
            <input
              type="checkbox"
              checked={analytics}
              onChange={(e) => setAnalytics(e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand-600"
            />
            <div>
              <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">Analytics and Marketing</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                These are cookies used by us to better understand how you are interacting with our website.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            onClick={savePreferences}
            className="text-[13px] font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700 dark:text-brand-400"
          >
            Save preferences
          </button>
          <button
            onClick={acceptAll}
            className="rounded-lg bg-brand-600 px-5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            Accept all cookies
          </button>
        </div>

      </div>
    </div>
  );
}
