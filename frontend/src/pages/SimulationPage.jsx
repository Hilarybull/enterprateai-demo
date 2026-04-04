import { useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import WorkspacePrompt from "../components/WorkspacePrompt";
import Spinner from "../components/Spinner";
import NumberInput, { parseNumber } from "../components/NumberInput";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import { useAuthStore } from "../store/auth";
import { formatCurrency, formatNumber } from "../lib/format";
import InfoTip from "../components/InfoTip";

const FieldLabel = ({ children, info }) => (
  <div className="ea-label flex items-center gap-2">
    <span>{children}</span>
    {info ? <InfoTip text={info} /> : null}
  </div>
);

export default function SimulationPage() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const ideaValidation = useWorkspaceStore((s) => s.ideaValidation);
  const decisionStatus = useWorkspaceStore((s) => s.decisionStatus);
  const validation = useWorkspaceStore((s) => s.validation);
  const inputs = useWorkspaceStore((s) => s.inputs);
  const currency = useWorkspaceStore((s) => s.currency);
  const email = useAuthStore((s) => s.email);

  const tenantId = email || "ten_default";
  const businessId = workspaceId || "biz_unknown";
  const [registrationStatus, setRegistrationStatus] = useState({ status: "not_started" });
  const isRegistered = registrationStatus?.status === "registered";
  const stateVersion = isRegistered ? validation?.rubric_version || "state_v1.0" : "state_v1.0";

  const [catalogueData, setCatalogueData] = useState({ products: [], customers: [], vendors: [] });
  const [financialsData, setFinancialsData] = useState({ invoices: [], expenses: [], contracts: [] });

  const acceptedIdeaValidation = decisionStatus === "accepted" ? ideaValidation : null;

  const stateSnapshot = useMemo(() => {
    const metrics = isRegistered ? validation?.metrics || {} : {};
    const customers = Array.isArray(catalogueData?.customers)
      ? catalogueData.customers.filter((c) => !c.archived)
      : [];
    const invoices = Array.isArray(financialsData?.invoices)
      ? financialsData.invoices.filter((i) => !i.archived)
      : [];
    const expenses = Array.isArray(financialsData?.expenses)
      ? financialsData.expenses.filter((e) => !e.archived)
      : [];
    const contracts = Array.isArray(financialsData?.contracts)
      ? financialsData.contracts.filter((c) => !c.archived)
      : [];

    const paidInvoices = invoices.filter((i) => i.status === "paid");
    const paidExpenses = expenses.filter((e) => e.status === "paid");
    const signedContracts = contracts.filter((c) => c.status === "signed");
    const salesContracts = signedContracts.filter((c) => c.contract_type !== "purchase");
    const purchaseContracts = signedContracts.filter((c) => c.contract_type === "purchase");

    const revenueFromInvoices = paidInvoices.reduce((sum, i) => sum + Number(i.total_amount || 0), 0);
    const costsFromExpenses = paidExpenses.reduce((sum, e) => sum + Number(e.price || 0), 0);
    const contractRevenue = salesContracts.reduce((sum, c) => sum + Number(c.price || 0), 0);
    const contractCosts = purchaseContracts.reduce((sum, c) => sum + Number(c.price || 0), 0);

    const revenueMonthly =
      paidInvoices.length || contractRevenue > 0
        ? revenueFromInvoices + contractRevenue
        : Number(metrics.revenue_monthly || 0);
    const costsMonthly =
      paidExpenses.length || contractCosts > 0
        ? costsFromExpenses + contractCosts
        : Number(metrics.costs_monthly || 0);

    const customerTotals = paidInvoices.reduce((acc, i) => {
      const key = i.customer_id || "unknown";
      acc[key] = (acc[key] || 0) + Number(i.total_amount || 0);
      return acc;
    }, {});
    salesContracts.forEach((c) => {
      const key = c.counterparty_id || "contract";
      customerTotals[key] = (customerTotals[key] || 0) + Number(c.price || 0);
    });
    const maxCustomer = Object.values(customerTotals).reduce((max, val) => Math.max(max, Number(val || 0)), 0);
    const topClientShare =
      (paidInvoices.length || salesContracts.length) && revenueMonthly > 0
        ? Math.min(100, Math.round((maxCustomer / revenueMonthly) * 100))
        : isRegistered ? acceptedIdeaValidation?.concentration?.top_client_share_pct ?? null : null;

    const termValues = customers
      .map((c) => Number(c.payment_terms))
      .filter((n) => Number.isFinite(n) && n > 0);
    const paymentTerms =
      termValues.length > 0
        ? Math.round(termValues.reduce((a, b) => a + b, 0) / termValues.length)
        : isRegistered ? metrics.payment_terms_days ?? null : null;

    const customerIds = new Set([
      ...customers.map((c) => c.id).filter(Boolean),
      ...paidInvoices.map((i) => i.customer_id).filter(Boolean),
      ...salesContracts.map((c) => c.counterparty_id).filter(Boolean)
    ]);
    const clientsCount =
      customerIds.size > 0
        ? customerIds.size
        : isRegistered
          ? acceptedIdeaValidation?.concentration?.clients_count ?? null
          : null;

    return {
      revenue_monthly: Math.max(0, Number(revenueMonthly || 0)),
      costs_monthly: Math.max(0, Number(costsMonthly || 0)),
      starting_cash: Number(inputs?.starting_cash || 0),
      top_client_share_pct: topClientShare,
      capacity_utilisation_pct: isRegistered ? metrics.capacity?.utilization ?? null : null,
      payment_terms_days: paymentTerms,
      sales_cycle_days: isRegistered ? metrics.sales_cycle_days ?? null : null,
      clients_count: clientsCount
    };
  }, [acceptedIdeaValidation, inputs, validation, catalogueData, financialsData, isRegistered]);

  const largestClient = useMemo(() => {
    const customers = Array.isArray(catalogueData?.customers)
      ? catalogueData.customers.filter((c) => !c.archived)
      : [];
    const invoices = Array.isArray(financialsData?.invoices)
      ? financialsData.invoices.filter((i) => !i.archived)
      : [];
    const contracts = Array.isArray(financialsData?.contracts)
      ? financialsData.contracts.filter((c) => !c.archived && c.status === "signed" && c.contract_type !== "purchase")
      : [];
    const paidInvoices = invoices.filter((i) => i.status === "paid");
    const totals = paidInvoices.reduce((acc, i) => {
      const key = i.customer_id || "unknown";
      acc[key] = (acc[key] || 0) + Number(i.total_amount || 0);
      return acc;
    }, {});
    contracts.forEach((c) => {
      const key = c.counterparty_id || "contract";
      totals[key] = (totals[key] || 0) + Number(c.price || 0);
    });
    const entries = Object.entries(totals);
    if (!entries.length) return null;
    const [topId, topValue] = entries.sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    const customer = customers.find((c) => c.id === topId);
    const name = customer?.name || "Largest client";
    const share =
      stateSnapshot?.revenue_monthly && stateSnapshot.revenue_monthly > 0
        ? Math.min(100, Math.round((Number(topValue) / stateSnapshot.revenue_monthly) * 100))
        : null;
    return { id: topId, name, share };
  }, [catalogueData, financialsData, stateSnapshot]);

  const [tab, setTab] = useState("adaptive"); // dashboard | manual
  const [templates, setTemplates] = useState([]);
  const [riskSignals, setRiskSignals] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [history, setHistory] = useState([]);

  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [autoProjectionLoading, setAutoProjectionLoading] = useState(false);
  const [scenarioRunningId, setScenarioRunningId] = useState(null);
  const [error, setError] = useState(null);

  const [manualTemplateId, setManualTemplateId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualParams, setManualParams] = useState({});
  const [manualTimelineMonths, setManualTimelineMonths] = useState("6");

  const [activeRun, setActiveRun] = useState(null);
  const [activeRunKind, setActiveRunKind] = useState(null); // "scenario" | "projection"
  const [timeline, setTimeline] = useState([]);
  const [projectionRun, setProjectionRun] = useState(null);
  const [projectionTimeline, setProjectionTimeline] = useState([]);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState(null);
  const [autoProjectionDone, setAutoProjectionDone] = useState(false);
  const [autoSignalsDone, setAutoSignalsDone] = useState(false);
  const lastSnapshotHashRef = useRef("");

  const canRun = Boolean(workspaceId);

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
    let intervalId;
    async function loadWorkspaceData() {
      if (!workspaceId) return;
      try {
        const ws = await apiRequest("/validation/me", "GET");
        if (!alive || !ws) return;
        setCatalogueData(ws?.data?.catalogue || { products: [], customers: [], vendors: [] });
        setFinancialsData(ws?.data?.financials || { invoices: [], expenses: [], contracts: [] });
        setRegistrationStatus(ws?.data?.registration_status || { status: "not_started" });
      } catch {
        // ignore
      }
    }
    loadWorkspaceData();
    intervalId = window.setInterval(loadWorkspaceData, 30000);
    return () => {
      alive = false;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [workspaceId]);

  useEffect(() => {
    setAutoProjectionDone(false);
    setAutoSignalsDone(false);
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
      const riskRes = await apiRequest("/v1/scenario-intelligence/risk-detection/run", "POST", {
        tenant_id: tenantId,
        business_id: businessId,
        state_version: stateVersion,
        state: stateSnapshot
      });
      const risks = riskRes?.risk_signals || [];
      setRiskSignals(risks);
      const recRes = await apiRequest("/v1/scenario-intelligence/recommendations/generate", "POST", {
        tenant_id: tenantId,
        business_id: businessId,
        state_version: stateVersion,
        risk_signal_ids: risks.map((r) => r.risk_signal_id),
        state: stateSnapshot
      });
      setRecommendations(recRes?.recommended_scenarios || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load recommendations.");
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
        scenario_template_id: templateId,
        scenario_mode: mode,
        scenario_name: nameOverride || template?.title || "Scenario run",
        parameters: {
          timeline_months: 6,
          ...(params || {})
        },
        state: stateSnapshot
      };
      const runRes = await apiRequest("/v1/scenario-intelligence/scenario-runs", "POST", payload);
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
      setError(e instanceof Error ? e.message : "Scenario run failed.");
    } finally {
      setActionLoading(false);
      setScenarioRunningId(null);
    }
  }

  async function runDoNothing(monthsOverride, setAsActive = false, silent = false) {
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
        timeline_months: parseNumber(monthsOverride ?? manualTimelineMonths, 6),
        state: stateSnapshot
      });
      const projectionPayload = {
        scenario_run_id: res?.projection_id,
        scenario_name: "Baseline Continuity Projection",
        scenario_type: "do_nothing_projection",
        baseline_metrics: {},
        scenario_metrics: {},
        deltas: {},
        state_result: "neutral",
        timeline_summary: {}
      };
      setProjectionRun(projectionPayload);
      setProjectionTimeline(res?.forecast || []);
      if (setAsActive) {
        setActiveRun(projectionPayload);
        setActiveRunKind("projection");
        setTimeline(res?.forecast || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Projection failed.");
    } finally {
      if (silent) {
        setAutoProjectionLoading(false);
      } else {
        setActionLoading(false);
      }
    }
  }

  const snapshotHash = useMemo(() => JSON.stringify(stateSnapshot || {}), [stateSnapshot]);

  useEffect(() => {
    if (!canRun || tab !== "adaptive") return;
    if (loading) return;
    if (snapshotHash === lastSnapshotHashRef.current && autoProjectionDone) return;
    lastSnapshotHashRef.current = snapshotHash;
    runDoNothing(6, false, true);
    setAutoProjectionDone(true);
  }, [tab, canRun, autoProjectionDone, loading, snapshotHash]);

  useEffect(() => {
    if (!canRun || tab !== "adaptive" || autoSignalsDone) return;
    if (loading) return;
    loadSignals();
    setAutoSignalsDone(true);
  }, [tab, canRun, autoSignalsDone, loading]);

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

  async function clearHistory() {
    if (!canRun) return;
    const ok = window.confirm("Clear scenario history for this workspace?");
    if (!ok) return;
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
      const clientLabel = largestClient?.name || "Highest Client";
      setManualName(`Loss of ${clientLabel}`);
    } else {
      setManualName(titleOverride || template.title);
    }
    setManualParams(buildDefaultParams(template, stateSnapshot, largestClient));
    setTab("manual");
  }

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
        detail: `Your monthly profit is currently ${formatCurrency(value ?? 0, currency)}.`
      };
    }
    if (code === "LOW_RUNWAY") {
      return {
        title: "Low cash runway",
        detail: `Cash runway is about ${value ?? "—"} months.`
      };
    }
    return {
      title: "Risk signal",
      detail: `${risk?.risk_type || "Risk"} detected.`
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
    return "Run this scenario to see the impact.";
  }

  useEffect(() => {
    if (manualTemplateId === "do_nothing_projection") {
      setManualParams({});
      setManualName("Baseline Continuity Projection");
      return;
    }
    if (!manualTemplate) return;
    const params = buildDefaultParams(manualTemplate, stateSnapshot, largestClient);
    setManualParams(params);
    if (manualTemplate.scenario_type === "client_loss") {
      const clientLabel = largestClient?.name || "Highest Client";
      setManualName(`Loss of ${clientLabel}`);
    } else {
      setManualName(manualTemplate.title);
    }
  }, [manualTemplateId, manualTemplate, stateSnapshot, largestClient]);

  useEffect(() => {
    if (manualTemplate?.scenario_type !== "client_loss") return;
    if (largestClient?.share == null) return;
    setManualParams((prev) => ({ ...prev, client_loss_pct: largestClient.share }));
  }, [manualTemplate, largestClient?.share]);

  return (
    <div>
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

      {error ? (
        <div className="mt-4">
          <InlineAlert kind="error" message={error} />
        </div>
      ) : null}

      {workspaceId ? (
        <div className="mt-6 flex justify-end">
          <Button onClick={() => setTab(tab === "manual" ? "adaptive" : "manual")}>
            {tab === "manual" ? "Back to simulation dashboard" : "Run a scenario"}
          </Button>
        </div>
      ) : null}

      {workspaceId && tab === "adaptive" ? (
        <div className="mt-4 space-y-4">
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
            />
          </SectionCard>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
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
                  riskSignals.map((r) => (
                    <div key={r.risk_signal_id} className="rounded-xl border border-slate-200 bg-white p-3">
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
                  recommendations.map((rec) => (
                    <div key={rec.scenario_template_id} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="text-sm font-semibold text-slate-900">{rec.title}</div>
                      <div className="text-xs text-slate-500">{scenarioCaption(rec)}</div>
                      <div className="mt-2">
                        <Button
                          size="sm"
                          onClick={() => openManualScenario(rec.scenario_template_id, rec.title)}
                          disabled={actionLoading || !canRun}
                        >
                          {actionLoading && scenarioRunningId === rec.scenario_template_id ? <Spinner size={14} /> : null}
                          Run scenario
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-600">No recommendations yet.</div>
                )}
              </div>
            </SectionCard>

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
                history.slice(0, 2).map((h) => (
                    <div
                      key={h.scenario_run_id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3"
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{h.scenario_name}</div>
                        <div className="text-xs text-slate-500">{h.scenario_type}</div>
                      </div>
                      <div className="text-xs text-slate-500">{h.executed_at}</div>
                      <div className="text-xs font-semibold text-slate-600">
                        {h.decision_status ? h.decision_status.toUpperCase() : "PENDING"}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-600">No scenario history yet.</div>
                )}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" disabled={actionLoading || !canRun} onClick={clearHistory}>
                  Clear history
                </Button>
              </div>
            </SectionCard>
          </div>

          
        </div>
      ) : null}

      {workspaceId && tab === "manual" ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SectionCard title="Manual scenario" subtitle="Build a custom simulation.">
            <div className="space-y-3">
              <div>
                <FieldLabel info="Choose a scenario template to simulate.">Scenario template</FieldLabel>
                <select className="ea-input" value={manualTemplateId} onChange={(e) => setManualTemplateId(e.target.value)}>
                  <option value="do_nothing_projection">Baseline Continuity Projection</option>
                  {templates
                    .filter((t) => t.mode !== "adaptive")
                    .map((t) => (
                      <option key={t.scenario_template_id} value={t.scenario_template_id}>
                        {t.title}
                      </option>
                    ))}
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
                <FieldLabel info="How many months to project.">Timeline months</FieldLabel>
                <NumberInput value={manualTimelineMonths} onChange={setManualTimelineMonths} placeholder="6" />
              </div>

              {manualTemplateId === "do_nothing_projection" ? (
                <div className="text-sm text-slate-600">Uses current inputs. No additional inputs required.</div>
              ) : manualTemplate?.required_inputs?.length ? (
                manualTemplate.required_inputs.map((key) => (
                  <div key={key}>
                    <FieldLabel info={fieldHelp(key)}>{prettyLabel(key)}</FieldLabel>
                    <NumberInput
                      value={String(manualParams[key] ?? "")}
                      onChange={(v) => setManualParams((p) => ({ ...p, [key]: parseNumber(v, 0) }))}
                      placeholder="0"
                    />
                    {key === "client_loss_pct" && largestClient ? (
                      <div className="mt-1 text-xs text-slate-500">
                        Largest client: {largestClient.name}
                        {largestClient.share != null ? ` (~${largestClient.share}% of revenue)` : ""}.
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-600">No additional inputs required.</div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                disabled={actionLoading || !canRun}
                onClick={() => {
                  if (manualTemplateId === "do_nothing_projection") {
                    runDoNothing(parseNumber(manualTimelineMonths, 6), true);
                    return;
                  }
                  runScenario(
                    manualTemplateId,
                    "manual",
                    { ...manualParams, timeline_months: parseNumber(manualTimelineMonths, 6) },
                    manualName
                  );
                }}
              >
                {actionLoading ? <Spinner size={16} /> : null}
                {manualTemplateId === "do_nothing_projection" ? "Run projection" : "Run manual scenario"}
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Scenario output" subtitle="Timeline and recommendations." className="lg:col-span-2">
            <ScenarioOutput
              activeRun={activeRun}
              timeline={timeline}
              currency={currency}
              decisionSaving={decisionSaving}
              decisionNotice={decisionNotice}
              onDecision={saveDecision}
              hideDecision={isProjection(activeRun)}
            />
          </SectionCard>
        </div>
      ) : null}
</div>
  );
}

function buildDefaultParams(template, stateSnapshot, largestClient) {
  if (!template) return {};
  const defaults = {
    price_change_pct: 5,
    effective_month: 1,
    revenue_drop_pct: 10,
    cost_increase_pct: 10,
    employee_count: 1,
    employee_monthly_cost: 1500,
    contractor_monthly_cost: 1200,
    delay_months: 1,
    revenue_uplift_pct: 10,
    cost_uplift_pct: 5,
    client_loss_pct: stateSnapshot?.top_client_share_pct ?? 30
  };
  const params = {};
  (template.required_inputs || []).forEach((key) => {
    params[key] = defaults[key] ?? 0;
  });
  if (template.scenario_type === "client_loss") {
    params.client_loss_pct = largestClient?.share ?? stateSnapshot?.top_client_share_pct ?? 30;
  }
  return params;
}

function prettyLabel(key) {
  return String(key || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fieldHelp(key) {
  const help = {
    price_change_pct: "Percent change in price.",
    revenue_drop_pct: "Percent drop in revenue.",
    cost_increase_pct: "Percent increase in monthly costs.",
    employee_count: "Number of employees to add.",
    employee_monthly_cost: "Monthly cost per employee.",
    contractor_monthly_cost: "Monthly cost per contractor.",
    delay_months: "Months of delayed payments.",
    revenue_uplift_pct: "Percent revenue uplift for new service.",
    cost_uplift_pct: "Percent cost uplift for new service.",
    client_loss_pct: "Percent of monthly revenue lost if the largest client leaves."
  };
  return help[key] || "";
}

function ScenarioOutput({
  activeRun,
  timeline,
  currency,
  decisionSaving,
  decisionNotice,
  onDecision,
  hideDecision,
  maxTimelineRows
}) {
  if (!activeRun) {
    return <div className="text-sm text-slate-600">Run a scenario to view results.</div>;
  }

  const base = activeRun.baseline_metrics || {};
  const scenario = activeRun.scenario_metrics || {};
  const deltas = activeRun.deltas || {};

  const timelineRows = maxTimelineRows ? timeline.slice(0, maxTimelineRows) : timeline;
  const isTrimmed = maxTimelineRows && timeline.length > maxTimelineRows;

  const baseDate = useMemo(() => {
    const raw = activeRun?.executed_at || activeRun?.created_at || activeRun?.updated_at;
    const parsed = raw ? new Date(raw) : new Date();
    if (Number.isNaN(parsed.getTime())) return new Date();
    return parsed;
  }, [activeRun]);

  function formatMonthLabel(monthIndex) {
    if (!monthIndex) return "—";
    const d = new Date(baseDate);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() + (Number(monthIndex) - 1));
    return d.toLocaleString(undefined, { month: "short", year: "numeric" });
  }

  function formatMonthDetail(monthIndex) {
    if (!monthIndex) return "—";
    const d = new Date(baseDate);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() + (Number(monthIndex) - 1));
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scenario</div>
        <div className="mt-1 text-lg font-semibold text-slate-900">{activeRun.scenario_name}</div>
        {activeRun.state_result ? (
          <div className="mt-1 text-xs text-slate-500">State result: {activeRun.state_result}</div>
        ) : null}
      </div>

      {Object.keys(base).length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <MetricCard
            title="Baseline"
            metrics={base}
            currency={currency}
            info="Your current metrics without any change."
          />
          <MetricCard
            title="Scenario"
            metrics={scenario}
            currency={currency}
            info="Projected metrics after applying the scenario."
          />
          <MetricCard
            title="Delta"
            metrics={deltas}
            currency={currency}
            isDelta
            info="Difference between scenario and baseline."
          />
        </div>
      ) : null}

      {timeline?.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timeline</div>
          {isTrimmed ? <div className="mt-1 text-xs text-slate-500">Showing first {maxTimelineRows} months.</div> : null}
          <div className="mt-3 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2 py-2 text-left">Month</th>
                  <th className="px-2 py-2 text-left">Revenue</th>
                  <th className="px-2 py-2 text-left">Costs</th>
                  <th className="px-2 py-2 text-left">Profit</th>
                  <th className="px-2 py-2 text-left">Cash</th>
                  <th className="px-2 py-2 text-left">Stability</th>
                  <th className="px-2 py-2 text-left">State</th>
                </tr>
              </thead>
              <tbody>
                {timelineRows.map((row) => (
                  <tr key={row.month_index} className="border-t">
                    <td className="px-2 py-2">
                      <div className="font-semibold text-slate-700">{formatMonthLabel(row.month_index)}</div>
                      <div className="text-[10px] text-slate-500">{formatMonthDetail(row.month_index)}</div>
                    </td>
                    <td className="px-2 py-2">{formatCurrency(row.revenue, currency)}</td>
                    <td className="px-2 py-2">{formatCurrency(row.costs, currency)}</td>
                    <td className="px-2 py-2">{formatCurrency(row.profit, currency)}</td>
                    <td className="px-2 py-2">{formatCurrency(row.cash_balance, currency)}</td>
                    <td className="px-2 py-2">{formatNumber(row.stability_score)}</td>
                    <td className="px-2 py-2">{row.state_label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    </div>
  );
}

function MetricCard({ title, metrics, currency, isDelta, info }) {
  const rows = [
    ["Monthly revenue", metrics.monthly_revenue],
    ["Monthly costs", metrics.monthly_costs],
    ["Net profit", metrics.net_profit],
    ["Stability score", metrics.stability_score]
  ];

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
            <div className="font-semibold text-slate-900">
              {label.includes("score")
                ? formatNumber(value)
                : isDelta
                  ? formatDelta(value)
                  : formatCurrency(value, currency)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDelta(value) {
  if (value == null) return "—";
  if (typeof value === "number") {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}`;
  }
  return "—";
}

function isProjection(run) {
  if (!run) return false;
  return run.scenario_type === "do_nothing_projection" || String(run.scenario_run_id || "").startsWith("proj_");
}







