import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../api/client";
import { UndoToast } from "../FirstResultPanel";

// P1.14: what the owner pinned to the dashboard (a funding case, launch plans, any future case), live.
// One pattern for every item (the owner's brief, 20 Oct): the same full-width strip, an icon, the case's name, one status
// line ("38/100 · 6 things to do" or "Not checked yet"), ONE button ("Open") and a ⋯ menu with Unpin, Run the check
// again and Edit answers. No "Pinned" label (it is in the Pinned section), no pin icon and no X on a strip.

/** The pinned list, loaded once for the dashboard, shared by the result card and the Pinned row. */
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

/** "38/100 · 6 things to do", or "Not checked yet". */
export function stripStatus(score, toDo) {
  if (typeof score !== "number") return "Not checked yet";
  const n = Number.isInteger(score) ? score : Number(score.toFixed(1));
  const things = Number(toDo) || 0;
  return `${n}/100${things ? ` · ${things} ${things === 1 ? "thing" : "things"} to do` : " · Nothing left to do"}`;
}

/** A pinned item as a strip: { id, kind, title, score, to_do, open, again, answers }. */
const fromPinned = (c) => ({ id: c.id, kind: c.kind, title: c.title || String(c.label || "").replace(/^(Funding|Launch) readiness · /, ""),
  status: stripStatus(c.score, c.to_do ?? (c.blockers || []).length), open: c.open, again: c.again || `${c.open}?check=again`,
  answers: c.answers || `${c.open}?tab=answers` });

const KIND_WORD = { funding: "Funding readiness", launch: "Launch readiness" };

const ICONS = {
  funding: <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.7 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3" />,
  launch: <path strokeLinecap="round" strokeLinejoin="round" d="M5 21V4m0 0h11l-2 4 2 4H5" />,
};

function StripMenu({ item, onUnpin, onRemove }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", key); };
  }, [open]);
  const go = (fn) => () => { setOpen(false); fn(); };
  const row = "block w-full px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800";
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" aria-label={`More for ${item.title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-strip-menu
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-30 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {onUnpin && <button type="button" role="menuitem" className={row} onClick={go(() => onUnpin())} data-unpin>Unpin</button>}
          <button type="button" role="menuitem" className={row} onClick={go(() => navigate(item.again))} data-strip-again>Run the check again</button>
          <button type="button" role="menuitem" className={row} onClick={go(() => navigate(item.answers))} data-strip-answers>Edit answers</button>
          {onRemove && <button type="button" role="menuitem" className={row} onClick={go(() => onRemove())} data-strip-remove>Remove from dashboard</button>}
        </div>
      )}
    </div>
  );
}

/** One strip: [icon] the name and its status, "Open", ⋯. One row from 640px, stacked below it. */
export function CaseStrip({ item, onUnpin = null, onRemove = null }) {
  const navigate = useNavigate();
  return (
    <article className="flex items-center gap-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm max-sm:flex-col max-sm:items-stretch max-sm:gap-3 dark:border-slate-800 dark:bg-slate-900"
      data-pinned-card={item.id} data-strip={item.kind}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>{ICONS[item.kind] || ICONS.funding}</svg>
        </span>
        <div className="min-w-0">
          {/* What kind of case it is, in small grey text above its name (the owner, 20 Oct: "how will I know which is which"). */}
          <p className="text-[12px] font-medium text-slate-500" data-strip-kind>{KIND_WORD[item.kind] || "Case"}</p>
          <p className="mt-0.5 text-[15px] font-semibold leading-5 text-slate-900 line-clamp-2 break-words dark:text-slate-100" title={item.title} data-strip-title>{item.title}</p>
          <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300" data-pinned-score>{item.status}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={() => navigate(item.open)} data-strip-open
          className="rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-700 max-sm:flex-1">Open</button>
        <StripMenu item={item} onUnpin={onUnpin} onRemove={onRemove} />
      </div>
    </article>
  );
}

/** The Pinned row: every pinned item as a strip, 12px apart. `lead`: the dashboard's result as a strip when it is not pinned. */
export default function PinnedCards({ pinned, excludeId = null, lead = null }) {
  const navigate = useNavigate();
  const all = pinned.items.filter((c) => c.id !== excludeId);
  const items = all.slice(0, 3);
  const more = all.length - items.length;
  if (!items.length && !lead) return pinned.toast;
  return (
    <section aria-labelledby="pinned-heading" data-pinned data-pinned-layout="strip" className="flex flex-col gap-3">
      <h2 id="pinned-heading" className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">Pinned to your dashboard</h2>
      {lead && <CaseStrip item={lead.item} onRemove={lead.onRemove} />}
      {items.map((c) => <CaseStrip key={c.id} item={fromPinned(c)} onUnpin={() => pinned.unpin(c)} />)}
      {more > 0 && (
        <div className="text-right">
          <button type="button" onClick={() => navigate("/funding")} className="text-[13px] font-semibold text-brand-700 hover:underline">View all pinned ({all.length})</button>
        </div>
      )}
      {pinned.toast}
    </section>
  );
}
