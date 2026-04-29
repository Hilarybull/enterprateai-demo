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
import { buildFinancialIntelligence } from "../lib/financialIntelligence";

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

export default function SimulationPage() {
  const simulationEnabled = true;
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const ideaValidation = useWorkspaceStore((s) => s.ideaValidation);
  const decisionStatus = useWorkspaceStore((s) => s.decisionStatus);
  const validation = useWorkspaceStore((s) => s.validation);
  const inputs = useWorkspaceStore((s) => s.inputs);
  const currency = useWorkspaceStore((s) => s.currency);
  const email = useAuthStore((s) => s.email);

  const tenantId = asNonEmptyString(email, "ten_default");
  const businessId = asNonEmptyString(workspaceId, "biz_unknown");
  const [registrationStatus, setRegistrationStatus] = useState({ status: "not_started" });
  const isRegistered = registrationStatus?.status === "registered";
  const stateVersion = isRegistered ? asNonEmptyString(validation?.rubric_version, "state_v1.0") : "state_v1.0";

  const [catalogueData, setCatalogueData] = useState({ products: [], customers: [], vendors: [] });
  const [financialsData, setFinancialsData] = useState({ invoices: [], expenses: [], contracts: [] });
  const [upgradeNotice, setUpgradeNotice] = useState(null);
  const [upgradeLoading, setUpgradeLoading] = useState(false);

  const acceptedIdeaValidation = decisionStatus === "accepted" ? ideaValidation : null;

  async function handleUpgradeClick() {
    setUpgradeLoading(true);
    setUpgradeNotice(null);
    try {
      await apiRequest("/upgrade/click", "POST", { feature: "simulation", source: "simulation_page" });
      setUpgradeNotice("Upgrade request sent. We will reach out shortly.");
    } catch {
      setUpgradeNotice("Unable to send upgrade request. Please try again.");
    } finally {
      setUpgradeLoading(false);
    }
  }

  const financialInsights = useMemo(
    () =>
      buildFinancialIntelligence({
        catalogue: catalogueData,
        financials: financialsData,
        validation: isRegistered ? validation : acceptedIdeaValidation,
        inputs,
      }),
    [acceptedIdeaValidation, catalogueData, financialsData, inputs, isRegistered, validation]
  );

  const stateSnapshot = financialInsights.stateSnapshot;

  const largestClient = financialInsights.largestClient;

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
  const [prefillDone, setPrefillDone] = useState(false);

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
  const lastSignalsSnapshotHashRef = useRef("");

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
    lastSnapshotHashRef.current = "";
    lastSignalsSnapshotHashRef.current = "";
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
      const risks = riskRes?.risk_signals?.length ? riskRes.risk_signals : financialInsights.riskItems;
      setRiskSignals(risks);
      const recRes = await apiRequest("/v1/scenario-intelligence/recommendations/generate", "POST", {
        tenant_id: tenantId,
        business_id: businessId,
        state_version: stateVersion,
        risk_signal_ids: risks
          .map((r) => (typeof r?.risk_signal_id === "string" ? r.risk_signal_id.trim() : ""))
          .filter(Boolean),
        state: stateSnapshot
      });
      setRecommendations(recRes?.recommended_scenarios?.length ? recRes.recommended_scenarios : financialInsights.recommendations);
    } catch (e) {
      setRiskSignals(financialInsights.riskItems);
      setRecommendations(financialInsights.recommendations);
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
        scenario_template_id: asNonEmptyString(templateId, "tmpl_revenue_drop"),
        scenario_mode: mode === "adaptive" ? "adaptive" : "manual",
        scenario_name: asNonEmptyString(nameOverride || template?.title, "Scenario run"),
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
    if (!canRun || tab !== "adaptive") return;
    if (loading) return;
    if (snapshotHash === lastSignalsSnapshotHashRef.current && autoSignalsDone) return;
    lastSignalsSnapshotHashRef.current = snapshotHash;
    loadSignals();
    setAutoSignalsDone(true);
  }, [tab, canRun, autoSignalsDone, loading, snapshotHash]);

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
    }
    setPrefillDone(true);
  }, [prefillDone, templates]);

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
              <Button onClick={handleUpgradeClick} disabled={upgradeLoading}>
                {upgradeLoading ? <Spinner size={16} /> : null}
                {upgradeLoading ? "Sending..." : "Upgrade"}
              </Button>
            </div>
            {upgradeNotice ? (
              <div className="mt-3 text-sm text-slate-600">{upgradeNotice}</div>
            ) : null}
          </div>
        </SectionCard>
      </div>
    );
  }

  // Simulation view temporarily disabled; keep code below for reactivation.
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

            <div className="mt-4">
              <div className="flex justify-end">
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
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                {scenarioOutputNote(manualTemplateId, largestClient)}
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

function scenarioOutputNote(templateId, largestClient) {
  switch (templateId) {
    case "do_nothing_projection":
      return "This shows what your business may look like over time if you keep going without making any major change.";
    case "tmpl_client_loss":
      return `This shows what may happen if your biggest client${largestClient?.name ? ` (${largestClient.name})` : ""} stops buying from you, including the effect on revenue, cost of sales, profit, and projected cash balance.`;
    case "tmpl_price_increase":
      return "This shows whether a price increase improves revenue and profit without changing your current cost base straight away.";
    case "tmpl_hire_staff":
      return "This shows how adding staff increases monthly costs first, so you can see whether your current revenue can absorb the extra payroll.";
    case "tmpl_cost_increase":
      return "This shows what happens if delivery or operating costs rise, and whether your margin and projected cash balance can still hold up.";
    case "tmpl_revenue_drop":
      return "This shows what happens if sales slow down across the business, including the knock-on effect on profit and projected cash balance.";
    case "tmpl_payment_delay":
      return "This shows what happens when customers pay later than expected, so profit may still look fine while cash comes in more slowly.";
    case "tmpl_service_launch":
      return "This shows whether a new service could lift revenue enough to justify the extra delivery and operating costs.";
    default:
      return "This output compares your current baseline with the scenario you selected, so you can see the effect on revenue, costs, profit, and projected cash balance.";
  }
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

function buildScenarioMeaning(activeRun, timeline) {
  const scenario = activeRun?.scenario_metrics || {};
  const delta = activeRun?.deltas || {};
  const scenarioType = String(activeRun?.scenario_type || "").toLowerCase();
  const lastRow = Array.isArray(timeline) && timeline.length ? timeline[timeline.length - 1] : null;
  const revenueDelta = Number(delta?.monthly_revenue || 0);
  const profitDelta = Number(delta?.net_profit || 0);
  const costsDelta = Number(delta?.monthly_costs || 0);
  const scenarioCash = Number(lastRow?.cash_balance || 0);
  const firstRow = Array.isArray(timeline) && timeline.length ? timeline[0] : null;

  const revenueText =
    revenueDelta > 0
      ? `monthly run-rate revenue is up by ${Math.abs(revenueDelta).toFixed(2)}`
      : revenueDelta < 0
        ? `monthly run-rate revenue is down by ${Math.abs(revenueDelta).toFixed(2)}`
        : "monthly run-rate revenue is broadly unchanged";

  const profitText =
    profitDelta > 0
      ? `profit improves by ${Math.abs(profitDelta).toFixed(2)}`
      : profitDelta < 0
        ? `profit falls by ${Math.abs(profitDelta).toFixed(2)}`
        : "profit is broadly unchanged";

  const costsText =
    costsDelta > 0
      ? `total costs rise by ${Math.abs(costsDelta).toFixed(2)}`
      : costsDelta < 0
        ? `total costs fall by ${Math.abs(costsDelta).toFixed(2)}`
        : "total costs stay broadly flat";

  let scenarioRule = "The scenario changes your baseline monthly figures and then projects them across the timeline.";
  if (scenarioType === "client_loss") {
    scenarioRule = "This run reduces revenue based on the client-loss percentage. Cost of sales also reduces, but more gradually, because some delivery costs do not disappear immediately.";
  } else if (scenarioType === "price_change") {
    scenarioRule = "This run increases revenue from the selected effective month onward. Costs stay on the current baseline unless the scenario says otherwise.";
  } else if (scenarioType === "cost_increase") {
    scenarioRule = "This run pushes expenses and cost of sales upward, so the table shows how higher costs affect profit and cash over time.";
  } else if (scenarioType === "revenue_drop") {
    scenarioRule = "This run reduces revenue and lets cost of sales fall with it, so you can see how a slower sales pace affects the business month by month.";
  } else if (scenarioType === "payment_delay") {
    scenarioRule = "This run keeps the revenue assumption but delays when the cash is collected, so profit and projected cash balance can move differently.";
  } else if (scenarioType === "hire_staff") {
    scenarioRule = "This run adds staff cost into monthly expenses, so the output shows whether the current revenue base can absorb the extra payroll.";
  } else if (scenarioType === "service_launch") {
    scenarioRule = "This run lifts revenue and costs together over a short ramp, so you can compare whether the added income outweighs the added delivery cost.";
  }

  const cashLine = lastRow
    ? scenarioCash > 0
      ? `Projected cash balance ends at ${scenarioCash.toFixed(2)} because the model adds cash only when revenue is collected and subtracts cash when costs are actually paid.`
      : "Projected cash balance stays tight through the projection."
    : "Projected cash balance is based on when revenue is collected and costs are paid, not just on profit.";
  const firstMonthLine = firstRow
    ? `In the first projected month, revenue is ${Number(firstRow.revenue || 0).toFixed(2)}, total costs are ${Number(firstRow.costs || 0).toFixed(2)}, and profit is ${Number(firstRow.profit || 0).toFixed(2)}.`
    : "";

  return `${scenarioRule} Compared with your baseline, ${revenueText}, ${costsText}, and ${profitText}. ${firstMonthLine} ${cashLine}`;
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
  const runRisks = Array.isArray(activeRun.risk_signals) ? activeRun.risk_signals : [];
  const runRecs = Array.isArray(activeRun.recommendations) ? activeRun.recommendations : [];
  const scenarioMeaning = buildScenarioMeaning(activeRun, timeline);

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
        detail: `Monthly profit is ${formatCurrency(value ?? 0, currency)}.`
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
    return {
      title: "Risk signal",
      detail: `${risk?.risk_type || "Risk"} detected.`
    };
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scenario</div>
        <div className="mt-1 text-lg font-semibold text-slate-900">{activeRun.scenario_name}</div>
        {activeRun.state_result ? (
          <div className="mt-1 text-xs text-slate-500">State result: {activeRun.state_result}</div>
        ) : null}
        {(activeRun?.baseline_snapshot?.accrued_revenue_total || activeRun?.baseline_snapshot?.accrued_cost_of_sales_total) ? (
          <div className="mt-2 text-xs text-slate-500">
            Current accrued revenue: {formatCurrency(activeRun?.baseline_snapshot?.accrued_revenue_total || 0, currency)}
            {" • "}
            Current accrued cost of sales: {formatCurrency(activeRun?.baseline_snapshot?.accrued_cost_of_sales_total || 0, currency)}
          </div>
        ) : null}
      </div>

      {runRisks.length || runRecs.length ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
              ) : (
                <div className="text-sm text-slate-600">No risks detected for this scenario.</div>
              )}
            </div>
          </div>

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
                    {rec.action_type ? <div className="mt-1 text-[11px] text-slate-500">{rec.action_type}</div> : null}
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
        </div>
      ) : null}

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
                  <th className="px-2 py-2 text-left">Run-rate revenue</th>
                  <th className="px-2 py-2 text-left">Expenses</th>
                  <th className="px-2 py-2 text-left">Cost of sales</th>
                  <th className="px-2 py-2 text-left">Total costs</th>
                  <th className="px-2 py-2 text-left">Profit</th>
                  <th className="px-2 py-2 text-left">Projected cash balance</th>
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
                    <td className="px-2 py-2">{formatCurrency(row.expenses, currency)}</td>
                    <td className="px-2 py-2">{formatCurrency(row.cost_of_sales, currency)}</td>
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

      <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">What This Means</div>
        <div className="mt-2 text-sm leading-6 text-slate-700 break-words">
          {scenarioMeaning}
        </div>
      </div>

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
    ["Monthly run-rate revenue", metrics.monthly_revenue],
    ["Monthly expenses", metrics.monthly_expenses],
    ["Cost of sales", metrics.monthly_cost_of_sales],
    ["Total costs", metrics.monthly_costs],
    ["Profit", metrics.net_profit],
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







