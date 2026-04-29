import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import StatTile from "../components/StatTile";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import WorkspacePrompt from "../components/WorkspacePrompt";
import Spinner from "../components/Spinner";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import { formatCurrency, formatNumber } from "../lib/format";
import { buildFinancialIntelligence } from "../lib/financialIntelligence";
import { getAcceptedWorkspaceValidation } from "../lib/acceptedValidation";

export default function DashboardPage() {
  const navigate = useNavigate();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const workspaceLogo = useWorkspaceStore((s) => s.workspaceLogo);
  const currency = useWorkspaceStore((s) => s.currency);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [snapshot, setSnapshot] = useState({
    invoices: [],
    expenses: [],
    contracts: [],
    quotations: [],
    catalogue: { products: [], customers: [], vendors: [] }
  });
  const [acceptedValidation, setAcceptedValidation] = useState(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!workspaceId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const ws = await apiRequest(`/validation/${workspaceId}`, "GET");
        if (!alive) return;
        const data = ws?.data || {};
        setSnapshot({
          invoices: data?.financials?.invoices || [],
          expenses: data?.financials?.expenses || [],
          contracts: data?.financials?.contracts || [],
          quotations: data?.financials?.quotes || data?.financials?.quotations || [],
          catalogue: data?.catalogue || { products: [], customers: [], vendors: [] }
        });
        setAcceptedValidation(getAcceptedWorkspaceValidation(data));
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load dashboard data.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  const metrics = useMemo(
    () =>
      buildFinancialIntelligence({
        catalogue: snapshot.catalogue,
        financials: {
          invoices: snapshot.invoices,
          quotes: snapshot.quotations,
          expenses: snapshot.expenses,
          contracts: snapshot.contracts,
        },
        validation: acceptedValidation,
      }),
    [acceptedValidation, snapshot]
  );
  const primaryRecommendation = metrics.recommendations[0] || null;

  if (!workspaceId) {
    return (
      <WorkspacePrompt
        title="Create your workspace"
        subtitle="Save your workspace and unlock the rest of the platform."
        ctaLabel="Create Workspace"
        ctaHref="/validation"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business Intelligence Dashboard"
        description="Live overview of revenue, risks, and next actions across your modules."
        leadingVisual={
          workspaceLogo ? (
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
              <img src={workspaceLogo} alt="Workspace logo" className="h-full w-full object-contain" />
            </div>
          ) : null
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate("/validation")}>
              Run Idea Validation
            </Button>
            <Button onClick={() => navigate("/simulation")}>Run Simulation</Button>
          </div>
        }
      />

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Total Revenue" value={formatCurrency(metrics.totalRevenue, currency)} />
            <StatTile label="Expenses + cost of sales" value={formatCurrency(metrics.totalCosts, currency)} tone="warn" />
            <StatTile label="Pending invoices" value={formatNumber(metrics.pendingInvoices.length)} />
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-slate-900 dark:text-slate-100 min-h-[124px] flex flex-col">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                <div>Active risks</div>
              </div>
              <div className="mt-1 text-[20px] font-semibold tracking-tight text-slate-900">
                {metrics.riskItems.length ? formatNumber(metrics.riskItems.length) : "No active risks"}
              </div>
              {metrics.riskItems?.length ? (
                <div className="mt-2 text-xs text-slate-500 max-h-16 overflow-auto pr-1">
                  {metrics.riskItems.map((risk, idx) => (
                    <div key={`${risk.reason_code}-${idx}`} className="truncate">
                      {risk.title}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SectionCard title="Recommended next step" subtitle="Based on your latest validation and financials.">
              <div className="space-y-3 text-sm text-slate-600">
                <div>
                  {primaryRecommendation
                    ? primaryRecommendation.subtitle
                    : "Complete your workspace to unlock scenario recommendations based on current risk signals."}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      navigate(
                        primaryRecommendation?.scenario_template_id
                          ? `/simulation?template=${primaryRecommendation.scenario_template_id}`
                          : "/simulation"
                      )
                    }
                  >
                    Run scenario
                  </Button>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Financial activity"
              subtitle="Track invoices, quotations, expenses, and contracts quickly."
              className="flex h-full flex-col"
            >
              <div className="flex flex-1 flex-col gap-3 text-sm text-slate-600">
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <span>Paid invoices</span>
                    <span className="font-semibold text-slate-900">{metrics.paidInvoices.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Pending invoices</span>
                    <span className="font-semibold text-slate-900">{metrics.pendingInvoices.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Quotations</span>
                    <span className="font-semibold text-slate-900">{metrics.quotes.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Contracts</span>
                    <span className="font-semibold text-slate-900">{metrics.contracts.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Paid expenses</span>
                    <span className="font-semibold text-slate-900">{metrics.paidExpenses.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Overdue payables</span>
                    <span className="font-semibold text-slate-900">{metrics.overduePendingExpenses.length}</span>
                  </div>
                </div>
                <div className="mt-auto">
                  <Button size="sm" variant="secondary" onClick={() => navigate("/financials")}>
                    Go to Financials
                  </Button>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Catalogue status"
              subtitle="Keep products, customers, and vendors ready for reuse."
              className="flex h-full flex-col"
            >
              <div className="flex flex-1 flex-col gap-3 text-sm text-slate-600">
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <span>Products</span>
                    <span className="font-semibold text-slate-900">{snapshot.catalogue.products?.length || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Customers</span>
                    <span className="font-semibold text-slate-900">{snapshot.catalogue.customers?.length || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Vendors</span>
                    <span className="font-semibold text-slate-900">{snapshot.catalogue.vendors?.length || 0}</span>
                  </div>
                </div>
                <div className="mt-auto">
                  <Button size="sm" variant="secondary" onClick={() => navigate("/catalogue")}>
                    Manage catalogue
                  </Button>
                </div>
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Quick actions" subtitle="Jump straight to the modules you need.">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => navigate("/validation")}>
                Idea Validation
              </Button>
              <Button variant="secondary" onClick={() => navigate("/results")}>
                View Validation Dashboard
              </Button>
              <Button variant="secondary" onClick={() => navigate("/blueprint")}>
                Generate Blueprints
              </Button>
              {/*<Button variant="secondary" onClick={() => navigate("/registration")}>
                Business Registration
              </Button>*/}
              <Button variant="secondary" onClick={() => navigate("/simulation")}>
                Simulation
              </Button>
              <Button variant="secondary" onClick={() => navigate("/financials")}>
                Financials
              </Button>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
