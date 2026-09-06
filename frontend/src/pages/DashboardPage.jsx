import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import WorkspacePrompt from "../components/WorkspacePrompt";
import Spinner from "../components/Spinner";
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
  const [workspaceGateOpen, setWorkspaceGateOpen] = useState(false);
  const [livePlanSummary, setLivePlanSummary] = useState(null);
  const [fxRates, setFxRates] = useState({});

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

        // Fetch FX rates for any foreign-currency invoices/expenses
        try {
          const wsIso = (String(ws?.data?.settings?.currency || currency || "GBP").match(/\(([A-Z]{3})\)/)?.[1] || String(currency || "GBP")).toUpperCase().slice(0, 3);
          const allRecs = [...(data?.financials?.invoices || []), ...(data?.financials?.expenses || [])];
          const foreign = [...new Set(allRecs.map(r => {
            const c = String(r.currency || r.source_currency || "").trim();
            return (c.match(/\(([A-Z]{3})\)/)?.[1] || c.match(/^([A-Z]{3})$/i)?.[1] || "").toUpperCase();
          }).filter(iso => iso && iso !== wsIso && iso.length === 3))];
          if (foreign.length && alive) {
            const rates = {};
            await Promise.all(foreign.map(async from => {
              try {
                const d = await apiRequest(`/integrations/currency-rate?from_currency=${from}&to_currency=${wsIso}`, "GET");
                if (d?.rate != null) rates[from] = d.rate;
              } catch {}
            }));
            if (alive) setFxRates(rates);
          }
        } catch {}

        // Load live plan assumptions quietly
        try {
          const lp = await apiRequest(`/businesses/${workspaceId}/live-plan`, "GET");
          if (!alive) return;
          const rawA = Array.isArray(lp?.plan?.assumptions) ? lp.plan.assumptions : [];
          if (rawA.length) {
            const map = {};
            for (const a of rawA) {
              try { map[a.metric_code] = JSON.parse(a.assumption_value_json); }
              catch { map[a.metric_code] = a.assumption_value_json; }
            }
            setLivePlanSummary(map);
          }
        } catch { /* no live plan yet */ }
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
    const wsIso = String(currency || "GBP").replace(/.*\(([A-Z]{3})\).*/, "$1").toUpperCase().slice(0, 3);
    const toWs = (amount, cur) => {
      const num = Number(amount || 0);
      const iso = (String(cur || "").match(/\(([A-Z]{3})\)/)?.[1] || String(cur || "").match(/^([A-Z]{3})$/i)?.[1] || "").toUpperCase();
      if (!iso || iso === wsIso) return num;
      const rate = fxRates[iso];
      return rate != null ? Math.round(num * rate * 100) / 100 : num;
    };
    const rawAmt = r => Number(r?.total_amount || r?.subtotal_amount || 0);

    const paidInvs = (snapshot.invoices || []).filter(i => String(i.status || "").toLowerCase() === "paid");
    const deliveredInvs = (snapshot.invoices || []).filter(i => String(i.status || "").toLowerCase() === "delivered");
    const allExps = snapshot.expenses || [];
    const paidExps = allExps.filter(e => String(e.status || "").toLowerCase() === "paid");

    const actualReceived = (inv) => {
      if (inv.payments && inv.payments.length > 0) return inv.payments.reduce((s, p) => s + Number(p.amount), 0);
      if (inv.payment_type === "partial" && inv.paid_amount != null) return Number(inv.paid_amount);
      return rawAmt(inv);
    };

    const paidRevenue = paidInvs.reduce((s, i) => s + toWs(actualReceived(i), i.currency), 0);
    const paidCoS = paidInvs.reduce((s, i) => {
      const total = rawAmt(i); const received = actualReceived(i);
      const lineItemCos = Array.isArray(i.line_items) ? i.line_items.reduce((ls, li) => ls + (Number(li.qty) || 1) * Number(li.cost_of_sales || 0), 0) : 0;
      const cos = Number(i.cost_of_sales != null ? i.cost_of_sales : lineItemCos);
      return s + toWs(cos * (total > 0 ? received / total : 1), i.currency);
    }, 0);
    const paidExpTotal = paidExps.reduce((s, e) => s + toWs(Number(e.price || e.total_amount || 0), e.currency), 0);
    const cashBalance = paidRevenue - paidExpTotal - paidCoS;
    const partialRemaining = paidInvs
      .filter(i => actualReceived(i) < rawAmt(i))
      .reduce((s, i) => s + toWs(Math.max(0, rawAmt(i) - actualReceived(i)), i.currency), 0);
    const deliveredTotal = deliveredInvs.reduce((s, i) => s + toWs(rawAmt(i), i.currency), 0);
    const receivables = deliveredTotal + partialRemaining;
    const paidFullTotal = paidInvs.reduce((s, i) => s + toWs(rawAmt(i), i.currency), 0);
    const totalRevenue = paidFullTotal + deliveredTotal;
    const totalCosts = allExps.reduce((s, e) => s + toWs(Number(e.price || e.total_amount || 0), e.currency), 0) + paidCoS;

    return { totalRevenue, cashBalance, receivables, totalCosts };
  }, [snapshot, fxRates, currency]);

  const planKpis = useMemo(() => {
    if (!livePlanSummary) return null;
    const planRev = Number(livePlanSummary.monthly_revenue_target) || 0;
    const planCost = Number(livePlanSummary.monthly_costs) || 0;
    const planMargin = Number(livePlanSummary.gross_margin_pct) || 0;
    // Use current-month revenue/costs only to compare against monthly targets
    const now = new Date();
    const curYear = now.getFullYear(); const curMonth = now.getMonth();
    const isThisMonth = (dateStr) => { if (!dateStr) return false; const d = new Date(dateStr); return d.getFullYear() === curYear && d.getMonth() === curMonth; };
    const wsIso2 = String(currency || "GBP").replace(/.*\(([A-Z]{3})\).*/, "$1").toUpperCase().slice(0, 3);
    const toWs2 = (amount, cur) => {
      const num = Number(amount || 0);
      const iso = (String(cur || "").match(/\(([A-Z]{3})\)/)?.[1] || String(cur || "").match(/^([A-Z]{3})$/i)?.[1] || "").toUpperCase();
      if (!iso || iso === wsIso2) return num;
      const rate = fxRates[iso];
      return rate != null ? Math.round(num * rate * 100) / 100 : num;
    };
    // Use stable status-stamp dates — updated_at is refreshed by server on every fetch
    // Paid: payments[last].paid_at → direct paid_at stamp → issue_date fallback
    const paidDate = (inv) => {
      if (inv.payments?.length > 0) return inv.payments[inv.payments.length - 1].paid_at;
      return inv.paid_at || inv.issue_date || inv.issued_at || inv.created_at;
    };
    // Delivered: delivered_at stamp → issue_date fallback
    const deliveredDate = (inv) => inv.delivered_at || inv.issue_date || inv.issued_at || inv.created_at;
    // Expense: use explicit date field
    const expDate = (e) => e.date || e.expense_date || e.issue_date || e.created_at;
    const monthlyPaidInvs = (snapshot.invoices || []).filter(i => String(i.status || "").toLowerCase() === "paid" && isThisMonth(paidDate(i)));
    const monthlyDeliveredInvs = (snapshot.invoices || []).filter(i => String(i.status || "").toLowerCase() === "delivered" && isThisMonth(deliveredDate(i)));
    const monthlyExps = (snapshot.expenses || []).filter(e => isThisMonth(expDate(e)));
    const rawAmt2 = r => Number(r?.total_amount || r?.subtotal_amount || 0);
    const getReceived = (inv) => {
      if (inv.payments?.length > 0) return inv.payments.reduce((s, p) => s + Number(p.amount), 0);
      if (inv.payment_type === "partial" && inv.paid_amount != null) return Number(inv.paid_amount);
      return rawAmt2(inv);
    };
    const monthlyCoS = monthlyPaidInvs.reduce((s, i) => {
      const total = rawAmt2(i); const rcvd = getReceived(i);
      return s + toWs2(Number(i.cost_of_sales || 0) * (total > 0 ? rcvd / total : 1), i.currency);
    }, 0);
    const actualRev = monthlyPaidInvs.reduce((s, i) => s + toWs2(rawAmt2(i), i.currency), 0)
                    + monthlyDeliveredInvs.reduce((s, i) => s + toWs2(rawAmt2(i), i.currency), 0);
    const actualCost = monthlyExps.reduce((s, e) => s + toWs2(Number(e.price || e.total_amount || 0), e.currency), 0) + monthlyCoS;
    const actualMargin = actualRev > 0 ? ((actualRev - actualCost) / actualRev) * 100 : 0;
    const revPct = planRev > 0 ? (actualRev / planRev) * 100 : null;
    const costPct = planCost > 0 ? (actualCost / planCost) * 100 : null;
    const marginDiff = planMargin > 0 ? actualMargin - planMargin : null;
    // Customers / subscribers
    const customerTarget = Number(livePlanSummary.active_customers_target) || 0;
    const actualCustomers = (snapshot.catalogue?.customers || []).length;
    const planProducts = Array.isArray(livePlanSummary.products_services) ? livePlanSummary.products_services.length : 0;
    const actualProducts = (snapshot.catalogue?.products || []).filter(p => !p.archived).length;
    return { planRev, planCost, planMargin, actualRev, actualCost, actualMargin, revPct, costPct, marginDiff, customerTarget, actualCustomers, planProducts, actualProducts };
  }, [livePlanSummary, snapshot, fxRates, currency]);

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
      label: "Expenses & CoS",
      value: formatCurrency(snapshotKpis.totalCosts, currency),
      highlight: snapshotKpis.totalCosts === 0 && snapshotKpis.totalRevenue > 0,
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {financialHealthCards.map((card) => (
          <div
            key={card.label}
            className={
              "min-h-[100px] rounded-2xl border p-3 sm:p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col min-w-0 " +
              (card.highlight ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white")
            }
          >
            <div className="text-[0.78rem] sm:text-[0.85rem] font-medium text-slate-500 leading-snug">{card.label}</div>
            <div className="mt-1.5 text-[1.2rem] sm:text-[1.5rem] xl:text-[1.8rem] font-semibold tracking-tight text-slate-950 break-words min-w-0">
              {card.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  // Launchpad hero shared between onboarded and non-onboarded views
  const launchpadHero = (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
        Launchpad
      </p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900 dark:text-slate-100 sm:text-4xl">
        Your Idea-to-Launch Journey Starts Here
      </h1>
      <p className="mt-1 text-slate-500 dark:text-slate-400">
        Select an action to move your business forward.
      </p>
    </div>
  );

  // 4 action cards shared between onboarded and non-onboarded views
  const actionCards = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[
        {
          title: "Create My Business Plan",
          description: "Build a detailed, fundable business plan.",
          cta: "Start Planning",
          href: "/blueprint",
          icon: (
            <svg className="h-7 w-7 text-slate-700 dark:text-slate-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="13" height="18" rx="2" />
              <path d="M8 7h6M8 11h6M8 15h4" />
              <path d="M15 2v4h4" />
            </svg>
          ),
        },
        {
          title: "Validate My Idea",
          description: "Test assumptions and analyse market risk.",
          cta: "Run Validation",
          href: "/validation",
          icon: (
            <svg className="h-7 w-7 text-slate-700 dark:text-slate-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          ),
        },
        {
          title: "Run Scenarios",
          description: "Test different market conditions and outcomes.",
          cta: "Simulate",
          href: "/simulation",
          icon: (
            <svg className="h-7 w-7 text-slate-700 dark:text-slate-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="6" r="2" />
              <circle cx="19" cy="6" r="2" />
              <circle cx="12" cy="18" r="2" />
              <path d="M7 6h10" />
              <path d="M5 8v6a4 4 0 0 0 4 4h.5" />
              <path d="M19 8v6a4 4 0 0 1-4 4h-.5" />
            </svg>
          ),
        },
        {
          title: "Marketplace",
          description: "Discover tools, templates, and services to grow your business.",
          cta: "Browse Marketplace",
          href: "/marketplace",
          icon: (
            <svg className="h-7 w-7 text-slate-700 dark:text-slate-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l1-5h16l1 5" />
              <path d="M3 9a2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0 2 2 2 2 0 0 0 2-2" />
              <path d="M5 11v9h14v-9" />
              <path d="M10 15h4" />
            </svg>
          ),
        },
      ].map((card) => (
        <div
          key={card.title}
          className="flex flex-col rounded-2xl border border-rose-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-rose-900/40 dark:bg-slate-900"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
            {card.icon}
          </div>
          <div className="mt-4 font-semibold text-slate-900 dark:text-slate-100">{card.title}</div>
          <div className="mt-1 flex-1 text-sm text-slate-500 dark:text-slate-400">{card.description}</div>
          <button
            type="button"
            onClick={() => {
              if (!workspaceId) { setWorkspaceGateOpen(true); } else { navigate(card.href); }
            }}
            className="mt-4 w-full rounded-xl border border-slate-200 bg-white py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {card.cta}
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {launchpadHero}
      {actionCards}

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      {workspaceGateOpen ? (
        <WorkspacePrompt
          modal
          title="Create your workspace first"
          subtitle="You need a workspace before you can use this feature."
          ctaLabel="Set up workspace"
          ctaTo="/validation?from=module&return=/dashboard"
          onClose={() => setWorkspaceGateOpen(false)}
        />
      ) : null}

      <div>
        <div className="mb-3 mt-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          Current Financial Performance &amp; Health
        </div>
        {financialHealthSection}
        {!workspaceId && (
          <p className="mt-3 text-center text-xs text-slate-400">
            <button
              type="button"
              onClick={() => navigate("/validation?from=module&return=/dashboard")}
              className="text-brand-600 hover:underline dark:text-brand-400"
            >
              Set up your workspace
            </button>
            {" "}to see real financial data here.
          </p>
        )}
      </div>

      {/* Live Business Plan summary */}
      {livePlanSummary && (
        <div className="rounded-2xl border border-indigo-100 bg-white p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">Live Business Plan</div>
            </div>
            <Link
              to="/business-plan"
              className="shrink-0 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition"
            >
              Open plan
            </Link>
          </div>

          {/* Plan vs Actual KPIs */}
          {planKpis && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {/* Revenue */}
              {planKpis.planRev > 0 && (() => {
                const pct = planKpis.revPct;
                const tone = pct == null ? "slate" : pct >= 100 ? "emerald" : pct >= 70 ? "amber" : "rose";
                const toneText = { emerald: "text-emerald-600", amber: "text-amber-600", rose: "text-rose-600", slate: "text-slate-400" };
                const status = { emerald: "On target", amber: "Behind", rose: "Below target", slate: "" };
                return (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Revenue / mo</div>
                    <div className="mt-0.5 text-base font-bold text-slate-900">{formatCurrency(planKpis.planRev, currency)}</div>
                    <div className="mt-1 border-t border-slate-100 pt-1 flex items-center justify-between gap-1">
                      <span className="text-[10px] text-slate-500">Actual <span className="font-semibold text-slate-700">{formatCurrency(planKpis.actualRev, currency)}</span></span>
                      {pct != null && <span className={`text-[10px] font-bold ${toneText[tone]}`}>{pct.toFixed(0)}%{status[tone] ? ` · ${status[tone]}` : ""}</span>}
                    </div>
                  </div>
                );
              })()}

              {/* Costs */}
              {planKpis.planCost > 0 && (() => {
                const pct = planKpis.costPct;
                const tone = pct == null ? "slate" : pct <= 100 ? "emerald" : pct <= 130 ? "amber" : "rose";
                const toneText = { emerald: "text-emerald-600", amber: "text-amber-600", rose: "text-rose-600", slate: "text-slate-400" };
                const status = { emerald: "Under budget", amber: "Near limit", rose: "Over budget", slate: "" };
                return (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cost budget / mo</div>
                    <div className="mt-0.5 text-base font-bold text-slate-900">{formatCurrency(planKpis.planCost, currency)}</div>
                    <div className="mt-1 border-t border-slate-100 pt-1 flex items-center justify-between gap-1">
                      <span className="text-[10px] text-slate-500">Actual <span className="font-semibold text-slate-700">{formatCurrency(planKpis.actualCost, currency)}</span></span>
                      {pct != null && <span className={`text-[10px] font-bold ${toneText[tone]}`}>{pct.toFixed(0)}%{status[tone] ? ` · ${status[tone]}` : ""}</span>}
                    </div>
                  </div>
                );
              })()}

              {/* Gross margin */}
              {planKpis.planMargin > 0 && (() => {
                const diff = planKpis.marginDiff;
                const tone = diff == null ? "slate" : diff >= 0 ? "emerald" : diff >= -5 ? "amber" : "rose";
                const toneText = { emerald: "text-emerald-600", amber: "text-amber-600", rose: "text-rose-600", slate: "text-slate-400" };
                return (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Gross margin</div>
                    <div className="mt-0.5 text-base font-bold text-slate-900">{planKpis.planMargin}%</div>
                    <div className="mt-1 border-t border-slate-100 pt-1 flex items-center justify-between gap-1">
                      <span className="text-[10px] text-slate-500">Actual <span className="font-semibold text-slate-700">{planKpis.actualMargin.toFixed(1)}%</span></span>
                      {diff != null && <span className={`text-[10px] font-bold ${toneText[tone]}`}>{diff >= 0 ? "+" : ""}{diff.toFixed(1)}pp</span>}
                    </div>
                  </div>
                );
              })()}

              {/* Customers / Products */}
              {(() => {
                const useCustomers = planKpis.customerTarget > 0;
                const actual = useCustomers ? planKpis.actualCustomers : planKpis.actualProducts;
                const target = useCustomers ? planKpis.customerTarget : planKpis.planProducts;
                const pct = target > 0 ? (actual / target) * 100 : null;
                const tone = pct == null ? "slate" : pct >= 100 ? "emerald" : pct >= 50 ? "amber" : "rose";
                const toneText = { emerald: "text-emerald-600", amber: "text-amber-600", rose: "text-rose-600", slate: "text-slate-400" };
                return (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{useCustomers ? "Customer target" : "Products"}</div>
                    <div className="mt-0.5 text-base font-bold text-slate-900">{target || "—"}</div>
                    <div className="mt-1 border-t border-slate-100 pt-1 flex items-center justify-between gap-1">
                      <span className="text-[10px] text-slate-500">Actual <span className="font-semibold text-slate-700">{actual}</span></span>
                      {pct != null && <span className={`text-[10px] font-bold ${toneText[tone]}`}>{pct.toFixed(0)}%</span>}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

        </div>
      )}

      <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SectionCard title="Recommended next step" subtitle="Based on your latest validation and financials.">
              <div className="space-y-3 text-sm text-slate-600">
                {loading ? (
                  <div className="flex items-center gap-2 text-slate-400"><Spinner size={14} /> Loading…</div>
                ) : (
                  <div className="space-y-2">
                    {/* Live plan KPI recommendations */}
                    {planKpis && (() => {
                      const tips = [];
                      if (planKpis.revPct != null && planKpis.revPct < 90)
                        tips.push({ tone: "rose", text: `Revenue is ${Math.round(planKpis.revPct)}% of target. Focus on closing deals to close the ${formatCurrency(planKpis.planRev - planKpis.actualRev, currency)} gap.` });
                      if (planKpis.costPct != null && planKpis.costPct > 100)
                        tips.push({ tone: "rose", text: `Costs are ${Math.round(planKpis.costPct - 100)}% over budget. Review and reduce non-essential expenses.` });
                      if (planKpis.customerTarget > 0 && planKpis.actualCustomers / planKpis.customerTarget < 0.5)
                        tips.push({ tone: "amber", text: `Only ${planKpis.actualCustomers} of ${planKpis.customerTarget} customers acquired. Prioritise customer acquisition this month.` });
                      if (planKpis.revPct != null && planKpis.revPct >= 90 && planKpis.marginDiff != null && planKpis.marginDiff >= 0)
                        tips.push({ tone: "emerald", text: `Revenue and margin are on track. Consider scaling spend to accelerate growth.` });
                      if (tips.length === 0 && primaryRecommendation)
                        tips.push({ tone: "slate", text: primaryRecommendation.subtitle });
                      if (tips.length === 0)
                        tips.push({ tone: "slate", text: "Complete your workspace to unlock scenario recommendations based on current risk signals." });
                      return tips.slice(0, 2).map((t, i) => (
                        <div key={i} className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-relaxed ${
                          t.tone === "rose" ? "bg-rose-50 text-rose-800" :
                          t.tone === "amber" ? "bg-amber-50 text-amber-800" :
                          t.tone === "emerald" ? "bg-emerald-50 text-emerald-800" :
                          "bg-slate-50 text-slate-700"
                        }`}>
                          <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                            t.tone === "rose" ? "bg-rose-400" : t.tone === "amber" ? "bg-amber-400" : t.tone === "emerald" ? "bg-emerald-400" : "bg-slate-400"
                          }`} />
                          {t.text}
                        </div>
                      ));
                    })()}
                  </div>
                )}
                <Button size="sm" onClick={() => navigate(primaryRecommendation?.scenario_template_id ? `/simulation?template=${primaryRecommendation.scenario_template_id}` : "/simulation")}>
                  Run scenario
                </Button>
              </div>
            </SectionCard>

            <SectionCard title="Financial activity" subtitle="Track invoices, quotations, expenses, and contracts quickly." className="flex h-full flex-col">
              <div className="flex flex-1 flex-col gap-3 text-sm text-slate-600">
                {loading ? (
                  <div className="flex items-center gap-2 text-slate-400"><Spinner size={14} /> Loading…</div>
                ) : (
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
                )}
                <div className="mt-auto">
                  <Button size="sm" variant="secondary" onClick={() => navigate("/financials")}>Go to Financials</Button>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Catalogue status" subtitle="Keep products, customers, and vendors ready for reuse." className="flex h-full flex-col">
              <div className="flex flex-1 flex-col gap-3 text-sm text-slate-600">
                {loading ? (
                  <div className="flex items-center gap-2 text-slate-400"><Spinner size={14} /> Loading…</div>
                ) : (
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
                )}
                <div className="mt-auto">
                  <Button size="sm" variant="secondary" onClick={() => navigate("/catalogue")}>Manage catalogue</Button>
                </div>
              </div>
            </SectionCard>
          </div>

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
        </>

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
