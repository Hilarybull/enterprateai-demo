// The Assistant tab (the owner's mockups, 27 Oct: "exactly like the mockups"): the conversation in the middle with its cards
// (what was checked in the records, the result and its gaps, how to continue, the research in progress, the score before and
// after, what to do next), and beside it the business, the score, recent activity and quick actions. Everything shown comes
// from the case and the business's own records; nothing is invented, and nothing is used before the owner approves it.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../../api/client";
import { noteCameFrom } from "../../lib/cameFrom";
import { agentErrorMessage, approveAction, getChat, replyText, saveChat, submitAgentRequest } from "../../lib/agent";
import { sectionCounts } from "../../lib/caseSteps";
import { getPath } from "../../lib/readiness";
import { useAuthStore } from "../../store/auth";
import { PreviewCard, SLOW, ScenarioCard, SegmentsCard, chatActions, said as sayDone } from "../agent/ChatActions";
import { ActivitySheet, BreakdownSheet, ProfileSheet, StepsSheet } from "../agent/Sheets";
import { SavedResearch } from "../../pages/ReadinessPage";
import { ActionsPanel } from "./Panels";

const BOX = "rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";
const LINK = "inline-flex items-center gap-1 text-[13px] font-semibold text-brand-700 hover:underline dark:text-brand-300";
const WORDS = {
  funding: { area: "funding readiness", result: "Your funding readiness result", score: "Funding Readiness Score", ready: "Funding ready",
    progress: "Funding research in progress", checking: "I'm checking your records to assess your funding readiness.",
    start: ["How ready am I for funding?", "What's missing?", "Help me complete it"] },
  launch: { area: "launch readiness", result: "Your launch readiness result", score: "Launch Readiness Score", ready: "Ready to launch",
    progress: "Launch research in progress", checking: "I'm checking your records to assess your launch readiness.",
    start: ["How ready is my launch?", "What's missing?", "Help me complete it"] },
  idea: { area: "idea", result: "Initial viability result", score: "Viability", ready: "Strong viability",
    progress: "Research in progress", checking: "Checking the information already available about your proposed service.",
    start: ["Is my idea worth launching?", "What's holding it back?", "Research it for me"] },
};

const clock = (at) => { try { return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
function ago(at) {
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function money(n, ccy) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy || "GBP", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(Number(n) || 0); } catch { return String(n); }
}
// "Suggested by the Agent." on its own, never "Drafted suggested by the Agent." (the owner, 28 Oct)
export const fromLine = (src) => { const t = String(src || "from your records and research").trim(); return /^suggested/i.test(t) ? `${t[0].toUpperCase()}${t.slice(1)}.` : `Drafted ${t}.`; };
// A money draft as money ("4000.0" is ₦4,000); anything else as it is
const isAmount = (v) => /^\s*-?\d[\d,]*(\.\d+)?\s*$/.test(String(v ?? ""));
const pct = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const tone = (n) => (n >= 70 ? "emerald" : n >= 40 ? "amber" : "rose");
const STROKE = { emerald: "stroke-emerald-500", amber: "stroke-amber-500", rose: "stroke-rose-500" };
const BAR = { emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500" };

// The mockups' line icons (the owner, 27 Oct: "match the icons"), one stroke style, drawn here so nothing is fetched
const PATHS = {
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6", bars: "M5 20V10M10 20V4M15 20v-7M20 20v-4", users: "M9 11a4 4 0 100-8 4 4 0 000 8zM2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 000-6M22 21c0-3-2-5-5-5",
  tag: "M3 12V4h8l10 10-8 8zM7.5 7.5h.01", db: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6", target: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12h.01", pie: "M12 3v9h9A9 9 0 1112 3zM15 3.5A9 9 0 0120.5 9H15z",
  upload: "M14 3H7v18h10V8zM14 3v5h5M12 18v-6M9 14l3-3 3 3", plug: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6",
  invoice: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6", mail: "M3 6h18v12H3zM3 7l9 6 9-6", bulb: "M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0012 3z",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5", pen: "M4 20h4L20 8l-4-4L4 16zM14 6l4 4", sparkles: "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z",
};
function Glyph({ name, className = "h-5 w-5" }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={PATHS[name] || PATHS.doc} /></svg>;
}
const SECTION_ICON = { goal: "target", market: "pie", traction: "trend", finances: "bars", team: "users", documents: "doc", customers: "users", economics: "tag",
  cash: "bars", delivery: "layers", operations: "layers", prerequisites: "doc", idea: "bulb", customer: "users", margin: "tag", break_even: "bars", capacity: "layers",
  demand: "trend", competitors: "pie" };
const RECORD_ICON = { profile: "doc", revenue: "bars", customers: "users", pricing: "tag", costs: "db", sales: "trend", customer: "users", capacity: "layers", price: "tag", demand: "bars" };
function Ok({ className = "h-5 w-5" }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} text-emerald-600`} fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 10" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function Spark() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 text-brand-600" fill="currentColor"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" /></svg>;
}
function Check({ className = "h-5 w-5" }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} text-emerald-600`} fill="currentColor"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1.2 14.2l-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4z" /></svg>;
}
function Spinner({ className = "h-4 w-4" }) {
  return <span aria-hidden="true" className={`${className} inline-block shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600`} />;
}
function Info({ children }) {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-[12.5px] text-brand-900 dark:bg-brand-950/40 dark:text-brand-100">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-px h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
      <span>{children}</span>
    </p>
  );
}
function Ring({ score, size = 132, label, toneOf = null }) {
  const n = score === null || score === undefined ? null : pct(score);
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} data-assistant-ring={n ?? ""}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth="11" fill="none" className="stroke-slate-100 dark:stroke-slate-800" />
        {n !== null && <circle cx={size / 2} cy={size / 2} r={r} strokeWidth="11" fill="none" strokeLinecap="round" className={`${STROKE[toneOf || tone(n)]} transition-[stroke-dashoffset] duration-700`}
          strokeDasharray={c} strokeDashoffset={c * (1 - n / 100)} />}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[30px] font-bold leading-none tabular-nums text-slate-900 dark:text-slate-50">{n ?? "?"}<span className="text-[15px] font-semibold text-slate-500">/100</span></span>
        {label && <span className="mt-1 max-w-[62%] text-[11.5px] leading-tight text-slate-500">{label}</span>}
      </span>
    </div>
  );
}
const CHIP = { Missing: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200", Incomplete: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  "Needs improvement": "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200", Available: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
  "Not found": "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", Completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
  "To do": "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" };
const Chip = ({ children }) => <span className={`shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${CHIP[children] || CHIP["Not found"]}`}>{children}</span>;

/** The case's areas with what each still needs: Missing (nothing in it), Incomplete (partly), Needs improvement (filled, with a step). */
function gapsOf(subject, steps) {
  // The check's own open steps count too: an area with one is never "Completed" (the owner's QA, 27 Oct)
  const open = [...steps, ...(subject.actions || []).filter((x) => ["open", "in_progress", "awaiting_evidence"].includes(x.status) && x.section
    && !steps.some((st) => st.section === x.section && st.key === x.code)).map((x) => ({ section: x.section, key: x.code }))];
  return sectionCounts(subject, open).map((x) => ({ ...x, title: (subject.sections || []).find((s) => s.key === x.key)?.title || x.key,
    state: x.done ? "Completed" : x.answered === 0 ? "Missing" : / to fix$/.test(x.text) ? "Needs improvement" : "Incomplete" }));
}

// ── The cards in the conversation ────────────────────────────────────────────

function RecordsCard({ records, live, words, title = ["Reviewing business information", "Business information reviewed"] }) {
  const [shown, setShown] = useState(live ? 0 : records.length);
  useEffect(() => {
    if (shown >= records.length) return undefined;
    const t = setTimeout(() => setShown((n) => n + 1), 450);
    return () => clearTimeout(t);
  }, [shown, records.length]);
  const done = shown >= records.length;
  return (
    <div className={`${BOX} p-5`} data-card="records">
      <div className="flex items-start gap-3.5">
        {done ? <Check className="h-9 w-9" /> : <Spinner className="h-9 w-9 border-[3px]" />}
        <div>
          <p className="text-[17px] font-bold text-slate-900 dark:text-slate-50">{done ? title[1] : title[0]}</p>
          <p className="text-[13px] text-slate-500">{words.checking}</p>
        </div>
      </div>
      <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
        {records.map((r, i) => (
          <li key={r.key} className="flex items-center justify-between gap-3 py-3 text-[14.5px]">
            <span className="flex items-center gap-3.5 text-slate-800 dark:text-slate-100">
              {i < shown && r.available ? <Check /> : <span className="h-5 w-5 rounded-full border-2 border-slate-300 dark:border-slate-600" />}
              <span className="text-slate-600 dark:text-slate-300"><Glyph name={RECORD_ICON[r.key]} /></span>
              {r.label}
            </span>
            <span className="text-[13px]">
              {i < shown ? (r.available ? <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600"><Ok className="h-[18px] w-[18px]" />Completed</span> : <span className="text-slate-500">Not found</span>)
                : i === shown ? <span className="inline-flex items-center gap-1.5 text-slate-500"><Spinner className="h-4 w-4" />Scanning…</span> : <span className="text-slate-400">Pending</span>}
            </span>
          </li>
        ))}
      </ul>
      <Info>{done ? "I only use what's in your records. Anything not found stays empty until you add it or approve a draft." : "This usually takes a few seconds. I'll then check your readiness and suggest next steps."}</Info>
    </div>
  );
}

function ResultCard({ subject, steps, records, words, score, onOpen }) {
  const gaps = gapsOf(subject, steps).filter((g) => g.state !== "Completed");
  const sm = subject.summary || {};
  const ready = sm.classification === "ready";
  return (
    <div className={`${BOX} p-5`} data-card="result">
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        {/* The ring says what the badge says (the owner, 28 Oct: a green ring beside "Important gaps identified") */}
        <Ring score={score} label={ready ? words.ready : "So far"} toneOf={ready ? "emerald" : gaps.length ? "rose" : "amber"} />
        <div className="min-w-0 flex-1">
          <p className="text-[18px] font-bold text-slate-900 dark:text-slate-50">{words.result}</p>
          <span className={`mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-semibold ${ready ? "bg-emerald-50 text-emerald-700" : gaps.length ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}>
            {ready ? words.ready : gaps.length ? "Important gaps identified" : "Run the check to see your result"}
          </span>
          <p className="mt-2 text-[13.5px] text-slate-600 dark:text-slate-300">
            {/* The one count of what is left, as the Checklist says it (the owner, 28 Oct: "2 things" here, another number there) */}
            {ready ? "Every area is complete and the key evidence is in place."
              : typeof sm.open_actions === "number" && sm.open_actions > 0 ? `${sm.open_actions} thing${sm.open_actions === 1 ? "" : "s"} to do first${sm.next_action?.title ? `, starting with: ${String(sm.next_action.title).replace(/\.$/, "")}.` : "."}`
              : gaps.length ? `There ${gaps.length === 1 ? "is 1 area" : `are ${gaps.length} areas`} to address before you're ready.` : "Your answers are in. Run the check to see where you stand."}
          </p>
        </div>
      </div>
      {/* Two columns while there is room for both in full; stacked when there isn't, never a label cut off (the owner, 28 Oct) */}
      <div className="ea-two-col mt-4 grid gap-3">
        <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <p className="mb-1 text-[14px] font-bold text-slate-900 dark:text-slate-100">Readiness gaps</p>
          {gaps.length ? (
            <ul>{gaps.map((g) => (
              <li key={g.key}><button type="button" data-row onClick={() => onOpen(g.key)} className="flex w-full items-center justify-between gap-2 py-1.5 text-left text-[13.5px] text-slate-700 hover:text-brand-700 dark:text-slate-200">
                <span className="flex min-w-0 flex-1 items-center gap-2.5"><span className="shrink-0 text-slate-600"><Glyph name={SECTION_ICON[g.key]} className="h-[18px] w-[18px]" /></span><span className="min-w-0 leading-snug">{g.title}</span></span>
                <span className="flex shrink-0 items-center gap-1.5"><Chip>{g.state}</Chip><span aria-hidden="true" className="text-slate-400">›</span></span>
              </button></li>
            ))}</ul>
          ) : <p className="py-1.5 text-[13px] text-slate-500">No gaps left.</p>}
        </div>
        <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <p className="mb-1 text-[14px] font-bold text-slate-900 dark:text-slate-100">Available information</p>
          <ul>{records.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-2 py-1.5 text-[13.5px] text-slate-700 dark:text-slate-200">
              <span className="flex min-w-0 flex-1 items-center gap-2">{r.available ? <Check className="h-[18px] w-[18px] shrink-0" /> : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-slate-300" />}<span className="shrink-0 text-slate-600"><Glyph name={RECORD_ICON[r.key]} className="h-4 w-4" /></span><span className="min-w-0 leading-snug">{r.label}</span></span>
              <Chip>{r.available ? "Available" : "Not found"}</Chip>
            </li>
          ))}</ul>
        </div>
      </div>
      {!ready && gaps.length > 0 && (
        <div className="mt-3 flex items-start gap-3 rounded-xl bg-blue-50 px-4 py-3 text-[13px] text-slate-700 dark:bg-brand-950/40 dark:text-slate-200">
          <span className="text-blue-600"><Glyph name="bulb" className="h-6 w-6" /></span>
          <span><span className="block font-semibold text-blue-900 dark:text-blue-100">Your business shows potential, but there are some important gaps.</span>
            Closing the missing and incomplete areas raises your score. It shows how prepared you are, not whether {subject.kind === "launch_initiative" ? "the launch will succeed" : "funding will be given"}.</span>
        </div>
      )}
    </div>
  );
}

function ChooseCard({ subject, steps, price, onHelp, onSelf, busy, reuse = false, options = false, topics = [], fixed = false }) {
  const [pick, setPick] = useState("help");
  if (options) return (
    // "Find options": a search for the funders that fit, never the general "complete your case" offer (the owner, 28 Oct)
    <div className={`${BOX} p-5`} data-card="choose" data-options>
      <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Find funding options</p>
      <p className="mt-1 text-[13.5px] text-slate-600 dark:text-slate-300">I'll search for programmes, lenders and investors that fit your case: its country, kind of funding, amount and sector. Each option comes with its source.</p>
      {topics.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13.5px] text-slate-700 dark:text-slate-200">{topics.map((t) => <li key={t}>{t}</li>)}</ul>}
      <p className="mt-2 text-[13px] text-slate-500">{price ? `Up to ${price} credits, and you only pay for what I find.` : reuse ? "Free: nothing has changed since your last search, so it is shown again." : "Free."}</p>
      <button type="button" disabled={busy} onClick={onHelp} className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {`Search${price ? ` · up to ${price} credits` : ""}`}
      </button>
    </div>
  );
  const gaps = gapsOf(subject, steps).filter((g) => g.state !== "Completed");
  const Option = ({ id, title, text, recommended, icon }) => (
    <button type="button" role="radio" aria-checked={pick === id} onClick={() => setPick(id)}
      className={`relative flex-1 rounded-xl border p-4 text-left transition ${pick === id ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500 dark:bg-brand-950/30" : "border-slate-200 hover:border-slate-300 dark:border-slate-700"}`}>
      <span className={`absolute right-3 top-3 h-4 w-4 rounded-full border-2 ${pick === id ? "border-brand-600 bg-brand-600 shadow-[inset_0_0_0_3px_white]" : "border-slate-300"}`} aria-hidden="true" />
      <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-brand-600"><Glyph name={icon} /></span>
      <span className="block pr-6 text-[14.5px] font-bold text-slate-900 dark:text-slate-50">{title}</span>
      <span className="mt-1 block text-[13px] text-slate-600 dark:text-slate-300">{text}</span>
      {recommended && <span className="mt-2 inline-block rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-800">Recommended</span>}
    </button>
  );
  return (
    <div className={`${BOX} p-5`} data-card="choose">
      <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Choose how to continue</p>
      <p className="text-[13px] text-slate-500">I can complete the missing information from your records, trusted sources and benchmarks, or you can enter it yourself.</p>
      <div role="radiogroup" aria-label="How to continue" className="mt-3 flex flex-col gap-3 sm:flex-row">
        <Option id="help" icon="sparkles" title="Help me complete it" recommended text={`I'll research and prepare the missing information, then show you everything for review and approval.${price ? (fixed ? ` ${price} credits.` : ` Up to ${price} credits.`) : reuse ? " Free: nothing has changed since your last research, so it is shown again." : " Free."}`} />
        <Option id="self" icon="pen" title="Enter information myself" text="I'll take you through each section and you enter the information yourself." />
      </div>
      {gaps.length > 0 && (
        <div className="mt-4">
          <p className="text-[13.5px] font-bold text-slate-900 dark:text-slate-100">Missing information ({gaps.length} area{gaps.length === 1 ? "" : "s"})</p>
          <ul className="mt-1 space-y-1">{gaps.map((g) => (
            <li key={g.key} className="flex items-center gap-2.5 text-[13.5px] text-slate-800 dark:text-slate-200">
              {/* All answered but a step still open: to confirm, never shown as missing (the owner, 28 Oct) */}
              <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${g.answered >= g.total ? "bg-amber-500" : "bg-rose-500"}`} aria-hidden="true">!</span>
              <span className="min-w-0 flex-1 leading-snug sm:w-48 sm:flex-none">{g.title}</span>
              <span className="shrink-0 whitespace-nowrap text-slate-500">{g.answered >= g.total ? `Answered, ${(/: (\d+) to fix$/.exec(g.text) || [0, 1])[1]} to confirm` : <>{g.answered} of {g.total}<span className="max-sm:hidden"> answered</span></>}</span></li>
          ))}</ul>
        </div>
      )}
      <Info>All researched and prepared information is shown to you for review and approval before it becomes part of your case.</Info>
      <button type="button" disabled={busy} onClick={() => (pick === "help" ? onHelp() : onSelf())}
        className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {pick === "help" ? `Start${price ? (fixed ? ` · ${price} credits` : ` · up to ${price} credits`) : ""}` : "Enter it myself"}
      </button>
    </div>
  );
}

function ProgressCard({ subject, steps, ctx, words, onReview, onRetry, justStarted = false, drafts = 0, options = false, onDecideAll = null, onResults = null, onNext = null }) {
  const [deciding, setDeciding] = useState("");
  const gaps = gapsOf(subject, steps).filter((g) => g.state !== "Completed");
  // Drafts waiting are the research done (the owner, 28 Oct: "9 drafts waiting" beside "Processing…")
  const review = (ctx?.research?.state === "review" || drafts > 0) && !ctx?.working;
  const done = review || (ctx?.research?.state === "adopted" && !ctx?.working);      // drafts back win over an older failure (29 Oct)
  // Not running and nothing to show for it: said, with Retry, never a spinner for ever (the owner, 28 Oct)
  if (ctx && !ctx.working && !done && (ctx.failed || !justStarted)) {
    return (
      <div className={`${BOX} p-5`} data-card="progress" data-research-failed>
        <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">The research didn't finish</p>
        <p className="mt-1 text-[13.5px] text-slate-600 dark:text-slate-300">{ctx.failed || "It stopped before it found anything. Nothing was charged."}</p>
        {onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-700" data-research-retry>Retry</button>}
      </div>
    );
  }
  return (
    <div className={`${BOX} p-5`} data-card="progress">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_15rem]">
        <div>
          <div className="flex items-center gap-3">
            {done ? <Check className="h-8 w-8" /> : <Spinner className="h-8 w-8" />}
            <div>
              <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">{options ? (done ? "Funding options found" : "Searching for funding options") : done ? "Research complete" : words.progress}</p>
              {/* What came back, said as it is (the owner, 28 Oct: three areas "Drafted", one finding) */}
              <p className="text-[13px] text-slate-500" data-research-found>{done ? drafts > 0 ? `${drafts} draft${drafts === 1 ? "" : "s"} to review before I use ${drafts === 1 ? "it" : "them"}.` : (!review && ctx?.research?.state === "adopted" ? "Your findings are reviewed and in use." : ctx?.research?.findings ? `${ctx.research.findings} finding${ctx.research.findings === 1 ? "" : "s"} to review before I use ${ctx.research.findings === 1 ? "it" : "them"}.` : "Nothing found this time. Nothing was charged for it.") : options ? "Programmes, lenders and investors that fit your case's country, kind of funding, amount and sector, each with its source." : "I'm completing your information from your records and trusted sources."}</p>
            </div>
          </div>
          {!done && <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full w-1/3 animate-pulse rounded-full bg-brand-600" /></div>}
          <ul className="mt-3 space-y-2">{(options ? [] : gaps.length ? gaps : gapsOf(subject, steps)).slice(0, 6).map((g) => (
            <li key={g.key} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-[13.5px] dark:border-slate-700">
              <span className="flex min-w-0 items-center gap-3 font-semibold text-slate-800 dark:text-slate-100"><span className="text-slate-600"><Glyph name={SECTION_ICON[g.key]} /></span>{g.title}</span>
              {done ? <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-600"><Check className="h-4 w-4" />Checked</span>
                : <span className="flex items-center gap-1.5 text-[12.5px] text-brand-700"><Spinner className="h-3.5 w-3.5" />Processing…</span>}
            </li>
          ))}</ul>
          {/* The price against what others charge, said in the chat (the owner, 28 Oct) */}
          {done && ctx?.idea?.price_check?.text && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13.5px] text-amber-900" data-price-check>{ctx.idea.price_check.text}</p>}
          {/* The next step once the research is done, reviewed or not: the Idea Validation (the owner, 29 Oct) */}
          {/* Done never ends without a step (the owner, 30 Oct: "you have marked everything checked, yet no CTA"): the drafts
              still waiting first, then what is left on the plan */}
          {(review || (done && (onResults || onNext || drafts > 0))) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(review || drafts > 0) && <button type="button" onClick={onReview} className="rounded-lg bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-700" data-review-findings>
                {drafts > 0 ? `Review drafts (${drafts})` : `Review findings${ctx.research?.findings ? ` (${ctx.research.findings})` : ""}`}
              </button>}
              {/* Decided here too, and the result it changes one press away (the owner, 28 Oct: "option to see the validation result
                  dashboard, accept or reject") */}
              {review && !drafts && onDecideAll && ctx?.research?.run_id && <>
                <button type="button" disabled={Boolean(deciding)} onClick={async () => { setDeciding("accept"); try { await onDecideAll("accept"); } finally { setDeciding(""); } }}
                  className="rounded-lg border border-brand-600 px-4 py-2 text-[13.5px] font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-60" data-accept-all>{deciding === "accept" ? "Accepting…" : "Accept all"}</button>
                <button type="button" disabled={Boolean(deciding)} onClick={async () => { setDeciding("reject"); try { await onDecideAll("reject"); } finally { setDeciding(""); } }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-[13.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200" data-reject-all>{deciding === "reject" ? "Rejecting…" : "Reject all"}</button>
              </>}
              {onResults && <button type="button" onClick={onResults} className={review ? "ml-auto text-[13.5px] font-semibold text-brand-700 hover:underline dark:text-brand-300" : "rounded-lg bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-700"} data-see-results>Run the Idea Validation →</button>}
              {!onResults && onNext && done && <button type="button" onClick={onNext}
                className={review || drafts > 0 ? "rounded-lg border border-brand-600 px-4 py-2 text-[13.5px] font-semibold text-brand-700 hover:bg-brand-50" : "rounded-lg bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-700"} data-see-next>See your next steps →</button>}
            </div>
          )}
        </div>
        <div className="rounded-xl bg-brand-50/70 p-4 dark:bg-brand-950/30">
          <p className="flex items-center gap-2 text-[13.5px] font-bold text-slate-900 dark:text-slate-100"><Spark />What EnterprateAI is doing</p>
          <ul className="mt-3 space-y-3 text-[12.5px]">
            {[["Reusing your business data", "From your profile, customers and transactions.", true],
              ["Researching supporting evidence", "Market data and comparable businesses.", done],
              ["Drafting what's missing", "Each draft waits for your approval.", done]].map(([t, d, ok]) => (
              <li key={t} className="flex gap-2">{ok ? <Check className="h-4 w-4 shrink-0" /> : <Spinner className="h-4 w-4 shrink-0" />}
                <span><span className="block font-semibold text-slate-800 dark:text-slate-100">{t}</span><span className="text-slate-500">{d}</span></span></li>
            ))}
          </ul>
        </div>
      </div>
      <Info>Drafts need your review before they're used in any document or shared with anyone.</Info>
    </div>
  );
}

function ScoreChangeCard({ subject, steps, before, after, words }) {
  const ready = subject.summary?.classification === "ready";
  const areas = gapsOf(subject, steps);
  const up = after - before;
  // Why it moved, from the last two checks: what is now met, what no longer is, a new checklist (the owner, 28 Oct)
  const sw = subject.score_why || {};
  const why = [...(sw.checklist ? ["The checklist was updated, so some checks are new or worded differently."] : []),
    ...(sw.met || []).map((l) => `Now met: ${l}`), ...(sw.lost || []).map((l) => `No longer met: ${l}`)];
  return (
    <div className={`${BOX} overflow-hidden`} data-card="score_change">
      <div className={`flex items-center gap-3 px-5 py-4 ${up > 0 ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-slate-50 dark:bg-slate-800/50"}`}>
        {up > 0 ? <Check className="h-9 w-9" /> : <Spark />}
        <div>
          <p className="text-[17px] font-bold text-slate-900 dark:text-slate-50">{ready ? `Your case is now ${words.ready.toLowerCase()}.` : up > 0 ? "Your score went up." : "Your score changed."}</p>
          <p className="text-[13px] text-slate-600 dark:text-slate-300">{ready ? "Every area is complete and the key evidence is in place." : "Here's what changed and what's still open."}</p>
        </div>
      </div>
      <div className="flex flex-col items-start gap-5 p-5 sm:flex-row sm:items-center">
        <Ring score={after} label={words.area.replace(/^./, (c) => c.toUpperCase())} />
        <div className="min-w-0 flex-1">
          <p className={`text-[15px] font-bold ${up > 0 ? "text-emerald-600" : "text-slate-700"}`}>{up > 0 ? "↑ +" : ""}{up} point{Math.abs(up) === 1 ? "" : "s"}</p>
          <p className="text-[13px] text-slate-500">from {before}/100 to {after}/100</p>
        </div>
      </div>
      {why.length > 0 && (
        <ul className="mx-5 mb-4 space-y-1 rounded-xl bg-slate-50 px-4 py-3 text-[13px] text-slate-700 dark:bg-slate-800/60 dark:text-slate-200" data-score-why>
          <li className="font-semibold text-slate-900 dark:text-slate-100">Why it changed</li>
          {why.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      <div className="px-5 pb-5">
        <p className="mb-1 text-[13.5px] font-bold text-slate-900 dark:text-slate-100">Key areas ({areas.filter((a) => a.state === "Completed").length} of {areas.length} complete)</p>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">{areas.map((a) => (
          <li key={a.key} className="flex items-center justify-between gap-2 py-2 text-[13.5px] text-slate-700 dark:text-slate-200">
            <span className="flex items-center gap-2">{a.state === "Completed" ? <Check className="h-4 w-4" /> : <span className="h-4 w-4 rounded-full border-2 border-amber-400" />}{a.title}</span>
            <Chip>{a.state === "Completed" ? "Completed" : "To do"}</Chip>
          </li>
        ))}</ul>
      </div>
    </div>
  );
}

/** Ready (funding-07): said as a result, with the score and how sure the check is, above what to do next. */
function ReadyCard({ subject, score, words }) {
  const sm = subject.summary || {};
  const level = String(sm.confidence || "").toLowerCase();
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900 dark:bg-emerald-950/30" data-card="ready">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[22px] font-bold text-white" aria-hidden="true">✓</span>
        <div className="min-w-0 flex-1">
          <p className="text-[18px] font-bold text-slate-900 dark:text-slate-50">{words.ready}</p>
          <p className="text-[13px] text-slate-600 dark:text-slate-300">{subject.kind === "launch_initiative" || subject.type === "launch_initiative" ? "Your offer, pricing and delivery meet the key requirements of the check." : "Your profile, documents and financials meet the key requirements of the check."}</p>
        </div>
        <div className="flex gap-2">
          <span className="rounded-xl bg-white/80 px-3 py-2 dark:bg-slate-900/60"><span className="block text-[12px] text-slate-500">Readiness score</span><span className="text-[18px] font-bold tabular-nums text-slate-900 dark:text-slate-50">{pct(score)}<span className="text-[13px] font-medium text-slate-500"> / 100</span></span></span>
          {level && <span className="rounded-xl bg-white/80 px-3 py-2 dark:bg-slate-900/60"><span className="block text-[12px] text-slate-500">Confidence</span><span className={`text-[18px] font-bold ${level === "high" ? "text-emerald-600" : level === "medium" ? "text-amber-600" : "text-slate-700"}`}>{level.charAt(0).toUpperCase() + level.slice(1)}</span></span>}
        </div>
      </div>
    </div>
  );
}

function NextCard({ feature, ctx, onTab, send, score = null, name = "" }) {
  const navigate = useNavigate();
  // A quotation already waiting is carried on from here too (funding-07: "Continue SAT Limited Quotation"), from the real list
  const quote = ((ctx?.approvals?.items) || []).find((a) => /quot/i.test(`${a.kind} ${a.title}`));
  const rows = [
    ...(feature === "funding"
      ? [{ key: "plan", icon: "doc", tone: "bg-blue-50 text-blue-600", title: "Prepare your business plan", text: "A business plan made from your existing data.", cta: "Create business plan", go: () => send("Draft my business plan"), primary: true },
         { key: "options", icon: "target", tone: "bg-emerald-50 text-emerald-600", title: "Find funding options", text: "Investors, grants and loans that match your case.", cta: "Find options", go: () => send("Research funding options for my case") },      // real research, its price first (28 Oct)
         ...(quote ? [{ key: "quote", icon: "doc", tone: "bg-violet-50 text-violet-600", title: `Continue ${quote.title}`, text: "Pick up where you left off and finish the quotation.", cta: "Open quotation", go: () => send(`Show me ${quote.title}`) }] : [])]
      // What fits where the plan stands (the owner, 28 Oct: "you can't be recommending these steps at 0%"): the plan first while
      // it is thin, testing it once it holds together, the launch decision only when it is close to ready
      : [...(!(Number(score) >= 60) ? [{ key: "complete", icon: "pen", tone: "bg-amber-50 text-amber-600", title: "Complete your launch plan",
            text: "What you're launching, its price, who it's for and when. Your score rises as you fill them in.", cta: "Fill in the gaps", go: () => onTab?.("answers"), primary: true }] : []),
         // Research already done: what is still blank is drafted next, never the research offered again (the owner, 29 Oct)
         ...(!(Number(score) >= 40) ? [["review", "adopted"].includes(ctx?.research?.state)
           ? { key: "help", icon: "sparkles", tone: "bg-blue-50 text-blue-600", title: "Let me draft what's left",
               text: "I'll draft every field still blank, with estimates where your records have none, for you to approve.", cta: "Draft the rest", go: () => send("Fill the rest for me") }
           : { key: "help", icon: "sparkles", tone: "bg-blue-50 text-blue-600", title: "Let me prepare it for you",
               text: "I'll research and draft what's missing, for you to approve.", cta: "Help me complete it", go: () => send("Help me complete it") }] : []),
         ...(Number(score) >= 40 ? [{ key: "market", icon: "layers", tone: "bg-blue-50 text-blue-600", title: "Test it on the Marketplace", text: "List the service so customers can request quotations.", cta: "List on the Marketplace", go: () => send("Help me list this service on the Marketplace"), primary: Number(score) >= 60 }] : []),
         ...(Number(score) >= 60 ? [{ key: "decide", icon: "pen", tone: "bg-violet-50 text-violet-600", title: "Decide how to launch", text: "Launch now, test first or wait, from where your plan stands.", cta: "Help me decide",
            go: () => send(`Should I launch ${name || "this"} now, test it first or wait?`) }] : [])]),
  ];
  return (
    <div className={`${BOX} p-5`} data-card="next">
      <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Recommended next actions</p>
      <p className="text-[13px] text-slate-500">Choose an option below to continue, or ask me anything.</p>
      <ul className="mt-3 space-y-3">{rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 max-sm:flex-wrap dark:border-slate-700">
          <span className="flex min-w-0 items-center gap-4">
            {r.icon && <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl ${r.tone}`}><Glyph name={r.icon} className="h-7 w-7" /></span>}
            <span className="min-w-0"><span className="block text-[15.5px] font-bold text-slate-900 dark:text-slate-50">{r.title}</span><span className="text-[13px] text-slate-500">{r.text}</span></span>
          </span>
          <button type="button" onClick={r.go} className={`shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-[13px] font-semibold ${r.primary ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-brand-600 text-brand-700 hover:bg-brand-50"}`}>{r.cta} →</button>
        </li>
      ))}</ul>
    </div>
  );
}

/** A change to the case, shown before anything is saved (the owner, 27 Oct: "must not say I'll update your case unless it
 *  actually updates it"): each field as it is and as it would be, made only on Apply. */
function ChangeCard({ card, live, onApply, onCancel, busy }) {
  return (
    <div className={`${BOX} p-5`} data-card="change">
      <p className="text-[15px] font-bold text-slate-900 dark:text-slate-50">{card.create ? "Set up your funding case" : card.replace ? "Replace your funding need" : "Change to your case"}</p>
      <p className="text-[12.5px] text-slate-500">{card.replace ? "The current need stays in your history." : "Nothing is saved until you apply it."}</p>
      <table className="mt-3 w-full text-[13.5px]">
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{(card.rows || []).map((r) => (
          <tr key={r.label}>
            <td className="py-2 pr-3 text-slate-500">{r.label}</td>
            {!card.create && <td className="py-2 pr-3 text-slate-500 line-through decoration-slate-300">{r.before}</td>}
            <td className="py-2 font-semibold text-slate-900 dark:text-slate-50">{r.after}</td>
          </tr>
        ))}</tbody>
      </table>
      {live && (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy} onClick={onApply} className="rounded-lg bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-700 disabled:opacity-60" data-change-apply>Apply</button>
          <button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-[13.5px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200">Cancel</button>
        </div>
      )}
    </div>
  );
}

// ── Approvals waiting, in the conversation (the mockups' "Pending approvals") ──

export function ApprovalsCard({ ctx, onDone, onReview = null, onEdit = null }) {
  const navigate = useNavigate();
  const [sent, setSent] = useState({});
  const [problem, setProblem] = useState("");
  const items = ctx?.approvals?.items || [];
  const approve = async (a) => {
    setProblem("");
    setSent((x) => ({ ...x, [a.approval_id]: "sending" }));
    try { await approveAction(a.run_id, a.approval_id); setSent((x) => ({ ...x, [a.approval_id]: "sent" })); onDone?.(); }
    catch (e) { setSent((x) => ({ ...x, [a.approval_id]: null })); setProblem(agentErrorMessage(e, "That couldn't be sent just now. Nothing was sent.")); }
  };
  const initials = (t) => String(t || "?").replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
  return (
    <div className={`${BOX} p-5`} data-card="approvals">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Pending approvals</p>
          <p className="text-[13px] text-slate-500">Review and approve what's ready to send.</p>
        </div>
        <span className="text-[13px] font-semibold text-brand-700">{items.length} waiting</span>
      </div>
      {items.length ? (
        <ul className="mt-3 space-y-3">{items.map((a) => (
          <li key={a.approval_id || a.draft_id || a.run_id || a.title} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-50 text-[14px] font-bold text-rose-700">{initials(a.subtitle?.replace(/^(For|Ready to send to)\s+/, "") || a.title)}</span>
                <span className="min-w-0"><span className="block text-[14.5px] font-bold text-slate-900 dark:text-slate-50">{a.title}</span><span className="block text-[13px] text-slate-500">{a.subtitle}</span></span>
              </span>
              <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${sent[a.approval_id] === "sent" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                {sent[a.approval_id] === "sent" ? "Sent" : `Waiting${a.age ? ` · ${a.age}` : ""}`}
              </span>
            </div>
            {!a.approval_id ? (
              // An Agent draft (a business plan, an idea's validation): reviewed on its own page
              <button type="button" onClick={() => (onReview ? onReview(a) : navigate(a.to || `/agent/runs/${a.run_id}`))} className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-700">Review</button>
            ) : sent[a.approval_id] !== "sent" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => (onReview ? onReview(a) : navigate(`/agent/runs/${a.run_id}`))} className="whitespace-nowrap rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">Review message</button>
                <button type="button" disabled={sent[a.approval_id] === "sending"} onClick={() => approve(a)} className="whitespace-nowrap rounded-lg bg-brand-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-60">{sent[a.approval_id] === "sending" ? "Sending…" : "Approve send"}</button>
                <button type="button" onClick={() => (onEdit ? onEdit(a) : navigate(`/agent/runs/${a.run_id}`))} className="whitespace-nowrap rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">Edit</button>
              </div>
            )}
          </li>
        ))}</ul>
      ) : <p className="mt-2 text-[13px] text-slate-500">Nothing is waiting for your approval.</p>}
      {problem && <p role="alert" className="mt-2 text-[13px] font-semibold text-rose-600">{problem}</p>}
      <Info>Messages to customers, such as invoice reminders, are never sent without your approval.</Info>
    </div>
  );
}

// ── Review the Agent's drafts (the mockups' "Review enriched information") ──

const TAG = { "External research": "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200", "Existing business data": "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
  "AI-assisted draft": "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-200" };
const tagOf = (src) => (/research|web|market|search|source/i.test(String(src || "")) ? "External research" : /record|invoice|customer|profile|catalogue|your /i.test(String(src || "")) ? "Existing business data" : "AI-assisted draft");
const sameValue = (a, b) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "") || String(a ?? "").trim() === String(b ?? "").trim();
// A field the checklist doesn't name, in words ("market.size" is "Market size"), never its path
const words = (path) => String(path).split(".").pop().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
/** The drafts still waiting, each with its field's label and section. */
export function waitingDrafts(subject) {
  const data = subject?.data || {};
  const where = {};
  (subject?.profile_definition?.sections || []).forEach((sec) => (sec.fields || []).forEach((f) => { where[f.key] = { label: f.label || f.key, section: sec.key, sectionTitle: sec.title, type: f.type }; }));
  return Object.entries(data.agent_drafts || {}).filter(([path, d]) => d && "value" in d && !sameValue(getPath(data, path), d.value))
    .map(([path, d]) => ({ path, draft: d, label: where[path]?.label || words(path), section: where[path]?.section || "other", sectionTitle: where[path]?.sectionTitle || "Other",
      money: where[path]?.type === "money" || (!where[path] && /price|cost|budget|revenue|amount/i.test(path) && isAmount(d.value)) }));
}
// A row in words: never its ids, links or yes/no flags shown as "true" (the test run and the permit from the records, 29 Oct)
const rowText = (r) => (r && typeof r === "object" ? [...new Set(Object.entries(r).filter(([k, v]) => k !== "id" && !/_id$|^source_reference$|^process_version$/.test(k)
  && v !== null && v !== "" && typeof v !== "object" && typeof v !== "boolean").map(([, v]) => String(v).replace(/_/g, " ")))].join(": ") : String(r ?? ""));

/** Spending lines as a table, in the workspace's currency, with their total against the amount asked (the owner's test,
 *  27 Oct: raw "9880000", a label named twice, lines adding up to ₦10,000,000 of a ₦25,000,000 ask). */
/** True on a phone-width screen, followed as it changes: what is drawn is the one that fits, never both. */
function useNarrow() {
  const query = "(max-width: 639.98px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return narrow;
}

function LinesTable({ rows, currency, target }) {
  const narrow = useNarrow();
  const total = rows.reduce((t, r) => t + (Number(String(r?.amount ?? "").replace(/,/g, "")) || 0), 0);
  const ask = Number(String(target ?? "").replace(/,/g, "")) || 0;
  const gap = ask ? ask - total : 0;
  return (
    <>
    {narrow ? (
    <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700" data-lines-stacked>
      {rows.map((r, j) => (
        <li key={r?.id || j} className="px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3"><span className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">{r?.category || "Other"}</span>
            <span className="whitespace-nowrap text-[14px] font-semibold tabular-nums text-slate-900 dark:text-slate-50">{money(r?.amount, currency)}</span></div>
          <p className="mt-0.5 text-[13px] text-slate-600 dark:text-slate-300">{r?.purpose || r?.line || ""}</p>
        </li>
      ))}
      <li className="flex items-baseline justify-between gap-3 bg-slate-50 px-3 py-2.5 text-[13.5px] font-semibold dark:bg-slate-800/60"><span>Total funding requirement</span><span className="whitespace-nowrap tabular-nums">{money(total, currency)}</span></li>
    </ul>
    ) : (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="w-full text-[13.5px]">
        <thead className="bg-slate-50 text-left text-[12.5px] text-slate-600 dark:bg-slate-800/60"><tr><th className="whitespace-nowrap px-3 py-2.5 font-semibold">Category</th><th className="min-w-[11rem] whitespace-nowrap px-3 py-2.5 font-semibold">What it pays for</th><th className="px-3 py-2.5 text-right font-semibold">Amount</th><th className="w-32 px-3 py-2.5 font-semibold max-sm:hidden">Share</th></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{rows.map((r, j) => (
          <tr key={r?.id || j}><td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">{r?.category || "Other"}</td>
            <td className="px-3 py-2 text-slate-800 dark:text-slate-100">{r?.purpose || r?.line || ""}</td>
            <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-50">{money(r?.amount, currency)}</td>
            <td className="px-3 py-2 max-sm:hidden">{(() => { const share = total ? Math.round(100 * (Number(String(r?.amount ?? "").replace(/,/g, "")) || 0) / total) : 0; return (
              <span className="block"><span className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">{share}%</span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><span className="block h-full rounded-full bg-blue-500" style={{ width: `${share}%` }} /></span></span>); })()}</td></tr>
        ))}</tbody>
        <tfoot><tr className="bg-slate-50 font-semibold dark:bg-slate-800/60"><td className="px-3 py-2.5" colSpan={2}>Total funding requirement</td><td className="px-3 py-2.5 text-right tabular-nums">{money(total, currency)}</td><td className="px-3 py-2.5 max-sm:hidden">100%</td></tr></tfoot>
      </table>
    </div>
    )}
      {ask > 0 && Math.abs(gap) > 1 && (
        <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-900" data-lines-gap>
          These lines add up to {money(total, currency)}, {money(Math.abs(gap), currency)} {gap > 0 ? "less" : "more"} than the {money(ask, currency)} you're asking for. Edit them on Inputs, or ask me to redo them.
        </p>
      )}
    </>
  );
}

// A list draft (milestones, dependencies) or one record (the test run) edited in place, row by row: never another tab
// (the owner, 30 Oct: "why is edit taking me away from here?")
const ROW_SKIP = /^id$|_id$|^source_reference$|^process_version$|^status$|^critical$|^applicable$/;
function RowsEdit({ value, onChange, label }) {
  const single = !Array.isArray(value);
  const rows = single ? [value] : value;
  const put = (j, k, v) => {
    const next = rows.map((r, i) => (i === j ? { ...r, [k]: v } : r));
    onChange(single ? next[0] : next);
  };
  return (
    <div className="mt-3 space-y-3" data-rows-edit>
      {rows.map((r, j) => (
        <div key={r?.id || j} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2 dark:border-slate-700">
          {Object.entries(r || {}).filter(([k, v]) => !ROW_SKIP.test(k) && typeof v !== "object" && typeof v !== "boolean").map(([k, v]) => (
            <label key={k} className="block text-[12px] font-semibold text-slate-500">{words(k)}
              <input aria-label={`${label} ${j + 1} ${words(k)}`} value={String(v ?? "")} onChange={(e) => put(j, k, e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13.5px] font-normal text-slate-800 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

function ReviewScreen({ drafts, edits, setEdits, onApproveAll, onRequest, busy, firstField, currency, target, decided = [], onDecide, onUndo }) {
  const [more, setMore] = useState(false);      // the phone's ⋯ menu
  const [rowsOpen, setRowsOpen] = useState({});      // list drafts being edited in place
  const boxes = useRef({});
  // In the conversation, every draft at once under its area's name: no tabs, no second chat (the owner, 27 Oct); each with
  // its own Approve, Edit and Reject, a decided one folded to its label with Undo (the owner, 28 Oct)
  const open = drafts.filter((d) => !decided.some((x) => x.d.path === d.path));
  const shown = [...open, ...decided.map((x) => ({ ...x.d, decided: x.kind }))]
    .sort((a, b) => String(a.sectionTitle).localeCompare(String(b.sectionTitle)));
  const BTN = "rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200";
  return (
    <section aria-label="Review enriched information" className={`${BOX} min-w-0 space-y-4 p-5 max-sm:p-4`} data-review-screen>
      <div>
        <p className="text-[18px] font-bold text-slate-900 dark:text-slate-50">Review enriched information</p>
        <p className="text-[13.5px] text-slate-500">Review and refine what I prepared. Approve it to update your case.</p>
        <p className="mt-1 text-[13px] font-semibold text-slate-700 dark:text-slate-200" data-drafts-left>{open.length} draft{open.length === 1 ? "" : "s"} waiting</p>
      </div>
      <div className="grid grid-cols-1 gap-4">
        {shown.map((d, i) => {
          const v = d.path in edits ? edits[d.path] : d.draft.value;
          const tag = tagOf(d.draft.source);
          if (d.decided) return (
            <div key={d.path} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-2.5 text-[13.5px] dark:border-slate-700" data-draft-decided={d.decided}>
              <span className="min-w-0 truncate font-semibold text-slate-800 dark:text-slate-100">{d.label}</span>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold ${d.decided === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{d.decided === "approved" ? "Approved" : "Rejected"}</span>
              <button type="button" onClick={() => onUndo?.(d.path)} className="ml-auto shrink-0 text-[13px] font-semibold text-brand-700 hover:underline dark:text-brand-300" data-draft-undo>Undo</button>
            </div>
          );
          const list = Array.isArray(v) || (v !== null && typeof v === "object");      // a list, or one record (the test run): edited on Inputs
          return (
            <div key={d.path} className={`${BOX} p-5 max-sm:rounded-none max-sm:border-0 max-sm:border-b max-sm:px-0 max-sm:pb-4 max-sm:pt-0`} data-draft-review={d.path}>
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">{d.sectionTitle}</p>
              <p className="text-[15px] font-bold text-slate-900 dark:text-slate-50">{d.label}</p>
              <p className="text-[12.5px] text-slate-500">{fromLine(d.draft.source)}</p>
              {list && rowsOpen[d.path] ? (
                <RowsEdit value={v} label={d.label} onChange={(next) => setEdits((x) => ({ ...x, [d.path]: next }))} />
              ) : Array.isArray(v) && v.some((r) => r && typeof r === "object" && "amount" in r) ? (
                <LinesTable rows={v} currency={currency} target={d.path === "use_of_funds" ? target : null} />
              ) : list ? (
                <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 text-[13.5px] dark:divide-slate-800 dark:border-slate-700">
                  {(Array.isArray(v) ? v : [v]).map((r, j) => <li key={j} className="px-3 py-2 text-slate-800 dark:text-slate-100">{rowText(r)}</li>)}
                </ul>
              ) : (
                <textarea ref={(el) => { boxes.current[d.path] = el; if (i === 0 && firstField) firstField.current = el; }} aria-label={d.label}
                  value={d.money && !(d.path in edits) && isAmount(v) ? money(String(v).replace(/,/g, ""), currency) : String(v ?? "")} rows={Math.min(8, Math.max(2, Math.ceil(String(v ?? "").length / 60)))}
                  onChange={(e) => setEdits((x) => ({ ...x, [d.path]: typeof d.draft.value === "number" || d.money ? e.target.value.replace(/[^\d.]/g, "") : e.target.value }))}
                  className="mt-3 w-full rounded-xl border border-slate-200 bg-white p-3 text-[13.5px] text-slate-800 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className={`rounded-md px-2 py-1 text-[12px] font-semibold ${TAG[tag]}`}>{tag}</span>
                {d.path in edits && <span className="rounded-md bg-violet-50 px-2 py-1 text-[12px] font-semibold text-violet-700">Edited by you</span>}
              </div>
              {onDecide && (
                <div className="mt-3 flex flex-wrap gap-2" data-draft-actions>
                  <button type="button" disabled={busy} onClick={() => onDecide(d, "approved")} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-60" data-draft-approve>Approve</button>
                  <button type="button" disabled={busy} onClick={() => (list ? setRowsOpen((x) => ({ ...x, [d.path]: !x[d.path] })) : boxes.current[d.path]?.focus())} className={BTN} data-draft-edit>
                    {list && rowsOpen[d.path] ? "Done editing" : "Edit"}</button>
                  <button type="button" disabled={busy} onClick={() => onDecide(d, "rejected")} className={BTN} data-draft-reject>Reject</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* One bar at the foot of the review, never over its heading (the owner, 28 Oct); on a phone, Request changes in ⋯ */}
      <div className="flex flex-nowrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 max-sm:flex-wrap max-sm:rounded-none max-sm:border-0 max-sm:p-0 dark:border-slate-800 dark:bg-slate-900" data-review-bar>
        <button type="button" disabled={busy || !open.length} onClick={onApproveAll} className="shrink-0 whitespace-nowrap rounded-lg bg-brand-600 px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-brand-700 disabled:opacity-60" data-approve-all>✓ {decided.length ? "Approve the rest" : "Approve all"}</button>
        <button type="button" onClick={onRequest} className="shrink-0 whitespace-nowrap rounded-lg border border-slate-300 px-4 py-2.5 text-[14px] font-semibold text-slate-700 hover:bg-slate-50 max-sm:hidden dark:border-slate-600 dark:text-slate-200">Request changes</button>
        <div className="relative sm:hidden">
          <button type="button" aria-label="More" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore((v) => !v)} className="rounded-lg border border-slate-300 px-3 py-2.5 text-[14px] font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200">⋯</button>
          {more && <div role="menu" className="absolute bottom-12 left-0 z-20 w-48 rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <button type="button" role="menuitem" onClick={() => { setMore(false); onRequest(); }} className="block w-full px-3 py-2 text-left text-[14px] text-slate-700 hover:bg-slate-50 dark:text-slate-200">Request changes</button></div>}
        </div>
        <span className="ml-auto min-w-0 whitespace-nowrap text-xs text-slate-500 max-sm:ml-0 max-sm:basis-full" title="Approved information updates your case.">Updates your case once approved</span>
      </div>
    </section>
  );
}


// ── The idea being tested (the mockups' Idea Validation) ─────────────────────

const VIAB = { "Very Strong": "emerald", Strong: "emerald", Fair: "amber", Weak: "rose" };
const met = (idea, key) => ((idea?.criteria || []).find((c) => c.key === key) || {}).state;
const isMet = (idea, key) => met(idea, key) === "met";
/** The idea as a case: one area per criterion, so the shared cards (choose, progress, score change) read it the same way. */
export function ideaSubject(idea) {
  const score = typeof idea?.score_out_of_100 === "number" ? idea.score_out_of_100 : idea?.partial_score ?? null;
  return { id: "idea", kind: "idea", title: idea?.answers?.description || "Your idea", data: {}, summary: { score, classification: idea?.viability === "Strong" || idea?.viability === "Very Strong" ? "ready" : idea?.viability ? "not_ready" : null },
    sections: (idea?.criteria || []).map((c) => ({ key: c.key, title: c.label, answered: c.state === "met" ? 1 : 0, total: 1 })) };
}

function ViabilityCard({ idea, score }) {
  const v = idea?.viability;
  const t = VIAB[v] || "amber";
  const weak = idea?.weaknesses || [];
  return (
    <div className={`${BOX} p-5`} data-card="viability">
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <Ring score={score} label={v ? `${v} Viability` : "So far"} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[18px] font-bold text-slate-900 dark:text-slate-50">Initial viability result
            {v && <span className={`rounded-lg px-2.5 py-1 text-[13px] font-semibold ${t === "emerald" ? "bg-emerald-50 text-emerald-700" : t === "rose" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}>{v} Viability</span>}</p>
          <p className="mt-2 text-[13.5px] text-slate-600 dark:text-slate-300">{v || (score !== null && score !== undefined) ? (weak.length ? `${(idea.strengths || []).length ? "There's a lot going for it" : "It's early"}, but ${weak.slice(0, 2).join(" and ").toLowerCase()}.` : "Every part of it holds up on your numbers.")
            : "Tell me your price, expected sales, costs and capacity, and I'll work out its viability."}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl bg-emerald-50/60 p-4 dark:bg-emerald-950/20">
          <p className="mb-2 text-[14px] font-bold text-slate-900 dark:text-slate-100">Strengths</p>
          {(idea?.strengths || []).length ? <ul className="space-y-1.5">{idea.strengths.map((x) => <li key={x} className="flex items-start gap-2 text-[13.5px] text-slate-700 dark:text-slate-200"><Check className="h-4 w-4 shrink-0" />{x}</li>)}</ul>
            : <p className="text-[13px] text-slate-500">None shown yet.</p>}
        </div>
        <div className="rounded-xl bg-amber-50/60 p-4 dark:bg-amber-950/20">
          <p className="mb-2 text-[14px] font-bold text-slate-900 dark:text-slate-100">Weaknesses</p>
          {weak.length ? <ul className="space-y-1.5">{weak.map((x) => <li key={x} className="flex items-start gap-2 text-[13.5px] text-slate-700 dark:text-slate-200"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">!</span>{x}</li>)}</ul>
            : <p className="text-[13px] text-slate-500">None found.</p>}
        </div>
      </div>
      {!isMet(idea, "demand") && v && <Info>This service may work, but it shouldn't be launched heavily without stronger market proof.</Info>}
    </div>
  );
}

function LaunchFitCard({ idea, onMarket }) {
  const rows = [
    ["Offer definition", isMet(idea, "idea") && isMet(idea, "customer") ? "Ready" : "Not ready"],
    ["Pricing", isMet(idea, "margin") ? (isMet(idea, "competitors") ? "Ready" : "Ready for testing") : "Not ready"],
    ["Capacity", isMet(idea, "capacity") ? "Ready" : "Not ready"],
    ["Economic viability", isMet(idea, "margin") && isMet(idea, "break_even") ? "Strong" : "Not ready"],
    ["Real-world traction", isMet(idea, "demand") ? "Ready" : met(idea, "demand") === "partial" ? "Early" : "Insufficient"],
  ];
  const test = !isMet(idea, "demand");
  const toneOf = (x) => (["Ready", "Strong"].includes(x) ? "text-emerald-600" : ["Ready for testing", "Early"].includes(x) ? "text-amber-600" : "text-rose-600");
  return (
    <div className={`${BOX} p-5`} data-card="launch_fit">
      <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Launch readiness</p>
      <div className="mt-3 grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="text-center">
          <span className={`mx-auto flex h-28 w-28 items-center justify-center rounded-full border-[10px] ${test ? "border-amber-400" : "border-emerald-500"} `} aria-hidden="true"><svg viewBox="0 0 24 24" className="h-10 w-10 text-slate-800 dark:text-slate-100" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 15c-1.5 1.3-2 4-2 6 2 0 4.7-.5 6-2M9 18l-3-3M14.5 4.5C17 2 21 3 21 3s1 4-1.5 6.5L13 16l-5-5z" /><circle cx="15.5" cy="8.5" r="1.5" /></svg></span>
          <p className="mt-3 text-[16px] font-bold text-slate-900 dark:text-slate-50">{test ? "Test before full launch" : "Ready to launch"}</p>
          <p className="text-[12.5px] text-slate-500">{test ? "Strong foundations, but it needs real customers before a full commercial launch." : "The offer, pricing, capacity and demand hold up."}</p>
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">{[...rows, ["Launch recommendation", test ? "Test market first" : "Launch"]].map(([k, v]) => (
          <li key={k} className="flex items-center justify-between gap-2 py-2.5 text-[13.5px]"><span className="text-slate-700 dark:text-slate-200">{k}</span><span className={`font-semibold ${k === "Launch recommendation" ? (test ? "text-amber-600" : "text-emerald-600") : toneOf(v)}`}>{v}</span></li>
        ))}</ul>
      </div>
      {test && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-50 px-4 py-3 text-[13px] text-brand-900 dark:bg-brand-950/40 dark:text-brand-100">
          <span><b>Best next step:</b> list it on the Marketplace so customers can request quotations. It builds proof before you commit to a full launch.</span>
          <button type="button" onClick={onMarket} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700">Publish to Marketplace</button>
        </div>
      )}
    </div>
  );
}

function RiskCard({ risk, onScenario, onSegments }) {
  if (!risk) return null;
  const bars = [[risk.customer, risk.share, "bg-rose-500"], ["Other customers", risk.others, "bg-blue-400"], [`Long tail${risk.tail_count ? ` (${risk.tail_count} customers)` : ""}`, risk.tail, "bg-slate-400"]].filter(([, n]) => n > 0);
  return (
    <div className={`${BOX} p-5`} data-card="risk">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Customer concentration risk</p>
          <p className="text-[13px] text-slate-500">A large share of your revenue comes from one customer, which makes revenue and cash flow less stable.</p></div>
        <span className={`rounded-md px-2 py-0.5 text-[12.5px] font-semibold ${risk.level === "High" ? "bg-rose-50 text-rose-700" : risk.level === "Medium" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{risk.level}</span>
      </div>
      <div className="mt-3 grid gap-4 rounded-xl border border-slate-200 p-4 md:grid-cols-2 dark:border-slate-700">
        <div><p className="text-[12.5px] text-slate-500">Main customer</p><p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">{risk.customer}</p>
          <p className="mt-1 text-[30px] font-bold text-rose-600">{risk.share}%<span className="ml-2 text-[13px] font-normal text-slate-500">of paid revenue, last 12 months</span></p></div>
        <ul className="space-y-2">{bars.map(([k, n, c]) => (
          <li key={k} className="grid grid-cols-[minmax(0,1fr)_6rem_2.5rem] items-center gap-2 text-[12.5px] text-slate-600 dark:text-slate-300">
            <span className="truncate">{k}</span><span className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><span className={`block h-full ${c}`} style={{ width: `${n}%` }} /></span><span className="text-right tabular-nums">{n}%</span>
          </li>
        ))}</ul>
      </div>
      <p className="mt-3 text-[13.5px] font-semibold text-slate-800 dark:text-slate-100">Run scenarios</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {[["Simulate order reduction", "Model 10 to 50% lower orders"], ["Simulate payment delay", "Model a 30 to 90 day delay"], ["Explore new customer segments", "Find and assess new markets"]].map(([t, d]) => (
          <button key={t} type="button" onClick={() => (t.startsWith("Explore") ? onSegments?.() : onScenario(t.includes("delay") ? "payment_delay" : "order_reduction", t))} className="rounded-xl border border-brand-200 px-3 py-2 text-left hover:bg-brand-50"><span className="block text-[13px] font-semibold text-brand-700">{t}</span><span className="text-[11.5px] text-slate-500">{d}</span></button>
        ))}
      </div>
    </div>
  );
}

function IdeaChooseCard({ price, onStart, onSelf, busy, reuse = false }) {
  const [pick, setPick] = useState("help");
  const Option = ({ id, title, text }) => (
    <button type="button" role="radio" aria-checked={pick === id} onClick={() => setPick(id)}
      className={`relative flex-1 rounded-xl border p-4 text-left ${pick === id ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500 dark:bg-brand-950/30" : "border-slate-200 dark:border-slate-700"}`}>
      <span className={`absolute left-3 top-3 h-4 w-4 rounded-full border-2 ${pick === id ? "border-brand-600 bg-brand-600 shadow-[inset_0_0_0_3px_white]" : "border-slate-300"}`} aria-hidden="true" />
      <span className="block pl-6 text-[14.5px] font-bold text-slate-900 dark:text-slate-50">{title}</span>
      <span className="mt-1 block pl-6 text-[13px] text-slate-600 dark:text-slate-300">{text}</span>
    </button>
  );
  return (
    <div className={`${BOX} p-5`} data-card="choose">
      <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Choose how to continue</p>
      <div role="radiogroup" aria-label="How to continue" className="mt-3 flex flex-col gap-3 sm:flex-row">
        <Option id="help" title="Research & Prepare" text={`I'll research comparable services, pricing and demand, then prepare updated assumptions for your review.${reuse ? " Free: it reuses your last research." : price ? ` Up to ${price} credits.` : ""}`} />
        <Option id="self" title="Enter information myself" text="I'll take you through the inputs and you enter them yourself." />
      </div>
      <p className="mt-4 text-[13.5px] font-bold text-slate-900 dark:text-slate-100">Research workstreams</p>
      <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">{["Comparable services", "Competitor pricing", "Market demand", "Pricing assumptions", "Sales assumptions"].map((w) => (
        <li key={w} className="flex items-center justify-between py-2 text-[13.5px] text-slate-700 dark:text-slate-200"><span className="flex items-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-slate-300" />{w}</span><span className="text-[12.5px] text-slate-400">Pending</span></li>
      ))}</ul>
      <Info>All research findings are shown to you for approval before they change anything.</Info>
      {/* Both ways as buttons of their own: one press, nothing to pick first (the owner, 29 Oct: "the enter by yourself on the idea
          validation is still not working fine") */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={onStart} className={`rounded-lg px-4 py-2 text-[13.5px] font-semibold disabled:opacity-60 ${pick === "help" ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-brand-600 text-brand-700 hover:bg-brand-50"}`} data-idea-start>
          {`Start${reuse ? " · free" : price ? ` · up to ${price} credits` : ""}`}
        </button>
        <button type="button" disabled={busy} onClick={onSelf} className={`rounded-lg px-4 py-2 text-[13.5px] font-semibold disabled:opacity-60 ${pick === "self" ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200"}`} data-idea-self>
          Enter it myself
        </button>
      </div>
    </div>
  );
}

// The idea's details in the conversation (the owner, 28 Oct: "Add idea details"): what is known filled in, the owner changes
// what's wrong or missing; saved through the same check the Assessment tab uses, said as "Updated …" with Undo
const IDEA_FIELDS = [["description", "Service", "text"], ["customer", "Target customer", "text"], ["price", "Price", "money"], ["cost", "Cost per sale", "money"],
  ["monthly_sales", "Expected sales a month", "number"], ["capacity", "Capacity a month", "number"], ["demand", "Demand evidence", "choice"]];
const DEMAND_WORDS = { assumption: "None yet, it is my assumption", research: "Research", enquiries: "Enquiries", lois: "Letters of intent", pilot: "A paid pilot",
  paying: "Paying customers", repeat: "Repeat customers" };
function IdeaFormCard({ businessId, idea, currency, onSaved, say }) {
  const known = idea?.answers || {};
  const [form, setForm] = useState(() => Object.fromEntries(IDEA_FIELDS.map(([k]) => [k, known[k] ?? ""])));
  const [state, setState] = useState({ busy: false, done: null, problem: "" });
  const shown = (k, v) => (v === "" || v === null || v === undefined ? "not set" : k === "demand" ? DEMAND_WORDS[v] || v : ["price", "cost"].includes(k) ? money(v, currency) : String(v));
  const post = (answers) => apiRequest(`/businesses/${businessId}/quick-check/test_idea`, "POST", { answers });
  const save = async () => {
    const was = Object.fromEntries(IDEA_FIELDS.map(([k]) => [k, known[k] ?? ""]));
    const next = Object.fromEntries(IDEA_FIELDS.map(([k, , t]) => [k, t === "money" || t === "number" ? (form[k] === "" ? "" : Number(String(form[k]).replace(/[^\d.]/g, ""))) : form[k]]));
    const moved = IDEA_FIELDS.filter(([k]) => String(next[k] ?? "") !== String(was[k] ?? ""));
    if (!moved.length) { setState({ busy: false, done: { line: "Nothing changed: every detail is already set as shown." }, problem: "" }); return; }
    setState({ busy: true, done: null, problem: "" });
    try {
      await post({ ...known, ...next });
      const line = `Updated ${moved.map(([k, label], i) => `${i ? label.toLowerCase() : label}: ${shown(k, was[k])} → ${shown(k, next[k])}`).join("; ")}.`;
      setState({ busy: false, done: { line, was }, problem: "" });
      say?.(line);
      onSaved?.();
    } catch (e) { setState({ busy: false, done: null, problem: agentErrorMessage(e, "Those details couldn't be saved just now.") }); }
  };
  const undo = async () => {
    const was = state.done?.was;
    if (!was) return;
    setState((x) => ({ ...x, busy: true }));
    try { await post({ ...known, ...was }); setForm(was); setState({ busy: false, done: { line: "Undone. Your idea is back as it was." }, problem: "" }); say?.("Undone. Your idea is back as it was."); onSaved?.(); }
    catch (e) { setState((x) => ({ ...x, busy: false, problem: agentErrorMessage(e, "That couldn't be undone just now.") })); }
  };
  if (state.done) return (
    <div className={`${BOX} flex items-center gap-3 p-4 text-[13.5px]`} data-card="idea_form" data-saved>
      <span className="min-w-0 flex-1 text-slate-700 dark:text-slate-200">{state.done.line}</span>
      {state.done.was && <button type="button" disabled={state.busy} onClick={undo} className="shrink-0 font-semibold text-brand-700 hover:underline disabled:opacity-60 dark:text-brand-300" data-idea-undo>Undo</button>}
    </div>
  );
  const box = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13.5px] text-slate-800 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  return (
    <div className={`${BOX} p-5`} data-card="idea_form">
      <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Your idea's details</p>
      <p className="text-[13px] text-slate-500">Change what's wrong or missing, then save.</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {IDEA_FIELDS.map(([k, label, t]) => (
          <label key={k} className={`block text-[12.5px] font-semibold text-slate-600 dark:text-slate-300 ${k === "description" || k === "customer" ? "sm:col-span-2" : ""}`}>{label}
            {t === "choice" ? (
              <select value={form[k] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} className={box}>
                <option value="">Choose</option>
                {Object.entries(DEMAND_WORDS).map(([v, w]) => <option key={v} value={v}>{w}</option>)}
              </select>
            ) : (
              <input value={form[k] ?? ""} inputMode={t === "text" ? undefined : "decimal"} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} className={box} />
            )}
          </label>
        ))}
      </div>
      {state.problem && <p role="alert" className="mt-2 text-[13px] font-semibold text-rose-600">{state.problem}</p>}
      <button type="button" disabled={state.busy} onClick={save} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-700 disabled:opacity-60" data-idea-save>Save</button>
    </div>
  );
}

const ONCE = new Set(["findings", "choose", "next", "research_again", "progress"]);

// A new search instead of the reused one, its own price said first (the owner, 28 Oct)
function ResearchAgainCard({ businessId, answers, busy, onStart }) {
  const [price, setPrice] = useState(null);
  useEffect(() => {
    let live = true;
    apiRequest(`/businesses/${businessId}/quick-check/test_idea/premium/quote`, "POST", { answers, fresh: true })
      .then((q) => live && setPrice(q?.allowed ? Number(q.max || q.cost || 0) : null), () => live && setPrice(null));
    return () => { live = false; };
  }, [businessId]);      // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`${BOX} flex flex-wrap items-center gap-3 p-4`} data-card="research_again">
      <span className="min-w-0 flex-1 text-[13.5px] text-slate-600 dark:text-slate-300">Want a new search instead? It looks again from scratch.</span>
      <button type="button" disabled={busy} onClick={onStart} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200" data-research-again>
        {`Research again${price ? ` · up to ${price} credits` : price === 0 ? " · free" : ""}`}
      </button>
    </div>
  );
}

function IdeaNextCard({ businessId, idea, send, onTab }) {
  const navigate = useNavigate();
  const [added, setAdded] = useState(false);
  const [problem, setProblem] = useState("");
  const a = idea?.answers || {};
  const addToCatalogue = async () => {
    setProblem("");
    try {
      await apiRequest(`/businesses/${businessId}/catalogue/from-check`, "POST", { name: String(a.description || "New service").slice(0, 120),
        ...(Number(a.price) > 0 ? { base_price: Number(a.price) } : {}), ...(Number(a.cost) >= 0 && a.cost !== undefined && a.cost !== "" ? { cost_of_sales: Number(a.cost) } : {}) });
      setAdded(true);
    } catch (e) { setProblem(agentErrorMessage(e, "It couldn't be added just now.")); }
  };
  const rows = [
    { key: "catalogue", title: "Add it to your Product & Service Catalogue", text: "So quotations and listings use its approved price.", cta: added ? "Added" : "Add to catalogue", go: addToCatalogue, primary: true, done: added },
    { key: "launch", title: "Check if you're ready to launch", text: "Offer, pricing, capacity and real customers.", cta: "Check it", go: () => send("So, am I ready to launch?") },
    { key: "market", title: "Test it on the Marketplace", text: "Let potential customers request quotations.", cta: "Publish", go: () => send("Help me publish this service on the Marketplace") },
    { key: "quote", title: "Prepare a quotation", text: "From the approved service and price.", cta: "Create quotation", go: () => send("Draft a quotation for this service") },
  ];
  return (
    <div className={`${BOX} p-5`} data-card="next">
      <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Recommended next actions</p>
      <ul className="mt-3 space-y-3">{rows.map((r) => (
        <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <span className="min-w-0"><span className="block text-[14.5px] font-bold text-slate-900 dark:text-slate-50">{r.title}</span><span className="text-[13px] text-slate-500">{r.text}</span></span>
          <button type="button" disabled={r.done} onClick={r.go} className={`rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-70 ${r.primary ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-brand-600 text-brand-700 hover:bg-brand-50"}`}>{r.cta}{r.done ? " ✓" : " →"}</button>
        </li>
      ))}</ul>
      {problem && <p role="alert" className="mt-2 text-[13px] font-semibold text-rose-600">{problem}</p>}
    </div>
  );
}

function SnapshotSide({ idea }) {
  const m = Object.fromEntries((idea?.metrics || []).map((x) => [x.label, x.value]));
  const tile = (title, value, ok, note) => (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      <p className="mt-1 text-[20px] font-bold text-slate-900 dark:text-slate-50">{value || "Not known"}</p>
      <span className={`mt-1 inline-block rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${ok === true ? "bg-emerald-50 text-emerald-700" : ok === false ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{ok === true ? "Strong" : ok === false ? "Weak" : "Unknown"}</span>
      <p className="mt-1 text-[11.5px] text-slate-500">{note}</p>
    </div>
  );
  const state = (k) => (met(idea, k) === "met" ? true : met(idea, k) === "unknown" || !met(idea, k) ? null : false);
  return (
    <div className={`${BOX} p-5`} data-side="snapshot">
      <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Viability Snapshot</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {tile("Margin", m.Margin, state("margin"), "Contribution per sale")}
        {tile("Break-even", m["Break-even"], state("break_even"), "Sales needed a month")}
        {tile("Demand evidence", met(idea, "demand") === "met" ? "Proven" : met(idea, "demand") === "partial" ? "Early" : "Limited", state("demand"), "Market proof so far")}
        {tile("Capacity", met(idea, "capacity") === "met" ? "Feasible" : m["Capacity used"] || null, state("capacity"), "Can you deliver it")}
      </div>
    </div>
  );
}

function IdeaContextSide({ idea, onTab }) {
  const a = idea?.answers || {};
  const known = (idea?.inputs || []).filter((x) => x.available).length;
  const all = (idea?.inputs || []).length;
  return (
    <div className={`${BOX} p-5`} data-side="idea-context">
      <div className="flex items-center justify-between"><p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Idea Context</p><button type="button" className={LINK} onClick={() => onTab("assessment")}>Edit →</button></div>
      <dl className="mt-3 space-y-2 text-[13.5px]">
        <div className="flex justify-between gap-3"><dt className="text-slate-500">Service</dt><dd className="text-right text-slate-900 dark:text-slate-100">{a.description || "Not set"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-500">Target customer</dt><dd className="text-right text-slate-900 dark:text-slate-100">{a.customer || "Not set"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-500">Data status</dt><dd className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100"><span className={`h-2.5 w-2.5 rounded-full ${known === all && all ? "bg-emerald-500" : "bg-amber-500"}`} />{known === all && all ? "Available" : "Partially available"}</dd></div>
      </dl>
      <Info>I use your business data and market evidence to assess the idea. Nothing changes until you approve it.</Info>
    </div>
  );
}

// ── The side column ──────────────────────────────────────────────────────────

function WorkspaceCard({ ctx, onSheet }) {
  const b = ctx?.business || {};
  const rev = ctx?.revenue;
  const max = Math.max(1, ...(rev?.months || [0]));
  const Fact = ({ k, v }) => <div><p className="text-[12px] text-slate-500">{k}</p><p className="text-[14px] text-slate-900 dark:text-slate-100">{v || "Not set"}</p></div>;
  return (
    <div className={`${BOX} p-5`} data-side="workspace">
      <div className="flex items-center justify-between"><p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Business Workspace</p><button type="button" onClick={() => onSheet("profile")} className={LINK}>View profile →</button></div>
      <div className="mt-3 flex items-center gap-3">
        {b.logo ? <img src={b.logo} alt="" className="h-14 w-14 rounded-xl object-cover" />
          : <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-[20px] font-bold text-slate-600 dark:bg-slate-800">{(b.name || "?").slice(0, 1)}</span>}
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[16px] font-bold text-slate-900 dark:text-slate-50"><span className="truncate">{b.name}</span><span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11.5px] font-semibold text-emerald-700">Active</span></p>
          {b.stage && <p className="text-[13px] text-slate-500">{b.stage} stage</p>}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3"><Fact k="Sector" v={b.sector} /><Fact k="Location" v={b.location} /><Fact k="Founded" v={b.founded} /><Fact k="Employees" v={b.employees} /></div>
      {rev && (
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <p className="text-[12.5px] text-slate-500">Revenue, all time</p>
          <div className="flex items-end justify-between gap-3">
            <p className="text-[22px] font-bold tabular-nums text-slate-900 dark:text-slate-50">{money(rev.all_time ?? rev.total, rev.currency)}
              {rev.pct !== null && rev.pct !== undefined && <span className={`ml-2 text-[13px] font-semibold ${rev.pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{rev.pct >= 0 ? "↗ +" : "↘ "}{rev.pct}%</span>}</p>
            <div className="flex h-11 items-end gap-1" aria-hidden="true">{rev.months.map((m, i) => <span key={i} className="w-2 rounded-sm bg-blue-500" style={{ height: `${Math.max(6, (m / max) * 100)}%`, opacity: m ? 1 : 0.25 }} />)}</div>
          </div>
          {/* All time, said as such (the owner, 28 Oct); the bars are the last 12 months */}
          <p className="text-[12px] text-slate-500">{rev.has_any ? "Bars: the last 12 months" : "No payments recorded yet"}</p>
        </div>
      )}
    </div>
  );
}

function ScoreSide({ subject, score, words, onTab, before = null }) {
  const sm = subject.summary || {};
  const n = score === null || score === undefined ? null : pct(score);
  return (
    <div className={`${BOX} p-5`} data-side="score">
      <div className="flex items-center justify-between"><p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">{words.score}</p><button type="button" className={LINK} onClick={() => onTab("overview")}>View checklist →</button></div>
      <p className="mt-1 truncate text-[12.5px] text-slate-500">{subject.title}</p>
      <div className="mt-2 flex items-center gap-3">
        <p className="text-[30px] font-bold tabular-nums text-slate-900 dark:text-slate-50">{n ?? "?"}<span className="text-[16px] font-semibold text-slate-500">/100</span></p>
        {sm.classification && <span className={`rounded-md px-2 py-0.5 text-[12.5px] font-semibold ${sm.classification === "ready" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{sm.classification === "ready" ? words.ready : "Not ready yet"}</span>}
      </div>
      {n !== null && <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${BAR[tone(n)]}`} style={{ width: `${n}%` }} /></div>}
      {n === null && <p className="mt-1 text-[13px] text-slate-500">Not checked yet. Ask me, or run the check.</p>}
      {n !== null && before !== null && before !== n && (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800" data-score-before-after>
          <span><span className="block text-[12px] text-slate-500">Previous score</span><span className="text-[18px] font-bold text-slate-900 dark:text-slate-50">{before}/100</span></span>
          <span aria-hidden="true" className="text-slate-400">→</span>
          <span><span className="block text-[12px] text-slate-500">Current score</span><span className={`text-[18px] font-bold ${n > before ? "text-emerald-600" : "text-slate-900"}`}>{n}/100</span></span>
          <span className={`rounded-lg px-2.5 py-1 text-[13px] font-semibold ${n > before ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>{n > before ? "↑ +" : ""}{n - before}</span>
        </div>
      )}
    </div>
  );
}

/** The launch at a glance (idea-06's "Readiness Snapshot"): the plan's own fields and its readiness. */
function LaunchSnapshotSide({ subject, score, onSheet, currency }) {
  const d = subject.data || {};
  const n = score === null || score === undefined ? null : pct(score);
  const price = d.offer?.price ?? d.economics?.price_per_unit;
  const status = { draft: "Draft", ready: "Ready", launched: "Launched", paused: "Paused" }[subject.summary?.lifecycle_status] || "Draft";
  const Fact = ({ k, v }) => <div><p className="text-[12px] text-slate-500">{k}</p><p className="text-[14px] text-slate-900 dark:text-slate-100">{v || "Not set"}</p></div>;
  return (
    <div className={`${BOX} p-5`} data-side="launch-snapshot">
      <div className="flex items-center justify-between"><p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Readiness Snapshot</p><button type="button" className={LINK} onClick={() => onSheet("breakdown")}>View details →</button></div>
      <div className="mt-3 flex items-center gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-slate-800"><Glyph name="target" className="h-7 w-7" /></span>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[16px] font-bold text-slate-900 dark:text-slate-50"><span className="truncate">{d.name || subject.title}</span>
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11.5px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{status}</span></p>
          <p className="text-[13px] text-slate-500">Launch plan</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
        <Fact k="Target segment" v={d.customers?.target_segment || d.audience} /><Fact k="Price" v={price ? money(price, currency) : null} />
        <Fact k="Where" v={d.geography} /><Fact k="Target date" v={d.target_date ? new Date(d.target_date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null} />
      </div>
      <p className="mt-3 text-[12.5px] text-slate-500">Overall readiness</p>
      <div className="flex items-center gap-3">
        <p className="text-[28px] font-bold tabular-nums text-slate-900 dark:text-slate-50">{n === null ? "?" : `${n}%`}</p>
        {n !== null && <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${BAR[tone(n)]}`} style={{ width: `${n}%` }} /></div>}
      </div>
      {n === null && <p className="text-[13px] text-slate-500">Not checked yet. Ask me if you're ready to launch.</p>}
    </div>
  );
}

// One full stop where an older check wrote two ("is required.."); an ellipsis stays
const tidy = (t) => String(t || "").replace(/(?<!\.)\.\.(?!\.)/g, ".");

// What is left on a launch plan, said by who does it (the owner, 29 Oct: "the agent ask me the ones it needs from me and let
// me know it can do it"): what the Agent drafts, what only the owner has, and the one question it can save from the chat.
const AGENT_DRAFTS = { "C2.A": "the price, delivery terms and customer promise", "C2.B": "the price and costs", "C4.A": "your capacity and how long one order takes",
  "C4.B": "what the launch depends on", "C5.A": "how an order becomes a delivery and a payment", "C7.A": "the channel and launch message",
  "C7.B": "the channel's owner, budget and target", "C8.A": "the launch date and milestones", "C8.B": "the success measures, incident plan and review date",
  // fetched from Business Operations and the profile when they hold it (the owner, 29 Oct: "it can fetch these")
  "C1.A": "demand evidence from your sales and quotations", "C5.B": "a test run from a paid sale", "C6.B": "your registration as the permit to operate" };
// Only the owner's own word: never a field the Agent can draft or fetch (the owner, 29 Oct)
const OWNER_DOES = { "C1.B": "confirm you've reviewed the evidence", "C3.A": "confirm the cash forecast", "C3.B": "list your setup and running costs in the forecast",
  "C6.A": "confirm which permits apply" };
export function launchLeft(subject) {
  const open = (subject?.actions || []).filter((a) => a.status === "open");
  if (!open.length) return null;
  const losing = open.find((a) => /contribution of -/i.test(a.why || ""));
  const codes = new Set(open.flatMap((a) => [a.code, ...(a.also || [])]));
  if (losing) codes.add("C2.B");
  if (open.some((a) => a.criterion === "C6")) codes.add("C6.B");      // the permit's blocker counts as its check
  const mine = [...new Set(Object.entries(AGENT_DRAFTS).filter(([c]) => codes.has(c)).map(([, w]) => w))];
  const yours = [...new Set(Object.entries(OWNER_DOES).filter(([c]) => codes.has(c)).map(([, w]) => w))];
  const ask = losing ? `Right now each sale loses money: ${tidy(losing.why).replace(/\.$/, "")}. I'll draft a price and cost that work, or tell me your real cost.` : "";
  const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  // Always ends on the one next step (the owner, 30 Oct: "we are assuming the user is clueless about the next steps")
  const next = mine.length ? "Next step: press Draft the rest and I'll prepare them for you to approve."
    : yours.length ? `Next step: ${yours[0]}.` : "";
  const text = [mine.length ? `I can draft ${list(mine)} for you.` : "",
    yours.length ? `Only you can ${list(yours)}.` : "", ask, next].filter(Boolean).join(" ");
  return { text, prompts: mine.length ? [{ label: "Draft the rest", prompt: "Fill the rest for me" }] : [] };
}

/** What stands between the plan and a full launch (idea-06's "Why not fully launch yet?"): its open actions, most urgent first. */
function LaunchWhyNotSide({ subject, onSheet }) {
  const open = (subject.actions || []).filter((a) => a.status === "open");
  const shown = open.slice(0, 3);
  const blocking = new Set((subject.summary?.blockers || []).map((b) => b.code));
  return (
    <div className={`${BOX} p-5`} data-side="launch-why-not">
      <div className="flex items-center justify-between"><p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Why not fully launch yet?</p>
        {open.length > shown.length && <button type="button" className={LINK} onClick={() => onSheet("steps")}>View all →</button>}</div>
      {shown.length ? (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">{shown.map((a) => {
          const hard = blocking.has(a.code) || /required evidence is missing/i.test(a.priority_reason || "");
          return (
            <li key={a.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white ${hard ? "bg-rose-500" : "bg-amber-500"}`} aria-hidden="true">{hard ? "×" : "!"}</span>
              <span className="min-w-0"><span className="block text-[14px] font-semibold leading-snug text-slate-900 dark:text-slate-100">{tidy(a.why || a.title)}</span>
                <span className="block text-[13px] leading-snug text-slate-500">{tidy(a.title)}</span></span>
            </li>
          );
        })}</ul>
      ) : <p className="mt-2 text-[13px] text-slate-500">{subject.summary?.classification ? "Nothing open. The last check found nothing holding the launch back." : "Ask me if you're ready to launch and I'll check."}</p>}
    </div>
  );
}

/** The case's report, to download from Documents (funding-02's "Download results"). */
function DownloadSide({ onTab }) {
  return (
    <div className={`${BOX} p-5`} data-side="download">
      <p className="text-[17px] font-bold text-slate-900 dark:text-slate-50">Download results</p>
      <div className="mt-3 flex items-center gap-3">
        <span className="text-slate-600"><Glyph name="doc" className="h-8 w-8" /></span>
        <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold text-slate-900 dark:text-slate-100">Funding Readiness Report</span>
          <span className="text-[12.5px] text-slate-500">A summary of your check, findings and next steps.</span></span>
        <button type="button" onClick={() => onTab("documents")} className="shrink-0 rounded-lg border border-brand-600 px-3 py-2 text-[13px] font-semibold text-brand-700 hover:bg-brand-50">Open documents</button>
      </div>
    </div>
  );
}

/** While the research runs (the mockups' "Assessment context"): what is being assessed, for whom, where it stands. */
function ContextSide({ subject, ctx, score }) {
  const n = score === null || score === undefined ? null : pct(score);
  const Row = ({ icon, k, children }) => (
    <li className="flex items-center gap-3 py-2.5 text-[13.5px]"><span className="text-slate-500"><Glyph name={icon} className="h-[18px] w-[18px]" /></span>
      <span className="w-28 shrink-0 text-slate-500">{k}</span><span className="min-w-0 flex-1 text-slate-900 dark:text-slate-100">{children}</span></li>
  );
  return (
    <div className={`${BOX} p-5`} data-side="context">
      <p className="text-[17px] font-bold text-slate-900 dark:text-slate-50">Assessment context</p>
      <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
        <Row icon="target" k="Goal">{subject.title}</Row>
        <Row icon="doc" k="Active business">{ctx?.business?.name || "Your business"}</Row>
        <Row icon="bars" k="Current score">{n === null ? "Not checked yet" : (
          <span className="flex items-center gap-3"><span className="font-semibold">{n}/100</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><span className={`block h-full ${BAR[tone(n)]}`} style={{ width: `${n}%` }} /></span></span>)}</Row>
      </ul>
    </div>
  );
}
const DOT = { invoice_paid: "bg-emerald-500", customer_added: "bg-blue-500", research: "bg-violet-500", quote_sent: "bg-slate-400", invoice_sent: "bg-slate-400" };
const ACT = { invoice_paid: ["invoice", "bg-emerald-50 text-emerald-600"], customer_added: ["users", "bg-blue-50 text-blue-600"], research: ["sparkles", "bg-violet-50 text-violet-600"],
  quote_sent: ["doc", "bg-slate-100 text-slate-600"], invoice_sent: ["mail", "bg-slate-100 text-slate-600"] };
function ActivitySide({ ctx, onSheet }) {
  const items = ctx?.activity || [];
  return (
    <div className={`${BOX} p-5`} data-side="activity">
      <div className="flex items-center justify-between"><p className="text-[17px] font-bold text-slate-900 dark:text-slate-50">Recent activity</p>
        {items.length > 0 && <button type="button" className={LINK} onClick={() => onSheet("activity")}>View all →</button>}</div>
      {items.length ? (
        <ul className="mt-3 space-y-3">{items.map((a, i) => (
          <li key={`${a.kind}${a.at}${i}`} className="flex items-start gap-3">
            <span className={`mt-3 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[a.kind] || "bg-slate-400"}`} aria-hidden="true" />
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${(ACT[a.kind] || ACT.quote_sent)[1]}`}><Glyph name={(ACT[a.kind] || ACT.quote_sent)[0]} className="h-[18px] w-[18px]" /></span>
            <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold text-slate-800 dark:text-slate-100">{a.title}</span>{a.detail && <span className="block truncate text-[12.5px] text-slate-500">{a.detail}</span>}</span>
            <span className="shrink-0 text-[12px] text-slate-500">{ago(a.at)}</span>
          </li>
        ))}</ul>
      ) : <p className="mt-2 text-[13px] text-slate-500">Nothing yet. Invoices, customers and research show here as they happen.</p>}
    </div>
  );
}

function QuickSide({ onTab }) {
  const navigate = useNavigate();
  const Btn = ({ children, onClick, icon }) => <button type="button" onClick={onClick} className="flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 px-2.5 py-2.5 text-[13px] font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><Glyph name={icon} className="h-[18px] w-[18px]" />{children}</button>;
  return (
    <div className={`${BOX} p-5`} data-side="quick">
      <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Quick actions</p>
      <div className="mt-3 flex gap-2"><Btn icon="upload" onClick={() => onTab("evidence-add")}>Upload documents</Btn><Btn icon="plug" onClick={() => navigate("/integrations")}>Connect data</Btn></div>
    </div>
  );
}

// What another module was asked here before each page kept its own topic (the owner, 27 Oct: "remove the wrong-thread
// messages: the launch question in the funding chat and the launch score 0/100 reply in the idea chat"): such a question
// and the reply to it are left out of this page's conversation.
const TOPIC = { funding: /\b(fund(ing|ed)?|loan|grant|investor|invest(ment)?|raise|financ(e|ing))\b/i, launch: /\b(launch(ing|ed)?)\b/i, idea: /\b(idea|validat(e|ion))\b/i };
export function ownTopic(messages, feature) {
  const others = Object.keys(TOPIC).filter((k) => k !== feature);
  const foreign = (t) => others.some((k) => TOPIC[k].test(t)) && !TOPIC[feature]?.test(t);
  const out = [];
  let skipping = false;
  for (const m of messages || []) {
    const t = String(m?.content || "");
    if (m?.role === "user") { skipping = foreign(t); if (!skipping) out.push(m); continue; }
    if (skipping) continue;      // the reply to a question that belonged elsewhere
    // A launch score said in another module's chat: that sentence taken out, the rest of the reply kept
    const LAUNCH_SCORE = /\s*Your launch score is now \d+\/100[^.]*\./gi;
    out.push(feature !== "launch" && LAUNCH_SCORE.test(t) ? { ...m, content: t.replace(LAUNCH_SCORE, "").trim() } : m);
  }
  return out;
}

// ── The side column, the same on every tab (the owner's QA, 27 Oct: the Checklist and Documents tabs lost it) ──────────

/** The cards beside the case, and the sheets their "View …" links open. */
export function SideCards({ businessId, feature, subject, score, ctx, words = WORDS[feature] || WORDS.funding, onTab, send, lastChange = null, working = false, onIdeaForm = null }) {
  const [sheet, setSheet] = useState(null);      // a card's "View …", opened beside the page: profile, activity, breakdown or steps
  const closeSheet = useCallback(() => setSheet(null), []);
  return (
    <>
        {feature === "launch" ? <><LaunchSnapshotSide subject={subject} score={score} onSheet={setSheet} currency={ctx?.revenue?.currency} /><LaunchWhyNotSide subject={subject} onSheet={setSheet} /></> : <WorkspaceCard ctx={ctx} onSheet={setSheet} />}
        {feature === "idea" && <><SnapshotSide idea={ctx?.idea} /><IdeaContextSide idea={ctx?.idea} onTab={onTab} /></>}
        {/* Funding, as funding-01 to 08: the score always, its before and after once a check moved it, then the report */}
        {feature === "funding" && <>{working && <ContextSide subject={subject} ctx={ctx} score={score} />}<ScoreSide subject={subject} score={score} words={words} onTab={onTab} before={lastChange?.before ?? null} />
          {score !== null && score !== undefined && <DownloadSide onTab={onTab} />}</>}
        {feature !== "launch" && <ActivitySide ctx={ctx} onSheet={setSheet} />}
        {feature === "launch" ? (
          <div className={`${BOX} p-5`} data-side="quick">
            <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Quick actions</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => send("Help me publish this service on the Marketplace")} className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">Publish to marketplace</button>
              <button type="button" onClick={() => send("Create a test plan for this launch")} className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">Create test plan</button>
            </div>
          </div>
        ) : feature === "idea" ? (
          <div className={`${BOX} p-5`} data-side="quick">
            <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Quick actions</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => (onIdeaForm ? onIdeaForm() : onTab("assessment"))} className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">Add idea details</button>
              <button type="button" onClick={() => send("Research it for me")} className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">Run market research</button>
            </div>
          </div>
        ) : <QuickSide onTab={onTab} />}
      {sheet === "profile" && <ProfileSheet business={ctx?.business} businessId={businessId} onClose={closeSheet} />}
      {sheet === "activity" && <ActivitySheet businessId={businessId} first={ctx?.activity || []} onClose={closeSheet} />}
      {sheet === "breakdown" && <BreakdownSheet subject={subject} score={score} onClose={closeSheet} />}
      {sheet === "steps" && <StepsSheet subject={subject} title="Why not fully launch yet?" onClose={closeSheet} />}
    </>
  );
}

/** The side column on a tab without the conversation: the same cards, read on their own. */
export function CaseSide({ businessId, feature, subject, score, onTab, onSend }) {
  const [ctx, setCtx] = useState(null);
  useEffect(() => {
    let live = true;
    apiRequest(`/businesses/${businessId}/agent/assistant-context?kind=${feature}&case_id=${subject.id}`, "GET").then((c) => live && setCtx(c || {}), () => live && setCtx({}));
    return () => { live = false; };
  }, [businessId, feature, subject.id]);
  return (
    <aside className="hidden min-h-0 min-w-0 space-y-4 xl:block" aria-label="Your business" data-case-side>
      {ctx ? <SideCards businessId={businessId} feature={feature} subject={subject} score={score} ctx={ctx} onTab={onTab} send={onSend} />
        : [160, 120, 140].map((h, i) => <div key={i} className={`${BOX} animate-pulse`} style={{ height: h }} />)}
    </aside>
  );
}

// ── The tab ──────────────────────────────────────────────────────────────────

export default function CaseAssistant({ businessId, feature, subject, steps = [], score, checking = false, onTab, onChanged, onField = null, onResearch = null, researching = false,
  initialCtx = null, initialMessages = null, loading = false }) {
  const words = WORDS[feature] || WORDS.funding;
  const chatId = feature === "idea" ? "idea-check" : `case-${subject.id}`;
  // Handed in when the page already read them (the idea page reads both at once), so neither is asked for twice
  const [ctx, setCtx] = useState(initialCtx);
  const [messages, setMessages] = useState(() => (initialMessages ? ownTopic(initialMessages, feature) : null));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const end = useRef(null);
  const fresh = useRef(new Set());      // cards added in this visit animate; reopened ones are shown as they ended
  const [params, setParams] = useSearchParams();
  const reviewing = params.get("review") === "1";
  const setReviewing = (on) => { const p = new URLSearchParams(params); if (on) p.set("review", "1"); else p.delete("review"); setParams(p, { replace: true }); };
  const drafts = useMemo(() => waitingDrafts(subject), [subject]);
  const [edits, setEdits] = useState({});
  const [decided, setDecided] = useState([]);      // [{ kind, d, before }]: folded in the review, each with Undo
  // Every draft decided: the review closes by itself a moment later (time for an Undo), never "0 drafts waiting" left open
  const leftOpen = drafts.filter((d) => !decided.some((x) => x.d.path === d.path)).length;
  useEffect(() => {
    if (!reviewing || leftOpen > 0 || !decided.length) return undefined;
    const t = setTimeout(() => { setReviewing(false); setDecided([]); }, 4000);
    return () => clearTimeout(t);
  }, [reviewing, leftOpen, decided.length]);      // eslint-disable-line react-hooks/exhaustive-deps
  // The "drafts waiting" bar, put away for these drafts only: a new or changed draft brings it back
  const draftsKey = drafts.map((d) => d.path).sort().join("|");
  const hideKey = `ea_drafts_hidden:${subject.id}`;
  const [hiddenFor, setHiddenFor] = useState(() => { try { return localStorage.getItem(hideKey); } catch { return null; } });
  const hideDrafts = () => { setHiddenFor(draftsKey); try { localStorage.setItem(hideKey, draftsKey); } catch { /* hidden for this visit */ } };
  const firstField = useRef(null);
  const input = useRef(null);
  const adopted = useRef(null);      // { before, saw }: the drafts were approved, waiting for the check to finish
  const [ownResearch, setOwnResearch] = useState(false);
  const [details, setDetails] = useState(false);      // the side column as a sheet, below 1280px
  // What its buttons do, said here in this conversation (the owner, 27 Oct: "you're not supposed to give me a CTA to leave the chat")
  const act = useMemo(() => chatActions(businessId), [businessId]);
  const [editing, setEditing] = useState(null);
  const fileRef = useRef(null);
  const push = (...said) => setMessages((prev) => { const next = [...(prev || []), ...said]; saveChat(businessId, chatId, next).catch(() => {}); return next; });
  // What is left, said in the chat with its steps and buttons (the owner, 30 Oct: "for next action or clear the pendings"):
  // the drafts still waiting first, then the plan's own next steps
  const showNext = () => {
    const left = feature === "launch" ? launchLeft(subject) : null;
    const waitingNow = waitingDrafts(subject).length;
    const first = waitingNow ? `First, review the ${waitingNow} draft${waitingNow === 1 ? "" : "s"} still waiting: approving them clears them from your list and raises your score.` : "";
    push({ role: "assistant", at: new Date().toISOString(), cards: [{ type: "steps", case_id: subject.id }],
      prompts: [...(waitingNow ? [] : left?.prompts || [])],
      content: [first || "Here's what's left on your plan, most important first.", waitingNow ? "" : left?.text || ""].filter(Boolean).join(" ") });
    if (waitingNow) setReviewing(true);
  };
  const mine = (content) => ({ role: "user", content, at: new Date().toISOString() });
  const startEdit = (item) => {
    const it = { ...item, draft_id: item.draft_id || (() => { try { return new URLSearchParams(String(item.to || "").split("?")[1] || "").get("review"); } catch { return null; } })() };
    setEditing(it);
    push({ role: "assistant", at: new Date().toISOString(), content: `What would you like to change in ${it.title}? Tell me and I'll show you the updated draft before anything is sent.` });
  };
  const reviewItem = async (item) => {
    const it = { ...item, draft_id: item.draft_id || (() => { try { return new URLSearchParams(String(item.to || "").split("?")[1] || "").get("review"); } catch { return null; } })() };
    push(mine(`Show me ${it.title}`));
    try { push({ role: "assistant", at: new Date().toISOString(), content: "Here it is.", cards: [{ type: "preview", item: it, preview: await act.preview(it) }] }); }
    catch (e) { push({ role: "assistant", at: new Date().toISOString(), content: agentErrorMessage(e, "I couldn't open it just now.") }); }
  };
  const runScenario = async (kind, label) => { push(mine(label)); setBusy(true); try { push(await act.scenario(kind, { onWaiting: () => push(SLOW()) })); } finally { setBusy(false); } };
  const attachFile = async (file) => { if (!file) return; push(mine(`Attached ${file.name}`)); setBusy(true); try { push(await act.attach(file)); } finally { setBusy(false); loadCtx(); } };

  const loadCtx = useCallback(() => apiRequest(`/businesses/${businessId}/agent/assistant-context?kind=${feature}&case_id=${subject.id}`, "GET").then(setCtx, () => setCtx((c) => c || {})), [businessId, feature, subject.id]);
  const given = useRef({ ctx: Boolean(initialCtx), chat: Boolean(initialMessages) });
  useEffect(() => { if (loading) return; if (given.current.ctx) { given.current.ctx = false; return; } loadCtx(); }, [loadCtx, loading]);
  useEffect(() => {
    if (loading) return undefined;
    if (given.current.chat) {
      given.current.chat = false;
      const kept = initialMessages ? ownTopic(initialMessages, feature) : [];
      if (initialMessages && (kept.length !== initialMessages.length || kept.some((m, i) => m !== initialMessages[i]))) saveChat(businessId, chatId, ownTopic(initialMessages, feature)).catch(() => {});
      return undefined;
    }
    let live = true;
    getChat(businessId, chatId).then((c) => {
      if (!live) return;
      const all = c?.messages || [];
      const kept = ownTopic(all, feature);
      setMessages(kept);
      if (kept.length !== all.length || kept.some((m, i) => m !== all[i])) saveChat(businessId, chatId, kept).catch(() => {});      // put right once, for good
    }, () => live && setMessages([]));
    return () => { live = false; };
  }, [businessId, chatId]);
  // "Do all for me" working: checked again every few seconds until it ends, then the case is read again
  const waiting = Boolean(ctx?.working) || (messages || []).some((m) => (m.cards || []).some((c) => c.type === "progress")) && ctx?.research?.state !== "review" && ctx?.research?.state !== "adopted" && !ctx?.failed;
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(() => { loadCtx().then(() => onChanged?.()); }, 6000);
    return () => clearInterval(t);
  }, [waiting, loadCtx, onChanged]);
  // The newest message in view inside the conversation, never the whole page scrolled
  // Once the conversation is drawn too (it waits for the business), and again as its cards finish drawing (the owner, 28 Oct:
  // "why didn't it scroll to the latest chat, on coming here from the landing page")
  const drawn = !loading && messages !== null && ctx !== null;
  useEffect(() => {
    if (!drawn) return undefined;
    // The review, from its top (its first draft); otherwise the newest message
    const down = () => (reviewing && document.querySelector("[data-review-screen]")
      ? document.querySelector("[data-review-screen]").scrollIntoView?.({ block: "start" }) : end.current?.scrollIntoView?.({ block: "nearest" }));
    down();
    const later = [setTimeout(down, 250), setTimeout(down, 900)];
    return () => later.forEach(clearTimeout);
  }, [messages?.length, busy, drawn, reviewing]);      // the review opened: in view at once (the owner, 29 Oct)
  const handed = useRef(false);
  const startFresh = useRef(false);      // the next message begins a new conversation (a handed-over request)
  useEffect(() => {
    const said = params.get("message");      // its own handover, so the side panel never answers it too
    if (!said || messages === null || handed.current) return;
    handed.current = true;
    const p = new URLSearchParams(params);
    p.delete("message");
    setParams(p, { replace: true });
    // A new request handed over (from the landing page) starts a new conversation here; the one before is kept, never shown
    // under it (the owner, 29 Oct: "I just came from the landing page and landed on previous chats")
    if ((messages || []).length) {
      saveChat(businessId, `${chatId}-${Date.now().toString(36)}`, messages).catch(() => {});
      startFresh.current = true;
    }
    send(said);
  }, [messages]);      // eslint-disable-line react-hooks/exhaustive-deps
  // After Approve all: the check runs again by itself once the case is saved; its result is said in the conversation
  useEffect(() => {
    const a = adopted.current;
    if (!a) return undefined;
    if (checking) { a.saw = true; return undefined; }
    const finish = () => {
      if (adopted.current !== a) return;
      adopted.current = null;
      const after = score === null || score === undefined ? null : Math.round(score);
      const cards = [...(after !== null && a.before !== null && after !== a.before ? [{ type: "score_change", case_id: subject.id, before: a.before, after }] : []),
        { type: "next", case_id: subject.id }];      // approvals waiting only when asked for (the owner, 29 Oct)
      cards.forEach((c, i) => fresh.current.add(`${(messages || []).length}:${i}`));
      const left = feature === "launch" ? launchLeft(subject) : null;      // what's left, by who does it, and the next question
      keep([...(messages || []), { role: "assistant", at: new Date().toISOString(), cards: left ? [...cards.filter((c) => c.type !== "next"), { type: "steps", case_id: subject.id }] : cards,
        ...(left?.prompts?.length ? { prompts: left.prompts } : {}),
        content: (after === null ? "I've saved everything to your case. Run the check when you're ready to see your score." : `I've run your ${words.area} check again. You're at ${after}/100.`)
          + (left?.text ? ` ${left.text}` : "") }]);
    };
    if (a.saw) { finish(); return undefined; }
    const t = setTimeout(finish, 45000);      // never waiting for ever: said once the save is done
    return () => clearTimeout(t);
  }, [checking, score]);      // eslint-disable-line react-hooks/exhaustive-deps
  // One draft approved or rejected on its own: saved like Approve all, only that field, so the score moves for it alone
  const allDrafts = () => subject.data?.agent_drafts || {};
  const decideOne = (d, kind) => {
    if (!onField) return;
    const before = getPath(subject.data || {}, d.path);
    if (kind === "approved") {
      let v = d.path in edits ? edits[d.path] : d.draft.value;
      if (typeof d.draft.value === "number") v = Number(v) || d.draft.value;
      onField(d.path, v);
    } else onField("rejected_drafts", [...new Set([...(subject.data?.rejected_drafts || []), d.path])]);
    onField("agent_drafts", Object.fromEntries(Object.entries(allDrafts()).filter(([p]) => p !== d.path)));
    setDecided((x) => [...x.filter((y) => y.d.path !== d.path), { kind, d, before }]);
  };
  const undoOne = (path) => {
    const x = decided.find((y) => y.d.path === path);
    if (!x || !onField) return;
    if (x.kind === "approved") onField(path, x.before ?? null);
    else onField("rejected_drafts", (subject.data?.rejected_drafts || []).filter((p) => p !== path));
    onField("agent_drafts", { ...allDrafts(), [path]: x.d.draft });
    setDecided((all) => all.filter((y) => y.d.path !== path));
  };
  const approveAll = () => {
    const rest = drafts.filter((d) => !decided.some((x) => x.d.path === d.path));
    if (!onField || !rest.length) return;
    const n = rest.length;
    rest.forEach((d) => {
      let v = d.path in edits ? edits[d.path] : d.draft.value;
      if (typeof d.draft.value === "number") v = Number(v) || d.draft.value;
      onField(d.path, v);
    });
    const left = Object.fromEntries(Object.entries(subject.data?.agent_drafts || {}).filter(([p]) => !rest.some((d) => d.path === p) && !decided.some((x) => x.d.path === p)));
    onField("agent_drafts", left);
    adopted.current = { before: score === null || score === undefined ? null : Math.round(score), saw: false };
    keep([...(messages || []), { role: "user", content: "That looks right. Adopt it.", at: new Date().toISOString() },
      { role: "assistant", content: `Done. I've added ${n} draft${n === 1 ? "" : "s"} to your case and I'm running your ${words.area} check again…`, at: new Date().toISOString() }]);
    setEdits({});
    setDecided([]);
    setReviewing(false);
  };
  // The idea's research, started from its card in the conversation (its price was on the button): the progress card until
  // it is back, then its findings to review
  // Every finding still waiting, accepted or rejected at once through the review the findings use one by one; questions stay
  // for the owner to answer
  const decideAll = async (decision) => {
    const runId = ctx?.research?.run_id;
    if (!runId) return;
    try {
      const run = await apiRequest(`/businesses/${businessId}/research/${runId}`, "GET");
      const items = ((run?.research || run)?.items || []).filter((x) => x && x.id && x.kind !== "question" && !x.decision);
      if (!items.length) { push({ role: "assistant", at: new Date().toISOString(), content: "There's nothing left to decide in this research." }); return; }
      await apiRequest(`/businesses/${businessId}/research/${runId}/review`, "POST", { decisions: Object.fromEntries(items.map((x) => [x.id, { decision }])) });
      push({ role: "assistant", at: new Date().toISOString(), content: decision === "accept"
        ? `Accepted ${items.length} finding${items.length === 1 ? "" : "s"}. Your idea's result is worked out again from them.`
        : `Rejected ${items.length} finding${items.length === 1 ? "" : "s"}. Nothing was changed.` });
    } catch (e) {
      push({ role: "assistant", at: new Date().toISOString(), content: agentErrorMessage(e, "That couldn't be done just now. Nothing was changed.") });
    } finally { loadCtx(); onChanged?.(); }
  };
  const startResearch = async (opts = {}) => {
    if (!onResearch || ownResearch) return;
    const at = new Date().toISOString();
    const base = messages || [];
    const asked = { role: "user", content: "Go ahead.", at };
    fresh.current.add(`${base.length + 1}:0`);
    keep([...base, asked,
      { role: "assistant", at, content: "Understood. I'll research comparable services, competitor pricing and market demand, then show you what I find for your approval.", cards: [{ type: "progress", case_id: subject.id }] }]);
    setOwnResearch(true);
    try {
      const r = await onResearch(opts);
      if (r?.problem) setProblem(r.problem);
      if (r?.repeat) {
        // The earlier research, shown again in place of the progress card: never "didn't finish" beside "this is the research
        // from 28 Oct" (the owner, 28 Oct)
        const day = typeof r.repeat === "string" ? new Date(r.repeat).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "earlier";
        keep([...base, asked, { role: "assistant", at: new Date().toISOString(), content: `This is the research from ${day}: nothing it depends on has changed since, so I didn't search again and nothing was charged.`,
          cards: [{ type: "findings", case_id: "idea" }, { type: "research_again", case_id: "idea" }] }]);
      }
    } finally {
      setOwnResearch(false); loadCtx(); onChanged?.();
      try { window.dispatchEvent(new CustomEvent("ea:credits:refresh")); } catch { /* read on the next page */ }
    }
  };
  const removeAt = (i) => {
    const next = [...(messages || [])];
    next.splice(i, next[i + 1]?.role === "assistant" ? 2 : 1);
    keep(next);
  };
  const requestChanges = () => { setText("Please change "); setTimeout(() => input.current?.focus(), 30); };

  const keep = (next) => { setMessages(next); saveChat(businessId, chatId, next).catch(() => {}); };
  // A link to the case already open is no link (the owner, 27 Oct: "Open your funding case" inside the funding case)
  // Another tab of this case ("See the Launch Readiness form": its Checklist) is a tab switch, never hidden (the owner, 29 Oct:
  // "where's the launch readiness form that it's populating")
  const tabOf = (to) => { try { const t = new URLSearchParams(String(to || "").split("?")[1] || "").get("tab"); return t && t !== "assistant" ? t : null; } catch { return null; } };
  // A link to review the drafts is a step here, never hidden as "this page" (the owner, 30 Oct: no button after "Fill the rest")
  const opensReview = (to) => /[?&]review=1\b/.test(String(to || ""));
  const isHere = (to) => String(to || "").split("?")[0] === `/${feature === "launch" ? "launch" : "funding"}/${subject.id}` && !tabOf(to) && !opensReview(to);
  // Never a link to the case from inside it, saved replies included (the owner, 27 Oct: "remove 'Open your funding case' when already in the case")
  const stay = (links) => (links || []).filter((l) => !isHere(l.to) && !/^Open your (funding case|launch plan)$/i.test(l.label || ""));
  const send = async (said) => {
    const t = String(said || "").trim();
    if (!t || busy) return;
    // The conversation carries on: the review steps aside, never left in its way (the owner, 28 Oct: "why is the review
    // enrich card blocking my current chat"); the drafts still waiting keep their small bar
    if (reviewing) { setReviewing(false); setDecided([]); }
    if (editing) {
      const item = editing;
      setEditing(null);
      setText("");
      push(mine(t));
      setBusy(true);
      try { push(await act.revise(item, t)); } finally { setBusy(false); loadCtx(); }
      return;
    }
    if (/\b(?:find|explore|research|look for|show me)\b.{0,20}\b(?:new )?customer segments?\b/i.test(t)) {      // typed, as its button does
      setText("");
      push({ role: "user", content: t, at: new Date().toISOString() }, { role: "assistant", at: new Date().toISOString(), content: "I can research new customer segments for you.", cards: [{ type: "segments" }] });
      return;
    }
    const mine = { role: "user", content: t, at: new Date().toISOString() };
    const before = [...(startFresh.current ? [] : messages || []), mine];
    startFresh.current = false;
    setMessages(before);
    setText("");
    setBusy(true);
    setProblem("");
    try {
      const res = await submitAgentRequest({ businessId, text: t, page: feature === "idea" ? "idea" : feature === "launch" ? "launch" : "funding",
        ...(feature === "launch" && subject.id !== "launch-home" ? { caseId: subject.id } : {}) });
      if (res?.elsewhere) {
        // Another module's: taken to its own page and conversation, never kept in this thread (the owner, 27 Oct)
        setMessages(messages || []);
        navigate(`${res.elsewhere}${res.elsewhere.includes("?") ? "&" : "?"}message=${encodeURIComponent(t)}`);
        return;
      }
      const acts = res?.actions || [];
      const reply = { role: "assistant", content: replyText(res) || "Done.", at: new Date().toISOString(),
        links: acts.filter((a) => a.to && !isHere(a.to)).map((a) => ({ label: a.label, to: a.to })), prompts: acts.filter((a) => a.prompt).map((a) => ({ label: a.label, prompt: a.prompt })),
        // A result keeps the score it was said with: a later check never rewrites what was said (the owner, 28 Oct)
        cards: (res?.cards || []).filter((c) => !c.case_id || String(c.case_id) === String(subject.id)).map((c) => (c.type === "result" && typeof score === "number" && c.score === undefined ? { ...c, score: Math.round(score) } : c)) };
      if (subject.id === "launch-home" && res?.case_id) {
        // The launch it is about is known now: the conversation goes on on that plan's own page, its thread kept whole
        const there = `case-${res.case_id}`;
        const had = await getChat(businessId, there).then((c) => c?.messages || [], () => []);
        await saveChat(businessId, there, [...had, ...before, { ...reply, cards: res.cards || [] }]).catch(() => {});
        keep([]);
        navigate(`/launch/${res.case_id}?tab=assistant`);
        return;
      }
      reply.cards.forEach((c, i) => fresh.current.add(`${before.length}:${i}`));
      keep([...before, reply]);
      // Read again after every turn (the owner, 27 Oct: the idea's inputs and score stayed "Not found" until a reload): what
      // the Agent saved shows at once in the cards, the snapshot and the score
      onChanged?.();
      loadCtx();
      try { window.dispatchEvent(new CustomEvent("ea:credits:refresh")); } catch { /* the balance is read on the next page */ }      // a research start uses credits
    } catch (e) {
      setProblem(agentErrorMessage(e));
      keep(before);
    } finally {
      setBusy(false);
    }
  };
  const navigate = useNavigate();
  const records = ctx?.records || [];
  const card = (c, key, live, last = false) => {
    const idea = ctx?.idea;
    if (c.type === "change") return <ChangeCard key={key} card={c} live={last} busy={busy} onApply={() => send("Apply")} onCancel={() => send("Cancel")} />;
    if (c.type === "research_again") return <ResearchAgainCard key={key} businessId={businessId} answers={idea?.answers || {}} busy={busy || ownResearch} onStart={() => startResearch({ fresh: true })} />;
    if (c.type === "idea_form") return <IdeaFormCard key={key} businessId={businessId} idea={idea} currency={ctx?.revenue?.currency || idea?.currency}
      say={(line) => push({ role: "assistant", at: new Date().toISOString(), content: line })} onSaved={() => { loadCtx(); onChanged?.(); }} />;
    if (c.type === "idea_inputs") return (idea?.inputs || []).length ? <RecordsCard key={key} records={idea.inputs} live={live} words={words} title={["Reviewing service idea inputs", "Service idea inputs reviewed"]} /> : null;
    if (c.type === "viability") return <ViabilityCard key={key} idea={idea} score={score} />;
    if (c.type === "launch_fit") return <LaunchFitCard key={key} idea={idea} onMarket={() => send("Help me publish this service on the Marketplace")} />;
    if (c.type === "risk") return <RiskCard key={key} risk={ctx?.risk} onScenario={runScenario}
      onSegments={() => push(mine("Find new customer segments"), { role: "assistant", at: new Date().toISOString(), content: "I can research new customer segments for you.", cards: [{ type: "segments" }] })} />;
    if (c.type === "scenario") return <ScenarioCard key={key} card={c} />;
    if (c.type === "preview") return <PreviewCard key={key} businessId={businessId} item={c.item} preview={c.preview} go={navigate} onEdit={startEdit}
      onDone={(m) => { sayDone(m); loadCtx(); }} />;
    if (c.type === "segments") return <SegmentsCard key={key} businessId={businessId} onDone={(m) => push({ role: "assistant", at: new Date().toISOString(), content: m })} onChanges={() => setText("For the customer segments, please change ")} />;
    if (c.type === "choose" && feature === "idea") return <IdeaChooseCard key={key} reuse={Boolean(c.reuse)} price={c.price || ctx?.research?.max} busy={busy || researching || ownResearch} onStart={startResearch} onSelf={() => openIdeaForm("I'll enter it myself")} />;      // in the chat, never another tab (the owner, 29 Oct)
    if (c.type === "next" && feature === "idea") return <IdeaNextCard key={key} businessId={businessId} idea={idea} send={send} onTab={onTab} />;
    if (c.type === "records") return records.length ? <RecordsCard key={key} records={records} live={live} words={words} /> : null;
    if (c.type === "result") return <ResultCard key={key} subject={subject} steps={steps} records={records} words={words} score={typeof c.score === "number" ? c.score : score} onOpen={(k) => send(`What's needed for ${(subject.sections || []).find((x) => x.key === k)?.title || "this"}?`)} />;
    if (c.type === "choose") return <ChooseCard key={key} subject={subject} steps={steps} price={c.price} reuse={Boolean(c.reuse)} options={Boolean(c.options)} topics={c.topics || []} fixed={Boolean(c.fixed)} busy={busy} onHelp={() => send("Yes, start")} onSelf={() => onTab("answers")} />;
    if (c.type === "progress") return <ProgressCard key={key} options={Boolean(c.options)} onDecideAll={feature === "idea" ? decideAll : null}
      onResults={feature === "idea" ? () => send("Run the idea validation and fill the form") : null}
      onNext={feature === "idea" ? null : showNext} subject={subject} steps={steps} ctx={researching || ownResearch ? { ...ctx, working: true } : ctx} words={words} onReview={() => (drafts.length ? setReviewing(true)
        // The findings in the chat, for review, never another tab (the owner, 28 Oct: "Review findings" opened the Assessment tab)
        : push({ role: "assistant", at: new Date().toISOString(), content: "Here's what the research found. Accept, edit or reject each finding.", cards: [{ type: "findings" }] }))}
      onRetry={() => send("Help me complete it")} justStarted={live} drafts={drafts.length} />;
    // What is left on the plan, as the Checklist lists it, each with its own button, in the chat (the owner, 30 Oct:
    // "recommend these on the chat, lay users don't even know")
    if (c.type === "steps") return (
      <div key={key} className={`${BOX} p-5`} data-card="steps">
        <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Your next steps</p>
        <div className="mt-3"><ActionsPanel businessId={businessId} feature={feature} subject={subject} onChanged={() => { loadCtx(); onChanged?.(); }}
          onOpenSection={(section) => onTab?.("answers", section)} limit={3} /></div>
        {(subject.actions || []).filter((a) => a.status === "open").length > 3 && (
          <button type="button" onClick={() => onTab?.("overview")} className={`mt-3 ${LINK}`}>See all on the Checklist →</button>)}
      </div>
    );
    if (c.type === "findings") return <div key={key} className={`${BOX} p-4`} data-card="findings"><SavedResearch businessId={businessId} goal={feature === "idea" ? "test_idea" : feature === "launch" ? "launch" : "need_funding"} /></div>;
    if (c.type === "approvals") return <ApprovalsCard key={key} ctx={ctx} onDone={loadCtx} onReview={reviewItem} onEdit={startEdit} />;
    if (c.type === "score_change") return <ScoreChangeCard key={key} subject={subject} steps={steps} before={c.before} after={c.after} words={words} />;
    if (c.type === "next") return (<div key={key} className="space-y-3">
      {subject.summary?.classification === "ready" && feature !== "idea" && <ReadyCard subject={subject} score={score} words={words} />}
      <NextCard feature={feature} ctx={ctx} onTab={onTab} send={send} score={score} name={subject.data?.name || subject.title} /></div>);
    return null;
  };
  const ready = !loading && messages !== null && ctx !== null;
  const list = ready ? messages : [];
  // The score beside the conversation once the conversation has given it (the mockups: not while the records are checked)
  const seen = (...types) => list.some((m) => (m.cards || []).some((c) => types.includes(c.type)));
  // A review block is drawn once, at its newest: asking again never stacks copies in the chat (the owner, 28 Oct)
  const newest = {};
  list.forEach((m, i) => (m.cards || []).forEach((c) => { if (ONCE.has(c.type)) newest[c.type] = i; }));
  // The drafts block sits above the newest offer or progress, never hiding it below (the owner, 28 Oct); else at the foot
  const lastAt = list.length - 1;
  const offered = lastAt >= 0 && list[lastAt].role !== "user" && (list[lastAt].cards || []).some((c) => c.type === "choose" || c.type === "progress");
  const cut = offered && !reviewing ? (lastAt > 0 && list[lastAt - 1].role === "user" ? lastAt - 1 : lastAt) : -1;
  const reviewBlock = (
    <>
      {reviewing && (drafts.length > 0 || decided.length > 0) && onField && (
        <ReviewScreen drafts={drafts} edits={edits} setEdits={setEdits} onApproveAll={approveAll} onRequest={requestChanges} busy={busy} firstField={firstField}
          currency={subject.data?.currency || ctx?.revenue?.currency} target={subject.data?.target_amount}
          decided={decided} onDecide={decideOne} onUndo={undoOne} />
      )}
      {!reviewing && drafts.length > 0 && onField && hiddenFor !== draftsKey && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-[13.5px] text-brand-900 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-100" data-drafts-waiting>
          <span className="min-w-0 flex-1">{drafts.length} draft{drafts.length === 1 ? " is" : "s are"} waiting for your review. Nothing counts until you approve.</span>
          <span className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => setReviewing(true)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700">Review them</button>
            {/* Put away until the drafts change; they stay waiting (the owner, 28 Oct: "there should be a way to remove this") */}
            <button type="button" aria-label="Hide this" title="Hide until the drafts change" onClick={hideDrafts} className="rounded-lg p-1.5 text-brand-700 hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-brand-900/40" data-drafts-hide>
              <span aria-hidden="true" className="block text-[18px] leading-none">×</span>
            </button>
          </span>
        </div>
      )}
    </>
  );
  const scoreShown = seen("score_change", "next", "approvals", "change");
  const lastChange = [...list].reverse().flatMap((m) => m.cards || []).find((c) => c.type === "score_change") || null;
  const working = !scoreShown && (seen("progress") || Boolean(ctx?.working)) && ctx?.research?.state !== "review";
  const me = (useAuthStore.getState().name || useAuthStore.getState().email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  // The last reply's buttons, but never Apply and Cancel twice: a change card has its own
  const lastPrompts = useMemo(() => {
    const m = [...list].reverse().find((x) => x.role === "assistant");
    const own = (m?.cards || []).some((c) => c.type === "change");
    return (m?.prompts || []).filter((p) => !own || !["Apply", "Cancel"].includes(p.label));
  }, [list]);

  // As tall as the screen allows, the messages scrolling inside it, so the box to type in is always in view (the owner,
  // 27 Oct: "the typing box, action is not in view"); on a wide screen it stays put while the side column scrolls
  const conversation = (
      <section aria-label="Conversation" className={`${BOX} flex h-full min-h-0 min-w-0 flex-col`}>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
          {!ready && (
            // Nothing is shown until the business and the conversation are both read: never a result that then changes
            <div className="space-y-4" aria-label="Loading your conversation" data-assistant-loading>
              {[72, 56, 88].map((w, i) => (
                <div key={i} className="flex items-start gap-3"><span className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
                  <span className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" style={{ width: `${w}%` }} /></div>
              ))}
            </div>
          )}
          {ready && !list.length && (
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-brand-950/40"><Spark /></span>
              <div>
                <p className="rounded-2xl bg-slate-100 px-4 py-3 text-[14.5px] text-slate-800 dark:bg-slate-800 dark:text-slate-100">Tell me what you need, or ask me where your {words.area} stands. I'll start with what I already know about your business.</p>
                <div className="mt-2 flex flex-wrap gap-2">{words.start.map((s) => <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-slate-200 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:border-brand-400 hover:text-brand-700 dark:border-slate-700 dark:text-slate-200">{s}</button>)}</div>
              </div>
            </div>
          )}
          {list.map((m, i) => <Fragment key={i}>{i === cut && reviewBlock}{m.role === "user" ? (
            <div className="group flex flex-col items-end">
              <div className="flex max-w-full items-start justify-end gap-3">
                <p className="max-w-[80%] rounded-2xl bg-blue-50 px-4 py-3 text-[15px] text-slate-900 dark:bg-brand-950/50 dark:text-slate-50">{m.content}</p>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[13px] font-semibold text-white" aria-hidden="true">{me}</span>
              </div>
              <span className="mr-[3.25rem] mt-1 flex items-center gap-2 text-[11.5px] text-slate-500">
                {m.at && clock(m.at)}
                {/* A message that doesn't belong here goes, with its reply (the owner, 27 Oct: a launch question in the funding chat) */}
                <button type="button" onClick={() => removeAt(i)} className="font-semibold text-slate-400 hover:text-rose-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100" data-remove-message>Remove</button>
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-brand-950/40"><Spark /></span>
                <div className="min-w-0">
                  <p className="whitespace-pre-line rounded-2xl bg-slate-100 px-4 py-3 text-[15px] text-slate-800 dark:bg-slate-800 dark:text-slate-100">{m.content}</p>
                  {m.at && <span className="mt-1 block text-[11.5px] text-slate-500">{clock(m.at)}</span>}
                  {stay(m.links).length > 0 && <div className="mt-2 flex flex-wrap gap-2">{stay(m.links).map((l) => <button key={l.label + l.to} type="button" onClick={() => { const sameCase = String(l.to || "").split("?")[0] === `/${feature === "launch" ? "launch" : "funding"}/${subject.id}`; if (sameCase && opensReview(l.to)) setReviewing(true); else if (sameCase && tabOf(l.to) && onTab) onTab(tabOf(l.to)); else { noteCameFrom(null, l.to); navigate(l.to); } }} className="rounded-lg border border-brand-600 px-3 py-1.5 text-[13px] font-semibold text-brand-700 hover:bg-brand-50">{l.label}</button>)}</div>}
                </div>
              </div>
              {(m.cards || []).map((c, j) => (ONCE.has(c.type) && newest[c.type] !== i ? null
                : <div key={j} className="md:pl-[3.25rem]">{card(c, `${i}:${j}`, fresh.current.has(`${i}:${j}`), i === list.length - 1)}</div>))}
            </div>
          )}</Fragment>)}
          {busy && <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50"><Spark /></span><span className="inline-flex items-center gap-2 text-[13px] text-slate-500"><Spinner />Thinking…</span></div>}
          {problem && <p role="alert" className="text-[13px] font-semibold text-rose-600">{problem}</p>}
          {cut < 0 && reviewBlock}
          <div ref={end} />
        </div>
        <div className="flex shrink-0 items-center gap-2 px-5 pb-2 empty:hidden">
          <button type="button" onClick={() => setDetails(true)} data-details-button
            className="shrink-0 rounded-full border border-slate-200 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 xl:hidden dark:border-slate-700 dark:text-slate-200">Details</button>
          {lastPrompts.length > 0 && !busy && (
          <div className="no-scrollbar flex min-w-0 gap-2 overflow-x-auto sm:flex-wrap">{lastPrompts.map((p) => <button key={p.label} type="button" onClick={() => send(p.prompt)} className="shrink-0 whitespace-nowrap rounded-full border border-brand-300 px-3 py-1.5 text-[13px] font-semibold text-brand-700 hover:bg-brand-50">{p.label}</button>)}</div>
          )}
        </div>
        <form className="m-4 mt-1 flex shrink-0 items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 dark:border-slate-700" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void attachFile(f); }} data-chat-file />
          <button type="button" aria-label="Upload documents" onClick={() => fileRef.current?.click()} className="p-1 text-slate-500 hover:text-slate-800">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.5l-8.5 8.5a6 6 0 01-8.5-8.5l9-9a4 4 0 015.7 5.7l-9 9a2 2 0 01-2.8-2.8l8.3-8.3" /></svg>
          </button>
          <label className="sr-only" htmlFor="case-assistant-input">Message</label>
          <input ref={input} id="case-assistant-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={editing ? `What should change in ${editing.title}?` : "Ask EnterprateAI anything…"} maxLength={2000}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100" />
          <button type="submit" aria-label="Send" disabled={busy || !text.trim()} className="rounded-xl bg-brand-600 p-2 text-white hover:bg-brand-700 disabled:bg-brand-200">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M3 20l18-8L3 4v6l12 2-12 2z" /></svg>
          </button>
        </form>
      </section>
  );

  const openIdeaForm = (said = "Add idea details") => { push(mine(said), { role: "assistant", at: new Date().toISOString(), content: "Here's what I have for your idea. Change what's wrong or missing, then save.", cards: [{ type: "idea_form", case_id: "idea" }] }); };
  const side = <SideCards businessId={businessId} feature={feature} subject={subject} score={score} ctx={ctx} words={words} onTab={onTab} send={send} lastChange={lastChange} working={working}
    onIdeaForm={feature === "idea" ? openIdeaForm : null} />;
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]" data-case-assistant>
      {conversation}
      <aside className="hidden min-h-0 min-w-0 space-y-4 overflow-y-auto pr-0.5 xl:block" aria-label="Your business">
        {ctx && !loading ? side : [160, 120, 140].map((h, i) => <div key={i} className={`${BOX} animate-pulse`} style={{ height: h }} />)}</aside>
      {details && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-900/40 xl:hidden" role="dialog" aria-modal="true" aria-label="Details"
          onClick={(e) => { if (e.target === e.currentTarget) setDetails(false); }} data-details-sheet>
          <div className="flex max-h-[85dvh] flex-col rounded-t-2xl bg-white p-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] dark:bg-slate-900">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Details</p>
              <button type="button" onClick={() => setDetails(false)} aria-label="Close details" className="rounded-lg p-2 text-slate-500 hover:bg-slate-50">✕</button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">{side}</div>
          </div>
        </div>
      )}
    </div>
  );
}


