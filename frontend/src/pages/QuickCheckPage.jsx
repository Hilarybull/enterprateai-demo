import { useEffect } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import QuickCheck, { QUICK_CHECKS } from "../components/QuickCheck";
import { ContentSkeleton } from "../components/Skeleton";
import { useWorkspaceStore } from "../store/workspace";

// Pricing health and customer growth have no page of their own: their free first value lives here (QA P1-7).
const WHICH = { pricing: "price_offer", customers: "more_customers", launch: "launch", funding: "need_funding", idea: "test_idea", risks: "business_risks" };

export default function QuickCheckPage() {
  const { goal } = useParams();
  const businessId = useWorkspaceStore((s) => s.workspaceId);
  const key = WHICH[goal] || goal;
  const said = useSearchParams()[0].get("said") || "";      // the owner's own sentence, when they started from one (QA P5-1)
  // "Back" to wherever the check was asked (the owner's brief, 25 Oct): the landing page, the dashboard or the Agent Centre
  const from = useLocation().state?.from || "";
  useEffect(() => {      // opened at its top
    document.querySelector("[data-tour='content-area']")?.scrollTo?.({ top: 0 });
    window.scrollTo?.(0, 0);
  }, [goal]);
  if (!QUICK_CHECKS[key]) return <Navigate to="/dashboard" replace />;
  if (!businessId) return <ContentSkeleton label="your business" />;
  return (
    <div className="space-y-4">
      {from && (
        <Link to={from} data-back className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline">
          <span aria-hidden="true">←</span> Back
        </Link>
      )}
      <PageHeader title={QUICK_CHECKS[key].title} description={QUICK_CHECKS[key].intro} />
      <QuickCheck key={`${businessId}-${key}`} businessId={businessId} goalKey={key} open said={said} />
    </div>
  );
}
