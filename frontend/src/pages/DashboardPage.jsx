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

function sumBy(list, key) {
  return (list || []).reduce((acc, item) => acc + Number(item?.[key] || 0), 0);
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const workspaceLogo = useWorkspaceStore((s) => s.workspaceLogo);
  const validation = useWorkspaceStore((s) => s.validation);
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
          quotations: data?.financials?.quotations || [],
          catalogue: data?.catalogue || { products: [], customers: [], vendors: [] }
        });
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

  const metrics = useMemo(() => {
    const invoices = Array.isArray(snapshot.invoices) ? snapshot.invoices : [];
    const expenses = Array.isArray(snapshot.expenses) ? snapshot.expenses : [];
    const contracts = Array.isArray(snapshot.contracts) ? snapshot.contracts : [];
    const quotations = Array.isArray(snapshot.quotations) ? snapshot.quotations : [];
    const paidInvoices = invoices.filter((i) => i.status === "paid");
    const pendingInvoices = invoices.filter((i) => i.status !== "paid");
    const paidExpenses = expenses.filter((e) => e.status === "paid");
    const unpaidExpenses = expenses.filter((e) => e.status !== "paid");
    const signedContracts = contracts.filter((c) => c.status === "signed");
    const salesContracts = signedContracts.filter((c) => c.contract_type !== "purchase");
    const purchaseContracts = signedContracts.filter((c) => c.contract_type === "purchase");

    const revenue = sumBy(paidInvoices, "total_amount") + sumBy(salesContracts, "price");
    const costs = sumBy(paidExpenses, "price") + sumBy(purchaseContracts, "price");
    const flags = Array.isArray(validation?.flags) ? validation.flags : [];
    const dynamicRisks = [];
    if (sumBy(paidInvoices, "total_amount") < sumBy(unpaidExpenses, "price")) {
      dynamicRisks.push("Revenue below unpaid expenses (Financials)");
    }
    if (costs > revenue && (revenue > 0 || costs > 0)) {
      dynamicRisks.push("Costs exceed revenue (Financials)");
    }
    if (pendingInvoices.length && !paidInvoices.length) {
      dynamicRisks.push("No paid invoices yet (Financials)");
    }
    if (quotations.length && !invoices.length) {
      dynamicRisks.push("Quotes issued but no invoices sent (Financials)");
    }
    if (signedContracts.length && !invoices.length) {
      dynamicRisks.push("Signed contracts not invoiced yet (Financials)");
    }
    if (!snapshot.catalogue.products?.length) {
      dynamicRisks.push("No active products/services (Catalogue)");
    }
    if (!snapshot.catalogue.customers?.length) {
      dynamicRisks.push("No customers saved (Catalogue)");
    }
    const riskItems = [
      ...flags.map((f) => `${String(f?.code || f?.title || f || "").replace(/_/g, " ").trim()} (Validation)`),
      ...dynamicRisks
    ].filter(Boolean);
    const riskCount = riskItems.length;

    return {
      revenue,
      costs,
      pendingInvoices: pendingInvoices.length,
      paidInvoices: paidInvoices.length,
      paidExpenses: paidExpenses.length,
      quotations: quotations.length,
      contracts: contracts.length,
      unpaidExpenses: unpaidExpenses.length,
      riskCount,
      riskItems
    };
  }, [snapshot, validation]);

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
            <StatTile label="Revenue (paid)" value={formatCurrency(metrics.revenue, currency)} />
            <StatTile label="Expenses (paid)" value={formatCurrency(metrics.costs, currency)} tone="warn" />
            <StatTile label="Pending invoices" value={formatNumber(metrics.pendingInvoices)} />
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-slate-900 dark:text-slate-100 min-h-[124px] flex flex-col">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                <div>Active risks</div>
              </div>
              <div className="mt-1 text-[20px] font-semibold tracking-tight text-slate-900">
                {metrics.riskCount ? formatNumber(metrics.riskCount) : "No active risks"}
              </div>
              {metrics.riskItems?.length ? (
                <div className="mt-2 text-xs text-slate-500 max-h-16 overflow-auto pr-1">
                  {metrics.riskItems.map((risk, idx) => (
                    <div key={`${risk}-${idx}`} className="truncate">
                      {risk}
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
                  {validation
                    ? "Run a simulation to see the impact of your latest numbers on cash, profit, and runway."
                    : "Complete wokspace to unlock recommendations and scenario insights."}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => navigate("/simulation")}>
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
                    <span className="font-semibold text-slate-900">{metrics.paidInvoices}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Pending invoices</span>
                    <span className="font-semibold text-slate-900">{metrics.pendingInvoices}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Quotations</span>
                    <span className="font-semibold text-slate-900">{metrics.quotations}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Contracts</span>
                    <span className="font-semibold text-slate-900">{metrics.contracts}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Paid expenses</span>
                    <span className="font-semibold text-slate-900">{metrics.paidExpenses}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Unpaid expenses</span>
                    <span className="font-semibold text-slate-900">{metrics.unpaidExpenses}</span>
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
