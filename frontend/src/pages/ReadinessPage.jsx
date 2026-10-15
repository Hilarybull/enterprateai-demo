import UkDateInput from "../components/UkDateInput";
import ResearchReview from "../components/ResearchReview";
import { apiRequest } from "../api/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import QuickCheck from "../components/QuickCheck";
import { ButtonSpinner, ContentSkeleton, LoadError, ReadinessDetailSkeleton, ReadinessListSkeleton } from "../components/Skeleton";
import { Attestation, EvidenceList } from "../components/readiness/Evidence";
import { Btn, Field, Notice, Panel, Pill } from "../components/readiness/Fields";
import ForecastEditor from "../components/readiness/ForecastEditor";
import { ActionsPanel, DecisionPanel, HistoryPanel, MaterialsPanel, RequiredDocuments, ResultView, ScenarioPanel } from "../components/readiness/Panels";
import { confirmDialog } from "../lib/dialog";
import {
  CLASSIFICATION, FEATURES, LIFECYCLE, createSubject, dateLabel, getPath, getSubject, listSubjects, moneyLabel, newKey, readinessError, runAssessment,
  keepPrevious, setPath, setSubjectStatus, updateSubject,
  staleReason,
} from "../lib/readiness";
import { useWorkspaceStore } from "../store/workspace";

// Funding Readiness and Launch Readiness: one set of screens for both. `feature` is
// "funding" or "launch"; the questions, checks and wording come from the checklist profile.

const SAVE_DELAY_MS = 1200;

// What the page being loaded is called: "launch plan", "funding case".
const planWords = (feature) => (feature === "launch" ? ["launch plan", "launch plans"] : ["funding case", "funding cases"]);

function StatusLine({ summary, feature }) {
  if (!summary?.classification) {
    return <span className="text-[13px] text-slate-500">{summary?.execution_status === "failed" ? "The last check didn't finish" : "Not checked yet"}</span>;
  }
  const cls = CLASSIFICATION[summary.classification];
  const coverage = summary.coverage ?? summary.evidence_coverage;
  return (
    <span className="flex flex-wrap items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
      <Pill tone={cls.tone} mark={cls.mark}>{cls.label}</Pill>
      {summary.score !== null && summary.score !== undefined ? <span>Score {summary.score}</span> : <span>No overall score yet</span>}
      {coverage !== null && coverage !== undefined && <span>· {coverage}% evidence</span>}
      {summary.blocker_count > 0 && <span>· {summary.blocker_count} {feature === "launch" ? "blocker" : "failed gate"}{summary.blocker_count !== 1 ? "s" : ""}</span>}
      {summary.freshness === "stale" && <Pill tone="amber" mark="!">Out of date</Pill>}
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
  const [params] = useSearchParams();
  const asked = params.get("run");
  useEffect(() => {
    apiRequest(`/businesses/${businessId}/research-runs?goal=${goal}`, "GET").then((r) => setRuns(r?.runs || [])).catch(() => setRuns([]));
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
    const out = await apiRequest(`/businesses/${businessId}/research/${id}`, "GET").catch(() => null);
    if (out?.research) setOpen(out.research);
  };
  return (
    <div className="space-y-3" data-saved-research>
      <ul className="space-y-2">
        {runs.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700" data-research-run={r.id}>
            <span className="text-[13px] text-slate-800 dark:text-slate-100">{dateLabel(r.created_at)} · {r.findings} finding{r.findings === 1 ? "" : "s"} · {r.status === "adopted" ? "Reviewed and adopted" : "Waiting for your review"}</span>
            <Btn onClick={() => show(r.id)}>{r.status === "adopted" ? "Open" : "Review findings"}</Btn>
          </li>
        ))}
      </ul>
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
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !e.target.closest?.("[data-row-menu]")) setOpen(false); };
    window.addEventListener("keydown", close);
    window.addEventListener("mousedown", close);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("mousedown", close); };
  }, [open]);
  const pick = (fn) => () => { setOpen(false); fn(); };
  const item = "block w-full px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800";
  return (
    <div className="relative" data-row-menu>
      <button type="button" aria-label={`Actions for ${label}`} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <button type="button" role="menuitem" className={item} onClick={pick(onView)}>{viewing ? "Hide details" : "View details"}</button>
          <button type="button" role="menuitem" className={item} onClick={pick(onKeep)}>Keep</button>
          <button type="button" role="menuitem" className={`${item} text-rose-700 dark:text-rose-300`} onClick={pick(onRemove)}>Remove</button>
        </div>
      )}
    </div>
  );
}

const PREVIEW_LABEL = { title: "Title", says: "What it says", kind: "Type", dated: "Dated", checked: "Checked", figures: "Figures", reviewed_on: "Reviewed on",
  notes: "Notes", prepared: "Prepared" };
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
  const review = prev.review || {};
  const words = { market: "Market details", traction: "Traction", use_of_funds: "Use of funds", milestones: "Milestones" };
  const items = [
    ...(prev.evidence || []).map((e) => ({ id: `evidence:${e.id}`, label: e.title, note: e.date ? `dated ${String(e.date).slice(0, 10)}` : "", detail: e.preview || e.detail || "", evidence: e.id })),
    ...Object.keys(prev.documents || {}).map((k) => ({ id: `document:${k}`, label: k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), note: "", detail: prev.documents[k]?.preview || {} })),
    ...Object.keys(prev.set_aside || {}).filter((k) => words[k]).map((k) => ({ id: k, label: words[k], note: "", detail: prev.set_aside[k] })),
  ].filter((i) => !review[i.id]);
  if (!items.length) return null;
  const decide = async (item, keep) => {
    setBusy(item);
    try { onChanged(await keepPrevious(businessId, subject.id, item, keep)); setViewing(null); } finally { setBusy(""); }
  };
  const close = () => { setViewing(null); setListing(false); };
  const shown = viewing && items.find((i) => i.id === viewing.id);
  return (
    <>
      {/* One line on every tab; the list itself opens as a popup (the owner's QA, 15 Oct). */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[13px] text-amber-900" data-previous-need-line>
        <span>{items.length} thing{items.length === 1 ? "" : "s"} from your previous funding need to keep or remove. They don't count in your score until you keep them.</span>
        <Btn onClick={() => setListing(true)}>Review</Btn>
      </div>
      {listing && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div role="dialog" aria-modal="true" aria-label={shown ? shown.label : "From your previous funding need"} data-previous-need
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <div className="min-w-0">
                {shown && <button type="button" onClick={() => setViewing(null)} className="mb-1 text-[12.5px] font-semibold text-brand-700 hover:underline">Back to the list</button>}
                <p className="text-base font-bold text-slate-900 dark:text-slate-100">{shown ? shown.label : "From your previous funding need. Still relevant?"}</p>
                {!shown && <p className="mt-0.5 text-[13px] text-slate-500">Replaced on {dateLabel(prev.replaced_at)}{prev.summary ? `: ${prev.summary}` : ""}.</p>}
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
                <ul className="space-y-2">
                  {items.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800" data-previous-item={i.id}>
                      <button type="button" onClick={() => setViewing(i)} className="min-w-0 text-left text-[13px] text-slate-800 hover:text-brand-700 dark:text-slate-200">
                        {i.label}{i.note && <span className="text-slate-500"> · {i.note}</span>}
                      </button>
                      <RowMenu label={i.label} disabled={busy === i.id} viewing={false}
                        onView={() => setViewing(i)} onKeep={() => decide(i.id, true)} onRemove={() => decide(i.id, false)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {shown && (
              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
                <Btn disabled={busy === shown.id} onClick={() => decide(shown.id, false)}>Remove</Btn>
                <Btn kind="primary" disabled={busy === shown.id} onClick={() => decide(shown.id, true)}>Keep</Btn>
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
  const [creating, setCreating] = useState(false);

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
      {/* A business has one funding case, kept up to date; several launches are fine. */}
      {items.length > 0 && !creating && canEdit && feature !== "funding" && <Btn onClick={() => setCreating(true)}>{meta.newLabel}</Btn>}
      {items.length > 0 && feature === "funding" && (
        <p className="text-[12.5px] text-slate-500" data-one-funding-case>
          Your business has one funding case. Update it as things change{archived.length && !active.length ? ", or reactivate it" : ""}: every check and review adds to it.
        </p>
      )}
      {archived.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[13px] font-semibold text-slate-600 dark:text-slate-300">Archived ({archived.length})</summary>
          <ul className="mt-2 space-y-3">{archived.map(row)}</ul>
        </details>
      )}
      {state.profiles?.current && <p className="text-[12px] text-slate-500">Checklist: {state.profiles.current.title}, version {state.profiles.current.version}. {state.profiles.current.status_note}</p>}
    </div>
  );
}

// ── Detail ────────────────────────────────────────────────────────────────────

function Setup({ businessId, feature, subject, data, errors, onField, onChanged, openSection, setOpenSection, disabled }) {
  const sections = subject.profile_definition.sections;
  const progress = Object.fromEntries((subject.sections || []).map((s) => [s.key, s]));
  const index = Math.max(0, sections.findIndex((s) => s.key === openSection));
  const section = sections[index];
  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
      <nav aria-label="Sections">
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

      <Panel title={`${index + 1}. ${section.title}`} id={`section-${section.key}`}>
        <div className="space-y-4">
          {section.fields.map((f) => <Field key={f.key} field={f} data={data} errors={errors} disabled={disabled} evidence={subject.evidence} onChange={onField} idBase={section.key} />)}
          {section.forecast && (
            <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
              <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">{feature === "funding" ? "12-month cash forecast" : "Cash projection"}</h3>
              <ForecastEditor businessId={businessId} feature={feature} subject={subject} evidence={subject.evidence} onSaved={onChanged} disabled={disabled} />
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
            <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
              <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">Preparation documents</h3>
              <RequiredDocuments businessId={businessId} subject={subject} onChanged={onChanged} />
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
  const tab = params.get("tab") || "setup";
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

  // The result is kept current for the owner: when the details change after a check, the check
  // runs again by itself, once the changes are saved. Tried once per version; if it can't
  // finish, the reason is shown and the button is still there.
  const autoChecked = useRef("");
  const staleKey = subject?.assessment?.freshness?.status === "stale" && subject?.can?.[`${feature}.edit`] && subject.status !== "archived"
    ? `${subjectId}:${subject.revision}` : "";
  useEffect(() => {
    if (!staleKey || checking || save.state !== "saved" || autoChecked.current === staleKey) return;
    autoChecked.current = staleKey;
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
  const openSectionAt = (key) => { setOpenSectionState(key); const p = new URLSearchParams(params); p.set("tab", "setup"); setParams(p, { replace: true }); };

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
      await runAssessment(businessId, feature, subjectId, latest.current.subject.revision, newKey());
      await load();
      if (!opts?.quiet) setTab("results");
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
  const tabs = [["setup", "Guided setup"], ["evidence", "Evidence"], ["results", "Results"], ["actions", `Actions${subject.summary?.open_actions ? ` (${subject.summary.open_actions})` : ""}`],
    ["documents", meta.documentsTitle], ["research", "Research"], ["scenarios", "Scenarios"], ["history", "History"],
    ...(feature === "launch" ? [["decision", "Decision"]] : [])];
  const saveText = { saved: "All changes saved", pending: "Saving shortly…", saving: "Saving…", error: save.message, conflict: save.message }[save.state];

  return (
    <div className="space-y-4">
      <PageHeader
        title={subject.title}
        description={`${meta.title} · ${LIFECYCLE[subject.status]}${feature === "launch" && data.target_date ? ` · target ${dateLabel(data.target_date)}` : ""}`}
        actions={(
          <>
            {feature !== "funding" && <Btn onClick={() => navigate(meta.base)}>All {meta.nounPlural}</Btn>}
            {editable && <Btn onClick={() => onField("pinned", !data.pinned)}>{data.pinned ? "Unpin from dashboard" : "Pin to dashboard"}</Btn>}
            {can[`${feature}.edit`] && !archived && subject.status !== "launched" && (
              <Btn onClick={() => changeStatus("archive", { title: `Archive this ${meta.noun}?`, text: "It stays readable and exportable, with all its checks. You'll need to reactivate it before editing or checking again.", confirm: "Archive" })}>Archive</Btn>
            )}
            {can[`${feature}.edit`] && archived && <Btn kind="primary" onClick={() => changeStatus("reactivate")}>Reactivate</Btn>}
            {feature === "launch" && subject.status === "cancelled" && can["launch.decide"] && <Btn kind="primary" onClick={() => changeStatus("reopen")}>Reopen</Btn>}
            {can[`${feature}.assess`] && !archived && subject.status !== "cancelled" && (
              <Btn kind="primary" disabled={checking} onClick={check}>{checking && <ButtonSpinner />}{checking ? "Checking…" : a ? "Run the check again" : "Run the check"}</Btn>
            )}
          </>
        )}
      />

      {arrived && (
        <div role="status" data-goal-handoff className="flex items-start justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-900 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-100">
          <p>{arrived}</p>
          <button type="button" onClick={dismissArrived} className="shrink-0 text-[12px] font-semibold text-brand-700 hover:underline dark:text-brand-300">Dismiss</button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusLine summary={subject.summary} feature={feature} />
        {editable && (
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
      {a?.freshness?.status === "stale" && tab !== "results" && (
        <Notice tone="amber">{checking ? "The details changed, so the check is being run again for you." : `The last result is out of date. ${staleReason(a.freshness.reason)}`}</Notice>
      )}

      <div role="tablist" aria-label={`${meta.title} sections`} className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} onClick={() => setTab(key)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition ${tab === key ? "border-brand-600 text-brand-700 dark:text-brand-300" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {feature === "funding" && <PreviousNeed businessId={businessId} subject={subject} onChanged={(d) => accept(d)} />}
        {tab === "setup" && (
          <Setup businessId={businessId} feature={feature} subject={subject} data={data} errors={errors} onField={onField} onChanged={onChanged}
            openSection={openSection || subject.profile_definition.sections[0].key} setOpenSection={setOpenSectionState} disabled={!editable} />
        )}
        {tab === "evidence" && (
          <Panel title="Evidence" description="Everything attached to this check, with its source and date. Evidence keeps its original date when it is reviewed again.">
            <EvidenceList businessId={businessId} feature={feature} subject={subject} onChanged={onChanged} />
            {Object.keys(data.provenance || {}).length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Reused from your business records</h3>
                <ul className="mt-2 divide-y divide-slate-100 text-[13px] dark:divide-slate-800">
                  {Object.entries(data.provenance).map(([path, p]) => (
                    <li key={path} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span className="text-slate-700 dark:text-slate-200">{path.replace(/[._]/g, " ")}: <span className="font-semibold">{String(Array.isArray(getPath(data, path)) ? `${getPath(data, path).length} items` : getPath(data, path))}</span></span>
                      <span className="text-slate-500">{p.source} · copied {dateLabel(p.as_of)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[12px] text-slate-500">Changing one of these here changes it for this check only. Your business records are not touched.</p>
              </div>
            )}
          </Panel>
        )}
        {tab === "results" && (a?.result ? (
          <div className="space-y-4">
            <ResultView assessment={a} feature={feature} currency={currency} onOpenSection={openSectionAt} />
            <Panel title="Your next three actions" actions={<Btn kind="link" onClick={() => setTab("actions")}>See all actions</Btn>}>
              <ActionsPanel businessId={businessId} feature={feature} subject={subject} onChanged={onChanged} onOpenSection={openSectionAt} limit={3} />
            </Panel>
          </div>
        ) : (
          <Panel>
            <p className="text-sm text-slate-700 dark:text-slate-200">{a?.execution_status === "failed" ? a.failure : "No check has been run yet."}</p>
            <p className="mt-1 text-[13px] text-slate-500">You can run it at any point. Anything you haven't answered is shown as not known yet; nothing is filled in for you.</p>
            {can[`${feature}.assess`] && !archived && <Btn kind="primary" className="mt-3" disabled={checking} onClick={check}>{checking ? "Checking…" : a ? "Try the check again" : "Run the check"}</Btn>}
          </Panel>
        ))}
        {tab === "actions" && <Panel title="Actions"><ActionsPanel businessId={businessId} feature={feature} subject={subject} onChanged={onChanged} onOpenSection={openSectionAt} /></Panel>}
        {tab === "documents" && (
          <Panel title={meta.documentsTitle} description="Prepared from one check, with the figures as they were on that date. A newer version replaces an older one; the older one is never rewritten.">
            <MaterialsPanel businessId={businessId} feature={feature} subject={subject} onChanged={onChanged} />
          </Panel>
        )}
        {tab === "scenarios" && (
          <Panel title="Scenarios" description="Compare a change with your baseline. Nothing is saved and your records are not changed.">
            <ScenarioPanel businessId={businessId} feature={feature} subject={subject} currency={currency} />
          </Panel>
        )}
        {tab === "research" && (
          <Panel title="Research" description="Each research run, kept with its sources, drafts and what you reviewed. Open it any time at no cost.">
            <SavedResearch businessId={businessId} goal={feature === "funding" ? "need_funding" : "launch"} />
          </Panel>
        )}
        {tab === "history" && <Panel title="History" description="Every check, kept as it was.">
          {(subject.data?.previous_needs || []).map((p) => (
            <p key={p.replaced_at + (p.title || "")} className="mb-2 rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-700 dark:bg-slate-800/60 dark:text-slate-200" data-replaced-need>
              Replaced on {dateLabel(p.replaced_at)}: {p.title}{p.summary ? ` (${p.summary})` : ""}</p>
          ))}
          <HistoryPanel businessId={businessId} feature={feature} subject={subject} currency={currency} /></Panel>}
        {tab === "decision" && feature === "launch" && <DecisionPanel businessId={businessId} subject={subject} onChanged={onChanged} />}
      </div>
    </div>
  );
}

export default function ReadinessPage({ feature }) {
  const meta = FEATURES[feature];
  const { subjectId } = useParams();
  const businessId = useWorkspaceStore((s) => s.workspaceId);
  if (!businessId) return <ContentSkeleton label="your business" />;
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
