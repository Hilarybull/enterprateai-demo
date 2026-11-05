import { useState } from "react";
import { useParams } from "react-router-dom";
import { apiRequest } from "../api/client";

/** The "Stop these emails" link in a claim email. A press, not the link itself: mail scanners open links on their own. */
export default function ClaimEmailsOptOutPage() {
  const { token } = useParams();
  const [state, setState] = useState({});
  async function stop() {
    setState({ busy: true });
    try { setState({ done: (await apiRequest(`/marketplace/invitations/${encodeURIComponent(token)}/opt-out`, "POST", {})).message }); }
    catch { setState({ problem: "That didn't go through, or this link is no longer valid. Please try again." }); }
  }
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Stop these emails</h1>
      {state.done
        ? <p role="status" className="mt-3 text-sm text-slate-600 dark:text-slate-300">{state.done}</p>
        : <>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">We'll stop emailing this address about claiming this business on the EnterprateAI Marketplace.</p>
          <button type="button" disabled={state.busy} onClick={stop} className="mt-5 rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">{state.busy ? "Stopping…" : "Stop these emails"}</button>
          {state.problem && <p role="alert" className="mt-3 text-[13px] font-medium text-rose-600">{state.problem}</p>}
        </>}
    </main>
  );
}
