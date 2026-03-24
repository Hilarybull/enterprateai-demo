import { useEffect, useMemo, useState } from "react";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import Spinner from "../components/Spinner";
import SegmentedTabs from "../components/SegmentedTabs";
import NumberInput, { parseNumber } from "../components/NumberInput";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import { useAuthStore } from "../store/auth";
import { formatCurrency, formatNumber } from "../lib/format";

export default function SimulationPage() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const ideaValidation = useWorkspaceStore((s) => s.ideaValidation);
  const validation = useWorkspaceStore((s) => s.validation);
  const inputs = useWorkspaceStore((s) => s.inputs);
  const currency = useWorkspaceStore((s) => s.currency);
  const email = useAuthStore((s) => s.email);

  const tenantId = email || "ten_default";
  const businessId = workspaceId || "biz_unknown";
  const stateVersion = validation?.rubric_version || "state_v1.0";

  const stateSnapshot = useMemo(() => {
    const metrics = validation?.metrics || {};
    return {
      revenue_monthly: Number(metrics.revenue_monthly || 0),
      costs_monthly: Number(metrics.costs_monthly || 0),
      starting_cash: Number(inputs?.starting_cash || 0),
      top_client_share_pct: ideaValidation?.concentration?.top_client_share_pct ?? null,
      capacity_utilisation_pct: metrics.capacity?.utilization ?? null,
      payment_terms_days: metrics.payment_terms_days ?? null,
      sales_cycle_days: metrics.sales_cycle_days ?? null,
      clients_count: ideaValidation?.concentration?.clients_count ?? null
    };
  }, [ideaValidation, inputs, validation]);

  const [tab, setTab] = useState("adaptive"); // adaptive | manual | history | donothing
  const [templates, setTemplates] = useState([]);
  const [riskSignals, setRiskSignals] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [history, setHistory] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [manualTemplateId, setManualTemplateId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualParams, setManualParams] = useState({});
  const [manualTimelineMonths, setManualTimelineMonths] = useState("6");

  const [activeRun, setActiveRun] = useState(null);
  const [activeRunKind, setActiveRunKind] = useState(null); // "scenario" | "projection"
  const [timeline, setTimeline] = useState([]);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState(null);

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
    if (!templates.length) return;
    const manual = templates.find((t) => t.mode !== "adaptive");
    if (manual && !manualTemplateId) {
      setManualTemplateId(manual.scenario_template_id);
      setManualName(manual.title);
      setManualParams(buildDefaultParams(manual, stateSnapshot));
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
    setLoading(true);
    setError(null);
    setDecisionNotice(null);
    try {
      const template = templates.find((t) => t.scenario_template_id === templateId);
      if (!template) throw new Error("Scenario template not found.");
      const payload = {
        tenant_id: tenantId,
        business_id: businessId,
        state_version: stateVersion,
        scenario_template_id: templateId,
        scenario_mode: mode,
        scenario_name: nameOverride || template.title,
        parameters: params,
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
      setLoading(false);
    }
  }

  async function runDoNothing() {
    if (!canRun) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("/v1/scenario-intelligence/do-nothing/run", "POST", {
        tenant_id: tenantId,
        business_id: businessId,
        state_version: stateVersion,
        timeline_months: parseNumber(manualTimelineMonths, 3),
        state: stateSnapshot
      });
      setActiveRun({
        scenario_run_id: res?.projection_id,
        scenario_name: "Do nothing projection",
        scenario_type: "do_nothing_projection",
        baseline_metrics: {},
        scenario_metrics: {},
        deltas: {},
        state_result: "neutral",
        timeline_summary: {}
      });
      setActiveRunKind("projection");
      setTimeline(res?.forecast || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Projection failed.");
    } finally {
      setLoading(false);
    }
  }

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

  const manualTemplate = templates.find((t) => t.scenario_template_id === manualTemplateId);

  useEffect(() => {
    if (!manualTemplate) return;
    setManualParams(buildDefaultParams(manualTemplate, stateSnapshot));
    setManualName(manualTemplate.title);
  }, [manualTemplate, stateSnapshot]);

  return (
    <div>
      <PageHeader
        title="Simulation"
        description="Adaptive scenario intelligence with time-based impact modelling."
        badge={{ text: "Scenario intelligence", tone: "slate" }}
      />

      {!workspaceId ? (
        <div className="mt-4">
          <InlineAlert message="Select a workspace by running Idea Validation first." />
        </div>
      ) : null}

      {error ? (
        <div className="mt-4">
          <InlineAlert kind="error" message={error} />
        </div>
      ) : null}

      <div className="mt-6">
        <SegmentedTabs
          ariaLabel="Scenario tabs"
          value={tab}
          onChange={setTab}
          options={[
            { value: "adaptive", label: "Adaptive" },
            { value: "manual", label: "Manual" },
            { value: "donothing", label: "Do nothing" },
            { value: "history", label: "History" }
          ]}
        />
      </div>

      {tab === "adaptive" ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SectionCard title="Risk signals" subtitle="Detected structural risks.">
            <div className="space-y-2">
              {riskSignals.length ? (
                riskSignals.map((r) => (
                  <div key={r.risk_signal_id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{r.risk_type}</div>
                    <div className="mt-1 text-sm text-slate-700">
                      {r.reason_code} — {r.metric_name}: {String(r.metric_value)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">Severity: {r.severity}</div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-600">No risks detected yet.</div>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <Button disabled={loading || !canRun} onClick={loadSignals}>
                {loading ? <Spinner size={16} /> : null}
                Refresh risks
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Recommended scenarios" subtitle="Adaptive scenarios triggered by risks.">
            <div className="space-y-3">
              {recommendations.length ? (
                recommendations.map((rec) => (
                  <div key={rec.scenario_template_id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-sm font-semibold text-slate-900">{rec.title}</div>
                    <div className="text-xs text-slate-500">Trigger: {rec.trigger_reason}</div>
                    <div className="mt-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          runScenario(
                            rec.scenario_template_id,
                            "adaptive",
                            buildDefaultParams(
                              templates.find((t) => t.scenario_template_id === rec.scenario_template_id),
                              stateSnapshot
                            ),
                            rec.title
                          )
                        }
                        disabled={loading || !canRun}
                      >
                        {loading ? <Spinner size={14} /> : null}
                        Run scenario
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-600">No recommendations yet. Refresh risks to generate.</div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Scenario output" subtitle="Timeline and recommendations.">
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

      {tab === "manual" ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SectionCard title="Manual scenario" subtitle="Build a custom simulation.">
            <div className="space-y-3">
              <div>
                <div className="ea-label">Scenario template</div>
                <select className="ea-input" value={manualTemplateId} onChange={(e) => setManualTemplateId(e.target.value)}>
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
                <div className="ea-label">Scenario name</div>
                <input className="ea-input" value={manualName} onChange={(e) => setManualName(e.target.value)} />
              </div>
              <div>
                <div className="ea-label">Timeline months (3–6)</div>
                <NumberInput value={manualTimelineMonths} onChange={setManualTimelineMonths} placeholder="6" />
              </div>

              {manualTemplate?.required_inputs?.length ? (
                manualTemplate.required_inputs.map((key) => (
                  <div key={key}>
                    <div className="ea-label">{prettyLabel(key)}</div>
                    <NumberInput
                      value={String(manualParams[key] ?? "")}
                      onChange={(v) => setManualParams((p) => ({ ...p, [key]: parseNumber(v, 0) }))}
                      placeholder="0"
                    />
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-600">No additional inputs required.</div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                disabled={loading || !canRun}
                onClick={() =>
                  runScenario(
                    manualTemplateId,
                    "manual",
                    { ...manualParams, timeline_months: parseNumber(manualTimelineMonths, 6) },
                    manualName
                  )
                }
              >
                {loading ? <Spinner size={16} /> : null}
                Run manual scenario
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

      {tab === "donothing" ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SectionCard title="Do nothing projection" subtitle="See the likely path without action.">
            <div className="space-y-3">
              <div>
                <div className="ea-label">Timeline months (3–6)</div>
                <NumberInput value={manualTimelineMonths} onChange={setManualTimelineMonths} placeholder="3" />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button disabled={loading || !canRun} onClick={runDoNothing}>
                {loading ? <Spinner size={16} /> : null}
                Run projection
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Projection output" subtitle="Month-by-month view." className="lg:col-span-2">
            <ScenarioOutput
              activeRun={activeRun}
              timeline={timeline}
              currency={currency}
              decisionSaving={decisionSaving}
              decisionNotice={decisionNotice}
              onDecision={saveDecision}
              hideDecision
            />
          </SectionCard>
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="mt-4">
          <SectionCard title="Scenario history" subtitle="Previous runs and decisions.">
            <div className="space-y-2">
              {history.length ? (
                history.map((h) => (
                  <div key={h.scenario_run_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
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
          </SectionCard>
        </div>
      ) : null}
    </div>
  );
}

function buildDefaultParams(template, stateSnapshot) {
  if (!template) return {};
  const defaults = {
    price_change_pct: 5,
    revenue_drop_pct: 10,
    cost_increase_pct: 10,
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
  return params;
}

function prettyLabel(key) {
  return String(key || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function ScenarioOutput({ activeRun, timeline, currency, decisionSaving, decisionNotice, onDecision, hideDecision }) {
  if (!activeRun) {
    return <div className="text-sm text-slate-600">Run a scenario to view results.</div>;
  }

  const base = activeRun.baseline_metrics || {};
  const scenario = activeRun.scenario_metrics || {};
  const deltas = activeRun.deltas || {};

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
          <MetricCard title="Baseline" metrics={base} currency={currency} />
          <MetricCard title="Scenario" metrics={scenario} currency={currency} />
          <MetricCard title="Delta" metrics={deltas} currency={currency} isDelta />
        </div>
      ) : null}

      {timeline?.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timeline</div>
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
                {timeline.map((row) => (
                  <tr key={row.month_index} className="border-t">
                    <td className="px-2 py-2">{row.month_index}</td>
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

function MetricCard({ title, metrics, currency, isDelta }) {
  const rows = [
    ["Monthly revenue", metrics.monthly_revenue],
    ["Monthly costs", metrics.monthly_costs],
    ["Net profit", metrics.net_profit],
    ["Stability score", metrics.stability_score]
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
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
