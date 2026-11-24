// What a card's "View …" link opens beside the chat (the owner, 27 Oct: "'View all', 'View details', 'View checklist',
// 'View report' and 'View profile' links on cards must not leave the page"). The sheet sits over the page, so the chat
// under it stays as it was, scrolled where it was; closing it puts the focus back on the link that opened it.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../api/client";

const TONE = { invoice_paid: "bg-emerald-500", customer_added: "bg-blue-500", research: "bg-violet-500" };

function ago(at) {
  const m = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
  if (m < 60) return `${m || 1}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** A sheet from the right on a wide screen, from the bottom on a phone. */
export function SideSheet({ title, onClose, children, footer = null }) {
  const back = useRef(typeof document !== "undefined" ? document.activeElement : null);
  const box = useRef(null);
  useEffect(() => {
    box.current?.focus();
    const key = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    const opener = back.current;
    return () => { window.removeEventListener("keydown", key); opener?.focus?.({ preventScroll: true }); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-slate-900/30 max-sm:items-end" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-side-sheet>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className="flex h-full w-full max-w-[420px] flex-col bg-slate-50 shadow-2xl outline-none dark:bg-slate-950 max-sm:h-auto max-sm:max-h-[85dvh] max-sm:max-w-none max-sm:rounded-t-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[18px] font-bold text-slate-900 dark:text-slate-50">{title}</p>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">{children}</div>
        {footer && <div className="border-t border-slate-200 bg-white px-6 py-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] dark:border-slate-800 dark:bg-slate-900">{footer}</div>}
      </div>
    </div>
  );
}

const SHEET_CARD = "rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900";
const GROUPS = [
  ["About", [["primary_industry", "Sector"], ["city", "City"], ["country", "Country"], ["year_established", "Founded"], ["company_size", "Employees"]]],
  ["Contact", [["email", "Email"], ["phone_number", "Phone"], ["website", "Website"]]],
  ["Registration", [["legal_name", "Legal name"], ["registration_number", "Registration number"], ["business_type", "Business type"]]],
];

/** One field: its value, or a muted "Add" that opens the field here and saves it to the profile (the owner's own entry). */
function Field({ label, value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState("");
  const save = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setState("saving");
    try { await onSave(text.trim()); setEditing(false); setState(""); } catch { setState("failed"); }
  };
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-[14px]">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-slate-900 dark:text-slate-100">
        {value ? <span className="break-words">{String(value)}</span> : editing ? (
          <form onSubmit={save} className="flex items-center gap-1.5">
            <input autoFocus aria-label={label} value={text} onChange={(e) => setText(e.target.value)} className="w-40 rounded-lg border border-slate-200 px-2 py-1 text-[13.5px] dark:border-slate-700 dark:bg-slate-900" />
            <button type="submit" disabled={state === "saving"} className="rounded-lg bg-blue-600 px-2.5 py-1 text-[13px] font-medium text-white">{state === "saving" ? "…" : "Save"}</button>
          </form>
        ) : <button type="button" onClick={() => setEditing(true)} className="text-[13.5px] text-slate-400 hover:text-blue-600" data-add-field>Add</button>}
        {state === "failed" && <span className="block text-[12px] text-rose-600">Not saved. Try again.</span>}
      </dd>
    </div>
  );
}

/** "View profile": the business as its profile says, grouped; Edit profile the only way to the full page. */
export function ProfileSheet({ business, businessId, onClose }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    if (!businessId) { setProfile({}); return undefined; }
    let live = true;
    apiRequest(`/workspace/profile?workspace_id=${encodeURIComponent(businessId)}`, "GET").then((r) => live && setProfile(r?.profile || {}), () => live && setProfile({}));
    return () => { live = false; };
  }, [businessId]);
  const b = business || {};
  const p = profile || {};
  const save = (key) => async (value) => {
    const r = await apiRequest("/workspace/profile", "PATCH", { workspace_id: businessId, profile: { [key]: value } });
    setProfile(r?.profile || { ...p, [key]: value });
  };
  return (
    <SideSheet title="Business profile" onClose={onClose}
      footer={<button type="button" onClick={() => navigate("/account")} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-blue-700" data-edit-profile>Edit profile</button>}>
      <div className={SHEET_CARD}>
        <div className="flex items-center gap-3">
          {b.logo ? <img src={b.logo} alt="" className="h-12 w-12 rounded-xl object-cover" />
            : <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-[18px] font-bold text-blue-700">{(b.name || "?").slice(0, 1)}</span>}
          <div className="min-w-0"><p className="truncate text-[16px] font-bold text-slate-900 dark:text-slate-50">{b.name || p.company_name || "Your business"}</p>{b.stage && <p className="text-[13px] text-slate-500">{b.stage} stage</p>}</div>
        </div>
        {(p.about_company || b.description) && <p className="mt-3 text-[14px] leading-relaxed text-slate-700 dark:text-slate-200">{p.about_company || b.description}</p>}
      </div>
      {profile === null ? [0, 1, 2].map((i) => <div key={i} className={`${SHEET_CARD} h-28 animate-pulse`} />) : GROUPS.map(([head, fields]) => (
        <div key={head} className={SHEET_CARD} data-profile-group={head}>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{head}</p>
          <dl className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">{fields.map(([k, label]) => <Field key={k} label={label} value={p[k]} onSave={save(k)} />)}</dl>
        </div>
      ))}
    </SideSheet>
  );
}

const dayOf = (at) => {
  const d = new Date(at);
  const today = new Date();
  const before = new Date(); before.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === before.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
};

/** "View all" on Recent activity: what the page already has at once, the rest as it arrives, by day, as the card shows it. */
export function ActivitySheet({ businessId, first = [], onClose }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let live = true;
    apiRequest(`/businesses/${businessId}/agent/activity`, "GET").then((r) => live && setItems(r?.items || []), () => live && setItems(first));
    return () => { live = false; };
  }, [businessId]);      // eslint-disable-line react-hooks/exhaustive-deps
  const shown = items || first;
  const days = [];
  for (const a of shown) {
    const day = dayOf(a.at);
    if (!days.length || days[days.length - 1][0] !== day) days.push([day, []]);
    days[days.length - 1][1].push(a);
  }
  return (
    <SideSheet title="Recent activity" onClose={onClose}>
      {shown.length ? days.map(([day, list]) => (
        <div key={day} className={SHEET_CARD} data-activity-day>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{day}</p>
          <ul className="mt-3 space-y-3" data-activity-all>{list.map((a, i) => (
            <li key={`${a.kind}${a.at}${i}`} className="flex items-start gap-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE[a.kind] || "bg-violet-500"}`} aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-slate-900 dark:text-slate-100">{a.title}</span>{a.detail && <span className="block text-[13.5px] text-slate-500">{a.detail}</span>}</span>
              <span className="shrink-0 text-[12px] text-slate-500">{ago(a.at)}</span>
            </li>
          ))}</ul>
        </div>
      )) : items === null ? <div className={`${SHEET_CARD} h-32 animate-pulse`} /> : <p className={`${SHEET_CARD} text-[14px] text-slate-500`}>Nothing yet. Invoices, customers and research show here as they happen.</p>}
      {items === null && shown.length > 0 && <p className="text-center text-[12.5px] text-slate-500">Loading the rest…</p>}
    </SideSheet>
  );
}

/** "View details" on a score or snapshot: the score, then each area and how much of it is answered. */
export function BreakdownSheet({ subject, score, title = "Readiness breakdown", onClose }) {
  const n = score === null || score === undefined ? null : Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  const why = subject?.summary?.not_ready_why || subject?.summary?.headline;
  return (
    <SideSheet title={title} onClose={onClose}>
      <p className="text-[13px] text-slate-500">{subject?.data?.name || subject?.title}</p>
      <p className="mt-1 text-[30px] font-bold tabular-nums text-slate-900 dark:text-slate-50">{n === null ? "Not checked yet" : <>{n}<span className="text-[16px] font-semibold text-slate-500">/100</span></>}</p>
      {why && <p className="mt-1 text-[14px] text-slate-600 dark:text-slate-300">{why}</p>}
      <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800" data-breakdown>{(subject?.sections || []).map((s) => {
        const p = s.total ? Math.round((100 * (s.answered || 0)) / s.total) : 0;
        return (
          <li key={s.key} className="py-3">
            <div className="flex items-center justify-between gap-3 text-[14px]"><span className="font-semibold text-slate-800 dark:text-slate-100">{s.title}</span>
              <span className="tabular-nums text-slate-500">{s.answered || 0} of {s.total || 0}</span></div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${p >= 75 ? "bg-emerald-500" : p >= 40 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${p}%` }} /></div>
          </li>
        );
      })}</ul>
    </SideSheet>
  );
}

/** "View all" on what stands in the way: every open step, most urgent first. */
export function StepsSheet({ subject, title = "What's still open", onClose }) {
  const open = (subject?.actions || []).filter((a) => a.status === "open");
  return (
    <SideSheet title={title} onClose={onClose}>
      {open.length ? (
        <ol className="space-y-3" data-steps-all>{open.map((a, i) => (
          <li key={a.id} className="flex gap-3"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[12px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{i + 1}</span>
            <span className="min-w-0"><span className="block text-[14px] font-semibold text-slate-900 dark:text-slate-100">{a.title}</span>{a.why && <span className="block text-[13px] text-slate-500">{a.why}</span>}</span></li>
        ))}</ol>
      ) : <p className="text-[14px] text-slate-500">Nothing open.</p>}
    </SideSheet>
  );
}
