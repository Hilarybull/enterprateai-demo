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
  const setValidation = useWorkspaceStore((s) => s.setValidation);
  const validation = useWorkspaceStore((s) => s.validation);
  const location = useWorkspaceStore((s) => s.inputs?.location || s.inputs?.country || "United Kingdom");
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
        if (ws?.data?.idea_validation_result) {
          setValidation(ws.data.idea_validation_result);
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
          // Read status from the active validation history entry, not the stale global decision object
          const validationHistory = Array.isArray(ws?.data?.validation_history) ? ws.data.validation_history : [];
          const activeValidationId = ws?.data?.active_validation_id || null;
          setActiveValidationId(activeValidationId);
          const activeEntry = activeValidationId
            ? validationHistory.find((h) => h?.id === activeValidationId)
            : validationHistory[0];
          const status = activeEntry?.status || activeEntry?.decision_status || null;
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
  const mfBusinessOffering = String(ideaValidation?.context?.business_offering || "").trim();

  const mfKeyword = useMemo(() => {
    // USER REQUEST: Use actual idea name, not workspace/business name.
    // Order of priority: business_offering -> service_type -> industry -> business_name (fallback)
    const primary = mfBusinessOffering || mfOfferName || mfPrimaryIndustry || mfBusinessType;
    if (primary) return primary;
    return mfBusinessName || "Business Idea";
  }, [mfBusinessName, mfBusinessOffering, mfBusinessType, mfOfferName, mfPrimaryIndustry]);

  const fetchMarketFit = useCallback(async () => {
    if (!mfKeyword) return;
    setMfLoading(true);
    setMfError(null);
    try {
      let finalLocation = String(ideaValidation?.context?.location || location);
      if (finalLocation === "National") finalLocation = "United Kingdom";

      const params = new URLSearchParams({
        keyword: mfKeyword,
        industry: mfPrimaryIndustry || mfBusinessType || mfOfferName || "general",
        location: finalLocation,
        uk_region: String(ideaValidation?.context?.uk_region || "GB-ENG")
      });
      const data = await apiRequest(`/validation/market-fit?${params.toString()}`, "GET", null, { timeoutMs: 12000 });
      setMarketFit(data);
    } catch (e) {
      setMfError(e instanceof Error ? e.message : "Could not load market fit.");
    } finally {
      setMfLoading(false);
    }
  }, [ideaValidation, mfBusinessType, mfKeyword, mfOfferName, mfPrimaryIndustry, location]);

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
    const preferred = ["problem_severity", "customer_clarity", "demand_validation", "market_evidence", "differentiation", "trend_strength"];
    const present = new Set(Object.keys(dimensionScores || {}));
    const base = preferred.filter((k) => present.has(k));
    const rest = Object.keys(dimensionScores || {}).filter((k) => !base.includes(k));
    return [...base, ...rest].slice(0, Math.max(6, base.length));
  }, [dimensionScores]);

  const validationExplanation =
    String(validation?.validation_explanation || validation?.market_research?.executive_summary || "").trim() ||
    "Validation summary is being generated based on market signals and research. Your score reflects the deterministic strength of the concept.";

  const DIMENSION_META = useMemo(
    () => ({
      customer_clarity: { label: "Customer Clarity", help: "Measures how specifically you have defined your target segment. Broad audiences lead to lower scores." },
      demand_validation: { label: "Demand Evidence", help: "Strength of validation from direct interviews and concrete proof signals like signups or preorders." },
      market_evidence: { label: "Market Opportunity", help: "Live market signals from SERPAPI including competitor activity and search volume indicators." },
      trend_strength: { label: "Market Momentum", help: "Trajectory of the sector based on Google Trends and industry news cycles." },
      problem_severity: { label: "Problem Strength", help: "Intelligence on how 'urgent' or 'painful' the problem is for the target customer." },
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
    <div className="w-full max-w-full space-y-4 overflow-x-hidden px-1">
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
            {!decision && (
              <>
                <Button variant="danger" disabled={decisionSaving || !workspaceId} onClick={() => setDecisionStatus("rejected")}>
                  Reject
                </Button>
                <Button disabled={decisionSaving || !workspaceId} onClick={() => setDecisionStatus("accepted")}>
                  Accept
                </Button>
              </>
            )}
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
          marketResearch: validation?.market_research,
        })}
        currency={currency || "GBP"}
        reportTypes={["business_health_report", "investor_summary", "fragility_report", "stability_report"]}
        compact
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          {!isServiceIdea && viewMode === "simple" ? (
            <SectionCard title="Market Intelligence" subtitle="AI-driven summary of your validation result.">
              <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-gradient-to-br from-brand-50 via-white to-brand-100 p-4 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-brand-200/50">
                <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-200/20 blur-3xl" />
                <div className="absolute -left-20 -bottom-20 h-64 w-64 rounded-full bg-accent-200/20 blur-3xl" />

                <div className="relative">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-200 ring-4 ring-brand-50">
                      <svg className="w-6 h-6 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        <path d="M8 9h8" /><path d="M8 13h6" />
                      </svg>
                    </div>
                    <div>
                      <h4 className="text-lg font-black tracking-tight text-slate-900">Executive Synthesis</h4>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500"></span>
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-brand-600/80">Live AI Reasoning</span>
                      </div>
                    </div>
                  </div>

                  <div className="relative rounded-2xl border border-white bg-white/40 p-6 backdrop-blur-sm">
                    <p className="text-[15px] leading-relaxed font-semibold text-slate-800 italic">
                      &ldquo;{validationExplanation}&rdquo;
                    </p>
                  </div>

                  {validation?.market_research?.risks?.length > 0 && (
                    <div className="mt-6 flex flex-wrap gap-2">
                      {validation.market_research.risks.slice(0, 3).map((risk, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
                          {risk}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>
          ) : !isServiceIdea && viewMode === "detailed" ? (
            <SectionCard title="Validation Engine Data" subtitle="Underlying deterministic metrics for this idea.">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <StatTile
                  label="Calculated Score"
                  value={`${Math.round(score)}/100`}
                  info="Weighted average based on problem severity, demand proof, and research signals."
                  className="bg-white shadow-sm ring-1 ring-slate-200"
                />
                <StatTile
                  label="Classification"
                  value={classification}
                  info="Overall market fit category."
                  className="bg-white shadow-sm ring-1 ring-slate-200"
                />
                <StatTile
                  label="Currency"
                  value={currency || "GBP"}
                  info="Currency used for any estimates."
                  className="bg-white shadow-sm ring-1 ring-slate-200"
                />
              </div>
            </SectionCard>
          ) : (
            <SectionCard
              title={dimensionScores?.problem_severity !== undefined ? "Validation strength" : "Deterministic baseline model"}
              subtitle={dimensionScores?.problem_severity !== undefined ? "Performance across core validation dimensions." : "Unit economics and feasibility from your structured inputs."}
              className="bg-white"
            >
              {dimensionScores?.problem_severity !== undefined ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {orderedDimensions.map((key) => (
                    <StatTile
                      key={key}
                      label={dimLabel(key)}
                      value={`${Math.round(dimensionScores[key] || 0)}/100`}
                      info={dimHelp(key)}
                      tone={(dimensionScores[key] || 0) >= 80 ? "success" : (dimensionScores[key] || 0) >= 50 ? "warn" : "danger"}
                      className="bg-white shadow-sm ring-1 ring-slate-100 hover:ring-brand-200 transition-all"
                    />
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                      <StatTile label="Monthly costs" value={formatCurrency(costs, currency)} info="Fixed + variable costs per month." />
                      <StatTile label="Burn / month" value={burn === null ? "—" : formatCurrency(burn, currency)} info="If costs exceed revenue, burn is the gap you fund with cash." tone={burn && burn > 0 ? "warn" : "default"} />
                      <StatTile
                        label="Capacity utilization"
                        value={utilization === null ? "—" : formatPercent(utilization)}
                        info="Demand divided by delivery capacity."
                        tone={utilization !== null && utilization > 1 ? "danger" : utilization !== null && utilization > 0.8 ? "warn" : "default"}
                      />
                    </div>
                  ) : null}
                </>
              )}
            </SectionCard>
          )}

          {!isServiceIdea ? (
            <div className="space-y-4">
              <SectionCard title="Validation Insights" subtitle="Deeper breakdown of market signals.">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="rounded-2xl sm:rounded-[2.5rem] border border-slate-200 bg-white p-4 sm:p-8 shadow-[0_10px_40px_rgba(0,0,0,0.02)]">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600 shadow-sm">
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 9v4" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="10" /></svg>
                      </div>
                      <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Critical Risks</div>
                    </div>
                    <ul className="space-y-4">
                      {reasons.length ? reasons.slice(0, 6).map((r, i) => (
                        <li key={i} className="flex gap-4 text-sm font-medium text-slate-700 leading-relaxed group">
                          <span className="shrink-0 mt-1 flex h-2 w-2 rounded-full bg-rose-400 group-hover:scale-125 transition-transform" />
                          {r}
                        </li>
                      )) : <li className="text-sm text-slate-400 italic">No critical risks identified.</li>}
                    </ul>
                  </div>

                  <div className="rounded-2xl sm:rounded-[2.5rem] border border-slate-200 bg-white p-4 sm:p-8 shadow-[0_10px_40px_rgba(0,0,0,0.02)]">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 shadow-sm">
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                      </div>
                      <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Strategic Roadmap</div>
                    </div>
                    <ul className="space-y-4">
                      {actionPlan.length ? actionPlan.slice(0, 6).map((r, i) => (
                        <li key={i} className="flex gap-4 text-sm font-medium text-slate-700 leading-relaxed group">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-[10px] font-black text-white shadow-md shadow-brand-100 group-hover: rotate-12 transition-transform">
                            {i + 1}
                          </span>
                          {r}
                        </li>
                      )) : <li className="text-sm text-slate-400 italic">No actions recommended yet.</li>}
                    </ul>
                  </div>
                </div>
              </SectionCard>

              {validation?.market_research?.market_opportunity && (
                <SectionCard title="Market Opportunity" subtitle="Growth trends and TAM/SAM signals.">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-3xl border border-slate-100 bg-slate-50/50 p-6">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Opportunity Summary</div>
                      <p className="text-sm font-semibold text-slate-700 leading-relaxed">
                        {validation.market_research.market_opportunity.summary}
                      </p>
                      <div className="mt-4 space-y-2">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400 font-bold uppercase">Market size</span>
                          <span className="text-slate-700 font-black">{validation.market_research.market_opportunity.market_size}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400 font-bold uppercase">Growth rate</span>
                          <span className="text-slate-700 font-black">{validation.market_research.market_opportunity.growth_rate}</span>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-3xl border border-slate-100 bg-white p-6">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Key trends</div>
                      <ul className="space-y-2">
                        {validation.market_research.market_opportunity.key_trends?.map((t, i) => (
                          <li key={i} className="flex items-center gap-2 text-xs font-bold text-slate-600">
                            <div className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </SectionCard>
              )}

              {validation?.market_research?.target_customer && (
                <SectionCard title="Target Customer Profile" subtitle="Pain points and buying behaviour.">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="md:col-span-2 rounded-2xl sm:rounded-3xl border border-slate-100 p-4 sm:p-6 bg-white">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Customer Profile</div>
                      <div className="text-lg font-black text-slate-900 mb-4">{validation.market_research.target_customer.profile}</div>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <div className="text-[9px] font-black text-slate-400 uppercase mb-2">Primary Pain Points</div>
                          <ul className="space-y-2">
                            {validation.market_research.target_customer.pain_points?.map((p, i) => (
                              <li key={i} className="text-xs font-bold text-slate-600 flex gap-2">
                                <span className="text-brand-500">→</span> {p}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="text-[9px] font-black text-slate-400 uppercase mb-2">Buying Behaviour</div>
                          <p className="text-xs font-semibold text-slate-600 leading-relaxed">
                            {validation.market_research.target_customer.buying_behaviour}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-2xl sm:rounded-3xl bg-slate-900 p-4 sm:p-6 text-white">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-4">Urgency & WTP</div>
                      <div className="space-y-6">
                        <div>
                          <div className="text-[9px] font-black text-slate-500 uppercase mb-1">Pain Urgency</div>
                          <div className="text-base font-black text-brand-400">{validation.market_research.target_customer.urgency}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-black text-slate-500 uppercase mb-1">Willingness to Pay</div>
                          <div className="text-base font-black text-emerald-400">{validation.market_research.target_customer.willingness_to_pay}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </SectionCard>
              )}

              {validation?.market_research?.pricing_strategy && (
                <SectionCard title="Monetization & Strategy" subtitle="Pricing models and positioning.">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-2xl sm:rounded-3xl border border-slate-100 bg-white p-4 sm:p-6">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Pricing Model</div>
                      <div className="text-xl font-black text-slate-900 leading-tight mb-2">
                        {validation.market_research.pricing_strategy.recommended_model}
                      </div>
                      <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                        {validation.market_research.pricing_strategy.rationale}
                      </p>
                      <div className="mt-6 flex gap-3">
                        {validation.market_research.recommended_price_range && (
                          Object.entries(validation.market_research.recommended_price_range).map(([tier, val]) => (
                            tier !== "currency" && (
                              <div key={tier} className="flex-1 p-3 rounded-2xl bg-slate-50 text-center">
                                <div className="text-[8px] font-black text-slate-400 uppercase mb-1">{tier}</div>
                                <div className="text-xs font-black text-slate-900">{val}</div>
                              </div>
                            )
                          ))
                        )}
                      </div>
                    </div>
                    <div className="rounded-3xl border border-slate-100 bg-slate-50/50 p-6">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Positioning</div>
                      <div className="space-y-4">
                        <div>
                          <div className="text-[9px] font-black text-slate-400 uppercase mb-1">Value Proposition</div>
                          <div className="text-sm font-bold text-slate-700">{validation.market_research.positioning?.value_proposition}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-black text-slate-400 uppercase mb-1">Differentiation</div>
                          <div className="text-sm font-bold text-slate-700">{validation.market_research.positioning?.differentiation}</div>
                        </div>
                        <div className="pt-2">
                          <div className="px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-black text-center shadow-lg shadow-brand-200">
                            "{validation.market_research.positioning?.headline_message}"
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </SectionCard>
              )}

              {validation?.market_research?.go_to_market && (
                <SectionCard title="Launch Roadmap" subtitle="Channels and timeline.">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-2xl sm:rounded-3xl border border-slate-100 bg-white p-4 sm:p-6">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Primary Channels</div>
                      <div className="flex flex-wrap gap-2">
                        {validation.market_research.go_to_market.primary_channels?.map((c, i) => (
                          <span key={i} className="px-3 py-1.5 rounded-xl bg-slate-100 text-[10px] font-black text-slate-600">
                            {c}
                          </span>
                        ))}
                      </div>
                      <div className="mt-6">
                        <div className="text-[9px] font-black text-slate-400 uppercase mb-2">Quick Wins</div>
                        <ul className="space-y-2">
                          {validation.market_research.go_to_market.quick_wins?.map((w, i) => (
                            <li key={i} className="text-xs font-bold text-emerald-600 flex gap-2 italic">
                              ✓ {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="rounded-2xl sm:rounded-3xl bg-brand-50 border border-brand-100 p-4 sm:p-6 flex flex-col justify-center">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-400 mb-3">Execution Timeline</div>
                      <div className="text-2xl font-black text-brand-900 leading-tight">
                        {validation.market_research.go_to_market.timeline}
                      </div>
                      <p className="mt-2 text-xs font-bold text-brand-600">Phase 1 Rollout Strategy</p>
                    </div>
                  </div>
                </SectionCard>
              )}
            </div>
          ) : viewMode === "simple" ? (
            <SectionCard title="Insights" subtitle="Key risks and what to do next.">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4">Key risks</div>
                  <ul className="list-disc space-y-3 pl-5 text-[13px] font-medium text-slate-700">
                    {reasons.length ? reasons.slice(0, 8).map((r) => <li key={r}>{r}</li>) : <li>Run a validation to generate risks.</li>}
                  </ul>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4">Action plan</div>
                  <ul className="list-disc space-y-3 pl-5 text-[13px] font-medium text-slate-700">
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
                <div className="group rounded-3xl bg-white p-6 ring-1 ring-slate-200 shadow-sm transition-all hover:ring-brand-500 hover:shadow-md">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 6l-9.5 9.5-5-5L1 18" /><path d="M17 6h6v6" /></svg>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Demand Trend</span>
                  </div>
                  <div className="text-xl font-black text-slate-900 capitalize tracking-tight">
                    {validation?.market_fit?.demand?.trend_direction || marketFit?.demand?.trend_direction || "Stable"}
                  </div>
                  <div className="mt-3 text-[11px] leading-relaxed font-medium text-slate-500">
                    {validation?.market_research?.market_health_narration?.demand_trend ||
                      validation?.market_fit?.demand?.explanation ||
                      marketFit?.demand?.explanation ||
                      "Search interest suggests a steady baseline for this category."}
                  </div>
                </div>

                <div className="group rounded-3xl bg-white p-6 ring-1 ring-slate-200 shadow-sm transition-all hover:ring-emerald-500 hover:shadow-md">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Sector Survival</span>
                  </div>
                  <div className="text-xl font-black text-slate-900 tracking-tight">
                    {validation?.market_fit?.sector?.survival_ratio
                      ? formatPercent(validation.market_fit.sector.survival_ratio)
                      : (marketFit?.sector?.survival_ratio ? formatPercent(marketFit.sector.survival_ratio) : "60%")}
                  </div>
                  <div className="mt-3 text-[11px] leading-relaxed font-medium text-slate-500">
                    {validation?.market_research?.market_health_narration?.sector_survival ||
                      validation?.market_fit?.sector?.explanation ||
                      marketFit?.sector?.explanation ||
                      "Average survival rates detected for new incorporations in this SIC category."}
                  </div>
                </div>

                <div className="group rounded-3xl bg-white p-6 ring-1 ring-slate-200 shadow-sm transition-all hover:ring-amber-500 hover:shadow-md">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Competition</span>
                  </div>
                  <div className="text-xl font-black text-slate-900 capitalize tracking-tight">
                    {validation?.market_fit?.competition?.competition_level || marketFit?.competition?.competition_level || "Balanced"}
                  </div>
                  <div className="mt-3 text-[11px] leading-relaxed font-medium text-slate-500">
                    {validation?.market_research?.market_health_narration?.competition ||
                      validation?.market_fit?.competition?.explanation ||
                      marketFit?.competition?.explanation ||
                      "Standard level of local competition detected for this keyword and radius."}
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
                    <div className="space-y-3 pt-2">
                      {orderedDimensions.map(key => (
                        <div key={key} className="flex items-center justify-between group">
                          <div className="text-slate-600 text-[13px] font-medium">{dimLabel(key)}</div>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-1000 ${(dimensionScores[key] || 0) >= 80 ? 'bg-emerald-500' :
                                  (dimensionScores[key] || 0) >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                                  }`}
                                style={{ width: `${dimensionScores[key] || 0}%` }}
                              />
                            </div>
                            <div className="font-bold text-slate-900 text-xs w-6 text-right">{Math.round(dimensionScores[key] || 0)}</div>
                          </div>
                        </div>
                      ))}
                      {dimensionScores?.problem_severity === undefined && (
                        <>
                          <div className="flex items-center justify-between border-t border-slate-100 pt-2 mt-2">
                            <div className="text-slate-600">Break-even</div>
                            <div className="font-semibold text-slate-900">{be === null ? "—" : `${formatNumber(be)} months`}</div>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="text-slate-600">Runway</div>
                            <div className="font-semibold text-slate-900">{runway === null ? "Infinity" : `${formatNumber(runway)} months`}</div>
                          </div>
                        </>
                      )}
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

        <aside className="space-y-6 lg:col-span-4 lg:sticky lg:top-24">
          <div className={`relative overflow-hidden rounded-2xl sm:rounded-[2.5rem] border p-6 sm:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.04)] transition-all duration-700 ${risk.tone === "danger" ? "border-rose-100 bg-white ring-8 ring-rose-50/50" :
            risk.tone === "warn" ? "border-amber-100 bg-white ring-8 ring-amber-50/50" :
              "border-emerald-100 bg-white ring-8 ring-emerald-50/50"
            }`}>
            <div className={`absolute top-0 left-0 w-2 h-full ${risk.tone === "danger" ? "bg-gradient-to-b from-rose-400 to-rose-600" :
              risk.tone === "warn" ? "bg-gradient-to-b from-amber-400 to-amber-600" :
                "bg-gradient-to-b from-emerald-400 to-emerald-600"
              }`} />

            <div className="flex flex-col items-center text-center">
              <div className="relative group">
                <div className={`absolute -inset-4 rounded-full blur-2xl opacity-20 transition-all duration-700 group-hover:opacity-40 ${risk.tone === "danger" ? "bg-rose-500" : risk.tone === "warn" ? "bg-amber-500" : "bg-emerald-500"}`} />
                <CircularScore score={score} tone={risk.tone} size={160} strokeWidth={14} />
              </div>

              <div className="mt-10">
                <div className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400 mb-3">Overall Verdict</div>
                <div className={`text-3xl font-black tracking-tight leading-none ${risk.tone === "danger" ? "text-rose-600" :
                  risk.tone === "warn" ? "text-amber-600" :
                    "text-emerald-600"
                  }`}>
                  {classification}
                </div>
                <p className="mt-3 text-xs font-semibold text-slate-500 max-w-[200px] mx-auto leading-relaxed">
                  {validation?.market_research?.viability_score?.summary || risk.subtitle}
                </p>
              </div>

              <div className="mt-10 w-full pt-8 border-t border-slate-100/80">
                <div className="flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-2xl bg-slate-50 text-[10px] font-black text-slate-500 ring-1 ring-slate-100">
                  <div className={`h-1.5 w-1.5 rounded-full animate-pulse ${risk.tone === "danger" ? "bg-rose-500" : risk.tone === "warn" ? "bg-amber-500" : "bg-emerald-500"}`} />
                  <span>DETERMINISTIC ENGINE 3.0</span>
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
