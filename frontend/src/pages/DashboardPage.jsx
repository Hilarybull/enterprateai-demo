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
  const validation = useWorkspaceStore((s) => s.validation);
  const currency = useWorkspaceStore((s) => s.currency);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [snapshot, setSnapshot] = useState({
    invoices: [],
    expenses: [],
    contracts: [],
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
    const paidInvoices = invoices.filter((i) => i.status === "paid");
    const pendingInvoices = invoices.filter((i) => i.status !== "paid");
    const paidExpenses = expenses.filter((e) => e.status === "paid");
    const signedContracts = contracts.filter((c) => c.status === "signed");
    const salesContracts = signedContracts.filter((c) => c.contract_type !== "purchase");
    const purchaseContracts = signedContracts.filter((c) => c.contract_type === "purchase");

    const revenue = sumBy(paidInvoices, "total_amount") + sumBy(salesContracts, "price");
    const costs = sumBy(paidExpenses, "price") + sumBy(purchaseContracts, "price");
    const flags = Array.isArray(validation?.flags) ? validation.flags : [];
    const riskCount = flags.length;
    const topRisks = flags.slice(0, 2).map((f) => String(f?.code || f?.title || f || "").replace(/_/g, " ").trim()).filter(Boolean);

    return {
      revenue,
      costs,
      pendingInvoices: pendingInvoices.length,
      paidInvoices: paidInvoices.length,
      riskCount,
      topRisks
    };
  }, [snapshot, validation]);

  if (!workspaceId) {
    return (
      <WorkspacePrompt
        title="Create your workspace"
        subtitle="Run Idea Validation to save your workspace and unlock the rest of the platform."
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
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-slate-900 dark:text-slate-100">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                <div>Active risks</div>
              </div>
              <div className="mt-1 text-[20px] font-semibold tracking-tight text-slate-900">
                {metrics.riskCount ? formatNumber(metrics.riskCount) : "No active risks"}
              </div>
              {metrics.topRisks?.length ? (
                <div className="mt-2 text-xs text-slate-500">
                  {metrics.topRisks.map((risk) => (
                    <div key={risk}>{risk}</div>
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
                    : "Complete Idea Validation to unlock recommendations and scenario insights."}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => navigate("/simulation")}>
                    Run scenario
                  </Button>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Financial activity" subtitle="Track invoices, expenses, and contracts quickly.">
              <div className="space-y-2 text-sm text-slate-600">
                <div>Paid invoices: {metrics.paidInvoices}</div>
                <div>Pending invoices: {metrics.pendingInvoices}</div>
                <div className="pt-2">
                  <Button size="sm" variant="secondary" onClick={() => navigate("/financials")}>
                    Go to Financials
                  </Button>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Catalogue status" subtitle="Keep products, customers, and vendors ready for reuse.">
              <div className="space-y-2 text-sm text-slate-600">
                <div>Products: {snapshot.catalogue.products?.length || 0}</div>
                <div>Customers: {snapshot.catalogue.customers?.length || 0}</div>
                <div>Vendors: {snapshot.catalogue.vendors?.length || 0}</div>
                <div className="pt-2">
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
              <Button variant="secondary" onClick={() => navigate("/registration")}>
                Business Registration
              </Button>
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
