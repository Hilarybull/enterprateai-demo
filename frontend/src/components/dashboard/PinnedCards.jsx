import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../api/client";
import { UndoToast } from "../FirstResultPanel";

// P1.14: what the owner pinned to the dashboard (a funding case, launch plans), live: label, score, verdict, coverage and
// the pack, with Open, Run the check again and Unpin (Undo for 5 seconds). At most three; the rest are counted.
export default function PinnedCards({ businessId }) {
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [undo, setUndo] = useState(null);
  const load = useCallback(() => {
    if (!businessId) return;
    apiRequest(`/businesses/${businessId}/pinned`, "GET").then(setState).catch(() => setState(null));
  }, [businessId]);
  useEffect(() => {
    load();
    const again = () => load();
    window.addEventListener("ea:agent:changed", again);
    window.addEventListener("focus", again);
    return () => { window.removeEventListener("ea:agent:changed", again); window.removeEventListener("focus", again); };
  }, [load]);
  const pin = async (id, action) => {
    try { await apiRequest(`/businesses/${businessId}/pinned/${id}/${action}`, "POST", {}); } finally { load(); }
  };
  const items = state?.items || [];
  if (!items.length && !undo) return null;
  const score = (s) => (typeof s === "number" ? `${Number.isInteger(s) ? s : s.toFixed(1)}/100` : "No score yet");
  return (
    <section aria-label="Pinned" className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3" data-pinned>
      {items.map((c) => (
        <article key={c.id} className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900" data-pinned-card={c.id}>
          <button type="button" aria-label="Unpin" onClick={() => { setUndo(c); pin(c.id, "unpin"); }}
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3z" /></svg>
          </button>
          <p className="pr-9 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Pinned</p>
          <p className="mt-1 pr-9 text-[15px] font-semibold text-slate-900 dark:text-slate-100">{c.label}</p>
          <p className="mt-1 text-[14px] text-slate-800 dark:text-slate-200" data-pinned-score>{score(c.score)}{c.coverage != null ? ` · ${c.coverage}% evidence` : ""}</p>
          {c.verdict && <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">{c.verdict}</p>}
          {c.pack?.total ? <p className="mt-0.5 text-[12.5px] text-slate-500">Funding pack: {c.pack.ready} of {c.pack.total} ready</p> : null}
          <div className="mt-3 flex flex-wrap gap-2 max-md:flex-col">
            <button type="button" onClick={() => navigate(c.open)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700">
              Open {c.kind === "funding" ? "funding case" : "launch plan"}</button>
            <button type="button" onClick={() => navigate(c.open.replace("?tab=results", "?tab=results&check=again"))}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">Run the check again</button>
          </div>
        </article>
      ))}
      {state?.more > 0 && <button type="button" onClick={() => navigate("/funding")} className="self-center text-[13px] font-semibold text-brand-700 hover:underline">View all pinned ({state.more + items.length})</button>}
      <UndoToast open={Boolean(undo)} text="Unpinned from your dashboard." onUndo={() => { const c = undo; setUndo(null); pin(c.id, "pin"); }} onDone={() => setUndo(null)} />
    </section>
  );
}
