import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import Badge from "../components/Badge";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import SectionCard from "../components/SectionCard";
import SegmentedTabs from "../components/SegmentedTabs";
import StatTile from "../components/StatTile";
import InfoTip from "../components/InfoTip";
import { useWorkspaceStore } from "../store/workspace";
import { formatCurrency, formatNumber, formatPercent } from "../lib/format";
import { buildActionPlan, dedupeText } from "../lib/insights";
import { pctWidth, shortExplanation, toneForScore } from "../lib/score";
import WorkspacePrompt from "../components/WorkspacePrompt";
import ReportDownloadPanel from "../components/ReportDownloadPanel";
import { assembleOutput } from "../lib/contracts/index";

function decisionBadge(status) {
  if (status === "accepted") return { text: "ACCEPTED", tone: "success" };
  if (status === "rejected") return { text: "REJECTED", tone: "danger" };
  return { text: "PENDING", tone: "slate" };
}

function riskCopy(classification) {
  if (classification === "STRONG") return { title: "Low Risk", subtitle: "Good baseline unit economics at current assumptions.", tone: "success" };
  if (classification === "PROMISING") return { title: "Moderate Risk", subtitle: "There are clear levers to improve viability.", tone: "warn" };
  if (classification === "RISKY") return { title: "High Risk", subtitle: "Address major risks before launch.", tone: "warn" };
  return { title: "High Failure Risk", subtitle: "Tighten assumptions and reduce costs before investing further.", tone: "danger" };
}

function CircularScore({ score, size = 120, strokeWidth = 10, tone = "success" }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (score / 100) * circumference;

  const colors = {
    success: { stroke: "#10b981", bg: "#ecfdf5" },
    warn: { stroke: "#f59e0b", bg: "#fffbeb" },
    danger: { stroke: "#ef4444", bg: "#fef2f2" },
    slate: { stroke: "#64748b", bg: "#f8fafc" }
  };

  const config = colors[tone] || colors.success;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={config.bg}
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={config.stroke}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-bold text-slate-900">{score ? Math.round(score) : 0}</span>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Score</span>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const navigate = useNavigate();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const setDecisionStatusStore = useWorkspaceStore((s) => s.setDecisionStatus);
  const setServiceDecisionStatusStore = useWorkspaceStore((s) => s.setServiceDecisionStatus);
  const validation = useWorkspaceStore((s) => s.validation);
  const currency = useWorkspaceStore((s) => s.currency);
  const ideaValidation = useWorkspaceStore((s) => s.ideaValidation);

  const [error, setError] = useState(null);
  const [decision, setDecision] = useState(null); // accepted | rejected | null
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState(null);
  const [sideTab, setSideTab] = useState("breakdown"); // breakdown | reasons | recommendations
  const [viewMode, setViewMode] = useState("simple"); // simple | detailed
  const [signalsTab, setSignalsTab] = useState("trend"); // trend | community
  const [marketFitTab, setMarketFitTab] = useState("score"); // score | demand | survival | competition
  const [marketFit, setMarketFit] = useState(null);
  const [mfLoading, setMfLoading] = useState(false);
  const [mfError, setMfError] = useState(null);
  const [serviceDraft, setServiceDraft] = useState(null);
  const [activeValidationId, setActiveValidationId] = useState(null);
  const [activeServiceValidationId, setActiveServiceValidationId] = useState(null);
  const isServiceIdeaView = Boolean(validation?.scores && validation?.metrics && validation?.outcome);
  const decisionMeta = decisionBadge(decision);

  useEffect(() => {
    async function loadDecision() {
      if (!workspaceId) return;
      try {
        const ws = await apiRequest(`/validation/${workspaceId}`, "GET");
        setWorkspaceName(ws?.name || null);
        if (ws?.data?.draft_service_idea) {
          setServiceDraft(ws.data.draft_service_idea);
        }
        if (isServiceIdeaView) {
          const history = Array.isArray(ws?.data?.service_validation_history) ? ws.data.service_validation_history : [];
          const activeId = ws?.data?.active_service_validation_id;
          setActiveServiceValidationId(activeId || history[0]?.id || null);
          const active = activeId ? history.find((h) => h?.id === activeId) : history[0];
          const status = active?.decision_status;
          if (status === "accepted" || status === "rejected") {
            setDecision(status);
            setServiceDecisionStatusStore(status);
            setDecisionStatusStore(null);
          } else {
            setDecision(null);
            setServiceDecisionStatusStore(null);
            setDecisionStatusStore(null);
          }
        } else {
          const status = ws?.data?.decision?.status;
          setActiveValidationId(ws?.data?.active_validation_id || null);
          if (status === "accepted" || status === "rejected") {
            setDecision(status);
            setDecisionStatusStore(status);
            setServiceDecisionStatusStore(null);
          } else {
            setDecision(null);
            setDecisionStatusStore(null);
            setServiceDecisionStatusStore(null);
          }
        }
      } catch {
        // ignore
      }
    }
    loadDecision();
  }, [isServiceIdeaView, workspaceId, setDecisionStatusStore, setServiceDecisionStatusStore, setWorkspaceName]);

  const mfBusinessName = String(ideaValidation?.context?.business_name || "").trim();
  const mfPrimaryIndustry = String(ideaValidation?.context?.primary_industry || "").trim();
  const mfBusinessType = String(ideaValidation?.context?.business_type || "").trim();
  const mfOfferName = String(ideaValidation?.offer?.service_type || "").trim();

  const mfKeyword = useMemo(() => {
    const parts = [mfBusinessName, mfPrimaryIndustry || mfOfferName || mfBusinessType].filter(Boolean);
    return parts.join(" ").trim();
  }, [mfBusinessName, mfBusinessType, mfOfferName, mfPrimaryIndustry]);

  const fetchMarketFit = useCallback(async () => {
    if (!mfKeyword) return;
    setMfLoading(true);
    setMfError(null);
    try {
      const params = new URLSearchParams({
        keyword: mfKeyword,
        industry: mfPrimaryIndustry || mfBusinessType || mfOfferName || "general",
        location: String(ideaValidation?.context?.location || "London"),
        uk_region: String(ideaValidation?.context?.uk_region || "GB-ENG")
      });
      const data = await apiRequest(`/validation/market-fit?${params.toString()}`, "GET", null, { timeoutMs: 12000 });
      setMarketFit(data);
    } catch (e) {
      setMfError(e instanceof Error ? e.message : "Could not load market fit.");
    } finally {
      setMfLoading(false);
    }
  }, [ideaValidation, mfBusinessType, mfKeyword, mfOfferName, mfPrimaryIndustry]);

  useEffect(() => {
    if (!marketFit && !mfLoading && mfKeyword) fetchMarketFit();
  }, [fetchMarketFit, marketFit, mfKeyword, mfLoading]);

  async function setDecisionStatus(status) {
    if (!workspaceId) return;
    setDecisionSaving(true);
    setError(null);
    setDecisionNotice(null);
    try {
      const patchPayload = { data: {} };
      const ws = await apiRequest(`/validation/${workspaceId}`, "GET");
      const validationHistory = Array.isArray(ws?.data?.validation_history) ? ws.data.validation_history : [];
      if (isServiceIdeaView) {
        const history = Array.isArray(ws?.data?.service_validation_history) ? ws.data.service_validation_history : [];
        const activeId = ws?.data?.active_service_validation_id;
        const active = activeId ? history.find((h) => h?.id === activeId) : history[0];
        const activeEntryId = active?.id;
        const nextHistory = history.map((h) => {
          if (!activeEntryId || h?.id !== activeEntryId) return h;
          return { ...h, decision_status: status, decided_at: new Date().toISOString() };
        });
        patchPayload.data.service_validation_history = nextHistory;
        if (activeEntryId) patchPayload.data.active_service_validation_id = activeEntryId;
        patchPayload.data.validation_history = validationHistory.map((entry) =>
          entry?.id === activeEntryId ? { ...entry, status, decided_at: new Date().toISOString() } : entry
        );
      } else {
        const activeValidationId = ws?.data?.active_validation_id;
        patchPayload.data.decision = { status, decided_at: new Date().toISOString() };
        patchPayload.data.validation_history = validationHistory.map((entry) =>
          entry?.id === activeValidationId ? { ...entry, status, decided_at: new Date().toISOString() } : entry
        );
        if (status === "accepted" && ideaValidation) {
          patchPayload.data.idea_validation = ideaValidation;
          patchPayload.data.draft_idea_validation = null;
        }
      }

      // For product/service pathway, only persist to catalogue when the user explicitly accepts.
      if (isServiceIdeaView && status === "accepted" && serviceDraft) {
        const serviceName = String(serviceDraft.service_name || "").trim() || "Service";
        const productFromValidation = {
          id: crypto.randomUUID(),
          name: serviceName,
          type: "service",
          base_price: Number(serviceDraft.price_per_sale || 0),
          discount: 0,
          freight_cost: 0,
          archived: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const existingCatalogue = ws?.data?.catalogue || {};
        const existingProducts = Array.isArray(existingCatalogue?.products) ? existingCatalogue.products : [];
        const alreadyExists = existingProducts.some(
          (p) => String(p?.name || "").trim().toLowerCase() === productFromValidation.name.toLowerCase()
        );
        const nextProducts = alreadyExists ? existingProducts : [productFromValidation, ...existingProducts];
        patchPayload.data.catalogue = {
          products: nextProducts,
          customers: Array.isArray(existingCatalogue?.customers) ? existingCatalogue.customers : [],
          vendors: Array.isArray(existingCatalogue?.vendors) ? existingCatalogue.vendors : [],
        };
      }

      await apiRequest(`/validation/${workspaceId}`, "PATCH", {
        data: patchPayload.data
      });
      setDecision(status);
      if (!isServiceIdeaView) setDecisionStatusStore(status);
      if (isServiceIdeaView) setServiceDecisionStatusStore(status);
      setDecisionNotice(status === "accepted" ? "Validation accepted." : "Validation rejected.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save decision");
    } finally {
      setDecisionSaving(false);
    }
  }

  if (!validation) {
    return (
      <WorkspacePrompt
        title="No results yet"
        subtitle="Save a workspace in Idea Validation, then run evaluation to see results here."
        ctaLabel="Go to Idea Validation"
      />
    );
  }

  const isServiceIdea = Boolean(validation?.scores && validation?.metrics && validation?.outcome);
  const serviceMetrics = validation?.metrics || {};
  const serviceScores = validation?.scores || {};
  const serviceOutcome = String(validation?.outcome || "").trim();
  const serviceRiskFlags = Array.isArray(validation?.risk_flags) ? validation.risk_flags : [];

  if (isServiceIdea) {
    const serviceDecisionLocked = decision === "accepted" || decision === "rejected";
    const viabilityScore = typeof serviceScores?.viability_score === "number" ? serviceScores.viability_score : 0;
    const serviceCategory = serviceDraft?.service_category ? String(serviceDraft.service_category).replaceAll("_", " ") : "";
    const targetCustomer = serviceDraft?.target_customer_type || "";
    const marketScope = serviceDraft?.target_market_scope ? String(serviceDraft.target_market_scope).replaceAll("_", " ") : "";
    const serviceDesc = String(serviceDraft?.service_description || "").trim();

    const expectedSales = Number(serviceDraft?.expected_sales_per_month || 0);
    const hoursPerSale = Number(serviceDraft?.hours_required_per_sale || 0);
    const suggestedHours = expectedSales > 0 && hoursPerSale > 0 ? expectedSales * hoursPerSale : null;
    const availableHours = Number(serviceDraft?.available_delivery_hours_per_month || 0) || null;
    let workforceMessage = "";
    let workforceKind = "default";
    if (suggestedHours && availableHours != null) {
      const diff = Math.round((availableHours - suggestedHours) * 100) / 100;
      if (diff === 0) {
        workforceMessage = "Enough workforce for your expected demand.";
        workforceKind = "success";
      } else if (diff > 0) {
        workforceMessage = "More than enough workforce for your expected demand.";
        workforceKind = "default";
      } else {
        workforceMessage = "Need more workforce to meet your expected demand.";
        workforceKind = "warn";
      }
    }
    const capacityUtilisationDisplay =
      typeof serviceMetrics.capacity_utilisation === "number"
        ? formatPercent(serviceMetrics.capacity_utilisation)
        : "—";
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => navigate("/validation")}
            className="group flex w-fit items-center gap-2 text-sm font-bold text-slate-500 transition-colors hover:text-brand-600"
          >
            <svg className="h-4 w-4 transition-transform group-hover:-translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5m7 7l-7-7 7-7" />
            </svg>
            Back to Validation
          </button>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 sm:text-2xl">
                  {isServiceIdea ? (validation?.service_name || "Service idea") : (businessName || validation?.business_name || "Business Concept")}
                </div>
                {serviceOutcome ? <Badge>{serviceOutcome}</Badge> : null}
                <Badge tone={decisionMeta.tone}>{decisionMeta.text}</Badge>
              </div>
              <div className="mt-1 text-sm text-slate-600">Service idea viability results.</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                disabled={!workspaceId}
                onClick={() =>
                  navigate(
                    `/validation?workspace_id=${workspaceId}${activeServiceValidationId ? `&history_id=${encodeURIComponent(activeServiceValidationId)}&history_type=service_validation` : ""}`
                  )
                }
              >
                Modify
              </Button>
              <Button
                variant="danger"
                className={serviceDecisionLocked ? "opacity-50" : ""}
                disabled={decisionSaving || !workspaceId || serviceDecisionLocked}
                onClick={() => setDecisionStatus("rejected")}
              >
                Reject
              </Button>
              <Button
                className={serviceDecisionLocked ? "opacity-50" : ""}
                disabled={decisionSaving || !workspaceId || serviceDecisionLocked}
                onClick={() => setDecisionStatus("accepted")}
              >
                Accept
              </Button>
            </div>
          </div>
        </div>

        {error ? <InlineAlert kind="error" message={error} /> : null}
        {decisionNotice ? <InlineAlert message={decisionNotice} /> : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-8">
            <SectionCard title="Service overview" subtitle="Context for this product / service idea.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-slate-500">Category</div>
                  <div className="mt-1 text-sm text-slate-700">{serviceCategory || "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500">Target customer</div>
                  <div className="mt-1 text-sm text-slate-700">{targetCustomer || "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500">Market scope</div>
                  <div className="mt-1 text-sm text-slate-700">{marketScope || "—"}</div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs font-semibold text-slate-500">Description</div>
                  <div className="mt-1 text-sm text-slate-700">{serviceDesc || "—"}</div>
                </div>
              </div>
            </SectionCard>

            {suggestedHours ? (
              <SectionCard title="Workforce check" subtitle="Suggested delivery hours based on your expected demand.">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <StatTile label="Expected sales / month" value={formatNumber(expectedSales)} info="Expected sales volume per month." />
                  <StatTile label="Hours required / sale" value={formatNumber(hoursPerSale)} info="Hours required to deliver one sale." />
                  <StatTile label="Suggested hours / month" value={formatNumber(suggestedHours)} info="Expected sales per month × hours required per sale." />
                  <StatTile label="Available hours / month" value={availableHours == null ? "—" : formatNumber(availableHours)} info="Your available delivery hours per month." />
                  <StatTile label="Status" value={workforceMessage || "—"} tone={workforceKind} info="Compares available delivery hours with the suggested hours." />
                </div>
                {workforceKind === "warn" ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <div className="font-semibold">Recommendation: run a hiring scenario to test capacity expansion.</div>
                    <Button size="sm" variant="secondary" onClick={() => navigate("/simulation?template=tmpl_hire_staff")}>
                      Run hire scenario
                    </Button>
                  </div>
                ) : null}
              </SectionCard>
            ) : null}
            <SectionCard
              title="Viability metrics"
              subtitle="Revenue, costs, and delivery feasibility."
              className="bg-white"
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <StatTile
                  label="Monthly revenue"
                  value={formatCurrency(serviceMetrics.monthly_revenue, currency)}
                  info="Price per sale × expected sales per month."
                />
                <StatTile
                  label="Monthly variable cost"
                  value={formatCurrency(serviceMetrics.monthly_variable_cost, currency)}
                  info="Direct delivery costs × expected sales per month."
                />
                <StatTile
                  label="Monthly fixed cost"
                  value={formatCurrency(serviceMetrics.monthly_fixed_cost, currency)}
                  info="Software, marketing, admin, rent, and other fixed costs."
                />
                <StatTile
                  label="Contribution / sale"
                  value={formatCurrency(serviceMetrics.contribution_per_sale, currency)}
                  info="Price per sale minus variable cost per sale."
                />
                <StatTile
                  label="Contribution margin"
                  value={formatPercent(serviceMetrics.contribution_margin)}
                  info="(Monthly revenue - monthly variable cost) / monthly revenue."
                />
                <StatTile
                  label="Break-even months"
                  info="Time to cover monthly fixed costs at current assumptions."
                  value={serviceMetrics.break_even_months == null ? "—" : `${formatNumber(serviceMetrics.break_even_months)} months`}
                />
                <StatTile
                  label="Capacity sales / month"
                  value={formatNumber(serviceMetrics.capacity_sales_per_month)}
                  info="Available delivery hours / hours required per sale."
                />
                <StatTile
                  label="Capacity utilisation"
                  value={capacityUtilisationDisplay}
                  info="Expected sales / capacity sales per month."
                />
                <StatTile
                  label="Capacity feasible"
                  value={serviceMetrics.capacity_feasible ? "Yes" : "No"}
                  info="Whether expected sales can be delivered with current capacity."
                />
              </div>
            </SectionCard>

            <SectionCard title="Interpretation" subtitle="Summary and recommendation.">
              <div className="space-y-2 text-sm text-slate-700">
                <div>{validation?.interpretation?.summary || "—"}</div>
                <div><strong>Key driver:</strong> {validation?.interpretation?.key_driver || "—"}</div>
                <div><strong>Recommendation:</strong> {validation?.interpretation?.recommendation || "—"}</div>
              </div>
            </SectionCard>

          </div>

          <aside className="space-y-4 lg:col-span-4 lg:sticky lg:top-24">
            <div className={`relative overflow-hidden rounded-3xl border-2 p-8 shadow-xl transition-all duration-500 ${viabilityScore < 50 ? "border-rose-100 bg-white shadow-rose-100/50" :
              viabilityScore < 75 ? "border-amber-100 bg-white shadow-amber-100/50" :
                "border-emerald-100 bg-white shadow-emerald-100/50"
              }`}>
              <div className={`absolute top-0 left-0 w-1.5 h-full ${viabilityScore < 50 ? "bg-rose-500" :
                viabilityScore < 75 ? "bg-amber-500" :
                  "bg-emerald-500"
                }`} />

              <div className="flex flex-col items-center text-center">
                <CircularScore
                  score={viabilityScore}
                  tone={viabilityScore < 50 ? "danger" : viabilityScore < 75 ? "warn" : "success"}
                  size={140}
                  strokeWidth={12}
                />

                <div className="mt-8">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">Outcome</div>
                  <div className={`text-2xl font-black tracking-tight ${viabilityScore < 50 ? "text-rose-600" :
                    viabilityScore < 75 ? "text-amber-600" :
                      "text-emerald-600"
                    }`}>
                    {serviceOutcome}
                  </div>
                </div>

                <div className="mt-8 w-full pt-6 border-t border-slate-100">
                  <div className="flex items-center justify-center gap-2 px-4 py-2 rounded-2xl bg-slate-50 text-[11px] font-bold text-slate-500 ring-1 ring-slate-100">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                    <span>SERVICE VIABILITY ANALYSIS</span>
                  </div>
                </div>
              </div>
            </div>

            <SectionCard title="Score breakdown" subtitle="Weighted viability scores (0-100).">
              <div className="grid grid-cols-1 gap-3">
                {[
                  ["Margin score", serviceScores.margin_score],
                  ["Break-even score", serviceScores.break_even_score],
                  ["Demand score", serviceScores.demand_score],
                  ["Capacity score", serviceScores.capacity_score],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="text-xs font-semibold text-slate-500">{label}</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(value)}/100</div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full bg-indigo-500" style={{ width: pctWidth(value || 0) }} />
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Risk flags" subtitle="Key issues to watch.">
              {serviceRiskFlags.length ? (
                <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                  {serviceRiskFlags.map((flag) => (
                    <li key={flag}>{String(flag).replace(/_/g, " ")}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-slate-600">No risk flags.</div>
              )}
            </SectionCard>

          </aside>
        </div>

      </div>
    );
  }

  const score = typeof validation.score === "number" ? validation.score : 0;
  const classification = String(validation.classification || "RISKY").toUpperCase();
  const risk = riskCopy(classification);

  const pathwayLabel =
    validation.pathway === "product_service_idea" ? "Product / service idea" : validation.pathway === "business_idea" ? "Business idea" : null;

  const m = validation.metrics ?? {};
  const revenue = typeof m.revenue_monthly === "number" ? m.revenue_monthly : null;
  const costs = typeof m.costs_monthly === "number" ? m.costs_monthly : null;
  const margin = typeof m.margin === "number" ? m.margin : null;
  const be = typeof m.break_even_months === "number" ? m.break_even_months : null;
  const runway = typeof m.runway_months === "number" ? m.runway_months : null;
  const net = typeof m.net_monthly === "number" ? m.net_monthly : null;
  const capacity = typeof m.capacity === "object" && m.capacity ? m.capacity : null;
  const utilization = typeof capacity?.utilization === "number" ? capacity.utilization : null;
  const burn = typeof revenue === "number" && typeof costs === "number" ? Math.max(0, costs - revenue) : null;
  const demandUnits = typeof capacity?.demand_units_per_month === "number" ? capacity.demand_units_per_month : null;
  const capacityUnits = typeof capacity?.capacity_units_per_month === "number" ? capacity.capacity_units_per_month : null;
  const shortfall = typeof capacity?.shortfall_units === "number" ? capacity.shortfall_units : null;

  const flags = Array.isArray(validation.flags) ? validation.flags : [];
  const dimensionScores = validation.dimension_scores && typeof validation.dimension_scores === "object" ? validation.dimension_scores : null;
  const businessName = String(ideaValidation?.context?.business_name || "").trim() || null;
  const primaryIndustry = String(ideaValidation?.context?.primary_industry || "").trim() || null;
  const businessType = String(ideaValidation?.context?.business_type || "").trim() || null;
  const offerName = String(ideaValidation?.offer?.service_type || "").trim() || null;

  const reasons = useMemo(() => dedupeText(validation.reasons), [validation.reasons]);
  const actionPlan = useMemo(() => buildActionPlan({ validation, ideaValidation, maxItems: 10 }), [ideaValidation, validation]);

  const keywordsToTrack = useMemo(() => {
    const out = [];
    if (businessName) out.push(businessName);
    if (primaryIndustry) out.push(primaryIndustry);
    if (offerName) out.push(offerName);
    if (!primaryIndustry && businessType) out.push(businessType);
    return dedupeText(out).slice(0, 6);
  }, [businessName, businessType, offerName, primaryIndustry]);

  const orderedDimensions = useMemo(() => {
    if (!dimensionScores) return [];
    const preferred = ["market_demand", "market_trend", "unit_economics", "break_even", "runway", "capacity", "market_fit", "cash_timing", "proof", "sales_cycle", "concentration"];
    const present = new Set(Object.keys(dimensionScores || {}));
    const base = preferred.filter((k) => present.has(k));
    const rest = Object.keys(dimensionScores || {}).filter((k) => !base.includes(k));
    return [...base, ...rest].slice(0, 6);
  }, [dimensionScores]);

  const validationExplanation =
    String(validation?.validation_explanation || validation?.market_research?.executive_summary || "").trim() ||
    "Validation summary is being generated based on market signals and research. Your score reflects the deterministic strength of the concept.";

  const DIMENSION_META = useMemo(
    () => ({
      runway: { label: "Runway", help: "Measures how long your existing cash reserves can sustain the current burn rate." },
      cash_timing: { label: "Cash timing", help: "Risk analysis of your payment terms and working capital cycle." },
      capacity: { label: "Capacity", help: "Evaluation of whether your team can deliver the expected volume." },
      unit_economics: { label: "Unit economics", help: "Deterministic profitability analysis of your price vs variable costs." },
      break_even: { label: "Break-even", help: "Time required to cover all fixed costs based on current margins." },
      market_fit: { label: "Market fit", help: "Real-world signals including search trends, industry survival, and competition density." },
      proof: { label: "Market proof", help: "Strength of validation evidence from customer conversations and pilots." },
      sales_cycle: { label: "Sales cycle", help: "Analysis of time-to-revenue and its impact on your liquidity." },
      concentration: { label: "Concentration", help: "Risk assessment of over-dependency on a single client or sector." },
      problem_severity: { label: "Problem Severity", help: "Intelligence on how 'urgent' or 'painful' the problem is for the target customer." },
      market_demand: { label: "Market Demand", help: "External proof of interest and search volume for this solution." },
      competition_validation: { label: "Competition", help: "Analysis of market existence proof via existing competitors." },
      differentiation: { label: "Differentiation", help: "Strength of your unique value proposition compared to alternatives." },
      evidence_strength: { label: "Evidence Strength", help: "Quality and volume of direct customer feedback collected." },
      market_trend: { label: "Market Trend", help: "Momentum and growth trajectory of the target sector." }
    }),
    []
  );

  function dimLabel(key) {
    const k = String(key || "").trim();
    const meta = DIMENSION_META[k];
    if (meta?.label) return meta.label;
    return k.replaceAll("_", " ");
  }

  function dimHelp(key) {
    const k = String(key || "").trim();
    const fromBackend = validation?.dimension_explanations && typeof validation.dimension_explanations === "object" ? validation.dimension_explanations[k] : null;
    return fromBackend || DIMENSION_META[k]?.help || "Validation metric based on deterministic engine scoring.";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => navigate("/validation")}
          className="group flex w-fit items-center gap-2 text-sm font-bold text-slate-500 transition-colors hover:text-brand-600"
        >
          <svg className="h-4 w-4 transition-transform group-hover:-translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5m7 7l-7-7 7-7" />
          </svg>
          Back to Validation
        </button>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 sm:text-2xl">
                {validation.pathway === "product_service_idea"
                  ? (validation?.service_name || "Service Idea")
                  : (validation?.business_name || "Business Concept Idea")}
              </div>
              <Badge tone={decisionMeta.tone}>{decisionMeta.text}</Badge>
              {pathwayLabel ? <Badge>{pathwayLabel}</Badge> : null}
            </div>
            <div className="mt-1 text-sm text-slate-600">Validation report and recommended next steps.</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SegmentedTabs
              ariaLabel="View mode"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: "simple", label: "Simple" },
                { value: "detailed", label: "Detailed" }
              ]}
            />
            <Button
              variant="secondary"
              disabled={!workspaceId}
              onClick={() =>
                navigate(
                  `/validation?workspace_id=${workspaceId}${activeValidationId ? `&history_id=${encodeURIComponent(activeValidationId)}&history_type=business_validation` : ""}`
                )
              }
            >
              Modify
            </Button>
            <Button variant="danger" disabled={decisionSaving || !workspaceId} onClick={() => setDecisionStatus("rejected")}>
              Reject
            </Button>
            <Button disabled={decisionSaving || !workspaceId} onClick={() => setDecisionStatus("accepted")}>
              Accept
            </Button>
          </div>
        </div>
      </div>

      {error ? <InlineAlert kind="error" message={error} /> : null}
      {decisionNotice ? <InlineAlert message={decisionNotice} /> : null}

      <ReportDownloadPanel
        output={assembleOutput({
          workspaceId,
          currency: currency || "GBP",
          ideaValidation,
        })}
        currency={currency || "GBP"}
        reportTypes={["business_health_report", "investor_summary", "fragility_report", "stability_report"]}
        compact
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          {!isServiceIdea && viewMode === "simple" ? (
            <SectionCard title="Market Intelligence" subtitle="AI-driven summary of your validation result.">
              <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 p-6 shadow-inner ring-1 ring-brand-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  </div>
                  <h4 className="text-base font-bold text-slate-900">Executive Summary</h4>
                </div>
                <p className="text-sm leading-relaxed font-medium text-slate-700 italic">
                  &ldquo;{validationExplanation}&rdquo;
                </p>
              </div>
            </SectionCard>
          ) : !isServiceIdea && viewMode === "detailed" ? (
            <SectionCard title="Validation Engine Data" subtitle="Underlying deterministic metrics for this idea.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <StatTile label="Calculated Score" value={`${score}/100`} info="Weighted average based on problem severity, demand proof, and research signals." />
                <StatTile label="Classification" value={classification} info="Overall market fit category." />
                <StatTile label="Currency" value={currency || "GBP"} info="Currency used for any estimates." />
              </div>
            </SectionCard>
          ) : (
            <SectionCard
              title="Deterministic baseline model"
              subtitle="Unit economics and feasibility from your structured inputs."
              className="bg-white"
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <StatTile
                  label="Monthly revenue"
                  value={formatCurrency(revenue, currency)}
                  info="Estimated revenue per month based on price and expected volume."
                />
                <StatTile
                  label="Monthly net"
                  value={formatCurrency(net, currency)}
                  info="Monthly surplus (positive) or deficit (negative)."
                />
                <StatTile label="Contribution margin" value={formatPercent(margin)} info="(Revenue - costs) / revenue." />

                <StatTile
                  label="Break-even"
                  value={be === null ? "—" : `${formatNumber(be)} months`}
                  info="How long it takes to cover fixed costs given your current plan."
                />
                <StatTile
                  label="Capacity feasible"
                  value={capacity?.feasible === true ? "Yes" : capacity?.feasible === false ? "No" : "Unknown"}
                  info="Whether your delivery capacity can meet expected demand."
                  tone={capacity?.feasible === true ? "success" : capacity?.feasible === false ? "danger" : "default"}
                />
                <StatTile
                  label="Runway"
                  value={runway === null ? "Infinity" : `${formatNumber(runway)} months`}
                  info="How many months your cash can cover your burn. Infinity means cashflow-positive."
                />
              </div>

              {viewMode === "detailed" ? (
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <StatTile label="Monthly costs" value={formatCurrency(costs, currency)} info="Fixed + variable costs per month." />
                  <StatTile label="Burn / month" value={burn === null ? "—" : formatCurrency(burn, currency)} info="If costs exceed revenue, burn is the gap you fund with cash." tone={burn && burn > 0 ? "warn" : "default"} />
                  <StatTile
                    label="Capacity utilization"
                    value={utilization === null ? "—" : formatPercent(utilization)}
                    info="Demand divided by delivery capacity."
                    tone={utilization !== null && utilization > 1 ? "danger" : utilization !== null && utilization > 0.8 ? "warn" : "default"}
                  />
                  <StatTile label="Demand units / month" value={formatNumber(demandUnits)} info="Units you expect to deliver per month." />
                  <StatTile label="Capacity units / month" value={formatNumber(capacityUnits)} info="Max units your team can deliver per month." />
                  <StatTile label="Shortfall units" value={formatNumber(shortfall)} info="How many units exceed capacity (if any)." tone={shortfall && shortfall > 0 ? "danger" : "default"} />
                </div>
              ) : null}
            </SectionCard>
          )}

          {!isServiceIdea ? (
            <SectionCard title="Validation Insights" subtitle="Deeper breakdown of market signals.">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-2 w-2 rounded-full bg-rose-500" />
                    <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Critical Risks</div>
                  </div>
                  <ul className="space-y-3">
                    {reasons.length ? reasons.slice(0, 6).map((r, i) => (
                      <li key={i} className="flex gap-3 text-sm text-slate-700 leading-relaxed">
                        <span className="shrink-0 text-slate-300 select-none">•</span>
                        {r}
                      </li>
                    )) : <li className="text-sm text-slate-400 italic">No critical risks identified.</li>}
                  </ul>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-2 w-2 rounded-full bg-brand-500" />
                    <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Strategic Roadmap</div>
                  </div>
                  <ul className="space-y-3">
                    {actionPlan.length ? actionPlan.slice(0, 6).map((r, i) => (
                      <li key={i} className="flex gap-3 text-sm text-slate-700 leading-relaxed">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[10px] font-bold text-brand-600 ring-1 ring-brand-200">
                          {i + 1}
                        </span>
                        {r}
                      </li>
                    )) : <li className="text-sm text-slate-400 italic">No actions recommended yet.</li>}
                  </ul>
                </div>
              </div>
            </SectionCard>
          ) : viewMode === "simple" ? (
            <SectionCard title="Insights" subtitle="Key risks and what to do next.">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Key risks</div>
                  <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-700">
                    {reasons.length ? reasons.slice(0, 8).map((r) => <li key={r}>{r}</li>) : <li>Run a validation to generate risks.</li>}
                  </ul>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Action plan</div>
                  <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-700">
                    {actionPlan.length ? actionPlan.slice(0, 8).map((r) => <li key={r}>{r}</li>) : <li>Update inputs to generate actions.</li>}
                  </ul>
                </div>
              </div>
            </SectionCard>
          ) : null}

          {viewMode === "simple" && !isServiceIdea ? (
            <SectionCard
              title="Market Health Signals"
              subtitle="Real-time validation signals from Google Trends, Companies House, and Local Market."
              headerRight={<InfoTip text="Signals are derived from live market analysis of your business concept and location." />}
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 shadow-sm">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 6l-9.5 9.5-5-5L1 18" /><path d="M17 6h6v6" /></svg>
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Demand Trend</span>
                  </div>
                  <div className="text-lg font-black text-slate-900 capitalize">
                    {validation?.metrics?.market_fit?.demand?.trend_direction || "Stable"}
                  </div>
                  <div className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    {validation?.metrics?.market_fit?.demand?.explanation || "Search interest suggests a steady baseline for this category."}
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 shadow-sm">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Sector Survival</span>
                  </div>
                  <div className="text-lg font-black text-slate-900">
                    {validation?.metrics?.market_fit?.sector?.survival_ratio ? formatPercent(validation.metrics.market_fit.sector.survival_ratio) : "60%"}
                  </div>
                  <div className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    {validation?.metrics?.market_fit?.sector?.explanation || "Average survival rates detected for new incorporations in this SIC category."}
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 shadow-sm">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" /></svg>
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Competition</span>
                  </div>
                  <div className="text-lg font-black text-slate-900 capitalize">
                    {validation?.metrics?.market_fit?.competition?.competition_level || "Balanced"}
                  </div>
                  <div className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    {validation?.metrics?.market_fit?.competition?.explanation || "Standard level of local competition detected for this keyword and radius."}
                  </div>
                </div>
              </div>
            </SectionCard>
          ) : null}

          {flags?.length && viewMode === "detailed" ? (
            <SectionCard title="Flags" subtitle="Issues worth addressing early.">
              <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                {flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          {viewMode === "detailed" ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard
                title="Trend score"
                subtitle="Keyword trend and community signals."
                className="flex h-[360px] flex-col"
                headerRight={
                  <div className="w-full max-w-[260px]">
                    <SegmentedTabs
                      ariaLabel="Trend score tabs"
                      value={signalsTab}
                      onChange={setSignalsTab}
                      size="sm"
                      options={[
                        { value: "trend", label: "Keyword trend" },
                        { value: "community", label: "Community" }
                      ]}
                    />
                  </div>
                }
              >
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1">
                  {signalsTab === "trend" ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Keyword trend</div>
                        <InfoTip text="We build the keyword set from your Business name + Industry + Offer. Trend data appears when connected." />
                      </div>

                      <div className="grid grid-cols-1 gap-3">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Keywords to track</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(keywordsToTrack.length ? keywordsToTrack : ["Add business name and industry to generate keywords."]).map((k) => (
                              <span key={k} className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                                {k}
                              </span>
                            ))}
                          </div>
                          <div className="mt-3 text-xs text-slate-500">We will track demand signals and query growth for these terms.</div>
                        </div>

                        <div className="rounded-2xl border border-dashed border-slate-300 bg-gradient-to-br from-brand-50 via-white to-accent-50 p-4">
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Trend preview</div>
                            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">Market signals</span>
                          </div>
                          <div className="mt-3 rounded-xl bg-white/70 p-3 text-sm text-slate-600 ring-1 ring-slate-200">
                            {keywordsToTrack.length
                              ? "Keyword trend insights will appear here when demand data is connected."
                              : "Add business name and industry details to generate keywords and prepare the trend preview."}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Community signals</div>
                        <InfoTip text="Mentions and discussions related to your space. Signals appear when connected." />
                      </div>

                      <div className="grid grid-cols-1 gap-3">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mentions</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">-</div>
                          <div className="mt-1 text-xs text-slate-500">Across tracked communities</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Momentum</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">-</div>
                          <div className="mt-1 text-xs text-slate-500">Week-over-week change</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top spaces</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">-</div>
                          <div className="mt-1 text-xs text-slate-500">Where people discuss it</div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                        No community signals yet.
                      </div>
                    </div>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="Insights" subtitle="Breakdown, reasons, and recommendations." className="flex h-[360px] flex-col overflow-hidden">
                <SegmentedTabs
                  ariaLabel="Insights tabs"
                  value={sideTab}
                  onChange={setSideTab}
                  options={[
                    { value: "breakdown", label: "Score" },
                    { value: "reasons", label: "Reasons" },
                    { value: "recommendations", label: "Actions" }
                  ]}
                />

                <div className="mt-4 flex-1 min-h-0 overflow-auto pr-1">
                  {sideTab === "breakdown" ? (
                    <div className="space-y-2 text-sm text-slate-700">
                      <div className="flex items-center justify-between">
                        <div className="text-slate-600">Monthly revenue</div>
                        <div className="font-semibold text-slate-900">{formatCurrency(revenue, currency)}</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-slate-600">Monthly costs</div>
                        <div className="font-semibold text-slate-900">{formatCurrency(costs, currency)}</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-slate-600">Monthly net</div>
                        <div className="font-semibold text-slate-900">{formatCurrency(net, currency)}</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-slate-600">Break-even</div>
                        <div className="font-semibold text-slate-900">{be === null ? "—" : `${formatNumber(be)} months`}</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-slate-600">Runway</div>
                        <div className="font-semibold text-slate-900">{runway === null ? "Infinity" : `${formatNumber(runway)} months`}</div>
                      </div>
                    </div>
                  ) : sideTab === "reasons" ? (
                    <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                      {reasons.slice(0, 999).map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                      {actionPlan.length ? actionPlan.slice(0, 999).map((r) => <li key={r}>{r}</li>) : <li>Update inputs to generate actions.</li>}
                    </ul>
                  )}
                </div>
              </SectionCard>
            </div>
          ) : null}
        </div>

        <aside className="space-y-4 lg:col-span-4 lg:sticky lg:top-24">
          <div className={`relative overflow-hidden rounded-3xl border-2 p-8 shadow-xl transition-all duration-500 ${risk.tone === "danger" ? "border-rose-100 bg-white shadow-rose-100/50" :
            risk.tone === "warn" ? "border-amber-100 bg-white shadow-amber-100/50" :
              "border-emerald-100 bg-white shadow-emerald-100/50"
            }`}>
            <div className={`absolute top-0 left-0 w-1.5 h-full ${risk.tone === "danger" ? "bg-rose-500" :
              risk.tone === "warn" ? "bg-amber-500" :
                "bg-emerald-500"
              }`} />

            <div className="flex flex-col items-center text-center">
              <CircularScore score={score} tone={risk.tone} size={140} strokeWidth={12} />

              <div className="mt-8">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">Verdict</div>
                <div className={`text-2xl font-black tracking-tight ${risk.tone === "danger" ? "text-rose-600" :
                  risk.tone === "warn" ? "text-amber-600" :
                    "text-emerald-600"
                  }`}>
                  {risk.title}
                </div>
                <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600 max-w-[240px]">
                  {risk.subtitle}
                </p>
              </div>

              <div className="mt-8 w-full pt-6 border-t border-slate-100">
                <div className="flex items-center justify-center gap-2 px-4 py-2 rounded-2xl bg-slate-50 text-[11px] font-bold text-slate-500 ring-1 ring-slate-100">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                  <span>BASED ON DETERMINISTIC ANALYSIS</span>
                </div>
              </div>
            </div>
          </div>

          <SectionCard title={!isServiceIdea ? "Idea Strength Dimensions" : "Validation scores"} subtitle={!isServiceIdea ? "Breakdown of the evaluation engine logic." : "Quick view by dimension."} headerRight={<InfoTip text={validationExplanation} />}>
            {dimensionScores ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {orderedDimensions.map((k) => {
                  const v = typeof dimensionScores?.[k] === "number" ? dimensionScores[k] : 0;
                  const label = dimLabel(k);
                  const help = dimHelp(k);
                  const tone = toneForScore(v);
                  return (
                    <div key={k} className={`group relative rounded-2xl border bg-white p-4 transition-all hover:shadow-md ${tone.borderClass}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-bold uppercase tracking-wider text-slate-400 group-hover:text-slate-600 transition-colors">{label}</div>
                        <InfoTip text={help} />
                      </div>
                      <div className="mt-2 flex items-baseline gap-1">
                        <div className="text-2xl font-black text-slate-900">{formatNumber(v)}</div>
                        <div className="text-sm font-bold text-slate-400">/100</div>
                      </div>
                      <div className={`mt-3 h-2 w-full overflow-hidden rounded-full ${tone.trackClass}`}>
                        <div className={`h-full transition-all duration-1000 ${tone.barClass}`} style={{ width: pctWidth(v) }} />
                      </div>
                      <div className="mt-3 text-[11px] font-medium leading-relaxed text-slate-500">
                        {shortExplanation(help, 140)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-slate-600">No score breakdown available yet.</div>
            )}
          </SectionCard>

          {viewMode === "detailed" ? (
            <SectionCard
              title="Market fit"
              subtitle="Demand trend, sector survival, and local competition."
              className="flex h-[360px] flex-col overflow-hidden"
              headerRight={mfKeyword ? <InfoTip text={`Signals for: ${mfKeyword}`} /> : null}
            >
              {!mfKeyword ? (
                <div className="text-sm text-slate-600">Add a business name and industry to load market fit.</div>
              ) : mfLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                  Fetching signals…
                </div>
              ) : mfError ? (
                <div className="space-y-2">
                  <InlineAlert tone="danger" title="Market fit unavailable" message={mfError} />
                  <Button variant="secondary" onClick={fetchMarketFit}>
                    Retry
                  </Button>
                </div>
              ) : marketFit?.market_fit_score == null ? (
                <div className="text-sm text-slate-600">No market fit data yet.</div>
              ) : (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <div className="mb-3">
                    <SegmentedTabs
                      ariaLabel="Market fit tabs"
                      value={marketFitTab}
                      onChange={setMarketFitTab}
                      size="sm"
                      options={[
                        { value: "score", label: "Market fit score" },
                        { value: "demand", label: "Demand trend" },
                        { value: "survival", label: "Sector survival" },
                        { value: "competition", label: "Local competition" }
                      ]}
                    />
                  </div>

                  {marketFitTab === "score" ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Market fit score</div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">{formatNumber(marketFit.market_fit_score)}/100</div>
                      <div className="mt-1 text-sm font-semibold text-slate-700">{String(marketFit.market_fit_classification || "—")}</div>
                      <div className="mt-3 text-xs text-slate-600">
                        {shortExplanation(String(marketFit.market_fit_explanation || ""), 180)}
                      </div>
                    </div>
                  ) : (
                    (() => {
                      const map = {
                        demand: ["market_demand", "Demand trend"],
                        survival: ["sector_survival", "Sector survival"],
                        competition: ["local_competition", "Local competition"]
                      };
                      const [key, label] = map[marketFitTab] || map.demand;
                      const v = typeof marketFit?.dimension_scores?.[key] === "number" ? marketFit.dimension_scores[key] : 0;
                      const help = String(marketFit?.dimension_explanations?.[key] || "");
                      return (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                          <div className="mt-1 text-2xl font-semibold text-slate-900">{formatNumber(v)}/100</div>
                          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full bg-indigo-500" style={{ width: pctWidth(v) }} />
                          </div>
                          <div className="mt-3 text-xs text-slate-600">{help || "—"}</div>
                        </div>
                      );
                    })()
                  )}
                </div>
              )}
            </SectionCard>
          ) : null}

        </aside>
      </div>
    </div>
  );
}
