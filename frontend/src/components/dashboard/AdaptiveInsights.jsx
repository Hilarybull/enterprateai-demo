import { compactFigure } from "../../lib/figures";
import { SkeletonCard } from "../Skeleton";
import { arrangeInsights } from "../../lib/dashboardLayout";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, OUT_OF_CREDITS_TIP, OutOfCreditsNote } from "../agent/AgentBits";
import { PATHWAY_LABEL, PRIORITY_LABEL, STAGE_LABEL } from "../../lib/dashboard";
import { shortDate } from "../../lib/format";

// The dashboard's priority cards (PRD-AD-001 s10): at most five, most important first.
// Each card states where it stands (available, needs data, may be out of date) and can
// answer "Why am I seeing this?" from the evidence the server composed it from.

const TONE = {
  brand: { card: "border-blue-100 bg-blue-50/60", icon: "bg-blue-100 text-blue-600", title: "text-blue-700", name: "bulb", primary: true },
  rose: { card: "border-rose-200 bg-rose-50", icon: "bg-rose-100 text-rose-600", title: "text-rose-700", name: "alert" },
  amber: { card: "border-amber-200 bg-amber-50", icon: "bg-amber-100 text-amber-700", title: "text-amber-800", name: "doc" },
  indigo: { card: "border-indigo-100 bg-indigo-50/60", icon: "bg-indigo-100 text-indigo-600", title: "text-indigo-700", name: "bars" },
  emerald: { card: "border-emerald-200 bg-emerald-50", icon: "bg-emerald-100 text-emerald-600", title: "text-emerald-700", name: "cash" },
};
// A card with nothing to measure is neutral: it reports a gap, not a risk.
const NEUTRAL = { card: "border-slate-200 bg-slate-50", icon: "bg-slate-100 text-slate-500", title: "text-slate-700" };

// The cards always fill their rows: no empty slot at the end of the last one.
//   5 cards: one column, then 2+2+1 (the last full width), then 3+2 sharing the width, then five across.
//   3 cards: one column, then 2+1 (the last full width), then three across.
const gridFor = (n) => (n >= 5 ? "sm:grid-cols-2 lg:grid-cols-6 2xl:grid-cols-5" : n === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : n === 1 ? "" : n === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-4");
function spanFor(n, i) {
  if (n >= 5) return `${i === n - 1 && n % 2 ? "sm:col-span-2" : ""} ${i < 3 ? "lg:col-span-2" : "lg:col-span-3"} 2xl:col-span-1`;
  if (n === 3) return i === 2 ? "sm:col-span-2 lg:col-span-1" : "";
  return "";
}
// From 640 to 1023px the third of three cards spans both columns.
const wideFor = (n, i) => n === 3 && i === 2;

const HEADLINE_TONE = { emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200", amber: "bg-amber-50 text-amber-700 ring-amber-200", rose: "bg-rose-50 text-rose-700 ring-rose-200" };

/** The context the page is composed for: business stage with its headline metric, freshness,
 *  and the user's current goal. The stage comes from the records; "Not right? Change it" lets
 *  the user set it (it changes what the dashboard shows, not the business). */
export function DashboardContext({ context, saving, onGoal, onStage, freshness, refreshing, onRefresh }) {
  const [changing, setChanging] = useState(false);
  if (!context) return null;
  const at = freshness?.generated_at ? new Date(freshness.generated_at) : null;
  const updated = at && !Number.isNaN(at.getTime()) ? at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null;
  const headline = context.headline;
  const stageLabel = context.stage_label || STAGE_LABEL[context.business_stage] || context.business_stage;
  const manual = context.stage_source === "manual";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]" aria-label="Dashboard context">
        <span className="rounded-full bg-indigo-50 px-3 py-1 font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
          title={(context.stage_signals || []).join(" · ") || undefined}>
          {stageLabel} stage
        </span>
        {context.preview && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">Preview</span>}
        {headline && (
          <span className={`rounded-full px-3 py-1 font-semibold ring-1 ${headline.state === "available" ? (HEADLINE_TONE[headline.tone] || "bg-slate-50 text-slate-700 ring-slate-200") : "bg-slate-50 text-slate-500 ring-slate-200"}`}>
            {headline.label}: {headline.value}
          </span>
        )}
        {onStage && context.can_change_stage && !context.preview && (changing ? (
          <label className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            Business stage
            <select autoFocus value={manual ? context.business_stage : ""} disabled={saving}
              onChange={(e) => { setChanging(false); onStage(e.target.value || null); }} onBlur={() => setChanging(false)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <option value="">Detect from my records{context.detected_stage ? ` (${STAGE_LABEL[context.detected_stage] || context.detected_stage})` : ""}</option>
              {(context.stages || []).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        ) : (
          <button type="button" onClick={() => setChanging(true)} className="font-semibold text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400">
            {manual ? "Set by you. Change it" : "Not right? Change it"}
          </button>
        ))}
        {updated && (
          <span className="text-slate-500 dark:text-slate-400" aria-live="polite">
            {refreshing ? "Updating…" : `Updated ${updated}`}
            {onRefresh && <> · <button type="button" onClick={onRefresh} disabled={refreshing} className="font-semibold text-brand-600 underline-offset-2 hover:underline disabled:opacity-60">Refresh</button></>}
          </span>
        )}
        <label className="ml-auto flex items-center gap-2 text-slate-500 dark:text-slate-400">
          Current goal
          <select value={context.current_goal || ""} disabled={saving} onChange={(e) => onGoal(e.target.value || null)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <option value="">No goal set</option>
            {(context.goals || []).map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </label>
      </div>
      {context.transition && (
        <p role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-[13px] text-indigo-900 dark:border-indigo-900/50 dark:bg-indigo-900/20 dark:text-indigo-200">
          {context.transition.message}
        </p>
      )}
    </div>
  );
}

// The dashboard's skeleton is one of the shared loading states.
export { DashboardSkeleton } from "../Skeleton";

/** A KPI the server composed with its own value (no client trend line). */
export function ValueTile({ kpi, onOpen, wide }) {
  const missing = kpi.value === null || kpi.value === undefined || kpi.value === "" || kpi.state === "insufficient_data";
  const tone = { emerald: "text-emerald-700", amber: "text-amber-700", rose: "text-rose-700" }[kpi.tone] || "text-slate-950 dark:text-slate-100";
  const words = String(kpi.value ?? "").length > 10;      // a result in words ("Not enough evidence yet"), not a figure
  return (
    <div className={`flex min-w-0 flex-col rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${wide ? "min-[380px]:col-span-2 xl:col-span-1" : ""}`}>
      <div className="text-[15px] font-medium text-slate-500">{kpi.label}</div>
      {missing ? (
        <>
          <div className="mt-1 text-[22px] font-bold leading-tight text-slate-300 dark:text-slate-600" aria-label="No value yet">—</div>
          <p className="mt-2 text-[12px] leading-snug text-slate-500">
            {kpi.hint}{kpi.to && <>. <button type="button" onClick={() => onOpen(kpi)} className="font-semibold text-brand-600 underline-offset-2 hover:underline">Add it</button></>}
          </p>
        </>
      ) : (
        <>
          <div data-kpi-value title={String(kpi.value)} aria-label={String(kpi.value)} role="text" className={`mt-1 font-bold tabular-nums leading-tight tracking-tight ${words ? "break-words text-[19px]" : "whitespace-nowrap"} ${tone}`}
            style={words ? undefined : { fontSize: "clamp(1.25rem, 2.2vw, 1.75rem)" }}>{words ? kpi.value : compactFigure(kpi.value)}</div>
          {kpi.hint && <p className="mt-2 text-[12px] leading-snug text-slate-500">{kpi.hint}{kpi.state === "stale" ? " · out of date" : ""}</p>}
        </>
      )}
    </div>
  );
}

/** The setup checklist: the basics on record for the business. It is not the Launch Readiness
 *  result, so it shows a count and no percentage; its last row opens the launch check. */
export function LaunchReadiness({ readiness, onOpen, check }) {
  if (!readiness) return null;
  return (
    <div aria-label="Setup checklist">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Setup checklist: {readiness.done} of {readiness.total} in place</p>
      <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
        {readiness.items.map((item) => (
          <li key={item.key} className="flex items-center gap-3 py-2 text-sm">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${item.done ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`} aria-hidden="true">{item.done ? "✓" : "!"}</span>
            <span className="min-w-0 flex-1 text-slate-700 dark:text-slate-200">{item.label}</span>
            {item.done ? <span className="text-[12px] text-slate-400">Done</span>
              : <button type="button" onClick={() => onOpen(item)} aria-label={`Add: ${item.label}`} className="text-[12px] font-semibold text-brand-600 underline-offset-2 hover:underline">Add</button>}
          </li>
        ))}
        {check && (
          <li className="flex items-center gap-3 py-2 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700" aria-hidden="true">→</span>
            <span className="min-w-0 flex-1 text-slate-700 dark:text-slate-200">Launch Readiness looks at evidence, cash and blockers for the launch itself.</span>
            <button type="button" onClick={() => onOpen({ to: check.to })} className="text-[12px] font-semibold text-brand-600 underline-offset-2 hover:underline">{check.label}</button>
          </li>
        )}
      </ul>
    </div>
  );
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Dates written as 2026-09-26 (with or without a time) read as "26 Sep 2026". */
export function readableDates(text) {
  return String(text ?? "").replace(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?: UTC)?/g,
    (all, y, m, d) => (Number(m) >= 1 && Number(m) <= 12 ? `${Number(d)} ${SHORT_MONTHS[Number(m) - 1]} ${y}` : all));
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const SHEET_BELOW = 640;

/** "Why am I seeing this?": a popover anchored to its link, or a bottom sheet under 640px.
 *  It floats above the page, so the card it belongs to never changes height. */
function WhyPopover({ id, card, anchor, onClose, canHide, onHide }) {
  const why = card.why || {};
  const box = useRef(null);
  const [sheet, setSheet] = useState(() => window.innerWidth < SHEET_BELOW);
  const [place, setPlace] = useState(null);

  useLayoutEffect(() => {
    function position() {
      const small = window.innerWidth < SHEET_BELOW;
      setSheet(small);
      if (small || !anchor.current || !box.current) return;
      const a = anchor.current.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 16);
      const height = box.current.offsetHeight;
      const left = Math.max(8, Math.min(a.right - width, window.innerWidth - width - 8));
      const below = a.bottom + 8;
      const top = below + height > window.innerHeight - 8 && a.top - 8 - height > 8 ? a.top - 8 - height : below;      // above the link when there is no room below
      setPlace({ left, top, width });
    }
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [anchor]);

  useEffect(() => {
    const link = anchor.current;
    box.current?.querySelector("[data-close]")?.focus();
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll(FOCUSABLE)];      // focus stays inside while it is open
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!box.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
    function onDown(e) {
      if (box.current?.contains(e.target) || link?.contains(e.target)) return;
      onClose();
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
      link?.focus?.();      // focus goes back to the link that opened it
    };
  }, [anchor, onClose]);

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p id={`${id}-title`} className="text-[13px] font-bold text-slate-900 dark:text-slate-100">Why am I seeing this?</p>
        <button type="button" data-close onClick={onClose} aria-label="Close"
          className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <p className="mt-1">{readableDates(why.summary)}</p>
      {why.evidence?.length > 0 && (
        // Label and value each on their own line: a long value never squeezes the label out.
        <dl className="mt-2 space-y-1.5">
          {why.evidence.map((e, i) => (
            <div key={i}>
              <dt className="break-words font-semibold text-slate-800 dark:text-slate-100">{readableDates(e.label)}</dt>
              <dd className="break-words text-slate-600 dark:text-slate-300">{readableDates(e.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {why.missing?.length > 0 && <p className="mt-2 text-slate-500">Still needed: {why.missing.join(", ")}.</p>}
      <p className="mt-2 text-[11px] text-slate-400">
        Source: {why.source}{why.as_of ? ` · records as of ${shortDate(why.as_of)}` : ""}
      </p>
      {canHide && (
        <button type="button" onClick={onHide} className="mt-2 text-[12px] font-semibold text-slate-500 underline-offset-2 hover:underline">Hide this card</button>
      )}
    </>
  );
  const common = { ref: box, id, role: "dialog", "aria-labelledby": `${id}-title`, "data-why": card.key };
  return createPortal(sheet ? (
    <div className="fixed inset-0 z-[900] flex items-end bg-slate-950/30">
      <div {...common} aria-modal="true"
        className="max-h-[75vh] w-full overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] text-[13px] text-slate-600 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        {body}
      </div>
    </div>
  ) : (
    <div {...common} style={{ position: "fixed", left: place?.left ?? 0, top: place?.top ?? 0, width: place?.width ?? 320, visibility: place ? "visible" : "hidden", maxHeight: "min(420px, calc(100vh - 16px))" }}
      className="z-[900] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-[13px] text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
      {body}
    </div>
  ), document.body);
}

function InsightCard({ card: given, busy, anyBusy, exhausted, onAction, onHide, open, onToggle, wide = false, fullSimulation = false, paused = false, className = "" }) {
  // An account whose Simulation access is wider than its plan (grandfathered, or granted by an
  // administrator) can run the scenario, so its button is the ordinary one.
  const unlocked = fullSimulation && given.cta?.locked && given.cta.unlocked_to;
  const card = unlocked ? { ...given, note: null, cta: { label: "See the scenario", to: given.cta.unlocked_to } } : given;
  const [creditNote, setCreditNote] = useState(false);
  const whyLink = useRef(null);
  const whyId = `why-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const toggle = () => onToggle(card);
  const lockedCta = Boolean(card.cta?.locked);
  const body = useRef(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => { const el = body.current; if (el) setClipped(el.scrollHeight > el.clientHeight + 1); }, [card.text]);
  const missing = card.state === "insufficient_data";
  const st = { ...(TONE[card.tone] || TONE.indigo), ...(missing ? NEUTRAL : {}) };
  const badge = missing ? "Needs data" : card.state === "stale" ? "May be out of date" : card.positive ? "On track" : card.goal_match ? "Your goal" : card.priority_class <= 2 ? PRIORITY_LABEL[card.priority_class] : null;
  return (
    <article aria-label={card.title} className={`m-lift flex h-full min-w-0 flex-col rounded-2xl border p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${st.card} ${className} ${wide ? "sm:max-lg:flex-row sm:max-lg:items-center sm:max-lg:gap-5 sm:max-lg:self-start" : ""}`}>
     <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${st.icon}`}><Icon name={st.name} className="h-5 w-5" /></span>
        <h3 className={`text-base font-semibold leading-tight tracking-tight ${st.title}`}>{card.title}</h3>
      </div>
      {badge && (
        <span className="mt-2 inline-flex w-fit rounded-full bg-white/80 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">{badge}</span>
      )}
      {/* Three lines at most, so every card in a row is the same height; "More" opens the full explanation. */}
      <div className="mt-2.5 flex-1">
        <p ref={body} data-insight-text className="line-clamp-3 break-words text-[14px] leading-relaxed text-slate-600 dark:text-slate-300" title={card.text}>{card.text}</p>
        {clipped && <button type="button" onClick={toggle} className="mt-0.5 text-[12px] font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">More</button>}
      </div>
      {card.detail && <p className="mt-1 text-[12px] font-semibold text-slate-500">{card.detail}</p>}
      {/* A paid-plan note is said on the button ("· Pro"), not as another line of text. */}
      {card.note && !lockedCta && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-slate-400 dark:text-slate-500">{card.note}</p>}
      {card.state === "stale" && card.stale && (
        <p className="mt-2 text-[12px] text-amber-700">
          {card.stale.reason}{" "}
          <button type="button" onClick={() => onAction(card, card.stale.refresh)} className="font-semibold underline underline-offset-2">{card.stale.refresh?.label || "Update"}</button>
        </p>
      )}
     </div>
     <div className={`flex min-w-0 flex-col ${wide ? "sm:max-lg:ml-auto sm:max-lg:shrink-0 sm:max-lg:items-end" : ""}`}>
      <div className={`flex items-center justify-between gap-x-3 gap-y-2 ${wide ? "mt-3 sm:max-lg:mt-0 sm:max-lg:flex-col sm:max-lg:items-end" : "mt-3"}`}>
        {/* The main button (bottom left) opens a page or the explanation. It never starts an Agent task. */}
        {card.cta?.label ? (
          <button type="button" disabled={anyBusy} onClick={() => (card.cta?.explain ? toggle() : onAction(card, card.cta))} title={lockedCta && card.note ? card.note : undefined}
            className={`whitespace-nowrap px-4 py-1.5 text-[13px] font-semibold transition disabled:opacity-60 ${st.primary
              ? "rounded-full bg-indigo-600 text-white hover:bg-indigo-700"
              : "rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
            {card.cta.label}{lockedCta && !/\bPro$/.test(card.cta.label) ? " · Pro" : ""}
          </button>
        ) : <span />}
        {/* The chevron (bottom right) answers "Why am I seeing this?", so the card keeps one row of controls. */}
        <button ref={whyLink} type="button" aria-expanded={open} aria-controls={open ? whyId : undefined} aria-haspopup="dialog" onClick={toggle}
          aria-label={`Why am I seeing ${card.title}?`} title="Why am I seeing this?"
          className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900">
          <span className={`transition-transform ${open ? "rotate-90" : ""}`}><Icon name="chevron" className="h-3.5 w-3.5" /></span>
        </button>
      </div>
      {card.agent_action && exhausted && (
        // Out of credits: shown locked. It explains why here, on the card, and starts nothing.
        <button type="button" onClick={() => setCreditNote(true)} title={OUT_OF_CREDITS_TIP} aria-label={`${card.agent_action.label} (out of AI Credits)`}
          className="mt-2 inline-flex w-full max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-left text-[12px] font-semibold text-slate-400 sm:w-fit dark:border-slate-700 dark:bg-slate-800">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          {card.agent_action.label}
        </button>
      )}
      {creditNote && exhausted && (
        <OutOfCreditsNote className="mt-2" onClose={() => setCreditNote(false)}
          onPlans={() => onAction(card, { to: "/pricing", upgrade: true })} />
      )}
      {card.agent_action && !exhausted && (
        // Separate and labelled: this one starts an Agent task, which may use AI Credits.
        <button type="button" disabled={anyBusy || paused} onClick={() => onAction(card, { ...card.agent_action, agent: true })}
          title={paused ? "Updating your dashboard. This will be available in a moment." : "Starts an Agent task. It prepares the work for your approval and may use AI Credits."}
          className="mt-2 flex w-full max-w-full items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-left text-[12px] font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60 sm:w-fit dark:border-indigo-900/50 dark:bg-indigo-900/20 dark:text-indigo-300">
          <span className="shrink-0"><Icon name="sparkle" className="h-3.5 w-3.5" /></span>
          <span className="min-w-0">
            <span className="block break-words line-clamp-2">{busy ? "Starting…" : card.agent_action.label}</span>
            <span className="block text-[11px] font-normal leading-tight text-indigo-500">uses AI Credits</span>
          </span>
        </button>
      )}
     </div>
      {open && <WhyPopover id={whyId} card={card} anchor={whyLink} onClose={toggle} canHide={card.priority_class > 2} onHide={() => { onToggle(card); onHide(card); }} />}
    </article>
  );
}

export default function AdaptiveInsights({ dashboard, loading, failed, busyKey, onRetry, onAction, onWhy, onHide, onShowHidden, fullSimulation = false, paused = false }) {
  const cards = arrangeInsights(dashboard);
  const [openKey, setOpenKey] = useState(null);      // one explanation open at a time
  const toggleWhy = (card) => setOpenKey((k) => { if (k !== card.key) onWhy(card); return k === card.key ? null : card.key; });
  const hidden = dashboard?.preferences?.hidden_widget_ids || [];
  const exhausted = dashboard?.entitlement?.credits_exhausted;
  return (
    <section aria-labelledby="adaptive-insights">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="adaptive-insights" className="text-[15px] font-semibold text-slate-700 dark:text-slate-200">Adaptive Insights for Your Business</h2>
        {hidden.length > 0 && (
          <button type="button" onClick={onShowHidden} className="text-[12px] font-semibold text-slate-500 underline-offset-2 hover:underline">
            Show {hidden.length} hidden card{hidden.length === 1 ? "" : "s"}
          </button>
        )}
      </div>
      {exhausted && (
        <p role="status" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
          You've used your AI Credits, so Agent actions are paused. Your records and these insights are unaffected.{" "}
          <button type="button" onClick={() => onAction({ key: "credits" }, { to: "/pricing", upgrade: true })} className="font-semibold underline underline-offset-2">See plans and credits</button>
        </p>
      )}
      {loading ? (
        // Fixed-height placeholders: the page below doesn't move when the cards arrive.
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-label="Loading insights">
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} className="h-[188px] p-5" />)}
        </div>
      ) : failed ? (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">
          <p className="font-semibold">Insights couldn't be loaded.</p>
          <p className="mt-1 text-rose-700">The rest of your dashboard is unaffected, and nothing was changed.</p>
          <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-rose-700 hover:bg-rose-100">Try again</button>
        </div>
      ) : cards.length === 0 ? (
        <p role="status" className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          Nothing needs your attention right now.
        </p>
      ) : (
        <div className={`grid grid-cols-1 gap-4 ${gridFor(cards.length)}`}>
          {cards.map((card, i) => (
            <InsightCard key={card.key} card={card} className={spanFor(cards.length, i)} wide={wideFor(cards.length, i)} fullSimulation={fullSimulation} paused={paused} busy={busyKey === card.key} anyBusy={!!busyKey} exhausted={!!exhausted}
              open={openKey === card.key} onToggle={toggleWhy} onAction={onAction} onHide={onHide} />
          ))}
        </div>
      )}
    </section>
  );
}
