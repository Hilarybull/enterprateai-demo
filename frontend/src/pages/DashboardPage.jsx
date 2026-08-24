import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import WorkspacePrompt from "../components/WorkspacePrompt";
import Spinner from "../components/Spinner";
import { ValidationIllustration, SimulationIllustration, BlueprintIllustration, CatalogueIllustration, FinancialIllustration } from "../components/Illustrations";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import { useAuthStore } from "../store/auth";
import { formatCurrency, formatNumber } from "../lib/format";
import { buildFinancialIntelligence } from "../lib/financialIntelligence";
import { getAcceptedWorkspaceValidation } from "../lib/acceptedValidation";
import ReportDownloadPanel from "../components/ReportDownloadPanel";
import { assembleOutput } from "../lib/contracts/index";

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";

export default function DashboardPage() {
  const navigate = useNavigate();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const workspaceLogo = useWorkspaceStore((s) => s.workspaceLogo);
  const currency = useWorkspaceStore((s) => s.currency);
  const inputs = useWorkspaceStore((s) => s.inputs);
  const ideaValidation = useWorkspaceStore((s) => s.ideaValidation);
  const workspaceDataRefreshTrigger = useWorkspaceStore((s) => s.workspaceDataRefreshTrigger);
  const email = useAuthStore((s) => s.email);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [comingSoonFeature, setComingSoonFeature] = useState(null);
  const [workspaceGateOpen, setWorkspaceGateOpen] = useState(() => !workspaceId);

  function openComingSoon(feature) {
    setComingSoonFeature(feature);
    if (email) {
      apiRequest("/support/module-interest", "POST", { email, feature }).catch(() => { });
    }
  }
  const [snapshot, setSnapshot] = useState({
    invoices: [],
    expenses: [],
    contracts: [],
    quotations: [],
    catalogue: { products: [], customers: [], vendors: [] }
  });
  const [acceptedValidation, setAcceptedValidation] = useState(null);

  useEffect(() => {
    setWorkspaceGateOpen(!workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!workspaceId) { setLoading(false); return; }
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
    return () => { alive = false; };
  }, [workspaceId, workspaceDataRefreshTrigger]);

  const metrics = useMemo(
    () => buildFinancialIntelligence({
      catalogue: snapshot.catalogue,
      financials: { invoices: snapshot.invoices, quotes: snapshot.quotations, expenses: snapshot.expenses, contracts: snapshot.contracts },
      validation: acceptedValidation,
    }),
    [acceptedValidation, snapshot]
  );

  const primaryRecommendation = metrics.recommendations[0] || null;
  const snapshotKpis = useMemo(() => {
    const paidInvs = (snapshot.invoices || []).filter(i => String(i.status || "").toLowerCase() === "paid");
    const deliveredInvs = (snapshot.invoices || []).filter(i => String(i.status || "").toLowerCase() === "delivered");
    const allExps = snapshot.expenses || [];
    const paidExps = allExps.filter(e => String(e.status || "").toLowerCase() === "paid");

    // Supports installment payments array; falls back to legacy paid_amount field
    const actualReceived = (inv) => {
      if (inv.payments && inv.payments.length > 0) {
        return inv.payments.reduce((s, p) => s + Number(p.amount), 0);
      }
      if (inv.payment_type === "partial" && inv.paid_amount != null) return Number(inv.paid_amount);
      return Number(inv.total_amount || inv.subtotal_amount || 0);
    };

    const paidRevenue = paidInvs.reduce((s, i) => s + actualReceived(i), 0);
    const paidCoS = paidInvs.reduce((s, i) => s + Number(i.cost_of_sales || 0), 0);
    const paidExpTotal = paidExps.reduce((s, e) => s + Number(e.price || e.total_amount || 0), 0);
    // Cash = actual received (respects partial amounts) minus paid expenses
    const cashBalance = paidRevenue - paidExpTotal;
    // Remaining balance on partially-paid invoices goes to receivables
    const partialRemaining = paidInvs
      .filter(i => actualReceived(i) < Number(i.total_amount || 0))
      .reduce((s, i) => s + Math.max(0, Number(i.total_amount || 0) - actualReceived(i)), 0);
    const deliveredTotal = deliveredInvs.reduce((s, i) => s + Number(i.total_amount || i.subtotal_amount || 0), 0);
    // Receivables = delivered (fully unpaid) + remaining on partial payments
    const receivables = deliveredTotal + partialRemaining;
    // Revenue = cash actually received + delivered (accrual)
    const totalRevenue = paidRevenue + deliveredTotal;
    const totalCosts = allExps.reduce((s, e) => s + Number(e.price || e.total_amount || 0), 0) + paidCoS;

    return { totalRevenue, cashBalance, receivables, totalCosts };
  }, [snapshot]);

  const financialHealthCards = [
    {
      label: "Total Revenue",
      value: formatCurrency(snapshotKpis.totalRevenue, currency),
    },
    {
      label: "Cash",
      value: formatCurrency(snapshotKpis.cashBalance, currency),
    },
    {
      label: "Expenses + cost of sales",
      value: formatCurrency(snapshotKpis.totalCosts, currency),
      highlight: true,
    },
    {
      label: "Receivables",
      value: formatCurrency(snapshotKpis.receivables, currency),
    },
    {
      label: "Active risks",
      value: metrics.riskItems.length ? formatNumber(metrics.riskItems.length) : "0",
    },
  ];

  const financialHealthSection = (
    <section className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {financialHealthCards.map((card) => (
          <div
            key={card.label}
            className={
              "min-h-[126px] rounded-2xl border p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col " +
              (card.highlight ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white")
            }
          >
            <div className="text-[0.95rem] font-medium text-slate-500">{card.label}</div>
            <div className="mt-2 text-[1.8rem] font-semibold tracking-tight text-slate-950">
              {card.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  if (!workspaceId) {
    return (
      <div className="space-y-6">
        {workspaceGateOpen ? (
          <WorkspacePrompt
            modal
            title="Create your workspace"
            subtitle="We'll take you to the workspace form so you can unlock the rest of the platform."
            ctaLabel="Continue to workspace form"
            ctaTo="/validation?from=module&return=/dashboard"
            onClose={() => setWorkspaceGateOpen(false)}
          />
        ) : (
          <WorkspacePrompt
            title="Create your workspace"
            subtitle="Save your workspace and unlock the rest of the platform."
            onActionClick={() => setWorkspaceGateOpen(true)}
            onCtaClick={() => setWorkspaceGateOpen(true)}
          />
        )}
        {loading ? (
          <div className="flex items-center justify-center py-12"><Spinner /></div>
        ) : (
          financialHealthSection
        )}
      </div>
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
      />

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      {workspaceGateOpen ? (
        <WorkspacePrompt
          modal
          title="Create your workspace"
          subtitle="We'll take you to the workspace form so you can unlock the rest of the platform."
          ctaLabel="Continue to workspace form"
          ctaTo="/validation?from=module&return=/dashboard"
          onClose={() => setWorkspaceGateOpen(false)}
        />
      ) : null}

      {financialHealthSection}

      {loading ? (
        <div className="flex items-center justify-center py-12"><Spinner /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SectionCard title="Recommended next step" subtitle="Based on your latest validation and financials.">
              <div className="space-y-3 text-sm text-slate-600">
                <div>
                  {primaryRecommendation
                    ? primaryRecommendation.subtitle
                    : "Complete your workspace to unlock scenario recommendations based on current risk signals."}
                </div>
                <Button size="sm" onClick={() => navigate(primaryRecommendation?.scenario_template_id ? `/simulation?template=${primaryRecommendation.scenario_template_id}` : "/simulation")}>
                  Run scenario
                </Button>
              </div>
            </SectionCard>

            <SectionCard title="Financial activity" subtitle="Track invoices, quotations, expenses, and contracts quickly." className="flex h-full flex-col">
              <div className="flex flex-1 flex-col gap-3 text-sm text-slate-600">
                <div className="grid gap-2">
                  {[
                    { label: "Paid invoices", value: metrics.paidInvoices.length },
                    { label: "Quotations", value: metrics.quotes.length },
                    { label: "Contracts", value: metrics.contracts.length },
                    { label: "Paid expenses", value: metrics.paidExpenses.length },
                    { label: "Overdue payables", value: metrics.overduePendingExpenses.length },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span>{row.label}</span>
                      <span className="font-semibold text-slate-900">{row.value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-auto">
                  <Button size="sm" variant="secondary" onClick={() => navigate("/financials")}>Go to Financials</Button>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Catalogue status" subtitle="Keep products, customers, and vendors ready for reuse." className="flex h-full flex-col">
              <div className="flex flex-1 flex-col gap-3 text-sm text-slate-600">
                <div className="grid gap-2">
                  {[
                    { label: "Products", value: snapshot.catalogue.products?.length || 0 },
                    { label: "Customers", value: snapshot.catalogue.customers?.length || 0 },
                    { label: "Vendors", value: snapshot.catalogue.vendors?.length || 0 },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span>{row.label}</span>
                      <span className="font-semibold text-slate-900">{row.value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-auto">
                  <Button size="sm" variant="secondary" onClick={() => navigate("/catalogue")}>Manage catalogue</Button>
                </div>
              </div>
            </SectionCard>
          </div>

          {IS_DEMO && (
            <div>
              <div className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Reports</div>
              <ReportDownloadPanel
                output={assembleOutput({
                  workspaceId,
                  currency: currency || "GBP",
                  inputs,
                  ideaValidation,
                  financialInsights: metrics,
                  riskSignals: metrics.riskItems || [],
                  recommendations: metrics.recommendations || [],
                })}
                currency={currency || "GBP"}
                reportTypes={["business_health_report", "investor_summary", "fragility_report", "stability_report"]}
                className="mb-6"
              />
            </div>
          )}

          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Explore modules</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {[
                { label: "Idea Validation", subtitle: "Evaluate your business concept.", href: "/validation", illustration: <ValidationIllustration /> },
                { label: "Simulation", subtitle: "Model what-if scenarios.", href: "/simulation", illustration: <SimulationIllustration /> },
                { label: "Blueprints", subtitle: "Generate strategic documents.", href: "/blueprint", illustration: <BlueprintIllustration /> },
                { label: "Catalogue", subtitle: "Manage products & customers.", href: "/catalogue", illustration: <CatalogueIllustration /> },
                { label: "Financials", subtitle: "Invoicing & cash tracking.", href: "/financials", illustration: <FinancialIllustration /> },
              ].map((mod) => (
                <div key={mod.href} className="relative">
                  <button type="button" onClick={mod.comingSoon ? () => openComingSoon(mod.label) : () => navigate(mod.href)}
                    className={
                      "group w-full rounded-2xl border border-slate-200 bg-white text-left transition dark:border-slate-800 dark:bg-slate-900/70 " +
                      (mod.comingSoon
                        ? "cursor-pointer opacity-70 hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-md"
                        : "hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md dark:hover:border-brand-700")
                    }>
                    <div className="overflow-hidden rounded-t-2xl bg-gradient-to-br from-brand-50 via-white to-indigo-50 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800">
                      {mod.illustration}
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-700 dark:text-slate-100 dark:group-hover:text-brand-400">{mod.label}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{mod.subtitle}</div>
                    </div>
                  </button>
                  {mod.comingSoon && (
                    <span className="absolute right-2 top-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                      Soon
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {comingSoonFeature && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setComingSoonFeature(null); }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="px-6 pt-6 pb-2 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-900/20">
                <svg className="h-6 w-6 text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2Z" />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{comingSoonFeature} — Coming Soon</h2>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                This feature is currently under development. Stay tuned for updates!
              </p>
            </div>
            <div className="flex justify-center border-t border-slate-100 px-6 py-4 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setComingSoonFeature(null)}
                className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
