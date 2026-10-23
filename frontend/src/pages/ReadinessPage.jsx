import UkDateInput from "../components/UkDateInput";
import ResearchReview from "../components/ResearchReview";
import { apiRequest } from "../api/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import FirstValueCard, { PremiumConfirm, latestOf } from "../components/FirstValueCard";
import ResearchSummary from "../components/ResearchSummary";
import { premiumFlow } from "../components/ResearchReview";
import { NextSteps, StatusLine as ResultStatus, stepsOf } from "../components/ResultSummary";
import { launchCaseSteps, openLaunchSteps } from "../lib/launchSteps";
import { caseSteps, sectionCounts } from "../lib/caseSteps";
import { toast, withToast } from "../lib/toast";
import { relatedReady, relatedServices } from "../lib/related";
import { FundingOptions, PackStrip, RelatedCards, ResearchFindings, ScoreHero, fundingOptions, researchFindings } from "../components/readiness/CaseOverview";
import { useApplyResearch } from "../components/ResultSummary";
import NewNeedPrompt from "../components/readiness/NewNeedPrompt";
import QuickCheck from "../components/QuickCheck";
import { ButtonSpinner, ContentSkeleton, LoadError, ReadinessDetailSkeleton, ReadinessListSkeleton } from "../components/Skeleton";
import { Attestation, EvidenceList } from "../components/readiness/Evidence";
import { Btn, Field, Notice, Panel, Pill } from "../components/readiness/Fields";
import ForecastEditor from "../components/readiness/ForecastEditor";
import { ActionsPanel, DecisionPanel, HistoryPanel, MaterialsPanel, RequiredDocuments, ResultView, ScenarioPanel } from "../components/readiness/Panels";
import { confirmDialog } from "../lib/dialog";
import {
  CLASSIFICATION, FEATURES, LIFECYCLE, createSubject, dateLabel, getPath, getSubject, listSubjects, moneyLabel, newKey, readinessError, runAssessment,
  keepPrevious, setPath, startNewNeed, setSubjectStatus, updateSubject,
  attest, reviewDocument, saveForecast, staleReason,
} from "../lib/readiness";
import { useWorkspaceStore } from "../store/workspace";
import { useAuthStore } from "../store/auth";
import { hasFundingPack, hasReadiness } from "../lib/plans";

// Funding Readiness and Launch Readiness: one set of screens for both. `feature` is
// "funding" or "launch"; the questions, checks and wording come from the checklist profile.

const SAVE_DELAY_MS = 1200;

// What the page being loaded is called: "launch plan", "funding case".
const planWords = (feature) => (feature === "launch" ? ["launch plan", "launch plans"] : ["funding case", "funding cases"]);

/** One score and one plain sentence (the owner's brief, 17 Oct): "42/100 · Not ready for funding yet. 3 things to do first.",
 *  and how much is known, in plain words. Gates, confidence and versions are on the Advanced tab. */
/** Coverage and confidence, from the assessment summary only, as plain numbers with one line each: shown here, under
 *  Advanced, and nowhere else (the owner's UI change, 22 Oct). */
function CheckBasis({ summary, feature }) {
  const coverage = summary?.coverage ?? summary?.evidence_coverage;
  const level = String(summary?.confidence || "").toLowerCase();
  if ((coverage === null || coverage === undefined) && !CONFIDENCE_WORD[level]) return null;
  return (
    <dl className="mb-3 grid gap-1 text-[12.5px] text-slate-600 dark:text-slate-300" data-check-basis>
      {coverage !== null && coverage !== undefined && <div><dt className="inline font-semibold">Coverage {coverage}%</dt> <dd className="inline">: how much of {feature === "launch" ? "what a launch needs" : "what funders ask for"} is known.</dd></div>}
      {CONFIDENCE_WORD[level] && <div><dt className="inline font-semibold">Confidence {CONFIDENCE_WORD[level]}</dt> <dd className="inline">: {CONFIDENCE_WHY[level]}</dd></div>}
    </dl>
  );
}

// Confidence, from the assessment summary only: what each level means, in one line.
const CONFIDENCE_WORD = { low: "Low", medium: "Medium", high: "High" };
const CONFIDENCE_WHY = {
  low: "A key source is missing, conflicting or out of date.",
  medium: "Complete and current, but it relies on your own word.",
  high: "Backed by records or an independent review.",
};

/** Anything left to decide in a research run: an option not yet saved or dismissed, or a draft still open. */
function researchOpen(run) {
  if ((run?.drafts?.open || 0) > 0) return true;
  return (run?.items || []).some((i) => /^route_/.test(String(i.topic || "")) && i.value && !["accepted", "rejected", "edited"].includes(i.decision));
}

/** "Checklist updated: ready is now 75+": said the first time this case is opened after the change, then never again. */
function ChecklistUpdatedOnce({ id, note }) {
  const key = `ea:checklist-updated:${id}`;
  const [seen] = useState(() => { try { return Boolean(localStorage.getItem(key)); } catch { return false; } });
  useEffect(() => { if (note && !seen) { try { localStorage.setItem(key, "1"); } catch { /* shown this time only */ } } }, [key, note, seen]);
  if (!note || seen) return null;
  return <p className="mt-1 text-[12px] text-indigo-800" data-checklist-updated>{note}</p>;
}

function StatusLine({ summary, feature, big = false, steps = null, generalChecks = false, checking = false }) {
  if (!summary?.classification) {
    // Not scored: said once, with what to do (the owner's brief, 20 Oct). No "I know 0%" until there is a check.
    return <span className="text-[13px] text-slate-500" data-case-status>{summary?.execution_status === "failed" ? "The last check didn't finish. Run it again to see your score." : "Not checked yet. Run the check to see your score."}</span>;
  }
  const scored = summary.score !== null && summary.score !== undefined;

  // The steps on the page when the case has them (one count with "Your next steps"), else the check's own.
  const todo = Array.isArray(steps) ? steps.length : (summary.open_actions || summary.blocker_count || 0);

  const ready = summary.classification === "ready";
  const sentence = ready ? (feature === "launch" ? "Ready to launch." : "Ready to approach funders.")
    : `${feature === "launch" ? "Not ready to launch yet." : "Not ready for funding yet."}${todo ? ` ${todo} ${todo === 1 ? "thing" : "things"} to do first.` : ""}`;
  // One score everywhere, the summary's (the owner, 23 Oct): from what has been answered, "so far" until every item is
  // known; none while a check is running.
  const score = checking ? "Checking…" : scored ? `${summary.score}/100${summary.score_partial ? " so far" : ""}` : "Not scored yet";
  return (
    <span className="flex flex-col gap-0.5" data-case-status>
      <span className={`${big ? "text-[20px]" : "text-[14px]"} font-semibold text-slate-900 dark:text-slate-100`}>
        <span className="tabular-nums">{score}</span>
        {generalChecks && (
          // Never an equity score passed off as a grant or loan score (FR §2): labelled, beside it
          <span className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-300 align-middle text-[10px] font-bold text-slate-500" role="img"
            aria-label="Scored against the general checklist; a grant-specific checklist isn't available yet." title="Scored against the general checklist; a grant-specific checklist isn't available yet." data-general-checks>i</span>
        )}
        {" "}<span className="text-slate-400">·</span> {sentence}
        {summary.freshness === "stale" && !checking && <span className="ml-2 align-middle"><Pill tone="amber" mark="!">Out of date</Pill></span>}
      </span>

    </span>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────

function NewSubject({ businessId, feature, profiles, onCreated, onCancel }) {
  const meta = FEATURES[feature];
  const [form, setForm] = useState(feature === "funding" ? { title: "", route: "equity", target_amount: "" } : { name: "", launch_type: "", scope: "commercial", target_date: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const off = (match) => (profiles?.unavailable || []).find(match);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const data = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== "" && v !== null));
      onCreated(await createSubject(businessId, feature, data));
    } catch (err) {
      setProblem(readinessError(err, `The ${meta.noun} couldn't be created. Please try again.`));
    } finally {
      setBusy(false);
    }
  }

  const input = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  return (
    <Panel title={meta.newLabel}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Name
            <input autoFocus className={input} value={form[meta.nameField]} onChange={(e) => setForm({ ...form, [meta.nameField]: e.target.value })} placeholder={meta.namePlaceholder} />
            {problem?.errors?.[meta.nameField] && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{problem.errors[meta.nameField]}</span>}
          </label>
          {feature === "funding" ? (
            <>
              <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Funding route
                <select className={input} value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })}>
                  <option value="equity">Equity (investors)</option>
                  {(profiles?.unavailable || []).map((u) => <option key={u.id} value={u.route} disabled>{u.title} (not available yet)</option>)}
                </select>
                <span className="mt-1 block text-[12px] font-normal text-slate-500">{off((u) => u.route === "debt")?.reason}</span>
              </label>
              <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Amount you want to raise (optional)
                <input type="text" inputMode="decimal" className={input} value={form.target_amount} onChange={(e) => setForm({ ...form, target_amount: e.target.value })} placeholder="Leave blank if you don't know yet" />
                {problem?.errors?.target_amount && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{problem.errors.target_amount}</span>}
              </label>
            </>
          ) : (
            <>
              <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">What are you launching?
                <select className={input} value={form.launch_type} onChange={(e) => setForm({ ...form, launch_type: e.target.value })}>
                  <option value="">Work it out from my records</option>
                  <option value="initial_business">A new business (first launch)</option>
                  <option value="new_offering">A new service in an existing business</option>
                  <option value="new_market" disabled>A new market (not available yet)</option>
                </select>
              </label>
              <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Scope
                <select className={input} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                  <option value="commercial">Commercial launch</option>
                  <option value="pilot" disabled>Limited pilot (not available yet)</option>
                </select>
                <span className="mt-1 block text-[12px] font-normal text-slate-500">{off((u) => u.scope === "pilot")?.reason}</span>
              </label>
              <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Target launch date (optional)
                <UkDateInput className={input} value={form.target_date} onChange={(v) => setForm({ ...form, target_date: v })} />
              </label>
            </>
          )}
        </div>
        {problem && <Notice tone="rose" role="alert">{problem.message}</Notice>}
        <div className="flex gap-2">
          <Btn kind="primary" type="submit" disabled={busy}>{busy && <ButtonSpinner />}{busy ? "Creating…" : "Create and continue"}</Btn>
          {onCancel && <Btn onClick={onCancel}>Cancel</Btn>}
        </div>
        <p className="text-[12px] text-slate-500">What we already know about your business is filled in for you, with where it came from. You only answer what is missing.</p>
      </form>
    </Panel>
  );
}

/** The funding case's saved research (the owner's QA, 15 Oct): the run date, the findings and the review state; opening one
 *  is free, and the same research is never bought twice. */
function SavedResearch({ businessId, goal = "need_funding" }) {
  const [runs, setRuns] = useState(null);
  const [open, setOpen] = useState(null);
  const [problem, setProblem] = useState("");
  const [params] = useSearchParams();
  const asked = params.get("run");
  useEffect(() => {
    apiRequest(`/businesses/${businessId}/research-runs?goal=${goal}`, "GET").then((r) => setRuns((r?.runs || []).filter((x) => x.status !== "replaced"))).catch(() => setRuns([]));
  }, [businessId, goal]);
  // Arriving from "Review findings": that run (else the newest waiting one) opens at once, in place.
  useEffect(() => {
    if (!runs?.length || open) return;
    const pick = runs.find((r) => r.id === asked) || (asked ? null : runs.find((r) => r.status === "review"));
    if (pick) show(pick.id);
  }, [runs]);      // eslint-disable-line react-hooks/exhaustive-deps
  if (runs === null) return <p role="status" className="text-[13px] text-slate-500">Loading your research…</p>;
  if (!runs.length) return <p className="text-[13px] text-slate-500">No research yet. "Help me become funding-ready" on your result runs it.</p>;
  const show = async (id) => {
    setProblem("");
    const out = await apiRequest(`/businesses/${businessId}/research/${id}`, "GET").catch(() => null);
    if (!out?.research) { setProblem("That research couldn't be opened just now. Try again."); return; }
    setOpen(out.research);
    // Brought into view (the owner's QA, 21 Oct: it opened below the list, out of sight)
    setTimeout(() => document.getElementById("review")?.scrollIntoView?.({ block: "start", behavior: "smooth" }), 50);
  };
  const [latest, ...earlier] = runs;
  const row = (r) => (
    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700" data-research-run={r.id}>
      <span className="text-[13px] text-slate-800 dark:text-slate-100">{dateLabel(r.created_at)} · {r.findings} found online{typeof r.new_findings === "number" && r.new_findings !== r.findings ? ` (${r.new_findings} new)` : ""} · {r.status === "adopted" ? "Reviewed and adopted" : "Waiting for your review"}</span>
      <Btn onClick={() => show(r.id)}>{r.status === "adopted" ? "Open" : "Review findings"}</Btn>
    </li>
  );
  return (
    <div className="space-y-3" data-saved-research>
      {/* The latest run only; the earlier ones folded away (the owner's brief, 20 Oct). */}
      <ul className="space-y-2">{row(latest)}</ul>
      {earlier.length > 0 && (
        <details data-earlier-runs>
          <summary className="cursor-pointer text-[13px] font-semibold text-slate-600 dark:text-slate-300">Earlier runs ({earlier.length})</summary>
          <ul className="mt-2 space-y-2">{earlier.map(row)}</ul>
        </details>
      )}
      {problem && <p role="alert" className="text-[12.5px] text-rose-700">{problem}</p>}
      {open && <div id="review" data-review-on-page><ResearchReview businessId={businessId} run={open} onAdopted={() => {
        window.dispatchEvent(new CustomEvent("ea:toast", { detail: { kind: "success", title: "All findings reviewed", message: "Your case was checked again. Open the Materials tab to view your funding pack." } }));
      }} /></div>}
    </div>
  );
}

function OpenCase({ to }) {
  const navigate = useNavigate();
  useEffect(() => { navigate(to, { replace: true }); }, [to, navigate]);
  return <ReadinessListSkeleton label="your funding case" />;
}

/** QA P0.2: what the funding need this case replaced brought with it. Set aside, not counted, until kept: Keep or Remove each. */
/** The row's actions in one ··· menu (the owner's QA, 15 Oct): View details, Keep, Remove. */
function RowMenu({ label, disabled, viewing, onView, onKeep, onRemove }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(null);      // where the menu opens, on the page itself: never clipped by a popup's scroll area
  const button = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !e.target.closest?.("[data-row-menu]")) setOpen(false); };
    const away = () => setOpen(false);      // scrolled or resized: closed rather than left floating in the wrong place
    window.addEventListener("keydown", close);
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", away);
    window.addEventListener("scroll", away, true);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("mousedown", close); window.removeEventListener("resize", away); window.removeEventListener("scroll", away, true); };
  }, [open]);
  const toggle = () => {
    const r = button.current?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom > 140;
      setAt({ right: Math.max(8, window.innerWidth - r.right), ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }) });
    }
    setOpen((o) => !o);
  };
  const pick = (fn) => () => { setOpen(false); fn(); };
  const item = "block w-full px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800";
  return (
    <div className="relative" data-row-menu>
      <button ref={button} type="button" aria-label={`Actions for ${label}`} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={toggle}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open && createPortal(
        <div role="menu" data-row-menu style={{ position: "fixed", ...(at || {}) }}
          className="z-[95] w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <button type="button" role="menuitem" className={item} onClick={pick(onView)}>{viewing ? "Hide details" : "View details"}</button>
          <button type="button" role="menuitem" className={item} onClick={pick(onKeep)}>Keep</button>
          <button type="button" role="menuitem" className={`${item} text-rose-700 dark:text-rose-300`} onClick={pick(onRemove)}>Remove</button>
        </div>, document.body)}
    </div>
  );
}

const PREVIEW_LABEL = { title: "Title", says: "What it says", kind: "Type", dated: "Dated", checked: "Checked", figures: "Figures", reviewed_on: "Reviewed on",
  notes: "Notes", prepared: "Prepared" };
/** Is there anything in it to decide on: its text, figures, notes or values, not only a title, a type and a date? */
const NOTHING_SAID = /^(?:no(?:ne)?|nothing|n\/a|unknown|not sure(?: yet)?|not known(?: yet)?|no traction(?: yet)?|none yet|not yet|nothing yet|0)\.?$/i;

export function hasContent(v) {
  if (v == null || v === "") return false;
  // A value that only says there is nothing ("No traction yet", "None", "Not sure") is nothing to decide on.
  if (typeof v !== "object") return String(v).trim().length > 0 && !NOTHING_SAID.test(String(v).trim());
  if (Array.isArray(v)) return v.some(hasContent);
  const meta = new Set(["title", "kind", "dated", "checked", "reviewed_on", "prepared"]);
  return Object.entries(v).some(([k, x]) => !SKIP_KEYS.has(k) && !meta.has(k) && hasContent(x));
}

const SKIP_KEYS = new Set(["id", "status", "version", "created_at", "updated_at", "generated_at", "source", "provenance", "reviewed", "reviewed_by",
  "reviewed_at", "evidence_id", "facts_fingerprint", "fingerprint", "run_id", "agent_run_id", "links", "held_links", "key", "preview"]);
const wordsOf = (k) => PREVIEW_LABEL[k] || k.replace(/_id$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** What a set-aside item says, in plain words: its text, its figures as "Label: value", a list as bullets. */
export function PreviousDetail({ value }) {
  if (value == null || value === "" || (typeof value === "object" && !Object.keys(value).length)) return <p className="text-slate-500">Only its title was saved with this, no other details.</p>;
  if (typeof value !== "object") return <p className="whitespace-pre-line">{String(value)}</p>;
  if (Array.isArray(value)) {
    return <ul className="list-disc space-y-0.5 pl-5">{value.map((v, n) => <li key={n}>{typeof v === "object" && v ? Object.entries(v).filter(([k, x]) => !SKIP_KEYS.has(k) && x !== "" && x != null).map(([k, x]) => `${wordsOf(k)}: ${typeof x === "object" ? JSON.stringify(x) : x}`).join(" · ") : String(v)}</li>)}</ul>;
  }
  const TEXT = ["text", "content", "body", "markdown"];
  const text = TEXT.map((k) => value[k]).find((t) => typeof t === "string" && t.trim());
  const rows = Object.entries(value).filter(([k, x]) => !SKIP_KEYS.has(k) && !TEXT.includes(k) && x !== "" && x != null && !(typeof x === "object" && !Object.keys(x).length));
  if (!rows.length && !text) return <p className="text-slate-500">Only its title was saved with this, no other details.</p>;
  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <dl className="space-y-1">
          {rows.map(([k, x]) => (
            <div key={k}><dt className="inline font-semibold">{wordsOf(k)}: </dt><dd className="inline">{typeof x === "object" ? <PreviousDetail value={x} /> : String(x)}</dd></div>
          ))}
        </dl>
      )}
      {text && <p className="max-h-80 overflow-y-auto whitespace-pre-line rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60" data-saved-text>{text}</p>}
    </div>
  );
}

export function PreviousNeed({ businessId, subject, onChanged }) {
  const prev = (subject.data?.previous_needs || [])[0];
  const [busy, setBusy] = useState("");
  const [listing, setListing] = useState(false);      // the popup with everything to keep or remove
  const [viewing, setViewing] = useState(null);       // one item's details, in the same popup
  useEffect(() => {
    if (!listing) return undefined;
    const key = (e) => { if (e.key === "Escape") (viewing ? setViewing(null) : setListing(false)); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [listing, viewing]);
  if (!prev) return null;
  const words = { market: "Market details", traction: "Traction", use_of_funds: "Use of funds", milestones: "Milestones" };
  // Every earlier need's items still to keep or remove (the owner's QA, 15 Oct: replacing twice hid the first need's
  // eleven), each with the need it came from.
  const needs = subject.data?.previous_needs || [];
  const items = needs.flatMap((p, need) => {
    const review = p.review || {};
    return [
      ...(p.evidence || []).map((e) => ({ id: `evidence:${e.id}`, label: e.title, note: e.date ? `dated ${String(e.date).slice(0, 10)}` : "", detail: e.preview || e.detail || "", evidence: e.id })),
      ...Object.keys(p.documents || {}).map((k) => ({ id: `document:${k}`, label: k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), note: "", detail: p.documents[k]?.preview || {} })),
      ...Object.keys(p.set_aside || {}).filter((k) => words[k]).map((k) => ({ id: k, label: words[k], note: "", detail: p.set_aside[k] })),
    ].filter((i) => !review[i.id]).map((i) => ({ ...i, need, key: `${need}:${i.id}`, from: `Replaced on ${dateLabel(p.replaced_at)}${p.summary ? `: ${p.summary}` : ""}` }));
  });
  if (!items.length) return null;
  // Only a title and a date saved (set aside before details were kept): nothing to decide on, so not asked one by one.
  const full = items.filter((i) => hasContent(i.detail));
  const empty = items.filter((i) => !hasContent(i.detail));
  const clearEmpty = async () => {
    setBusy("empty");
    try {
      let last = null;
      for (const i of empty) last = await keepPrevious(businessId, subject.id, i.id, false, i.need);
      if (last) onChanged(last);
    } finally { setBusy(""); }
  };
  const decide = async (it, keep) => {
    setBusy(it.key);
    try { onChanged(await keepPrevious(businessId, subject.id, it.id, keep, it.need)); setViewing(null); } finally { setBusy(""); }
  };
  const groups = [...new Set(full.map((i) => i.need))].map((n) => ({ need: n, from: full.find((i) => i.need === n).from, list: full.filter((i) => i.need === n) }));
  const close = () => { setViewing(null); setListing(false); };
  const shown = viewing && items.find((i) => i.key === viewing.key);
  return (
    <>
      {/* One line on every tab; the list itself opens as a popup (the owner's QA, 15 Oct). */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[13px] text-amber-900" data-previous-need-line>
        <span>{full.length
          ? `${full.length} thing${full.length === 1 ? "" : "s"} from your previous funding need to keep or remove. They don't count in your score until you keep them.`
          : `${empty.length} thing${empty.length === 1 ? "" : "s"} from your previous funding need had only a title saved: nothing to review.`}</span>
        {full.length ? <Btn onClick={() => setListing(true)}>Review</Btn> : <Btn disabled={busy === "empty"} onClick={clearEmpty} data-clear-empty>{busy === "empty" ? "Clearing…" : "Clear them"}</Btn>}
      </div>
      {listing && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div role="dialog" aria-modal="true" aria-label={shown ? shown.label : "From your previous funding need"} data-previous-need
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <div className="min-w-0">
                {shown && <button type="button" onClick={() => setViewing(null)} className="mb-1 text-[12.5px] font-semibold text-brand-700 hover:underline">Back to the list</button>}
                <p className="text-base font-bold text-slate-900 dark:text-slate-100">{shown ? shown.label : "From your previous funding need. Still relevant?"}</p>
                {!shown && <p className="mt-0.5 text-[13px] text-slate-500">{groups.length > 1 ? `From ${groups.length} earlier funding needs.` : `${groups[0].from}.`}</p>}
                {shown && groups.length > 1 && <p className="mt-0.5 text-[12.5px] text-slate-500">{shown.from}</p>}
                {shown?.note && <p className="mt-0.5 text-[13px] text-slate-500">{shown.note}</p>}
              </div>
              <button type="button" onClick={close} aria-label="Close" className="text-[13px] font-semibold text-slate-500 hover:text-slate-800">Close</button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              {shown ? (
                <div className="text-[13.5px] text-slate-700 dark:text-slate-300" data-previous-detail>
                  <PreviousDetail value={shown.detail} />
                  {shown.evidence && <a href="?tab=evidence" className="mt-2 inline-block text-[12.5px] font-semibold text-brand-700 hover:underline">See it in the Evidence tab</a>}
                </div>
              ) : (
                <div className="space-y-4">
                  {groups.map((g) => (
                    <div key={g.need} data-previous-group={g.need}>
                      {groups.length > 1 && <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{g.from}</p>}
                      <ul className="space-y-2">
                        {g.list.map((i) => (
                          <li key={i.key} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800" data-previous-item={i.id}>
                            <button type="button" onClick={() => setViewing(i)} className="min-w-0 text-left text-[13px] text-slate-800 hover:text-brand-700 dark:text-slate-200">
                              {i.label}{i.note && <span className="text-slate-500"> · {i.note}</span>}
                            </button>
                            <RowMenu label={i.label} disabled={busy === i.key} viewing={false}
                              onView={() => setViewing(i)} onKeep={() => decide(i, true)} onRemove={() => decide(i, false)} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {empty.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-2 text-[12.5px] text-slate-500 dark:border-slate-700" data-empty-previous>
                      <span>{empty.length} more had only a title saved ({empty.map((i) => i.label).join(", ")}): nothing to review.</span>
                      <Btn disabled={busy === "empty"} onClick={clearEmpty} data-clear-empty>{busy === "empty" ? "Clearing…" : "Clear them"}</Btn>
                    </div>
                  )}
                </div>
              )}
            </div>
            {shown && (
              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
                <Btn disabled={busy === shown.key} onClick={() => decide(shown, false)}>Remove</Btn>
                <Btn kind="primary" disabled={busy === shown.key} onClick={() => decide(shown, true)}>Keep</Btn>
              </div>
            )}
          </div>
        </div>, document.body)}
    </>
  );
}

function SubjectList({ businessId, feature }) {
  const meta = FEATURES[feature];
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true });
  // "Start a new launch plan" from the Agent (G6) opens the New form at once
  const [listParams] = useSearchParams();
  const [creating, setCreating] = useState(() => listParams.get("new") === "1" && feature !== "funding");

  const load = useCallback(async () => {
    try { setState({ loading: false, ...(await listSubjects(businessId, feature)) }); }
    catch (e) { setState({ loading: false, problem: readinessError(e, "This couldn't be loaded.") }); }
  }, [businessId, feature]);
  useEffect(() => { setState({ loading: true }); load(); }, [load]);

  if (state.loading) return <ReadinessListSkeleton label={`your ${planWords(feature)[1]}`} />;
  if (state.problem) return <LoadError what={`your ${planWords(feature)[1]}`} detail={state.problem.message} onRetry={() => { setState({ loading: true }); load(); }} />;
  if (state.enabled === false) return <Notice>{meta.title} isn't switched on for this account yet.</Notice>;
  if (feature === "funding" && (state.items || []).some((i) => i.status !== "archived")) {
    // A business has one funding case: the page is that case.
    const only = state.items.find((i) => i.status !== "archived");
    return <OpenCase to={`${meta.base}/${only.id}`} />;
  }
  const items = state.items || [];
  const active = items.filter((i) => i.status !== "archived");
  const archived = feature === "funding" ? [] : items.filter((i) => i.status === "archived");      // one funding case: no archive list
  const canEdit = state.can?.[`${feature}.edit`];

  const row = (item) => (
    <li key={item.id}>
      <button type="button" onClick={() => navigate(`${meta.base}/${item.id}`)}
        className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-300 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="break-words text-base font-bold text-slate-900 dark:text-slate-100">{item.title}</p>
            <p className="text-[12px] text-slate-500">
              {LIFECYCLE[item.status]}
              {feature === "funding" ? (item.target_amount ? ` · ${moneyLabel(item.target_amount, item.currency)}` : " · amount not set")
                : ` · ${item.target_date ? `target ${dateLabel(item.target_date)}` : "no date set"} · ${item.launch_type === "new_offering" ? "new service" : "first launch"}`}
            </p>
          </div>
          <StatusLine summary={item.summary} feature={feature} />
        </div>
        {item.summary?.next_action && <p className="mt-2 text-[13px] text-slate-600 dark:text-slate-300"><span className="font-semibold">Next:</span> {item.summary.next_action.title}</p>}
      </button>
    </li>
  );

  return (
    <div className="space-y-4">
      {items.length === 0 && !creating && (
        <Panel>
          {/* The header above already says what this is (QA P3: it was said twice); the card says what to do next. */}
          <p className="text-[13px] text-slate-500">{meta.caveat}</p>
          {canEdit ? <Btn kind="primary" className="mt-3" onClick={() => setCreating(true)}>{meta.newLabel}</Btn>
            : <p className="mt-3 text-[13px] text-slate-500">Your role can view {meta.nounPlural} but not create them.</p>}
        </Panel>
      )}
      {creating && <NewSubject businessId={businessId} feature={feature} profiles={state.profiles} onCancel={() => setCreating(false)} onCreated={(s) => navigate(`${meta.base}/${s.id}`)} />}
      {active.length > 0 && <ul className="space-y-3">{active.map(row)}</ul>}
      {/* One funding case per business, kept to the latest need; several launch plans are fine (the owner, 23 Oct). */}
      {items.length > 0 && !creating && canEdit && feature !== "funding" && <Btn onClick={() => setCreating(true)}>{meta.newLabel}</Btn>}
      {items.length > 0 && feature === "funding" && (
        <p className="text-[12.5px] text-slate-500" data-one-funding-case>
          Your business has one funding case. A new need replaces it or updates it{archived.length && !active.length ? ", or reactivate it" : ""}; earlier needs are kept in History.
        </p>
      )}
      {archived.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[13px] font-semibold text-slate-600 dark:text-slate-300">Archived ({archived.length})</summary>
          <ul className="mt-2 space-y-3">{archived.map(row)}</ul>
        </details>
      )}
      {/* The checklist's name is not the case's route (G2: a loan case read "Equity preparation") */}
      {state.profiles?.current && feature !== "funding" && <p className="text-[12px] text-slate-500">Checklist: {state.profiles.current.title}, version {state.profiles.current.version}. {state.profiles.current.status_note}</p>}
      {state.profiles?.current && feature === "funding" && <p className="text-[12px] text-slate-500">Each case is checked against our funding readiness checklist, version {state.profiles.current.version}. {state.profiles.current.status_note}</p>}
    </div>
  );
}

// ── Detail ────────────────────────────────────────────────────────────────────

/** Where this section's answers came from, said once on the section: "From your chat", else "Filled in for you" (the
 *  workspace, its records or the Agent's drafts). Nothing when every answer is your own. */
function filledFrom(section, data) {
  const prov = data?.provenance || {};
  const said = (section.fields || []).map((f) => {
    const p = Object.entries(prov).find(([path]) => path === f.key || path.startsWith(`${f.key}.`))?.[1];
    return String(typeof p === "string" ? p : p?.source || p?.said || "");
  }).filter(Boolean);
  if (said.some((t) => /chat/i.test(t))) return "From your chat";
  if (said.some((t) => /agent|records|profile|research|invoices|expenses|catalogue/i.test(t))) return "Filled in for you";
  return null;
}

/** One collapsible part of Advanced: closed unless asked for. */
function Fold({ id, title, open = false, children }) {
  return (
    <details id={`adv-${id}`} open={open} className="group rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" data-fold={id}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 text-[14.5px] font-semibold text-slate-900 dark:text-slate-100">
        {title}<span aria-hidden="true" className="text-slate-400 transition group-open:rotate-180">▾</span>
      </summary>
      <div className="min-w-0 border-t border-slate-100 px-5 py-4 dark:border-slate-800">{children}</div>
    </details>
  );
}

// "Amount ₦5,000,000", "Needed by 30 Apr 2027": an answer in plain words, never its field key (the owner's brief, 20 Oct).
const PLAIN_NAME = { target_amount: "Amount", receipt_date: "Needed by", purpose: "For", route_preference: "Route", stage: "Trading so far", currency: "Currency",
  "traction.summary": "Demand so far", "traction.customers": "Paying customers", "traction.monthly_revenue": "Revenue each month", "market.location": "Where",
  "market.target_segment": "Customers", "economics.price": "Price per sale", "economics.direct_cost": "Cost per sale", "economics.fixed_costs_monthly": "Fixed costs each month",
  jurisdiction: "Country", use_of_funds: "Use of funds" };
function plainAnswer(path, value, subject, currency) {
  const field = (subject.profile_definition?.sections || []).flatMap((x) => x.fields || []).find((f) => f.key === path);
  const name = PLAIN_NAME[path] || field?.label?.replace(/\?$/, "") || path.replace(/[._]/g, " ");
  let shown = Array.isArray(value) ? `${value.length} ${value.length === 1 ? "line" : "lines"}` : String(value ?? "");
  if (field?.type === "money" || /amount|price|cost|revenue/.test(path)) {
    const n = Number(String(value ?? "").replace(/,/g, ""));
    if (Number.isFinite(n) && String(value ?? "").trim() !== "") shown = moneyLabel(Math.round(n), currency);
  }
  if (field?.type === "date" || path === "receipt_date") shown = dateLabel(value) || shown;
  if (path === "route_preference" || path === "stage") shown = field?.labels?.[value] || shown;
  return `${name} ${shown}`;
}

// The three tabs (the owner's brief, 20 Oct), and where each old address now lives.
const TAB_OF = { overview: "overview", answers: "answers", advanced: "advanced", setup: "answers", results: "overview", actions: "overview",
  evidence: "advanced", research: "advanced", documents: "advanced", history: "advanced", scenarios: "advanced", decision: "advanced" };
const MENU_ROW = "block w-full px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50 disabled:text-slate-400 dark:text-slate-200 dark:hover:bg-slate-800";

// What each confirmation says in its toast, by the case's own check (the funding case's and a launch plan's codes differ)
const ATTEST_COPY = {
  "funding:C4.B": { title: "Evidence confirmed.", detail: "Demand evidence now counts." },
  "launch:C1.B": { title: "Evidence confirmed.", detail: "Your customer evidence now counts." },
  "launch:C2.B": { title: "Figures confirmed.", detail: "Your price, costs and margin now count." },
  "launch:C6.A": { title: "Prerequisites reviewed.", detail: "Which apply to this launch now counts." },
  default: { title: "Figures confirmed.", detail: "Your price, costs and break-even now count." },
};

function Setup({ businessId, feature, subject, data, errors, onField, onChanged, openSection, setOpenSection, disabled, onNewNeed = null, recheck = null }) {
  // A file for a field's evidence, from the form itself (23 Oct): saved as evidence dated today, linked to the check it
  // answers, the plan read again so it is in the list, and chosen
  const uploadEvidence = async (fieldKey, file, title) => {
    const check = { prerequisites: "C6.B" }[fieldKey];
    const item = await addEvidence(businessId, feature, { title: `${title || "Evidence"}: ${file.name}`.slice(0, 200), type: fieldKey === "prerequisites" ? "permission" : "document",
      claim: String(title || ""), effective_date: todayLocal(), source: { kind: "file", reference: file.name },
      links: check ? [{ subject_id: subject.id, check }] : [] });
    await attachEvidenceFile(businessId, feature, item.id, file);
    await onChanged?.();
    return item.id;
  };
  const sections = subject.profile_definition.sections;
  const progress = Object.fromEntries((subject.sections || []).map((s) => [s.key, s]));
  const index = Math.max(0, sections.findIndex((s) => s.key === openSection));
  const section = sections[index];
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <label className="block md:hidden" data-section-picker>
        <span className="sr-only">Section</span>
        <select value={section.key} onChange={(e) => setOpenSection(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          {sections.map((s, i) => <option key={s.key} value={s.key}>{`Section ${i + 1} of ${sections.length} · ${s.title}${progress[s.key] ? ` (${progress[s.key].answered} of ${progress[s.key].total} answered)` : ""}`}</option>)}
        </select>
      </label>
      <nav aria-label="Sections" className="max-md:hidden">
        <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {sections.map((s, i) => {
            const p = progress[s.key];
            return (
              <li key={s.key} className="shrink-0">
                <button type="button" aria-current={i === index ? "step" : undefined} onClick={() => setOpenSection(s.key)}
                  className={`w-full rounded-xl border px-3 py-2 text-left text-[13px] transition ${i === index ? "border-brand-400 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
                  <span className="block font-semibold">{i + 1}. {s.title}</span>
                  {p && <span className="block text-[11px] text-slate-500">{p.answered} of {p.total} answered</span>}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 hidden text-[11px] text-slate-500 lg:block">How much you have answered is not the same as how ready you are. Run the check to find out.</p>
      </nav>

      <Panel className="min-w-0" title={`${index + 1}. ${section.title}`} id={`section-${section.key}`}
        actions={filledFrom(section, data) ? <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11.5px] font-semibold text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200" data-from-chat>{filledFrom(section, data)}</span> : null}>
        <div className="space-y-4">
          {section.fields.map((f) => (
            <div key={f.key} data-field={f.key}>
              <Field field={f} data={data} errors={errors} disabled={disabled} evidence={subject.evidence} onChange={onField} idBase={section.key} upload={uploadEvidence} />
              {f.key === "title" && feature === "funding" && <NewNeedPrompt key={`${subject.id}:${data.title}`} subjectId={subject.id} data={data} onNewNeed={onNewNeed} disabled={disabled} />}
            </div>
          ))}
          {section.forecast && (
            <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
              <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">{feature === "funding" ? "12-month cash forecast" : "Cash projection"}</h3>
              <div data-forecast-editor><ForecastEditor businessId={businessId} feature={feature} subject={subject} evidence={subject.evidence} onSaved={onChanged} disabled={disabled} /></div>
            </div>
          )}
          {section.evidence && (
            <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
              <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">Evidence</h3>
              <EvidenceList businessId={businessId} feature={feature} subject={subject} checks={section.evidence} onChanged={onChanged}
                emptyText="Nothing attached yet. Research, enquiries, pilots and sales all count: attach what you actually have." />
            </div>
          )}
          {section.documents && (
            <div className="border-t border-slate-100 pt-4 dark:border-slate-800" data-field="required-documents">
              <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">Preparation documents</h3>
              <RequiredDocuments businessId={businessId} subject={subject} onChanged={onChanged} recheck={recheck} />
            </div>
          )}
          {(section.attest || []).map((code) => <Attestation key={code} businessId={businessId} feature={feature} subject={subject} code={code} onChanged={onChanged} />)}
        </div>
        <div className="mt-5 flex justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
          <Btn disabled={index === 0} onClick={() => setOpenSection(sections[index - 1].key)}>Back</Btn>
          {index < sections.length - 1 ? <Btn kind="primary" onClick={() => setOpenSection(sections[index + 1].key)}>Next: {sections[index + 1].title}</Btn>
            : <span className="self-center text-[13px] text-slate-500">That's every section. Run the check when you're ready.</span>}
        </div>
      </Panel>
    </div>
  );
}

function SubjectDetail({ businessId, feature, subjectId }) {
  const meta = FEATURES[feature];
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Three tabs (the owner's brief, 20 Oct): Overview (the result, default), Your answers, Advanced. Old addresses still open.
  const asked = params.get("tab") || "overview";
  const tab = TAB_OF[asked] || "overview";
  const [overview, setOverview] = useState(undefined);      // the chat's own result for this case: undefined loading, null none
  const [allSteps, setAllSteps] = useState(false);
  const [researchRun, setResearchRun] = useState(null);      // the latest paid run for this case, for the Overview's result view
  const [menu, setMenu] = useState(false);
  const subscription = useAuthStore((st) => st.subscription);
  const platformGrants = useAuthStore((st) => st.platformGrants);
  // The funding pack is on Decision Engine and above (the owner, 16 Oct); the launch documents stay as they are.
  const packLocked = feature === "funding" && !hasFundingPack(subscription, platformGrants);
  const [subject, setSubject] = useState(null);
  const [data, setData] = useState(null);
  const [problem, setProblem] = useState(null);
  const [save, setSave] = useState({ state: "saved" });      // saved | pending | saving | error | conflict
  const [errors, setErrors] = useState({});
  const [checking, setChecking] = useState(false);
  const [checkProblem, setCheckProblem] = useState(null);
  const [dateReview, setDateReview] = useState(null);
  const dirty = useRef(new Set());
  const latest = useRef({});
  const timer = useRef(null);
  const [openSection, setOpenSectionState] = useState(params.get("section") || null);
  // A link to a section from this same page ("Fill it in" on a step) opens that section, not the one last shown (the
  // owner's QA, 21 Oct: the forecast's "Fill it in" stayed on the funding goal).
  const sectionAsked = params.get("section");
  useEffect(() => { if (sectionAsked) setOpenSectionState(sectionAsked); }, [sectionAsked, params.get("field")]);      // eslint-disable-line react-hooks/exhaustive-deps
  // Arriving from a goal started on the homepage: say once what was set up and what to do next.
  // Kept until it is dismissed (a re-render, a reload or a second mount must not lose it), and only on the case it is about.
  const [arrived, setArrived] = useState(() => {
    try {
      const note = JSON.parse(sessionStorage.getItem("ea_goal_handoff") || "null");
      return note?.message && String(note.to || "").endsWith(`/${subjectId}`) ? note.message : "";
    } catch { return ""; }
  });
  const dismissArrived = () => { setArrived(""); try { sessionStorage.removeItem("ea_goal_handoff"); } catch { /* ignore */ } };

  const accept = useCallback((detail, keepEdits = false) => {
    setSubject(detail);
    if (!keepEdits || dirty.current.size === 0) setData(detail.data);
    else setData((d) => { const next = { ...detail.data }; dirty.current.forEach((k) => { next[k] = d[k]; }); return next; });
    if (detail.date_review?.length) setDateReview(detail.date_review);
  }, []);

  const load = useCallback(async () => {
    try { accept(await getSubject(businessId, feature, subjectId), true); setProblem(null); }
    catch (e) { setProblem(readinessError(e, "This couldn't be loaded.")); }
  }, [businessId, feature, subjectId, accept]);
  useEffect(() => { setSubject(null); dirty.current = new Set(); load(); return () => clearTimeout(timer.current); }, [load]);
  // A figure edited in the research review is on the case at once, before adopting (the owner's QA, 17 Oct): shown here.
  useEffect(() => {
    const again = () => { if (!dirty.current.size) load(); };
    window.addEventListener("ea:case:updated", again);
    return () => window.removeEventListener("ea:case:updated", again);
  }, [load]);

  // The result is kept current for the owner: when the details change after a check, the check
  // runs again by itself, once the changes are saved. Tried once per version; if it can't
  // finish, the reason is shown and the button is still there.
  // Only after the owner's own edits on this page (G5, 23 Oct: a reload re-checked, the check's own fill made it out of date
  // again, and round it went): a reload never starts a check; the "Out of date" mark and the button are there.
  const autoChecked = useRef("");
  const editedHere = useRef(false);
  const staleKey = editedHere.current && subject?.assessment?.freshness?.status === "stale" && subject?.can?.[`${feature}.edit`] && subject.status !== "archived"
    ? `${subjectId}:${subject.revision}:${subject.assessment?.id || ""}` : "";
  useEffect(() => {
    if (!staleKey || checking || save.state !== "saved" || autoChecked.current === staleKey) return;
    autoChecked.current = staleKey;
    editedHere.current = false;      // once per edit, never again on the check's own result
    check({ quiet: true });
  }, [staleKey, checking, save.state]);      // eslint-disable-line react-hooks/exhaustive-deps

  latest.current = { subject, data };
  const flush = useCallback(async (overrideRevision) => {
    clearTimeout(timer.current);
    const { subject: s, data: d } = latest.current;
    if (!s || dirty.current.size === 0) return true;
    const keys = [...dirty.current];
    const changes = Object.fromEntries(keys.map((k) => [k, d[k] === undefined ? null : d[k]]));
    setSave({ state: "saving" });
    try {
      const detail = await updateSubject(businessId, feature, s.id, overrideRevision ?? s.revision, changes);
      keys.forEach((k) => { if (latest.current.data[k] === d[k]) dirty.current.delete(k); });
      editedHere.current = true;
      setErrors({});
      accept(detail, true);
      setSave({ state: dirty.current.size ? "pending" : "saved" });
      if (dirty.current.size) timer.current = setTimeout(() => flush(), SAVE_DELAY_MS);
      return true;
    } catch (e) {
      const err = readinessError(e, "Your changes couldn't be saved.");
      if (err.code === "invalid") { setErrors(err.errors); setSave({ state: "error", message: "Some answers need correcting before they can be saved.", invalid: true }); }
      else if (err.code === "stale_revision") setSave({ state: "conflict", message: err.message, current: err.current });
      else setSave({ state: "error", message: err.message });
      return false;
    }
  }, [businessId, feature, accept]);

  const onField = useCallback((path, value) => {
    setData((d) => setPath(d, path, value));
    dirty.current.add(path.split(".")[0]);
    setErrors((e) => { if (!Object.keys(e).some((k) => k === path || k.startsWith(`${path}.`))) return e; const next = { ...e }; Object.keys(next).forEach((k) => { if (k === path || k.startsWith(`${path}.`)) delete next[k]; }); return next; });
    setSave({ state: "pending" });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), SAVE_DELAY_MS);
  }, [flush]);

  const onChanged = useCallback((detail) => (detail && detail.id === subjectId && detail.data ? accept(detail, true) : load()), [accept, load, subjectId]);
  const setTab = (next) => { const p = new URLSearchParams(params); p.set("tab", next); p.delete("section"); setParams(p, { replace: true }); };
  const openSectionAt = (key) => { setOpenSectionState(key); const p = new URLSearchParams(params); p.set("tab", "answers"); p.set("section", key); p.delete("field"); setParams(p, { replace: true }); };
  // A section picked on the Inputs tab: kept in the address, so the next "Fill it in" always opens where it points.
  const pickSection = (key) => { setOpenSectionState(key); const p = new URLSearchParams(params); p.set("section", key); p.delete("field"); setParams(p, { replace: true }); };

  // The Overview is the very result the chat ended on (one record: the same score, count, coverage and steps).
  const revision = subject?.revision;
  const loadOverview = useCallback(async () => {
    // Tried again on a slow or failed request, and the last result kept (the owner's brief, 21 Oct: the Overview fell back
    // to the raw checklist). Only a case with no chat behind it (404) has no Overview result.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await apiRequest(`/businesses/${businessId}/cases/${subjectId}/overview`, "GET", undefined, { timeoutMs: 45000 });
        setOverview(res?.result ? { ...res.result, _edit: res.edit || null, _session: res.session_id } : null);
        return;
      } catch (e) {
        if (e?.status === 404) { setOverview(null); return; }
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    setOverview((was) => (was === undefined ? { _failed: true } : was));
  }, [businessId, subjectId]);
  // The steps from the case itself, worked out again on every change to it (no wait for a check).
  // From what is on the page now, saved or still saving, so a filled step leaves at once (F-9, 22 Oct)
  const optionApplier = useApplyResearch(businessId, researchRun, null, async (out) => { if (out?.research) setResearchRun(out.research); load(); return null; });
  // A launch plan's own steps from its checks, with one-press confirmations, as the funding case has (23 Oct)
  const stepsOfCase = (x, o) => (feature === "launch" ? launchCaseSteps(x, o) : caseSteps(x, o));
  const ownSteps = useMemo(() => stepsOfCase(subject && data ? { ...subject, data } : subject, { max: 50, currency: (data || subject?.data)?.currency || subject?.forecast?.data?.currency }),
    [subject, data]);
  // The steps the last check listed that are filled now: "Done, waiting for recheck" until the check runs again.
  const checkedSteps = useMemo(() => stepsOfCase(subject, { max: 50, currency: subject?.data?.currency }), [subject?.assessment?.id]);      // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = useMemo(() => {
    const now = new Set((ownSteps?.steps || []).map((s) => s.key));
    return (checkedSteps?.steps || []).filter((s) => !now.has(s.key));
  }, [ownSteps, checkedSteps]);
  // One action on the case, said by the one toast system (22 Oct): "Saved. Checking your score…" turning into its result
  // with "Score X → Y" when the check is done, and Undo. Never a line in the page.
  const scoreNow = () => (latest.current.subject?.summary || {}).score ?? null;      // the summary's score, the one everywhere (G5)
  // The amount and date as final, saved on the latest version of the case (never refused as out of date)
  // Changes saved on the latest version of the case or plan (never refused as out of date)
  const saveLatest = async (changes, confirm = []) => {
    if (!(await flush())) throw new Error("unsaved");
    const fresh = await getSubject(businessId, feature, subjectId);
    accept(await updateSubject(businessId, feature, subjectId, fresh.revision, changes, confirm), true);
  };
  const setGoalConfirmed = async (on) => {
    if (!(await flush())) throw new Error("unsaved");
    const fresh = await getSubject(businessId, feature, subjectId);
    accept(await updateSubject(businessId, feature, subjectId, fresh.revision, { timing_confirmed: on }), true);
  };
  const caseAction = ({ title, detail, run, undo = null }) => {
    let after = null;
    return withToast({ title, detail, score: (done) => (done ? after : scoreNow()),
      run: async () => { await run(); await load(); after = await check({ quiet: true, silent: true }); },
      undo: undo ? () => caseAction({ title: "Undone.", detail: "", run: undo }) : null });
  };
  const shown = useMemo(() => (overview && !overview._failed && ownSteps ? { ...overview, case_steps: ownSteps.steps.map((st) => (st.confirmForecast && subject?.forecast ? {
    ...st, run: { label: "Confirm forecast", doneLabel: "Forecast confirmed",
      go: () => caseAction({ title: "Forecast confirmed.", detail: "Your forecast now counts.", run: () => saveForecast(businessId, feature, subject.id, subject.forecast.data, subject.forecast.revision) }) } }
    // A launch plan's confirmations (23 Oct): the offer, no commitments, prerequisites done; each with Undo
    : st.confirmOffer ? { ...st, run: { label: "Confirm", doneLabel: "Confirmed",
      go: () => caseAction({ title: "Offer confirmed.", detail: "What you launch, its price and terms now count.",
        run: () => saveLatest({ offer: { ...(latest.current.data?.offer || {}), confirmed: true } }),
        undo: () => saveLatest({ offer: { ...(latest.current.data?.offer || {}), confirmed: false } }) }) } }
    : st.noCommitments && subject?.forecast ? { ...st, run: { label: "None to list", doneLabel: "Recorded",
      go: () => caseAction({ title: "Recorded: no commitments.", detail: "Add any later in Cash.",
        run: () => saveForecast(businessId, feature, subject.id, { ...subject.forecast.data, no_commitments: true }, subject.forecast.revision) }) } }
    : st.confirmCapacity ? { ...st, run: { label: "Confirm", doneLabel: "Confirmed",
      go: () => caseAction({ title: "Capacity confirmed.", detail: "Your delivery figures now count.",
        run: () => saveLatest({ delivery: { ...(latest.current.data?.delivery || {}) } }, ["capacity"]) }) } }
    : st.prereqDone ? { ...st, run: { label: "Mark done", doneLabel: "Marked done",
      go: () => caseAction({ title: "Prerequisites marked done.", detail: "Attach the evidence under Operational prerequisites.",
        run: () => saveLatest({ prerequisites: (latest.current.data?.prerequisites || []).map((x) => (x && x.applicable !== "no" ? { ...x, status: "completed" } : x)) }),
        undo: () => saveLatest({ prerequisites: (latest.current.data?.prerequisites || []).map((x) => (x && x.applicable !== "no" ? { ...x, status: "not_completed" } : x)) }) }) } }
    : st.confirmGoal ? { ...st, run: { label: "Confirm", doneLabel: "Confirmed",
      go: () => caseAction({ title: "Amount and date confirmed.", detail: "Your funding goal now counts.",
        run: () => setGoalConfirmed(true), undo: () => setGoalConfirmed(false) }) } }
    : st.attest ? { ...st, run: { label: "Confirm", doneLabel: "Confirmed",
      go: () => caseAction({ ...(ATTEST_COPY[`${feature}:${st.attest.code}`] || ATTEST_COPY.default),
        run: () => attest(businessId, feature, subject.id, { code: st.attest.code, passed: true, rationale: st.attest.rationale }),
        undo: () => attest(businessId, feature, subject.id, { code: st.attest.code, withdraw: true }) }) } }
    : st.review ? { ...st, run: { label: "Mark reviewed", doneLabel: "Marked as reviewed",
      go: () => caseAction({ title: "Marked as reviewed.", detail: "Use of funds and forecast now count.",
        run: async () => { for (const key of st.review) await reviewDocument(businessId, subject.id, key, { reviewed: true }); },
        undo: async () => { for (const key of st.review) await reviewDocument(businessId, subject.id, key, { reviewed: false }); } }) } }
    : st)) }
    // A launch plan: the check's steps less those the plan now holds (filled by the owner or the Agent, 23 Oct)
    : overview && !overview._failed && feature === "launch" && subject ? { ...overview, case_steps: openLaunchSteps(stepsOf(overview), subject, data) }
    : overview),
  [overview, ownSteps, subject, data, businessId, feature, load]);
  useEffect(() => { loadOverview(); }, [loadOverview, revision]);
  const runId = params.get("run") || overview?.research?.run_id;
  useEffect(() => {
    if (!runId || !["review", "adopted"].includes(overview?.research?.state || (params.get("run") ? "review" : ""))) { setResearchRun(null); return undefined; }
    let live = true;
    apiRequest(`/businesses/${businessId}/research/${runId}`, "GET").then((r) => { if (live) setResearchRun(r?.research || null); }).catch(() => {});
    return () => { live = false; };
  }, [businessId, runId, overview?.research?.state]);      // eslint-disable-line react-hooks/exhaustive-deps
  const openResearch = () => { const p = new URLSearchParams(params); p.set("tab", "research"); setParams(p, { replace: true }); };
  // "Research again · up to 60 credits" (the owner's QA, 21 Oct): a new search, its price in the spending modal first.
  const [againAsk, setAgainAsk] = useState(null);
  const [againBusy, setAgainBusy] = useState(false);
  const researchAgain = async () => {
    if (!overview?._session || againBusy) return;
    setAgainBusy(true);
    setAgainAsk({ confirm: { pending: true } });      // the modal at once, its price filling in (the owner's QA, 21 Oct)
    try {
      const out = await premiumFlow({ base: `/task-sessions/${overview._session}/premium`, body: { fresh: true }, businessId })();
      setAgainAsk((was) => (was && out?.confirm ? out : null));
    } finally { setAgainBusy(false); }
  };
  const startAgain = async () => {
    if (!againAsk) return;
    setAgainBusy(true);
    try {
      const next = await againAsk.start();
      setAgainAsk(null);
      if (next?.research) { setResearchRun(next.research); const p = new URLSearchParams(params); p.set("tab", "overview"); p.set("run", next.research.id); setParams(p, { replace: true }); }
      window.dispatchEvent(new CustomEvent("ea:credits:refresh"));
    } finally { setAgainBusy(false); }
  };
  // "Fill it in" on a step: the very field, in view and focused (the owner's QA, 21 Oct).
  const wantedField = params.get("field");
  const wantedFocus = params.get("focus");
  useEffect(() => {
    if (tab !== "answers" || (!wantedField && !wantedFocus) || !subject) return undefined;
    // Tried until the field is on the page (the section and its lists render after the tab opens), for up to 3 s; then
    // brought to the middle of the screen, focused and outlined for a moment (the owner's QA, 22 Oct: wrong place)
    let tries = 0;
    let t = null;
    const go = () => {
      const exact = wantedFocus ? document.getElementById(wantedFocus) : null;
      const el = exact || (wantedField === "forecast" ? document.querySelector("[data-forecast-editor]") : wantedField ? document.querySelector(`[data-field="${CSS.escape(wantedField)}"]`) : null);
      if (!el) { if (tries++ < 30) t = setTimeout(go, 100); return; }
      const input = exact || [...el.querySelectorAll("input, textarea, select")].find((x) => !x.value) || el.querySelector("input, textarea, select") || el;
      input.scrollIntoView?.({ block: "center" });
      input.focus?.({ preventScroll: true });
      input.classList?.add("ring-4", "ring-brand-300");
      setTimeout(() => input.classList?.remove("ring-4", "ring-brand-300"), 2500);
    };
    t = setTimeout(go, 150);
    return () => clearTimeout(t);
  }, [tab, wantedField, wantedFocus, subject?.id, openSection]);      // eslint-disable-line react-hooks/exhaustive-deps
  // Advanced holds Evidence, Research, Materials and the full check: an old address opens it at that part.
  useEffect(() => {
    if (tab !== "advanced" || asked === "advanced" || !subject) return;
    const el = document.getElementById(`adv-${asked}`);
    if (el?.scrollIntoView) el.scrollIntoView({ block: "start" });
  }, [tab, asked, subject]);

  // "Run the check again" from a pinned dashboard card: run once the case is loaded, then drop the request from the address.
  const askedAgain = useRef(false);
  useEffect(() => {
    if (params.get("check") !== "again" || !subject || askedAgain.current) return;
    askedAgain.current = true;
    const p = new URLSearchParams(params); p.delete("check"); setParams(p, { replace: true });
    check();
  }, [subject]);      // eslint-disable-line react-hooks/exhaustive-deps

  async function check(opts) {
    setChecking(true);
    setCheckProblem(null);
    try {
      if (!(await flush())) { setCheckProblem("Save your changes first: some answers need correcting."); return; }
      const again = Boolean(latest.current.subject?.latest_assessment || a);
      // One round trip (the owner's QA: a check again in under 3 seconds): the case comes back with the check.
      let ran;
      try { ran = await runAssessment(businessId, feature, subjectId, latest.current.subject.revision, newKey(), true); }
      catch (e) {
        // The case moved on under the page (the Agent's fill, another tab) and nothing here is unsaved: checked on the
        // latest version, never a "reload" banner for the owner (the owner's QA, 22 Oct).
        const err = readinessError(e, "");
        if (err.code !== "stale_revision" || dirty.current.size) throw e;
        const fresh = await getSubject(businessId, feature, subjectId);
        accept(fresh, true);
        ran = await runAssessment(businessId, feature, subjectId, fresh.revision, newKey(), true);
      }
      if (ran?.subject?.id) { accept(ran.subject, true); setProblem(null); } else await load();
      if (!opts?.quiet) setTab("overview");
      // Said when it is done (the owner's QA, 15 Oct): where the case stands now, in one line.
      const r = ran?.result || ran || {};
      const sum = ran?.subject?.summary || {};
      const shownScore = ran?.subject ? (sum.score ?? null) : (typeof r.score_display === "number" ? r.score_display : null);      // the summary's score, never another
      if (!opts?.silent) {
        const where = typeof shownScore === "number" ? `${Math.round(shownScore)}/100` : "";
        toast({ kind: "success", title: again ? "Checked again." : "Checked.", detail: where ? `${where}. The results are up to date.` : "The results are up to date." });
      }
      return shownScore;
    } catch (e) {
      const err = readinessError(e, "The check couldn't be completed. Nothing was changed; you can run it again.");
      setCheckProblem(err.message);
      if (err.code === "stale_revision") load();
    } finally {
      setChecking(false);
    }
  }

  async function changeStatus(action, question) {
    if (question && !(await confirmDialog(question.text, { title: question.title, confirmLabel: question.confirm }))) return;
    try { accept(await setSubjectStatus(businessId, feature, subjectId, action)); } catch (e) { setProblem(readinessError(e)); }
  }

  if (problem && !subject) {
    return (
      <LoadError what={`your ${planWords(feature)[0]}`} detail={problem.message} onRetry={() => { setProblem(null); load(); }}>
        <Btn onClick={() => navigate(meta.base)}>Back to {meta.nounPlural}</Btn>
      </LoadError>
    );
  }
  if (!subject || !data) return <ReadinessDetailSkeleton label={planWords(feature)[0]} />;

  const can = subject.can || {};
  const archived = subject.status === "archived";
  const editable = can[`${feature}.edit`] && !archived;
  const currency = data.currency || subject.forecast?.data?.currency || "GBP";
  const a = subject.assessment;
  const tabs = [["overview", "Overview"], ["answers", "Inputs"], ["advanced", "Advanced"]];
  const sm = subject.summary || {};
  // One score everywhere (G5, 23 Oct): the summary's, as the dashboard, pins and Agent read it; none while a check runs
  const heroScore = checking ? null : (sm.score ?? null);
  const todoCount = (ownSteps?.steps || []).length;
  const neverChecked = !sm.classification && (heroScore === null || heroScore === undefined);
  const heroStatus = neverChecked ? (sm.execution_status === "failed" ? "The last check didn't finish. Run it again to see your score." : "Not checked yet. Run the check to see your score.")
    : [checking ? "Checking…" : heroScore !== null && heroScore !== undefined ? `${Math.round(heroScore)}/100${sm.score_partial ? " so far" : ""}` : "Not scored yet",
    sm.classification === "ready" ? (feature === "launch" ? "Ready to launch" : "Ready to approach funders") : "Not ready yet",
    todoCount ? `${todoCount} ${todoCount === 1 ? "thing" : "things"} to do first` : null].filter(Boolean).join(" · ");
  const heroPills = sectionCounts(subject, ownSteps?.steps || []).map((x) => ({ ...x, state: x.done ? "done" : / to fix$/.test(x.text) || x.answered === 0 ? "fix" : "partly" }));
  const caseRoute = String(data.route_preference || data.route || "").toLowerCase();
  const openActions = (subject.actions || []).filter((x) => ["open", "in_progress", "awaiting_evidence"].includes(x.status)).length;
  const saveText = { saved: "All changes saved", pending: "Saving shortly…", saving: "Saving…", error: save.message, conflict: save.message }[save.state];

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-4">
      <ScoreHero eyebrow={`${feature === "launch" ? "Launch readiness" : "Funding readiness"}${archived ? " · Archived" : ""}`} title={subject.title}
        score={heroScore} status={heroStatus} pills={heroPills} onPill={openSectionAt}
        info={subject.checklist_note ? "Scored against the general checklist; a grant-specific checklist isn't available yet." : null}
        notes={<ChecklistUpdatedOnce id={subject.id} note={subject.checklist_updated} />}
        actions={<>
          {can[`${feature}.edit`] && archived ? <Btn kind="primary" onClick={() => changeStatus("reactivate")}>Reactivate</Btn>
            : feature === "launch" && subject.status === "cancelled" && can["launch.decide"] ? <Btn kind="primary" onClick={() => changeStatus("reopen")}>Reopen</Btn>
            : can[`${feature}.assess`] && subject.status !== "cancelled" && !a ? (
              <Btn kind="primary" disabled={checking} onClick={check} data-case-primary>{checking && <ButtonSpinner />}{checking ? "Checking…" : "Run the check"}</Btn>
            ) : editable && tab !== "answers" ? <Btn kind="primary" onClick={() => setTab("answers")} data-case-primary>Edit inputs</Btn> : null}
          {(editable || can[`${feature}.assess`]) && (
            <div className="relative">
              <button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)} data-case-menu
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
              </button>
              {menu && (
                <div role="menu" className="absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {editable && <button type="button" role="menuitem" className={MENU_ROW} onClick={() => { setMenu(false); onField("pinned", !data.pinned); }}>{data.pinned ? "Unpin from dashboard" : "Pin to dashboard"}</button>}
                  {can[`${feature}.assess`] && !archived && subject.status !== "cancelled" && a && (
                    <button type="button" role="menuitem" className={MENU_ROW} disabled={checking} onClick={() => { setMenu(false); check(); }}>{checking ? "Checking again…" : "Run the check again"}</button>
                  )}
                  {overview?._session && editable && <button type="button" role="menuitem" className={MENU_ROW} onClick={() => { setMenu(false); researchAgain(); }} data-menu-research-again>Research again · up to 60 credits</button>}
                  {feature !== "funding" && <button type="button" role="menuitem" className={MENU_ROW} onClick={() => { setMenu(false); navigate(meta.base); }}>All {meta.nounPlural}</button>}
                  {can[`${feature}.edit`] && !archived && subject.status !== "launched" && (
                    <button type="button" role="menuitem" className={MENU_ROW} onClick={() => { setMenu(false); changeStatus("archive", { title: `Archive this ${meta.noun}?`, text: "It stays readable and exportable, with all its checks. You'll need to reactivate it before editing or checking again.", confirm: "Archive" }); }}>Archive</button>
                  )}
                </div>
              )}
            </div>
          )}
</>} />

      {arrived && (
        <div role="status" data-goal-handoff className="flex items-start justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-900 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-100">
          <p>{arrived}</p>
          <button type="button" onClick={dismissArrived} className="shrink-0 text-[12px] font-semibold text-brand-700 hover:underline dark:text-brand-300">Dismiss</button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {editable && tab === "answers" && (
          <span role="status" className={`flex items-center gap-2 text-[12px] ${save.state === "error" || save.state === "conflict" ? "font-semibold text-rose-600" : "text-slate-500"}`}>
            {saveText}
            {save.state === "error" && !save.invalid && <Btn kind="link" className="text-[12px]" onClick={() => flush()}>Try again</Btn>}
          </span>
        )}
      </div>

      {checking && <Notice>Checking against the checklist… You can leave this page: the check carries on and its result will be here when you come back.</Notice>}
      {checkProblem && <Notice tone="rose" role="alert">{checkProblem}</Notice>}
      {problem && <Notice tone="rose" role="alert">{problem.message}</Notice>}
      {archived && <Notice>This {meta.noun} is archived. It can be read and exported; reactivate it to edit it or run a new check.</Notice>}
      {!can[`${feature}.edit`] && <Notice>Your role can view this {meta.noun} but not change it.</Notice>}
      {save.state === "conflict" && (
        <Notice tone="amber" role="alert">
          <p className="font-semibold">{save.message}</p>
          <p className="mt-1">Your unsaved answers are still on this page. Changed by you: {[...dirty.current].join(", ") || "nothing"}.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn kind="primary" onClick={() => flush(save.current?.revision)}>Apply my changes to the latest version</Btn>
            <Btn onClick={() => { dirty.current = new Set(); setSave({ state: "saved" }); load(); }}>Discard mine and load the latest</Btn>
          </div>
        </Notice>
      )}
      {dateReview && (
        <Notice tone="amber">
          <p className="font-semibold">The launch date changed. These dates were set by hand and may need changing; none has been changed for you:</p>
          <ul className="mt-1 list-disc pl-5">{dateReview.map((d) => <li key={`${d.path}-${d.id}-${d.issue}`}>{d.label || "Untitled"} ({dateLabel(d.date)}): {d.issue}</li>)}</ul>
          <Btn kind="link" className="mt-1" onClick={() => setDateReview(null)}>I've reviewed these</Btn>
        </Notice>
      )}
      {a?.freshness?.status === "stale" && tab !== "overview" && (
        <Notice tone="amber">{checking ? "The details changed, so the check is being run again for you." : `The last result is out of date. ${staleReason(a.freshness.reason)}`}</Notice>
      )}

      <PremiumConfirm result={overview} confirm={againAsk?.confirm} working={againBusy} onStart={startAgain} onClose={() => setAgainAsk(null)} title="Research again for your funding case" />
      <div role="tablist" aria-label={`${meta.title} sections`} className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} onClick={() => setTab(key)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition ${tab === key ? "border-brand-600 text-brand-700 dark:text-brand-300" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {/* No "previous need" review (the owner's QA, 15 Oct): Replace replaced it, Update changed only what differed. The
            earlier need stays in History. */}
        {tab === "answers" && (
          <Setup businessId={businessId} feature={feature} subject={subject} errors={errors}
            // A launch plan has no currency of its own: its money fields show the business's, as its forecast does (23 Oct)
            data={feature === "launch" && !data.currency && subject.forecast?.data?.currency ? { ...data, currency: subject.forecast.data.currency } : data} onField={onField} onChanged={onChanged}
            openSection={openSection || subject.profile_definition.sections[0].key} setOpenSection={pickSection} disabled={!editable}
            recheck={() => check({ quiet: true, silent: true })}
            onNewNeed={feature === "funding" ? (body) => caseAction({ title: "New funding need started.", detail: "The previous need is in History.",
              run: async () => { if (!(await flush())) throw new Error("unsaved"); accept(await startNewNeed(businessId, subjectId, body), true); } }) : null} />
        )}
        {tab === "overview" && (
          <div className="space-y-4" data-case-overview>
            {overview === undefined ? (
              // The case's own steps at once (F-5): they come from the case itself, never waiting on the chat's result
              ownSteps?.steps?.length
                ? <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" data-steps-first>
                    <NextSteps result={{ assessment_type: feature === "launch" ? "launch_readiness_initial" : "funding_readiness_initial", blockers: [], criteria: [], case_steps: ownSteps.steps,
                      assessment: { kind: feature, case_id: subject.id } }} businessId={businessId} />
                  </div>
                : <p className="text-[13px] text-slate-500">Loading your result…</p>
            ) : overview?._failed ? (
              <Panel>
                <p className="text-sm text-slate-700 dark:text-slate-200">Your result is taking longer than usual to load.</p>
                <Btn className="mt-2" onClick={() => { setOverview(undefined); loadOverview(); }}>Try again</Btn>
              </Panel>
            ) : overview && ownSteps && !ownSteps.steps?.length ? (
              // Nothing left to do: said, never a blank Overview (G5, 23 Oct)
              <Panel>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100" data-nothing-left>
                  {checking ? "Checking…" : sm.classification === "ready" ? (feature === "launch" ? "Nothing left to do. You're ready to launch." : "Nothing left to do. You're ready to approach funders.")
                    : sm.freshness === "stale" ? "Your steps are done. Run the check again to see your score." : "No steps left from this check."}
                </p>
                {!checking && sm.freshness === "stale" && editable && <Btn className="mt-2" onClick={() => check()} data-check-again>Run the check again</Btn>}
              </Panel>
            ) : overview ? (
              // The one-page result the chat ended on, from the same record; the status is in the header (said once).
              // Nothing left in it (no steps, research adopted): not shown, never an empty card (the owner's QA, 22 Oct).
              <FirstValueCard result={shown} hideStatus hideOpen embedded className="border-slate-200"
                run={["review", "adopted"].includes(researchRun?.status) ? researchRun : null} onRun={setResearchRun}
                onUpdated={(r) => {
                  setOverview(r); load();
                  // Adopted from a step card: the run is too, so "What to do next" takes the steps' place.
                  if (r?.research?.state === "adopted" && researchRun?.status === "review" && (!r.research.run_id || r.research.run_id === researchRun.id)) setResearchRun((x) => x && { ...x, status: "adopted" });
                }}
                onPremium={overview._session ? premiumFlow({ base: `/task-sessions/${overview._session}/premium`, businessId, onAdopted: () => { loadOverview(); load(); } }) : null} />
            ) : a?.result ? (
              <Panel title="Your next steps" actions={openActions > 3 ? <Btn kind="link" onClick={() => setAllSteps((v) => !v)} data-see-all-steps>{allSteps ? "Show fewer" : `See all (${openActions})`}</Btn> : null}>
                <ActionsPanel businessId={businessId} feature={feature} subject={subject} onChanged={onChanged} onOpenSection={openSectionAt} limit={allSteps ? undefined : 3} />
                <p className="mt-3 text-[12px] text-slate-500">This is a look at how prepared you are, not whether {feature === "launch" ? "the launch will succeed" : "funding will be given"}.</p>
              </Panel>
            ) : (
              <Panel>
                <p className="text-sm text-slate-700 dark:text-slate-200">{a?.execution_status === "failed" ? a.failure : "Not checked yet. Run the check to see your score."}</p>
                <p className="mt-1 text-[13px] text-slate-500">You can run it at any point, for free. Anything you haven't answered is shown as not known yet; nothing is filled in for you.</p>
              </Panel>
            )}
          </div>
        )}
        {tab === "overview" && waiting.length > 0 && (
          // Filled since the last check (F-9): out of "Your next steps" at once, listed here until the check runs again.
          <details className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] dark:border-slate-800 dark:bg-slate-900" data-waiting-recheck>
            <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-200">Done, waiting for recheck ({waiting.length})</summary>
            <ul className="mt-2 space-y-1 text-slate-600 dark:text-slate-300">{waiting.map((w) => <li key={w.key}>{w.title}</li>)}</ul>
          </details>
        )}
        {tab === "overview" && (
          <div className="mt-4 space-y-6">
            {feature === "funding" && (() => {
              const options = fundingOptions({ route: caseRoute, saved: data.funding_options || [], run: researchRun });
              const others = options.length ? [] : fundingOptions({ route: "any", saved: data.funding_options || [], run: researchRun }).filter((o) => o.route !== caseRoute);
              return (
                <FundingOptions route={caseRoute} options={options} others={others} searched={Boolean(researchRun)}
                  onSave={researchRun ? (o) => optionApplier.apply(o.item_id || o.id, { decision: "accept", pressed: true }) : null}
                  onHide={researchRun ? (o) => optionApplier.apply(o.item_id || o.id, { decision: "reject" }) : null} />
              );
            })()}
            {feature === "funding" && researchRun && (
              <ResearchFindings items={researchFindings(researchRun)} decided={optionApplier.decided || {}}
                onSave={(f) => optionApplier.apply(f.id, { decision: "accept", pressed: true })}
                onHide={(f) => optionApplier.apply(f.id, { decision: "reject" })} />
            )}
            {["review", "adopted"].includes(overview?.research?.state) && relatedReady(subject.summary, 75, heroScore) && (
              // Ready (75 or above), after this need's research: related services as cards (F-8), below what was found
              <RelatedCards items={relatedServices({ feature, subject, packLocked }).filter((r) => r.key !== "pack")} />
            )}
            {feature === "funding" && (
              <PackStrip pack={subject.summary?.pack} caseReady={subject.summary?.classification === "ready"} to={`/funding/${subject.id}?tab=documents`} locked={packLocked} />
            )}
            {feature === "funding" && (
              // Once, at the foot of the Overview: what the score is and isn't
              <p className="text-[12px] text-slate-500 dark:text-slate-400" data-case-note>This is a look at how prepared you are. It is not a view on whether funding will be given.</p>
            )}
          </div>
        )}
        {tab === "advanced" && (
          // Every part collapsed by default (the owner's brief, 20 Oct); an old address opens its own part.
          <div className="space-y-3" data-case-advanced>
            {subject.checklist_note && <p className="text-[12.5px] text-slate-500" data-checklist-note>{subject.checklist_note}</p>}
            {a?.result && (
              <Fold id="results" title="The full check" open={asked === "results" || asked === "scenarios"}>
                <CheckBasis summary={subject.summary} feature={feature} />
                {subject.checklist_note && <p className="mb-3 text-[12.5px] text-slate-600" data-checklist-label>{subject.checklist_note} Scored against the general checklist; a grant-specific checklist isn't available yet.</p>}
                <ResultView assessment={a} feature={feature} currency={currency} onOpenSection={openSectionAt}
                  summary={overview ? <ResultStatus result={overview} latest={latestOf(overview)} /> : null} />
              </Fold>
            )}
            <Fold id="actions" title="All steps" open={asked === "actions"}>
              {overview ? (
                // The same steps as the Overview and the header's count (the owner's QA, 21 Oct).
                <ol className="space-y-2" data-all-steps>
                  {stepsOf(overview).map((st, n) => (
                    <li key={st.key} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
                      <span className="min-w-0 text-[13.5px] text-slate-800 dark:text-slate-100">{n + 1}. {st.title}</span>
                      <span className="text-[11.5px] font-semibold text-slate-500">{st.badge}</span>
                    </li>
                  ))}
                </ol>
              ) : <ActionsPanel businessId={businessId} feature={feature} subject={subject} onChanged={onChanged} onOpenSection={openSectionAt} />}
            </Fold>
            <Fold id="evidence" title="Evidence" open={asked === "evidence"}>
              <p className="mb-3 text-[12.5px] text-slate-500">Everything attached to this check, with its source and date.</p>
              <EvidenceList businessId={businessId} feature={feature} subject={subject} onChanged={onChanged}
                startAdding={params.get("add") === "evidence"} onAddedReturn={() => setTab("overview")} />
            </Fold>
            {Object.keys(data.provenance || {}).length > 0 && (
              <Fold id="sources" title="Where your answers came from" open={asked === "sources"}>
                <ul className="divide-y divide-slate-100 text-[13px] dark:divide-slate-800">
                  {Object.entries(data.provenance).map(([path, p]) => (
                    <li key={path} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 py-1.5">
                      <span className="min-w-0 text-slate-700 dark:text-slate-200">{plainAnswer(path, getPath(data, path), subject, currency)}</span>
                      <span className="text-slate-500">{typeof p === "string" ? p : `${String(p.source || "").replace(/^./, (c) => c.toUpperCase())}${p.as_of ? ` · ${dateLabel(p.as_of)}` : ""}`}</span>
                    </li>
                  ))}
                </ul>
              </Fold>
            )}
            <Fold id="research" title="Research" open={asked === "research"}>
              {overview?._session && editable && (
                <Btn kind="primary" className="mb-3 max-sm:w-full" disabled={againBusy} onClick={researchAgain} data-research-again>
                  {againBusy && !againAsk ? "Getting the price…" : "Research again · up to 60 credits"}</Btn>
              )}
              <SavedResearch businessId={businessId} goal={feature === "funding" ? "need_funding" : "launch"} />
            </Fold>
            <Fold id="documents" title={meta.documentsTitle} open={asked === "documents"}>
              {packLocked ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-950" data-funding-pack-locked>
                  <p className="font-semibold">The funding pack is included on the Decision Engine plan and above.</p>
                  <p className="mt-0.5">Your check, results and actions stay available on your plan. Upgrade to prepare the readiness report, executive summary and pitch outline.</p>
                  <a href="/pricing" className="mt-2 inline-flex rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700">See plans</a>
                </div>
              ) : <MaterialsPanel businessId={businessId} feature={feature} subject={subject} onChanged={onChanged} />}
            </Fold>
            <Fold id="scenarios" title="Scenarios" open={asked === "scenarios"}>
              <p className="mb-3 text-[12.5px] text-slate-500">Compare a change with your baseline. Nothing is saved and your records are not changed.</p>
              <ScenarioPanel businessId={businessId} feature={feature} subject={subject} currency={currency} />
            </Fold>
            {feature === "launch" && <Fold id="decision" title="Decision" open={asked === "decision"}><DecisionPanel businessId={businessId} subject={subject} onChanged={onChanged} /></Fold>}
            <Fold id="history" title="History" open={asked === "history"}>
              {(subject.data?.previous_needs || []).map((p) => (
                <p key={p.replaced_at + (p.title || "")} className="mb-2 rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-700 dark:bg-slate-800/60 dark:text-slate-200" data-replaced-need>
                  Earlier version, {dateLabel(p.replaced_at)}: {p.title}{p.summary ? ` (${p.summary})` : ""}</p>
              ))}
              <HistoryPanel businessId={businessId} feature={feature} subject={subject} currency={currency} />
            </Fold>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReadinessPage({ feature }) {
  const meta = FEATURES[feature];
  const { subjectId } = useParams();
  const businessId = useWorkspaceStore((s) => s.workspaceId);
  const subscription = useAuthStore((st) => st.subscription);
  const platformGrants = useAuthStore((st) => st.platformGrants);
  if (!businessId) return <ContentSkeleton label="your business" />;
  if (!hasReadiness(subscription, platformGrants)) {
    // Launch and Funding Readiness are on Starter and above (the pricing PDF, 19 Oct 2026).
    return (
      <div className="space-y-4">
        <PageHeader title={meta.title} description={meta.intro} />
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950" data-readiness-locked>
          <p className="text-[16px] font-semibold">{feature === "launch" ? "Product/Service Launch Readiness" : "AI-Powered Funding Readiness"} is included on the Starter plan and above.</p>
          <p className="mt-1 text-[14px]">Upgrade to see how ready you are, what to fix first, and to keep your {feature === "launch" ? "launch plan" : "funding case"} up to date.</p>
          <a href="/pricing" className="mt-3 inline-flex rounded-xl bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-700">See plans</a>
        </div>
      </div>
    );
  }
  if (subjectId) return <SubjectDetail key={`${businessId}-${subjectId}`} businessId={businessId} feature={feature} subjectId={subjectId} />;
  return (
    <div className="space-y-4">
      <PageHeader title={meta.title} description={meta.intro} />
      {/* The free first value first: a short conversation and a provisional result; the full checklist stays below. */}
      <QuickCheck key={`qc-${businessId}`} businessId={businessId} goalKey={feature === "launch" ? "launch" : "need_funding"} />
      <SubjectList key={businessId} businessId={businessId} feature={feature} />
    </div>
  );
}
