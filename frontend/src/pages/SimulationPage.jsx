import { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import WorkspacePrompt from "../components/WorkspacePrompt";
import Spinner from "../components/Spinner";
import NumberInput, { parseNumber } from "../components/NumberInput";
import { SimulationIllustration } from "../components/Illustrations";
import { apiRequest } from "../api/client";
import { useWorkspaceStore, workspaceCurrencyOf } from "../store/workspace";
import { useAuthStore } from "../store/auth";
import { formatCurrency, formatNumber, invoiceNumbers, shortDate } from "../lib/format";
import InfoTip from "../components/InfoTip";
import { buildFinancialIntelligence } from "../lib/financialIntelligence";
import { withSharedFigures } from "../lib/sharedFigures";
import { getAcceptedWorkspaceValidation } from "../lib/acceptedValidation";
import { hasFeatureAccess, isPlatformFeatureRestricted, isPlatformModuleGranted } from "../lib/permissions";
import { normalisePlanKey, planAllowsScenario, planRank } from "../lib/plans";
import ConfirmDialog from "../components/ConfirmDialog";
import ReportDownloadPanel from "../components/ReportDownloadPanel";
import { assembleOutput } from "../lib/contracts/index";
import CreditConfirmModal from "../components/CreditConfirmModal";
import { refusalMessage, refusalOf } from "../lib/entitlement";

const FieldLabel = ({ children, info }) => (
  <div className="ea-label flex items-center gap-2">
    <span>{children}</span>
    {info ? <InfoTip text={info} /> : null}
  </div>
);

function asNonEmptyString(value, fallback) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value == null) return fallback;
  const coerced = String(value).trim();
  return coerced || fallback;
}

function observedMonths(items) {
  const dates = items
    .map((item) => {
      const ts = new Date(item?.paid_at || item?.issued_at || item?.created_at || item?.updated_at || "").getTime();
      return Number.isFinite(ts) ? ts : null;
    })
    .filter((value) => value != null);
  if (!dates.length) return 1;
  const earliest = Math.min(...dates);
  const latest = Math.max(...dates, Date.now());
  const days = Math.max(1, Math.ceil((latest - earliest) / (1000 * 60 * 60 * 24)));
  return Math.max(1, Math.min(12, Number((days / 30).toFixed(2))));
}

function getRecordItems(record) {
  if (Array.isArray(record?.items) && record.items.length) return record.items;
  return [
    {
      product_id: record?.product_id || null,
      product_name: record?.product_name || "Product / Service",
      quantity: Number(record?.quantity || 0),
      unit_price: Number(record?.unit_price || 0),
      unit_cost_of_sales: Number(record?.unit_cost_of_sales || 0),
      subtotal_amount: Number(record?.subtotal_amount || 0),
    },
  ];
}

function getLineGrandTotal(item) {
  const quantity = Number(item?.quantity || 0);
  const subtotal = item?.subtotal_amount != null
    ? Number(item.subtotal_amount || 0)
    : Number(item?.unit_price || 0) * quantity;
  return Number(subtotal.toFixed(2));
}

function biScoreColor(score) {
  if (score >= 80) return "#16a34a";
  if (score >= 65) return "#2563eb";
  if (score >= 50) return "#d97706";
  if (score >= 30) return "#ea580c";
  return "#dc2626";
}

function fragilityIndexColor(index) {
  if (index <= 20) return "#16a34a";
  if (index <= 40) return "#2563eb";
  if (index <= 60) return "#d97706";
  if (index <= 80) return "#ea580c";
  return "#dc2626";
}

function biBandLabel(band) {
  if (!band) return "";
  return band.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/** High impact: half the monthly revenue or more gone, or the change takes cash below zero where doing nothing would not
 * (simulation audit F7, 16 Nov 2026: judged on the projection, no longer on a 15-point fall in the stability score). */
export function highImpact(run) {
  const before = Number(run?.baseline_metrics?.monthly_revenue) || 0;
  const after = Number(run?.scenario_metrics?.monthly_revenue) || 0;
  return (before > 0 && after <= before * 0.5) || Boolean(run?.scenario_metrics?.verdict?.cash_shortfall_introduced);
}

// ── Simulation audit, Phase 1 (17 Nov 2026): business settings for projections ─────────────────────────────────────
// Tax, VAT, loans and inflation are facts about the business, applied to both sides of every comparison. They are kept
// on this device per business (a convenience) and sent with each run, where they are stored with the run's snapshot.
export const PROJECTION_SETTINGS = [
  ["profit_tax_rate_pct", "Tax on profit (%)", "Your tax rate on profit. Left blank, tax is not included."],
  ["tax_payment_month", "Tax paid in month", "The projection month the tax set aside is paid. Blank: still owed at the end."],
  ["sales_tax_rate_pct", "VAT / sales tax (%)", "Only if you are registered. Your figures are taken as excluding VAT."],
  ["sales_tax_period_months", "VAT period (months)", "How often you pay VAT over. Usually 3."],
  ["sales_tax_on_costs_pct", "Costs with reclaimable VAT (%)", "The share of your costs that carry VAT you can reclaim."],
  ["existing_loan_balance", "Loan balance", "What you still owe on existing loans."],
  ["existing_loan_annual_rate_pct", "Loan interest (% a year)", "The interest rate on that loan."],
  ["existing_loan_monthly_repayment", "Loan repayment a month", "What you repay each month, interest included."],
  ["cost_inflation_pct", "Cost inflation (% a year)", "How fast your costs rise each year. Blank: none applied."],
  // Simulation audit, Phase 5 (model 1.4): the further factors of a standard forecast
  ["tax_country", "Country (payroll and tax rules)", "Used for employer National Insurance, pension and payroll costs. Blank: your business profile's country."],
  ["profit_tax_regime", "Corporation tax rules", "UK bands: 19% up to £50,000, 25% above £250,000, with marginal relief between. Otherwise the flat rate above."],
  ["tax_losses_brought_forward", "Tax losses brought forward", "Earlier losses that reduce the profit taxed."],
  ["payroll_staff_count", "Staff on payroll", "People you pay through payroll now."],
  ["payroll_gross_monthly_per_person", "Gross pay per person a month", "Average monthly gross pay. Employer NI and pension are added by your country's rules."],
  ["payroll_in_recorded_expenses", "Salaries already in my expenses?", "If you record salaries as expenses, they are not added again."],
  ["employer_pension_pct", "Employer pension (%)", "Blank: your country's minimum (UK 3% of qualifying earnings, Nigeria 10%)."],
  ["owner_drawings_monthly", "Owner drawings a month", "Money the owners take out each month. Cash out, not a cost."],
  ["bad_debt_pct", "Sales never collected (%)", "The share of sales customers never pay. Counted as a cost."],
  ["funding_amount", "Funding expected: amount", "Investment, owner capital or a grant you expect to receive."],
  ["funding_type", "Funding expected: type", "Equity and owner capital are cash in; a grant is also income."],
  ["funding_month", "Funding expected: month", "The projection month it arrives."],
  ["equipment_amount", "Equipment planned: cost", "Equipment or other assets you plan to buy."],
  ["equipment_month", "Equipment planned: month", "The projection month you pay for it."],
  ["equipment_life_months", "Equipment planned: life (months)", "Its cost is spread over this many months as depreciation. Blank: 36."],
  ["dividend_amount", "Dividend planned: amount", "Cash paid to shareholders. Not a cost."],
  ["dividend_month", "Dividend planned: month", "The projection month it is paid."],
];

/** Phase 6: the business settings in groups, for their own card on the Simulation dashboard. */
export const SETTING_GROUPS = [
  ["Tax and VAT", ["profit_tax_rate_pct", "tax_payment_month", "profit_tax_regime", "tax_losses_brought_forward", "sales_tax_rate_pct", "sales_tax_period_months", "sales_tax_on_costs_pct"]],
  ["Loans", ["existing_loan_balance", "existing_loan_annual_rate_pct", "existing_loan_monthly_repayment"]],
  ["Payroll", ["tax_country", "payroll_staff_count", "payroll_gross_monthly_per_person", "payroll_in_recorded_expenses", "employer_pension_pct"]],
  ["Owners and funding", ["owner_drawings_monthly", "funding_amount", "funding_type", "funding_month", "dividend_amount", "dividend_month"]],
  ["Equipment and other", ["equipment_amount", "equipment_month", "equipment_life_months", "bad_debt_pct", "cost_inflation_pct"]],
];

/** A short signature of the figures a projection used, so a confirmation can tell when they have changed since. */
export function figuresSignature(inputs) {
  return JSON.stringify((inputs || []).filter((i) => i.label !== "not set" && i.label !== "none recorded").map((i) => [i.input, i.value]));
}

/** Settings chosen from a list rather than typed. */
export const SETTING_CHOICES = {
  tax_country: [["", "From my business profile"], ["GB", "United Kingdom"], ["NG", "Nigeria"], ["US", "United States"]],
  profit_tax_regime: [["", "Flat rate (above)"], ["uk_corporation_tax", "UK corporation tax bands"]],
  payroll_in_recorded_expenses: [["", "Work it out from my expenses"], ["true", "Yes, they are in my expenses"], ["false", "No, add them"]],
  funding_type: [["equity", "Equity investment"], ["owner_capital", "Owner capital"], ["grant", "Grant"]],
};

// One planned item each, sent to the server as lists (the server takes several)
const SETTING_ROWS = new Set(["funding_amount", "funding_type", "funding_month", "equipment_amount", "equipment_month",
  "equipment_life_months", "dividend_amount", "dividend_month"]);

/** The settings that have a value, ready to merge into the state sent to the server. */
export function projectionSettingsForState(settings) {
  const out = {};
  const num = (key) => {
    const raw = settings?.[key];
    if (raw === "" || raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  for (const [key] of PROJECTION_SETTINGS) {
    if (SETTING_ROWS.has(key)) continue;
    const raw = settings?.[key];
    if (raw === "" || raw == null) continue;
    if (key === "tax_country" || key === "profit_tax_regime") { out[key] = String(raw); continue; }
    if (key === "payroll_in_recorded_expenses") { out[key] = raw === true || raw === "true"; continue; }
    const n = Number(raw);
    if (Number.isFinite(n)) out[key] = n;
  }
  if (num("funding_amount") > 0) {
    out.funding_events = [{ type: settings?.funding_type || "equity", amount: num("funding_amount"), month: num("funding_month") || 1 }];
  }
  if (num("equipment_amount") > 0) {
    out.capital_purchases = [{ amount: num("equipment_amount"), month: num("equipment_month") || 1, life_months: num("equipment_life_months") || 36 }];
  }
  if (num("dividend_amount") > 0) {
    out.dividends = [{ amount: num("dividend_amount"), month: num("dividend_month") || 1 }];
  }
  return out;
}

// ── Simulation audit, Phase 2 (17 Nov 2026): how sure the result is ─────────────────────────────────────────────────
/** "Confidence: medium" with the first reason, from a run's uncertainty block. */
export function confidenceText(uncertainty) {
  const c = uncertainty?.confidence;
  if (!c?.level) return "";
  const level = c.level.charAt(0).toUpperCase() + c.level.slice(1);
  return `${level} confidence${c.reasons?.length ? `: ${c.reasons.join("; ")}` : ""}.`;
}

/** The low / base / high closing cash for one side ("scenario" or "baseline"), or null. */
export function rangeOf(uncertainty, side = "scenario") {
  const cases = uncertainty?.ranges?.cases;
  if (!cases?.base?.[side]) return null;
  return { low: cases.low?.[side]?.net_cash, base: cases.base[side].net_cash, high: cases.high?.[side]?.net_cash };
}

const KPI_LABELS = [
  ["gross_margin_pct", "Gross margin", "pct"],
  ["operating_margin_pct", "Operating margin", "pct"],
  ["net_margin_pct_over_period", "Net margin (period)", "pct"],
  ["average_monthly_cash_flow", "Cash flow a month", "money"],
  ["runway_months", "Runway", "months"],
  ["days_sales_outstanding", "Days to get paid", "days"],
  ["break_even_revenue_monthly", "Break-even revenue a month", "money"],
  ["margin_of_safety_pct", "Margin of safety", "pct"],
  ["interest_cover", "Interest cover", "times"],
  ["net_cash", "Net cash at the end", "money"],
];

// ── Simulation audit, Phase 3 (17 Nov 2026): accuracy against what actually happened ─────────────────────────────
/** One or two sentences on forecast accuracy, from POST /v1/scenario-intelligence/accuracy. */
export function accuracyText(report) {
  if (!report) return [];
  const out = [];
  const t = report.tracked?.overall;
  if (t?.wape_pct != null) {
    out.push(`Earlier forecasts were off by ${t.wape_pct}% on average over ${t.months} completed month${t.months === 1 ? "" : "s"} (${t.bias_pct > 0 ? "too high" : t.bias_pct < 0 ? "too low" : "no lean"}: ${t.bias_pct > 0 ? "+" : ""}${t.bias_pct}%).`);
  } else if (report.tracked?.note) {
    out.push(report.tracked.note);
  }
  const b = report.backtest;
  if (b?.wape_pct != null) {
    out.push(`Tested on your own history, the method is off by ${b.wape_pct}% against ${b.naive_wape_pct}% for "next month = last month": ${b.skill}.`);
  } else if (b?.note) {
    out.push(b.note);
  }
  return out;
}

/** "All checks passed" or which one did not, from a projection summary's checks. */
export function projectionChecksText(summary) {
  const checks = summary?.checks;
  if (!checks) return "";
  const names = { cash_reconciles: "cash", receivables_reconcile: "money owed to you", balance_sheet_balances: "balance sheet" };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => names[k] || k);
  return failed.length
    ? `Check failed: ${failed.join(", ")}. Please report this run.`
    : "Checks passed: cash, money owed to you and the balance sheet reconcile in every month.";
}

/** The run's verdict in words: the scenario against the same business doing nothing, over the same months. */
export function verdictLabel(run) {
  const outcome = run?.scenario_metrics?.verdict?.outcome;
  if (run?.state_result === "improved") return "Better than doing nothing";
  if (run?.state_result === "worse") return highImpact(run) ? "High impact: worse than doing nothing" : "Worse than doing nothing";
  if (outcome === "mixed") return "Mixed: a trade-off to weigh";
  return "No material change";
}

/** Projection month 1 is the first full month after the run (audit F13); the opening cash is the cash on the day. */
export function projectionMonthLabel(baseDate, monthIndex) {
  if (!monthIndex) return "—";
  const d = baseDate ? new Date(baseDate) : new Date();
  if (Number.isNaN(d.getTime())) return "—";
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() + Number(monthIndex));
  return d.toLocaleString(undefined, { month: "short", year: "numeric" });
}

/** A projection row as the table shows it: the server's figures, unchanged (audit F13). */
export function timelineRowForDisplay(row) {
  return { ...row, receivables: row.accruals, _cumGross: row.cumulative_profit, _cash: row.cash_balance };
}

export default function SimulationPage() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const ideaValidation = useWorkspaceStore((s) => s.ideaValidation);
  const decisionStatus = useWorkspaceStore((s) => s.decisionStatus);
  const serviceDecisionStatus = useWorkspaceStore((s) => s.serviceDecisionStatus);
  const validation = useWorkspaceStore((s) => s.validation);
  const inputs = useWorkspaceStore((s) => s.inputs);
  const storeCurrency = useWorkspaceStore((s) => s.currency);
  // The workspace's own currency once read, as the dashboard and Business Operations show it (the owner, 30 Oct: a Naira
  // business's simulation shown in £, its first month the £ invoice alone)
  const [ownCurrency, setOwnCurrency] = useState(null);
  const currency = ownCurrency || storeCurrency;
  const workspaceDataRefreshTrigger = useWorkspaceStore((s) => s.workspaceDataRefreshTrigger);
  const email = useAuthStore((s) => s.email);
  const isMemberMode = useWorkspaceStore((s) => s.isMemberMode);
  const memberPermissionType = useWorkspaceStore((s) => s.memberPermissionType);
  const memberPermissions = useWorkspaceStore((s) => s.memberPermissions);
  const platformRestrictions = useAuthStore((s) => s.platformRestrictions);
  const platformGrants = useAuthStore((s) => s.platformGrants);
  const subscription = useAuthStore((s) => s.subscription);
  const planKey = subscription?.plan_key ?? "free_trial";
  const planStatus = subscription?.status ?? "trial";

  // Admin-granted simulation access bypasses the subscription gate entirely.
  const hasSimulationGrant = isPlatformModuleGranted("simulation", platformGrants);
  const explorerPlan = normalisePlanKey(planKey) === "explorer";
  const simulationEnabled = explorerPlan || planStatus === "grandfathered" || planStatus === "active" || hasSimulationGrant;

  function canSimFeature(featureKey) {
    if (isPlatformFeatureRestricted("simulation", featureKey, platformRestrictions)) return false;
    return !isMemberMode || hasFeatureAccess("simulation", featureKey, memberPermissionType, memberPermissions);
  }

  const tenantId = asNonEmptyString(email, "ten_default");
  const businessId = asNonEmptyString(workspaceId, "biz_unknown");
  const [registrationStatus, setRegistrationStatus] = useState({ status: "not_started" });
  const isRegistered = registrationStatus?.status === "registered";
  const stateVersion = isRegistered ? asNonEmptyString(validation?.rubric_version, "state_v1.0") : "state_v1.0";

  const [catalogueData, setCatalogueData] = useState({ products: [], customers: [], vendors: [] });
  const [financialsData, setFinancialsData] = useState({ invoices: [], expenses: [], contracts: [] });
  // Simulation audit, Phase 4: the first projection waits for the business's records, so it is never made from an empty
  // history (it used to show "Low confidence" and a wrong range for a moment, then correct itself).
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [fxRates, setFxRates] = useState({});
  const [acceptedValidation, setAcceptedValidation] = useState(null);

  const acceptedIdeaValidation = decisionStatus === "accepted" ? ideaValidation : null;
  const acceptedModuleValidation = {
    businessValidation: acceptedValidation?.businessValidation || acceptedIdeaValidation || null,
    serviceValidation: acceptedValidation?.serviceValidation || (serviceDecisionStatus === "accepted" ? validation : null),
  };

  function handleUpgradeClick() {
    window.location.href = "/pricing";
  }

  const financialInsights = useMemo(
    () =>
      buildFinancialIntelligence({
        catalogue: catalogueData,
        financials: financialsData,
        validation: acceptedModuleValidation,
        inputs,
        fxRates,
        displayCurrencyIso: (currency?.match(/\(([A-Z]{3})\)\s*$/) || currency?.match(/^([A-Z]{3})$/i) || [])[1]?.toUpperCase() || (currency || "GBP").toUpperCase(),
      }),
    [acceptedModuleValidation, catalogueData, financialsData, inputs, fxRates, currency]
  );

  // The same figures as the risk check and the dashboard (R-4); the customer a "lose them" what-if was opened for
  const [shared, setShared] = useState(null);
  useEffect(() => {
    if (!workspaceId) return undefined;
    let live = true;
    apiRequest(`/businesses/${workspaceId}/figures`, "GET").then((f) => { if (live) setShared(f || null); }).catch(() => { /* Simulation's own figures */ });
    return () => { live = false; };
  }, [workspaceId]);
  const wantedCustomer = useMemo(() => { try { return new URLSearchParams(window.location.search || "").get("customer") || ""; } catch { return ""; } }, []);
  const { stateSnapshot, largestClient } = useMemo(() => withSharedFigures(financialInsights, shared, wantedCustomer), [financialInsights, shared, wantedCustomer]);
  // QA PF4: "Loss of Largest Client" is offered only when there is a client on record to lose.
  const offeredScenario = (id) => Boolean(largestClient) || !CLIENT_SCENARIOS.includes(id);
  const activeProducts = useMemo(
    () => (Array.isArray(catalogueData?.products) ? catalogueData.products.filter((item) => !item?.archived) : []),
    [catalogueData]
  );
  const activeContracts = useMemo(
    () => (Array.isArray(financialsData?.contracts) ? financialsData.contracts.filter((item) => !item?.archived) : []),
    [financialsData]
  );
  const activeInvoices = useMemo(
    () => (Array.isArray(financialsData?.invoices) ? financialsData.invoices.filter((item) => !item?.archived) : []),
    [financialsData]
  );

  const [tab, setTab] = useState(() => {
    // Default to manual if user only has run_simulation but not adaptive features
    if (isMemberMode && !hasFeatureAccess("simulation", "scenario_intelligence", memberPermissionType, memberPermissions)
      && !hasFeatureAccess("simulation", "risk_detection", memberPermissionType, memberPermissions)
      && !hasFeatureAccess("simulation", "recommendations", memberPermissionType, memberPermissions)) {
      return "manual";
    }
    return "adaptive";
  }); // adaptive | manual
  const [templates, setTemplates] = useState([]);
  const [pendingPrefill, setPendingPrefill] = useState(null);
  const [riskSignals, setRiskSignals] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [recsLocked, setRecsLocked] = useState(false);      // AI recommendations are on Starter and above: said in the panel, never as an error
  const [history, setHistory] = useState([]);
  // Phase 6: model-update notices, side-by-side comparison, reproducing a run, combined changes, confirmed figures
  const [modelInfo, setModelInfo] = useState(null);
  const [compareIds, setCompareIds] = useState([]);
  const [compareResult, setCompareResult] = useState(null);
  const [reproduced, setReproduced] = useState({});
  const [combo, setCombo] = useState([]);
  const [confirmed, setConfirmed] = useState(null);
  const [accuracy, setAccuracy] = useState(null);

  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [creditModal, setCreditModal] = useState(null);
  const [autoProjectionLoading, setAutoProjectionLoading] = useState(false);
  const [scenarioRunningId, setScenarioRunningId] = useState(null);
  const [error, setError] = useState(null);
  // QA PF4: nothing on record to project: what is missing, and the owner's own figures offered as an estimate.
  const [insufficient, setInsufficient] = useState(null);      // { message, missing, estimate, retry }
  const [prefillDone, setPrefillDone] = useState(false);

  const [manualTemplateId, setManualTemplateId] = useState(() => {
    const p = new URLSearchParams(window.location.search || "");
    return p.get("template") || "";
  });
  const [manualName, setManualName] = useState("");
  const [manualParams, setManualParams] = useState({});
  const [manualTimelineMonths, setManualTimelineMonths] = useState("6");
  const settingsKey = `ea:simulation:settings:${businessId || "none"}`;
  const [projectionSettings, setProjectionSettings] = useState({});
  useEffect(() => {
    try { setProjectionSettings(JSON.parse(window.localStorage.getItem(settingsKey) || "{}") || {}); } catch { setProjectionSettings({}); }
  }, [settingsKey]);
  useEffect(() => {
    apiRequest("/v1/scenario-intelligence/model", "GET").then(setModelInfo).catch(() => setModelInfo(null));
  }, []);
  const confirmKey = `ea:simulation:confirmed:${workspaceId || "none"}`;
  useEffect(() => {
    try { setConfirmed(JSON.parse(window.localStorage.getItem(confirmKey) || "null")); } catch { setConfirmed(null); }
  }, [confirmKey]);
  function confirmFigures(inputs) {
    const value = { at: new Date().toISOString(), sig: figuresSignature(inputs) };
    try { window.localStorage.setItem(confirmKey, JSON.stringify(value)); } catch { /* kept for this visit only */ }
    setConfirmed(value);
  }
  async function compareRuns() {
    try { setCompareResult(await apiRequest("/v1/scenario-intelligence/compare", "POST", { run_ids: compareIds })); }
    catch (e) { setCompareResult({ error: refusalMessage(e, "Those runs could not be compared.") }); }
  }
  async function reproduceRun(id) {
    try { const r = await apiRequest(`/v1/scenario-intelligence/scenario-runs/${id}/reproduce`, "POST", {}); setReproduced((p) => ({ ...p, [id]: r })); }
    catch (e) { setReproduced((p) => ({ ...p, [id]: { explanation: refusalMessage(e, "It could not be checked just now.") } })); }
  }

  function updateProjectionSetting(key, value) {
    setProjectionSettings((prev) => {
      const next = { ...prev, [key]: value };
      try { window.localStorage.setItem(settingsKey, JSON.stringify(next)); } catch { /* kept for this visit only */ }
      return next;
    });
  }
  // How accurate the projections have been (Phase 3). Free; refreshed when the run history changes.
  useEffect(() => {
    if (!workspaceId || !stateSnapshot) return undefined;
    let live = true;
    apiRequest("/v1/scenario-intelligence/accuracy", "POST", {
      tenant_id: tenantId, business_id: businessId, state_version: stateVersion, state: stateSnapshot,
    }).then((res) => { if (live) setAccuracy(res || null); }).catch(() => { if (live) setAccuracy(null); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, businessId, history.length, JSON.stringify(stateSnapshot?.revenue_by_month || {})]);

  // What every run and projection is sent: the page's figures plus the business settings above
  const runState = useMemo(() => (stateSnapshot ? { ...stateSnapshot, ...projectionSettingsForState(projectionSettings) } : stateSnapshot),
    [stateSnapshot, projectionSettings]);

  const [activeRun, setActiveRun] = useState(null);
  const [activeRunKind, setActiveRunKind] = useState(null); // "scenario" | "projection"
  const [timeline, setTimeline] = useState([]);
  const [projectionRun, setProjectionRun] = useState(null);
  const [projectionTimeline, setProjectionTimeline] = useState([]);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState(null);
  const [showHowRun, setShowHowRun] = useState(false);
  const [autoProjectionDone, setAutoProjectionDone] = useState(false);
  const [autoSignalsDone, setAutoSignalsDone] = useState(false);
  const [biIntelligence, setBiIntelligence] = useState(null);
  const [biLoading, setBiLoading] = useState(false);
  const lastSnapshotHashRef = useRef("");
  const lastSignalsSnapshotHashRef = useRef("");
  const lastBiSnapshotHashRef = useRef("");

  const canRun = Boolean(workspaceId);
  const productScenarioOptions = useMemo(() => {
    const paidInvoices = activeInvoices.filter((item) => String(item?.status || "").toLowerCase() === "paid");
    const months = observedMonths(paidInvoices);
    return activeProducts.map((product) => {
      const invoiceRevenue = paidInvoices.reduce((sum, item) => {
        const lineRevenue = getRecordItems(item)
          .filter((lineItem) => {
            const lineProductId = lineItem?.product_id || null;
            const lineProductName = String(lineItem?.product_name || "").trim().toLowerCase();
            return lineProductId === product.id || lineProductName === String(product.name || "").trim().toLowerCase();
          })
          .reduce((lineSum, lineItem) => lineSum + getLineGrandTotal(lineItem), 0);
        return sum + lineRevenue;
      }, 0);
      return {
        id: product.id,
        label: product.name || "Product / Service",
        revenueMonthly: invoiceRevenue > 0 ? Number((invoiceRevenue / months).toFixed(2)) : 0,
      };
    });
  }, [activeInvoices, activeProducts]);

  const pendingScenarioOptions = useMemo(() => {
    const pendingInvoices = activeInvoices.filter(isCollectable);
    // Named by invoice number, as on the dashboard and in Business Operations.
    const numbers = invoiceNumbers(Array.isArray(financialsData?.invoices) ? financialsData.invoices : []);
    return pendingInvoices.map((item) => ({
      id: String(item.id),
      label: `${item.customer_name || "Customer"} • ${numbers.get(item.id) || "Invoice (no number)"} • ${formatCurrency(Number(item?.total_amount || 0), currency || "GBP")}`,
      detail: item?.due_date ? `Due ${shortDate(item.due_date)}` : "Awaiting due date",
      amount: Number(item?.total_amount || 0),
    }));
  }, [activeInvoices, financialsData, currency]);

  const pendingScenarioLineOptions = useMemo(() => {
    const pendingInvoices = activeInvoices.filter(isCollectable);
    return pendingInvoices.flatMap((item) => {
      const dueDetail = item?.due_date ? `Due ${shortDate(item.due_date)}` : "Awaiting due date";
      return getRecordItems(item).map((lineItem, index) => {
        const amount = getLineGrandTotal(lineItem);
        return {
          id: `${item.id}:${lineItem?.product_id || lineItem?.product_name || index}:${index}`,
          label: `${item.customer_name || "Customer"} - ${lineItem?.product_name || "Product / Service"} - ${formatCurrency(amount, currency || "GBP")}`,
          detail: dueDetail,
          amount,
        };
      });
    });
  }, [activeInvoices, currency]);

  useEffect(() => {
    async function bootstrap() {
      if (!workspaceId) return;
      setLoading(true);
      setError(null);
      try {
        const [tmplRes, historyRes] = await Promise.all([
          apiRequest("/v1/scenario-intelligence/scenario-templates", "GET"),
          apiRequest(`/v1/scenario-intelligence/history?business_id=${businessId}&tenant_id=${tenantId}`, "GET")
        ]);
        setTemplates(tmplRes?.templates || []);
        setHistory(historyRes?.history || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load scenario templates.");
      } finally {
        setLoading(false);
      }
    }
    bootstrap();
  }, [workspaceId, businessId, tenantId]);

  useEffect(() => {
    let alive = true;
    async function loadWorkspaceData() {
      if (!workspaceId) return;
      try {
        const ws = await apiRequest("/validation/me", "GET");
        if (!alive || !ws) return;
        setCatalogueData(ws?.data?.catalogue || { products: [], customers: [], vendors: [] });
        const fin = ws?.data?.financials || { invoices: [], expenses: [], contracts: [] };
        setFinancialsData(fin);
        setRegistrationStatus(ws?.data?.registration_status || { status: "not_started" });
        setAcceptedValidation(getAcceptedWorkspaceValidation(ws?.data));
        const own = workspaceCurrencyOf(ws?.data) || currency;
        setOwnCurrency(workspaceCurrencyOf(ws?.data) || null);
        // Fetch FX rates for any foreign-currency records, into the workspace's own currency
        if (own) {
          const wsIso = (own.match(/\(([A-Z]{3})\)\s*$/) || own.match(/^([A-Z]{3})$/i) || [])[1]?.toUpperCase() || own.toUpperCase();
          const allRecs = [...(fin.invoices || []), ...(fin.expenses || [])];
          const foreign = [...new Set(allRecs.map(r => { const c = String(r.currency || r.source_currency || "").trim(); const iso = (c.match(/\(([A-Z]{3})\)\s*$/) || c.match(/^([A-Z]{3})$/i) || [])[1]?.toUpperCase() || c.toUpperCase(); return iso; }).filter(iso => iso && iso !== wsIso && iso.length === 3))];
          if (foreign.length) {
            Promise.all(foreign.map(async from => { try { const d = await apiRequest(`/integrations/currency-rate?from_currency=${from}&to_currency=${wsIso}`, "GET"); return { from, rate: d?.rate ?? null }; } catch { return { from, rate: null }; } }))
              .then(results => { if (!alive) return; const next = {}; results.forEach(({ from, rate }) => { if (rate != null) next[from] = rate; }); setFxRates(next); });
          }
        }
      } catch {
        // ignore
      } finally {
        if (alive) setWorkspaceLoaded(true);      // loaded or failed: the projection can go ahead either way
      }
    }
    loadWorkspaceData();

    // Refetch when user returns to this tab (e.g. after paying an invoice on Financials)
    function onVisible() {
      if (document.visibilityState === "visible") loadWorkspaceData();
    }
    function onFocus() {
      loadWorkspaceData();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [workspaceId, workspaceDataRefreshTrigger]);

  useEffect(() => {
    lastSnapshotHashRef.current = "";
    lastSignalsSnapshotHashRef.current = "";
    lastBiSnapshotHashRef.current = "";
  }, [workspaceId]);

  useEffect(() => {
    if (!templates.length) return;
    const manual = templates.find((t) => t.mode !== "adaptive");
    if (manual && !manualTemplateId) {
      setManualTemplateId(manual.scenario_template_id);
      setManualName(manual.title);
      setManualParams(buildDefaultParams(manual, stateSnapshot, largestClient));
    }
  }, [templates, manualTemplateId, stateSnapshot]);

  async function loadSignals() {
    if (!canRun) return;
    setLoading(true);
    setError(null);
    try {
      // Explorer keeps its free baseline without requesting paid recommendations.
      if (planRank(normalisePlanKey(planKey)) < planRank("starter_insight") && !hasSimulationGrant) {
        setRiskSignals(financialInsights.riskItems);
        setRecommendations([]);
        setRecsLocked(true);
        return;
      }
      const riskRes = await apiRequest("/v1/scenario-intelligence/risk-detection/run", "POST", {
        tenant_id: tenantId,
        business_id: businessId,
        state_version: stateVersion,
        state: stateSnapshot
      });
      const risks = riskRes?.risk_signals?.length ? riskRes.risk_signals : financialInsights.riskItems;
      setRiskSignals(risks);
      let recRes;
      try {
        recRes = await apiRequest("/v1/scenario-intelligence/recommendations/generate", "POST", {
          tenant_id: tenantId,
          business_id: businessId,
          state_version: stateVersion,
          risk_signal_ids: risks
            .map((r) => (typeof r?.risk_signal_id === "string" ? r.risk_signal_id.trim() : ""))
            .filter(Boolean),
          state: stateSnapshot
        });
      } catch (e) {
        if (e?.status !== 403) throw e;
        setRecsLocked(true);      // not on this plan: the panel says so; nothing went wrong
        setRecommendations([]);
        return;
      }
      setRecsLocked(false);
      setRecommendations(recRes?.recommended_scenarios?.length ? recRes.recommended_scenarios : financialInsights.recommendations);
    } catch (e) {
      if (e?.status === 403) {
        setRiskSignals(financialInsights.riskItems);
        setRecommendations([]);
        setRecsLocked(true);
        return;
      }
      setRiskSignals(financialInsights.riskItems);
      setRecommendations(financialInsights.recommendations);
      const message = e instanceof Error ? e.message : "Failed to load recommendations.";
      setError(message.replace(/^HTTP \d+:\s*/, "") || "Recommendations couldn't be loaded. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function runScenario(templateId, mode, params, nameOverride) {
    if (!canRun) return;
    setActionLoading(true);
    setScenarioRunningId(templateId);
    setError(null);
    setDecisionNotice(null);
    try {
      const template = templates.find((t) => t.scenario_template_id === templateId);
      const payload = {
        tenant_id: tenantId,
        business_id: businessId,
        state_version: stateVersion,
        scenario_template_id: asNonEmptyString(templateId, "tmpl_revenue_drop"),
        scenario_mode: mode === "adaptive" ? "adaptive" : "manual",
        scenario_name: asNonEmptyString(nameOverride || template?.title, "Scenario run"),
        parameters: {
          timeline_months: 6,
          ...(confirmed?.at ? { figures_confirmed_at: confirmed.at } : {}),
          // blank inputs are left out, so the server's documented rule applies (e.g. on-costs from the country's rules)
          ...Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== null && v !== ""))
        },
        state: runState
      };
      const runRes = await apiRequest("/v1/scenario-intelligence/scenario-runs", "POST", payload);
      setInsufficient(null);
      const runId = runRes?.scenario_run_id;
      if (runId) {
        const [resultRes, timelineRes] = await Promise.all([
          apiRequest(`/v1/scenario-intelligence/scenario-runs/${runId}`, "GET"),
          apiRequest(`/v1/scenario-intelligence/scenario-runs/${runId}/timeline`, "GET")
        ]);
        setActiveRun(resultRes);
        setActiveRunKind("scenario");
        setTimeline(timelineRes?.timeline || []);
      }
    } catch (e) {
      const why = refusalOf(e);
      if (why?.error === "INSUFFICIENT_DATA") {
        setInsufficient({ ...why, retry: () => runScenario(templateId, mode, { ...(params || {}), use_estimate: true }, nameOverride) });
      } else {
        setError(refusalMessage(e, "Scenario run failed. Nothing was charged."));
      }
    } finally {
      setActionLoading(false);
      setScenarioRunningId(null);
      window.dispatchEvent(new CustomEvent("ea:credits:refresh"));
    }
  }

  async function runDoNothing(monthsOverride, setAsActive = false, silent = false, useEstimate = false) {
    if (!canRun) return;
    if (silent) {
      setAutoProjectionLoading(true);
    } else {
      setActionLoading(true);
    }
    setError(null);
    try {
      const res = await apiRequest("/v1/scenario-intelligence/do-nothing/run", "POST", {
        tenant_id: tenantId,
        business_id: businessId,
        state_version: stateVersion,
        timeline_months: Math.min(24, parseNumber(monthsOverride ?? manualTimelineMonths, 6)),
        state: runState,
        parameters: useEstimate ? { use_estimate: true } : {}
      });
      setInsufficient(null);
      const projectionPayload = {
        scenario_run_id: res?.projection_id,
        scenario_name: "Baseline Continuity Projection",
        scenario_type: "do_nothing_projection",
        baseline_metrics: {},
        scenario_metrics: {},
        deltas: {},
        state_result: "neutral",
        timeline_summary: {},
        // The cash the projection starts from (your recorded payments in and out, or what you told the Agent)
        baseline_snapshot: { starting_cash: Number(res?.starting_cash ?? stateSnapshot?.starting_cash ?? 0) },
        // Closing cash, checks and the assumptions behind the projection (simulation audit, Phase 0)
        projection_summary: res?.summary || null,
      };
      setProjectionRun(projectionPayload);
      setProjectionTimeline(res?.forecast || []);
      if (setAsActive) {
        setActiveRun(projectionPayload);
        setActiveRunKind("projection");
        setTimeline(res?.forecast || []);
      }
    } catch (e) {
      const why = refusalOf(e);
      if (why?.error === "INSUFFICIENT_DATA") {
        setInsufficient({ ...why, retry: () => runDoNothing(monthsOverride, setAsActive, false, true) });
      } else if (!silent) {
        setError(refusalMessage(e, "Projection failed. Nothing was charged."));
      }
    } finally {
      if (silent) {
        setAutoProjectionLoading(false);
      } else {
        setActionLoading(false);
      }
    }
  }

  async function loadIntelligence() {
    if (!canRun || !stateSnapshot) return;
    setBiLoading(true);
    try {
      const res = await apiRequest("/v1/scenario-intelligence/intelligence/run", "POST", {
        tenant_id: tenantId,
        business_id: businessId,
        state_version: stateVersion,
        state: stateSnapshot,
      });
      setBiIntelligence(res || null);
    } catch {
      // silently skip — BI panel just stays hidden
    } finally {
      setBiLoading(false);
    }
  }

  const snapshotHash = useMemo(() => JSON.stringify(stateSnapshot || {}), [stateSnapshot]);
  const lastManualTemplateIdRef = useRef(null);

  useEffect(() => {
    if (!canRun || tab !== "adaptive") return;
    if (loading || !workspaceLoaded) return;
    // Always re-run when the snapshot hash changes — data has genuinely changed
    if (snapshotHash === lastSnapshotHashRef.current) return;
    lastSnapshotHashRef.current = snapshotHash;
    runDoNothing(6, false, true);
    setAutoProjectionDone(true);
  }, [tab, canRun, loading, workspaceLoaded, snapshotHash]);

  useEffect(() => {
    if (!canRun || tab !== "adaptive") return;
    if (loading || !workspaceLoaded) return;
    if (snapshotHash === lastBiSnapshotHashRef.current) return;
    lastBiSnapshotHashRef.current = snapshotHash;
    loadIntelligence();
  }, [tab, canRun, loading, workspaceLoaded, snapshotHash]);

  useEffect(() => {
    if (!canRun || tab !== "adaptive") return;
    if (loading) return;
    if (snapshotHash === lastSignalsSnapshotHashRef.current) return;
    lastSignalsSnapshotHashRef.current = snapshotHash;
    loadSignals();
    setAutoSignalsDone(true);
  }, [tab, canRun, loading, snapshotHash]);

  async function saveDecision(status, recommendationId) {
    if (!activeRun?.scenario_run_id || !canRun) return;
    if (isProjection(activeRun)) return;
    setDecisionSaving(true);
    setDecisionNotice(null);
    try {
      await apiRequest(`/v1/scenario-intelligence/scenario-runs/${activeRun.scenario_run_id}/decision`, "POST", {
        decision_status: status,
        selected_recommendation_id: recommendationId || null
      });
      setDecisionNotice(`Decision saved: ${status}`);
      const historyRes = await apiRequest(`/v1/scenario-intelligence/history?business_id=${businessId}&tenant_id=${tenantId}`, "GET");
      setHistory(historyRes?.history || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save decision.");
    } finally {
      setDecisionSaving(false);
    }
  }

  function clearHistory() {
    if (!canRun) return;
    setConfirmDialog({
      message: "Clear all scenario history for this workspace? This cannot be undone.",
      onConfirm: async () => {
        setConfirmDialog(null);
        setActionLoading(true);
        setError(null);
        try {
          await apiRequest(`/v1/scenario-intelligence/history?business_id=${businessId}&tenant_id=${tenantId}`, "DELETE");
          setHistory([]);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to clear history.");
        } finally {
          setActionLoading(false);
        }
      },
      onCancel: () => setConfirmDialog(null),
    });
  }

  const manualTemplate = templates.find((t) => t.scenario_template_id === manualTemplateId);

  function openManualScenario(templateId, titleOverride) {
    const template = templates.find((t) => t.scenario_template_id === templateId);
    if (!template) {
      setError("Scenario templates are still loading. Try again in a moment.");
      return;
    }
    setManualTemplateId(templateId);
    if (template.scenario_type === "client_loss") {
      const clientLabel = largestClient?.name || "Largest Client";
      setManualName(`Loss of ${clientLabel}`);
    } else {
      setManualName(titleOverride || template.title);
    }
    setManualParams(buildDefaultParams(template, stateSnapshot, largestClient));
    setTab("manual");
  }

  useEffect(() => {
    if (prefillDone) return;
    if (!templates.length) return;
    const params = new URLSearchParams(window.location.search || "");
    const templateId = params.get("template");
    if (!templateId) {
      setPrefillDone(true);
      return;
    }
    const template = templates.find((t) => t.scenario_template_id === templateId);
    if (template) {
      openManualScenario(templateId, template.title);
      // ?pending=a,b: the receivables a late-payment scenario was opened for are selected once the
      // list of pending items has loaded (see the effect below).
      const pending = (params.get("pending") || "").split(",").filter(Boolean);
      if (pending.length) setPendingPrefill(pending);
      setTab("manual");
    }
    setPrefillDone(true);
  }, [prefillDone, templates]);

  // Applied after the list exists and after any default parameters are set, so nothing resets it.
  useEffect(() => {
    if (!pendingPrefill || manualTemplate?.scenario_type !== "payment_delay" || !pendingScenarioOptions.length) return;
    const known = pendingPrefill.filter((id) => pendingScenarioOptions.some((o) => o.id === id));
    setManualParams((p) => ({ ...p, selected_pending_ids: known }));
    setPendingPrefill(null);
  }, [pendingPrefill, manualTemplate, pendingScenarioOptions]);

  function describeRisk(risk) {
    const code = risk?.reason_code;
    const value = risk?.metric_value;
    if (code === "CLIENT_CONCENTRATION_HIGH") {
      return {
        title: "Client concentration risk",
        detail: `Your largest client contributes about ${value ?? stateSnapshot?.top_client_share_pct ?? "—"}% of revenue.`
      };
    }
    if (code === "CAPACITY_OVERLOAD") {
      return {
        title: "Capacity overload",
        detail: `Team utilisation is around ${value ?? stateSnapshot?.capacity_utilisation_pct ?? "—"}%.`
      };
    }
    if (code === "NEGATIVE_MARGIN") {
      return {
        title: "Negative margin",
        detail: `Your monthly net profit is currently ${formatCurrency(value ?? 0, currency)}.`
      };
    }
    if (code === "LOW_RUNWAY") {
      return {
        title: "Low cash runway",
        detail: `Cash runway is about ${value ?? "—"} months.`
      };
    }
    if (code === "OVERDUE_RECEIVABLES") {
      return {
        title: "Overdue receivables",
        detail: risk?.detail || "Some pending invoices are outside payment terms."
      };
    }
    if (code === "RECEIVABLES_APPROACHING_DUE") {
      return {
        title: "Receivables approaching due date",
        detail: risk?.detail || "Some pending invoices are close to payment-term expiry."
      };
    }
    if (code === "PAYABLE_PRESSURE") {
      return {
        title: "Payables pressure",
        detail: risk?.detail || "Some expenses are outside expected payment timing."
      };
    }
    if (code === "PAYABLES_APPROACHING_DUE") {
      return {
        title: "Payables approaching due date",
        detail: risk?.detail || "Some payables are close to term expiry."
      };
    }
    if (code === "HIGH_RECEIVABLE_EXPOSURE") {
      return {
        title: "Critical receivable exposure",
        detail: risk?.detail || "Receivables exceed current cash balance. Liquidity depends entirely on collections."
      };
    }
    if (code === "MODERATE_RECEIVABLE_EXPOSURE") {
      return {
        title: "Moderate receivable exposure",
        detail: risk?.detail || "Receivables represent over 50% of your cash balance."
      };
    }
    return {
      title: risk?.title || "Risk signal",
      detail: risk?.detail || `${risk?.risk_type || "Risk"} detected.`
    };
  }

  function scenarioCaption(rec) {
    if (rec?.scenario_template_id === "tmpl_client_loss" && largestClient?.name) {
      return `Based on ${largestClient.name} being your largest client.`;
    }
    if (rec?.scenario_template_id === "tmpl_price_increase") {
      return "Explore whether a small price increase improves stability.";
    }
    if (rec?.scenario_template_id === "tmpl_hire_staff") {
      return "Check if adding capacity is financially safe.";
    }
    if (rec?.scenario_template_id === "tmpl_revenue_drop") {
      return "Stress‑test revenue decline impact.";
    }
    if (rec?.scenario_template_id === "tmpl_payment_delay") {
      return "Measure the effect of slower collections on cash.";
    }
    return "Run this scenario to see the impact.";
  }

  useEffect(() => {
    if (manualTemplateId === "do_nothing_projection") {
      if (lastManualTemplateIdRef.current !== manualTemplateId) {
        lastManualTemplateIdRef.current = manualTemplateId;
        setManualParams({});
      }
      setManualName("Baseline Continuity Projection");
      return;
    }
    if (!manualTemplate) return;
    if (lastManualTemplateIdRef.current === manualTemplateId) return;
    lastManualTemplateIdRef.current = manualTemplateId;
    const params = buildDefaultParams(manualTemplate, stateSnapshot, largestClient);
    setManualParams(params);
    if (manualTemplate.scenario_type === "client_loss") {
      const clientLabel = largestClient?.name || "Largest Client";
      setManualName(`Loss of ${clientLabel}`);
    } else {
      setManualName(manualTemplate.title);
    }
  }, [manualTemplateId, manualTemplate, stateSnapshot, largestClient]);

  useEffect(() => {
    if (manualTemplate?.scenario_type !== "client_loss") return;
    if (largestClient?.share == null) return;
    setManualParams((prev) => {
      if (prev?.client_loss_pct === largestClient.share) {
        return prev;
      }
      return { ...prev, client_loss_pct: largestClient.share };
    });
  }, [manualTemplate, largestClient?.share]);

  // Keep name in sync when largestClient resolves after the template is already set
  useEffect(() => {
    if (manualTemplate?.scenario_type !== "client_loss") return;
    if (!largestClient?.name) return;
    setManualName(`Loss of ${largestClient.name}`);
  }, [largestClient?.name, manualTemplate?.scenario_type]);

  function toggleManualSelection(key, id) {
    setManualParams((prev) => {
      const current = Array.isArray(prev?.[key]) ? prev[key] : [];
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      return { ...prev, [key]: next };
    });
  }

  if (!simulationEnabled) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Simulation"
          subtitle="What-if scenarios"
        />
        <SectionCard title="Simulation">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-lg font-semibold text-slate-900">To use simulation, please upgrade.</div>
            <div className="mt-2 text-sm text-slate-600">
              Unlock scenario planning, forecasting, and sensitivity analysis.
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={handleUpgradeClick}>
                View pricing plans
              </Button>
            </div>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="max-w-full overflow-x-hidden pb-12">
      <PageHeader
        title="Simulation"
        description="Adaptive scenario intelligence with time-based impact modelling."
        badge={{ text: "Scenario intelligence", tone: "slate" }}
      />

      {!workspaceId ? (
        <div className="mt-4">
          <WorkspacePrompt />
        </div>
      ) : null}

      {insufficient ? (
        <div role="status" data-insufficient className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Not enough on record to simulate yet</p>
          <p className="mt-1">{insufficient.message}</p>
          {insufficient.estimate ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" data-use-estimate disabled={actionLoading} onClick={() => insufficient.retry?.()}
                className="rounded-xl bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                Use my figures as an estimate ({insufficient.estimate.basis})</button>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">Estimate</span>
            </div>
          ) : (
            <a href="/check/pricing" className="mt-2 inline-block text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline">Answer the pricing check</a>
          )}
        </div>
      ) : null}
      {activeRun?.parameters?.basis === "estimate" && (
        <p data-estimate-basis className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          <span className="mr-2 rounded bg-white px-1.5 text-[11px] font-bold uppercase text-amber-800">Estimate</span>
          This run is based on your own figures ({activeRun.parameters.estimate_basis}), not your records.
        </p>
      )}
      {error ? (
        <div className="mt-4">
          <InlineAlert kind="error" message={error} />
        </div>
      ) : null}

      {workspaceId && ((tab === "adaptive" && canSimFeature("run_simulation")) || (tab === "manual" && (canSimFeature("scenario_intelligence") || canSimFeature("risk_detection") || canSimFeature("recommendations")))) ? (
        <div className="mt-6 flex justify-end">
          <Button data-tour="simulation-run-btn" onClick={() => setTab(tab === "manual" ? "adaptive" : "manual")}>
            {tab === "manual" ? "Back to simulation dashboard" : "Run a scenario"}
          </Button>
        </div>
      ) : null}

      {workspaceId && tab === "adaptive" ? (
        <div className="mt-4 space-y-4">
          {false && canSimFeature("scenario_intelligence") && (
            <SectionCard
              title={
                <div className="flex items-center gap-2">
                  <span>Business Intelligence</span>
                  {biLoading ? <Spinner size={14} /> : null}
                  <InfoTip text="Multi-engine analysis across viability, survival, stability, growth, and fragility dimensions." />
                </div>
              }
              subtitle="Engine-level health scores and structural classification."
            >
              {biIntelligence?.master?.bi_score != null ? (() => {      /* audit Phase 0: never draw a not-assessed engine as 0 */
                const master = biIntelligence.master;
                const biScore = master.bi_score ?? 0;
                const summary = master.engine_summary ?? {};
                const structClass = master.structural_classification ?? {};
                const risks = Array.isArray(master.consolidated_risks) ? master.consolidated_risks : [];
                const recs = Array.isArray(master.priority_recommendations) ? master.priority_recommendations : [];
                const engines = [
                  { key: "viability", label: "Viability", score: summary.viability?.score ?? 0, band: summary.viability?.band },
                  { key: "survival", label: "Survival", score: summary.survival?.score ?? 0, band: summary.survival?.band },
                  { key: "stability", label: "Stability", score: summary.stability?.score ?? 0, band: summary.stability?.band },
                  { key: "growth", label: "Growth", score: summary.growth?.score ?? 0, band: summary.growth?.band },
                ];
                const fragScore = summary.fragility?.index ?? master.fragility_index ?? 0;
                const fragBand = summary.fragility?.band;
                return (
                  <div className="space-y-4">
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-700">BI Score</span>
                        <span className="text-2xl font-bold" style={{ color: biScoreColor(biScore) }}>{biScore}<span className="text-sm font-normal text-slate-400">/100</span></span>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${biScore}%`, backgroundColor: biScoreColor(biScore) }} />
                      </div>
                    </div>
                    {structClass.label && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Classification</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{biBandLabel(structClass.label)}</div>
                        {structClass.description && <div className="mt-1 text-xs text-slate-600">{structClass.description}</div>}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {engines.map(({ key, label, score, band }) => (
                        <div key={key}>
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-600">{label}</span>
                            <span className="text-xs font-bold" style={{ color: biScoreColor(score) }}>{score}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${score}%`, backgroundColor: biScoreColor(score) }} />
                          </div>
                          {band && <div className="mt-0.5 text-xs text-slate-400">{biBandLabel(band)}</div>}
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-600">Fragility Index</span>
                        <span className="text-xs font-bold" style={{ color: fragilityIndexColor(fragScore) }}>{fragScore}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${fragScore}%`, backgroundColor: fragilityIndexColor(fragScore) }} />
                      </div>
                      {fragBand && <div className="mt-0.5 text-xs text-slate-400">{biBandLabel(fragBand)}</div>}
                    </div>
                    {risks.length > 0 && (
                      <div>
                        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Key Risks</div>
                        <ul className="space-y-1">
                          {risks.slice(0, 4).map((r, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-slate-700">
                              <span className="mt-0.5 shrink-0 text-amber-500">▲</span>{r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {recs.length > 0 && (
                      <div>
                        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Priority Actions</div>
                        <ul className="space-y-1">
                          {recs.slice(0, 3).map((r, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-slate-700">
                              <span className="mt-0.5 shrink-0 text-emerald-500">&#8594;</span>{r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })() : (
                <div className="text-sm text-slate-500">{biLoading ? "Analysing your business data..." : "No intelligence data available yet."}</div>
              )}
            </SectionCard>
          )}

          {workspaceId && (canSimFeature("scenario_intelligence") || canSimFeature("run_simulation")) && (
            <div data-tour="simulation-baseline">
            <SectionCard
              title={
                <div className="flex items-center gap-2">
                  <span>Baseline Continuity (6 months)</span>
                  {autoProjectionLoading ? <Spinner size={14} /> : null}
                  <InfoTip text="Current baseline projection if no action is taken." />
                </div>
              }
              subtitle={autoProjectionLoading ? "Updating baseline projection." : undefined}
            >
              <ScenarioOutput
                activeRun={projectionRun}
                timeline={projectionTimeline}
                currency={currency}
                decisionSaving={decisionSaving}
                decisionNotice={decisionNotice}
                onDecision={saveDecision}
                hideDecision
                maxTimelineRows={6}
                stateSnapshot={stateSnapshot}
              />
            </SectionCard>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {canSimFeature("risk_detection") && (
              <SectionCard
                title={
                  <div className="flex items-center gap-2">
                    <span>Risk alerts</span>
                    <InfoTip text="Auto-detected risks based on your current business data." />
                  </div>
                }
                subtitle="What looks risky right now."
              >
                <div className="space-y-2">
                  {riskSignals.length ? (
                    riskSignals.map((r, i) => (
                      <div key={r.risk_signal_id || i} className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {describeRisk(r).title}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">{describeRisk(r).detail}</div>
                        <div className="mt-1 text-xs text-slate-500">Severity: {r.severity}</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-slate-600">No risks detected yet.</div>
                  )}
                </div>
              </SectionCard>
            )}

            {canSimFeature("recommendations") && (
              <SectionCard
                title={
                  <div className="flex items-center gap-2">
                    <span>Recommended scenarios</span>
                    <InfoTip text="Scenarios suggested based on your current business data." />
                  </div>
                }
                subtitle="Quick simulations to explore next steps."
              >
                <div className="space-y-3">
                  {recommendations.length ? (
                    recommendations.filter((rec) => offeredScenario(rec.scenario_template_id)).map((rec, i) => {
                      const recAllowed = planAllowsScenario(planKey, rec.scenario_template_id, planStatus) || hasSimulationGrant;
                      return (
                        <div key={rec.scenario_template_id || i} className="rounded-xl border border-slate-200 bg-white p-3">
                          <div className="text-sm font-semibold text-slate-900">{rec.title}</div>
                          <div className="mt-2">
                            {recAllowed ? (
                              <Button
                                size="sm"
                                onClick={() => openManualScenario(rec.scenario_template_id, rec.title)}
                                disabled={actionLoading || !canRun}
                              >
                                {actionLoading && scenarioRunningId === rec.scenario_template_id ? <Spinner size={14} /> : null}
                                Run scenario
                              </Button>
                            ) : (
                              <button
                                type="button"
                                className="text-xs font-semibold text-amber-700 underline"
                                onClick={handleUpgradeClick}
                              >
                                Upgrade to run
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : recsLocked ? (
                    <div className="text-sm text-slate-600">
                      Recommended scenarios come with the Starter plan. Your Baseline Continuity projection stays free.
                      <button type="button" className="mt-2 block text-xs font-semibold text-brand-700 underline" onClick={handleUpgradeClick}>See plans</button>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-600">No recommendations yet.</div>
                  )}
                </div>
              </SectionCard>
            )}

            <SectionCard
              title={
                <div className="flex items-center gap-2">
                  <span>Recent history</span>
                  <InfoTip text="Latest scenario runs and decision outcomes." />
                </div>
              }
              subtitle="Last scenario runs and decisions."
            >
              <div className="space-y-2">
                {history.length ? (
                  history.slice(0, 6).map((h, i) => (
                    <div
                      key={h.scenario_run_id || i}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3"
                      data-history-run={h.scenario_run_id}
                    >
                      <div>
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          {h.scenario_type !== "do_nothing_projection" ? (
                            <input type="checkbox" aria-label={`Compare ${h.scenario_name}`} checked={compareIds.includes(h.scenario_run_id)}
                              onChange={(e) => setCompareIds((ids) => e.target.checked ? [...ids, h.scenario_run_id].slice(-6) : ids.filter((x) => x !== h.scenario_run_id))} />
                          ) : null}
                          {h.scenario_name}
                        </label>
                        {h.model_version && modelInfo?.version && h.model_version !== modelInfo.version ? (
                          <div className="mt-1 text-xs text-amber-700" data-model-notice>
                            Made with an earlier model ({h.model_version}).{" "}
                            <button type="button" className="underline" onClick={() => reproduceRun(h.scenario_run_id)}>See what has changed</button>
                          </div>
                        ) : h.scenario_run_id ? (
                          <button type="button" className="mt-1 text-xs text-slate-500 underline" onClick={() => reproduceRun(h.scenario_run_id)}>Check it reproduces</button>
                        ) : null}
                        {reproduced[h.scenario_run_id] ? (
                          <div className="mt-1 text-xs text-slate-600" data-reproduced>{reproduced[h.scenario_run_id].explanation}</div>
                        ) : null}
                      </div>
                      <div className="text-xs text-slate-500">
                        {h.executed_at ? new Date(h.executed_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""}
                      </div>
                      <div className="text-xs font-semibold text-slate-600">
                        {h.decision_status ? h.decision_status.toUpperCase() : "PENDING"}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-600">No scenario history yet.</div>
                )}
              </div>
              {accuracyText(accuracy).length ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600" data-accuracy>
                  <div className="font-semibold text-slate-700">How accurate have forecasts been?</div>
                  {accuracyText(accuracy).map((line) => <div key={line}>{line}</div>)}
                </div>
              ) : null}
              {compareResult?.runs ? (
                <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200" data-compare>
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr><th className="px-2 py-1 text-left">Scenario</th><th className="px-2 py-1 text-left">Verdict</th><th className="px-2 py-1 text-right">Profit change</th><th className="px-2 py-1 text-right">Net cash change (low · base · high)</th><th className="px-2 py-1 text-left">Robust</th><th className="px-2 py-1 text-left">Confidence</th></tr>
                    </thead>
                    <tbody>
                      {compareResult.runs.map((r) => (
                        <tr key={r.scenario_run_id} className="border-t border-slate-100">
                          <td className="px-2 py-1">{r.scenario_name}{r.current_model ? "" : " (earlier model)"}</td>
                          <td className="px-2 py-1">{String(r.outcome || "").replace(/_/g, " ")}</td>
                          <td className="px-2 py-1 text-right">{formatCurrency(r.profit_change ?? 0, currency)}</td>
                          <td className="px-2 py-1 text-right">{[r.net_cash_change_low, r.net_cash_change, r.net_cash_change_high].map((v) => v == null ? "—" : formatCurrency(v, currency)).join(" · ")}</td>
                          <td className="px-2 py-1">{r.robust == null ? "—" : r.robust ? "Yes" : "Depends"}</td>
                          <td className="px-2 py-1">{r.confidence || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-2 py-1 text-slate-500">{compareResult.note}</div>
                </div>
              ) : compareResult?.error ? <div className="mt-3 text-xs text-rose-600">{compareResult.error}</div> : null}
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" disabled={compareIds.length < 2} onClick={compareRuns} data-compare-button>
                  Compare selected ({compareIds.length})
                </Button>
                <Button variant="ghost" disabled={actionLoading || !canRun} onClick={clearHistory}>
                  Clear history
                </Button>
              </div>
            </SectionCard>
          </div>

          <SectionCard
            title={<div className="flex items-center gap-2"><span>Business settings and the figures used</span><InfoTip text="Used in every projection and scenario. Most come from your records automatically; set the rest here once." /></div>}
            subtitle={`${Object.keys(projectionSettingsForState(projectionSettings)).length} setting(s) set. They apply to every run, with and without the change.`}
          >
            <div data-business-settings>
              {(() => {
                const inputs = projectionRun?.projection_summary?.uncertainty?.inputs || [];
                const used = inputs.filter((i) => i.label !== "not set" && i.label !== "none recorded");
                const changed = confirmed?.sig && used.length && confirmed.sig !== figuresSignature(inputs);
                return used.length ? (
                  <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" data-figures-used>
                    <div className="font-semibold text-slate-700">Figures used, and where they came from</div>
                    <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                      {used.map((i) => (
                        <div key={i.input}><span className="text-slate-500">{i.input}: </span>{typeof i.value === "number" ? i.value.toLocaleString() : String(i.value)} <span className="text-slate-400">({i.label}{i.source ? `: ${i.source}` : ""})</span></div>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button variant="ghost" onClick={() => confirmFigures(inputs)} data-confirm-figures>These figures look right</Button>
                      <span className="text-slate-500" data-confirmed-status>
                        {confirmed?.at ? (changed ? "Your figures have changed since you last confirmed them." : `Confirmed by you on ${new Date(confirmed.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}.`) : "Not confirmed yet. If a figure is wrong, correct it where it is recorded (Financials, Master records, profile) or below."}
                      </span>
                    </div>
                  </div>
                ) : null;
              })()}
              <p className="mb-3 text-sm text-slate-500">Your recorded figures are used automatically. Add these optional details only where they apply; an empty field means it has not been set.</p>
              <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                {SETTING_GROUPS.map(([group, keys]) => (
                  <details key={group} className="rounded-xl border border-slate-200 bg-white px-3 py-2" data-settings-group={group}>
                    <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                      {group}{keys.filter((k) => projectionSettings[k] !== "" && projectionSettings[k] != null).length ? ` · ${keys.filter((k) => projectionSettings[k] !== "" && projectionSettings[k] != null).length} set` : ""}
                    </summary>
                    <div className="mt-2 space-y-2">
                      {group === "Payroll" && (projectionRun?.projection_summary?.uncertainty?.inputs || []).some(i => i.input === "Salaries" && i.label === "recorded") ? <p className="rounded-lg bg-indigo-50 p-3 text-xs leading-5 text-indigo-800">Staff payments are already included in your recorded expenses. They will not be added again.</p> : null}
                      {keys.map((key) => {
                        const def = PROJECTION_SETTINGS.find(([k]) => k === key) || [key, key, ""];
                        const used = (projectionRun?.projection_summary?.uncertainty?.inputs || []).find(i => i.input === def[1] && !["not set", "none recorded"].includes(i.label));
                        const value = projectionSettings[key] ?? used?.value ?? "";
                        return (
                          <div key={key}>
                            <FieldLabel info={def[2]}>{def[1]}</FieldLabel>
                            {SETTING_CHOICES[key] ? (
                              <select className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={String(value)}
                                onChange={(e) => updateProjectionSetting(key, e.target.value)} aria-label={def[1]}>
                                {SETTING_CHOICES[key].map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                              </select>
                            ) : (
                              <NumberInput aria-label={def[1]} value={String(value)} onChange={(v) => updateProjectionSetting(key, v)} placeholder="Not set (optional)" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </SectionCard>


        </div>
      ) : null}

      {workspaceId && tab === "manual" && canSimFeature("run_simulation") ? (
        <div className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SectionCard title="Manual scenario" subtitle="Build a custom simulation.">
            <div className="space-y-4">
              <div className="space-y-3">
                <div>
                  <FieldLabel info="Choose a scenario template to simulate.">Scenario template</FieldLabel>
                  <select className="ea-input" value={manualTemplateId} onChange={(e) => setManualTemplateId(e.target.value)}>
                    <option value="do_nothing_projection">Baseline Continuity Projection</option>
                    {templates
                      .filter((t) => t.mode !== "adaptive" && offeredScenario(t.scenario_template_id) && t.scenario_template_id !== "tmpl_combined")
                      .map((t) => {
                        const allowed = planAllowsScenario(planKey, t.scenario_template_id, planStatus) || hasSimulationGrant;
                        return (
                          <option key={t.scenario_template_id} value={t.scenario_template_id} disabled={!allowed}>
                            {t.title}{!allowed ? " — upgrade required" : ""}
                          </option>
                        );
                      })}
                  </select>
                </div>
                <div>
                  <FieldLabel info="Give the run a name for tracking.">Scenario name</FieldLabel>
                  <input
                    className="ea-input"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    disabled={manualTemplateId === "do_nothing_projection"}
                  />
                </div>
                <div>
                  <FieldLabel info="How many months to project: 3 to 24.">Timeline months</FieldLabel>
                  <NumberInput value={manualTimelineMonths} onChange={setManualTimelineMonths} placeholder="6" />
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" data-projection-settings>
                  Business settings ({Object.keys(projectionSettingsForState(projectionSettings)).length} set) apply to every run.{" "}
                  <button type="button" className="font-semibold text-brand-700 underline" onClick={() => setTab("adaptive")}>Edit them on the simulation dashboard</button>
                </div>

                {manualTemplateId === "do_nothing_projection" ? (
                  <div className="text-sm text-slate-600">Uses current inputs. No additional inputs required.</div>
                ) : manualTemplate?.required_inputs?.length ? (
                  <>
                    {manualTemplate.required_inputs.map((key) => (
                      <div key={key}>
                        <FieldLabel info={fieldHelp(key)}>{prettyLabel(key, manualTemplate?.scenario_type)}</FieldLabel>
                        {SETTING_CHOICES[key] ? (
                          <select className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={String(manualParams[key] ?? "equity")}
                            onChange={(e) => setManualParams((p) => ({ ...p, [key]: e.target.value }))} aria-label={prettyLabel(key, manualTemplate?.scenario_type)}>
                            {SETTING_CHOICES[key].map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                          </select>
                        ) : (
                          <NumberInput
                            value={String(manualParams[key] ?? "")}
                            onChange={(v) => setManualParams((p) => ({ ...p, [key]: v === "" ? null : parseNumber(v, 0) }))}
                            placeholder={key === "employer_oncost_pct" ? "Country rules" : "0"}
                          />
                        )}
                        {key === "client_loss_pct" && largestClient ? (
                          <div className="mt-1 text-xs text-slate-500">
                            Largest client: {largestClient.name}
                            {largestClient.share != null ? ` (~${largestClient.share}% of revenue)` : ""}.
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {manualTemplate.scenario_type === "price_change" ? (
                      <MultiSelectChecklist
                        label="Products / Services To Include"
                        info={fieldHelp("selected_product_ids")}
                        items={productScenarioOptions.map((item) => ({
                          id: item.id,
                          label: item.label,
                          detail: item.revenueMonthly > 0 ? `Current monthly revenue contribution: ${formatCurrency(item.revenueMonthly, currency || "GBP")}` : "No tracked revenue yet for this item."
                        }))}
                        selectedIds={Array.isArray(manualParams?.selected_product_ids) ? manualParams.selected_product_ids : []}
                        onToggle={(id) => toggleManualSelection("selected_product_ids", id)}
                        emptyText="No products or services available yet."
                      />
                    ) : null}
                    {manualTemplate.scenario_type === "payment_delay" ? (
                      <MultiSelectChecklist
                        label="Pending Items To Delay"
                        info={fieldHelp("selected_pending_ids")}
                        items={pendingScenarioOptions.map((item) => ({
                          id: item.id,
                          label: item.label,
                          detail: item.detail
                        }))}
                        selectedIds={Array.isArray(manualParams?.selected_pending_ids) ? manualParams.selected_pending_ids : []}
                        onToggle={(id) => toggleManualSelection("selected_pending_ids", id)}
                        emptyText="No pending receivables available right now."
                      />
                    ) : null}
                  </>
                ) : (
                  <div className="text-sm text-slate-600">No additional inputs required.</div>
                )}
              </div>

              <div>
                {manualTemplateId !== "do_nothing_projection" && !(planAllowsScenario(planKey, manualTemplateId, planStatus) || hasSimulationGrant) ? (
                  <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                    This scenario is not available on your current plan.{" "}
                    <button type="button" className="font-semibold underline" onClick={handleUpgradeClick}>
                      View pricing plans
                    </button>
                  </div>
                ) : null}
                <div className="flex justify-end">
                  <Button
                    disabled={actionLoading || !canRun || !(planAllowsScenario(planKey, manualTemplateId, planStatus) || hasSimulationGrant)}
                    onClick={() => {
                      if (manualTemplateId === "do_nothing_projection") {
                        runDoNothing(parseNumber(manualTimelineMonths, 6), true);
                        return;
                      }
                      const selectedProductIds = Array.isArray(manualParams?.selected_product_ids) ? manualParams.selected_product_ids : [];
                      const selectedPendingIds = Array.isArray(manualParams?.selected_pending_ids) ? manualParams.selected_pending_ids : [];
                      const selectedProductRevenue = productScenarioOptions
                        .filter((item) => !selectedProductIds.length || selectedProductIds.includes(item.id))
                        .reduce((sum, item) => sum + Number(item.revenueMonthly || 0), 0);
                      const selectedPendingReceivableAmount = pendingScenarioOptions
                        .filter((item) => !selectedPendingIds.length || selectedPendingIds.includes(item.id))
                        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
                      const scenarioParams = {
                        ...manualParams,
                        selected_product_revenue_monthly: Number(selectedProductRevenue.toFixed(2)),
                        selected_pending_receivable_amount: Number(selectedPendingReceivableAmount.toFixed(2)),
                        timeline_months: parseNumber(manualTimelineMonths, 6)
                      };
                      setCreditModal({
                        featureName: "Scenario Simulation",
                        // QA PF2: a deterministic run is free (Credit System v2 §6): the server says so, so nothing is asked.
                        featureCode: "scenario_simulation",
                        onConfirm: () => { setCreditModal(null); runScenario(manualTemplateId, "manual", scenarioParams, manualName); }
                      });
                    }}
                  >
                    {actionLoading ? <Spinner size={16} /> : null}
                    {manualTemplateId === "do_nothing_projection" ? "Run projection" : "Run manual scenario"}
                  </Button>
                </div>
                {manualTemplateId !== "do_nothing_projection" && (planAllowsScenario(planKey, "tmpl_combined", planStatus) || hasSimulationGrant) ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600" data-combine>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-700">Combine changes{combo.length ? ` (${combo.length})` : ""}</span>
                      <button type="button" className="font-semibold text-brand-700 underline" disabled={combo.length >= 5}
                        onClick={() => setCombo((c) => [...c, { scenario_type: manualTemplate?.scenario_type, title: manualName || manualTemplate?.title,
                          params: Object.fromEntries(Object.entries(manualParams).filter(([, v]) => v !== null && v !== "" && !Array.isArray(v))) }].slice(0, 5))}>
                        Add this change
                      </button>
                    </div>
                    {combo.length ? (
                      <>
                        <ol className="mt-1 list-decimal pl-5">
                          {combo.map((c, i) => (
                            <li key={i}>{c.title} <button type="button" className="text-slate-400 underline" onClick={() => setCombo((all) => all.filter((_x, j) => j !== i))}>remove</button></li>
                          ))}
                        </ol>
                        <Button className="mt-2" disabled={combo.length < 2 || actionLoading}
                          onClick={() => runScenario("tmpl_combined", "manual", { steps: combo.map(({ scenario_type, params }) => ({ scenario_type, params })), timeline_months: parseNumber(manualTimelineMonths, 6) },
                            `Combined: ${combo.map((c) => c.title).join(" + ")}`)} data-run-combination>
                          Run these changes together
                        </Button>
                      </>
                    ) : <div className="mt-1 text-slate-500">Set up a change and add it; add another, then run them together.</div>}
                  </div>
                ) : null}
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                  {scenarioOutputNote(manualTemplateId, largestClient)}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className="rounded-xl border border-slate-200 bg-white">
                  <div className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-100">
                    Current baseline
                  </div>
                  <div className="p-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-slate-50 px-2 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">Monthly revenue</div>
                        <div className="mt-1 font-semibold text-slate-900">{formatCurrency(stateSnapshot?.revenue_monthly || 0, currency || "GBP")}</div>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">Monthly costs</div>
                        <div className="mt-1 font-semibold text-slate-900">{formatCurrency(stateSnapshot?.costs_monthly || 0, currency || "GBP")}</div>
                      </div>
                      <div className={`rounded-lg px-2 py-2 ${(stateSnapshot?.revenue_monthly || 0) - (stateSnapshot?.costs_monthly || 0) >= 0 ? "bg-emerald-50" : "bg-rose-50"}`}>
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">Monthly gross profit</div>
                        <div className={`mt-1 font-semibold ${(stateSnapshot?.revenue_monthly || 0) - (stateSnapshot?.costs_monthly || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {formatCurrency((stateSnapshot?.revenue_monthly || 0) - (stateSnapshot?.costs_monthly || 0), currency || "GBP")}
                        </div>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">Starting cash</div>
                        <div className="mt-1 font-semibold text-slate-900">{formatCurrency(stateSnapshot?.starting_cash || 0, currency || "GBP")}</div>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2 py-2 col-span-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">Largest client</div>
                        <div className="mt-1 font-semibold text-slate-900 break-words">
                          {largestClient ? `${largestClient.name} (${largestClient.share}% of revenue)` : "Not identified"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowHowRun(true)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-50 flex items-center justify-between"
                >
                  <span>How this run works</span>
                  <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 text-slate-400"><path fillRule="evenodd" d="M8.22 5.22a.75.75 0 011.06 0l3.25 3.25a.75.75 0 01-1.06 1.06L8 6.81 4.53 9.53a.75.75 0 01-1.06-1.06l3.75-3.25z" clipRule="evenodd" /></svg>
                </button>
              </div>

            </div>
          </SectionCard>

          <SectionCard title="Scenario output" subtitle="Timeline and recommendations." className="lg:col-span-2">
            <ScenarioOutput
              activeRun={activeRun}
              timeline={timeline}
              currency={currency || "GBP"}
              decisionSaving={decisionSaving}
              decisionNotice={decisionNotice}
              onDecision={saveDecision}
              hideDecision={isProjection(activeRun)}
              maxTimelineRows={6}
              showRisks={canSimFeature("risk_detection")}
              showRecommendations={canSimFeature("recommendations")}
              stateSnapshot={stateSnapshot}
              hideTimelineAndMeaning
              reportOutput={activeRun ? assembleOutput({
                workspaceId,
                currency: currency || "GBP",
                inputs,
                ideaValidation: acceptedIdeaValidation,
                financialInsights,
                riskSignals,
                recommendations,
                scenarioRun: activeRun,
                scenarioTimeline: timeline,
                multiEngineOutput: activeRun?.multi_engine ?? null,
              }) : null}
            />
          </SectionCard>
        </div>

        {activeRun && timeline?.length ? (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 pt-4 pb-3">
              <div className="text-base font-semibold text-slate-900">Your month-by-month outlook</div><p className="mt-1 text-sm text-slate-500">Follow your sales, costs and available cash over time.</p>
            </div>
            <div className="overflow-x-auto border-t border-slate-100">
              {(() => {
                // Simulation audit F13: the server's projection, unchanged; month 1 is the month after the run.
                const runBase = activeRun?.executed_at || activeRun?.created_at;
                const enriched = timeline.map(timelineRowForDisplay);
                return (
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        {["Month","Revenue","Receivables","Expenses","Cost of sales","Total costs","Gross Profit","Gross Margin %","Cum. Profit","Cash balance","Status"].map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {enriched.map((row) => {
                        const label = projectionMonthLabel(runBase, row.month_index);                        const stateLabel = String(row.state_label || "").toLowerCase();
                        return (
                          <tr key={row.month_index} className="border-t border-slate-100 hover:bg-slate-50/50">
                            <td className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">{label}</td>
                            <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{formatCurrency(row.revenue, currency)}</td>
                            <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{formatCurrency(row.accruals, currency)}</td>
                            <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{formatCurrency(row.expenses, currency)}</td>
                            <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{formatCurrency(row.cost_of_sales, currency)}</td>
                            <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{formatCurrency(row.costs, currency)}</td>
                            <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{formatCurrency(row.gross_profit, currency)}</td>
                            <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{row.gross_margin_pct != null ? `${row.gross_margin_pct}%` : "—"}</td>
                            <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{formatCurrency(row._cumGross, currency)}</td>
                            <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${row._cash > 0 ? "text-emerald-600" : row._cash < 0 ? "text-rose-600" : "text-slate-700"}`}>{formatCurrency(row._cash, currency)}</td>
                            <td className="px-3 py-2 text-left whitespace-nowrap">
                              {row.state_label ? (
                                <span title={statusOf(row.state_label)[1]} data-status={stateLabel} className={`cursor-help rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${stateLabel.includes("stable") ? "bg-emerald-50 text-emerald-700" : stateLabel.includes("risk") || stateLabel.includes("stress") || stateLabel.includes("critical") ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
                                  {statusOf(row.state_label)[0]}
                                </span>
                              ) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        ) : null}

        {activeRun ? (
          <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">What This Means</div>
            <div className="mt-2 text-sm leading-6 text-slate-700 break-words">
              {buildScenarioMeaning(activeRun, timeline, currency)}
            </div>
          </div>
        ) : null}
        </div>
      ) : null}
      {showHowRun ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setShowHowRun(false)}>
          <div className="relative max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900">How this run works</div>
              <button type="button" onClick={() => setShowHowRun(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" /></svg>
              </button>
            </div>
            <div className="space-y-2 text-xs leading-5 text-slate-600">
              {buildScenarioExecutionBreakdown(
                activeRun, timeline, currency || "GBP", manualTemplateId, templates, largestClient, manualParams, parseNumber(manualTimelineMonths, 6)
              ).map((line, i) => (
                <div key={i} className="rounded-lg bg-slate-50 px-2 py-2">{line}</div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {creditModal && (
        <CreditConfirmModal
          featureName={creditModal.featureName}
          creditCost={creditModal.creditCost}
          featureCode={creditModal.featureCode}
          onConfirm={creditModal.onConfirm}
          onCancel={() => setCreditModal(null)}
        />
      )}
      {confirmDialog ? (
        <ConfirmDialog
          message={confirmDialog.message}
          confirmLabel="Clear"
          danger
          onConfirm={confirmDialog.onConfirm}
          onCancel={confirmDialog.onCancel}
        />
      ) : null}
    </div>
  );
}

// Confirm dialog is shown from the SimulationPage scope (where confirmDialog state exists)

// QA PF4: scenarios about a client on record; the months the projection itself marks at risk; a ratio in words when
// it can't be a number ("Not available": nothing to compare with; "No cash to cover it": money owed, no cash).
export const CLIENT_SCENARIOS = ["tmpl_client_loss"];
// Each month's status in plain words, with what it means (the owner, 25 Oct: never AT_RISK or STRESS)
export const STATUS_WORDS = {
  stable: ["Stable", "Cash covers six months of costs or more, and the month makes money."],
  tight: ["Tight", "Cash covers three to six months of costs, or the month loses money."],
  stress: ["Under stress", "Cash covers less than three months of costs, or money owed to you is building up."],
  at_risk: ["At risk", "Cash covers less than one month of costs."],
  critical: ["Overdrawn", "Cash is below zero."],
};
export const statusOf = (label) => STATUS_WORDS[String(label || "").toLowerCase().trim().replace(/\s+/g, "_")] || [String(label || ""), ""];

export const atRisk = (timeline) => (timeline || []).filter((t) => ["at_risk", "stress", "critical"].includes(t?.state_label)).map((t) => t.month_index);
export function ratioText(value, state) {
  if (typeof value === "number") return value.toFixed(2);
  if (state === "unbounded") return "No cash to cover it";
  return "Not available";
}

// Receivables that can still be collected: not paid, and not disputed, voided, cancelled or credited.
const NOT_COLLECTABLE = new Set(["paid", "disputed", "void", "voided", "cancelled", "canceled", "credited", "written_off", "draft"]);
export function isCollectable(invoice) {
  if (NOT_COLLECTABLE.has(String(invoice?.status || "").toLowerCase())) return false;
  return !(invoice?.disputed || ["open", "disputed"].includes(invoice?.dispute_status));
}

function buildDefaultParams(template, stateSnapshot, largestClient) {
  if (!template) return {};
  const defaults = {
    price_change_pct: 5,
    effective_month: 1,
    revenue_drop_pct: 10,
    cost_increase_pct: 10,
    cost_reduction_pct: 10,
    employee_count: 1,
    employee_monthly_cost: 1500,
    contractor_monthly_cost: 1200,
    delay_months: 1,
    revenue_uplift_pct: 10,
    cost_uplift_pct: 5,
    client_loss_pct: stateSnapshot?.top_client_share_pct ?? 30,
    // Phase 1 inputs (simulation audit): standard figures the owner can change; the run says which were left as standard
    price_sensitivity: 1,
    employer_oncost_pct: null,      // Phase 5: blank uses the country's employer costs (factors.py), else 15%
    recruitment_cost_per_hire: 0,
    start_month: 1,
    revenue_per_hire_monthly: 0,
    launch_cost: 0,
    loan_amount: 10000,
    loan_annual_rate_pct: 8,
    loan_term_months: 24,
    loan_start_month: 1,
    funding_amount: 50000,
    funding_month: 1,
    funding_type: "equity",
    equipment_cost: 10000,
    purchase_month: 1,
    useful_life_months: 36,
    extra_revenue_monthly: 0,
    cost_saving_monthly: 0,
    selected_product_ids: [],
    selected_pending_ids: [],
  };
  const params = {};
  (template.required_inputs || []).forEach((key) => {
    params[key] = key in defaults ? defaults[key] : 0;
  });
  if (template.scenario_type === "client_loss") {
    params.client_loss_pct = largestClient?.share ?? stateSnapshot?.top_client_share_pct ?? 30;
  }
  return params;
}

function prettyLabel(key, scenarioType) {
  const overrides = {
    client_loss_pct: "Revenue at risk (%)",
    price_change_pct: "Price change (%)",
    revenue_drop_pct: "Revenue drop (%)",
    cost_increase_pct: "Cost increase (%)",
    cost_reduction_pct: "Cost reduction (%)",
    revenue_uplift_pct: "Revenue uplift (%)",
    cost_uplift_pct: "Cost uplift (%)",
    employee_count: scenarioType === "delay_hiring" ? "Employees to cancel" : "Employees to add",
    employee_monthly_cost: "Monthly cost per employee",
    contractor_monthly_cost: "Monthly contractor cost",
    delay_months: "Delay (months)",
    effective_month: "Effective from month",
    price_sensitivity: "Customer price sensitivity",
    employer_oncost_pct: "Employer on-costs (%)",
    recruitment_cost_per_hire: "Recruitment cost per hire",
    start_month: "Starts in month",
    revenue_per_hire_monthly: "Revenue per hire a month (optional)",
    launch_cost: "One-off launch cost",
    loan_amount: "Loan amount",
    loan_annual_rate_pct: "Interest rate (% a year)",
    loan_term_months: "Repaid over (months)",
    loan_start_month: "Received in month",
    funding_amount: "Amount",
    funding_month: "Received in month",
    funding_type: "Type of funding",
    equipment_cost: "Equipment cost",
    purchase_month: "Bought in month",
    useful_life_months: "Useful life (months)",
    extra_revenue_monthly: "Extra sales a month (optional)",
    cost_saving_monthly: "Running costs saved a month (optional)",
  };
  return overrides[key] || String(key || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function scenarioOutputNote(templateId, largestClient) {
  switch (templateId) {
    case "do_nothing_projection":
      return "This shows what your business may look like over time if you keep going without making any major change.";
    case "tmpl_take_loan":
      return "This shows whether borrowing helps: the money arrives, then repayments and interest follow. It is judged on cash after the debt, so a loan only looks better if it keeps you from running short.";
    case "tmpl_client_loss":
      return `This shows what may happen if your biggest client${largestClient?.name ? ` (${largestClient.name})` : ""} stops buying from you, with revenue and cost of sales stepping down over the first months of the run.`;
    case "tmpl_price_increase":
      return "This shows whether a price increase on selected products or services improves revenue and net profit without changing your current cost base straight away.";
    case "tmpl_hire_staff":
      return "This shows how adding staff increases monthly costs first, so you can see whether your current revenue can absorb the extra payroll.";
    case "tmpl_contractor_addition":
      return "This shows how adding a contractor increases monthly costs without a permanent commitment, so you can see whether the capacity gain justifies the cost.";
    case "tmpl_cost_increase":
      return "This shows what happens if delivery or operating costs rise, and whether your margin and projected cash balance can still hold up.";
    case "tmpl_revenue_drop":
      return "This shows what happens if sales slow down across the business, including the knock-on effect on net profit and projected cash balance.";
    case "tmpl_payment_delay":
      return "This shows what happens when selected pending customer payments land later than expected, so net profit may still look fine while cash comes in more slowly.";
    case "tmpl_reduce_fixed_cost":
      return "This shows what happens when you cut overhead or fixed costs, so you can see how much margin and cash headroom the reduction creates.";
    case "tmpl_delay_hiring":
      return "This shows how deferring or cancelling a planned hire removes that payroll cost, so you can see the direct effect on expenses, net profit, and cash runway.";
    case "tmpl_service_launch":
      return "This shows whether a new service could lift revenue enough to justify the extra delivery and operating costs.";
    default:
      return "This output compares your current baseline with the scenario you selected, so you can see the effect on revenue, costs, net profit, and projected cash balance.";
  }
}

function scenarioAssumptions(templateId, largestClient, manualParams, months) {
  switch (templateId) {
    case "do_nothing_projection":
      return [
        `Timeline: ${months} month${Number(months) === 1 ? "" : "s"}.`,
        "Uses your current run-rate revenue, current costs, and current payment timing without introducing a new change.",
      ];
    case "tmpl_client_loss":
      return [
        `Client loss applied: ${Number(manualParams?.client_loss_pct ?? largestClient?.share ?? 0).toFixed(2)}%.`,
        "Revenue ramps down over the first months, and cost of sales falls in the same proportion as revenue during that ramp.",
      ];
    case "tmpl_price_increase":
      return [
        `Price change: ${Number(manualParams?.price_change_pct ?? 0).toFixed(2)}%.`,
        `Effective month: ${Math.max(1, Number(manualParams?.effective_month ?? 1))}.`,
        `Selected products/services: ${Array.isArray(manualParams?.selected_product_ids) && manualParams.selected_product_ids.length ? manualParams.selected_product_ids.length : "all current revenue sources"}.`,
      ];
    case "tmpl_hire_staff":
      return [
        `New employees: ${Math.max(1, Number(manualParams?.employee_count ?? 1))}.`,
        `Monthly pay added: ${Number(manualParams?.employee_monthly_cost ?? 0).toFixed(2)} per employee, plus ${Number(manualParams?.employer_oncost_pct ?? 15)}% employer on-costs.`,
      ];
    case "tmpl_take_loan":
      return [
        `Loan: ${Number(manualParams?.loan_amount ?? 0).toFixed(2)} at ${Number(manualParams?.loan_annual_rate_pct ?? 0)}% a year over ${Number(manualParams?.loan_term_months ?? 0)} months.`,
        "Interest is a cost; repayments reduce cash. The verdict compares cash after the debt still owed.",
      ];
    case "tmpl_contractor_addition":
      return [
        `Contractors added: ${Math.max(1, Number(manualParams?.employee_count ?? 1))}.`,
        `Monthly contractor cost: ${Number(manualParams?.contractor_monthly_cost ?? 0).toFixed(2)} per contractor.`,
        "Cost applies from month 1 with no ramp — contractor arrangements are typically immediate.",
      ];
    case "tmpl_cost_increase":
      return [
        `Cost increase: ${Number(manualParams?.cost_increase_pct ?? 0).toFixed(2)}%.`,
        "Expenses and cost of sales are both increased by this scenario.",
      ];
    case "tmpl_revenue_drop":
      return [
        `Revenue drop: ${Number(manualParams?.revenue_drop_pct ?? 0).toFixed(2)}%.`,
        "Cost of sales falls with revenue in this scenario.",
      ];
    case "tmpl_payment_delay":
      return [
        `Payment delay: ${Math.max(0, Number(manualParams?.delay_months ?? 0))} month${Number(manualParams?.delay_months ?? 0) === 1 ? "" : "s"}.`,
        `Selected pending items: ${Array.isArray(manualParams?.selected_pending_ids) && manualParams.selected_pending_ids.length ? manualParams.selected_pending_ids.length : "all pending receivables"}.`,
        "Gross profit can stay unchanged while projected cash balance moves more slowly.",
      ];
    case "tmpl_reduce_fixed_cost":
      return [
        `Cost reduction applied: ${Number(manualParams?.cost_reduction_pct ?? 0).toFixed(2)}%.`,
        "Overhead and fixed expenses fall over the first 2 months as savings are realised.",
      ];
    case "tmpl_delay_hiring":
      return [
        `Hires cancelled/deferred: ${Math.max(1, Number(manualParams?.employee_count ?? 1))}.`,
        `Monthly payroll saved: ${Number(manualParams?.employee_monthly_cost ?? 0).toFixed(2)} per employee.`,
        "Revenue stays on the current baseline — this run shows the cost saving only.",
      ];
    case "tmpl_service_launch":
      return [
        `Revenue uplift: ${Number(manualParams?.revenue_uplift_pct ?? 0).toFixed(2)}%.`,
        `Cost uplift: ${Number(manualParams?.cost_uplift_pct ?? 0).toFixed(2)}%.`,
      ];
    default:
      return [`Timeline: ${months} month${Number(months) === 1 ? "" : "s"}.`];
  }
}

function monthSpanFromDays(days, fallback = 1, cap = 3) {
  const numeric = Number(days || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  const span = Math.ceil(numeric / 30);
  return Math.max(1, Math.min(cap, span));
}

function formatPercentValue(value, digits = 2) {
  const numeric = Number(value || 0);
  return `${numeric.toFixed(digits)}%`;
}

function buildScenarioExecutionBreakdown(
  activeRun,
  timeline,
  currency,
  manualTemplateId,
  templates,
  largestClient,
  manualParams,
  months
) {
  const selectedTemplate = Array.isArray(templates)
    ? templates.find((item) => item?.scenario_template_id === manualTemplateId)
    : null;
  const activeTemplateId = String(activeRun?.scenario_template_id || "");
  const activeScenarioType = String(activeRun?.scenario_type || "").toLowerCase();
  const selectedScenarioType = String(selectedTemplate?.scenario_type || "").toLowerCase();

  if (
    !activeRun ||
    isProjection(activeRun) ||
    (manualTemplateId && activeTemplateId && activeTemplateId !== manualTemplateId) ||
    (selectedScenarioType && activeScenarioType && selectedScenarioType !== activeScenarioType)
  ) {
    return scenarioAssumptions(manualTemplateId, largestClient, manualParams, months);
  }

  const scenarioType = String(activeRun?.scenario_type || "").toLowerCase();
  const params = { ...(activeRun?.parameters || {}), ...(manualParams || {}) };
  const baseline = activeRun?.baseline_snapshot || {};
  const baselineRevenue = Number(
    activeRun?.baseline_metrics?.monthly_revenue ?? baseline?.revenue_monthly ?? 0
  );
  const baselineExpenses = Number(
    activeRun?.baseline_metrics?.monthly_expenses ?? baseline?.expenses_monthly ?? 0
  );
  const baselineCostOfSales = Number(
    activeRun?.baseline_metrics?.monthly_cost_of_sales ?? baseline?.cost_of_sales_monthly ?? 0
  );
  const firstRow = Array.isArray(timeline) && timeline.length ? timeline[0] : null;
  const secondRow = Array.isArray(timeline) && timeline.length > 1 ? timeline[1] : null;

  if (scenarioType === "client_loss") {
    const lossPct = Number(params?.client_loss_pct ?? baseline?.top_client_share_pct ?? largestClient?.share ?? 0);
    const salesRampMonths = Math.max(
      2,
      monthSpanFromDays(baseline?.sales_cycle_days, 1, 3)
    );
    const monthOneProgress = Math.min(1, 1 / salesRampMonths);
    const monthOneLossShare = lossPct * monthOneProgress;
    const monthOneMultiplier = Math.max(0, 1 - monthOneLossShare / 100);
    const fullMultiplier = Math.max(0, 1 - lossPct / 100);
    const effectiveLargestClient = largestClient?.name || "largest client";

    return [
      `Baseline revenue: ${formatCurrency(baselineRevenue, currency)}.`,
      `Baseline expenses: ${formatCurrency(baselineExpenses, currency)}. Baseline cost of sales: ${formatCurrency(baselineCostOfSales, currency)}.`,
      `Largest client used in this run: ${effectiveLargestClient}. Client loss applied: ${formatPercentValue(lossPct)}.`,
      `Ramp length: ${salesRampMonths} month${salesRampMonths === 1 ? "" : "s"}, based on your sales cycle.`,
      `Month 1 applies ${formatPercentValue(monthOneLossShare, 3)} of loss, so the multiplier is ${monthOneMultiplier.toFixed(5)}.`,
      `Month 1 revenue: ${formatCurrency(firstRow?.revenue ?? baselineRevenue * monthOneMultiplier, currency)} = ${formatCurrency(baselineRevenue, currency)} x ${monthOneMultiplier.toFixed(5)}.`,
      `Month 1 cost of sales: ${formatCurrency(firstRow?.cost_of_sales ?? baselineCostOfSales * monthOneMultiplier, currency)} = ${formatCurrency(baselineCostOfSales, currency)} x ${monthOneMultiplier.toFixed(5)}.`,
      `Month 2 onward applies the full ${formatPercentValue(lossPct)}, so the multiplier becomes ${fullMultiplier.toFixed(5)}.`,
      `Month 2+ revenue: ${formatCurrency(secondRow?.revenue ?? baselineRevenue * fullMultiplier, currency)} = ${formatCurrency(baselineRevenue, currency)} x ${fullMultiplier.toFixed(5)}.`,
      `Month 2+ cost of sales: ${formatCurrency(secondRow?.cost_of_sales ?? baselineCostOfSales * fullMultiplier, currency)} = ${formatCurrency(baselineCostOfSales, currency)} x ${fullMultiplier.toFixed(5)}.`,
      "Projected cash balance increases only when revenue is collected and decreases only when costs are actually paid."
    ];
  }

  if (scenarioType === "revenue_drop") {
    const dropPct = Number(params?.revenue_drop_pct ?? 0);
    const salesRampMonths = monthSpanFromDays(baseline?.sales_cycle_days, 1, 3);
    const monthOneProgress = Math.min(1, 1 / salesRampMonths);
    const monthOneMultiplier = Math.max(0, 1 - ((dropPct / 100) * monthOneProgress));
    return [
      `Baseline revenue: ${formatCurrency(baselineRevenue, currency)}. Baseline cost of sales: ${formatCurrency(baselineCostOfSales, currency)}.`,
      `Revenue drop applied: ${formatPercentValue(dropPct)} over ${salesRampMonths} month${salesRampMonths === 1 ? "" : "s"}.`,
      `Month 1 multiplier: ${monthOneMultiplier.toFixed(5)}.`,
      `Month 1 revenue: ${formatCurrency(firstRow?.revenue ?? baselineRevenue * monthOneMultiplier, currency)}.`,
      `Month 1 cost of sales: ${formatCurrency(firstRow?.cost_of_sales ?? baselineCostOfSales * monthOneMultiplier, currency)}.`,
      "Cost of sales falls in the same proportion as revenue in this scenario."
    ];
  }

  if (scenarioType === "price_change") {
    const changePct = Number(params?.price_change_pct ?? 0);
    const effectiveMonth = Math.max(1, Number(params?.effective_month ?? 1));
    const selectedRevenue = Number(params?.selected_product_revenue_monthly ?? 0);
    const selectedCount = Array.isArray(params?.selected_product_ids) ? params.selected_product_ids.length : 0;
    return [
      `Baseline revenue: ${formatCurrency(baselineRevenue, currency)}. Customers respond to the new price: sales volume moves the other way, by the price sensitivity shown in the assumptions, and cost of sales follows the volume.`,
      `Price increase applied: ${formatPercentValue(changePct)} from month ${effectiveMonth}.`,
      `Selected products/services: ${selectedCount || "all"}${selectedRevenue > 0 ? `, covering ${formatCurrency(selectedRevenue, currency)} of monthly revenue` : ""}.`,
      `Month 1 revenue in the table is ${formatCurrency(firstRow?.revenue ?? baselineRevenue, currency)} based on when the increase begins.`,
      "Gross profit changes because the price and the volume sold both change; operating expenses stay on the current baseline."
    ];
  }

  if (scenarioType === "cost_increase") {
    const increasePct = Number(params?.cost_increase_pct ?? 0);
    return [
      `Baseline expenses: ${formatCurrency(baselineExpenses, currency)}. Baseline cost of sales: ${formatCurrency(baselineCostOfSales, currency)}.`,
      `Cost increase applied: ${formatPercentValue(increasePct)} over the 2-month cost ramp.`,
      `Month 1 expenses: ${formatCurrency(firstRow?.expenses ?? baselineExpenses, currency)}. Month 1 cost of sales: ${formatCurrency(firstRow?.cost_of_sales ?? baselineCostOfSales, currency)}.`,
      "Both expenses and cost of sales move upward in this scenario, which is why net profit and projected cash balance tighten."
    ];
  }

  if (scenarioType === "contractor_addition") {
    const contractorCount = Math.max(1, Number(params?.employee_count ?? 1));
    const contractorCost = Number(params?.contractor_monthly_cost ?? 0);
    const totalCost = contractorCount * contractorCost;
    return [
      `Baseline cost of sales: ${formatCurrency(baselineCostOfSales, currency)}.`,
      `Contractors added: ${contractorCount} x ${formatCurrency(contractorCost, currency)} = ${formatCurrency(totalCost, currency)} per month.`,
      `Month 1 cost of sales: ${formatCurrency(firstRow?.cost_of_sales ?? baselineCostOfSales + totalCost, currency)}.`,
      "Revenue stays on the current baseline — this run shows the direct delivery cost of adding contractor capacity."
    ];
  }

  if (scenarioType === "hire_staff") {
    const employeeCount = Math.max(1, Number(params?.employee_count ?? 1));
    const employeeCost = Number(params?.employee_monthly_cost ?? 0);
    return [
      `Baseline expenses: ${formatCurrency(baselineExpenses, currency)}.`,
      `New staff added: ${employeeCount} x ${formatCurrency(employeeCost, currency)} pay, plus ${Number(params?.employer_oncost_pct ?? 15)}% employer on-costs = ${formatCurrency(employeeCount * employeeCost * (1 + Number(params?.employer_oncost_pct ?? 15) / 100), currency)} per month.`,
      `Month 1 expenses in the table are ${formatCurrency(firstRow?.expenses ?? baselineExpenses, currency)} (recruitment costs fall in the start month).`,
      Number(params?.revenue_per_hire_monthly ?? 0) > 0
        ? `Each hire adds up to ${formatCurrency(Number(params.revenue_per_hire_monthly), currency)} of sales a month, reached over 3 months, with cost of sales at your current ratio.`
        : "No extra sales from the hire are included, so the output shows whether today’s sales can absorb the extra payroll."
    ];
  }

  if (scenarioType === "payment_delay") {
    const delayMonths = Math.max(0, Number(params?.delay_months ?? 0));
    const selectedPendingAmount = Number(params?.selected_pending_receivable_amount ?? 0);
    const selectedPendingCount = Array.isArray(params?.selected_pending_ids) ? params.selected_pending_ids.length : 0;
    return [
      `Baseline revenue: ${formatCurrency(baselineRevenue, currency)}. Baseline costs: ${formatCurrency(Number(activeRun?.baseline_metrics?.monthly_costs ?? baseline?.costs_monthly ?? 0), currency)}.`,
      `Payment delay applied: ${delayMonths} month${delayMonths === 1 ? "" : "s"}.`,
      `Selected pending items: ${selectedPendingCount || "all pending receivables"}${selectedPendingAmount > 0 ? `, worth ${formatCurrency(selectedPendingAmount, currency)}` : ""}.`,
      `Month 1 projected cash balance is ${formatCurrency(firstRow?.cash_balance ?? 0, currency)} because collections are pushed back.`,
      "Gross profit can stay unchanged while projected cash balance moves later in the timeline."
    ];
  }

  if (scenarioType === "reduce_fixed_cost") {
    const reductionPct = Number(params?.cost_reduction_pct ?? 0);
    return [
      `Baseline expenses: ${formatCurrency(baselineExpenses, currency)}.`,
      `Cost reduction applied: ${formatPercentValue(reductionPct)} over the 2-month ramp.`,
      `Month 1 expenses: ${formatCurrency(firstRow?.expenses ?? baselineExpenses, currency)}.`,
      "Expenses fall gradually as the saving takes effect, improving both net profit and projected cash balance."
    ];
  }

  if (scenarioType === "delay_hiring") {
    const employeeCount = Math.max(1, Number(params?.employee_count ?? 1));
    const employeeCost = Number(params?.employee_monthly_cost ?? 0);
    const saving = employeeCount * employeeCost;
    return [
      `Baseline expenses: ${formatCurrency(baselineExpenses, currency)}.`,
      `Planned hire cancelled: ${employeeCount} x ${formatCurrency(employeeCost, currency)} pay plus ${Number(params?.employer_oncost_pct ?? 15)}% on-costs = ${formatCurrency(saving * (1 + Number(params?.employer_oncost_pct ?? 15) / 100), currency)} per month.`,
      `Month 1 expenses with saving: ${formatCurrency(firstRow?.expenses ?? Math.max(0, baselineExpenses - saving), currency)}.`,
      "Revenue stays on the current baseline — this run shows the direct effect of removing the payroll commitment."
    ];
  }

  if (scenarioType === "service_launch") {
    const revenueUplift = Number(params?.revenue_uplift_pct ?? 0);
    const costUplift = Number(params?.cost_uplift_pct ?? 0);
    return [
      `Baseline revenue: ${formatCurrency(baselineRevenue, currency)}. Baseline cost of sales: ${formatCurrency(baselineCostOfSales, currency)}.`,
      `Revenue uplift applied: ${formatPercentValue(revenueUplift)}. Cost uplift applied: ${formatPercentValue(costUplift)}.`,
      `Month 1 revenue: ${formatCurrency(firstRow?.revenue ?? baselineRevenue, currency)}. Month 1 cost of sales: ${formatCurrency(firstRow?.cost_of_sales ?? baselineCostOfSales, currency)}.`,
      `The new sales carry cost of sales at your current ratio; the cost uplift applies to operating expenses${Number(params?.launch_cost ?? 0) > 0 ? `; the launch costs ${formatCurrency(Number(params.launch_cost), currency)} in month 1` : ""}. Both ramp up over the first 3 months.`
    ];
  }

  return scenarioAssumptions(manualTemplateId, largestClient, manualParams, months);
}

function fieldHelp(key) {
  const help = {
    price_change_pct: "Percent change in price.",
    revenue_drop_pct: "Percent drop in revenue.",
    cost_increase_pct: "Percent increase in monthly costs.",
    cost_reduction_pct: "Percent reduction in fixed/overhead costs.",
    employee_count: "Number of people.",
    employee_monthly_cost: "Monthly pay per person, before employer on-costs.",
    contractor_monthly_cost: "Monthly cost per contractor.",
    delay_months: "Months of delayed payments.",
    revenue_uplift_pct: "Extra revenue from the new service, as a percent of today's revenue, reached over 3 months.",
    cost_uplift_pct: "Extra overheads for the new service, as a percent of operating expenses. Its cost of sales follows its sales.",
    price_sensitivity: "How much sales fall for each 1% price rise. 1 = sales fall 1% (the standard moderate figure); 0 = customers don't react; 2 = they react strongly.",
    employer_oncost_pct: "Employer tax, pension and benefits on top of pay. Blank: worked out from your country's rules (UK National Insurance and pension, Nigeria pension, NSITF and ITF, US FICA and FUTA), else 15%.",
    recruitment_cost_per_hire: "One-off cost of hiring each person (adverts, agency fees), in the start month.",
    start_month: "The projection month the new hire starts.",
    revenue_per_hire_monthly: "Sales each hire brings in a month at full output, reached over 3 months. Leave 0 to show the cost only.",
    launch_cost: "Money spent up front to launch, in month 1.",
    loan_amount: "How much you borrow.",
    loan_annual_rate_pct: "The loan's interest rate a year.",
    loan_term_months: "Months to repay it, in equal instalments from the month after you receive it.",
    loan_start_month: "The projection month the money arrives.",
    funding_amount: "How much you expect to receive.",
    funding_month: "The projection month it arrives.",
    funding_type: "Equity investment and owner capital are cash in, not income or a loan. A grant is cash in and income.",
    equipment_cost: "What the equipment costs, paid in the month you buy it.",
    purchase_month: "The projection month you pay for it.",
    useful_life_months: "How long it will be used. Its cost is spread over this many months as depreciation.",
    extra_revenue_monthly: "Extra sales a month the equipment makes possible, from the month it is bought.",
    cost_saving_monthly: "Running costs it saves each month, from the month it is bought.",
    client_loss_pct: "Percent of monthly revenue lost if the largest client leaves.",
    selected_product_ids: "Select the products or services to include in the price increase.",
    selected_pending_ids: "Select the pending receivables to focus the delay simulation on.",
  };
  return help[key] || "";
}

function MultiSelectChecklist({ label, info, items, selectedIds, onToggle, emptyText }) {
  return (
    <div>
      <FieldLabel info={info}>{label}</FieldLabel>
      <div className="mt-2 rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
          {selectedIds.length ? `${selectedIds.length} selected` : "Select one or more options"}
        </div>
        <div className="max-h-48 space-y-2 overflow-auto p-3">
          {items.length ? items.map((item) => (
            <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
              <input
                type="checkbox"
                className="mt-0.5"
                value={item.id}
                checked={selectedIds.includes(item.id)}
                onChange={() => onToggle(item.id)}
              />
              <div className="min-w-0 text-sm text-slate-700">
                <div className="break-words">{item.label}</div>
                {item.detail ? <div className="mt-1 text-xs text-slate-500">{item.detail}</div> : null}
              </div>
            </label>
          )) : (
            <div className="px-2 py-2 text-sm text-slate-500">{emptyText}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function buildScenarioMeaning(activeRun, timeline, currency) {
  const delta = activeRun?.deltas || {};
  const scenarioType = String(activeRun?.scenario_type || "").toLowerCase();
  const lastRow = Array.isArray(timeline) && timeline.length ? timeline[timeline.length - 1] : null;
  const revenueDelta = Number(delta?.monthly_revenue || 0);
  const profitDelta = Number(delta?.net_profit || 0);
  const costsDelta = Number(delta?.monthly_costs || 0);
  const scenarioCash = Number(lastRow?.cash_balance || 0);
  const firstRow = Array.isArray(timeline) && timeline.length ? timeline[0] : null;
  const cur = currency || "GBP";

  const revenueText =
    revenueDelta > 0
      ? `your estimated monthly sales grow by ${formatCurrency(Math.abs(revenueDelta), cur)}`
      : revenueDelta < 0
        ? `your estimated monthly sales fall by ${formatCurrency(Math.abs(revenueDelta), cur)}`
        : "your monthly sales volume stays about the same";

  const profitText =
    profitDelta > 0
      ? `actual profit on paper improves by ${formatCurrency(Math.abs(profitDelta), cur)}`
      : profitDelta < 0
        ? `actual profit on paper falls by ${formatCurrency(Math.abs(profitDelta), cur)}`
        : "profit on paper remains steady";

  const costsText =
    costsDelta > 0
      ? `total bills and delivery costs rise by ${formatCurrency(Math.abs(costsDelta), cur)}`
      : costsDelta < 0
        ? `total bills and delivery costs fall by ${formatCurrency(Math.abs(costsDelta), cur)}`
        : "your overhead and delivery costs stay flat";

  let scenarioRule = "This simulation takes your current financial pace and projects it forward based on the changes you selected.";
  if (scenarioType === "client_loss") {
    scenarioRule = "This run shows what happens when a customer stops buying. Revenue and the costs to serve them both drop gradually over the first few months.";
  } else if (scenarioType === "price_change") {
    scenarioRule = "This run shows the effect of changing your prices. It assumes your delivery costs stay the same while your sales income increases.";
  } else if (scenarioType === "cost_increase") {
    scenarioRule = "This run shows what happens if your suppliers charge more or your bills go up, eating into your profit margin.";
  } else if (scenarioType === "revenue_drop") {
    scenarioRule = "This run shows a general slowdown in sales, allowing you to see how much of a cushion you have before profits turn into losses.";
  } else if (scenarioType === "payment_delay") {
    scenarioRule = "This is a timing test. It keeps your sales steady but assumes customers take longer to pay, showing you how much cash 'gets stuck' in unpaid invoices.";
  } else if (scenarioType === "hire_staff") {
    scenarioRule = "This run adds new salary costs to your monthly bills so you can see if your current sales can safely cover the extra payroll.";
  } else if (scenarioType === "contractor_addition") {
    scenarioRule = "This run adds immediate contractor costs. Since contractors can be stopped quickly, it's a good way to see if extra help pays for itself.";
  } else if (scenarioType === "service_launch") {
    scenarioRule = "This run models a new product or service. It balances the new income against the higher delivery costs and overhead needed to run it.";
  } else if (scenarioType === "reduce_fixed_cost") {
    scenarioRule = "This run models the impact of cutting overhead. It shows how saving on bills directly improves your profit margin and bank balance over time.";
  } else if (scenarioType === "delay_hiring") {
    scenarioRule = "This run shows the benefit of NOT hiring someone yet. By removing that planned cost, you can see how much more cash you keep in the business.";
  }

  const cashLine = lastRow
    ? scenarioCash > 0
      ? `Your bank balance is projected to end at ${formatCurrency(scenarioCash, cur)}. This is different from profit because it depends on exactly when money arrives or leaves your account.`
      : "Your bank balance remains very tight in this scenario, suggesting you may need to find extra cash to cover bills."
    : "The cash balance is the 'real' money you have left after paying all bills, once customer payments finally arrive.";
  
  const firstMonthLine = firstRow
    ? `Starting next month, you'd be looking at ${formatCurrency(Number(firstRow.revenue || 0), cur)} in sales and ${formatCurrency(Number(firstRow.costs || 0), cur)} in total bills.`
    : "";

  return `${scenarioRule} Compared to your current state, ${revenueText}, ${costsText}, and ${profitText}. ${firstMonthLine} ${cashLine}`;
}

function CashOutlookChart({ rows, currency, monthLabel }) {
  if (rows.length < 2) return null;
  const values = rows.map(row => Number(row._cash));
  if (values.some(value => !Number.isFinite(value))) return null;
  const low = Math.min(...values), high = Math.max(...values);
  const y = value => 140 - ((value - low) / Math.max(high - low, 1)) * 120;
  const points = values.map((value, index) => `${12 + index * 576 / (values.length - 1)},${y(value)}`).join(" ");
  return <div className="mt-4 rounded-xl border border-indigo-100 bg-white p-4" data-cash-outlook>
    <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium text-slate-800">How your cash could change</span><span className="text-slate-500">{formatCurrency(low, currency)} – {formatCurrency(high, currency)}</span></div>
    <svg viewBox="0 0 600 160" className="mt-3 h-36 w-full" preserveAspectRatio="none" role="img" aria-label={`Projected cash from ${formatCurrency(values[0], currency)} to ${formatCurrency(values[values.length - 1], currency)}`}>
      <path d="M12 20H588 M12 80H588 M12 140H588" stroke="#e2e8f0" strokeDasharray="4 4" fill="none" />
      {low < 0 && high > 0 ? <path d={`M12 ${y(0)}H588`} stroke="#e11d48" strokeDasharray="5 5" /> : null}
      <polyline points={points} fill="none" stroke={low < 0 ? "#e11d48" : "#6366f1"} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="flex justify-between gap-3 text-xs text-slate-500"><span>{monthLabel(rows[0].month_index)}<br /><strong className="text-slate-700">{formatCurrency(values[0], currency)}</strong></span><span className="text-right">{monthLabel(rows[rows.length - 1].month_index)}<br /><strong className="text-slate-700">{formatCurrency(values[values.length - 1], currency)}</strong></span></div>
  </div>;
}

export function ScenarioOutput({
  activeRun,
  timeline,
  currency,
  decisionSaving,
  decisionNotice,
  onDecision,
  hideDecision,
  maxTimelineRows,
  showRisks = true,
  showRecommendations = true,
  hideTimelineAndMeaning = false,
  reportOutput = null,
}) {
  if (!activeRun) {
    return (
      <div className="flex flex-col items-center py-4 text-center">
        <div className="w-full max-w-xs overflow-hidden rounded-2xl bg-gradient-to-br from-brand-50 via-white to-indigo-50">
          <SimulationIllustration />
        </div>
        <p className="mt-4 text-sm text-slate-500">Run a scenario from the left panel to see results here.</p>
      </div>
    );
  }

  const base = activeRun.baseline_metrics || {};
  const scenario = activeRun.scenario_metrics || {};
  const deltas = activeRun.deltas || {};
  const runRisks = Array.isArray(activeRun.risk_signals) ? activeRun.risk_signals : [];
  const runRecs = Array.isArray(activeRun.recommendations) ? activeRun.recommendations : [];
  const scenarioMeaning = buildScenarioMeaning(activeRun, timeline, currency);

  const rawTimelineRows = maxTimelineRows ? timeline.slice(0, maxTimelineRows) : timeline;
  const isTrimmed = maxTimelineRows && timeline.length > maxTimelineRows;
  // Simulation audit F13 (16 Nov 2026): the table shows the server's projection exactly as calculated. It used to rebuild
  // cash and cumulative profit here from different inputs (this month's recorded actuals, a receivables figure the server
  // never sent), so the cash shown and the Status beside it came from two different calculations.
  const timelineRows = rawTimelineRows.map(timelineRowForDisplay);
  const verdict = activeRun?.scenario_metrics?.verdict || null;
  const assumptions = activeRun?.scenario_metrics?.projection?.assumptions || activeRun?.projection_summary?.assumptions || [];
  const projectionSummary = activeRun?.scenario_metrics?.projection || activeRun?.projection_summary || null;
  const weekly = projectionSummary?.thirteen_week || null;
  const uncertainty = activeRun?.scenario_metrics?.uncertainty || projectionSummary?.uncertainty || null;
  const side = isProjection(activeRun) ? "baseline" : "scenario";
  const range = rangeOf(uncertainty, side);
  function kpiValue(v, kind) {
    if (v == null) return kind === "months" ? "Not limited" : "—";
    if (kind === "pct") return `${Number(v).toFixed(1)}%`;
    if (kind === "money") return formatCurrency(v, currency);
    if (kind === "months") return `${Number(v).toFixed(1)} months`;
    if (kind === "days") return `${Number(v).toFixed(0)} days`;
    return `${Number(v).toFixed(1)}x`;
  }

  const runDate = activeRun.executed_at || activeRun.created_at || activeRun.updated_at;
  const parsedDate = runDate ? new Date(runDate) : new Date();
  const baseDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

  function formatMonthLabel(monthIndex) {
    return projectionMonthLabel(baseDate, monthIndex);
  }

  function formatMonthDetail(monthIndex) {
    if (!monthIndex) return "—";
    const d = new Date(baseDate);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() + Number(monthIndex));      // month 1 = the month after the run
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function describeScenarioRisk(risk) {
    const code = risk?.reason_code;
    const value = risk?.metric_value;
    if (code === "CLIENT_CONCENTRATION_HIGH") {
      return {
        title: "Client concentration risk",
        detail: value != null ? `Largest client share is about ${value}%.` : "Largest client share is high."
      };
    }
    if (code === "CAPACITY_OVERLOAD") {
      return {
        title: "Capacity overload",
        detail: value != null ? `Capacity utilisation is about ${value}%.` : "Capacity utilisation is high."
      };
    }
    if (code === "NEGATIVE_MARGIN") {
      return {
        title: "Negative margin",
        detail: `Monthly net profit is ${formatCurrency(value ?? 0, currency)}.`
      };
    }
    if (code === "LOW_RUNWAY") {
      return {
        title: "Low cash runway",
        detail: value != null ? `Runway is about ${value} months.` : "Runway is low."
      };
    }
    if (code === "OVERDUE_RECEIVABLES") {
      return {
        title: "Overdue receivables",
        detail: value != null ? `${value} receivable item(s) are outside payment terms.` : "Receivables are overdue."
      };
    }
    if (code === "PAYABLE_PRESSURE") {
      return {
        title: "Payables pressure",
        detail: value != null ? `${value} payable item(s) are overdue.` : "Payables are overdue."
      };
    }
    if (code === "RECEIVABLES_APPROACHING_DUE") {
      return {
        title: "Receivables approaching due date",
        detail: value != null ? `${value} receivable item(s) are close to payment-term expiry.` : "Some receivables are nearing their due date."
      };
    }
    if (code === "PAYABLES_APPROACHING_DUE") {
      return {
        title: "Payables approaching due date",
        detail: value != null ? `${value} payable item(s) are close to term expiry.` : "Some payables are nearing their due date."
      };
    }
    if (code === "HIGH_RECEIVABLE_EXPOSURE") {
      return {
        title: "Critical receivable exposure",
        detail: "Outstanding receivables exceed cash balance. High dependency on collections."
      };
    }
    if (code === "MODERATE_RECEIVABLE_EXPOSURE") {
      return {
        title: "Significant receivable exposure",
        detail: "Outstanding receivables exceed 50% of cash balance. Monitoring suggested."
      };
    }
    if (code === "CRITICAL_COLLECTION_RISK") {
      return {
        title: "Critical collection risk",
        detail: "Paper profits are accumulating but cash conversion is failing. Check billing terms."
      };
    }
    return {
      title: risk?.title || "Risk signal",
      detail: risk?.detail || `${risk?.risk_type || "Risk"} detected.`
    };
  }

  return (
    <div className="min-w-0 space-y-4 text-sm leading-relaxed">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <span className="font-semibold">AI output disclaimer: </span>
        Simulation results are modelled projections based on your inputs, not guarantees of future performance. Actual results may differ significantly. <a href="/legal/disclaimer" className="underline hover:text-amber-900">Learn more</a>.
      </div>

      {reportOutput ? (
        <ReportDownloadPanel
          output={reportOutput}
          currency={currency}
          reportTypes={["scenario_report"]}
          compact
        />
      ) : null}

      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-4 sm:p-6" data-results-overview>
        <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Your results at a glance</div>
        <div className="mt-1 text-xl font-semibold text-slate-900">{activeRun.scenario_name}</div>
        <p className="mt-2 text-sm text-slate-600">{isProjection(activeRun) ? "Where your business could be heading if things continue as they are." : "See how this change could affect your business."}</p>
        {timelineRows.length ? (
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              ["Cash at the end", formatCurrency(timelineRows[timelineRows.length - 1]._cash, currency), "Money available after payments"],
              ["Profit over the period", formatCurrency(timelineRows[timelineRows.length - 1]._cumGross, currency), "Running profit after costs"],
              ["Months needing attention", String(atRisk(timeline).length), "Months marked at risk"],
            ].map(([label, value, hint]) => <div key={label} className="min-w-0 rounded-xl border border-slate-100 bg-white p-4"><div className="text-sm text-slate-600">{label}</div><div className="mt-2 break-words text-2xl font-semibold tracking-tight text-slate-900">{value}</div><div className="mt-1 text-xs text-slate-500">{hint}</div></div>)}
          </div>
        ) : null}
        {!hideTimelineAndMeaning ? <CashOutlookChart rows={timelineRows} currency={currency} monthLabel={formatMonthLabel} /> : null}
        {!hideTimelineAndMeaning ? <div className="mt-4 rounded-xl bg-white/80 p-4 text-sm leading-6 text-slate-700"><div className="mb-1 font-semibold text-slate-900">What this means for you</div><p>{scenarioMeaning.split(". ")[0]}.</p><details className="mt-2"><summary className="cursor-pointer font-medium text-indigo-700">Read the full explanation</summary><p className="mt-2">{scenarioMeaning}</p></details></div> : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="text-base font-semibold text-slate-900">How much can you rely on this?</div>
        {activeRun.state_result && !isProjection(activeRun) ? (
          <div data-verdict={verdict?.outcome || activeRun.state_result} className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${activeRun.state_result === "improved" ? "bg-emerald-100 text-emerald-700" :
            activeRun.state_result === "worse" ? "bg-rose-100 text-rose-700" :
              "bg-slate-100 text-slate-600"
            }`}>
            {verdictLabel(activeRun)}
          </div>
        ) : null}
        {verdict ? (
          <details className="mt-3 text-sm leading-6 text-slate-600" data-verdict-basis><summary className="cursor-pointer py-2 font-medium text-slate-800">Why this result?</summary>
            {verdict.reason}{" "}
            Cash at the end of month {verdict.months}: {formatCurrency(verdict.scenario_closing_cash, currency)} against{" "}
            {formatCurrency(verdict.baseline_closing_cash, currency)} if nothing changes. Profit over the period:{" "}
            {formatCurrency(verdict.scenario_cumulative_profit, currency)} against {formatCurrency(verdict.baseline_cumulative_profit, currency)}.
            {" "}Changes under {formatCurrency(verdict.materiality_threshold, currency)} (1% of revenue over the period) are treated as no material change.
            {verdict.net_cash_change != null && Math.abs(Number(verdict.net_cash_change) - Number(verdict.closing_cash_change)) >= 0.01 ? (
              <> {" "}After loans, tax and VAT still owed, cash is {Number(verdict.net_cash_change) >= 0 ? "higher" : "lower"} by {formatCurrency(Math.abs(Number(verdict.net_cash_change)), currency)}; that is what the verdict compares.</>
            ) : null}
          </details>
        ) : null}
        {projectionSummary?.checks ? (
          <div className="mt-1 text-xs text-slate-500" data-projection-checks>{projectionChecksText(projectionSummary)}</div>
        ) : null}
        {projectionSummary?.data_quality ? (
          <details className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-sm text-slate-600" data-data-quality>
            <summary className="cursor-pointer font-semibold text-slate-800">Check your records · {projectionSummary.data_quality.issues?.length || 0} {projectionSummary.data_quality.issues?.length === 1 ? "thing" : "things"} to know</summary>
            <p className="mt-2">Data check: {projectionSummary.data_quality.summary}</p>
            {(projectionSummary.data_quality.issues || []).map((i) => (
              <div key={i.code} className="mt-3 rounded-lg bg-white p-3 leading-6">
                <span className={`mr-1 rounded px-1 font-semibold ${i.severity === "serious" ? "bg-rose-100 text-rose-700" : i.severity === "warning" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-600"}`}>{i.severity === "serious" ? "Needs attention" : i.severity === "warning" ? "Worth checking" : "Good to know"}</span>
                {i.what} {i.why} <span className="text-slate-500">To fix: {i.fix}</span>
              </div>
            ))}
          </details>
        ) : null}
        {assumptions.length ? (
          <details className="mt-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-600" data-assumptions>
            <summary className="cursor-pointer font-semibold text-slate-500">Assumptions used ({assumptions.length})</summary>
            <ul className="mt-3 list-disc space-y-3 pl-5 leading-6">
              {assumptions.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </details>
        ) : null}
        {uncertainty ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600" data-uncertainty>
            <div className="font-semibold text-slate-700">How sure is this?</div>
            <div className="mt-1" data-confidence={uncertainty.confidence?.level}>{confidenceText(uncertainty)}</div>
            {range ? (
              <div className="mt-4" data-range>
                <div className="font-medium text-slate-800">Possible cash at the end</div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {[["Lower estimate", range.low], ["Central estimate", range.base], ["Higher estimate", range.high]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className="break-words text-lg font-semibold text-slate-900">{formatCurrency(value, currency)}</div></div>)}
                </div>
                <p className="mt-2 text-xs leading-5">{uncertainty.ranges?.note}</p>
              </div>
            ) : null}
            {uncertainty.ranges?.robustness ? (
              <div className={`mt-1 ${uncertainty.ranges.robust ? "" : "font-semibold text-amber-700"}`} data-robustness>{uncertainty.ranges.robustness}</div>
            ) : null}
            {uncertainty.sensitivity?.length ? (
              <div className="mt-1" data-sensitivity>
                What moves the result most:{" "}
                {uncertainty.sensitivity.slice(0, 3).map((d) => `${d.driver} (${formatCurrency(d.swing, currency)} swing)`).join(", ")}.
              </div>
            ) : null}
            {uncertainty.inputs?.length ? (
              <details className="mt-2">
                <summary className="cursor-pointer font-semibold text-slate-500">Where each figure came from ({uncertainty.inputs.length})</summary>
                <div className="mt-2 max-w-full overflow-x-auto"><table className="min-w-full text-left">
                  <tbody>
                    {uncertainty.inputs.map((i) => (
                      <tr key={i.input} className="border-t border-slate-100">
                        <td className="py-1 pr-3">{i.input}</td>
                        <td className="py-1 pr-3">{i.value == null || i.value === "" ? "—" : typeof i.value === "number" ? Number(i.value).toLocaleString() : String(i.value)}</td>
                        <td className="py-1 pr-3 font-semibold" data-input-label={i.label}>{i.label}</td>
                        <td className="py-1 text-slate-500">{i.source || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </details>
            ) : null}
            {uncertainty.kpis?.[side] ? (
              <details className="mt-2" data-kpis>
                <summary className="cursor-pointer font-semibold text-slate-500">Key measures at the end of the period</summary>
                <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {KPI_LABELS.map(([key, label, kind]) => (
                    <div key={key} title={uncertainty.kpis[side].definitions?.[key] || ""}>
                      {label}: <span className="font-semibold text-slate-800">{kpiValue(uncertainty.kpis[side][key], kind)}</span>
                      {side === "scenario" && uncertainty.kpis.baseline ? (
                        <span className="text-slate-400"> (now {kpiValue(uncertainty.kpis.baseline[key], kind)})</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
        {weekly?.weeks?.length ? (
          <details className="mt-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-600" data-thirteen-week>
            <summary className="cursor-pointer font-semibold text-slate-500">
              Next 13 weeks of cash · lowest {formatCurrency(weekly.lowest_cash, currency)} in week {weekly.lowest_week}
            </summary>
            <div className="mt-1 text-slate-500">{weekly.note}</div>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-left">
                <thead>
                  <tr className="text-slate-500">
                    <th className="py-1 pr-3 font-semibold">Week from</th>
                    <th className="py-1 pr-3 font-semibold">Money in</th>
                    <th className="py-1 pr-3 font-semibold">Money out</th>
                    <th className="py-1 font-semibold">Cash at end</th>
                  </tr>
                </thead>
                <tbody>
                  {weekly.weeks.map((w) => (
                    <tr key={w.week} className="border-t border-slate-100">
                      <td className="py-1 pr-3">{shortDate(w.start)}</td>
                      <td className="py-1 pr-3">{formatCurrency(w.cash_in, currency)}</td>
                      <td className="py-1 pr-3">{formatCurrency(w.cash_out, currency)}</td>
                      <td className={`py-1 ${w.closing_cash < 0 ? "font-semibold text-rose-700" : ""}`}>{formatCurrency(w.closing_cash, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </div>

      {(showRisks && runRisks.length) || (showRecommendations && runRecs.length) ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {showRisks && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>Risk alerts</span>
                <InfoTip text="Risks detected from the scenario output snapshot." />
              </div>
              <div className="mt-3 space-y-2">
                {runRisks.length ? (
                  runRisks.map((r) => (
                    <div key={r.risk_signal_id || r.reason_code} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {describeScenarioRisk(r).title}
                      </div>
                      <div className="mt-1 text-sm text-slate-700">{describeScenarioRisk(r).detail}</div>
                      {r?.severity ? <div className="mt-1 text-xs text-slate-500">Severity: {r.severity}</div> : null}
                    </div>
                  ))
                ) : atRisk(timeline).length ? (
                  <div className="text-sm text-amber-800" data-at-risk-months>
                    {atRisk(timeline).length === 1 ? "1 month" : `${atRisk(timeline).length} months`} of this projection {atRisk(timeline).length === 1 ? "is" : "are"} at risk:
                    {" "}month {atRisk(timeline).join(", ")}. Look at the cash line for those months.
                  </div>
                ) : (
                  <div className="text-sm text-slate-600">No risks detected for this scenario.</div>
                )}
              </div>
            </div>
          )}

          {showRecommendations && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>Recommendations</span>
                <InfoTip text="Recommended actions based on the scenario outcome." />
              </div>
              <div className="mt-3 space-y-2">
                {runRecs.length ? (
                  runRecs.map((rec) => (
                    <div
                      key={rec.recommendation_id || rec.title || rec.action_type}
                      className="rounded-xl border border-slate-200 bg-white p-3"
                    >
                      <div className="text-sm font-semibold text-slate-900">{rec.title || "Recommendation"}</div>
                      {rec.description ? <div className="mt-1 text-xs text-slate-600">{rec.description}</div> : null}
                      {rec.scenario_template_id ? (
                        <div className="mt-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              const url = `/simulation?template=${rec.scenario_template_id}`;
                              window.location.href = url;
                            }}
                          >
                            Run recommended scenario
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-600">No recommendations generated.</div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {Object.keys(base).length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <MetricCard
            title="Current trend"
            metrics={base}
            currency={currency}
            info="Your current metrics without any change."
          />
          <MetricCard
            title="With your change"
            metrics={scenario}
            currency={currency}
            info="Projected metrics after applying the scenario."
          />
          <MetricCard
            title="Difference"
            metrics={deltas}
            currency={currency}
            isDelta
            info="Difference between scenario and baseline."
          />
        </div>
      ) : null}

      {timeline?.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div><div className="text-base font-semibold text-slate-900">Is your profit turning into cash?</div><p className="mt-1 text-sm text-slate-500">A closer look at the final month.</p></div>
            <InfoTip text="Measures the gap between paper profit and actual cash. Receivable Exposure > 1 or Cash Conversion < 0.3 indicates high risk." />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(() => {
              const last = timeline[timeline.length - 1];
              return (
                <>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Cash compared with profit</div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className={`text-lg font-bold ${typeof last?.cash_conversion_ratio === "number" && last.cash_conversion_ratio < 0.3 ? "text-rose-600" : "text-slate-900"}`} data-ratio="cash_conversion">
                        {ratioText(last?.cash_conversion_ratio, last?.cash_conversion_state)}
                      </span>
                      <span className="text-xs text-slate-500">Ratio</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">Below 0.3 can mean profit is not reaching your bank account.</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Money customers still owe</div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className={`text-lg font-bold ${last?.receivable_exposure_state === "unbounded" || (last?.receivable_exposure_ratio ?? 0) >= 1.0 ? "text-rose-600" : (last?.receivable_exposure_ratio ?? 0) >= 0.5 ? "text-amber-600" : "text-slate-900"}`} data-ratio="receivable_exposure">
                        {ratioText(last?.receivable_exposure_ratio, last?.receivable_exposure_state)}
                      </span>
                      <span className="text-xs text-slate-500">Ratio</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">At 1 or above, customers owe more than your available cash.</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Profit waiting to be paid</div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-lg font-bold text-slate-900" data-ratio="delayed_revenue">
                        {typeof last?.delayed_revenue_pct === "number" ? `${(last.delayed_revenue_pct * 100).toFixed(1)}%` : ratioText(null, last?.delayed_revenue_state)}
                      </span>
                      <span className="text-xs text-slate-500">of Profit</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">The share of profit still tied up in unpaid sales.</p>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {!hideTimelineAndMeaning && timeline?.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 pt-4 pb-3">
            <div className="text-base font-semibold text-slate-900">Your month-by-month outlook</div><p className="mt-1 text-sm text-slate-500">Follow your sales, costs and available cash over time.</p>
            {isTrimmed ? <div className="mt-1 text-xs text-slate-500">Showing first {maxTimelineRows} months.</div> : null}
            {projectionSummary?.current_month ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700" data-current-month>
                <div className="font-semibold text-slate-800">This month ({projectionSummary.current_month.label})</div>
                <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-3">
                  <div><span className="text-slate-500">Recorded so far: </span>revenue {formatCurrency(projectionSummary.current_month.recorded_so_far.revenue, currency)} · costs {formatCurrency(projectionSummary.current_month.recorded_so_far.costs, currency)}</div>
                  <div><span className="text-slate-500">Rest of month ({projectionSummary.current_month.rest_of_month.days} days): </span>revenue {formatCurrency(projectionSummary.current_month.rest_of_month.revenue, currency)} · costs {formatCurrency(projectionSummary.current_month.rest_of_month.costs, currency)}</div>
                  <div><span className="text-slate-500">Month total: </span>revenue {formatCurrency(projectionSummary.current_month.month_total.revenue, currency)} · profit {formatCurrency(projectionSummary.current_month.month_total.profit, currency)}</div>
                </div>
                <div className="mt-1"><span className="text-slate-500">Cash: </span>{formatCurrency(projectionSummary.current_month.cash_today, currency)} today → {formatCurrency(projectionSummary.current_month.cash_at_month_end, currency)} at the end of the month</div>
                <div className="mt-1 text-slate-500">{projectionSummary.current_month.recorded_so_far.source}. {projectionSummary.current_month.explanation}</div>
              </div>
            ) : null}
          </div>
          <p className="px-4 pb-3 text-xs text-slate-500 sm:hidden">Swipe across the table to see every figure.</p>
          <div className="max-w-full overflow-x-auto border-t border-slate-100" role="region" aria-label="Detailed monthly forecast" tabIndex={0}>
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-3 py-3 text-left font-semibold whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span>Month</span>
                      <InfoTip text="The specific month being projected." />
                    </div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Revenue</span>
                      <InfoTip text="Expected earnings from sales made this month (on paper)." />
                    </div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Receivables</span>
                      <InfoTip text="Outstanding payments owed to you by customers." />
                    </div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Expenses</span>
                      <InfoTip text="Fixed monthly costs like utilities, rent, and software." />
                    </div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Cost of sales</span>
                      <InfoTip text="Direct costs to deliver your products or services." />
                    </div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Total costs</span>
                      <InfoTip text="Sum of all your monthly bills (Expenses + Cost of sales)." />
                    </div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Gross Profit</span>
                      <InfoTip text="Sales income minus the direct cost to deliver it." />
                    </div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Gross Margin %</span>
                      <InfoTip text="Percentage of sales income kept after direct costs." />
                    </div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Cum. Profit</span>
                      <InfoTip text="Running total of profit after all costs since month 1. It goes down in a month that loses money." />
                    </div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Cash balance</span>
                      <InfoTip text="Actual money in your bank account — paid revenue in, paid costs out." />
                    </div>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span>Status</span>
                      <InfoTip text="How many months of costs your cash covers, and whether the month makes money: Stable, Tight, Under stress, At risk or Overdrawn. Hover a status for what it means." />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {projectionSummary?.current_month ? (
                  <tr className="border-t border-slate-100 bg-slate-50/70" data-current-month-row
                    title={`Recorded so far ${formatCurrency(projectionSummary.current_month.recorded_so_far.revenue, currency)} + rest of the month ${formatCurrency(projectionSummary.current_month.rest_of_month.revenue, currency)}`}>
                    <td className="sticky left-0 z-10 bg-slate-50 px-3 py-3 font-semibold text-slate-700 whitespace-nowrap">{projectionSummary.current_month.label} <span className="ml-1 rounded-full bg-indigo-100 px-2 py-1 text-[11px] text-indigo-700">Current month</span><div className="mt-1 text-[11px] font-normal text-slate-500">Recorded so far + rest of month</div></td>
                    <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{formatCurrency(projectionSummary.current_month.month_total.revenue, currency)}</td>
                    <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">—</td>
                    <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">—</td>
                    <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">—</td>
                    <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{formatCurrency(projectionSummary.current_month.month_total.costs, currency)}</td>
                    <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">—</td>
                    <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">—</td>
                    <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{formatCurrency(projectionSummary.current_month.month_total.profit, currency)}</td>
                    <td className="px-3 py-2 text-right font-semibold whitespace-nowrap text-slate-700">{formatCurrency(projectionSummary.current_month.cash_at_month_end, currency)}</td>
                    <td className="px-3 py-2 text-left text-slate-500 whitespace-nowrap">This month</td>
                  </tr>
                ) : null}
                {timelineRows.map((row) => {
                  return (
                    <tr key={row.month_index} className="border-t border-slate-100 hover:bg-slate-50/50">
                      <td className="sticky left-0 z-10 bg-white px-3 py-3 font-semibold text-slate-700 whitespace-nowrap">{formatMonthLabel(row.month_index)}</td>
                      <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{formatCurrency(row.revenue, currency)}</td>
                      <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{formatCurrency(row.accruals, currency)}</td>
                      <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{formatCurrency(row.expenses, currency)}</td>
                      <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{formatCurrency(row.cost_of_sales, currency)}</td>
                      <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{formatCurrency(row.costs, currency)}</td>
                      <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{formatCurrency(row.gross_profit, currency)}</td>
                      <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{row.gross_margin_pct != null ? `${row.gross_margin_pct}%` : "—"}</td>
                      <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{formatCurrency(row._cumGross, currency)}</td>
                      <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${row._cash > 0 ? "text-emerald-600" : row._cash < 0 ? "text-rose-600" : "text-slate-700"}`}>{formatCurrency(row._cash, currency)}</td>
                      <td className="px-3 py-2 text-left text-slate-500 whitespace-nowrap">
                        {row.state_label ? (
                          <span title={statusOf(row.state_label)[1]} data-status={String(row.state_label).toLowerCase()} className={`cursor-help rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${String(row.state_label).toLowerCase().includes("stable") ? "bg-emerald-50 text-emerald-700" :
                            String(row.state_label).toLowerCase().includes("risk") || String(row.state_label).toLowerCase().includes("stress") || String(row.state_label).toLowerCase().includes("critical") ? "bg-rose-50 text-rose-700" :
                              "bg-slate-100 text-slate-600"
                            }`}>
                            {statusOf(row.state_label)[0]}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!hideTimelineAndMeaning && projectionSummary?.how_calculated ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700" data-how-calculated>
          <details>
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">How this was calculated</summary>
            <div className="mt-2 font-semibold text-slate-700">Starting point</div>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {projectionSummary.how_calculated.starting_point.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
            <div className="mt-3 font-semibold text-slate-700">Month by month</div>
            <div className="mt-1 space-y-2">
              {projectionSummary.how_calculated.months.map((m) => (
                <div key={m.month_index} className="rounded-lg bg-slate-50 p-2">
                  <div className="font-semibold">{m.label || `Month ${m.month_index}`}</div>
                  <div><span className="text-slate-500">Revenue: </span>{m.revenue}</div>
                  <div><span className="text-slate-500">Costs: </span>{m.costs}</div>
                  <div><span className="text-slate-500">Cash: </span>{m.cash}</div>
                </div>
              ))}
            </div>
          </details>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">Methods and standards</summary>
            <div className="mt-2 space-y-2">
              {projectionSummary.how_calculated.methods.map((m) => (
                <div key={m.name}>
                  <div className="font-semibold">{m.name}</div>
                  <div>{m.what}</div>
                  <div className="text-slate-500">Standard: {m.standard}</div>
                </div>
              ))}
            </div>
          </details>
        </div>
      ) : null}



      {!hideDecision ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={decisionSaving} onClick={() => onDecision("accepted")}>
            Accept
          </Button>
          <Button variant="danger" disabled={decisionSaving} onClick={() => onDecision("rejected")}>
            Reject
          </Button>
          <Button variant="ghost" disabled={decisionSaving} onClick={() => onDecision("deferred")}>
            Defer
          </Button>
          {decisionNotice ? <span className="text-xs text-slate-600">{decisionNotice}</span> : null}
        </div>
      ) : null}

      {/* confirmDialog is rendered in the parent SimulationPage (to keep state in scope) */}
    </div>
  );
}

function MetricCard({ title, metrics, currency, isDelta, info }) {
  const rows = [
    ["Monthly revenue", metrics.monthly_revenue],
    ["Monthly expenses", metrics.monthly_expenses],
    ["Cost of sales", metrics.monthly_cost_of_sales],
    ["Total costs", metrics.monthly_costs],
    // The table's definition (the owner, 25 Oct): sales less the direct cost to deliver them; after every cost is Net profit
    ["Gross Profit", metrics.monthly_revenue != null && metrics.monthly_cost_of_sales != null ? Number((metrics.monthly_revenue - metrics.monthly_cost_of_sales).toFixed(2)) : null],
    ["Net profit", metrics.net_profit],
  ].filter(([, v]) => v != null);

  function renderValue(label, value) {
    if (label.includes("score")) return formatNumber(value);
    if (!isDelta) return formatCurrency(value, currency);
    if (typeof value !== "number") return "—";
    const sign = value > 0 ? "+" : "";
    return `${sign}${formatCurrency(value, currency)}`;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span>{title}</span>
        {info ? <InfoTip text={info} /> : null}
      </div>
      <div className="mt-3 space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <div className="text-slate-600">{label}</div>
            <div className={`font-semibold ${isDelta && typeof value === "number" && value > 0 ? "text-emerald-700" : isDelta && typeof value === "number" && value < 0 ? "text-rose-700" : "text-slate-900"}`}>
              {renderValue(label, value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function isProjection(run) {
  if (!run) return false;
  return run.scenario_type === "do_nothing_projection" || String(run.scenario_run_id || "").startsWith("proj_");
}





