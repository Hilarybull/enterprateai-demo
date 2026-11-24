import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import QuickCheck, { QUICK_CHECKS } from "../components/QuickCheck";
import CheckAssistant from "../components/CheckAssistant";
import { SideCards } from "../components/readiness/CaseAssistant";
import IdeaAssistant from "../components/readiness/IdeaAssistant";
import IdeaCatalogue from "../components/readiness/IdeaCatalogue";
import { ContentSkeleton } from "../components/Skeleton";
import { SavedResearch } from "./ReadinessPage";
import { useWorkspaceStore } from "../store/workspace";

// Pricing health and customer growth have no page of their own: their free first value lives here (QA P1-7).
const WHICH = { pricing: "price_offer", customers: "more_customers", launch: "launch", funding: "need_funding", idea: "test_idea", risks: "business_risks" };
// Idea Validation's tabs (the owner's mockups, 27 Oct): the conversation first, then the check itself, its research and the catalogue
const IDEA_TABS = [["assistant", "Assistant"], ["assessment", "Assessment"], ["research", "Research"], ["catalogue", "Catalogue"]];
// The free checks that talk on their own page (the owner, 30 Oct)
const CHAT_CHECKS = ["customers", "risks", "pricing"];

const ResultsPage = lazy(() => import("./ResultsPage"));

// The Assessment is the Idea Validation's own result once it has run (the owner, 31 Oct: "this is what we need for the idea
// validation, not this"): its scores, verdict and breakdown, with Accept, Modify and Reject. Before it has run, the quick check.
function IdeaAssessment({ businessId, quick }) {
  const [ran, setRan] = useState(undefined);
  useEffect(() => {
    let live = true;
    // the validation itself is read and handed to the result first, so "No results yet" never shows while one exists (31 Oct)
    apiRequest(`/validation/${businessId}`, "GET").then((ws) => {
      if (!live) return;
      const history = ws?.data?.validation_history || [];
      const activeId = ws?.data?.active_validation_id;
      const isV4 = (h) => h?.result?.engine_version === "4.0";
      const entry = [activeId && history.find((h) => h?.id === activeId), ...history].find(isV4);
      if (entry) {
        useWorkspaceStore.getState().setValidation(entry.result);
        useWorkspaceStore.getState().setValidationEntryId?.(entry.id);
      }
      setRan(Boolean(entry));
    }, () => live && setRan(false));
    return () => { live = false; };
  }, [businessId]);
  if (ran === undefined) return <ContentSkeleton label="your assessment" />;
  return ran ? <Suspense fallback={<ContentSkeleton label="your assessment" />}><ResultsPage embedded /></Suspense> : quick;
}

// Run the idea validation on the Assessment tab, the main flow (the owner, 30 Oct: owners don't know they can type it): it
// is asked in the Assistant, which says its price with Start or Not now, then links its results and its filled form
function IdeaRunBar({ onRun }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-900 dark:bg-brand-950/40" data-idea-run>
      <span className="min-w-0 flex-1 text-[13.5px] text-brand-900 dark:text-brand-100">Run the idea validation: I fill in its form from your idea and records and give you its full result to accept, modify or reject. I'll tell you its price first, and you're charged only when it finishes.</span>
      <button type="button" onClick={onRun} className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-700">Run the idea validation</button>
    </div>
  );
}

function CheckSide({ businessId, topic }) {
  const [ctx, setCtx] = useState(null);
  useEffect(() => {
    let live = true;
    apiRequest(`/businesses/${businessId}/agent/assistant-context?kind=funding`, "GET").then((c) => live && setCtx(c || {}), () => live && setCtx({}));
    return () => { live = false; };
  }, [businessId]);
  return (
    <aside className="hidden min-h-0 min-w-0 space-y-4 overflow-y-auto pr-0.5 xl:block" aria-label="Your business" data-check-side={topic}>
      {ctx ? <SideCards businessId={businessId} feature={topic} subject={{ id: topic }} ctx={ctx} send={() => {}} />
        : [160, 120].map((h, i) => <div key={i} className="animate-pulse rounded-2xl border border-slate-200 bg-white" style={{ height: h }} />)}
    </aside>
  );
}

export default function QuickCheckPage() {
  const { goal } = useParams();
  const businessId = useWorkspaceStore((s) => s.workspaceId);
  const key = WHICH[goal] || goal;
  const [params, setParams] = useSearchParams();
  const said = params.get("said") || "";      // the owner's own sentence, when they started from one (QA P5-1)
  const navigate = useNavigate();
  // On a phone the tabs scroll sideways, the one picked kept in view (the owner, 27 Oct)
  const tabsRef = useRef(null);
  const picked = params.get("tab");
  useEffect(() => { tabsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [picked]);
  // "Back" to wherever the check was asked (the owner's brief, 25 Oct): the landing page, the dashboard or the Agent Centre
  const from = useLocation().state?.from || "";
  useEffect(() => {      // opened at its top
    document.querySelector("[data-tour='content-area']")?.scrollTo?.({ top: 0 });
    window.scrollTo?.(0, 0);
  }, [goal]);
  if (!QUICK_CHECKS[key]) return <Navigate to="/dashboard" replace />;
  if (!businessId) return <ContentSkeleton label="your business" />;
  const back = from && (
    <Link to={from} data-back className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline">
      <span aria-hidden="true">←</span> Back
    </Link>
  );
  if (key === "test_idea") {
    // A sentence handed over to the check ("?said=") opens the check itself, as before
    const tab = IDEA_TABS.some(([k]) => k === params.get("tab")) ? params.get("tab") : said ? "assessment" : "assistant";
    const setTab = (next) => {
      if (next === "catalogue-open") { navigate("/catalogue"); return; }
      const p = new URLSearchParams(params);
      p.set("tab", IDEA_TABS.some(([k]) => k === next) ? next : "assessment");
      p.delete("review");
      setParams(p, { replace: true });
    };
    return (
      <div className={tab === "assistant" ? "mx-auto flex h-full min-h-0 w-full max-w-[1400px] flex-col gap-4" : "mx-auto w-full max-w-[1400px] space-y-4"} {...(tab === "assistant" ? { "data-fit-page": "" } : {})}>
        {back}
        <header className="shrink-0" data-assistant-header>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Idea validation</p>
          <h1 className="mt-1 text-[30px] font-bold leading-tight text-slate-900 dark:text-slate-50 sm:text-[34px]">Idea Validation</h1>
          <p className="mt-1 text-[15px] text-slate-500 dark:text-slate-400 max-sm:hidden">Assess whether a new service is worth launching, using your business data and market evidence.</p>
        </header>
        <div ref={tabsRef} role="tablist" aria-label="Idea validation" className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 max-sm:gap-0 max-sm:pr-4 max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-1rem),transparent)] dark:border-slate-800">
          {IDEA_TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition max-sm:px-2.5 max-sm:text-[13px] ${tab === k ? "border-brand-600 text-brand-700 dark:text-brand-300" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>{label}</button>
          ))}
        </div>
        {tab === "assistant" && <div className="min-h-0 flex-1"><IdeaAssistant key={businessId} businessId={businessId} onTab={setTab} /></div>}
        {/* No "Do all for me" under the steps: the idea's research is offered in its Assistant (the owner, 28 Oct) */}
        {tab === "assessment" && <IdeaAssessment businessId={businessId} quick={<>
        <IdeaRunBar onRun={() => { const p = new URLSearchParams(params); p.set("tab", "assistant"); p.set("run", "1"); p.delete("review"); setParams(p, { replace: true }); }} />
        <QuickCheck key={`${businessId}-${key}`} businessId={businessId} goalKey={key} open said={said} doAll={false} /></>} />}
        {tab === "research" && <SavedResearch businessId={businessId} goal="test_idea"
          onStart={(said) => { const p = new URLSearchParams(params); p.set("tab", "assistant"); p.set("message", said); setParams(p); }} />}
        {tab === "catalogue" && <IdeaCatalogue businessId={businessId} onOpenCatalogue={() => navigate("/catalogue")} />}
      </div>
    );
  }
  if (CHAT_CHECKS.includes(goal)) {
    // One chat, the check itself in it: no Result tab (the owner, 1 Nov: "all these should be on the chat... no result tab")
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1400px] flex-col gap-4" data-fit-page="">
        {back}
        <PageHeader title={QUICK_CHECKS[key].title} description={QUICK_CHECKS[key].intro} />
        {/* The business beside the chat, as the funding, launch and idea pages have it (the owner, 1 Nov: "why no side cards") */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div className="min-h-0"><CheckAssistant key={`${businessId}-${goal}`} businessId={businessId} topic={goal} said={said} /></div>
          <CheckSide businessId={businessId} topic={goal} />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {back}
      <PageHeader title={QUICK_CHECKS[key].title} description={QUICK_CHECKS[key].intro} />
      <QuickCheck key={`${businessId}-${key}`} businessId={businessId} goalKey={key} open said={said} />
    </div>
  );
}
