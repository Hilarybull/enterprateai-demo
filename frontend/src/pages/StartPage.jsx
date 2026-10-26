import { useSignedIn } from "../store/auth";
import { premiumFlow } from "../components/ResearchReview";
import { resultHome } from "../lib/resultHome";
import FirstValueCard, { fetchFirstValue, forgetFirstValue, rememberFirstValue } from "../components/FirstValueCard";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiRequest, apiRequestCached } from "../api/client";
import { QuestionForm } from "../components/agent/AgentBits";
import { trackGoal } from "../components/GoalLauncher";
import { ButtonSpinner, LoadError, ShellSkeleton } from "../components/Skeleton";
import { useWorkspaceStore } from "../store/workspace";
import { detailsOf } from "../lib/agent";

// Where a task begun on the homepage carries on after sign-in (PRD-GO-001). It binds the task to
// the account, connects the business (the one already there, or a new one), prepares the work,
// and only then opens the dashboard, with that work on it. Never an empty dashboard, never the
// setup questionnaire in front of the task. Someone who already has a workspace sees this inside
// the real app (its sidebar and top bar, route /resume/:id); a brand-new account, which has no
// workspace to show yet, sees it in the app's outline. Either way the dashboard is the same
// page filling in, not a jump to somewhere new.

/** A hand-off with nothing behind it: the task could not be started (the plan, the month's allowance, no AI Credits), so there is only the dashboard to go to. */
const notStarted = (h) => Boolean(h) && (h.blocked === true || (!h.run_id && !h.subject_id && String(h.to || "/dashboard") === "/dashboard"));

const STEP_ICON = {
  done: <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>,
};

/** Saved → Workspace ready → Preparing <task>: where things are, said in the page and to a screen reader. */
function Progress({ steps }) {
  return (
    <ol className="space-y-2.5" aria-label="Progress" data-progress>
      {steps.map((s) => (
        <li key={s.key} data-step={s.key} data-state={s.state} aria-current={s.state === "active" ? "step" : undefined} className="flex items-center gap-3">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${s.state === "done" ? "bg-emerald-500 text-white"
            : s.state === "active" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
            {s.state === "done" ? STEP_ICON.done : s.state === "active" ? <ButtonSpinner className="!mr-0" /> : s.n}
          </span>
          <span className={`text-sm ${s.state === "todo" ? "text-slate-400" : "font-semibold text-slate-900 dark:text-slate-100"}`}>{s.label}</span>
          <span className="sr-only">{s.state === "done" ? "(done)" : s.state === "active" ? "(in progress)" : "(to do)"}</span>
        </li>
      ))}
    </ol>
  );
}

// What the page says it is doing: the task itself, never "workspace" or "saving".
const WORKING_ON = { price_offer: "Working on your price", need_funding: "Working on your funding readiness", launch: "Working on your launch",
  test_idea: "Working on your idea", more_customers: "Working on getting more customers", create_invoice: "Working on your invoice",
  create_quotation: "Working on your quotation", prepare_proposal: "Working on your proposal", create_business_plan: "Working on your business plan",
  business_risks: "Working on your business risks", cash_flow: "Working on your cash flow", grow: "Working on your growth" };

const CHECKING = { business_risks: "Checking each risk", need_funding: "Checking what funders ask for", launch: "Checking what a launch needs", test_idea: "Checking the idea",
  price_offer: "Checking your price", more_customers: "Checking what wins customers" };
const SIGN = { GBP: "£", NGN: "₦", USD: "$", EUR: "€", GHS: "GH₵", KES: "KSh " };
const NAME = { GBP: "pounds", NGN: "naira", USD: "US dollars", EUR: "euros", GHS: "cedis", KES: "shillings" };
const amount = (code, n) => `${SIGN[code] || `${code} `}${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

/** Figures given in the chat's currency, for a workspace in another (the owner's QA, 20 Oct): asked once, never relabelled. */
function CurrencyChoice({ q, sessionId, onSettled }) {
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const [[key, said]] = Object.entries(q.figures);
  const choose = async (choice) => {
    setBusy(choice);
    setProblem("");
    try { onSettled(await apiRequest(`/task-sessions/${sessionId}/currency`, "POST", { choice })); }
    catch (e) { setProblem(String(e?.message || "").replace(/^HTTP \d+:\s*/, "") || "That didn't go through. Try again."); }
    finally { setBusy(""); }
  };
  return (
    <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900" data-currency-choice data-figure={key}>
      <h2 className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">You said {amount(q.shown, said)}. Your workspace uses {NAME[q.workspace] || q.workspace}.</h2>
      <p className="mt-1 text-[14px] text-slate-600 dark:text-slate-300">Which did you mean?</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" disabled={Boolean(busy)} onClick={() => choose("keep")} data-currency-keep
          className="rounded-xl bg-brand-600 px-4 py-2 text-[14px] font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
          {/* Kept as given, never converted (the owner's brief, 20 Oct). */}
          {busy === "keep" ? "Saving…" : `Keep ${amount(q.shown, said)}, in ${NAME[q.shown] || q.shown}`}
        </button>
        <button type="button" disabled={Boolean(busy)} onClick={() => choose("meant")} data-currency-meant
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-[14px] font-semibold text-slate-700 hover:border-brand-300 disabled:opacity-60">
          {busy === "meant" ? "Saving…" : `I meant ${amount(q.workspace, said)}`}
        </button>
      </div>
      {problem && <p role="alert" className="mt-2 text-[12.5px] text-rose-700">{problem}</p>}
    </section>
  );
}

export default function StartPage({ framed = false }) {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const wanted = params.get("workspace") || "";      // the workspace picked on the homepage, when they have several
  const [session, setSession] = useState(null);
  const [stage, setStage] = useState("loading");      // loading | name | details | choose | preparing | blocked | problem | gone
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState(false);
  const [result, setResult] = useState(null);      // the free first result, for a covered goal
  const began = useRef(false);
  const signedIn = useSignedIn();
  const asking = useRef(false);      // the Replace or Update question is up: a late quick result never covers it

  // A funding or launch result opens on its own case page (the owner, 21 Oct: "just open the result in the full page"),
  // never a copy of it here with "Open full page".
  // Only once the new need has been applied to the case (the owner's QA, 22 Oct: "I ran for working capital" and the case
  // still showed the old need): never while the Replace or Update question is still to come.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (stage !== "result" || !result || !settled || asking.current) return;
    const to = resultHome(result);
    if (to) navigate(to, { replace: true });
  }, [stage, result, settled, navigate]);
  const prepare = useCallback(async (known = null, confirmed = false) => {
    setStage("preparing");
    setSettled(false);
    // The first result is worked out by fixed rules from the answers (no model): asked for alongside the task, and shown
    // the moment it is ready. The task carries on behind it; nothing waits for it.
    let shown = false;
    // An idea goes to its full validation's results, never the quick viability score first (the owner, 26 Oct: "why is idea
    // validation from the landing page showing viability score instead of the idea validation results")
    if (known?.first_value && known?.goal_key !== "test_idea") {
      fetchFirstValue(sessionId).then((fv) => {
        if (!fv?.result || asking.current) return;
        // A funding or launch result is never shown here before its need is on the case (the owner's QA, 22 Oct: "this is
        // not what I just typed, it's old"): the case opens once prepared, after Replace or Update when asked
        if (resultHome(fv.result)) return;
        shown = true;
        if (!resultHome(fv.result)) rememberFirstValue(sessionId);      // a case's result lives on its case only
        setResult(fv.result);
        setStage("result");
      }).catch(() => { /* the task's own hand-off still opens the work */ });
    }
    try {
      // Up to 2 minutes (the owner's QA, 22 Oct: prepare took 32 s and the page gave up at 30)
      const done = await apiRequest(`/task-sessions/${sessionId}/prepare`, "POST", { confirmed }, { timeoutMs: 120000 });
      if (done.confirm && !confirmed) {
        // P0.5c: a paid task's price first ("Write your business plan. 40 credits. You have 90."), Start or Not now.
        setSession(done);
        setStage("confirm");
        return;
      }
      // The case already holds another need: Replace or Update is asked first, even when the quick result is on screen
      // (it was skipped there, so the case kept the old need and showed the old research).
      asking.current = Boolean(done.next === "choose" && done.choose);
      if (done.next === "choose" && done.choose) { setSession(done); if (done.business_id) useWorkspaceStore.getState().setWorkspaceId(done.business_id); setStage("choose"); return; }
      setSettled(true);      // the need is on the case now (or there was nothing to choose)
      if (shown) {
        setSession(done); if (done.business_id) useWorkspaceStore.getState().setWorkspaceId(done.business_id);
        if (/^\/(funding|launch)\/[^/?]+/.test(String(done.handoff?.to || "")) && !notStarted(done.handoff)) navigate(done.handoff.to, { replace: true });
        return;
      }
      setSession(done);
      if (done.business_id) useWorkspaceStore.getState().setWorkspaceId(done.business_id);
      if (notStarted(done.handoff)) {
        // Nothing was prepared (the plan doesn't include it, the month's tasks are used up, no AI Credits): said here, with the way forward.
        setProblem(done.handoff.message || "That couldn't be started just now.");
        setStage("blocked");
        return;
      }
      // Signed in, an idea's chat ends in its full validation (the owner, 26 Oct): its results, never the quick idea check
      if (done.goal_key === "test_idea" && done.handoff?.run_id) {
        navigate(await detailsOf(done.handoff.run_id, { wait: 60 }), { replace: true });
        return;
      }
      if (done.first_value) {
        try {
          const fv = await fetchFirstValue(sessionId);
          if (fv?.result && resultHome(fv.result)) { navigate(resultHome(fv.result), { replace: true }); return; }      // the case, now updated
          if (fv?.result) {
            if (!resultHome(fv.result)) rememberFirstValue(sessionId);      // the first card on the dashboard; a case's result lives on its case only
            setResult(fv.result);
            setStage("result");
            return;
          }
        } catch { /* the hand-off below still opens the work */ }
      }
      if (done.handoff?.to) {
        try {
          const cachedEmail = localStorage.getItem("ea_email") || "";
          if (cachedEmail) localStorage.removeItem(`ea_task_session:${cachedEmail.toLowerCase()}`);
          localStorage.removeItem("ea_task_session:anon");
          localStorage.removeItem("ea_task_session");
          // Said once on the page it lands on: what was set up, and where things stand.
          if (done.handoff.message) sessionStorage.setItem("ea_goal_handoff", JSON.stringify({ to: String(done.handoff.to).split("?")[0], message: done.handoff.message }));
          if (done.handoff.ready_message && done.handoff.run_id) sessionStorage.setItem("ea_goal_ready", JSON.stringify({ run_id: done.handoff.run_id, message: done.handoff.ready_message }));
          if (done.handoff.run_id && !done.first_value) forgetFirstValue();      // the dashboard opens on this task, not an older result
        } catch { /* fine without it */ }
        trackGoal("dashboard_handoff_completed", { session_id: sessionId });
        navigate(done.handoff.to, { replace: true });
        return;
      }
      setProblem(done.problem || "That couldn't be prepared just now. Nothing was lost.");
      setStage("problem");
    } catch (e) {
      // Slow, not failed: the work may have finished on the server. Its case opens if it did.
      try {
        const fv = e?.status === 409 ? null : await fetchFirstValue(sessionId);
        if (fv?.result && resultHome(fv.result)) { navigate(resultHome(fv.result), { replace: true }); return; }
      } catch { /* said below */ }
      setProblem(e?.status === 409 ? "A few details are still needed." : "That couldn't be prepared just now. Nothing was lost.");
      setStage("problem");
    }
  }, [navigate, sessionId]);

  const resume = useCallback(async (businessName) => {
    setBusy(true);
    try {
      const resumed = await apiRequest(`/task-sessions/${sessionId}/resume`, "POST", businessName ? { business_name: businessName } : wanted ? { business_id: wanted } : {});
      setSession(resumed);
      setWorkspace(true);
      // A workspace that was already theirs: carry on inside the real app, with its own sidebar.
      if (!framed && !businessName && resumed.business_id && !resumed.handoff) {
        useWorkspaceStore.getState().setWorkspaceId(resumed.business_id);
        navigate(`/resume/${sessionId}`, { replace: true });
        return;
      }
      if (resumed.currency_question) setStage("currency");      // "You said £10,000; your workspace uses naira": asked once
      else if (resumed.missing?.length) setStage("details");
      else await prepare(resumed);
    } catch (e) {
      setProblem(e?.status === 403 ? "This task was started from another account." : "Your task couldn't be picked up just now. Nothing was lost.");
      setStage(e?.status === 404 ? "gone" : "problem");
    } finally {
      setBusy(false);
    }
  }, [framed, navigate, prepare, sessionId, wanted]);

  const begin = useCallback(async () => {
    setStage("loading");
    setProblem("");
    try {
      // Never a step that waits on forever: 15 seconds, then "Try again".
      const attached = await apiRequest(`/task-sessions/${sessionId}/attach-user`, "POST", {}, { timeoutMs: 15000 });
      setSession(attached);
      // Already prepared (a second tab, a refresh): straight to it. One that could not be started last time is tried again below.
      if (attached.handoff?.to && !notStarted(attached.handoff)) {
        // A refresh while the result (and its review) is on screen: the same result again, never thrown to the case page
        // (the owner's QA, 17 Oct). With no result to show, on to where the task was handed.
        try {
          const fv = await fetchFirstValue(sessionId);
          if (fv?.result && resultHome(fv.result)) { if (attached.business_id) useWorkspaceStore.getState().setWorkspaceId(attached.business_id); return navigate(resultHome(fv.result), { replace: true }); }
          if (fv?.result) {
            if (attached.business_id) useWorkspaceStore.getState().setWorkspaceId(attached.business_id);
            setResult(fv.result);
            setStage("result");
            return undefined;
          }
        } catch { /* on to the hand-off */ }
        return navigate(attached.handoff.to, { replace: true });
      }
      // Someone with a business already carries straight on. A new account is asked one thing: what the business is called (optional).
      const existing = attached.business_id ? { id: attached.business_id } : await apiRequestCached("/validation/me").catch(() => null);
      if (existing?.id) return resume();
      setStage("name");
    } catch (e) {
      if (e?.status === 404) return setStage("gone");
      setProblem(e?.status === 403 ? "This task was started from another account." : "Your task couldn't be picked up just now. Nothing was lost.");
      setStage("problem");
    }
    return undefined;
  }, [navigate, resume, sessionId]);

  useEffect(() => {
    if (began.current) return;
    began.current = true;
    begin();
  }, [begin]);

  const goal = session?.goal_label || session?.resolution?.original_goal;
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    if (stage !== "preparing") { setWriting(false); return undefined; }
    const t = setTimeout(() => setWriting(true), 1800);
    return () => clearTimeout(t);
  }, [stage]);
  // Signed in already: nothing to confirm, the first step is done from the start (the owner's QA, 15 Oct).
  const saved = Boolean(session?.authenticated) || signedIn;
  // Three steps at most, about the work, never "Signed in" (the owner's brief, 20 Oct).
  const checking = CHECKING[session?.goal_key] || "Working it out";
  const working = stage === "preparing";
  const steps = [
    { key: "read", n: 1, label: session?.goal_key === "business_risks" ? "Reading your records" : "Reading your answers", state: working || stage === "choose" || stage === "currency" ? "done" : "active" },
    { key: "check", n: 2, label: checking, state: working ? (writing ? "done" : "active") : "todo" },
    { key: "write", n: 3, label: "Writing your next steps", state: working && writing ? "active" : "todo" },
  ];
  const Frame = framed ? "div" : ShellSkeleton;


  return (
    <Frame>
      {/* The result is its own card, across the full width of the page (one column on a phone, two from 768px). */}
      <div className={stage === "result" && result ? "w-full"
        : "mx-auto w-full max-w-[560px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900"} role="region" aria-label="Your task">
        {stage === "currency" && session?.currency_question && (
          <CurrencyChoice q={session.currency_question} sessionId={sessionId} onSettled={(next) => { setSession(next); prepare(next); }} />
        )}
        {stage === "result" && result && (
          <FirstValueCard result={result} onUpdated={setResult}
            onPremium={premiumFlow({ base: `/task-sessions/${sessionId}/premium` })} />
        )}
        {stage !== "gone" && stage !== "result" && (
          <>
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-600" data-working-on>{WORKING_ON[session?.goal_key] || "Working on your task"}</p>
            {goal && <p className="mt-0.5 text-lg font-bold text-slate-900 dark:text-slate-100" data-goal-kept>{goal}</p>}
            <div className="mt-4" role="status" aria-live="polite"><Progress steps={steps} /></div>
          </>
        )}

        {stage === "name" && (
          <form className="mt-5 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); resume(name.trim()); }}>
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">You're in. One thing before I carry on.</p>
            <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300">
              What is your business called? <span className="font-normal text-slate-400">(optional)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
            </label>
            <p className="text-[12px] text-slate-500">It goes on what you send to customers. You can add or change it later.</p>
            <div className="flex justify-end">
              <button type="submit" disabled={busy} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">{busy ? "Working…" : "Continue"}</button>
            </div>
          </form>
        )}

        {stage === "details" && session && (
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <p className="mb-3 text-base font-bold text-slate-900 dark:text-slate-100">A few details and I'll prepare it.</p>
            <QuestionForm fields={session.questions} submitting={busy} onSubmit={async (answers) => {
              setBusy(true);
              try {
                const next = await apiRequest(`/task-sessions/${sessionId}/inputs`, "POST", { answers });
                setSession(next);
                if (!next.missing?.length) await prepare(next);
              } catch {
                setProblem("That couldn't be saved just now. Please try again.");
                setStage("problem");
              } finally {
                setBusy(false);
              }
            }} />
          </div>
        )}

        {stage === "choose" && session?.choose && (
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800" role="group" aria-label={session.choose.label} data-choose>
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">{session.choose.label}</p>
            {session.choose.rows?.length > 0 && (
              // What changes, in plain words: Field | Before | Now, no arrows, nothing cut short (the owner's brief, 20 Oct).
              <table className="mt-3 w-full table-fixed text-left text-[13px]" data-case-diff>
                <thead><tr className="text-[12px] text-slate-500"><th className="w-1/4 pb-1 font-medium">Field</th><th className="pb-1 font-medium">Before</th><th className="pb-1 font-medium">Now</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {session.choose.rows.map((r) => (
                    <tr key={r.field} className="align-top"><td className="py-1.5 pr-2 font-semibold text-slate-800 dark:text-slate-100">{r.field}</td>
                      <td className="break-words py-1.5 pr-2 text-slate-500">{r.before}</td><td className="break-words py-1.5 text-slate-900 dark:text-slate-100">{r.now}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {session.choose.rows?.length > 0 && <p className="mt-2 text-[12px] text-slate-500">Your previous version is kept in History.</p>}
            <div className={`mt-3 ${session.choose.rows?.length ? "flex flex-col gap-2 sm:flex-row" : "space-y-2"}`}>
              {session.choose.options.map((o) => (
                <button key={o.value} type="button" disabled={busy} data-choice={o.value} aria-pressed={String(o.value) === String(session.choose.default ?? "")} onClick={async () => {
                  setBusy(true);
                  try {
                    setSession(await apiRequest(`/task-sessions/${sessionId}/inputs`, "POST", { answers: { subject_choice: o.value } }));
                    await prepare();
                  } catch {
                    setProblem("That couldn't be saved just now. Please try again.");
                    setStage("problem");
                  } finally {
                    setBusy(false);
                  }
                }} className={`${session.choose.rows?.length ? "rounded-xl px-4 py-2 text-center" : "block w-full rounded-xl px-3.5 py-2.5 text-left"} border text-sm font-semibold transition disabled:opacity-60 ${(session.choose.default != null ? String(o.value) !== String(session.choose.default) : o.value === "new")
                  ? "border-slate-200 text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300" : "border-brand-200 bg-brand-50 text-brand-800 hover:border-brand-400 dark:bg-brand-900/20 dark:text-brand-200"}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {stage === "confirm" && session?.confirm && (
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800" data-price-confirm>
            <p className="text-base font-bold text-slate-900 dark:text-slate-100" data-price-line>{session.confirm.message}</p>
            <p className="mt-1 text-[13px] text-slate-500">Charged only when it is done. Nothing is sent to anyone.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => prepare(null, true)} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Start</button>
              <button type="button" onClick={() => navigate("/dashboard", { replace: true })} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">Not now</button>
            </div>
          </div>
        )}

        {stage === "blocked" && (
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800" role="alert" data-blocked>
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">I couldn't prepare that for you.</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{problem}</p>
            <p className="mt-1 text-[13px] text-slate-500">What you told me is saved. Nothing was created or sent.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {session?.handoff?.upgrade && <button type="button" onClick={() => navigate("/pricing")} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">See plans</button>}
              <button type="button" onClick={() => navigate("/dashboard", { replace: true })} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">Go to the dashboard</button>
            </div>
          </div>
        )}

        {stage === "problem" && (
          <LoadError what="your task" detail={problem} onRetry={() => (session?.authenticated && session?.business_id ? prepare() : begin())} className="mt-4 border-0 p-2">
            <button type="button" onClick={() => navigate("/dashboard", { replace: true })} className="text-sm font-semibold text-brand-600 hover:underline">Go to the dashboard</button>
          </LoadError>
        )}

        {stage === "gone" && (
          <div>
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">That task has expired.</p>
            <p className="mt-1 text-sm text-slate-500">Tasks started from the homepage are kept for 7 days. Ask again from your dashboard and I'll pick it straight up.</p>
            <button type="button" onClick={() => navigate("/dashboard", { replace: true })} className="mt-3 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Go to the dashboard</button>
          </div>
        )}
      </div>
    </Frame>
  );
}
