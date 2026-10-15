import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../api/client";
import { UndoToast } from "../FirstResultPanel";

// P1.14: what the owner pinned to the dashboard (a funding case, launch plans), live: label, score, verdict, coverage and
// the pack, with Open, Run the check again and Unpin (Undo for 5 seconds).
// Placement (the owner's QA, 15 Oct): a "Pinned" row directly under the result card, on the stage cards' grid. The case
// already shown as the result card is never a second card: the result card carries the filled pin instead. One item is a
// full-width strip; two or three are grid cards; more than three show three and "View all pinned (N)".

/** The pinned list, loaded once for the dashboard, shared by the result card's pin and the Pinned row. */
export function usePinned(businessId) {
  const [state, setState] = useState(null);
  const [undo, setUndo] = useState(null);      // the item just unpinned, for Undo
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
  const unpin = (item) => { setUndo(item); setState((s) => (s ? { ...s, items: (s.items || []).filter((x) => x.id !== item.id) } : s)); pin(item.id, "unpin"); };
  const toast = (
    <UndoToast open={Boolean(undo)} text="Unpinned from your dashboard."
      onUndo={() => { const c = undo; setUndo(null); pin(c.id, "pin"); }} onDone={() => setUndo(null)} />
  );
  return { items: state?.items || [], isPinned: (id) => Boolean(id) && (state?.items || []).some((x) => x.id === id), unpin, toast };
}

export const PinIcon = ({ filled = false }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}><path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3z" /></svg>
);

const score = (s) => (typeof s === "number" ? `${Number.isInteger(s) ? s : s.toFixed(1)}/100` : "No score yet");
const packLine = (c) => (c.pack?.total ? `Pack ${c.pack.ready} of ${c.pack.total}` : "");
const openWord = (c) => `Open ${c.kind === "funding" ? "funding case" : "launch plan"}`;
const again = (c) => c.open.replace("?tab=results", "?tab=results&check=again");
const CARD = "rounded-2xl border border-slate-200/70 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const BTN = "rounded-lg px-3 py-1.5 text-[13px] font-semibold";

function UnpinButton({ item, onUnpin, className = "" }) {
  return (
    <button type="button" aria-label="Unpin" title="Unpin" onClick={() => onUnpin(item)} data-unpin
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-brand-600 hover:bg-slate-100 hover:text-slate-700 ${className}`}>
      <PinIcon filled />
    </button>
  );
}

export default function PinnedCards({ pinned, excludeId }) {
  const navigate = useNavigate();
  const all = pinned.items.filter((c) => c.id !== excludeId);
  const items = all.slice(0, 3);
  const more = all.length - items.length;
  if (!items.length) return pinned.toast;
  const status = (c) => [score(c.score), c.verdict, packLine(c)].filter(Boolean);

  if (items.length === 1) {
    const c = items[0];
    return (
      <section aria-label="Pinned" data-pinned data-pinned-layout="strip">
        <article className={`${CARD} flex min-h-[72px] items-center gap-4 px-5 py-3 max-lg:flex-col max-lg:items-stretch max-lg:gap-2`} data-pinned-card={c.id}>
          <p className="min-w-0 truncate text-[14px] text-slate-900 lg:max-w-[40%] dark:text-slate-100" title={c.label}>
            <span className="mr-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">Pinned ·</span>
            <span className="font-semibold">{c.label}</span>
          </p>
          <p className="min-w-0 flex-1 truncate text-[13px] text-slate-600 dark:text-slate-300" data-pinned-score>{status(c).join(" · ")}</p>
          <div className="flex shrink-0 items-center gap-2 max-lg:flex-col max-lg:items-stretch">
            <button type="button" onClick={() => navigate(c.open)} className={`${BTN} bg-brand-600 text-white hover:bg-brand-700`}>{openWord(c)}</button>
            <button type="button" onClick={() => navigate(again(c))} className={`${BTN} border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200`}>Run the check again</button>
            <UnpinButton item={c} onUnpin={pinned.unpin} className="max-lg:self-end" />
          </div>
        </article>
        {pinned.toast}
      </section>
    );
  }

  return (
    <section aria-label="Pinned" data-pinned data-pinned-layout="grid">
      {/* The stage cards' own grid, so the edges line up with the rows above and below. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-pinned-grid>
        {items.map((c, n) => (
          // Three on two columns: the third spans the row, so there is never an empty half-row.
          <article key={c.id} className={`${CARD} relative flex h-full flex-col p-5 ${items.length === 3 && n === 2 ? "md:col-span-2 xl:col-span-1" : ""}`} data-pinned-card={c.id}>
            <UnpinButton item={c} onUnpin={pinned.unpin} className="absolute right-3 top-3" />
            <p className="pr-9 text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">Pinned</p>
            <p className="mt-1 pr-9 text-[15px] font-semibold text-slate-900 dark:text-slate-100">{c.label}</p>
            <p className="mt-1 text-[14px] text-slate-800 dark:text-slate-200" data-pinned-score>{score(c.score)}{c.coverage != null ? ` · ${c.coverage}% evidence` : ""}</p>
            {c.verdict && <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">{c.verdict}</p>}
            {packLine(c) && <p className="mt-0.5 text-[12.5px] text-slate-500">{packLine(c)} ready</p>}
            <div className="mt-auto flex flex-wrap gap-2 pt-3 max-md:flex-col">
              <button type="button" onClick={() => navigate(c.open)} className={`${BTN} bg-brand-600 text-white hover:bg-brand-700`}>{openWord(c)}</button>
              <button type="button" onClick={() => navigate(again(c))} className={`${BTN} border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200`}>Run the check again</button>
            </div>
          </article>
        ))}
      </div>
      {more > 0 && (
        <div className="mt-2 text-right">
          <button type="button" onClick={() => navigate("/funding")} className="text-[13px] font-semibold text-brand-700 hover:underline">View all pinned ({all.length})</button>
        </div>
      )}
      {pinned.toast}
    </section>
  );
}
