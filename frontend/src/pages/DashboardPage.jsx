import { compactFigure, isFigure } from "../lib/figures";
import { CountText } from "../components/Motion";
import { enter } from "../lib/motion";
import { SkeletonKpi } from "../components/Skeleton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import InlineAlert from "../components/InlineAlert";
import { apiRequest, apiRequestCached } from "../api/client";
import { useWorkspaceStore, workspaceStatusOf } from "../store/workspace";
import { useAuthStore } from "../store/auth";
import { formatCurrency, formatNumber } from "../lib/format";
import { buildFinancialIntelligence } from "../lib/financialIntelligence";
import { getAcceptedWorkspaceValidation } from "../lib/acceptedValidation";
import ReportDownloadPanel from "../components/ReportDownloadPanel";
import { assembleOutput } from "../lib/contracts/index";
import { planRank } from "../lib/plans";
import AgentPanel, { NeedsApprovalPanel, followInAgentBox, taskIn } from "../components/agent/AgentPanel";
import { Icon } from "../components/agent/AgentBits";
import { agentErrorMessage, getAgentSummary, submitAgentRequest } from "../lib/agent";
import { alertDialog } from "../lib/dialog";
import { RANGES, buildKpiTrends } from "../lib/dashboardTrends";
import AdaptiveInsights, { DashboardContext, DashboardSkeleton, LaunchReadiness, ValueTile } from "../components/dashboard/AdaptiveInsights";
import { actionCardsFor } from "../lib/dashboardLayout";
import { recallDashboard, rememberDashboard } from "../lib/dashboard";
import { isPlatformModuleGranted } from "../lib/permissions";
import { ADAPTIVE_DASHBOARD, getDashboard, saveDashboardPreferences, saveDashboardStage, trackDashboard } from "../lib/dashboard";

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";

// Shown immediately, and kept if the insight request fails or returns nothing.
const DEFAULT_INSIGHTS = [
  { key: "next_step", title: "Recommended Next Step", tone: "brand",
    text: "Keep your receivables on terms. A payment follow-up now stops late invoices from building up.",
    cta: { label: "Run scenario", to: "/simulation" }, more: { capability: "payment_followup" } },
  { key: "risk", title: "Fragility / Risk Alert", tone: "rose",
    text: "Check how much of your revenue depends on your largest customers, and whether it is time to diversify.",
    cta: { label: "View risk details", capability: "risk_concentration" }, more: { capability: "risk_concentration" } },
  { key: "scenario", title: "Suggested Scenario", tone: "indigo",
    text: "Run a 10% cost increase scenario to see the impact on your margins.",
    cta: { label: "Run scenario", capability: "scenario_help", params: { scenario: "cost_increase", params: { pct: 10 } } }, more: { to: "/simulation" } },
  { key: "cash", title: "Cash Position", tone: "emerald",
    text: "See your cash position and how many months of runway you have at your current burn rate.",
    cta: { label: "View cash forecast", to: "/operations?tab=Reports" }, more: { to: "/operations?tab=Reports" } },
];

// Soft wave through the points: a Catmull-Rom spline written as cubic Béziers. Control points
// are kept inside the drawing area so the curve can't be clipped where it swings past a peak.
function smoothPath(points, minY = 2, maxY = 26) {
  const n = points.length;
  if (n < 2) return "";
  const clamp = (y) => Math.min(maxY, Math.max(minY, y));
  let d = `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

// A sparkline is only ~80px wide: a dozen points packed that tightly read as sharp corners however
// they are joined. Average neighbouring buckets down to at most `max` knots so each bend has room.
function toKnots(series, max = 6) {
  if (series.length <= max) return series;
  const size = Math.ceil(series.length / max);
  const out = [];
  for (let i = 0; i < series.length; i += size) {
    const chunk = series.slice(i, i + size);
    out.push(chunk.reduce((a, b) => a + b, 0) / chunk.length);
  }
  return out;
}

// Rough width of a figure in ems at bold weight (digits and letters are wide, separators narrow),
// used to keep KPI amounts at 28px and only shrink them when the card is too narrow.
function emWidth(text) {
  return [...String(text)].reduce((w, ch) => w + (/[.,\s]/.test(ch) ? 0.3 : 0.64), 0) * 1.04;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const workspaceStatus = useWorkspaceStore(workspaceStatusOf);
  const workspaceLogo = useWorkspaceStore((s) => s.workspaceLogo);
  const currency = useWorkspaceStore((s) => s.currency);
  const inputs = useWorkspaceStore((s) => s.inputs);
  const ideaValidation = useWorkspaceStore((s) => s.ideaValidation);
  const workspaceDataRefreshTrigger = useWorkspaceStore((s) => s.workspaceDataRefreshTrigger);
  const email = useAuthStore((s) => s.email);
  const subscription = useAuthStore((s) => s.subscription);
  const platformGrants = useAuthStore((s) => s.platformGrants);
  // Live Business Plan is a Decision Engine+ feature — the dashboard shouldn't
  // fetch or render it for lower-plan accounts.
  const hasLivePlanAccess = subscription?.status === "grandfathered"
    || planRank(subscription?.plan_key) >= planRank("decision_engine");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [comingSoonFeature, setComingSoonFeature] = useState(null);
  const [livePlanSummary, setLivePlanSummary] = useState(null);
  const [fxRates, setFxRates] = useState({});
  const [agentSummary, setAgentSummary] = useState(() => (ADAPTIVE_DASHBOARD ? recallDashboard(workspaceId)?.agent || null : null));
  const [rangeKey, setRangeKey] = useState("3m");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [insightBusy, setInsightBusy] = useState("");

  // Adaptive Dashboard (PRD-AD-001): one composed response drives the Agent panel, approvals
  // and the priority cards. If it is switched off (build flag or server flag) the page works
  // as it did before; if it fails, only the insight cards say so and the rest carries on.
  // Starts from the last composition seen for this business in this tab, if there is one.
  const [dashboard, setDashboard] = useState(() => (ADAPTIVE_DASHBOARD && !new URLSearchParams(window.location.search).get("stage") ? recallDashboard(workspaceId) : null));
  const [fromMemory, setFromMemory] = useState(() => Boolean(dashboard));
  const [dashLoading, setDashLoading] = useState(ADAPTIVE_DASHBOARD);
  const [dashFailed, setDashFailed] = useState(false);
  const [adaptiveOff, setAdaptiveOff] = useState(!ADAPTIVE_DASHBOARD);
  const [prefSaving, setPrefSaving] = useState(false);
  const viewTracked = useRef(false);
  const adaptive = ADAPTIVE_DASHBOARD && !adaptiveOff;
  // QA: /dashboard?pathway=startup shows the Startup pathway's priorities for this business
  // (nothing is changed; the server ignores it in production).
  const [searchParams] = useSearchParams();
  const previewPathway = searchParams.get("pathway");
  const previewStage = searchParams.get("stage");      // QA: ?stage=idea|pre_launch|operating|growth
  const openReportParam = searchParams.get("report") === "open";      // e.g. the Agent's "Launch Checklist" shortcut
  const reportRef = useRef(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadAgentSummary = useCallback(() => {
    if (!workspaceId) return;
    const legacy = () => getAgentSummary(workspaceId).then(setAgentSummary).catch(() => {
      // Never leave the page waiting: keep what we have, or fall back to an empty summary.
      setAgentSummary((prev) => prev || { suggestions: [], needs_approval: [], needs_approval_count: 0, insights: [], risks: null, unavailable: true });
    });
    if (!ADAPTIVE_DASHBOARD) return legacy();
    return getDashboard(workspaceId, { stage: previewStage, pathway: previewPathway }).then((d) => {
      if (!d?.enabled) { setAdaptiveOff(true); setDashboard(null); return legacy(); }
      setAdaptiveOff(false);
      setDashFailed(false);
      setDashboard(d);
      setFromMemory(false);
      setAgentSummary(d.agent);
      rememberDashboard(workspaceId, d);
      if (!viewTracked.current) {
        viewTracked.current = true;
        trackDashboard(workspaceId, "dashboard_viewed", null, { pathway: d.context?.pathway, cards: d.insights?.length || 0 });
      }
      return d;
    }).catch(() => {
      setDashFailed(true);
      return legacy();      // the Agent panel and approvals still load from their own source
    }).finally(() => setDashLoading(false));
  }, [workspaceId, previewPathway, previewStage]);

  async function changeStage(stage) {
    if (!workspaceId) return;
    setPrefSaving(true);
    try {
      await saveDashboardStage(workspaceId, stage);
      trackDashboard(workspaceId, "stage_changed", null, { stage: stage || "auto" });
      await loadAgentSummary();
    } catch {
      // Nothing changed: the dashboard stays as it was.
    } finally {
      setPrefSaving(false);
    }
  }

  async function refreshDashboard() {
    setRefreshing(true);
    try {
      window.dispatchEvent(new CustomEvent("ea:workspace:refresh"));      // the KPI row's records too
      await loadAgentSummary();
    } finally {
      setRefreshing(false);
    }
  }

  async function savePreference(patch, eventType, widgetId) {
    if (!workspaceId) return;
    setPrefSaving(true);
    try {
      await saveDashboardPreferences(workspaceId, patch);
      if (eventType) trackDashboard(workspaceId, eventType, widgetId, patch.current_goal ? { goal: patch.current_goal } : null);
      await loadAgentSummary();
    } catch {
      // A preference that didn't save leaves the dashboard exactly as it was.
    } finally {
      setPrefSaving(false);
    }
  }
  useEffect(() => { loadAgentSummary(); }, [loadAgentSummary, workspaceDataRefreshTrigger]);
  // Another business: its own last composition, or the skeleton. Never the previous business's.
  const shownFor = useRef(workspaceId);
  useEffect(() => {
    if (shownFor.current === workspaceId) return;
    shownFor.current = workspaceId;
    const last = ADAPTIVE_DASHBOARD && !previewStage ? recallDashboard(workspaceId) : null;
    setDashboard(last);
    setFromMemory(Boolean(last));
    setAgentSummary(last?.agent || null);
    setDashFailed(false);
    setDashLoading(ADAPTIVE_DASHBOARD);
  }, [workspaceId, previewStage]);

  // Arriving from a task begun on the homepage (/dashboard?task=<id>): that task opens in the Agent
  // box as soon as the box is there, so the first thing on the dashboard is the work, not an empty page.
  const handedOff = useRef("");
  useEffect(() => {
    const task = searchParams.get("task");
    if (!task || !agentSummary || handedOff.current === task) return;
    // Marked and sent in one go. (It used to wait on a timer that the dashboard's own refresh
    // cancelled, after the task had already been marked as handed over: so it never opened.)
    handedOff.current = task;
    setTimeout(() => {
      followInAgentBox({ runId: task });
      navigate("/dashboard", { replace: true });
    }, 0);
  }, [searchParams, agentSummary, navigate]);

  // Insight and card actions go to the one Agent, or to the page that owns the detail.
  async function runAction(key, action) {
    if (!action) return;
    // A button that leads to an Agent task ("Give the email address", "See the result") opens that
    // task's question, problem or result in the Agent box on this page.
    const task = action.run_id || taskIn(action.to);
    if (task) return followInAgentBox({ runId: task });
    if (action.to) return navigate(action.to);
    if (!action.capability || insightBusy) return;
    setInsightBusy(key);
    try {
      const res = await submitAgentRequest({
        businessId: workspaceId, capability: action.capability, params: action.params,
        sourceChannel: "ui_action", sourceReference: `insight:${key}`, recommendationId: `insight:${key}`, background: true,
      });
      loadAgentSummary();
      if (res.run) followInAgentBox({ run: res.run });
      // Not started (out of credits, a plan limit, nothing to act on): say so here, not on another page.
      else alertDialog(res.message || "The Agent couldn't start that.", { title: res.kind === "blocked" ? "Not started" : "Nothing to do", tone: "info" });
    } catch (e) {
      alertDialog(agentErrorMessage(e, "The Agent couldn't start that. Please try again."), { title: "Not started" });
    } finally {
      setInsightBusy("");
    }
  }

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
      if (!workspaceId) return;      // still loading: the layout is resolving the active workspace
      setLoading(true);
      setError(null);
      // The live plan doesn't depend on the workspace document: request both together.
      const livePlanRequest = hasLivePlanAccess
        ? apiRequest(`/businesses/${workspaceId}/live-plan`, "GET").catch(() => null) // no live plan yet
        : Promise.resolve(null);
      try {
        const ws = await apiRequestCached(`/validation/${workspaceId}`);
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

        // Live plan assumptions arrive quietly — Decision Engine+ only. Not awaited here,
        // so the figures above show as soon as they are ready.
        livePlanRequest.then((lp) => {
          if (!alive) return;
          const rawA = Array.isArray(lp?.plan?.assumptions) ? lp.plan.assumptions : [];
          if (!rawA.length) { if (!hasLivePlanAccess) setLivePlanSummary(null); return; }
          const map = {};
          for (const a of rawA) {
            try { map[a.metric_code] = JSON.parse(a.assumption_value_json); }
            catch { map[a.metric_code] = a.assumption_value_json; }
          }
          setLivePlanSummary(map);
        });
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load dashboard data.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    // If no workspace ever arrives (e.g. the request failed), stop waiting rather than spin forever.
    const giveUp = workspaceId ? null : setTimeout(() => { if (alive) setLoading(false); }, 10000);
    return () => { alive = false; if (giveUp) clearTimeout(giveUp); };
  }, [workspaceId, workspaceDataRefreshTrigger, hasLivePlanAccess]);

  const metrics = useMemo(
    () => buildFinancialIntelligence({
      catalogue: snapshot.catalogue,
      financials: { invoices: snapshot.invoices, quotes: snapshot.quotations, expenses: snapshot.expenses, contracts: snapshot.contracts },
      validation: acceptedValidation,
    }),
    [acceptedValidation, snapshot]
  );

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
    const _storedMargin = Number(livePlanSummary.gross_margin_pct) || 0;
    const planMargin = _storedMargin > 0 && _storedMargin < 100
      ? _storedMargin
      : (Number(livePlanSummary.monthly_revenue_target) > 0
          ? Math.round((Number(livePlanSummary.monthly_revenue_target) - Number(livePlanSummary.monthly_costs || 0)) / Number(livePlanSummary.monthly_revenue_target) * 1000) / 10
          : 0);
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

  const trends = useMemo(() => {
    const wsIso = String(currency || "GBP").replace(/.*\(([A-Z]{3})\).*/, "$1").toUpperCase().slice(0, 3);
    const toWs = (amount, cur) => {
      const num = Number(amount || 0);
      const iso = (String(cur || "").match(/\(([A-Z]{3})\)/)?.[1] || String(cur || "").match(/^([A-Z]{3})$/i)?.[1] || "").toUpperCase();
      if (!iso || iso === wsIso) return num;
      const rate = fxRates[iso];
      return rate != null ? Math.round(num * rate * 100) / 100 : num;
    };
    return buildKpiTrends({ invoices: snapshot.invoices, expenses: snapshot.expenses, toWs, rangeKey });
  }, [snapshot, fxRates, currency, rangeKey]);

  // `goodWhenUp` decides the colour: more revenue is good, more cost or risk is not.
  const financialHealthCards = [
    { label: "Total Revenue", value: formatCurrency(trends.revenue.value, currency, "en-GB"), trend: trends.revenue, goodWhenUp: true },
    { label: "Cash", value: formatCurrency(trends.cash.value, currency, "en-GB"), trend: trends.cash, goodWhenUp: true },
    { label: "Expenses & CoS", value: formatCurrency(trends.costs.value, currency, "en-GB"), trend: trends.costs, goodWhenUp: false },
    { label: "Receivables", trend: trends.receivables, goodWhenUp: true,
      value: formatCurrency(adaptive && typeof dashboard?.financial_summary?.receivables === "number"
        ? dashboard.financial_summary.receivables : trends.receivables.value, currency, "en-GB") },
    { label: "Active Risks", value: formatNumber(Array.isArray(agentSummary?.risks) ? agentSummary.risks.length : trends.risks.value), trend: trends.risks, goodWhenUp: false },
  ];

  const trendTile = { revenue: financialHealthCards[0], cash: financialHealthCards[1], costs: financialHealthCards[2],
    receivables: financialHealthCards[3], risks: financialHealthCards[4] };
  const stageKpis = adaptive && dashboard?.kpis?.length ? dashboard.kpis : null;
  // A stage figure that has a value is drawn like the trading ones: value, change against the
  // start of the period and a sparkline. Where there is no history for it, the line is flat and
  // grey and no percentage is shown: nothing is made up. A figure with no value yet keeps the
  // plain tile, which says what is missing and where to add it.
  const rangeStart = Date.now() - (RANGES.find((r) => r.key === rangeKey)?.days || 91) * 86400000;
  const stageTile = (k) => {
    const missing = k.value === null || k.value === undefined || k.value === "" || k.state === "insufficient_data";
    if (missing) return { ...k, simple: true };
    const points = (k.trend?.points || []).filter((p) => !p.at || new Date(p.at).getTime() >= rangeStart).map((p) => Number(p.value)).filter(Number.isFinite);
    const changePct = points.length >= 2 && points[0] !== 0 ? ((points[points.length - 1] - points[0]) / Math.abs(points[0])) * 100 : null;
    return { key: k.key, label: k.label, value: String(k.value), hint: k.hint, to: k.to, valueTone: k.tone, stage: true,
      trend: { changePct, series: points.length >= 2 ? points : [0, 0] }, goodWhenUp: k.good_when_up !== false,
      noHistory: points.length < 2 };      // fewer than two days on record: nothing to draw yet
  };
  const kpiTiles = stageKpis
    ? stageKpis.map((k) => (k.client_trend && trendTile[k.client_trend] ? { ...trendTile[k.client_trend], label: k.label, key: k.key } : stageTile(k)))
    : financialHealthCards;
  const kpisEmpty = adaptive ? dashboard?.kpis_empty : null;
  const hasTrendTiles = kpiTiles.some((t) => !t.simple);
  const stageFigures = Boolean(stageKpis) && !stageKpis.some((k) => k.client_trend);

  // One size for the whole row: 28px where the longest figure fits its card, smaller where it doesn't.
  const kpiEmWidth = Math.max(...kpiTiles.filter((c) => !c.simple).map((c) => emWidth(c.value)), 1);

  const financialHealthSection = (
    <section>
      {/* Mobile: two columns, the fifth card spans both. From 640px the cards flex from a 180px
          base and grow to fill their row, so there is never an empty slot. From 1280px: five equal columns. */}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr))]" data-kpi-grid>
        {loading && [0, 1, 2, 3, 4].map((i) => (
          <div key={i} role="status" aria-busy="true" aria-label="Loading" className={i === 4 ? "min-[380px]:col-span-2 xl:col-span-1" : ""}><SkeletonKpi /></div>
        ))}
        {!loading && kpiTiles.map((card, index) => {
          if (card.simple) return <ValueTile key={card.key} kpi={card} wide={index === 4} onOpen={(k) => navigate(k.to)} />;
          const pct = card.trend.changePct;
          const up = pct != null && pct > 0.05;
          const down = pct != null && pct < -0.05;
          const good = pct == null || (!up && !down) ? null : up === card.goodWhenUp;
          const tone = good == null ? "text-slate-400" : good ? "text-emerald-600" : "text-rose-600";
          // For display only: a light 3-point average, then a few knots, so the line reads as a
          // soft trend rather than spikes.
          const raw = card.trend.series;
          const series = toKnots(raw.map((v, i) => (raw[Math.max(0, i - 1)] + v + raw[Math.min(raw.length - 1, i + 1)]) / 3));
          const min = Math.min(...series);
          const span = Math.max(...series) - min || 1;
          const pts = series.map((v, i) => [(i / Math.max(1, series.length - 1)) * 96 + 2, 25 - ((v - min) / span) * 21]);
          const line = smoothPath(pts);
          const gradId = `kpi-fill-${card.label.replace(/[^a-z]/gi, "")}`;
          const shown = card.value;      // full amount, e.g. "£138,500.00"
          // Line colour follows the trend: green when it's good, red when it's bad (rising costs or
          // risks are bad). Grey only when there is nothing to plot.
          const hasData = raw.some((v) => Math.abs(v) > 0.005);
          const half = Math.floor(raw.length / 2);
          const avg = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
          const direction = pct != null && (up || down) ? Math.sign(pct) : Math.sign(avg(raw.slice(half)) - avg(raw.slice(0, half)));
          const lineTone = !hasData ? "text-slate-300" : direction === 0 || (direction > 0) === card.goodWhenUp ? "text-emerald-600" : "text-rose-600";
          return (
            <div key={card.label} title={card.hint || undefined} data-kpi={card.key || card.label} {...enter("fadeUp", index, 120)} className={`flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-900`}>
              <div className="text-[15px] font-medium text-slate-500">{card.label}</div>
              {/* Never cut off: a long amount is shown short (£1.25M), with the full amount in the tooltip and the accessible name. */}
              <div className="mt-1 min-w-0">
                <div data-kpi-value title={card.value} aria-label={card.value} role="text"
                  className={`font-bold tabular-nums leading-tight tracking-tight text-slate-950 dark:text-slate-100 ${isFigure(shown) ? "whitespace-nowrap" : "break-words"}`}
                  style={{ fontSize: "clamp(1.25rem, 2.2vw, 1.75rem)" }}><CountText text={compactFigure(shown)} /></div>
              </div>
              {card.noHistory && (
                // No flat line standing in for a trend: the figure is being recorded daily from now.
                <p className="mt-2 text-[12px] leading-snug text-slate-400" data-kpi-caption>Tracking starts today</p>
              )}
              {/* With nothing to compare against there is no trend to show: the sparkline is centred. */}
              <div className={`mt-2 flex items-end gap-2 ${card.noHistory ? "hidden" : ""} ${pct == null ? "justify-center" : "justify-between"}`}>
                {pct != null && (
                  <span {...enter("fadeIn", index, 500)} className={`inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold ${tone}`}>
                    {(up || down) && (
                      <svg className={`h-3.5 w-3.5 ${down ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                    )}
                    <span className="sr-only">{up ? "Up" : down ? "Down" : "No change"}</span>
                    {`${pct > 0 ? "+" : ""}${Math.round(pct)}%`}
                  </span>
                )}
                <svg viewBox="0 0 100 28" className={`h-7 min-w-0 flex-1 ${pct == null ? "max-w-[7rem]" : "max-w-[5rem]"} ${lineTone}`} aria-hidden="true" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={`${line} L98,28 L2,28 Z`} fill={`url(#${gradId})`} stroke="none" />
                  <path d={line} className="m-line-draw" style={{ "--m-length": 400 }} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </svg>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  // Launchpad hero shared between onboarded and non-onboarded views
  const launchpadHero = (
    <div className="flex items-center justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Dashboard</p>
        <h1 className="mt-1 text-[clamp(1.75rem,calc(5vw-1.875rem),2.875rem)] font-extrabold leading-[1.1] tracking-tight text-slate-900 dark:text-slate-100">
          Your <span className="text-indigo-600">Adaptive</span> Business Dashboard
        </h1>
        <p className="mt-2 text-[clamp(0.9375rem,1.2vw,1.0625rem)] text-slate-500 dark:text-slate-400">
          See what matters most, what needs attention, and what EnterprateAI can help you do next.
        </p>
      </div>
      <div className="hidden shrink-0 items-center gap-3 rounded-2xl bg-gradient-to-r from-indigo-50/40 via-indigo-50 to-indigo-100/70 py-3 pl-3 pr-5 xl:flex dark:from-slate-800 dark:via-slate-800 dark:to-slate-800">
        <span className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full"
          style={{ background: "radial-gradient(circle at 35% 30%, #ffffff 0%, #eef0ff 38%, #dfe3ff 62%, rgba(199,205,255,0.55) 82%, rgba(199,205,255,0) 100%)", boxShadow: "0 0 28px 6px rgba(129,140,248,0.28)" }}
          aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-8 w-8 text-indigo-600" fill="currentColor"><path d="M12 1.5C12.8 8 16 11.2 22.5 12 16 12.8 12.8 16 12 22.5 11.2 16 8 12.8 1.5 12 8 11.2 11.2 8 12 1.5Z" /></svg>
        </span>
        <p className="whitespace-nowrap text-[14px] leading-snug text-indigo-600 2xl:text-[15px] dark:text-indigo-300">Smarter insights.<br />Faster decisions.<br />A more resilient business.</p>
      </div>
    </div>
  );

  const CHIP_TONE = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800", amber: "border-amber-200 bg-amber-50 text-amber-900",
    rose: "border-rose-200 bg-rose-50 text-rose-800", slate: "border-slate-200 bg-slate-50 text-slate-700",
  };
  const ACTION_ICON = {
    doc: <><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" /><path d="M15 2v5h5" /><path d="M8 13h8M8 17h5" /></>,
    check: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" /><path d="M9 7h7M9 11h5" /></>,
    bars: <><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M7 6h10" /><path d="M5 8v6a4 4 0 0 0 4 4h.5" /><path d="M19 8v6a4 4 0 0 1-4 4h-.5" /></>,
    shield: <><path d="M12 3l8 3v6c0 4.5-3.2 8.3-8 9-4.8-.7-8-4.5-8-9V6l8-3Z" /><path d="M9 12l2 2 4-4" /></>,
    cash: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9.5v5M18 9.5v5" /></>,
    rocket: <><path d="M5 15c-1.5 1.5-2 5-2 5s3.500-.5 5-2c.8-.8.8-2.200 0-3s-2.200-.8-3 0Z" /><path d="M9 12a22 22 0 0 1 8-9c2 0 4 2 4 4a22 22 0 0 1-9 8l-3-3Z" /><path d="M9 12H5l2-4h4M12 15v4l4-2v-4" /></>,
    store: <><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" /><path d="M3 9l2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9" /><path d="M9 14h6" /></>,
  };
  // Three action cards per stage (lib/dashboardLayout). A Funding or Launch Readiness card shows
  // the selected case's or launch's status in place of its description once one exists.
  const actionCards = (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {actionCardsFor(adaptive ? dashboard : null).map((card, n) => (
        <div key={card.key} {...enter("fadeUp", 1 + n)}
          className="flex min-w-0 flex-col rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
              <svg className="h-7 w-7 text-slate-700 dark:text-slate-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {ACTION_ICON[card.icon] || ACTION_ICON.doc}
              </svg>
            </div>
            <div title={card.title} className="flex min-h-[2.75rem] min-w-0 flex-1 items-center text-base font-bold leading-snug text-slate-900 dark:text-slate-100"><span className="line-clamp-2 break-words">{card.title}</span></div>
            <button type="button" onClick={() => navigate(card.href)} aria-label={card.cta}
              className="mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:border-brand-300 hover:text-brand-600 md:hidden xl:flex dark:border-slate-700">
              <Icon name="chevron" className="h-3.5 w-3.5" />
            </button>
          </div>
          {card.status ? (
            <div className="mt-3 min-h-[3rem] flex-1">
              <p className="truncate text-[13px] font-semibold text-slate-700 dark:text-slate-200" title={card.status.name}>{card.status.name}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-600 dark:text-slate-300">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-semibold ${CHIP_TONE[card.status.chip.tone]}`}>
                  {card.status.chip.mark === "✓" && <span aria-hidden="true">✓</span>}{card.status.chip.label}
                </span>
                {card.status.score !== null && <span>Score {card.status.score}</span>}
                {card.status.progress && <span>{card.status.progress}</span>}
                {card.status.stale && <span className="font-semibold text-amber-700 dark:text-amber-300">Out of date</span>}
              </p>
            </div>
          ) : (
            <div className="mt-3 min-h-[3rem] flex-1 text-[15px] leading-relaxed text-slate-500 line-clamp-2 dark:text-slate-400">{card.description}</div>
          )}
          <button type="button" onClick={() => navigate(card.href)}
            className="mt-4 w-full rounded-xl border border-slate-200 bg-white py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
            {card.cta}
          </button>
        </div>
      ))}
    </div>
  );

  const stageReport = adaptive ? dashboard?.report : null;
  // Arriving with ?report=open shows the stage's report (the launch checklist, at pre-launch) and brings it into view.
  useEffect(() => {
    if (!openReportParam || !dashboard) return;
    setShowReports(true);
    const t = setTimeout(() => reportRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }), 50);
    return () => clearTimeout(t);
  }, [openReportParam, dashboard]);

  const INSIGHT_STYLE = {
    brand: { card: "border-slate-200 bg-white", icon: "bg-indigo-50 text-indigo-600", title: "text-indigo-700", name: "bulb", primary: true },
    rose: { card: "border-rose-200 bg-rose-50", icon: "bg-rose-100 text-rose-600", title: "text-rose-700", name: "alert" },
    indigo: { card: "border-slate-200 bg-white", icon: "bg-blue-50 text-blue-600", title: "text-blue-700", name: "bars" },
    emerald: { card: "border-emerald-200 bg-emerald-50", icon: "bg-emerald-100 text-emerald-600", title: "text-emerald-700", name: "cash" },
  };

  // Until the composition for this business has arrived, nothing stage-specific is drawn: no
  // suggestions, shortcuts, cards, figures or links from any default. A click in that moment
  // could otherwise go to a page that belongs to another stage.
  if (adaptive && !workspaceId) {
    // No business yet. While it is still being confirmed: the skeleton. Once it is certain
    // there is none: an empty state. Never another stage's shortcuts.
    return (
      <div className="space-y-6">
        {launchpadHero}
        {workspaceStatus === "checking" ? <DashboardSkeleton /> : (
          <div role="status" aria-label="No business yet" className="rounded-2xl border border-slate-200/70 bg-white px-6 py-10 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">Set up your business to see your dashboard</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">Your dashboard is built from your business's details and records. Add the basics and it will appear here.</p>
            <button type="button" onClick={() => navigate("/onboarding?next=%2Fdashboard")}
              className="mt-4 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Set up your business</button>
          </div>
        )}
      </div>
    );
  }
  if (adaptive && workspaceId && !dashboard) {
    return (
      <div className="space-y-6">
        {launchpadHero}
        {dashFailed ? (
          <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">
            <p className="font-semibold">Your dashboard couldn't be loaded.</p>
            <p className="mt-1 text-rose-700">Nothing was changed. Check your connection and try again.</p>
            <button type="button" onClick={() => { setDashFailed(false); setDashLoading(true); loadAgentSummary(); }}
              className="mt-3 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-rose-700 hover:bg-rose-100">Try again</button>
          </div>
        ) : <DashboardSkeleton />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {launchpadHero}
      {adaptive && dashboard?.context && (
        <DashboardContext context={dashboard.context} saving={prefSaving}
          freshness={dashboard.freshness} refreshing={refreshing || fromMemory} onRefresh={refreshDashboard} onStage={changeStage}
          onGoal={(goal) => savePreference({ current_goal: goal || null }, "goal_changed")} />
      )}

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      {/* Needs Approval always sits beside the Agent card (below it on narrow screens), also when it is empty. */}
      <div {...enter("fadeUp", 0)} className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        {/* A remembered copy is showing while the fresh one loads: approvals and anything that starts a task wait for it. */}
        <AgentPanel businessId={workspaceId} summary={agentSummary} onChanged={loadAgentSummary} paused={fromMemory} />
        <NeedsApprovalPanel businessId={workspaceId} summary={agentSummary} onChanged={loadAgentSummary} paused={fromMemory} />
      </div>

      {actionCards}

      {kpisEmpty ? (
        <p role="status" aria-label="Key figures" className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-200">Key figures</span> · {kpisEmpty}
        </p>
      ) : (
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-slate-700 dark:text-slate-200">
            {stageFigures ? "Key Figures for Your Stage" : <>Current Financial Performance &amp; Health</>}
          </h2>
          <div className={`relative ${hasTrendTiles ? "" : "hidden"}`}>
            <button type="button" onClick={() => setRangeOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={rangeOpen}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <Icon name="calendar" className="h-4 w-4 text-slate-400" />
              {trends.range.label}
              <span className="rotate-90 text-slate-400"><Icon name="chevron" className="h-3 w-3" /></span>
            </button>
            {rangeOpen && (
              <ul role="listbox" className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                {RANGES.map((r) => (
                  <li key={r.key}>
                    <button type="button" role="option" aria-selected={r.key === rangeKey} onClick={() => { setRangeKey(r.key); setRangeOpen(false); }}
                      className={`block w-full px-3 py-2 text-left text-[13px] ${r.key === rangeKey ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
                      {r.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {financialHealthSection}
      </div>
      )}

      {adaptive ? (
        <AdaptiveInsights dashboard={dashboard} loading={dashLoading && !dashboard} failed={dashFailed && !dashboard}
          fullSimulation={subscription?.status === "grandfathered" || isPlatformModuleGranted("simulation", platformGrants)} paused={fromMemory}
          busyKey={insightBusy} onRetry={() => { setDashLoading(true); loadAgentSummary(); }}
          onAction={(card, action) => {
            trackDashboard(workspaceId, action?.upgrade ? "upgrade_clicked" : "insight_action", card.key,
              { priority_class: card.priority_class, agent: !!action?.agent, action: action?.capability || action?.to || (action?.run_id ? "open_run" : null) });
            runAction(card.key, action);
          }}
          onWhy={(card) => trackDashboard(workspaceId, "insight_why_opened", card.key, { priority_class: card.priority_class })}
          onHide={(card) => savePreference({ hidden_widget_ids: [...(dashboard?.preferences?.hidden_widget_ids || []), card.key] })}
          onShowHidden={() => savePreference({ hidden_widget_ids: [] })} />
      ) : (
      <div>
        <h2 className="mb-3 text-[15px] font-semibold text-slate-700 dark:text-slate-200">Adaptive Insights for Your Business</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(agentSummary?.insights?.length ? agentSummary.insights : DEFAULT_INSIGHTS).map((ins) => {
            const st = INSIGHT_STYLE[ins.tone] || INSIGHT_STYLE.indigo;
            return (
              <div key={ins.key} className={`flex flex-col rounded-2xl border p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${st.card}`}>
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${st.icon}`}><Icon name={st.name} className="h-5 w-5" /></span>
                  <span className={`text-base font-semibold leading-tight tracking-tight ${st.title}`}>{ins.title}</span>
                </div>
                <p className="mt-2.5 flex-1 text-[14px] leading-relaxed text-slate-600 dark:text-slate-300">{ins.text}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button type="button" disabled={!!insightBusy} onClick={() => runAction(ins.key, ins.cta)}
                    className={`px-4 py-1.5 text-[13px] font-semibold transition disabled:opacity-60 ${st.primary
                      ? "rounded-full bg-indigo-600 text-white hover:bg-indigo-700"
                      : "rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
                    {insightBusy === ins.key ? "Working…" : ins.cta.label}
                  </button>
                  <button type="button" disabled={!!insightBusy} onClick={() => runAction(ins.key, ins.more)} aria-label={`More on ${ins.title}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900">
                    <Icon name="chevron" className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* One banner closes the page. The launch and funding status are on the stage cards above, and the
          setup checklist opens from this report, so there is no separate readiness strip or checklist banner. */}

      <div ref={reportRef} {...enter("fadeUp", 6)} data-health-banner className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <span aria-hidden="true" data-banner-art className="m-glow-soft pointer-events-none absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-brand-50 to-transparent dark:hidden" />
        {/* Right gutter: this is the last row, where the floating chat button rests. The gutter
            keeps "View Business Health Report" clear of it wherever the page is scrolled. */}
        <div className="relative flex flex-wrap items-center gap-4 sm:pr-14">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30"><Icon name="report" className="h-6 w-6" /></span>
          <div className="min-w-0 flex-[1_1_200px]">
            <div className="text-base font-bold text-slate-900 dark:text-slate-100">Business Health Report</div>
            <p className="text-[15px] text-slate-500 dark:text-slate-400">
              Updated {new Date(dashboard?.freshness?.generated_at || Date.now()).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              {" · "}{stageReport?.action?.panel === "launch_readiness" ? "Includes your setup checklist and launch readiness."
                : stageReport?.description || "A full assessment of your business performance, risks and recommendations."}
            </p>
          </div>
          <button type="button" aria-expanded={showReports}
            onClick={() => {
              if (!showReports) trackDashboard(workspaceId, "report_opened", stageReport?.key || "business_health_report");
              if (stageReport?.action?.to) return navigate(stageReport.action.to);
              setShowReports((v) => !v);
            }}
            className="mr-12 inline-flex w-[calc(100%-3rem)] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-semibold sm:mr-0 sm:w-auto text-brand-700 transition hover:bg-brand-100 dark:border-brand-900/50 dark:bg-brand-900/20 dark:text-brand-300">
            {showReports && !stageReport?.action?.to ? "Hide report" : "View Business Health Report"}
            <span className={showReports && !stageReport?.action?.to ? "-rotate-90" : ""}><Icon name="chevron" className="h-3.5 w-3.5" /></span>
          </button>
        </div>
        {showReports && stageReport?.action?.panel === "launch_readiness" && (
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            <LaunchReadiness readiness={dashboard?.launch_readiness} onOpen={(item) => navigate(item.to)}
              check={stageReport?.secondary && dashboard?.readiness_features?.launch
                ? { label: stageReport.secondary.label, to: dashboard?.launch_check ? `/launch/${dashboard.launch_check.initiative_id}` : stageReport.secondary.to } : null} />
          </div>
        )}
        {showReports && stageReport?.action?.panel !== "launch_readiness" && (
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
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
              // One report entry on the dashboard (PRD-AD-001 s8.3); specialist reports live in their modules.
              reportTypes={adaptive ? ["business_health_report"] : ["business_health_report", "investor_summary", "fragility_report", "stability_report"]}
            />
          </div>
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
              {planKpis.planRev > 0 && (() => {
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
              {planKpis.planRev > 0 && (() => {
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
