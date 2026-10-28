import { useEffect, useRef } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import QuickCheck, { QUICK_CHECKS } from "../components/QuickCheck";
import IdeaAssistant from "../components/readiness/IdeaAssistant";
import IdeaCatalogue from "../components/readiness/IdeaCatalogue";
import { ContentSkeleton } from "../components/Skeleton";
import { SavedResearch } from "./ReadinessPage";
import { useWorkspaceStore } from "../store/workspace";

// Pricing health and customer growth have no page of their own: their free first value lives here (QA P1-7).
const WHICH = { pricing: "price_offer", customers: "more_customers", launch: "launch", funding: "need_funding", idea: "test_idea", risks: "business_risks" };
// Idea Validation's tabs (the owner's mockups, 27 Oct): the conversation first, then the check itself, its research and the catalogue
const IDEA_TABS = [["assistant", "Assistant"], ["assessment", "Assessment"], ["research", "Research"], ["catalogue", "Catalogue"]];

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
        {tab === "assessment" && <QuickCheck key={`${businessId}-${key}`} businessId={businessId} goalKey={key} open said={said} doAll={false} />}
        {tab === "research" && <SavedResearch businessId={businessId} goal="test_idea"
          onStart={(said) => { const p = new URLSearchParams(params); p.set("tab", "assistant"); p.set("message", said); setParams(p); }} />}
        {tab === "catalogue" && <IdeaCatalogue businessId={businessId} onOpenCatalogue={() => navigate("/catalogue")} />}
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
