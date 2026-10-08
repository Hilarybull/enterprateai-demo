import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiRequest, apiRequestCached } from "../api/client";
import { QuestionForm } from "../components/agent/AgentBits";
import { trackGoal } from "../components/GoalLauncher";
import { ButtonSpinner, LoadError, ShellSkeleton } from "../components/Skeleton";
import { useWorkspaceStore } from "../store/workspace";

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
  const began = useRef(false);

  const prepare = useCallback(async () => {
    setStage("preparing");
    try {
      const done = await apiRequest(`/task-sessions/${sessionId}/prepare`, "POST", {});
      setSession(done);
      if (done.business_id) useWorkspaceStore.getState().setWorkspaceId(done.business_id);
      if (notStarted(done.handoff)) {
        // Nothing was prepared (the plan doesn't include it, the month's tasks are used up, no AI Credits): said here, with the way forward.
        setProblem(done.handoff.message || "That couldn't be started just now.");
        setStage("blocked");
        return;
      }
      if (done.handoff?.to) {
        try {
          const cachedEmail = localStorage.getItem("ea_email") || "";
          if (cachedEmail) localStorage.removeItem(`ea_task_session:${cachedEmail.toLowerCase()}`);
          localStorage.removeItem("ea_task_session:anon");
          localStorage.removeItem("ea_task_session");
          // Said once on the page it lands on: what was set up, and where things stand.
          if (done.handoff.message) sessionStorage.setItem("ea_goal_handoff", JSON.stringify({ to: String(done.handoff.to).split("?")[0], message: done.handoff.message }));
        } catch { /* fine without it */ }
        trackGoal("dashboard_handoff_completed", { session_id: sessionId });
        navigate(done.handoff.to, { replace: true });
        return;
      }
      if (done.next === "choose" && done.choose) { setStage("choose"); return; }      // update the case that is there, or start another
      setProblem(done.problem || "That couldn't be prepared just now. Nothing was lost.");
      setStage("problem");
    } catch (e) {
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
      if (resumed.missing?.length) setStage("details");
      else await prepare();
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
      const attached = await apiRequest(`/task-sessions/${sessionId}/attach-user`, "POST", {});
      setSession(attached);
      // Already prepared (a second tab, a refresh): straight to it. One that could not be started last time is tried again below.
      if (attached.handoff?.to && !notStarted(attached.handoff)) return navigate(attached.handoff.to, { replace: true });
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
  const saved = Boolean(session?.authenticated);
  const steps = [
    { key: "saved", n: 1, label: saved ? "Email confirmed" : "Confirming email", state: saved ? "done" : stage === "loading" ? "active" : "todo" },
    { key: "workspace", n: 2, label: workspace ? "Business ready" : "Getting your business ready",
      state: workspace ? "done" : saved && (stage === "name" || stage === "loading" || busy) ? "active" : "todo" },
    // Named for the work being done ("Checking your funding readiness…"), not the visitor's words.
    { key: "prepare", n: 3, label: `${session?.preparing_label || "Preparing your task"}${stage === "preparing" ? "…" : ""}`,
      state: stage === "preparing" ? "active" : workspace && (stage === "details" || stage === "choose") ? "active" : "todo" },
  ];
  const Frame = framed ? "div" : ShellSkeleton;

  return (
    <Frame>
      <div className="mx-auto w-full max-w-[560px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900" role="region" aria-label="Your task">
        {stage !== "gone" && (
          <>
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-600">Picking up where you left off</p>
            {goal && <p className="mt-0.5 text-lg font-bold text-slate-900 dark:text-slate-100" data-goal-kept>{goal}</p>}
            <div className="mt-4" role="status" aria-live="polite"><Progress steps={steps} /></div>
            {stage === "preparing" && <p className="mt-3 text-sm text-slate-500">Your dashboard opens as soon as there is something to show you.</p>}
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
                if (!next.missing?.length) await prepare();
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
            <div className="mt-3 space-y-2">
              {session.choose.options.map((o) => (
                <button key={o.value} type="button" disabled={busy} onClick={async () => {
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
                }} className={`block w-full rounded-xl border px-3.5 py-2.5 text-left text-sm font-semibold transition disabled:opacity-60 ${o.value === "new"
                  ? "border-slate-200 text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300" : "border-brand-200 bg-brand-50 text-brand-800 hover:border-brand-400 dark:bg-brand-900/20 dark:text-brand-200"}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {stage === "blocked" && (
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800" role="alert" data-blocked>
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">I couldn't prepare that for you.</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{problem}</p>
            <p className="mt-1 text-[13px] text-slate-500">What you told me is saved. Nothing was created or sent, and no AI Credits were used.</p>
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
