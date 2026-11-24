// One Tasks tab, opened in the panel beside the Agent Centre chat (the owner, 27 Oct: "← Needs Approval · 5", then the
// tasks as cards that fill the panel and scroll inside it, "Show more" in place of numbered pages). Each tab lists what
// its count counts: Needs Approval the summary's items, the others their own bucket, Documents the documents.
import { useEffect, useRef, useState } from "react";

const CARD = "rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900";
const OPEN = "shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200";
const INPUT = "min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] text-slate-800 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

/** "5m ago", "3h ago", "1d ago" within a week; "26 Oct" after. */
export function whenShort(iso) {
  if (!iso) return "";
  const t = new Date(String(iso).length === 10 ? `${iso}T12:00:00` : iso).getTime();
  if (!Number.isFinite(t)) return "";
  const h = (Date.now() - t) / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  if (h < 24 * 7) return `${Math.round(h / 24)}d ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const RUN_BADGE = { waiting_for_review: ["To review", "amber"], awaiting_approval: ["To approve", "amber"], running: ["In progress", "blue"], succeeded: ["Done", "emerald"],
  nothing_to_do: ["Nothing to do", "slate"], failed: ["Needs you", "rose"], cancelled: ["Cancelled", "slate"], needs_input: ["Needs you", "amber"] };
const DOC_BADGE = { awaiting_approval: ["To review", "amber"], prepared: ["To review", "amber"], saved: ["Saved", "slate"], draft: ["Draft", "slate"], sent: ["Sent", "blue"], viewed: ["Sent", "blue"],
  pending: ["Sent", "blue"], accepted: ["Approved", "emerald"], won: ["Approved", "emerald"], signed: ["Signed", "emerald"], paid: ["Paid", "emerald"], overdue: ["Overdue", "rose"],
  declined: ["Declined", "rose"], lost: ["Lost", "rose"], disputed: ["Disputed", "rose"], credited: ["Credited", "slate"], void: ["Void", "slate"], voided: ["Void", "slate"],
  cancelled: ["Cancelled", "slate"], expired: ["Expired", "slate"] };
const TONE = { amber: "bg-amber-50 text-amber-800", blue: "bg-blue-50 text-blue-700", emerald: "bg-emerald-50 text-emerald-700", rose: "bg-rose-50 text-rose-700",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };

function Badge({ label, tone }) {
  return <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-medium ${TONE[tone] || TONE.slate}`}>{label}</span>;
}

/** A card: its full title (two lines at most), a muted line under it, the badge on the right with the date below. */
function Row({ title, sub, badge, when, onOpen, data }) {
  return (
    <li className={CARD} {...data}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-slate-900 dark:text-slate-50">{title}</p>
          {sub && <p className="mt-0.5 line-clamp-2 text-[13px] text-slate-500" title={sub} data-clamp>{sub}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">{badge}<span className="text-[12px] text-slate-500">{when}</span>
          {onOpen && <button type="button" className={`${OPEN} mt-1`} onClick={onOpen}>Open</button>}</div>
      </div>
    </li>
  );
}

const draftOf = (a) => a.draft_id || (() => { try { return new URLSearchParams(String(a.to || "").split("?")[1] || "").get("review"); } catch { return null; } })();
/** Shown in the chat beside the list, as Review shows it. */
export const openInChat = (item) => window.dispatchEvent(new CustomEvent("ea:chat-review", { detail: item }));

function FilterMenu({ documents, kind, onKind, order, onOrder }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const Opt = ({ on, children, onClick }) => (
    <button type="button" role="menuitemradio" aria-checked={on} onClick={() => { onClick(); setOpen(false); }}
      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[13.5px] hover:bg-slate-50 dark:hover:bg-slate-800 ${on ? "font-semibold text-blue-700" : "text-slate-700 dark:text-slate-200"}`}>{children}</button>
  );
  const filtered = Boolean(kind) || order === "oldest";
  return (
    <div className="relative" ref={box}>
      <button type="button" aria-label="Filter and sort" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-doc-filter
        className={`flex h-[38px] w-[38px] items-center justify-center rounded-lg border ${filtered ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700"}`}>
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4z" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <p className="px-3 pb-1 pt-0.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Type</p>
          <Opt on={!kind} onClick={() => onKind("")}>All <span className="text-[12px] text-slate-500">{documents?.all_total ?? documents?.total ?? 0}</span></Opt>
          {(documents?.kinds || []).map((k) => <Opt key={k.key} on={kind === k.key} onClick={() => onKind(k.key)}>{k.label} <span className="text-[12px] text-slate-500">{documents?.counts?.[k.key] || 0}</span></Opt>)}
          <p className="mt-1 border-t border-slate-100 px-3 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800">Sort</p>
          <Opt on={order !== "oldest"} onClick={() => onOrder("newest")}>Newest first</Opt>
          <Opt on={order === "oldest"} onClick={() => onOrder("oldest")}>Oldest first</Opt>
        </div>
      )}
    </div>
  );
}

const ABOUT = "Quotations, invoices, contracts, receipts and what the Agent prepares for you to review, such as business plans and funding packs. A draft can be changed while it waits for your approval.";

export default function TaskList({ tab, label, count, onBack, loading, empty, waiting = [], runs = [], total = 0, onMore, documents, docKind, onDocKind, docSearch, onDocSearch,
  docOrder, onDocOrder, onOpenRun, onOpenDoc, results = null }) {
  const [q, setQ] = useState("");
  const [about, setAbout] = useState(false);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const match = (t) => words.every((w) => String(t || "").toLowerCase().includes(w));
  const searchable = tab === "completed" || tab === "history";
  let body;
  if (tab === "results") body = results;
  else if (loading) body = <ul className="space-y-2.5" aria-busy="true">{[0, 1, 2].map((i) => <li key={i} className="h-[92px] animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}</ul>;
  else if (tab === "needs_approval") {
    body = waiting.length ? (
      <ul className="space-y-2.5" data-task-cards>{waiting.map((a) => (
        <Row key={a.approval_id || a.draft_id || a.run_id || a.title} title={a.title} sub={a.subtitle} data={{ "data-task": a.approval_id ? "approval" : "draft" }}
          badge={<Badge label={a.approval_id ? "To approve" : "To review"} tone="amber" />} when={whenShort(a.created_at) || a.age}
          onOpen={() => openInChat({ ...a, draft_id: draftOf(a) })} />
      ))}</ul>
    ) : null;
  } else if (tab === "documents") {
    const items = documents?.items || [];
    body = items.length ? (
      <ul className="space-y-2.5" data-documents>{items.map((d) => {
        // The document's own name, its type once, under it (the owner, 27 Oct: never "Business plan / Business plan")
        const named = d.reference && d.reference !== d.kind_label;
        const title = named ? (d.party ? `${d.reference}, ${d.party}` : d.reference) : d.kind_label;
        const sub = [named ? d.kind_label : "", d.versions > 1 ? `${d.versions} versions` : ""].filter(Boolean).join(" · ");
        const [b, tone] = DOC_BADGE[d.status] || [d.status_label, "slate"];
        return <Row key={`${d.kind}:${d.id}`} title={title} sub={sub} badge={<Badge label={b} tone={tone} />} when={whenShort(d.updated_at || d.date)}
          data={{ "data-document": d.kind }} onOpen={d.run_id || d.draft_id || d.to ? () => onOpenDoc(d) : null} />;
      })}</ul>
    ) : null;
  } else {
    const shown = searchable ? runs.filter((r) => match(`${r.label || r.title} ${r.subtitle || ""}`)) : runs;
    body = shown.length ? (
      <ul className="space-y-2.5" data-task-cards>{shown.map((r) => {
        const [b, tone] = RUN_BADGE[r.display_status] || RUN_BADGE[r.status] || [r.status_label || "Task", "slate"];
        return <Row key={r.id} title={r.label || r.title} sub={r.subtitle || r.summary} badge={<Badge label={b} tone={tone} />} when={whenShort(r.created_at)} onOpen={() => onOpenRun(r)} />;
      })}</ul>
    ) : null;
  }
  const listed = tab === "documents" ? (documents?.items || []).length : tab === "needs_approval" ? waiting.length : runs.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-task-list>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="Back to all tasks" className="rounded-lg p-1 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">←</button>
        <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-50" data-task-header>{label} · {count}</p>
        {tab === "documents" && (
          <button type="button" onClick={() => setAbout((v) => !v)} aria-label="About documents" aria-expanded={about} className="text-[14px] text-slate-400 hover:text-slate-600">ⓘ</button>
        )}
      </div>
      {tab === "documents" && about && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{ABOUT}</p>}
      {tab === "documents" && (
        <div className="mt-3 flex items-center gap-2">
          <input type="search" aria-label="Search documents" placeholder="Search documents" value={docSearch} onChange={(e) => onDocSearch(e.target.value)} className={INPUT} />
          <FilterMenu documents={documents} kind={docKind} onKind={onDocKind} order={docOrder} onOrder={onDocOrder} />
        </div>
      )}
      {searchable && <div className="mt-3"><input type="search" aria-label="Search tasks" placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} className={`${INPUT} w-full`} /></div>}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
        {body || <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-[14px] text-slate-500 dark:border-slate-700" data-task-empty>{words.length ? "No tasks match." : empty}</p>}
        {!loading && tab !== "results" && tab !== "needs_approval" && listed < total && (
          <button type="button" onClick={onMore} className="mt-3 w-full rounded-lg border border-slate-200 py-2 text-[13.5px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200" data-show-more>Show more</button>
        )}
      </div>
    </div>
  );
}
