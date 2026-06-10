import { useEffect, useMemo, useState } from "react";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import WorkspacePrompt from "../components/WorkspacePrompt";
import Spinner from "../components/Spinner";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import { useAuthStore } from "../store/auth";
import { formatCurrency } from "../lib/format";
import { buildFinancialIntelligence } from "../lib/financialIntelligence";
import { getAcceptedWorkspaceValidation } from "../lib/acceptedValidation";
import { assembleOutput } from "../lib/contracts/index";
import { generateAndDownloadPdf } from "../lib/reports/index";

const REPORT_TYPES = [
  {
    id: "business_health_report",
    label: "Business Health Report",
    description: "Full assessment — scores, risks, recommendations, and next actions.",
    icon: "📊",
  },
  {
    id: "investor_summary",
    label: "Investor Summary",
    description: "Concise snapshot of scores, classification, and strategic position.",
    icon: "💼",
  },
  {
    id: "scenario_report",
    label: "Scenario Analysis Report",
    description: "Detailed output from your latest simulation run.",
    icon: "🔮",
  },
  {
    id: "fragility_report",
    label: "Fragility Report",
    description: "Structural vulnerability, concentration risks, and mitigation plan.",
    icon: "🧱",
  },
  {
    id: "stability_report",
    label: "Stability Report",
    description: "Monthly financials, margin, runway, and stability classification.",
    icon: "⚖️",
  },
];

export default function ReportsPage() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const currency = useWorkspaceStore((s) => s.currency) || "GBP";
  const inputs = useWorkspaceStore((s) => s.inputs);
  const ideaValidation = useWorkspaceStore((s) => s.ideaValidation);
  const decisionStatus = useWorkspaceStore((s) => s.decisionStatus);
  const serviceDecisionStatus = useWorkspaceStore((s) => s.serviceDecisionStatus);
  const validation = useWorkspaceStore((s) => s.validation);
  const email = useAuthStore((s) => s.email);

  const [catalogueData, setCatalogueData] = useState({ products: [], customers: [], vendors: [] });
  const [financialsData, setFinancialsData] = useState({ invoices: [], expenses: [], contracts: [] });
  const [acceptedValidation, setAcceptedValidation] = useState(null);
  const [registrationStatus, setRegistrationStatus] = useState({ status: "not_started" });
  const [riskSignals, setRiskSignals] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [latestScenario, setLatestScenario] = useState(null);
  const [latestTimeline, setLatestTimeline] = useState([]);
  const [reportHistory, setReportHistory] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [generating, setGenerating] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");

  const acceptedIdeaValidation = decisionStatus === "accepted" ? ideaValidation : null;
  const acceptedModuleValidation = {
    businessValidation: acceptedValidation?.businessValidation || acceptedIdeaValidation || null,
    serviceValidation:
      acceptedValidation?.serviceValidation || (serviceDecisionStatus === "accepted" ? validation : null),
  };

  const financialInsights = useMemo(
    () =>
      buildFinancialIntelligence({
        catalogue: catalogueData,
        financials: financialsData,
        validation: acceptedModuleValidation,
        inputs,
      }),
    [acceptedModuleValidation, catalogueData, financialsData, inputs]
  );

  // Load workspace data
  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    setLoadingData(true);
    async function load() {
      try {
        const ws = await apiRequest("/validation/me", "GET");
        if (!alive || !ws) return;
        setCatalogueData(ws?.data?.catalogue || { products: [], customers: [], vendors: [] });
        setFinancialsData(ws?.data?.financials || { invoices: [], expenses: [], contracts: [] });
        setRegistrationStatus(ws?.data?.registration_status || { status: "not_started" });
        setAcceptedValidation(getAcceptedWorkspaceValidation(ws?.data));
      } catch {
        // ignore
      } finally {
        if (alive) setLoadingData(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [workspaceId]);

  // Load risk signals
  useEffect(() => {
    if (!workspaceId || !financialInsights.stateSnapshot) return;
    const snap = financialInsights.stateSnapshot;
    const businessId = workspaceId;
    const tenantId = email || "ten_default";
    async function loadSignals() {
      try {
        const riskRes = await apiRequest("/v1/scenario-intelligence/risk-detection/run", "POST", {
          tenant_id: tenantId,
          business_id: businessId,
          state_version: "state_v1.0",
          state: snap,
        });
        const signals = riskRes?.risk_signals?.length ? riskRes.risk_signals : financialInsights.riskItems;
        setRiskSignals(signals);
        const recRes = await apiRequest("/v1/scenario-intelligence/recommendations/generate", "POST", {
          tenant_id: tenantId,
          business_id: businessId,
          state_version: "state_v1.0",
          risk_signal_ids: signals.map((r) => r.risk_signal_id).filter(Boolean),
          state: snap,
        });
        setRecommendations(recRes?.recommended_scenarios || financialInsights.recommendations);
      } catch {
        setRiskSignals(financialInsights.riskItems);
        setRecommendations(financialInsights.recommendations);
      }
    }
    loadSignals();
  }, [workspaceId, JSON.stringify(financialInsights.stateSnapshot)]);

  // Load latest scenario
  useEffect(() => {
    if (!workspaceId) return;
    async function loadHistory() {
      try {
        const res = await apiRequest(
          `/v1/scenario-intelligence/history?business_id=${workspaceId}&tenant_id=${email || "ten_default"}`,
          "GET"
        );
        const latest = res?.history?.[0];
        if (latest?.scenario_run_id) {
          const [runRes, tlRes] = await Promise.all([
            apiRequest(`/v1/scenario-intelligence/scenario-runs/${latest.scenario_run_id}`, "GET"),
            apiRequest(`/v1/scenario-intelligence/scenario-runs/${latest.scenario_run_id}/timeline`, "GET"),
          ]);
          setLatestScenario(runRes);
          setLatestTimeline(tlRes?.timeline || []);
        }
      } catch {
        // ignore
      }
    }
    loadHistory();
  }, [workspaceId]);

  // Load report history
  useEffect(() => {
    if (!workspaceId) return;
    async function loadReports() {
      try {
        const res = await apiRequest("/v1/reports", "GET");
        setReportHistory(res?.reports || []);
      } catch {
        // ignore
      }
    }
    loadReports();
  }, [workspaceId]);

  // Assemble intelligence output
  function buildOutput(reportType) {
    const snap = financialInsights.stateSnapshot;
    const businessName =
      catalogueData?.customers?.[0]?.name ||
      inputs?.business_name ||
      acceptedModuleValidation?.businessValidation?.business_name ||
      null;

    const output = assembleOutput({
      workspaceId,
      businessName,
      currency,
      inputs,
      ideaValidation: acceptedIdeaValidation,
      financialInsights,
      riskSignals,
      recommendations,
      scenarioRun: reportType === "scenario_report" ? latestScenario : null,
      scenarioTimeline: reportType === "scenario_report" ? latestTimeline : [],
    });

    return output;
  }

  async function handleGenerateReport(reportType) {
    if (!workspaceId) return;
    setGenerating(reportType);
    setError(null);
    setProgress("Assembling intelligence output...");

    try {
      const output = buildOutput(reportType);
      setProgress("Building report sections...");

      const { blob, fileName, sections } = await generateAndDownloadPdf({
        output,
        reportType,
        branding: { companyName: "EnterprateAI" },
        onProgress: setProgress,
      });

      // Save report metadata to backend
      try {
        await apiRequest("/v1/reports/generate", "POST", {
          reportType,
          includeNarratives: true,
          sections: sections.map((s, i) => ({ ...s, sectionOrder: i })),
          title: null,
        });
      } catch {
        // Backend persistence failure is non-fatal — user already has the PDF
      }

      // Refresh history
      try {
        const res = await apiRequest("/v1/reports", "GET");
        setReportHistory(res?.reports || []);
      } catch {
        // ignore
      }

      setProgress("Report downloaded.");
    } catch (e) {
      setError(e?.message || "Failed to generate report. Try again.");
    } finally {
      setGenerating(null);
      setTimeout(() => setProgress(""), 3000);
    }
  }

  const businessName =
    inputs?.business_name ||
    acceptedModuleValidation?.businessValidation?.business_name ||
    "your business";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Generate professional PDF reports from your saved intelligence outputs."
        badge={{ text: "PDF export", tone: "slate" }}
      />

      {!workspaceId ? (
        <WorkspacePrompt />
      ) : null}

      {error ? <InlineAlert kind="error" message={error} /> : null}
      {progress ? <InlineAlert kind="info" message={progress} /> : null}

      {workspaceId ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {REPORT_TYPES.map((rt) => {
            const isScenario = rt.id === "scenario_report";
            const hasScenario = Boolean(latestScenario);
            const disabled = !workspaceId || loadingData || (isScenario && !hasScenario);
            const isGenerating = generating === rt.id;

            return (
              <div
                key={rt.id}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="text-2xl leading-none">{rt.icon}</div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{rt.label}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{rt.description}</div>
                  </div>
                </div>

                {isScenario && !hasScenario ? (
                  <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Run a simulation first to generate this report.
                  </div>
                ) : null}

                <div className="mt-auto pt-4">
                  <Button
                    size="sm"
                    disabled={disabled || isGenerating}
                    onClick={() => handleGenerateReport(rt.id)}
                    className="w-full"
                  >
                    {isGenerating ? (
                      <>
                        <Spinner size={14} />
                        <span className="ml-2">Generating...</span>
                      </>
                    ) : (
                      "Download PDF"
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {workspaceId ? (
        <SectionCard title="Report history" subtitle="Previously generated reports.">
          {reportHistory.length ? (
            <div className="space-y-2">
              {reportHistory.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{r.title}</div>
                    <div className="text-xs text-slate-500">
                      {r.created_at
                        ? new Date(r.created_at).toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      r.status === "generated"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500">No reports generated yet.</div>
          )}
        </SectionCard>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
        <strong>Disclaimer:</strong> All reports are decision-support documents based on the data you have
        entered. They do not constitute financial advice. Consult a qualified adviser before making significant
        business decisions.
      </div>
    </div>
  );
}
