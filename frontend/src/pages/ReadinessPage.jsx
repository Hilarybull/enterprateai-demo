import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { ButtonSpinner, ContentSkeleton, LoadError, ReadinessDetailSkeleton, ReadinessListSkeleton } from "../components/Skeleton";
import { Attestation, EvidenceList } from "../components/readiness/Evidence";
import { Btn, Field, Notice, Panel, Pill } from "../components/readiness/Fields";
import ForecastEditor from "../components/readiness/ForecastEditor";
import { ActionsPanel, DecisionPanel, HistoryPanel, MaterialsPanel, RequiredDocuments, ResultView, ScenarioPanel } from "../components/readiness/Panels";
import { confirmDialog } from "../lib/dialog";
import {
  CLASSIFICATION, FEATURES, LIFECYCLE, createSubject, dateLabel, getPath, getSubject, listSubjects, moneyLabel, newKey, readinessError, runAssessment,
  setPath, setSubjectStatus, updateSubject,
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
                <input type="date" className={input} value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} />
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
  const items = state.items || [];
  const active = items.filter((i) => i.status !== "archived");
  const archived = items.filter((i) => i.status === "archived");
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
          <p className="text-sm text-slate-700 dark:text-slate-200">{meta.intro}</p>
          <p className="mt-1 text-[13px] text-slate-500">{meta.caveat}</p>
          {canEdit ? <Btn kind="primary" className="mt-3" onClick={() => setCreating(true)}>{meta.newLabel}</Btn>
            : <p className="mt-3 text-[13px] text-slate-500">Your role can view {meta.nounPlural} but not create them.</p>}
        </Panel>
      )}
      {creating && <NewSubject businessId={businessId} feature={feature} profiles={state.profiles} onCancel={() => setCreating(false)} onCreated={(s) => navigate(`${meta.base}/${s.id}`)} />}
      {active.length > 0 && <ul className="space-y-3">{active.map(row)}</ul>}
      {items.length > 0 && !creating && canEdit && <Btn onClick={() => setCreating(true)}>{meta.newLabel}</Btn>}
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
    ["documents", meta.documentsTitle], ["scenarios", "Scenarios"], ["history", "History"], ...(feature === "launch" ? [["decision", "Decision"]] : [])];
  const saveText = { saved: "All changes saved", pending: "Saving shortly…", saving: "Saving…", error: save.message, conflict: save.message }[save.state];

  return (
    <div className="space-y-4">
      <PageHeader
        title={subject.title}
        description={`${meta.title} · ${LIFECYCLE[subject.status]}${feature === "launch" && data.target_date ? ` · target ${dateLabel(data.target_date)}` : ""}`}
        actions={(
          <>
            <Btn onClick={() => navigate(meta.base)}>All {meta.nounPlural}</Btn>
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
        {tab === "history" && <Panel title="History" description="Every check, kept as it was."><HistoryPanel businessId={businessId} feature={feature} subject={subject} currency={currency} /></Panel>}
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
      <SubjectList key={businessId} businessId={businessId} feature={feature} />
    </div>
  );
}
