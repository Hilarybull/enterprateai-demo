import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Cell, Tooltip,
  PieChart, Pie, Legend,
} from "recharts";
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
import { useAuthStore } from "../store/auth";
import { planAllowsScenario } from "../lib/plans";
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
  const validationEntryId = useWorkspaceStore((s) => s.validationEntryId);
  const location = useWorkspaceStore((s) => s.inputs?.location || s.inputs?.country || "United Kingdom");
  const currency = useWorkspaceStore((s) => s.currency);
  const ideaValidation = useWorkspaceStore((s) => s.ideaValidation);

  const subscription = useAuthStore((s) => s.subscription);
  const planKey = subscription?.plan_key ?? "free_trial";
  const planStatus = subscription?.status ?? "trial";
  const simulationEnabled = planStatus === "grandfathered" || planStatus === "active";

  function simCardClick(templateId) {
    if (!simulationEnabled) {
      navigate("/pricing");
    } else {
      navigate(`/simulation?template=${templateId}`);
    }
  }

  const [error, setError] = useState(null);
  const [decision, setDecision] = useState(null); // accepted | rejected | null
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState(null);
  const [sideTab, setSideTab] = useState("breakdown"); // breakdown | reasons | recommendations
  const [viewMode, setViewMode] = useState("simple"); // simple | detailed
  const [dimTab, setDimTab] = useState("vps"); // vps | ecs — V4 dimension breakdown tabs
  const [signalsTab, setSignalsTab] = useState("trend"); // trend | community
  const [marketFitTab, setMarketFitTab] = useState("score"); // score | demand | survival | competition
  const [marketFit, setMarketFit] = useState(null);
  const [mfLoading, setMfLoading] = useState(false);
  const [mfError, setMfError] = useState(null);
  const [serviceDraft, setServiceDraft] = useState(null);
  const [activeValidationId, setActiveValidationId] = useState(null);
  const [simTemplates, setSimTemplates] = useState([]);
  useEffect(() => {
    apiRequest("/v1/scenario-intelligence/scenario-templates", "GET")
      .then((data) => { if (Array.isArray(data)) setSimTemplates(data); })
      .catch(() => {});
  }, []);
  const [activeServiceValidationId, setActiveServiceValidationId] = useState(null);
  const [svcMarketResearch, setSvcMarketResearch] = useState(null);
  const [svcMrLoading, setSvcMrLoading] = useState(false);
  const [svcMrError, setSvcMrError] = useState(null);
  const svcMrFiredRef = useRef(false);
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

        // V4 active history entry takes priority over legacy idea_validation_result
        const vHistory = Array.isArray(ws?.data?.validation_history) ? ws.data.validation_history : [];
        const activeVId = ws?.data?.active_validation_id || null;
        const activeVEntry = activeVId ? vHistory.find((h) => h?.id === activeVId) : vHistory[0];
        if (activeVEntry?.result?.engine_version === "4.0") {
          setValidation(activeVEntry.result);
        } else if (ws?.data?.idea_validation_result) {
          setValidation(ws.data.idea_validation_result);
        }

        if (isServiceIdeaView) {
          const history = Array.isArray(ws?.data?.service_validation_history) ? ws.data.service_validation_history : [];
          const activeId = ws?.data?.active_service_validation_id;
          setActiveServiceValidationId(activeId || history[0]?.id || null);
          const active = activeId ? history.find((h) => h?.id === activeId) : history[0];

          // Load market research — from workspace cache first, then from active entry result
          const wsMr = ws?.data?.service_market_research;
          const entryMr = active?.result?.market_research || active?.market_research;
          const mr = (wsMr && typeof wsMr === "object" && Object.keys(wsMr).length > 0) ? wsMr
                   : (entryMr && typeof entryMr === "object" && Object.keys(entryMr).length > 0) ? entryMr
                   : null;
          if (mr) {
            setSvcMarketResearch(mr);
            svcMrFiredRef.current = true;
          }
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
          // Read status from the active validation history entry
          const validationHistory = vHistory;
          const activeValidationId = activeVId;
          setActiveValidationId(activeValidationId);
          const activeEntry = activeVEntry;
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

  function runSvcMr() {
    if (!serviceDraft || svcMrLoading) return;
    svcMrFiredRef.current = true;
    setSvcMrLoading(true);
    setSvcMrError(null);
    apiRequest("/validation/market-research", "POST", { idea_validation: serviceDraft }, { timeoutMs: 240000 })
      .then((res) => {
        if (res && typeof res === "object" && Object.keys(res).length > 0) {
          setSvcMarketResearch(res);
          // Cache in workspace so next page load shows results instantly
          if (workspaceId) {
            apiRequest(`/validation/${workspaceId}`, "PATCH", { data: { service_market_research: res } }).catch(() => {});
          }
        } else {
          setSvcMrError("No data returned. Try again.");
        }
      })
      .catch(() => { setSvcMrError("Research timed out or failed. Tap retry."); })
      .finally(() => setSvcMrLoading(false));
  }

  useEffect(() => {
    if (!isServiceIdeaView || !serviceDraft || svcMrFiredRef.current) return;
    // If the validation result already carries market research, use it and skip the re-run
    const embeddedMr = validation?.market_research;
    if (embeddedMr && typeof embeddedMr === "object" && Object.keys(embeddedMr).length > 0) {
      setSvcMarketResearch(embeddedMr);
      svcMrFiredRef.current = true;
      return;
    }
    const hasContent = serviceDraft.service_description || serviceDraft.service_name;
    if (!hasContent) return;
    runSvcMr();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isServiceIdeaView, serviceDraft]);

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

      // Catalogue sync for ALL validation types
      const existingCatalogue = ws?.data?.catalogue || {};
      const existingProducts = Array.isArray(existingCatalogue?.products) ? existingCatalogue.products : [];

      // Determine the product name coming from either pathway
      const isV4 = validation?.engine_version === "4.0";
      let syncProduct = null;
      if (isV4 && validation?.idea_name) {
        const rawPrice = String(validation.proposed_price || "").replace(/[^0-9.]/g, "");
        syncProduct = {
          id: validationEntryId || crypto.randomUUID(),
          name: String(validation.idea_name).trim(),
          type: validation.idea_type || "Product",
          base_price: rawPrice ? Number(rawPrice) : 0,
          discount: 0,
          freight_cost: 0,
          description: String(validation.idea_tagline || validation.idea_description || "").trim(),
          archived: false,
          source: "idea_validation",
          validation_id: validationEntryId || null,
          validation_snapshot: {
            industry: validation.idea_sector || "",
            target_customer: validation.primary_segment || "",
            problem: validation.problem_description || "",
            solution: validation.solution_description || "",
            value_prop: validation.idea_tagline || validation.idea_description || "",
            revenue_model: validation.revenue_model || "",
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      } else if (isServiceIdeaView && serviceDraft) {
        const rawPrice = Number(serviceDraft.price_per_sale || 0);
        syncProduct = {
          id: crypto.randomUUID(),
          name: String(serviceDraft.service_name || "").trim() || "Service",
          type: "service",
          base_price: rawPrice,
          discount: 0,
          freight_cost: 0,
          archived: false,
          source: "service_validation",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }

      if (syncProduct) {
        const productName = syncProduct.name.toLowerCase();
        const validationId = syncProduct.validation_id;
        if (status === "accepted") {
          // Add if not already present (match by validation_id or name)
          const exists = existingProducts.some(
            (p) => (validationId && p.validation_id === validationId) ||
                   String(p?.name || "").trim().toLowerCase() === productName
          );
          const nextProducts = exists
            ? existingProducts.map((p) =>
                ((validationId && p.validation_id === validationId) ||
                 String(p?.name || "").trim().toLowerCase() === productName)
                  ? { ...p, ...syncProduct, archived: false }
                  : p
              )
            : [syncProduct, ...existingProducts];
          patchPayload.data.catalogue = {
            products: nextProducts,
            customers: Array.isArray(existingCatalogue?.customers) ? existingCatalogue.customers : [],
            vendors: Array.isArray(existingCatalogue?.vendors) ? existingCatalogue.vendors : [],
          };
          if (isV4) patchPayload.data.v4_accepted_validation = validation;
        } else if (status === "rejected") {
          // Archive the matching product
          const nextProducts = existingProducts.map((p) =>
            ((validationId && p.validation_id === validationId) ||
             String(p?.name || "").trim().toLowerCase() === productName)
              ? { ...p, archived: true, updated_at: new Date().toISOString() }
              : p
          );
          patchPayload.data.catalogue = {
            products: nextProducts,
            customers: Array.isArray(existingCatalogue?.customers) ? existingCatalogue.customers : [],
            vendors: Array.isArray(existingCatalogue?.vendors) ? existingCatalogue.vendors : [],
          };
          if (isV4) patchPayload.data.v4_accepted_validation = null;
        }
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

  // ---- V4 RESULT VIEW ----
  const isV4Result = validation?.engine_version === "4.0" || validation?.pathway === "v4_universal" || Boolean(validation?.validation_mode && !validation?.metrics);
  if (isV4Result) {
    const vps = validation.scores?.potential_score ?? 0;
    const ecs = validation.scores?.evidence_confidence_score ?? 0;
    const v4Verdict = validation.verdict || {};
    const verdictCategory = v4Verdict.category || v4Verdict.label || "Unknown";
    const BASIC_HIDDEN = new Set(["unit_economics", "operational_feasibility", "founder_readiness", "regulatory_risk"]);
    const narration = validation.market_research || {};
    const ideaName = validation.idea_name || validation.business_name || "Idea Validation";
    const validationMode = validation.validation_mode || "basic";
    const isPaid = Boolean(validation.is_paid_plan);
    const isBasic = validationMode === "basic";
    const allVpsDims = Array.isArray(validation.scores?.vps_dimensions) ? validation.scores.vps_dimensions : [];
    const vpsDims = isBasic ? allVpsDims.filter((d) => !BASIC_HIDDEN.has(d.dimension)) : allVpsDims;
    const ecsDims = Array.isArray(validation.scores?.ecs_dimensions) ? validation.scores.ecs_dimensions : [];
    const v4Contradictions = Array.isArray(validation.contradictions) ? validation.contradictions : [];
    const experiments = Array.isArray(validation.experiments) ? validation.experiments : [];
    const riskFlags = (Array.isArray(validation.risk_flags) ? validation.risk_flags : [])
      .filter((rf) => !(isBasic && BASIC_HIDDEN.has(rf.dimension)));

    const vpsTone = vps >= 75 ? "success" : vps >= 55 ? "warn" : "danger";
    const ecsTone = ecs >= 60 ? "success" : ecs >= 40 ? "warn" : "danger";

    const VERDICT_TONE = {
      "Weak Hypothesis": "danger", "Needs Reframing": "danger",
      "Developing Fit": "warn", "Promising but Unvalidated": "warn",
      "Strong Hypothesis, Insufficient Evidence": "warn",
      "Evidence-Supported Opportunity": "success", "Ready for Controlled Pilot": "success",
      "Early Market Validation": "success", "Ready for Scale Assessment": "success",
    };
    const vtone = VERDICT_TONE[verdictCategory] || "slate";
    const vBg = vtone === "success" ? "bg-emerald-50 border-emerald-200" : vtone === "warn" ? "bg-amber-50 border-amber-200" : vtone === "danger" ? "bg-rose-50 border-rose-200" : "bg-slate-50 border-slate-200";
    const vText = vtone === "success" ? "text-emerald-800" : vtone === "warn" ? "text-amber-800" : vtone === "danger" ? "text-rose-800" : "text-slate-700";
    const vBadge = vtone === "success" ? "bg-emerald-600" : vtone === "warn" ? "bg-amber-500" : vtone === "danger" ? "bg-rose-600" : "bg-slate-500";

    function dimBarColor(pct) {
      if (pct >= 70) return "bg-emerald-500";
      if (pct >= 45) return "bg-amber-500";
      return "bg-rose-500";
    }
    function v4DimLabel(key) {
      return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }

    const cleanAi = (s) => (s || "")
      .replace(/—/g, " ")
      .replace(/–/g, " to ")
      .replace(/(\d)\s*[-]\s*(\d)/g, "$1 to $2")
      .replace(/\s{2,}/g, " ")
      .trim();
    const overviewSummary = cleanAi(narration.executive_summary);
    const verdictInterp = cleanAi(v4Verdict.description || narration.verdict_interpretation?.explanation || "");
    const recommendations = (Array.isArray(validation.recommendations) ? validation.recommendations
      : Array.isArray(narration.next_actions) ? narration.next_actions.map((a) => (typeof a === "string" ? a : `${a.action || ""}${a.timeframe ? ` (${a.timeframe})` : ""}`))
      : []).map(cleanAi);
    const keyStrengths = (Array.isArray(narration.key_strengths) ? narration.key_strengths : []).map(cleanAi);
    const keyWeaknesses = (Array.isArray(narration.key_weaknesses) ? narration.key_weaknesses : []).map(cleanAi);
    const sections = narration.sections || {};
    const sources = narration.sources || validation.research_data?.sources || {};

    const strongestDim = validation.summary?.strongest_dimension;
    const weakestDim = validation.summary?.weakest_dimension;

    function InlineSources({ sourceKeys }) {
      const seen = new Set();
      const items = (Array.isArray(sourceKeys) ? sourceKeys : [])
        .flatMap((k) => (sources[k] || []))
        .filter((s) => {
          const u = s?.url || s?.link || "";
          if (!u || seen.has(u)) return false;
          seen.add(u);
          return true;
        })
        .slice(0, 4);
      if (!items.length) return null;
      return (
        <div className="mt-2 flex gap-1.5">
          {items.map((s, i) => {
            const url = s?.url || s?.link || "";
            const label = s?.title || url;
            return (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                className="flex flex-1 min-w-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500 hover:border-brand-300 hover:text-brand-600 transition-colors">
                <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                <span className="truncate">{cleanAi(label)}</span>
              </a>
            );
          })}
        </div>
      );
    }

    function AssessmentCard({ title, data, sourceKeys }) {
      if (!data?.body && !data?.summary) return null;
      return (
        <div className="py-3 border-b border-slate-100 last:border-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</span>
            {data.evidence_status && (
              <span className="rounded-full border bg-slate-100 text-slate-600 border-slate-200 px-2 py-0.5 text-[10px] font-semibold">{data.evidence_status}</span>
            )}
          </div>
          {(data.body || data.summary) && <p className="text-sm text-slate-700 leading-relaxed">{cleanAi(data.body || data.summary)}</p>}
          {(data.insight || data.key_finding) && <p className="mt-1 text-xs font-semibold text-slate-500">{cleanAi(data.insight || data.key_finding)}</p>}
          {data.market_size_note && (
            <p className="mt-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">{cleanAi(data.market_size_note)}</p>
          )}
          <InlineSources sourceKeys={sourceKeys} />
        </div>
      );
    }

    const hasAssessments = sections.problem || sections.customer || sections.solution || sections.market || sections.competition;

    return (
      <div className="w-full max-w-full space-y-4 overflow-x-hidden px-2 sm:px-4">
        <button type="button" onClick={() => navigate("/validation")}
          className="group flex items-center gap-1.5 text-sm font-semibold text-slate-400 transition-colors hover:text-brand-600">
          <svg className="h-4 w-4 transition-transform group-hover:-translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5m7 7l-7-7 7-7" /></svg>
          Back to Validation
        </button>

        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        {decisionNotice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{decisionNotice}</div>}

        {/* Header */}
        <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-violet-700 to-indigo-800 p-5 text-white shadow-lg md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">V4 Engine</span>
                <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">{validationMode === "comprehensive" ? "Comprehensive" : "Basic"}</span>
                {!isPaid && <span className="rounded-full bg-amber-400/30 text-amber-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">Free Plan · Estimates Only</span>}
              </div>
              <h1 className="text-xl font-bold leading-tight sm:text-2xl">{ideaName}</h1>
              {validation.idea_type && <p className="mt-1 text-sm text-violet-200">{validation.idea_type}</p>}
            </div>
            <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
              {validationEntryId && (
                <button
                  type="button"
                  onClick={() => navigate(`/validation?history_id=${validationEntryId}&history_type=business_validation&edit=1`)}
                  className="flex items-center gap-1.5 rounded-xl border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 transition"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Modify
                </button>
              )}
              {(decision === "accepted" || decision === "rejected") ? (
                <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${decision === "accepted" ? "bg-emerald-400/30 text-emerald-100" : "bg-rose-400/30 text-rose-100"}`}>
                  {decision === "accepted" ? "Accepted" : "Rejected"}
                </span>
              ) : (
                <>
                  <button disabled={decisionSaving} onClick={() => setDecisionStatus("accepted")} className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-50">Accept</button>
                  <button disabled={decisionSaving} onClick={() => setDecisionStatus("rejected")} className="rounded-xl bg-white/20 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/30 disabled:opacity-50">Reject</button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* AI Analysis Overview */}
        {overviewSummary && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-brand-600">AI Analysis Overview</div>
            <p className="text-sm leading-relaxed text-slate-700">{overviewSummary}</p>
          </div>
        )}

        {/* Dual score cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col items-center justify-center text-center">
            <CircularScore score={Math.round(vps)} tone={vpsTone} size={88} strokeWidth={9} />
            <div className="mt-3 mb-3">
              <div className="text-sm font-bold text-slate-900 leading-snug">Commercial Score</div>
              <div className="text-[11px] text-slate-500 mt-0.5">How strong the idea is commercially</div>
            </div>
            {strongestDim && (
              <div className="w-full rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-1.5 text-[11px] text-emerald-700 mb-1.5 text-left">
                <span className="font-semibold">Best:</span> {v4DimLabel(strongestDim.dimension)} ({strongestDim.pct}%)
              </div>
            )}
            {weakestDim && (
              <div className="w-full rounded-lg bg-rose-50 border border-rose-100 px-2.5 py-1.5 text-[11px] text-rose-700 text-left">
                <span className="font-semibold">Weakest:</span> {v4DimLabel(weakestDim.dimension)} ({weakestDim.pct}%)
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col items-center justify-center text-center">
            <CircularScore score={Math.round(ecs)} tone={ecsTone} size={88} strokeWidth={9} />
            <div className="mt-3">
              <div className="text-sm font-bold text-slate-900 leading-snug">Evidence Score</div>
              <div className="text-[11px] text-slate-500 mt-0.5">How well your inputs are backed up</div>
            </div>
            {!isPaid && (
              <div className="mt-3 w-full rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-1.5 text-[11px] text-amber-700">
                Free plan: figures are AI estimates, not live-verified.
              </div>
            )}
          </div>
        </div>

        {/* Verdict */}
        <div className={`rounded-2xl border p-5 ${vBg}`}>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className={`rounded-full px-3 py-1 text-xs font-bold text-white ${vBadge}`}>{verdictCategory}</span>
            <span className={`text-sm font-semibold ${vText}`}>Commercial Score {Math.round(vps)} · Evidence Score {Math.round(ecs)}</span>
          </div>
          {verdictInterp && <p className={`text-sm leading-relaxed ${vText}`}>{verdictInterp}</p>}
        </div>

        {/* Strengths / Gaps */}
        {(keyStrengths.length > 0 || keyWeaknesses.length > 0) && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {keyStrengths.length > 0 && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-700">Strengths</div>
                <ul className="space-y-1">
                  {keyStrengths.slice(0, 4).map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-emerald-800">
                      <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      {typeof s === "string" ? s : s.point || s.text || JSON.stringify(s)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {keyWeaknesses.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-700">Gaps to Address</div>
                <ul className="space-y-1">
                  {keyWeaknesses.slice(0, 4).map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
                      <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                      {typeof w === "string" ? w : w.point || w.text || JSON.stringify(w)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Analysis by Section */}
        {hasAssessments && (
          <SectionCard title="Analysis by Section">
            <div className="divide-y divide-slate-100">
              <AssessmentCard title="Problem" data={sections.problem} sourceKeys={["problem_validation", "demand_signals"]} />
              <AssessmentCard title="Customer" data={sections.customer} sourceKeys={["target_customer", "demand_signals"]} />
              <AssessmentCard title="Solution" data={sections.solution} sourceKeys={[]} />
              <AssessmentCard title="Market" data={sections.market} sourceKeys={["market_opportunity", "industry_trends"]} />
              <AssessmentCard title="Competition" data={sections.competition} sourceKeys={["competitors"]} />
            </div>
          </SectionCard>
        )}

        {/* Score Breakdown — tabbed Potential / Evidence */}
        <SectionCard
          title="Score Breakdown"
          headerRight={
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
              <button type="button" onClick={() => setDimTab("vps")} className={`px-3 py-1 transition-colors ${dimTab === "vps" ? "bg-brand-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>Potential</button>
              <button type="button" onClick={() => setDimTab("ecs")} className={`px-3 py-1 transition-colors ${dimTab === "ecs" ? "bg-brand-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>Evidence</button>
            </div>
          }
        >
          <div className="space-y-3 min-w-0">
            {(dimTab === "vps" ? vpsDims : ecsDims).map((dim) => (
              <div key={dim.dimension} className="min-w-0">
                <div className="mb-1 flex items-center justify-between gap-2 min-w-0">
                  <span className="text-xs font-semibold text-slate-700 truncate">{v4DimLabel(dim.dimension)}</span>
                  <span className="text-xs font-bold text-slate-500 shrink-0">{Math.round(dim.pct)}%</span>
                </div>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full transition-all duration-700 ${dimBarColor(dim.pct)}`} style={{ width: `${Math.min(100, Math.max(0, dim.pct))}%` }} />
                </div>
                {dim.note && <p className="mt-0.5 text-[11px] text-slate-400 truncate" title={dim.note}>{dim.note}</p>}
              </div>
            ))}
            {isBasic && (
              <p className="pt-2 text-[11px] text-slate-400">
                Upgrade to Comprehensive mode to assess Unit Economics, Operational Feasibility, Founder Readiness, and Regulatory Risk.
              </p>
            )}
          </div>
        </SectionCard>

        {/* Suggested Validation Experiments */}
        {experiments.length > 0 && (
          <SectionCard title="Suggested Validation Experiments">
            <div className="space-y-4">
              {experiments.map((exp, i) => {
                const ec = (v) => cleanAi(v || "");
                return (
                <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-900">{ec(exp.name)}</span>
                      {exp.method && (
                        <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{ec(exp.method)}</span>
                      )}
                    </div>
                    {exp.duration && (
                      <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-0.5 text-[10px] font-bold text-brand-600">{ec(exp.duration)}</span>
                    )}
                  </div>

                  {/* Hypothesis */}
                  {exp.hypothesis && (
                    <p className="text-xs text-slate-600 italic mb-3 leading-relaxed">"{ec(exp.hypothesis)}"</p>
                  )}

                  {/* Why it matters */}
                  {exp.why_it_matters && (
                    <p className="text-xs text-slate-500 mb-3 leading-relaxed">{ec(exp.why_it_matters)}</p>
                  )}

                  {/* Key details grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3">
                    {exp.target_customer && (
                      <div className="text-[11px] text-slate-500 col-span-2"><span className="font-semibold text-slate-700">Target:</span> {ec(exp.target_customer)}</div>
                    )}
                    {exp.sample_size && (
                      <div className="text-[11px] text-slate-500"><span className="font-semibold text-slate-700">Sample:</span> {ec(exp.sample_size)}</div>
                    )}
                    {exp.budget && (
                      <div className="text-[11px] text-slate-500"><span className="font-semibold text-slate-700">Budget:</span> {ec(exp.budget)}</div>
                    )}
                    {exp.metric && (
                      <div className="text-[11px] text-slate-500 col-span-2"><span className="font-semibold text-slate-700">Metric:</span> {ec(exp.metric)}</div>
                    )}
                    {exp.evidence_to_collect && (
                      <div className="text-[11px] text-slate-500 col-span-2"><span className="font-semibold text-slate-700">Collect:</span> {ec(exp.evidence_to_collect)}</div>
                    )}
                  </div>

                  {/* Pass / Fail thresholds */}
                  {(exp.pass_threshold || exp.fail_threshold) && (
                    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 space-y-1">
                      {exp.pass_threshold && (
                        <div className="text-[11px]"><span className="font-semibold text-emerald-700">Pass:</span> <span className="text-slate-600">{ec(exp.pass_threshold)}</span></div>
                      )}
                      {exp.partial_pass_threshold && (
                        <div className="text-[11px]"><span className="font-semibold text-amber-600">Partial:</span> <span className="text-slate-600">{ec(exp.partial_pass_threshold)}</span></div>
                      )}
                      {exp.fail_threshold && (
                        <div className="text-[11px]"><span className="font-semibold text-rose-600">Fail:</span> <span className="text-slate-600">{ec(exp.fail_threshold)}</span></div>
                      )}
                    </div>
                  )}

                  {/* If passed / if failed */}
                  {(exp.if_passed || exp.if_failed) && (
                    <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                      {exp.if_passed && (
                        <div className="text-[11px] text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-1.5 border border-emerald-100">
                          <span className="font-semibold">If passed:</span> {ec(exp.if_passed)}
                        </div>
                      )}
                      {exp.if_failed && (
                        <div className="text-[11px] text-rose-700 bg-rose-50 rounded-lg px-2.5 py-1.5 border border-rose-100">
                          <span className="font-semibold">If failed:</span> {ec(exp.if_failed)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );})}
            </div>
          </SectionCard>
        )}

        {/* Comprehensive-only: AI Market Sizing */}
        {!isBasic && narration.market_sizing && (
          <SectionCard title="Market Sizing">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {narration.market_sizing.total_addressable_market && (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">TAM</div>
                  <div className="text-sm font-bold text-slate-800">{cleanAi(String(narration.market_sizing.total_addressable_market))}</div>
                  {narration.market_sizing.tam_basis && <div className="mt-1 text-[11px] text-slate-500">{cleanAi(narration.market_sizing.tam_basis)}</div>}
                </div>
              )}
              {narration.market_sizing.serviceable_addressable_market && (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">SAM</div>
                  <div className="text-sm font-bold text-slate-800">{cleanAi(String(narration.market_sizing.serviceable_addressable_market))}</div>
                  {narration.market_sizing.sam_basis && <div className="mt-1 text-[11px] text-slate-500">{cleanAi(narration.market_sizing.sam_basis)}</div>}
                </div>
              )}
              {narration.market_sizing.projected_growth_rate && (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Growth Rate</div>
                  <div className="text-sm font-bold text-slate-800">{cleanAi(String(narration.market_sizing.projected_growth_rate))}</div>
                  {narration.market_sizing.projected_market_size_2030 && <div className="mt-1 text-[11px] text-slate-500">{cleanAi(narration.market_sizing.projected_market_size_2030)}</div>}
                </div>
              )}
            </div>
            {Array.isArray(narration.market_sizing.growth_drivers) && narration.market_sizing.growth_drivers.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Growth Drivers</div>
                <ul className="space-y-1">
                  {narration.market_sizing.growth_drivers.map((d, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600"><span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400"></span>{cleanAi(d)}</li>
                  ))}
                </ul>
              </div>
            )}
            <InlineSources sourceKeys={["market_opportunity", "industry_trends", "tam_sam"]} />
          </SectionCard>
        )}

        {/* Comprehensive-only: Pricing / Revenue Intelligence */}
        {!isBasic && (narration.pricing_strategy || narration.price_intelligence) && (
          <SectionCard title="Pricing / Revenue Intelligence">
            {narration.pricing_strategy && (
              <div className="mb-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Recommended Model</div>
                {narration.pricing_strategy.recommended_model && (
                  <div className="text-sm font-bold text-slate-800 mb-1">{cleanAi(narration.pricing_strategy.recommended_model)}</div>
                )}
                {narration.pricing_strategy.rationale && (
                  <p className="text-xs text-slate-600 leading-relaxed mb-2">{cleanAi(narration.pricing_strategy.rationale)}</p>
                )}
                {narration.pricing_strategy.launch_offer && (
                  <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-700">
                    <span className="font-semibold">Launch offer: </span>{cleanAi(narration.pricing_strategy.launch_offer)}
                  </div>
                )}
              </div>
            )}
            {narration.price_intelligence && (
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Market Pricing Intelligence</div>
                {Array.isArray(narration.price_intelligence.similar_products) && narration.price_intelligence.similar_products.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {narration.price_intelligence.similar_products.map((p, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                        <span className="font-medium text-slate-700">{cleanAi(p.name || "")}</span>
                        <span className="font-bold text-brand-700">{cleanAi(p.price || "")}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {narration.price_intelligence.recommended_entry_price && (
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-center">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Entry</div>
                      <div className="text-sm font-bold text-slate-800">{cleanAi(narration.price_intelligence.recommended_entry_price)}</div>
                    </div>
                  )}
                  {narration.price_intelligence.recommended_growth_price && (
                    <div className="rounded-xl border border-brand-100 bg-brand-50 p-3 text-center">
                      <div className="text-[10px] font-black uppercase tracking-widest text-brand-400 mb-1">Growth</div>
                      <div className="text-sm font-bold text-brand-700">{cleanAi(narration.price_intelligence.recommended_growth_price)}</div>
                    </div>
                  )}
                  {narration.price_intelligence.recommended_premium_price && (
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-center">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Premium</div>
                      <div className="text-sm font-bold text-slate-800">{cleanAi(narration.price_intelligence.recommended_premium_price)}</div>
                    </div>
                  )}
                </div>
                {narration.price_intelligence.pricing_rationale && (
                  <p className="mt-2 text-xs text-slate-500 leading-relaxed">{cleanAi(narration.price_intelligence.pricing_rationale)}</p>
                )}
                <InlineSources sourceKeys={["pricing"]} />
              </div>
            )}
          </SectionCard>
        )}

        {/* Contradictions */}
        {v4Contradictions.length > 0 && (
          <SectionCard title="Integrity Checks">
            <div className="space-y-2">
              {v4Contradictions.map((c, i) => (
                <div key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${c.severity === "high" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                  <svg className="mt-0.5 h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                  <span>{typeof c === "string" ? c : c.message || c.description || JSON.stringify(c)}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Risk Flags */}
        {riskFlags.length > 0 && (
          <SectionCard title="Risk Flags">
            <div className="space-y-2">
              {riskFlags.map((rf, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  <svg className="mt-0.5 h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                  <span>{typeof rf === "string" ? rf : rf.note || rf.message || JSON.stringify(rf)}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Run a Simulation CTA */}
        {(() => {
          // Relevance weights keyed by scenario_template_id
          const WEIGHTS = {
            tmpl_revenue_drop: (wdLow, rfStr, vps_, ecs_, vc) =>
              (wdLow.includes("revenue") || wdLow.includes("market") || wdLow.includes("demand") ? 3 : 0)
              + (vps_ < 50 || vc.includes("Weak") || vc.includes("Reframing") ? 2 : 0)
              + (rfStr.includes("revenue") || rfStr.includes("demand") ? 1 : 0),
            tmpl_price_increase: (wdLow, rfStr, vps_, ecs_, vc) =>
              (wdLow.includes("revenue") || wdLow.includes("pricing") || wdLow.includes("unit_econ") ? 3 : 0)
              + (rfStr.includes("pric") || rfStr.includes("unit") ? 1 : 0),
            tmpl_client_loss: (wdLow, rfStr, vps_, ecs_, vc) =>
              (wdLow.includes("customer") || wdLow.includes("traction") || wdLow.includes("evidence") ? 3 : 0)
              + (rfStr.includes("customer") || rfStr.includes("client") || rfStr.includes("churn") ? 2 : 0)
              + (ecs_ < 45 ? 1 : 0),
            tmpl_hire_staff: (wdLow, rfStr, vps_, ecs_, vc) =>
              (wdLow.includes("operational") || wdLow.includes("feasib") ? 3 : 0)
              + (rfStr.includes("staff") || rfStr.includes("team") || rfStr.includes("operat") ? 2 : 0)
              + (vps_ >= 55 ? 1 : 0),
            tmpl_payment_delay: (wdLow, rfStr, vps_, ecs_, vc) =>
              (wdLow.includes("unit_econ") || wdLow.includes("financial") ? 2 : 0)
              + (rfStr.includes("cash") || rfStr.includes("payment") || rfStr.includes("runway") ? 2 : 0)
              + (ecs_ < 50 ? 1 : 0),
            tmpl_cost_increase: (wdLow, rfStr, vps_, ecs_, vc) =>
              (wdLow.includes("unit_econ") || wdLow.includes("operational") ? 3 : 0)
              + (rfStr.includes("cost") || rfStr.includes("margin") || rfStr.includes("feasib") ? 2 : 0)
              + (vps_ < 45 ? 1 : 0),
            tmpl_contractor_addition: (wdLow, rfStr, vps_, ecs_, vc) =>
              (wdLow.includes("operational") || wdLow.includes("feasib") ? 3 : 0)
              + (rfStr.includes("staff") || rfStr.includes("team") || rfStr.includes("capac") ? 2 : 0)
              + (vps_ >= 50 ? 1 : 0),
          };

          const wdLow = (typeof weakestDim === "string" ? weakestDim : String(weakestDim?.key || weakestDim?.dimension || weakestDim?.label || "")).toLowerCase();
          const rfStr = riskFlags.map((r) => (typeof r === "string" ? r : r?.flag || r?.description || "")).join(" ").toLowerCase();

          // Use fetched templates; fall back to built-in list so simulations always show
          const FALLBACK_TEMPLATES = [
            { scenario_template_id: "tmpl_revenue_drop", title: "Revenue Drop", description: "Simulate a drop in revenue and see how your runway holds up." },
            { scenario_template_id: "tmpl_client_loss", title: "Loss of Largest Client", description: "What happens if your biggest customer walks away?" },
            { scenario_template_id: "tmpl_price_increase", title: "Increase Price", description: "Model the impact of raising your price on conversion and revenue." },
            { scenario_template_id: "tmpl_hire_staff", title: "Hire Employees", description: "Forecast the cash impact of bringing on additional team members." },
            { scenario_template_id: "tmpl_payment_delay", title: "Delayed Payments", description: "Simulate slower cash collection and its effect on your runway." },
            { scenario_template_id: "tmpl_cost_increase", title: "Cost Increase", description: "See how rising operating costs affect your margins and breakeven." },
            { scenario_template_id: "tmpl_contractor_addition", title: "Add a Contractor", description: "Model adding contractor capacity without a permanent hire." },
          ];
          const pool = simTemplates.length > 0 ? simTemplates : FALLBACK_TEMPLATES;
          const scored = pool.map((t) => {
            const tid = t.scenario_template_id;
            const weightFn = WEIGHTS[tid];
            return {
              id: tid,
              title: t.title || tid,
              desc: t.description || t.summary || "",
              score: weightFn ? weightFn(wdLow, rfStr, vps, ecs, verdictCategory) : 0,
            };
          }).sort((a, b) => b.score - a.score);
          const suggestedSims = scored.slice(0, 2);

          if (suggestedSims.length === 0) return null;

          return (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shrink-0">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">Run a Simulation</div>
                  <div className="text-xs text-slate-500">Stress-test your idea with what-if scenarios based on these results.</div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {suggestedSims.map((sim) => (
                  <button
                    key={sim.id}
                    type="button"
                    onClick={() => simCardClick(sim.id)}
                    className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition-all hover:border-brand-300 hover:bg-brand-50 hover:shadow-sm w-full"
                  >
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm group-hover:bg-brand-100 group-hover:text-brand-600">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-700 leading-snug">{sim.title}</div>
                      <div className="mt-1 text-xs text-slate-500 leading-relaxed">{sim.desc}</div>
                    </div>
                    <svg className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6" /></svg>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Recommended Next Steps */}
        {recommendations.length > 0 && (
          <SectionCard title="Recommended Next Steps">
            <ol className="space-y-3">
              {recommendations.slice(0, 5).map((rec, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">{i + 1}</span>
                  <p className="text-sm text-slate-700 leading-relaxed">{rec}</p>
                </li>
              ))}
            </ol>
          </SectionCard>
        )}

        {/* Footer */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-400 text-center">
          This report is for business decision-support purposes only and does not constitute financial, legal or investment advice.
          Scores are deterministic and based on your inputs. LLM narration is indicative only.
          {!isPaid && " Free plan figures are AI-estimated, not live-verified."}
        </div>
      </div>
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
    const serviceCategory = serviceDraft?.industry
      ? String(serviceDraft.industry)
      : serviceDraft?.service_category
        ? String(serviceDraft.service_category).replaceAll("_", " ")
        : "";
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
        : null;
    const svTone = viabilityScore >= 75 ? "success" : viabilityScore >= 50 ? "warn" : "danger";
    const svBorder = svTone === "danger" ? "border-rose-100" : svTone === "warn" ? "border-amber-100" : "border-emerald-100";
    const svAccent = svTone === "danger" ? "bg-gradient-to-b from-rose-400 to-rose-600" : svTone === "warn" ? "bg-gradient-to-b from-amber-400 to-amber-600" : "bg-gradient-to-b from-emerald-400 to-emerald-600";
    const svText = svTone === "danger" ? "text-rose-600" : svTone === "warn" ? "text-amber-600" : "text-emerald-600";
    const svBarClass = svTone === "danger" ? "bg-rose-500" : svTone === "warn" ? "bg-amber-500" : "bg-emerald-500";
    const svPulse = svTone === "danger" ? "bg-rose-500" : svTone === "warn" ? "bg-amber-500" : "bg-emerald-500";

    const scoreDimensions = [
      { key: "margin_score", label: "Margin" },
      { key: "break_even_score", label: "Break-even" },
      { key: "demand_score", label: "Demand" },
      { key: "capacity_score", label: "Capacity" },
    ];

    const svcSummary = String(validation?.interpretation?.summary || "").trim();
    const svcKeyDriver = String(validation?.interpretation?.key_driver || "").trim();
    const svcRecommendation = String(validation?.interpretation?.recommendation || "").trim();
    const hasInterpretation = svcSummary || svcKeyDriver || svcRecommendation;

    const marginScore = typeof serviceScores.margin_score === "number" ? serviceScores.margin_score : 0;
    const breakEvenScore = typeof serviceScores.break_even_score === "number" ? serviceScores.break_even_score : 0;
    const demandScore = typeof serviceScores.demand_score === "number" ? serviceScores.demand_score : 0;
    const capacityScore = typeof serviceScores.capacity_score === "number" ? serviceScores.capacity_score : 0;

    const svcSimRecs = [];
    if (marginScore < 50) svcSimRecs.push({ id: "tmpl_price_increase", label: "Price Increase", desc: "Model how raising your price improves margins.", icon: "↑" });
    if (marginScore < 50 || breakEvenScore < 50) svcSimRecs.push({ id: "tmpl_reduce_fixed_cost", label: "Reduce Fixed Costs", desc: "See the impact of cutting overheads on break-even.", icon: "✂" });
    if (breakEvenScore < 50) svcSimRecs.push({ id: "tmpl_payment_delay", label: "Payment Delay", desc: "Stress-test cash flow if customers pay late.", icon: "⏱" });
    if (demandScore < 50) svcSimRecs.push({ id: "tmpl_service_launch", label: "Service Launch", desc: "Model revenue ramp from a new service offering.", icon: "🚀" });
    if (capacityScore < 70 || workforceKind === "warn") svcSimRecs.push({ id: "tmpl_hire_staff", label: "Hire Staff", desc: "Explore whether hiring expands delivery capacity.", icon: "👥" });
    if (viabilityScore < 50) svcSimRecs.push({ id: "tmpl_revenue_drop", label: "Revenue Drop", desc: "Stress-test viability if sales fall short of target.", icon: "⚠" });
    if (viabilityScore < 50) svcSimRecs.push({ id: "tmpl_client_loss", label: "Client Loss", desc: "Model impact of losing a key client or contract.", icon: "⚡" });
    if (svcSimRecs.length === 0) {
      svcSimRecs.push({ id: "tmpl_price_increase", label: "Price Increase", desc: "Model how a price move affects profit.", icon: "↑" });
      svcSimRecs.push({ id: "tmpl_hire_staff", label: "Hire Staff", desc: "Plan capacity for growth.", icon: "👥" });
      svcSimRecs.push({ id: "tmpl_contractor_addition", label: "Add Contractor", desc: "Flex delivery capacity without a full hire.", icon: "🔧" });
    }

    return (
      <div className="w-full max-w-full space-y-4 overflow-x-hidden px-2 sm:px-4">

        {/* ── Back link ── */}
        <button
          type="button"
          onClick={() => navigate("/validation")}
          className="group flex w-fit items-center gap-1.5 text-sm font-semibold text-slate-400 transition-colors hover:text-brand-600"
        >
          <svg className="h-4 w-4 transition-transform group-hover:-translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5m7 7l-7-7 7-7" />
          </svg>
          Back to Validation
        </button>

        {/* ── Title + badges ── */}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              {validation?.service_name || "Service idea"}
            </h1>
            {serviceOutcome ? <Badge tone={svTone === "danger" ? "danger" : svTone === "warn" ? "warn" : "success"}>{serviceOutcome}</Badge> : null}
            <Badge tone={decisionMeta.tone}>{decisionMeta.text}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">Product / service viability report and analysis.</p>
        </div>

        {/* ── Disclaimer ── */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">AI output disclaimer: </span>
          Results are decision-support tools only and may be incomplete or inaccurate. Do not rely solely on this report for legal, financial, or investment decisions. <a href="/legal/disclaimer" className="underline hover:text-amber-900">Learn more</a>.
        </div>

        {/* ── Action toolbar ── */}
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <Button
            size="sm"
            variant="secondary"
            disabled={!workspaceId}
            onClick={() => navigate(`/validation?workspace_id=${workspaceId}&history_type=service_validation${activeServiceValidationId ? `&history_id=${encodeURIComponent(activeServiceValidationId)}` : ""}`)}
          >
            Modify
          </Button>
          {!serviceDecisionLocked && (
            <>
              <Button size="sm" variant="danger" disabled={decisionSaving || !workspaceId} onClick={() => setDecisionStatus("rejected")}>
                Reject
              </Button>
              <Button size="sm" disabled={decisionSaving || !workspaceId} onClick={() => setDecisionStatus("accepted")}>
                Accept
              </Button>
            </>
          )}
        </div>

        {error ? <InlineAlert kind="error" message={error} /> : null}
        {decisionNotice ? <InlineAlert message={decisionNotice} /> : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">

          {/* ── Main column ── */}
          <div className="space-y-4 lg:col-span-8">

            {/* Service overview — premium hero card */}
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-brand-50/30 shadow-sm">
              <div className={`absolute top-0 left-0 w-1 h-full ${svAccent}`} />
              <div className="px-5 py-5 pl-7">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Service Overview</div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                  {serviceCategory && (
                    <div>
                      <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5">Industry</div>
                      <div className="text-sm font-semibold text-slate-800">{serviceCategory}</div>
                    </div>
                  )}
                  {targetCustomer && (
                    <div>
                      <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5">Target customer</div>
                      <div className="text-sm font-semibold text-slate-800">{targetCustomer}</div>
                    </div>
                  )}
                  {marketScope && (
                    <div>
                      <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5">Market scope</div>
                      <div className="text-sm font-semibold text-slate-800 capitalize">{marketScope}</div>
                    </div>
                  )}
                </div>
                {serviceDesc && (
                  <div className="mt-4 rounded-xl bg-white/70 border border-slate-100 px-4 py-3">
                    <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Description</div>
                    <p className="text-sm text-slate-700 leading-relaxed">{serviceDesc}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Viability Synopsis */}
            {hasInterpretation && (
              <SectionCard
                title="Viability Synopsis"
                subtitle="AI-generated interpretation of your service metrics."
                icon={
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm">
                    <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><path d="M9 5a2 2 0 012-2h2a2 2 0 012 2v0a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                    </svg>
                  </div>
                }
                headerRight={
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${svPulse} opacity-75`}></span>
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${svPulse}`}></span>
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-brand-600/80">Validation Intelligence</span>
                  </div>
                }
              >
                <div className="relative rounded-xl border border-slate-100 bg-slate-50/60 p-5 space-y-3">
                  <svg className="absolute top-3 left-4 h-6 w-6 text-brand-200 opacity-70" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/>
                  </svg>
                  {svcSummary && (
                    <p className="pt-4 text-base leading-[1.75] text-slate-800" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', letterSpacing: '0.01em' }}>
                      {svcSummary}
                    </p>
                  )}
                  {(svcKeyDriver || svcRecommendation) && (
                    <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
                      {svcKeyDriver && (
                        <div className="flex items-start gap-2.5">
                          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[9px] font-black text-brand-700">K</span>
                          <div className="text-sm text-slate-700"><span className="font-semibold text-slate-900">Key driver: </span>{svcKeyDriver}</div>
                        </div>
                      )}
                      {svcRecommendation && (
                        <div className="flex items-start gap-2.5">
                          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[9px] font-black text-emerald-700">R</span>
                          <div className="text-sm text-slate-700"><span className="font-semibold text-slate-900">Recommendation: </span>{svcRecommendation}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {serviceRiskFlags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {serviceRiskFlags.map((flag, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                        {String(flag).replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
              </SectionCard>
            )}

            {/* Workforce check */}
            {suggestedHours ? (
              <SectionCard title="Workforce check" subtitle="Delivery hours vs. expected demand.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                  <StatTile label="Expected sales / month" value={formatNumber(expectedSales)} info="Expected sales volume per month." />
                  <StatTile label="Hours / sale" value={formatNumber(hoursPerSale)} info="Hours required to deliver one sale." />
                  <StatTile label="Suggested hours / month" value={formatNumber(suggestedHours)} info="Expected sales per month × hours required per sale." />
                  {availableHours != null && (
                    <StatTile label="Available hours / month" value={formatNumber(availableHours)} info="Your available delivery hours per month." />
                  )}
                  {workforceMessage && (
                    <StatTile label="Workforce status" value={workforceMessage} tone={workforceKind} info="Compares available delivery hours with the suggested hours." />
                  )}
                </div>
                {workforceKind === "warn" && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                    <div className="font-semibold">Run a hiring scenario to model capacity expansion.</div>
                    <Button size="sm" variant="secondary" onClick={() => simCardClick("tmpl_hire_staff")}>Run scenario</Button>
                  </div>
                )}
              </SectionCard>
            ) : null}

          </div>

          {/* ── Sidebar ── */}
          <aside className="lg:col-span-4 flex flex-col gap-4 lg:self-start lg:sticky lg:top-24">

            {/* Card 1: Score + Outcome + Engine */}
            <div className={`relative overflow-hidden rounded-2xl border shadow-sm flex flex-col transition-all duration-700 bg-white ${svBorder}`}>
              <div className={`absolute top-0 left-0 w-1.5 h-full shrink-0 ${svAccent}`} />
              <div className="relative px-5 py-6 flex flex-col gap-0">

                {/* Score gauge */}
                <div className="flex flex-col items-center text-center shrink-0">
                  <div className="relative group">
                    <div className={`absolute -inset-3 rounded-full blur-xl opacity-15 transition-all duration-700 group-hover:opacity-30 ${svTone === "danger" ? "bg-rose-500" : svTone === "warn" ? "bg-amber-500" : "bg-emerald-500"}`} />
                    <CircularScore score={viabilityScore} tone={svTone} size={148} strokeWidth={12} />
                  </div>
                  <div className="mt-5">
                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-1.5">Overall Verdict</div>
                    <div className={`text-2xl font-black tracking-tight leading-none ${svText}`}>{serviceOutcome}</div>
                    <p className="mt-2 text-xs font-semibold text-slate-500 max-w-[200px] mx-auto leading-relaxed">
                      {viabilityScore >= 75 ? "Strong unit economics and delivery capacity." : viabilityScore >= 50 ? "Viable with improvements to key metrics." : "Material risks — review pricing and costs."}
                    </p>
                  </div>
                </div>

                {/* Engine badge + score bars */}
                <div className="mt-5 pt-5 border-t border-slate-100 shrink-0">
                  <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-50 text-[10px] font-black text-slate-500 ring-1 ring-slate-100">
                    <div className={`h-1.5 w-1.5 rounded-full animate-pulse ${svPulse}`} />
                    <span>SERVICE VIABILITY ANALYSIS</span>
                  </div>
                  <div className="mt-3.5 space-y-1.5">
                    {scoreDimensions.map(({ key, label }) => {
                      const v = typeof serviceScores[key] === "number" ? serviceScores[key] : 0;
                      const t = toneForScore(v);
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <div className="w-24 shrink-0 text-[9px] font-black uppercase tracking-wide text-slate-400 text-right leading-tight">{label}</div>
                          <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full rounded-full transition-all duration-1000 ${t.barClass}`} style={{ width: pctWidth(v) }} />
                          </div>
                          <div className="w-5 shrink-0 text-[10px] font-black text-right text-slate-700">{Math.round(v)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            </div>

            {/* Card 2: Score breakdown detail */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-5 py-5">
              <div className="text-sm font-semibold text-slate-900 mb-0.5">Score breakdown</div>
              <div className="text-xs text-slate-500 mb-4">Weighted viability scores (0-100).</div>
              <div className="space-y-3">
                {scoreDimensions.map(({ key, label }) => {
                  const v = typeof serviceScores[key] === "number" ? serviceScores[key] : 0;
                  const color = v >= 70 ? "#10b981" : v >= 45 ? "#f59e0b" : "#ef4444";
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-xs font-semibold text-slate-600">{label} score</div>
                        <div className="text-xs font-black text-slate-900">{Math.round(v)}<span className="text-slate-400 font-semibold">/100</span></div>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full transition-all duration-1000" style={{ width: pctWidth(v), backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </aside>
        </div>

        {/* Recommended Simulations — full width */}
        <SectionCard
          title="Recommended Simulations"
          subtitle="Run these what-if scenarios based on your validation results."
          icon={
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-brand-600 shadow-sm">
              <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {svcSimRecs.slice(0, 2).map((sim) => (
              <button
                key={sim.id}
                onClick={() => simCardClick(sim.id)}
                className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-300 hover:shadow-md"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-base">{sim.icon}</div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 group-hover:text-brand-700">{sim.label}</div>
                  <div className="mt-0.5 text-xs text-slate-500 leading-snug">{sim.desc}</div>
                </div>
                <svg className="ml-auto mt-1 h-4 w-4 shrink-0 text-slate-300 group-hover:text-brand-500 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            ))}
          </div>
        </SectionCard>

        {/* ── Market Research (service) ── */}
        <div className="mt-4 space-y-4">
          {svcMrLoading && !svcMarketResearch && (
            <SectionCard title="Market Intelligence" subtitle="Searching TAM, SAM, competitors and pricing…">
              <div className="flex items-center gap-3 py-4">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent shrink-0" />
                <span className="text-sm text-slate-500">This usually takes 1–3 minutes.</span>
              </div>
            </SectionCard>
          )}

          {svcMrError && !svcMrLoading && !svcMarketResearch && (
            <SectionCard title="Market Intelligence" subtitle="Research could not complete.">
              <div className="flex items-center justify-between gap-4 py-2">
                <span className="text-sm text-rose-600">{svcMrError}</span>
                <button
                  onClick={runSvcMr}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 transition-colors"
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
                  Retry
                </button>
              </div>
            </SectionCard>
          )}

          {(svcMarketResearch?.market_sizing || svcMarketResearch?.competitor_analysis || svcMarketResearch?.price_intelligence) && (
              <>
                {svcMarketResearch?.market_sizing && (
                  <SectionCard title="Market Sizing" subtitle="TAM · SAM · Projected Growth Rate · 2030 Market Projection">
                    <div className="space-y-5">
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {[
                          { label: "Total Market (TAM)", value: svcMarketResearch.market_sizing.total_addressable_market, color: "bg-brand-50 border-brand-200", text: "text-brand-700" },
                          { label: "Your Segment (SAM)", value: svcMarketResearch.market_sizing.serviceable_addressable_market, color: "bg-emerald-50 border-emerald-200", text: "text-emerald-700" },
                          { label: "Growth Rate (CAGR)", value: svcMarketResearch.market_sizing.projected_growth_rate, color: "bg-amber-50 border-amber-200", text: "text-amber-700" },
                          { label: "Projected by 2030", value: svcMarketResearch.market_sizing.projected_market_size_2030, color: "bg-indigo-50 border-indigo-200", text: "text-indigo-700" },
                        ].filter(t => t.value).map((tile, i) => (
                          <div key={i} className={`rounded-xl border p-4 ${tile.color}`}>
                            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">{tile.label}</div>
                            <div className={`text-sm font-black leading-snug ${tile.text}`}>{tile.value}</div>
                          </div>
                        ))}
                      </div>
                      {(svcMarketResearch.market_sizing.tam_basis || svcMarketResearch.market_sizing.sam_basis) && (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {svcMarketResearch.market_sizing.tam_basis && (
                            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">How TAM Was Calculated</div>
                              <p className="text-xs font-semibold text-slate-600 leading-relaxed">{svcMarketResearch.market_sizing.tam_basis}</p>
                            </div>
                          )}
                          {svcMarketResearch.market_sizing.sam_basis && (
                            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">How SAM Was Calculated</div>
                              <p className="text-xs font-semibold text-slate-600 leading-relaxed">{svcMarketResearch.market_sizing.sam_basis}</p>
                            </div>
                          )}
                        </div>
                      )}
                      {svcMarketResearch.market_sizing.growth_drivers?.length > 0 && (
                        <div>
                          <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Growth Drivers</div>
                          <div className="flex flex-wrap gap-2">
                            {svcMarketResearch.market_sizing.growth_drivers.map((d, i) => (
                              <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-[11px] font-semibold text-brand-700">
                                <svg className="h-3 w-3 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                                {d}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </SectionCard>
                )}

                {svcMarketResearch?.competitor_analysis && (
                  <SectionCard title="Competitor Landscape" subtitle="Market saturation · top players · moat analysis">
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {svcMarketResearch.competitor_analysis.market_saturation && (
                          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Market Saturation</div>
                            <div className={`text-lg font-black ${
                              svcMarketResearch.competitor_analysis.market_saturation === "High" ? "text-rose-600" :
                              svcMarketResearch.competitor_analysis.market_saturation === "Medium" ? "text-amber-600" : "text-emerald-600"
                            }`}>{svcMarketResearch.competitor_analysis.market_saturation}</div>
                          </div>
                        )}
                        {svcMarketResearch.competitor_analysis.competitive_moat && (
                          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 sm:col-span-2">
                            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Competitive Moat</div>
                            <p className="text-xs font-semibold text-slate-700 leading-relaxed">{svcMarketResearch.competitor_analysis.competitive_moat}</p>
                          </div>
                        )}
                      </div>
                      {svcMarketResearch.competitor_analysis.top_competitors?.length > 0 && (
                        <div className="space-y-3">
                          {svcMarketResearch.competitor_analysis.top_competitors.map((c, i) => {
                            const pricing = (c.pricing || c.price_range || "").replace(/(\w)\s*[-–]\s*(\w)/g, "$1 to $2");
                            const share = (c.market_share || "").replace(/(\w)\s*[-–]\s*(\w)/g, "$1 to $2");
                            const revenue = (c.estimated_revenue || "").replace(/(\w)\s*[-–]\s*(\w)/g, "$1 to $2");
                            return (
                              <div key={i} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                                <div className="mb-2">
                                  <div className="font-bold text-slate-900 text-sm">{c.name}</div>
                                  {c.description && <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{c.description}</div>}
                                </div>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                  {pricing && <span className="inline-block rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 border border-emerald-100 leading-snug">{pricing}</span>}
                                  {share && <span className="inline-block rounded-lg bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 border border-brand-100 leading-snug">{share} share</span>}
                                  {revenue && <span className="inline-block rounded-lg bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 border border-slate-200 leading-snug">{revenue}</span>}
                                </div>
                                {c.strength && (
                                  <div className="flex items-start gap-1.5 mt-1">
                                    <svg className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                                    <p className="text-[11px] text-emerald-700 font-medium leading-relaxed">{c.strength}</p>
                                  </div>
                                )}
                                {c.weakness && (
                                  <div className="flex items-start gap-1.5 mt-1">
                                    <svg className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                                    <p className="text-[11px] text-amber-700 font-medium leading-relaxed">{c.weakness}</p>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </SectionCard>
                )}

                {svcMarketResearch?.price_intelligence && (
                  <SectionCard title="Price Intelligence" subtitle="Similar service pricing · entry price recommendation">
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {[
                          { label: "Entry Price", value: svcMarketResearch.price_intelligence.recommended_entry_price, color: "bg-emerald-50 border-emerald-100", text: "text-emerald-700" },
                          { label: "Growth Price", value: svcMarketResearch.price_intelligence.recommended_growth_price, color: "bg-brand-50 border-brand-100", text: "text-brand-700" },
                          { label: "Premium Price", value: svcMarketResearch.price_intelligence.recommended_premium_price, color: "bg-amber-50 border-amber-100", text: "text-amber-700" },
                        ].filter(t => t.value).map((tile, i) => (
                          <div key={i} className={`rounded-xl border p-4 ${tile.color}`}>
                            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">{tile.label}</div>
                            <div className={`text-base font-black ${tile.text}`}>{tile.value}</div>
                          </div>
                        ))}
                      </div>
                      {svcMarketResearch.price_intelligence.pricing_rationale && (
                        <p className="text-xs font-semibold text-slate-600 rounded-xl border border-slate-100 bg-slate-50 p-4 leading-relaxed">{svcMarketResearch.price_intelligence.pricing_rationale}</p>
                      )}
                      {svcMarketResearch.price_intelligence.similar_products?.length > 0 && (
                        <div>
                          <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Similar Services in the Market</div>
                          <div className="space-y-2">
                            {svcMarketResearch.price_intelligence.similar_products.map((p, i) => (
                              <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3">
                                <div className="text-sm font-semibold text-slate-800">{p.name}</div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-black text-emerald-700">{p.price}</span>
                                  {p.source && <span className="text-[10px] text-slate-400">{p.source}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </SectionCard>
                )}
              </>
            )}
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

  // V4 Universal Engine detection
  const isV4 = validation?.pathway === "v4_universal" || validation?.engine_version === "4.0" || Boolean(validation?.validation_mode);
  const validationMode = isV4 ? (validation?.validation_mode || "basic") : null;
  const isComprehensive = validationMode === "comprehensive";
  const v4CommercialScore = isV4 ? (validation?.scores?.potential_score ?? null) : null;
  const v4EvidenceScore = isV4 ? (validation?.scores?.evidence_confidence_score ?? null) : null;
  const v4Sections = isV4 ? (validation?.market_research?.sections || {}) : {};
  const v4AiContradictions = isV4 ? (validation?.market_research?.contradictions || []) : [];
  const v4EngineContradictions = isV4 ? (Array.isArray(validation?.contradictions) ? validation.contradictions : []) : [];
  const v4RiskFlags = isV4 ? (Array.isArray(validation?.risk_flags) ? validation.risk_flags : []) : [];
  const v4Sources = isV4 ? (validation?.market_research?.sources || {}) : {};
  const V4_DIM_ORDER = ["problem_strength", "customer_clarity", "evidence_traction", "solution_relevance", "differentiation", "demand_market", "competition_positioning", "revenue_pricing", "unit_economics", "operational_feasibility", "founder_readiness", "regulatory_risk"];
  const V4_BASIC_HIDDEN = new Set(["unit_economics", "operational_feasibility", "founder_readiness", "regulatory_risk"]);
  const V4_DIM_LABELS = {
    problem_strength: "Problem Strength", customer_clarity: "Customer Clarity", evidence_traction: "Evidence & Traction",
    solution_relevance: "Solution Relevance", differentiation: "Differentiation", demand_market: "Demand & Market",
    competition_positioning: "Competitive Position", revenue_pricing: "Revenue & Pricing",
    unit_economics: "Unit Economics", operational_feasibility: "Operational Feasibility",
    founder_readiness: "Founder Readiness", regulatory_risk: "Regulatory Risk",
  };
  const V4_SECTION_CONFIG = [
    { key: "problem", label: "Problem", icon: "⚡", color: "rose" },
    { key: "customer", label: "Customer", icon: "👤", color: "indigo" },
    { key: "solution", label: "Solution", icon: "💡", color: "amber" },
    { key: "market", label: "Market", icon: "📊", color: "emerald" },
    { key: "competition", label: "Competition", icon: "🏁", color: "violet" },
  ];

  const businessName = String(ideaValidation?.context?.business_name || "").trim() || null;
  const primaryIndustry = String(ideaValidation?.context?.primary_industry || "").trim() || null;
  const businessType = String(ideaValidation?.context?.business_type || "").trim() || null;
  const offerName = String(ideaValidation?.offer?.service_type || "").trim() || null;

  const reasons = useMemo(() => dedupeText(validation.reasons), [validation.reasons]);
  const actionPlan = useMemo(() => buildActionPlan({ validation, ideaValidation, maxItems: 10 }), [ideaValidation, validation]);

  const bizSimRecs = useMemo(() => {
    const recs = [];
    const isRisky = score < 50 || classification === "RISKY" || classification === "WEAK";
    const isModerate = score >= 50 && score < 75;
    const isStrong = score >= 75;
    const lowMargin = margin != null && margin < 0.3;
    const highBurn = burn != null && burn > 0;
    const longBreakEven = be != null && be > 12;
    const capacityStrained = utilization != null && utilization > 0.8;

    if (highBurn || isRisky) recs.push({ id: "tmpl_revenue_drop", label: "Revenue Drop", desc: "Stress-test your model if early sales fall short.", icon: "📉" });
    if (lowMargin || highBurn) recs.push({ id: "tmpl_price_increase", label: "Price Increase", desc: "Model how a price adjustment improves your margins.", icon: "↑" });
    if (highBurn || longBreakEven) recs.push({ id: "tmpl_reduce_fixed_cost", label: "Reduce Fixed Costs", desc: "See how cutting overheads shortens your path to profit.", icon: "✂" });
    if (isRisky || isModerate) recs.push({ id: "tmpl_client_loss", label: "Client Loss", desc: "Assess the impact of losing a major client early on.", icon: "⚡" });
    if (isRisky || highBurn) recs.push({ id: "tmpl_payment_delay", label: "Payment Delay", desc: "Stress-test cash flow when customers pay late.", icon: "⏱" });
    if (isModerate || isStrong) recs.push({ id: "tmpl_service_launch", label: "Service Launch", desc: "Model revenue from adding a new service to your offering.", icon: "🚀" });
    if (capacityStrained || isStrong) recs.push({ id: "tmpl_hire_staff", label: "Hire Staff", desc: "Plan the P&L impact of growing your team.", icon: "👥" });
    if (isModerate || isStrong) recs.push({ id: "tmpl_contractor_addition", label: "Add Contractor", desc: "Flex capacity with contractors before committing to a hire.", icon: "🔧" });
    if (longBreakEven) recs.push({ id: "tmpl_cost_increase", label: "Cost Increase", desc: "Model how rising input costs affect your break-even.", icon: "📦" });
    if (isStrong) recs.push({ id: "tmpl_delay_hiring", label: "Delay Hiring", desc: "Explore the effect of deferring headcount on growth.", icon: "⏳" });
    if (recs.length === 0) {
      recs.push({ id: "tmpl_revenue_drop", label: "Revenue Drop", desc: "Stress-test if early revenue misses forecast.", icon: "📉" });
      recs.push({ id: "tmpl_price_increase", label: "Price Increase", desc: "Model how a price move affects profitability.", icon: "↑" });
      recs.push({ id: "tmpl_service_launch", label: "Service Launch", desc: "Model a new service line added to your business.", icon: "🚀" });
    }
    return recs.slice(0, 2);
  }, [be, burn, classification, margin, score, utilization]);

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
    if (isV4) {
      const present = new Set(Object.keys(dimensionScores));
      return V4_DIM_ORDER.filter((k) => present.has(k) && (isComprehensive || !V4_BASIC_HIDDEN.has(k)));
    }
    const preferred = ["problem_severity", "customer_clarity", "demand_validation", "market_evidence", "differentiation", "trend_strength"];
    const present = new Set(Object.keys(dimensionScores || {}));
    const base = preferred.filter((k) => present.has(k));
    const rest = Object.keys(dimensionScores || {}).filter((k) => !base.includes(k));
    return [...base, ...rest].slice(0, Math.max(6, base.length));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensionScores, isV4, isComprehensive]);

  const validationExplanation = (() => {
    const raw = String(validation?.validation_explanation || validation?.market_research?.executive_summary || "").trim();
    if (!raw) return "Validation summary is being generated based on market signals and research. Your score reflects the deterministic strength of the concept.";
    return raw.replace(/(?:^|\n)[—–\-]\s*/g, (m) => m.startsWith("\n") ? "\n" : "").trim();
  })();

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
    if (isV4 && V4_DIM_LABELS[k]) return V4_DIM_LABELS[k];
    const meta = DIMENSION_META[k];
    if (meta?.label) return meta.label;
    return k.replaceAll("_", " ");
  }

  function dimHelp(key) {
    const k = String(key || "").trim();
    const fromBackend = validation?.dimension_explanations && typeof validation.dimension_explanations === "object" ? validation.dimension_explanations[k] : null;
    if (isV4 && V4_DIM_LABELS[k]) return `V4 scoring dimension: ${V4_DIM_LABELS[k]}.`;
    return fromBackend || DIMENSION_META[k]?.help || "Validation metric based on deterministic engine scoring.";
  }

  return (
    <div className="w-full max-w-full space-y-4 overflow-x-hidden px-2 sm:px-4">

      {/* ── Back link ── */}
      <button
        type="button"
        onClick={() => navigate("/validation")}
        className="group flex w-fit items-center gap-1.5 text-sm font-semibold text-slate-400 transition-colors hover:text-brand-600"
      >
        <svg className="h-4 w-4 transition-transform group-hover:-translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M19 12H5m7 7l-7-7 7-7" />
        </svg>
        Back to Validation
      </button>

      {/* ── Title + badges ── */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {validation.pathway === "product_service_idea"
              ? (validation?.service_name || "Service Idea")
              : (validation?.business_name || "Business Concept Idea")}
          </h1>
          <Badge tone={decisionMeta.tone}>{decisionMeta.text}</Badge>
          {pathwayLabel ? <Badge>{pathwayLabel}</Badge> : null}
          {isV4 && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${isComprehensive ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>
              {isComprehensive ? "Comprehensive" : "Basic"}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">Validation report and recommended next steps.</p>
      </div>

      {/* ── Disclaimer ── */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <span className="font-semibold">AI output disclaimer: </span>
        Results are decision-support tools only and may be incomplete or inaccurate. Do not rely solely on this report for legal, financial, or investment decisions. <a href="/legal/disclaimer" className="underline hover:text-amber-900">Learn more</a>.
      </div>

      {/* ── Action toolbar ── */}
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SegmentedTabs
            ariaLabel="View mode"
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: "simple", label: "Simple" },
              { value: "detailed", label: "Detailed" }
            ]}
          />
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!workspaceId}
              onClick={() => navigate(`/validation?workspace_id=${workspaceId}${activeValidationId ? `&history_id=${encodeURIComponent(activeValidationId)}&history_type=business_validation` : ""}`)}
            >
              Modify
            </Button>
            {!decision && (
              <>
                <Button size="sm" variant="danger" disabled={decisionSaving || !workspaceId} onClick={() => setDecisionStatus("rejected")}>
                  Reject
                </Button>
                <Button size="sm" disabled={decisionSaving || !workspaceId} onClick={() => setDecisionStatus("accepted")}>
                  Accept
                </Button>
              </>
            )}
          </div>
        </div>
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
          spread
        />
      </div>

      {error ? <InlineAlert kind="error" message={error} /> : null}
      {decisionNotice ? <InlineAlert message={decisionNotice} /> : null}

      {/* Biz intro cards — full width, outside the aside grid so Score card aligns with Validation Insights */}
      {!isServiceIdea && !isV4 && viewMode === "simple" && (
        <SectionCard title="Market Intelligence" subtitle="AI-driven summary of your validation result.">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-50 via-white to-brand-100 p-4 sm:p-6 shadow-[0_4px_16px_rgb(0,0,0,0.04)] ring-1 ring-brand-200/50">
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
                    <span className="text-[10px] font-bold uppercase tracking-widest text-brand-600/80">Validation Intelligence</span>
                  </div>
                </div>
              </div>
              <div className="relative rounded-xl border border-white bg-white/40 p-5 backdrop-blur-sm">
                <svg className="absolute top-3 left-4 h-6 w-6 text-brand-200 opacity-70" viewBox="0 0 24 24" fill="currentColor"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/></svg>
                <p className="pt-4 text-base leading-[1.75] text-slate-800" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', letterSpacing: '0.01em' }}>
                  {validationExplanation}
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
      )}
      {!isServiceIdea && !isV4 && viewMode === "detailed" && (
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
      )}

      {/* V4 Analysis by Section */}
      {isV4 && Object.keys(v4Sections).length > 0 && (
        <SectionCard
          title="Analysis by Section"
          subtitle={isComprehensive ? "Comprehensive AI analysis with live market research." : "AI-powered analysis of your idea across key dimensions."}
        >
          <div className="space-y-3">
            {V4_SECTION_CONFIG.filter((sc) => v4Sections[sc.key]).map((sc) => {
              const sec = v4Sections[sc.key] || {};
              const colorMap = {
                rose: { bg: "bg-rose-50", border: "border-rose-200", icon: "bg-rose-100 text-rose-600", label: "text-rose-700", insight: "bg-rose-50 border-rose-100" },
                indigo: { bg: "bg-indigo-50", border: "border-indigo-200", icon: "bg-indigo-100 text-indigo-600", label: "text-indigo-700", insight: "bg-indigo-50 border-indigo-100" },
                amber: { bg: "bg-amber-50", border: "border-amber-200", icon: "bg-amber-100 text-amber-600", label: "text-amber-700", insight: "bg-amber-50 border-amber-100" },
                emerald: { bg: "bg-emerald-50", border: "border-emerald-200", icon: "bg-emerald-100 text-emerald-600", label: "text-emerald-700", insight: "bg-emerald-50 border-emerald-100" },
                violet: { bg: "bg-violet-50", border: "border-violet-200", icon: "bg-violet-100 text-violet-600", label: "text-violet-700", insight: "bg-violet-50 border-violet-100" },
              };
              const c = colorMap[sc.color] || colorMap.indigo;
              return (
                <div key={sc.key} className={`rounded-xl border p-4 ${c.border} bg-white`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm ${c.icon}`}>{sc.icon}</span>
                    <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${c.label}`}>{sc.label}</span>
                  </div>
                  {sec.body && <p className="text-sm text-slate-700 leading-relaxed mb-2">{sec.body}</p>}
                  {sec.insight && (
                    <div className={`rounded-lg border px-3 py-2 text-xs font-semibold text-slate-600 ${c.insight}`}>
                      <span className="font-black text-slate-500 mr-1">Key finding:</span>{sec.insight}
                    </div>
                  )}
                  {isComprehensive && sec.source_hint && (
                    <p className="mt-2 text-[11px] text-slate-400 italic">{sec.source_hint}</p>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* V4 Integrity Checks & Contradictions — comprehensive only */}
      {isV4 && isComprehensive && (v4AiContradictions.length > 0 || v4EngineContradictions.length > 0) && (
        <SectionCard title="Integrity Checks" subtitle="Cross-validation of your inputs against research evidence.">
          <div className="space-y-2">
            {v4EngineContradictions.map((c, i) => (
              <div key={`eng-${i}`} className="flex gap-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>
                <p className="text-sm font-medium text-amber-800 leading-relaxed">
                  {typeof c === "string" ? c : (c?.note || c?.message || JSON.stringify(c))}
                </p>
              </div>
            ))}
            {v4AiContradictions.map((c, i) => (
              <div key={`ai-${i}`} className="flex gap-3 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>
                <p className="text-sm font-medium text-rose-800 leading-relaxed">{String(c)}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* V4 Risk Flags — comprehensive only */}
      {isV4 && isComprehensive && v4RiskFlags.length > 0 && (
        <SectionCard title="Risk Flags" subtitle="Identified risks from the validation engine.">
          <div className="space-y-2">
            {v4RiskFlags.map((flag, i) => {
              const severity = String(flag?.severity || "medium").toLowerCase();
              const note = String(flag?.note || flag?.message || flag || "");
              const dim = flag?.dimension ? String(flag.dimension).replace(/_/g, " ") : null;
              const flagColor = severity === "high" ? "border-rose-100 bg-rose-50 text-rose-700" : severity === "low" ? "border-slate-100 bg-slate-50 text-slate-600" : "border-amber-100 bg-amber-50 text-amber-700";
              const dotColor = severity === "high" ? "bg-rose-500" : severity === "low" ? "bg-slate-400" : "bg-amber-500";
              return (
                <div key={i} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${flagColor}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
                  <div className="min-w-0">
                    {dim && <div className="text-[10px] font-black uppercase tracking-wide opacity-60 mb-0.5">{dim}</div>}
                    <p className="text-sm font-medium leading-relaxed">{note}</p>
                  </div>
                  <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${severity === "high" ? "bg-rose-100 text-rose-600" : severity === "low" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-600"} opacity-90`}>{severity}</span>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className={`lg:col-span-8 ${!isServiceIdea ? "flex flex-col gap-4" : "space-y-4"}`}>
          {isServiceIdea && (
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
                    {be !== null && (
                      <StatTile
                        label="Break-even"
                        value={`${formatNumber(be)} months`}
                        info="How long it takes to cover fixed costs given your current plan."
                      />
                    )}
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
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                      <StatTile label="Monthly costs" value={formatCurrency(costs, currency)} info="Fixed + variable costs per month." />
                      {burn !== null && (
                        <StatTile label="Burn / month" value={formatCurrency(burn, currency)} info="If costs exceed revenue, burn is the gap you fund with cash." tone={burn > 0 ? "warn" : "default"} />
                      )}
                      {utilization !== null && (
                        <StatTile
                          label="Capacity utilization"
                          value={formatPercent(utilization)}
                          info="Demand divided by delivery capacity."
                          tone={utilization > 1 ? "danger" : utilization > 0.8 ? "warn" : "default"}
                        />
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </SectionCard>
          )}

          {!isServiceIdea && viewMode !== "detailed" && bizSimRecs.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-brand-600">
                  <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900">Recommended Simulations</div>
                  <div className="text-xs text-slate-500">Run these what-if scenarios based on your results.</div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {bizSimRecs.map((sim) => (
                  <button key={sim.id} onClick={() => simCardClick(sim.id)}
                    className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-brand-300 hover:bg-brand-50">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-sm">{sim.icon}</div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 group-hover:text-brand-700">{sim.label}</div>
                      <div className="mt-0.5 text-xs text-slate-500 leading-snug">{sim.desc}</div>
                    </div>
                    <svg className="ml-auto mt-1 h-4 w-4 shrink-0 text-slate-300 group-hover:text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isServiceIdea ? (
            <SectionCard title="Validation Insights" subtitle="Deeper breakdown of market signals." className={viewMode !== "detailed" ? "flex-1" : ""}>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 9v4" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="10" /></svg>
                      </div>
                      <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Critical Risks</div>
                    </div>
                    <ul className="space-y-3">
                      {reasons.length ? reasons.slice(0, 6).map((r, i) => (
                        <li key={i} className="flex gap-3 text-sm font-medium text-slate-700 leading-relaxed">
                          <span className="shrink-0 mt-1.5 flex h-1.5 w-1.5 rounded-full bg-rose-400" />
                          {r}
                        </li>
                      )) : <li className="text-sm text-slate-400 italic">No critical risks identified.</li>}
                    </ul>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                      </div>
                      <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Strategic Roadmap</div>
                    </div>
                    <ul className="space-y-3">
                      {actionPlan.length ? actionPlan.slice(0, 6).map((r, i) => (
                        <li key={i} className="flex gap-3 text-sm font-medium text-slate-700 leading-relaxed">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-brand-600 text-[10px] font-black text-white shadow-sm">
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


          {flags?.length && viewMode === "detailed" ? (
            <SectionCard title="Flags" subtitle="Issues worth addressing early.">
              <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                {flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          {false /* Trend score + Insights moved to 3-col row below the main grid */ ? (
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

              <SectionCard title="Insights" subtitle="Breakdown, reasons, and recommendations." className="flex h-[300px] flex-col overflow-hidden sm:h-[360px]">
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
                          {be !== null && (
                            <div className="flex items-center justify-between border-t border-slate-100 pt-2 mt-2">
                              <div className="text-slate-600">Break-even</div>
                              <div className="font-semibold text-slate-900">{`${formatNumber(be)} months`}</div>
                            </div>
                          )}
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

        <aside className="lg:col-span-4 flex flex-col gap-4">
          {/* V4 Score Cards: Commercial + Evidence */}
          {isV4 && (v4CommercialScore !== null || v4EvidenceScore !== null) && (
            <div className="grid grid-cols-2 gap-3">
              {v4CommercialScore !== null && (
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-center">
                  <div className="text-[9px] font-black uppercase tracking-[0.2em] text-indigo-400 mb-2">Commercial Score</div>
                  <div className={`text-3xl font-black ${v4CommercialScore >= 75 ? "text-emerald-600" : v4CommercialScore >= 50 ? "text-amber-500" : "text-rose-500"}`}>
                    {Math.round(v4CommercialScore)}
                  </div>
                  <div className="text-[10px] font-bold text-indigo-400 mt-0.5">/ 100</div>
                </div>
              )}
              {v4EvidenceScore !== null && (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-center">
                  <div className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-500 mb-2">Evidence Score</div>
                  <div className={`text-3xl font-black ${v4EvidenceScore >= 75 ? "text-emerald-600" : v4EvidenceScore >= 50 ? "text-amber-500" : "text-rose-500"}`}>
                    {Math.round(v4EvidenceScore)}
                  </div>
                  <div className="text-[10px] font-bold text-emerald-400 mt-0.5">/ 100</div>
                </div>
              )}
            </div>
          )}

          {/* Card 1: Score + Engine */}
          <div className={`relative overflow-hidden rounded-2xl border shadow-sm flex flex-col transition-all duration-700 ${
            risk.tone === "danger" ? "border-rose-100 bg-white" :
            risk.tone === "warn"   ? "border-amber-100 bg-white" :
                                     "border-emerald-100 bg-white"
          }`}>
            {/* Accent bar */}
            <div className={`absolute top-0 left-0 w-1.5 h-full shrink-0 ${
              risk.tone === "danger" ? "bg-gradient-to-b from-rose-400 to-rose-600" :
              risk.tone === "warn"   ? "bg-gradient-to-b from-amber-400 to-amber-600" :
                                       "bg-gradient-to-b from-emerald-400 to-emerald-600"
            }`} />

            {/* Inner */}
            <div className="relative flex flex-col px-5 py-6 gap-0">

              {/* ── Score section ── */}
              <div className="flex flex-col items-center text-center shrink-0">
                <div className="relative group">
                  <div className={`absolute -inset-3 rounded-full blur-xl opacity-15 transition-all duration-700 group-hover:opacity-30 ${
                    risk.tone === "danger" ? "bg-rose-500" : risk.tone === "warn" ? "bg-amber-500" : "bg-emerald-500"
                  }`} />
                  <CircularScore score={score} tone={risk.tone} size={148} strokeWidth={12} />
                </div>
                <div className="mt-5">
                  <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-1.5">Overall Verdict</div>
                  <div className={`text-2xl font-black tracking-tight leading-none ${
                    risk.tone === "danger" ? "text-rose-600" :
                    risk.tone === "warn"   ? "text-amber-600" : "text-emerald-600"
                  }`}>{classification}</div>
                  <p className="mt-2 text-xs font-semibold text-slate-500 max-w-[200px] mx-auto leading-relaxed">
                    {validation?.market_research?.viability_score?.summary || risk.subtitle}
                  </p>
                </div>
              </div>

              {/* ── Engine badge + inline dimension bars ── */}
              <div className="mt-5 pt-5 border-t border-slate-100 shrink-0">
                <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-50 text-[10px] font-black text-slate-500 ring-1 ring-slate-100">
                  <div className={`h-1.5 w-1.5 rounded-full animate-pulse ${
                    risk.tone === "danger" ? "bg-rose-500" : risk.tone === "warn" ? "bg-amber-500" : "bg-emerald-500"
                  }`} />
                  <span>{isV4 ? "V4 UNIVERSAL ENGINE" : "DETERMINISTIC ENGINE 3.0"}</span>
                </div>
                {dimensionScores && (
                  <div className="mt-3.5 space-y-1.5">
                    {orderedDimensions.map((k) => {
                      const v = typeof dimensionScores?.[k] === "number" ? dimensionScores[k] : 0;
                      const t = toneForScore(v);
                      return (
                        <div key={k} className="flex items-center gap-2">
                          <div className="w-24 shrink-0 text-[9px] font-black uppercase tracking-wide text-slate-400 text-right leading-tight">{dimLabel(k)}</div>
                          <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full rounded-full transition-all duration-1000 ${t.barClass}`} style={{ width: pctWidth(v) }} />
                          </div>
                          <div className="w-5 shrink-0 text-[10px] font-black text-right text-slate-700">{Math.round(v)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* Card 2: Idea Strength Dimensions (simple mode only — detailed mode shows 3-col row below) */}
          {viewMode !== "detailed" && (
            <div className="flex-1 rounded-2xl border border-slate-200 bg-white shadow-sm px-5 py-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {!isServiceIdea ? "Idea Strength Dimensions" : "Validation Scores"}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {!isServiceIdea ? "Radar · bar view · scored /100" : "Quick view by dimension."}
                  </div>
                </div>
                <InfoTip text={validationExplanation} />
              </div>

              {dimensionScores ? (
                <>
                  <div style={{ height: 210 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={orderedDimensions.map(k => ({
                        subject: dimLabel(k).split(' ')[0],
                        score: Math.round(typeof dimensionScores[k] === "number" ? dimensionScores[k] : 0),
                        fullMark: 100,
                      }))}>
                        <PolarGrid stroke="#e2e8f0" />
                        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fontWeight: 700, fill: "#94a3b8" }} />
                        <Radar dataKey="score"
                          stroke={risk.tone === "danger" ? "#f43f5e" : risk.tone === "warn" ? "#f59e0b" : "#10b981"}
                          fill={risk.tone === "danger" ? "#f43f5e" : risk.tone === "warn" ? "#f59e0b" : "#10b981"}
                          fillOpacity={0.18} strokeWidth={2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ height: 170 }} className="mt-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart layout="vertical" data={orderedDimensions.map(k => ({
                        name: dimLabel(k),
                        score: Math.round(typeof dimensionScores[k] === "number" ? dimensionScores[k] : 0),
                      }))} margin={{ top: 0, right: 20, bottom: 0, left: 0 }}>
                        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 8, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 9, fontWeight: 700, fill: "#64748b" }} axisLine={false} tickLine={false} />
                        <Tooltip cursor={{ fill: "#f8fafc" }} content={({ active, payload }) => active && payload?.length ? (
                          <div className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white shadow-xl">
                            {payload[0].payload.name}: <span className="text-emerald-400">{payload[0].value}/100</span>
                          </div>
                        ) : null} />
                        <Bar dataKey="score" radius={[0, 4, 4, 0]} maxBarSize={9}>
                          {orderedDimensions.map((k) => {
                            const v = typeof dimensionScores[k] === "number" ? dimensionScores[k] : 0;
                            return <Cell key={k} fill={v >= 80 ? "#10b981" : v >= 50 ? "#f59e0b" : "#f43f5e"} />;
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {isV4 && !isComprehensive && (
                    <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                      <span className="font-black text-slate-400">Not assessed (Basic):</span> Unit Economics, Operational Feasibility, Founder Readiness, Regulatory Risk
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500">No score breakdown available yet.</p>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Recommended Simulations — full width, detailed mode only */}
      {viewMode === "detailed" && !isServiceIdea && bizSimRecs.length > 0 && (
        <SectionCard
          title="Recommended Simulations"
          subtitle="Run these what-if scenarios based on your validation results."
          icon={
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-brand-600 shadow-sm">
              <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            </div>
          }
        >
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${Math.min(bizSimRecs.length, 4)}, minmax(0, 1fr))` }}
          >
            {bizSimRecs.map((sim) => (
              <button
                key={sim.id}
                onClick={() => simCardClick(sim.id)}
                className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-300 hover:shadow-md"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-base">{sim.icon}</div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 group-hover:text-brand-700">{sim.label}</div>
                  <div className="mt-0.5 text-xs text-slate-500 leading-snug">{sim.desc}</div>
                </div>
                <svg className="ml-auto mt-1 h-4 w-4 shrink-0 text-slate-300 group-hover:text-brand-500 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ── Detailed mode: Trend Score + Insights + ISD in one aligned 3-col row ── */}
      {viewMode === "detailed" && !isServiceIdea && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Trend Score */}
          <SectionCard
            title="Trend score"
            subtitle="Keyword trend and community signals."
            className="flex flex-col"
            headerRight={
              <div className="w-full max-w-[220px]">
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
                          <span key={k} className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">{k}</span>
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
                        {keywordsToTrack.length ? "Keyword trend insights will appear here when demand data is connected." : "Add business name and industry details to generate keywords and prepare the trend preview."}
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
                    {[["Mentions", "Across tracked communities"], ["Momentum", "Week-over-week change"], ["Top spaces", "Where people discuss it"]].map(([label, sub]) => (
                      <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                        <div className="mt-1 text-lg font-semibold text-slate-900">-</div>
                        <div className="mt-1 text-xs text-slate-500">{sub}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">No community signals yet.</div>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Insights */}
          <SectionCard title="Insights" subtitle="Breakdown, reasons, and recommendations." className="flex flex-col">
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
                          <div className={`h-full rounded-full transition-all duration-1000 ${(dimensionScores[key] || 0) >= 80 ? 'bg-emerald-500' : (dimensionScores[key] || 0) >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${dimensionScores[key] || 0}%` }} />
                        </div>
                        <div className="font-bold text-slate-900 text-xs w-6 text-right">{Math.round(dimensionScores[key] || 0)}</div>
                      </div>
                    </div>
                  ))}
                  {dimensionScores?.problem_severity === undefined && (
                    <>
                      {be !== null && (
                        <div className="flex items-center justify-between border-t border-slate-100 pt-2 mt-2">
                          <div className="text-slate-600">Break-even</div>
                          <div className="font-semibold text-slate-900">{`${formatNumber(be)} months`}</div>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <div className="text-slate-600">Runway</div>
                        <div className="font-semibold text-slate-900">{runway === null ? "Infinity" : `${formatNumber(runway)} months`}</div>
                      </div>
                    </>
                  )}
                </div>
              ) : sideTab === "reasons" ? (
                <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                  {reasons.slice(0, 999).map((r) => <li key={r}>{r}</li>)}
                </ul>
              ) : (
                <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                  {actionPlan.length ? actionPlan.slice(0, 999).map((r) => <li key={r}>{r}</li>) : <li>Update inputs to generate actions.</li>}
                </ul>
              )}
            </div>
          </SectionCard>

          {/* Idea Strength Dimensions */}
          <SectionCard title="Idea Strength Dimensions" subtitle="Radar · bar view · scored /100" className="flex flex-col">
            {dimensionScores ? (
              <>
                <div className="flex-1 flex flex-col gap-2">
                  <div style={{ height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={orderedDimensions.map(k => ({ subject: dimLabel(k).split(' ')[0], score: Math.round(typeof dimensionScores[k] === "number" ? dimensionScores[k] : 0), fullMark: 100 }))}>
                        <PolarGrid stroke="#e2e8f0" />
                        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fontWeight: 700, fill: "#94a3b8" }} />
                        <Radar dataKey="score"
                          stroke={risk.tone === "danger" ? "#f43f5e" : risk.tone === "warn" ? "#f59e0b" : "#10b981"}
                          fill={risk.tone === "danger" ? "#f43f5e" : risk.tone === "warn" ? "#f59e0b" : "#10b981"}
                          fillOpacity={0.18} strokeWidth={2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ height: 185 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart layout="vertical" data={orderedDimensions.map(k => ({ name: dimLabel(k), score: Math.round(typeof dimensionScores[k] === "number" ? dimensionScores[k] : 0) }))} margin={{ top: 0, right: 20, bottom: 0, left: 0 }}>
                        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 8, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 9, fontWeight: 700, fill: "#64748b" }} axisLine={false} tickLine={false} />
                        <Tooltip cursor={{ fill: "#f8fafc" }} content={({ active, payload }) => active && payload?.length ? (
                          <div className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white shadow-xl">
                            {payload[0].payload.name}: <span className="text-emerald-400">{payload[0].value}/100</span>
                          </div>
                        ) : null} />
                        <Bar dataKey="score" radius={[0, 4, 4, 0]} maxBarSize={9}>
                          {orderedDimensions.map((k) => {
                            const v = typeof dimensionScores[k] === "number" ? dimensionScores[k] : 0;
                            return <Cell key={k} fill={v >= 80 ? "#10b981" : v >= 50 ? "#f59e0b" : "#f43f5e"} />;
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                {isV4 && !isComprehensive && (
                  <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                    <span className="font-black text-slate-400">Not assessed (Basic):</span> Unit Economics, Operational Feasibility, Founder Readiness, Regulatory Risk
                  </div>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-500">No score breakdown available yet.</p>
            )}
          </SectionCard>
        </div>
      )}

      {/* Market Sizing, Competitor Intelligence, Price Intelligence — shown for all idea types */}
      {(validation?.market_research?.market_sizing || validation?.market_research?.competitor_analysis || validation?.market_research?.price_intelligence) && (
        <div className="grid grid-cols-1 gap-4">

          {validation?.market_research?.market_sizing && (
            <SectionCard title="Market Sizing" subtitle="TAM · SAM · Projected Growth Rate · 2030 Market Projection">
              <div className="space-y-4">
                {[
                  { label: "Total Market (TAM)", value: validation.market_research.market_sizing.total_addressable_market, color: "bg-brand-50 border-brand-200", text: "text-brand-700" },
                  { label: "Your Segment (SAM)", value: validation.market_research.market_sizing.serviceable_addressable_market, color: "bg-emerald-50 border-emerald-200", text: "text-emerald-700" },
                  { label: "Growth Rate (CAGR)", value: validation.market_research.market_sizing.projected_growth_rate, color: "bg-amber-50 border-amber-200", text: "text-amber-700" },
                  { label: "Projected by 2030", value: validation.market_research.market_sizing.projected_market_size_2030, color: "bg-indigo-50 border-indigo-200", text: "text-indigo-700" },
                ].filter(m => m.value).length > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: "Total Market (TAM)", value: validation.market_research.market_sizing.total_addressable_market, color: "bg-brand-50 border-brand-200", text: "text-brand-700" },
                      { label: "Your Segment (SAM)", value: validation.market_research.market_sizing.serviceable_addressable_market, color: "bg-emerald-50 border-emerald-200", text: "text-emerald-700" },
                      { label: "Growth Rate (CAGR)", value: validation.market_research.market_sizing.projected_growth_rate, color: "bg-amber-50 border-amber-200", text: "text-amber-700" },
                      { label: "Projected by 2030", value: validation.market_research.market_sizing.projected_market_size_2030, color: "bg-indigo-50 border-indigo-200", text: "text-indigo-700" },
                    ].filter(m => m.value).map(({ label, value, color, text }) => (
                      <div key={label} className={`rounded-xl border p-4 ${color}`}>
                        <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 mb-2">{label}</div>
                        <div className={`text-sm font-black leading-snug ${text}`}>{value}</div>
                      </div>
                    ))}
                  </div>
                )}
                {(validation.market_research.market_sizing.tam_basis || validation.market_research.market_sizing.sam_basis) && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {validation.market_research.market_sizing.tam_basis && (
                      <div className="rounded-xl border border-slate-100 bg-white p-4">
                        <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">How TAM Was Calculated</div>
                        <p className="text-xs font-semibold text-slate-600 leading-relaxed">{validation.market_research.market_sizing.tam_basis}</p>
                      </div>
                    )}
                    {validation.market_research.market_sizing.sam_basis && (
                      <div className="rounded-xl border border-slate-100 bg-white p-4">
                        <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">How SAM Was Scoped</div>
                        <p className="text-xs font-semibold text-slate-600 leading-relaxed">{validation.market_research.market_sizing.sam_basis}</p>
                      </div>
                    )}
                  </div>
                )}
                {/* TAM vs SAM donut chart */}
                {(validation.market_research.market_sizing.total_addressable_market || validation.market_research.market_sizing.serviceable_addressable_market) && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="h-48 flex flex-col">
                      <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">TAM vs SAM</div>
                      <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={[
                              { name: "TAM", value: 60 },
                              { name: "SAM", value: 25 },
                              { name: "Rest", value: 15 },
                            ]} cx="50%" cy="50%" innerRadius="50%" outerRadius="70%" paddingAngle={3} dataKey="value" startAngle={90} endAngle={-270}>
                              <Cell fill="#6366f1" />
                              <Cell fill="#10b981" />
                              <Cell fill="#e2e8f0" />
                            </Pie>
                            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "10px", fontWeight: 700 }}
                              formatter={(name) => name === "TAM"
                                ? <span style={{ color: "#6366f1" }}>{`TAM · ${validation.market_research.market_sizing.total_addressable_market || ""}`}</span>
                                : name === "SAM"
                                  ? <span style={{ color: "#10b981" }}>{`SAM · ${validation.market_research.market_sizing.serviceable_addressable_market || ""}`}</span>
                                  : ""}
                            />
                            <Tooltip content={({ active, payload }) => active && payload?.length && payload[0].name !== "Rest" ? (
                              <div className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white shadow-xl">
                                {payload[0].name === "TAM" ? validation.market_research.market_sizing.total_addressable_market : validation.market_research.market_sizing.serviceable_addressable_market}
                              </div>
                            ) : null} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    {validation.market_research.market_sizing.growth_drivers?.length > 0 && (
                      <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                        <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-3">Key Growth Drivers</div>
                        <ul className="space-y-2">
                          {validation.market_research.market_sizing.growth_drivers.map((d, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-xs font-semibold text-slate-600">
                              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[9px] font-black text-brand-700">{i + 1}</span>
                              {d}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {!validation.market_research.market_sizing.total_addressable_market && !validation.market_research.market_sizing.serviceable_addressable_market && validation.market_research.market_sizing.growth_drivers?.length > 0 && (
                  <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                    <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-3">Key Growth Drivers</div>
                    <ul className="space-y-2">
                      {validation.market_research.market_sizing.growth_drivers.map((d, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-xs font-semibold text-slate-600">
                          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[9px] font-black text-brand-700">{i + 1}</span>
                          {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {validation?.market_research?.competitor_analysis && (
            <SectionCard title="Competitor Intelligence" subtitle="Market saturation · Competitor metrics · Your positioning opportunity">
              <div className="space-y-4">
                <div className={`grid grid-cols-1 gap-3 ${validation.market_research.competitor_analysis.competitive_moat ? "sm:grid-cols-3" : ""}`}>
                  {validation.market_research.competitor_analysis.market_saturation && (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-slate-100 bg-slate-50 p-4 text-center">
                      <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Market Saturation</div>
                      <div className={`text-xl font-black ${
                        validation.market_research.competitor_analysis.market_saturation === "High" ? "text-rose-600" :
                        validation.market_research.competitor_analysis.market_saturation === "Medium" ? "text-amber-600" : "text-emerald-600"
                      }`}>{validation.market_research.competitor_analysis.market_saturation}</div>
                    </div>
                  )}
                  {validation.market_research.competitor_analysis.competitive_moat && (
                    <div className={`rounded-xl border border-slate-100 bg-white p-4 ${validation.market_research.competitor_analysis.market_saturation ? "sm:col-span-2" : ""}`}>
                      <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Your Competitive Moat</div>
                      <p className="text-xs font-semibold text-slate-700 leading-relaxed">{validation.market_research.competitor_analysis.competitive_moat}</p>
                    </div>
                  )}
                </div>
                {validation.market_research.competitor_analysis.top_competitors?.length > 0 ? (
                  <div className="rounded-xl border border-slate-100">
                    <table className="w-full table-fixed text-[11px]">
                      <colgroup>
                        <col className="w-[18%]" />
                        <col className="w-[13%]" />
                        <col className="w-[11%]" />
                        <col className="w-[13%]" />
                        <col className="w-[22%]" />
                        <col className="w-[23%]" />
                      </colgroup>
                      <thead className="bg-slate-50">
                        <tr>
                          {["Competitor", "Est. Revenue", "Market Share", "Price Range", "Strength", "Weakness"].map((h) => (
                            <th key={h} className="px-3 py-2.5 text-left font-black uppercase tracking-wider text-[9px] text-slate-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {validation.market_research.competitor_analysis.top_competitors.map((c, i) => (
                          <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/50">
                            <td className="px-3 py-3 font-black text-slate-900">
                              <div className="truncate">{c.name}</div>
                              {c.description && <div className="mt-0.5 text-[10px] font-medium text-slate-400 leading-snug line-clamp-2">{c.description}</div>}
                            </td>
                            <td className="px-3 py-3 font-bold text-slate-700 truncate">{c.estimated_revenue || null}</td>
                            <td className="px-3 py-3 font-bold text-slate-700 truncate">{c.market_share || null}</td>
                            <td className="px-3 py-3 font-black text-emerald-700 truncate">{c.price_range || null}</td>
                            <td className="px-3 py-3 text-slate-600 leading-snug">{c.strength || null}</td>
                            <td className="px-3 py-3 text-rose-600 leading-snug">{c.weakness || null}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs font-semibold text-slate-400">
                    No specific competitors identified — market may be emerging or niche.
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {validation?.market_research?.price_intelligence && (
            <SectionCard title="Price Intelligence" subtitle="What similar products charge · Your recommended pricing tiers">
              <div className="space-y-4">
                {[
                  { label: "Entry / Launch Price", value: validation.market_research.price_intelligence.recommended_entry_price, color: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", badge: "Start here" },
                  { label: "Growth Price", value: validation.market_research.price_intelligence.recommended_growth_price, color: "bg-brand-50 border-brand-200", text: "text-brand-700", badge: "Main tier" },
                  { label: "Premium Price", value: validation.market_research.price_intelligence.recommended_premium_price, color: "bg-amber-50 border-amber-200", text: "text-amber-800", badge: "Enterprise" },
                ].filter(p => p.value).length > 0 && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {[
                      { label: "Entry / Launch Price", value: validation.market_research.price_intelligence.recommended_entry_price, color: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", badge: "Start here" },
                      { label: "Growth Price", value: validation.market_research.price_intelligence.recommended_growth_price, color: "bg-brand-50 border-brand-200", text: "text-brand-700", badge: "Main tier" },
                      { label: "Premium Price", value: validation.market_research.price_intelligence.recommended_premium_price, color: "bg-amber-50 border-amber-200", text: "text-amber-800", badge: "Enterprise" },
                    ].filter(p => p.value).map(({ label, value, color, text, badge }) => (
                      <div key={label} className={`rounded-xl border p-4 flex flex-col gap-2 ${color}`}>
                        <div className="flex items-center justify-between">
                          <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</div>
                          <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase ${text} bg-white/70`}>{badge}</span>
                        </div>
                        <div className={`text-base font-black leading-tight ${text}`}>{value}</div>
                      </div>
                    ))}
                  </div>
                )}
                {validation.market_research.price_intelligence.pricing_rationale && (
                  <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                    <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1.5">Why These Prices Work</div>
                    <p className="text-xs font-semibold text-slate-600 leading-relaxed">{validation.market_research.price_intelligence.pricing_rationale}</p>
                  </div>
                )}
                {validation.market_research.price_intelligence.similar_products?.length > 0 && (
                  <div className="rounded-xl border border-slate-100 bg-white p-4">
                    <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-3">Similar Products Found in Market</div>
                    <div className="space-y-2">
                      {validation.market_research.price_intelligence.similar_products.map((p, i) => (
                        <div key={i} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                          <span className="text-xs font-bold text-slate-700">{p.name}</span>
                          <div className="flex items-center gap-2">
                            {p.tier && <span className="text-[9px] font-black uppercase text-slate-400">{p.tier}</span>}
                            <span className="rounded-lg bg-emerald-100 px-2 py-0.5 text-[11px] font-black text-emerald-700">{p.price}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>
          )}

        </div>
      )}

      {!isServiceIdea ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

          {validation?.market_research?.target_customer && (
            <SectionCard title="Target Customer Profile" subtitle="Pain points and buying behaviour." className="flex flex-col">
              <div className="flex-1 flex flex-col gap-3">
                <div className="rounded-xl border border-slate-100 p-4 bg-white">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Customer Profile</div>
                  <div className="text-base font-black text-slate-900 mb-3">{validation.market_research.target_customer.profile}</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-[9px] font-black text-slate-400 uppercase mb-1.5">Primary Pain Points</div>
                      <ul className="space-y-1.5">
                        {validation.market_research.target_customer.pain_points?.map((p, i) => (
                          <li key={i} className="text-xs font-bold text-slate-600 flex gap-2">
                            <span className="text-brand-500">→</span> {String(p).replace(/^[—–\-]\s*/, "")}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-[9px] font-black text-slate-400 uppercase mb-1.5">Buying Behaviour</div>
                      <p className="text-xs font-semibold text-slate-600 leading-relaxed">
                        {validation.market_research.target_customer.buying_behaviour}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl bg-slate-900 p-4 text-white">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Urgency & WTP</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-[9px] font-black text-slate-500 uppercase mb-1">Pain Urgency</div>
                      <div className="text-sm font-black text-brand-400">{validation.market_research.target_customer.urgency}</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-black text-slate-500 uppercase mb-1">Willingness to Pay</div>
                      <div className="text-sm font-black text-emerald-400">{validation.market_research.target_customer.willingness_to_pay}</div>
                    </div>
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {validation?.market_research?.pricing_strategy && (
            <SectionCard title="Monetization & Strategy" subtitle="Pricing models and positioning." className="flex flex-col">
              <div className="flex-1 flex flex-col gap-3">
                <div className="rounded-xl border border-slate-100 bg-white p-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Pricing Model</div>
                  <div className="text-lg font-black text-slate-900 leading-tight mb-1">
                    {validation.market_research.pricing_strategy.recommended_model}
                  </div>
                  <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                    {validation.market_research.pricing_strategy.rationale}
                  </p>
                  {validation.market_research.recommended_price_range && (
                    <div className="mt-3 flex gap-2">
                      {Object.entries(validation.market_research.recommended_price_range).map(([tier, val]) =>
                        tier !== "currency" && (
                          <div key={tier} className="flex-1 p-2 rounded-xl bg-slate-50 text-center">
                            <div className="text-[8px] font-black text-slate-400 uppercase mb-0.5">{tier}</div>
                            <div className="text-xs font-black text-slate-900">{val}</div>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Positioning</div>
                  <div className="space-y-2">
                    <div>
                      <div className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Value Proposition</div>
                      <div className="text-sm font-bold text-slate-700">{validation.market_research.positioning?.value_proposition}</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Differentiation</div>
                      <div className="text-sm font-bold text-slate-700">{validation.market_research.positioning?.differentiation}</div>
                    </div>
                    <div className="pt-1">
                      <div className="px-3 py-2 rounded-xl bg-brand-600 text-white text-xs font-black text-center">
                        "{validation.market_research.positioning?.headline_message}"
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {validation?.market_research?.go_to_market && (
            <SectionCard title="Launch Roadmap" subtitle="Channels and timeline." className="md:col-span-2">
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-100 bg-white p-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Primary Channels</div>
                  <div className="flex flex-wrap gap-2">
                    {validation.market_research.go_to_market.primary_channels?.map((c, i) => (
                      <span key={i} className="px-2.5 py-1 rounded-lg bg-slate-100 text-[10px] font-black text-slate-600">
                        {c}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3">
                    <div className="text-[9px] font-black text-slate-400 uppercase mb-1.5">Quick Wins</div>
                    <ul className="space-y-1.5">
                      {validation.market_research.go_to_market.quick_wins?.map((w, i) => (
                        <li key={i} className="text-xs font-bold text-emerald-600 flex gap-2 italic">
                          ✓ {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="rounded-xl bg-brand-50 border border-brand-100 p-4 flex items-center gap-4">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-400 mb-1">Execution Timeline</div>
                    <div className="text-xl font-black text-brand-900 leading-tight">
                      {validation.market_research.go_to_market.timeline}
                    </div>
                    <p className="mt-1 text-xs font-bold text-brand-600">Phase 1 Rollout Strategy</p>
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {validation?.market_fit || marketFit ? (
            <SectionCard
              title="Market Health Signals"
              subtitle="Real-time validation signals from Google Trends, Companies House, and Local Market."
              headerRight={<InfoTip text="Signals are derived from live market analysis of your business concept and location." />}
              className="md:col-span-2"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="group rounded-xl bg-white p-4 ring-1 ring-slate-200 shadow-sm transition-all hover:ring-brand-500 hover:shadow-md">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 6l-9.5 9.5-5-5L1 18" /><path d="M17 6h6v6" /></svg>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Demand Trend</span>
                  </div>
                  <div className="text-base font-black text-slate-900 capitalize">
                    {validation?.market_fit?.demand?.trend_direction || marketFit?.demand?.trend_direction || "Stable"}
                  </div>
                  <div className="mt-2 text-[11px] leading-relaxed font-medium text-slate-500">
                    {validation?.market_research?.market_health_narration?.demand_trend || validation?.market_fit?.demand?.explanation || marketFit?.demand?.explanation || "Search interest suggests a steady baseline."}
                  </div>
                </div>
                <div className="group rounded-xl bg-white p-4 ring-1 ring-slate-200 shadow-sm transition-all hover:ring-emerald-500 hover:shadow-md">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Sector Survival</span>
                  </div>
                  <div className="text-base font-black text-slate-900">
                    {validation?.market_fit?.sector?.survival_ratio ? formatPercent(validation.market_fit.sector.survival_ratio) : (marketFit?.sector?.survival_ratio ? formatPercent(marketFit.sector.survival_ratio) : "60%")}
                  </div>
                  <div className="mt-2 text-[11px] leading-relaxed font-medium text-slate-500">
                    {validation?.market_research?.market_health_narration?.sector_survival || validation?.market_fit?.sector?.explanation || marketFit?.sector?.explanation || "Average survival rates detected for this SIC category."}
                  </div>
                </div>
                <div className="group rounded-xl bg-white p-4 ring-1 ring-slate-200 shadow-sm transition-all hover:ring-amber-500 hover:shadow-md">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Competition</span>
                  </div>
                  <div className="text-base font-black text-slate-900 capitalize">
                    {validation?.market_fit?.competition?.competition_level || marketFit?.competition?.competition_level || "Balanced"}
                  </div>
                  <div className="mt-2 text-[11px] leading-relaxed font-medium text-slate-500">
                    {validation?.market_research?.market_health_narration?.competition || validation?.market_fit?.competition?.explanation || marketFit?.competition?.explanation || "Standard local competition detected."}
                  </div>
                </div>
              </div>
            </SectionCard>
          ) : null}
        </div>
      ) : null}

      {/* Research Sources — comprehensive V4 uses market_research.sources; legacy uses research_data.sources */}
      {(() => {
        const sourcesObj = (isV4 && isComprehensive && Object.keys(v4Sources).length > 0)
          ? v4Sources
          : (validation?.research_data?.sources || {});
        const hasAny = Object.values(sourcesObj).some((s) => Array.isArray(s) && s.length > 0);
        if (!hasAny) return null;
        return (
          <SectionCard
            title="Research Sources"
            subtitle={isComprehensive ? "Verified web sources used to inform this comprehensive analysis." : "Live web sources used to inform this validation report."}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Object.entries(sourcesObj)
                .filter(([, items]) => Array.isArray(items) && items.length > 0)
                .map(([category, items]) => (
                  <div key={category}>
                    <div className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 mb-2">
                      {category.replace(/_/g, " ")}
                    </div>
                    <ul className="space-y-2">
                      {items.slice(0, 3).map((src, i) =>
                        src?.url ? (
                          <li key={i} className="flex flex-col gap-0.5">
                            <a
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-semibold text-brand-600 hover:underline leading-snug line-clamp-2"
                            >
                              {src.title || src.url}
                            </a>
                            {src.snippet && (
                              <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">
                                {src.snippet}
                              </p>
                            )}
                          </li>
                        ) : null
                      )}
                    </ul>
                  </div>
                ))}
            </div>
          </SectionCard>
        );
      })()}
    </div>
  );
}
