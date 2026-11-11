import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";

// The page behind "Unsubscribe" in an optional email (the owner, 10 Nov). No sign-in: the link itself says who and
// which email. Stop this kind, or every optional email; either can be undone here. Account emails always go.

export default function EmailOptOutPage() {
  const [params] = useSearchParams();
  const token = params.get("t") || "";
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const q = `t=${encodeURIComponent(token)}`;
  useEffect(() => {
    if (!token) { setProblem("This link isn't valid."); return; }
    apiRequest(`/email/opt-out?${q}`, "GET").then(setState).catch((e) => setProblem(String(e?.message || "").replace(/^HTTP \d+:\s*/, "") || "This link isn't valid."));
  }, [token]); // eslint-disable-line
  async function act(path, scope) {
    setBusy(true); setProblem(null);
    try { setState(await apiRequest(`/email/${path}?${q}&scope=${scope}`, "POST", {})); }
    catch (e) { setProblem(String(e?.message || "").replace(/^HTTP \d+:\s*/, "") || "That couldn't be saved. Please try again."); }
    finally { setBusy(false); }
  }
  const btn = "rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50";
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <section aria-labelledby="optout-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 id="optout-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">Email preferences</h1>
        {problem && <p role="alert" className="mt-3 text-sm font-medium text-rose-600">{problem}</p>}
        {!state && !problem && <p role="status" className="mt-3 text-sm text-slate-500">Loading…</p>}
        {state && (
          <div className="mt-3 space-y-4 text-sm text-slate-700 dark:text-slate-300">
            <p>For <span className="font-semibold">{state.email}</span>.</p>
            {state.all ? (
              <>
                <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">You won't get any optional emails from EnterprateAI.</p>
                <button type="button" disabled={busy} onClick={() => act("opt-in", "all")} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200`}>Get optional emails again</button>
              </>
            ) : state.this ? (
              <>
                <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">You're unsubscribed from "{state.label}" emails.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => act("opt-out", "all")} className={`${btn} bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900`}>Stop all optional emails too</button>
                  <button type="button" disabled={busy} onClick={() => act("opt-in", "this")} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200`}>Undo</button>
                </div>
              </>
            ) : (
              <>
                <p>Don't want "{state.label}" emails from EnterprateAI?</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => act("opt-out", "this")} className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}>Stop these emails</button>
                  <button type="button" disabled={busy} onClick={() => act("opt-out", "all")} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200`}>Stop all optional emails</button>
                </div>
              </>
            )}
            <p className="text-[12px] text-slate-500">Emails you need for your account, such as password links and sign-in codes, and things you ask us to send, always go.</p>
          </div>
        )}
      </section>
    </main>
  );
}
