import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import Input from "../components/Input";
import SectionCard from "../components/SectionCard";
import Spinner from "../components/Spinner";
import SegmentedTabs from "../components/SegmentedTabs";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import { hasFeatureAccess, isPlatformFeatureRestricted } from "../lib/permissions";
import { useAuthStore } from "../store/auth";
import InfoTip from "../components/InfoTip";
import NumberInput, { parseIntSafe, parseNumber } from "../components/NumberInput";
import { CURRENCY_CODES, currencyLabel } from "../lib/currencies";
import { imageFileToDataUrl } from "../lib/files";

function humanizeValidationError(e) {
  const msg = e instanceof Error ? e.message : String(e || "");
  if (msg === "NETWORK_ERROR") {
    const base = import.meta.env.VITE_API_URL ?? import.meta.env.REACT_APP_BACKEND_URL ?? "http://localhost:8000";
    return `Can't reach the server at ${base}. Start the backend and check your API URL.`;
  }
  if (msg === "TIMEOUT") return "The server is taking too long to respond. Check the backend logs and try again.";
  if (msg.startsWith("HTTP 401:")) return "Please sign in to continue.";
  if (msg.startsWith("HTTP 422:")) {
    const detail = msg.replace(/^HTTP 422:\s*/i, "").trim();
    return detail ? `Validation error: ${detail}` : "Please check the required fields and try again.";
  }
  return msg;
}

function FieldLabel({ children, info }) {
  return (
    <div className="ea-label flex items-center gap-1">
      <div>{children}</div>
      {info ? <InfoTip text={info} /> : null}
    </div>
  );
}

const UPPER_ABBREVIATIONS = new Set(["llp", "sme", "smes", "b2b", "b2c", "b2g", "it", "hr", "uk", "usa"]);
const VALIDATION_DEFAULTS_KEY = "ea_validation_stage_defaults";
const FREQUENCY_OPTIONS = ["daily", "weekly", "monthly", "yearly", "custom"];

function loadValidationStageDefaults() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(VALIDATION_DEFAULTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function deriveFrequencyFields(value) {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase();
  if (!raw) {
    return { frequency: "", frequency_category: "", frequency_custom: "" };
  }
  if (["daily", "weekly", "monthly", "yearly"].includes(normalized)) {
    return { frequency: normalized, frequency_category: normalized, frequency_custom: "" };
  }
  return { frequency: raw, frequency_category: "custom", frequency_custom: raw };
}

function buildInitialBusinessForm() {
  const defaults = loadValidationStageDefaults();
  const frequencyFields = deriveFrequencyFields(defaults.frequency || "");
  return {
    pathway: "business_idea",
    context: {
      business_name: defaults.business_name || "",
      business_type_category: defaults.business_type_category || "Technology",
      business_type_other: defaults.business_type_other || "",
      primary_industry_category: defaults.primary_industry_category || "IT",
      primary_industry_other: defaults.primary_industry_other || "",
      location: defaults.location || "",
      currency: defaults.currency || "GBP",
      founder_hours_per_week: "40",
      stage: "idea"
    },
    problem: {
      customer_segment_category: defaults.customer_segment_category || "SMEs",
      customer_segment_other: defaults.customer_segment_other || "",
      problem_type: defaults.problem_type || "",
      frequency: frequencyFields.frequency,
      frequency_category: frequencyFields.frequency_category,
      frequency_custom: frequencyFields.frequency_custom,
      alternatives: defaults.alternatives || ""
    },
    offer: {
      service_type: defaults.service_type || "",
      pricing_model: "fixed_job",
      price_per_unit: "",
      deliverable_unit_category: "unit",
      deliverable_unit_other: ""
    },
    demand: { expected_units_per_month: "", expected_customers: "", sales_cycle_days: "", payment_terms_days: "14" },
    costs: { variable_cost_per_unit: "", fixed_costs_monthly: "", founder_draw_monthly: "", contractor_costs_monthly: "" },
    capacity: { team_size: "1", capacity_units_per_person_per_month: "" },
    cash: { starting_cash: "", upfront_costs: "" },
    go_to_market: { target_market: "B2C", customer_budget_level: "Unknown", sub_industry: "", channels: [] }
  };
}

function mergeStageDefaultsIntoBusinessForm(source) {
  const defaults = loadValidationStageDefaults();
  const next = structuredClone(source || buildInitialBusinessForm());
  next.context ||= {};
  next.problem ||= {};
  next.offer ||= {};

  next.context.business_name ||= defaults.business_name || "";
  next.context.business_type_category ||= defaults.business_type_category || "Technology";
  next.context.business_type_other ||= defaults.business_type_other || "";
  next.context.primary_industry_category ||= defaults.primary_industry_category || "IT";
  next.context.primary_industry_other ||= defaults.primary_industry_other || "";
  next.context.location ||= defaults.location || "";
  next.context.currency ||= defaults.currency || "GBP";

  next.problem.customer_segment_category ||= defaults.customer_segment_category || "SMEs";
  next.problem.customer_segment_other ||= defaults.customer_segment_other || "";
  next.problem.problem_type ||= defaults.problem_type || "";
  next.problem.alternatives ||= defaults.alternatives || "";

  if (!String(next.problem.frequency || "").trim()) {
    next.problem.frequency = defaults.frequency || "";
  }

  next.offer.service_type ||= defaults.service_type || "";
  return next;
}

function formatEnumLabel(value) {
  const raw = String(value || "");
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (UPPER_ABBREVIATIONS.has(lower)) return raw.toUpperCase();
  if (/^\d/.test(raw)) return raw;
  return raw
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ValidationWizardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editingWorkspaceId = searchParams.get("workspace_id");
  const fromOtherModule = searchParams.get("from") === "module";
  const isCreateWorkspace = fromOtherModule;
  const returnTo = searchParams.get("return");
  const requestedHistoryId = searchParams.get("history_id");
  const requestedHistoryType = searchParams.get("history_type");
  const storedWorkspaceId = useWorkspaceStore((s) => s.workspaceId);
  const isMemberMode = useWorkspaceStore((s) => s.isMemberMode);
  const memberPermissionType = useWorkspaceStore((s) => s.memberPermissionType);
  const memberPermissions = useWorkspaceStore((s) => s.memberPermissions);
  const platformRestrictions = useAuthStore((s) => s.platformRestrictions);

  const canEvaluateIdea =
    !isPlatformFeatureRestricted("validation", "evaluate_idea", platformRestrictions) &&
    (!isMemberMode || hasFeatureAccess("validation", "evaluate_idea", memberPermissionType, memberPermissions));
  const canServiceValidation =
    !isPlatformFeatureRestricted("validation", "service_validation", platformRestrictions) &&
    (!isMemberMode || hasFeatureAccess("validation", "service_validation", memberPermissionType, memberPermissions));

  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceNameStore = useWorkspaceStore((s) => s.setWorkspaceName);
  const setWorkspaceLogoStore = useWorkspaceStore((s) => s.setWorkspaceLogo);
  const setDecisionStatus = useWorkspaceStore((s) => s.setDecisionStatus);
  const setServiceDecisionStatus = useWorkspaceStore((s) => s.setServiceDecisionStatus);
  const setInputs = useWorkspaceStore((s) => s.setInputs);
  const setIdeaValidation = useWorkspaceStore((s) => s.setIdeaValidation);
  const draftIdeaValidation = useWorkspaceStore((s) => s.draftIdeaValidation);
  const draftServiceIdea = useWorkspaceStore((s) => s.draftServiceIdea);
  const setDraftIdeaValidation = useWorkspaceStore((s) => s.setDraftIdeaValidation);
  const setDraftServiceIdea = useWorkspaceStore((s) => s.setDraftServiceIdea);
  const setValidation = useWorkspaceStore((s) => s.setValidation);
  const setCurrency = useWorkspaceStore((s) => s.setCurrency);
  const authEmail = useAuthStore((s) => s.email);

  const [mode, setMode] = useState(fromOtherModule ? "fill" : "select"); // select | fill
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isPrefilling, setIsPrefilling] = useState(false);
  const [savedNotice, setSavedNotice] = useState(null);
  const [existingCatalogue, setExistingCatalogue] = useState({ products: [], customers: [], vendors: [] });
  const [savedServiceIdeas, setSavedServiceIdeas] = useState([]);
  const [validationHistory, setValidationHistory] = useState([]);
  const [editingHistoryEntry, setEditingHistoryEntry] = useState(null);
  const [serviceSelection, setServiceSelection] = useState("");
  const [hasAppliedDrafts, setHasAppliedDrafts] = useState(false);
  const [contentTab, setContentTab] = useState("builder");
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historyRequestHandled, setHistoryRequestHandled] = useState(false);
  const [marketResearch, setMarketResearch] = useState(null);
  const [mrLoading, setMrLoading] = useState(false);
  const [mrError, setMrError] = useState(null);
  const [stageOneResearchReady, setStageOneResearchReady] = useState(false);
  const [showBuilderMarketInsight, setShowBuilderMarketInsight] = useState(false);
  const [lastResearchHash, setLastResearchHash] = useState(null);
  const initialStageDefaults = useMemo(() => loadValidationStageDefaults(), []);

  const [workspaceName, setWorkspaceName] = useState(() => String(loadValidationStageDefaults().workspace_name || "").trim());
  const [workspaceNameTouched, setWorkspaceNameTouched] = useState(false);

  const BUSINESS_TYPE_OPTIONS = useMemo(() => ["Technology", "Health", "Finance", "Cleaning", "Education", "Retail", "Logistics", "Real Estate", "Hospitality", "Manufacturing", "Agriculture", "Media", "Other"], []);
  const PRIMARY_INDUSTRY_OPTIONS = useMemo(() => ["IT", "Marketing", "Consulting", "Accounting", "Legal", "HR", "Design", "Sales", "Operations", "Customer Support", "Healthcare", "Education", "Construction", "Other"], []);
  const CUSTOMER_SEGMENT_OPTIONS = useMemo(() => ["SMEs", "Freelancers", "Households", "Other"], []);
  const DELIVERABLE_UNIT_OPTIONS = useMemo(() => ["unit", "job", "session", "project", "month", "hour", "subscription", "Other"], []);
  const PRICING_MODEL_OPTIONS = useMemo(() => [{ value: "hourly", label: "Hourly" }, { value: "fixed_job", label: "Fixed job" }, { value: "retainer", label: "Retainer" }], []);
  const GTM_CHANNEL_OPTIONS = useMemo(
    () => ["Referrals", "Ads", "Partnerships", "Marketplace", "Outbound", "SEO", "Social", "Events", "Communities", "Affiliates"],
    []
  );

  const PROFILE_BUSINESS_TYPES = useMemo(
    () => ["sole_trader", "partnership", "limited_company", "llp", "non_profit", "startup"],
    []
  );
  const PROFILE_INDUSTRIES = useMemo(
    () => [
      "consulting",
      "technology",
      "finance",
      "healthcare",
      "education",
      "retail",
      "ecommerce",
      "logistics",
      "manufacturing",
      "real_estate",
      "marketing",
      "other"
    ],
    []
  );
  const PROFILE_COMPANY_SIZES = useMemo(() => ["solo", "2-5", "6-10", "11-50", "51-200", "200+"], []);
  const PROFILE_MONTHLY_REVENUE = useMemo(
    () => ["0-1k", "1k-5k", "5k-10k", "10k-50k", "50k-100k", "100k+"],
    []
  );
  const PROFILE_OPERATING_STAGE = useMemo(
    () => ["idea", "pre_revenue", "early_revenue", "growing", "established"],
    []
  );
  const PROFILE_DELIVERY_MODEL = useMemo(() => ["manual", "hybrid", "automated"], []);
  const PROFILE_TARGET_CUSTOMER = useMemo(() => ["individual", "startup", "SME", "corporate"], []);
  const PROFILE_REVENUE_MODEL = useMemo(() => ["one_off", "subscription", "retainer", "project_based", "mixed"], []);

  const SERVICE_CATEGORY_OPTIONS = useMemo(
    () => ["consulting", "training", "agency", "freelance", "technical_service", "other"],
    []
  );
  const TARGET_CUSTOMER_OPTIONS = useMemo(
    () => ["individual", "startup", "SME", "corporate"],
    []
  );
  const TARGET_MARKET_SCOPE_OPTIONS = useMemo(
    () => ["local", "regional", "national", "global"],
    []
  );
  const DEMAND_EVIDENCE_OPTIONS = useMemo(
    () => [
      "assumption_only",
      "market_research",
      "enquiries",
      "LOIs",
      "paid_pilot",
      "paying_customers",
      "repeat_paying_customers"
    ],
    []
  );
  const DIFFERENTIATION_OPTIONS = useMemo(() => ["low", "medium", "high"], []);

  const [form, setForm] = useState(() => buildInitialBusinessForm());
  const [serviceForm, setServiceForm] = useState(() => ({
    service_name: "",
    service_category: "consulting",
    service_description: "",
    target_customer_type: "SME",
    target_market_scope: "local",
    price_per_sale: "",
    expected_sales_per_month: "",
    direct_labour_cost_per_sale: "",
    contractor_cost_per_sale: "",
    materials_cost_per_sale: "",
    travel_cost_per_sale: "",
    other_direct_cost_per_sale: "",
    monthly_software_cost: "",
    monthly_marketing_cost: "",
    monthly_admin_cost: "",
    monthly_rent_cost: "",
    monthly_other_fixed_cost: "",
    hours_required_per_sale: "",
    available_delivery_hours_per_month: "",
    demand_evidence_type: "assumption_only",
    number_of_interested_leads: "",
    number_of_paying_customers: "",
    competitor_price_low: "",
    competitor_price_high: "",
    differentiation_level: "medium"
  }));
  const [serviceCurrency, setServiceCurrency] = useState("GBP");
  const [profile, setProfile] = useState(() => ({
    company_name: "",
    logo_data_url: "",
    legal_name: "",
    registration_number: "",
    business_type: "limited_company",
    primary_industry: "consulting",
    secondary_industries: [],
    about_company: "",
    tagline: "",
    year_established: "",
    company_size: "solo",
    services: [{ service_name: "", service_category: "consulting", service_description: "" }],
    vision: "",
    mission: "",
    core_values: "",
    country: "",
    city: "",
    state_or_region: "",
    postcode: "",
    address_line_1: "",
    address_line_2: "",
    email: "",
    phone_number: "",
    website: "",
    linkedin_url: "",
    twitter_url: "",
    instagram_url: "",
    facebook_url: "",
    monthly_revenue_range: "",
    employee_count: "",
    operating_stage: "idea",
    delivery_model: "manual",
    target_customer_type: "",
    primary_revenue_model: "",
    key_offering_focus: ""
  }));
  const workspaceServices = useMemo(
    () =>
      Array.isArray(profile.services)
        ? profile.services.filter((s) => String(s?.service_name || "").trim())
        : [],
    [profile.services]
  );

  const savedServiceIdeaOptions = useMemo(() => {
    const names = new Set();
    const history = Array.isArray(savedServiceIdeas) ? savedServiceIdeas : [];
    history.forEach((entry) => {
      const name = String(entry?.service_name || entry?.payload?.service_name || "").trim();
      if (name) names.add(name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [savedServiceIdeas]);

  const combinedServiceOptions = useMemo(() => {
    const names = new Set();
    workspaceServices.forEach((s) => {
      const name = String(s?.service_name || "").trim();
      if (name) names.add(name);
    });
    savedServiceIdeaOptions.forEach((name) => names.add(name));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [savedServiceIdeaOptions, workspaceServices]);
  const historyCounts = useMemo(
    () => ({
      all: validationHistory.length,
      pending: validationHistory.filter((entry) => entry.status === "pending").length,
      accepted: validationHistory.filter((entry) => entry.status === "accepted").length,
      rejected: validationHistory.filter((entry) => entry.status === "rejected").length,
    }),
    [validationHistory]
  );
  const filteredValidationHistory = useMemo(() => {
    if (historyFilter === "all") return validationHistory;
    return validationHistory.filter((entry) => entry.status === historyFilter);
  }, [historyFilter, validationHistory]);
  const activeWorkspaceId = editingWorkspaceId || storedWorkspaceId;

  const isProductPath = form.pathway === "product_service_idea";
  const formBlocks = useMemo(() => {
    if (isCreateWorkspace) {
      return [
        {
          key: "workspace_profile",
          label: "Workspace profile",
          desc: "Identity, services, operations, and contact details."
        }
      ];
    }
    if (isProductPath) {
      return [
        { key: "service_basics", label: "Service basics", desc: "Idea, category, and market scope." },
        { key: "revenue_inputs", label: "Revenue inputs", desc: "Price and expected sales volume." },
        { key: "direct_costs", label: "Direct delivery costs", desc: "Labour, materials, travel, and other direct costs." },
        { key: "fixed_costs", label: "Fixed monthly costs", desc: "Software, marketing, admin, and rent." },
        { key: "capacity_inputs", label: "Capacity inputs", desc: "Hours required and delivery capacity." },
        { key: "demand_inputs", label: "Demand evidence", desc: "Proof of demand and lead/customer counts." },
        { key: "competition", label: "Competitive positioning", desc: "Price range and differentiation." }
      ];
    }
    return [
      {
        key: "business",
        label: "Business details",
        desc: "Name, industry, currency, and context."
      },
      { key: "offer_demand", label: "Offer & demand", desc: "Offer, pricing, volume assumptions, and sales cycle." },
      { key: "costs", label: "Costs", desc: "Fixed and variable costs behind the model." },
      { key: "capacity_cash", label: "Capacity & cash", desc: "Capacity assumptions and starting cash/runway inputs." },
      { key: "go_to_market", label: "Go-to-market", desc: "Target market and acquisition channels." }
    ];
  }, [isCreateWorkspace, isProductPath]);

  const [enabledForms, setEnabledForms] = useState(() =>
    isCreateWorkspace
      ? { workspace_profile: true }
      : isProductPath
        ? {
            service_basics: true,
            revenue_inputs: true,
            direct_costs: true,
            fixed_costs: true,
            capacity_inputs: true,
            demand_inputs: true,
            competition: true
          }
        : { business: true, offer_demand: true, costs: true, capacity_cash: true, go_to_market: true }
  );
  const selectedCount = useMemo(() => Object.values(enabledForms).filter(Boolean).length, [enabledForms]);
  const isBusinessStageFlow = !isCreateWorkspace && !isProductPath;
  const isServiceStageFlow = !isCreateWorkspace && isProductPath;
  const businessStageKeys = useMemo(
    () => (isBusinessStageFlow ? formBlocks.map((block) => block.key) : []),
    [formBlocks, isBusinessStageFlow]
  );
  const serviceStageKeys = useMemo(
    () => (isServiceStageFlow ? formBlocks.map((block) => block.key) : []),
    [formBlocks, isServiceStageFlow]
  );
  const [currentBusinessStageIndex, setCurrentBusinessStageIndex] = useState(0);
  const [currentServiceStageIndex, setCurrentServiceStageIndex] = useState(0);
  const currentBusinessStageKey = businessStageKeys[currentBusinessStageIndex] || null;
  const currentBusinessStageMeta = formBlocks[currentBusinessStageIndex] || null;
  const isLastBusinessStage = isBusinessStageFlow && currentBusinessStageIndex === businessStageKeys.length - 1;
  const currentServiceStageKey = serviceStageKeys[currentServiceStageIndex] || null;
  const currentServiceStageMeta = formBlocks[currentServiceStageIndex] || null;
  const isLastServiceStage = isServiceStageFlow && currentServiceStageIndex === serviceStageKeys.length - 1;
  const currentInsightStageKey = isBusinessStageFlow ? currentBusinessStageKey : isServiceStageFlow ? currentServiceStageKey : null;
  const insightVisibility = useMemo(() => {
    const base = {
      showSummary: true,
      showValidationResult: true,
      showMarketOpportunity: true,
      showTargetCustomer: true,
      showProblemValidation: true,
      showDemandSignals: true,
      showAlternativeSolutions: false,
      showCompetitorMatrix: false,
      showCompetitorPricing: false,
      showPricingStrategy: false,
      showRecommendedPriceRange: false,
      showViabilityScore: false,
      showPositioning: false,
      showGoToMarket: false,
      showRisks: false,
      showNextActions: false,
    };

    const byStage = {
      business: base,
      offer_demand: {
        ...base,
        showAlternativeSolutions: true,
        showCompetitorMatrix: true,
        showCompetitorPricing: true,
        showPricingStrategy: true,
        showRecommendedPriceRange: true,
      },
      costs: {
        ...base,
        showAlternativeSolutions: true,
        showCompetitorMatrix: true,
        showCompetitorPricing: true,
        showPricingStrategy: true,
        showRecommendedPriceRange: true,
        showViabilityScore: true,
        showRisks: true,
      },
      capacity_cash: {
        ...base,
        showAlternativeSolutions: true,
        showCompetitorMatrix: true,
        showCompetitorPricing: true,
        showPricingStrategy: true,
        showRecommendedPriceRange: true,
        showViabilityScore: true,
        showRisks: true,
      },
      go_to_market: {
        ...base,
        showAlternativeSolutions: true,
        showCompetitorMatrix: true,
        showCompetitorPricing: true,
        showPricingStrategy: true,
        showRecommendedPriceRange: true,
        showViabilityScore: true,
        showPositioning: true,
        showGoToMarket: true,
        showRisks: true,
        showNextActions: true,
      },
      service_basics: base,
      revenue_inputs: {
        ...base,
        showAlternativeSolutions: true,
        showCompetitorMatrix: true,
        showCompetitorPricing: true,
        showPricingStrategy: true,
        showRecommendedPriceRange: true,
      },
      direct_costs: {
        ...base,
        showAlternativeSolutions: true,
        showCompetitorMatrix: true,
        showCompetitorPricing: true,
        showPricingStrategy: true,
        showRecommendedPriceRange: true,
        showViabilityScore: true,
      },
      fixed_costs: {
        ...base,
        showAlternativeSolutions: true,
        showCompetitorMatrix: true,
        showCompetitorPricing: true,
        showPricingStrategy: true,
        showRecommendedPriceRange: true,
        showViabilityScore: true,
        showRisks: true,
      },
      capacity_inputs: {
        ...base,
        showAlternativeSolutions: true,
        showCompetitorMatrix: true,
        showCompetitorPricing: true,
        showPricingStrategy: true,
        showRecommendedPriceRange: true,
        showViabilityScore: true,
        showRisks: true,
      },
      demand_inputs: {
        ...base,
        showAlternativeSolutions: true,
        showCompetitorMatrix: true,
        showCompetitorPricing: true,
        showPricingStrategy: true,
        showRecommendedPriceRange: true,
        showViabilityScore: true,
        showRisks: true,
        showNextActions: true,
      },
      competition: {
        ...base,
        showAlternativeSolutions: true,
        showCompetitorMatrix: true,
        showCompetitorPricing: true,
        showPricingStrategy: true,
        showRecommendedPriceRange: true,
        showViabilityScore: true,
        showPositioning: true,
        showGoToMarket: true,
        showRisks: true,
        showNextActions: true,
      },
    };

    return byStage[currentInsightStageKey] || base;
  }, [currentInsightStageKey]);

  const derivedWorkspaceName = useMemo(() => {
    if (isCreateWorkspace) {
      const pn = String(profile?.company_name || "").trim();
      return pn || "Workspace";
    }
    // For business idea / service paths, workspace name is set independently — do not derive from idea fields.
    return "";
  }, [isCreateWorkspace, profile?.company_name]);

  const recommendedCapacityPerPerson = useMemo(() => {
    const target = parseNumber(form?.demand?.expected_units_per_month, 0);
    const team = Math.max(1, parseIntSafe(form?.capacity?.team_size, 1));
    if (!target) return null;
    return Math.round(target / team);
  }, [form?.capacity?.team_size, form?.demand?.expected_units_per_month]);

  const capacityRecommendation = useMemo(() => {
    const target = parseNumber(form?.demand?.expected_units_per_month, 0);
    const team = Math.max(1, parseIntSafe(form?.capacity?.team_size, 1));
    const capacityPerPerson = parseNumber(form?.capacity?.capacity_units_per_person_per_month, 0);
    if (!target || !team) return null;
    if (!capacityPerPerson) return null;
    const requiredTeam = Math.max(1, Math.ceil(target / capacityPerPerson));
    if (requiredTeam > team) return "Hire more staff.";
    if (requiredTeam < team) return "Overstaffed / Increase Targets.";
    return "Team size matches the target at this capacity.";
  }, [
    form?.capacity?.capacity_units_per_person_per_month,
    form?.capacity?.team_size,
    form?.demand?.expected_units_per_month
  ]);

  const suggestedDeliveryHours = useMemo(() => {
    if (!isProductPath) return null;
    const expectedSales = parseNumber(serviceForm.expected_sales_per_month, 0);
    const hoursRequired = parseNumber(serviceForm.hours_required_per_sale, 0);
    if (!expectedSales || !hoursRequired) return null;
    const raw = expectedSales * hoursRequired;
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.round(raw * 100) / 100;
  }, [isProductPath, serviceForm.expected_sales_per_month, serviceForm.hours_required_per_sale]);

  const workforceStatus = useMemo(() => {
    if (!isProductPath) return null;
    if (!suggestedDeliveryHours) return null;
    const available = parseNumber(serviceForm.available_delivery_hours_per_month, 0);
    if (!available) return null;
    const diff = Math.round((available - suggestedDeliveryHours) * 100) / 100;
    if (diff === 0) return { kind: "ok", message: "Enough workforce for your expected demand.", diff };
    if (diff > 0) return { kind: "more", message: "More than enough workforce for your expected demand.", diff };
    return { kind: "need", message: "Need more workforce to meet your expected demand.", diff };
  }, [isProductPath, suggestedDeliveryHours, serviceForm.available_delivery_hours_per_month]);

  useEffect(() => {
    if (!isProductPath) return;
    if (!suggestedDeliveryHours) return;
    const current = String(serviceForm.available_delivery_hours_per_month || "").trim();
    if (current) return;
    updateService("available_delivery_hours_per_month", String(suggestedDeliveryHours));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProductPath, suggestedDeliveryHours]);

  useEffect(() => {
    const target = parseNumber(form?.demand?.expected_units_per_month, 0);
    const team = Math.max(1, parseIntSafe(form?.capacity?.team_size, 1));
    if (!target || !team) return;
    const current = String(form?.capacity?.capacity_units_per_person_per_month || "").trim();
    if (current) return;
    update("capacity.capacity_units_per_person_per_month", String(Math.round(target / team)));
  }, [form?.capacity?.capacity_units_per_person_per_month, form?.capacity?.team_size, form?.demand?.expected_units_per_month]);

  useEffect(() => {
    if (workspaceNameTouched) return;
    setWorkspaceName(derivedWorkspaceName);
  }, [derivedWorkspaceName, workspaceNameTouched]);

  useEffect(() => {
    if (!requestedHistoryId || !requestedHistoryType) return;
    if (!activeWorkspaceId || historyRequestHandled || isPrefilling) return;
    setHistoryRequestHandled(true);
    setContentTab("builder");
    setMode("fill");
    editHistoryEntry({
      id: requestedHistoryId,
      type: requestedHistoryType,
      status: "pending",
    });
  }, [
    activeWorkspaceId,
    historyRequestHandled,
    isPrefilling,
    requestedHistoryId,
    requestedHistoryType,
  ]);

  useEffect(() => {
    if (!isCreateWorkspace) return;
    if (String(profile.email || "").trim()) return;
    if (!authEmail) return;
    updateProfile("email", authEmail);
  }, [authEmail, isCreateWorkspace, profile.email]);

  useEffect(() => {
    if (isCreateWorkspace || isPrefilling || hasAppliedDrafts) return;
    try {
      const draft = isProductPath ? draftServiceIdea : draftIdeaValidation;
      if (!draft || typeof draft !== "object") return;
      if (isProductPath) {
        const safeServiceDraft = {
          service_name: draft.service_name ?? "",
          service_category: draft.service_category ?? "consulting",
          service_description: draft.service_description ?? "",
          target_customer_type: draft.target_customer_type ?? "SME",
          target_market_scope: draft.target_market_scope ?? "local",
          price_per_sale: draft.price_per_sale ?? "",
          expected_sales_per_month: draft.expected_sales_per_month ?? "",
          direct_labour_cost_per_sale: draft.direct_labour_cost_per_sale ?? "",
          contractor_cost_per_sale: draft.contractor_cost_per_sale ?? "",
          materials_cost_per_sale: draft.materials_cost_per_sale ?? "",
          travel_cost_per_sale: draft.travel_cost_per_sale ?? "",
          other_direct_cost_per_sale: draft.other_direct_cost_per_sale ?? "",
          monthly_software_cost: draft.monthly_software_cost ?? "",
          monthly_marketing_cost: draft.monthly_marketing_cost ?? "",
          monthly_admin_cost: draft.monthly_admin_cost ?? "",
          monthly_rent_cost: draft.monthly_rent_cost ?? "",
          monthly_other_fixed_cost: draft.monthly_other_fixed_cost ?? "",
          hours_required_per_sale: draft.hours_required_per_sale ?? "",
          available_delivery_hours_per_month: draft.available_delivery_hours_per_month ?? "",
          demand_evidence_type: draft.demand_evidence_type ?? "assumption_only",
          number_of_interested_leads: draft.number_of_interested_leads ?? "",
          number_of_paying_customers: draft.number_of_paying_customers ?? "",
          competitor_price_low: draft.competitor_price_low ?? "",
          competitor_price_high: draft.competitor_price_high ?? "",
          differentiation_level: draft.differentiation_level ?? "medium"
        };
        setServiceForm((prev) => ({ ...prev, ...safeServiceDraft }));
      } else {
        const safeDraft = mergeStageDefaultsIntoBusinessForm({
          ...draft,
          context: { ...draft.context ?? {} },
          problem: { ...draft.problem ?? {} },
          offer: { ...draft.offer ?? {} },
          demand: { ...draft.demand ?? {} },
          costs: { ...draft.costs ?? {} },
          capacity: { ...draft.capacity ?? {} },
          cash: { ...draft.cash ?? {} },
          go_to_market: { ...draft.go_to_market ?? {} }
        });
        setForm((prev) => ({
          ...prev,
          ...safeDraft,
          pathway: safeDraft.pathway ?? prev.pathway,
          context: { ...prev.context, ...safeDraft.context },
          problem: { ...prev.problem, ...safeDraft.problem },
          offer: { ...prev.offer, ...safeDraft.offer },
          demand: { ...prev.demand, ...safeDraft.demand },
          costs: { ...prev.costs, ...safeDraft.costs },
          capacity: { ...prev.capacity, ...safeDraft.capacity },
          cash: { ...prev.cash, ...safeDraft.cash },
          go_to_market: { ...prev.go_to_market, ...safeDraft.go_to_market }
        }));
      }
      setHasAppliedDrafts(true);
    } catch (err) {
      console.error("Error applying draft:", err);
    }
  }, [draftIdeaValidation, draftServiceIdea, hasAppliedDrafts, isCreateWorkspace, isPrefilling]);

  useEffect(() => {
    if (isCreateWorkspace || isProductPath) return;
    const payload = {
      workspace_name: String(workspaceName || "").trim(),
      business_name: String(form?.context?.business_name || "").trim(),
      service_type: String(form?.offer?.service_type || "").trim(),
      business_type_category: String(form?.context?.business_type_category || "").trim(),
      business_type_other: String(form?.context?.business_type_other || "").trim(),
      primary_industry_category: String(form?.context?.primary_industry_category || "").trim(),
      primary_industry_other: String(form?.context?.primary_industry_other || "").trim(),
      location: String(form?.context?.location || "").trim(),
      currency: String(form?.context?.currency || "GBP").trim(),
      customer_segment_category: String(form?.problem?.customer_segment_category || "").trim(),
      customer_segment_other: String(form?.problem?.customer_segment_other || "").trim(),
      problem_type: String(form?.problem?.problem_type || "").trim(),
      frequency: String(form?.problem?.frequency || "").trim(),
      alternatives: String(form?.problem?.alternatives || "").trim(),
    };
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VALIDATION_DEFAULTS_KEY, JSON.stringify(payload));
    }
  }, [
    form?.context?.business_name,
    workspaceName,
    form?.offer?.service_type,
    form?.context?.business_type_category,
    form?.context?.business_type_other,
    form?.context?.primary_industry_category,
    form?.context?.primary_industry_other,
    form?.context?.location,
    form?.context?.currency,
    form?.problem?.customer_segment_category,
    form?.problem?.customer_segment_other,
    form?.problem?.problem_type,
    form?.problem?.frequency,
    form?.problem?.alternatives,
    isCreateWorkspace,
    isProductPath,
  ]);

  useEffect(() => {
    if (!isProductPath) return;
    if (!serviceForm.service_name || serviceSelection) return;
    const match = combinedServiceOptions.includes(serviceForm.service_name);
    setServiceSelection(match ? serviceForm.service_name : "__other__");
  }, [combinedServiceOptions, isProductPath, serviceForm.service_name, serviceSelection]);

  useEffect(() => {
    const next = form?.context?.currency || "GBP";
    setCurrency(next);
    if (isProductPath) setServiceCurrency(next);
  }, [form?.context?.currency, isProductPath, setCurrency]);

  useEffect(() => {
    if (isCreateWorkspace) return;
    if (isProductPath) {
      setDraftServiceIdea(serviceForm);
    } else {
      setDraftIdeaValidation(form);
    }
  }, [form, isCreateWorkspace, isProductPath, serviceForm, setDraftIdeaValidation, setDraftServiceIdea]);

  useEffect(() => {
    if (isCreateWorkspace || isPrefilling || !activeWorkspaceId) return;
    const handle = setTimeout(async () => {
      try {
        await apiRequest(
          `/validation/${activeWorkspaceId}`,
          "PATCH",
          {
            data: {
              draft_idea_validation: isProductPath ? null : form,
              draft_service_idea: isProductPath ? serviceForm : null
            }
          },
          { timeoutMs: 120000 }
        );
      } catch (e) {
        console.warn("Draft autosave failed:", e);
      }
    }, 800);
    return () => clearTimeout(handle);
  }, [activeWorkspaceId, form, isCreateWorkspace, isPrefilling, isProductPath, serviceForm]);

  useEffect(() => {
    if (isCreateWorkspace) {
      setEnabledForms({ workspace_profile: true });
      setMode("fill");
      return;
    }
    if (isProductPath) {
      setEnabledForms({
        service_basics: true,
        revenue_inputs: true,
        direct_costs: true,
        fixed_costs: true,
        capacity_inputs: true,
        demand_inputs: true,
        competition: true
      });
      return;
    }
    setEnabledForms((prev) => ({
      business: true,
      offer_demand: true,
      costs: true,
      capacity_cash: true,
      go_to_market: true,
      ...(prev.workspace_profile ? {} : {})
    }));
  }, [isCreateWorkspace, isProductPath]);

  useEffect(() => {
    setCurrentBusinessStageIndex(0);
  }, [isBusinessStageFlow, form.pathway]);

  useEffect(() => {
    async function prefill() {
      const wsId = editingWorkspaceId || storedWorkspaceId;
      if (!wsId) return;
      setIsPrefilling(true);
      setError(null);
      try {
        const defaults = loadValidationStageDefaults();
        const ws = await apiRequest(`/validation/${wsId}`, "GET");
        const iv = ws?.data?.idea_validation || ws?.data?.draft_idea_validation;
        setExistingCatalogue(ws?.data?.catalogue || { products: [], customers: [], vendors: [] });
        setSavedServiceIdeas(Array.isArray(ws?.data?.service_validation_history) ? ws.data.service_validation_history : []);
        setValidationHistory(buildUnifiedValidationHistory(ws?.data || {}));
        if (ws?.data?.currency) setServiceCurrency(ws.data.currency);
        if (!iv || typeof iv !== "object") {
          const profile = ws?.data?.business_profile;
          if (profile && typeof profile === "object") {
            if (profile.business_name) update("context.business_name", profile.business_name);
            if (profile.business_type) update("context.business_type_category", profile.business_type);
            if (profile.primary_industry) update("context.primary_industry_category", profile.primary_industry);
            if (profile.location) update("context.location", profile.location);
            if (profile.currency) update("context.currency", profile.currency);
          }
          const wp = ws?.data?.workspace_profile;
          if (wp && typeof wp === "object") {
            setWorkspaceLogoStore(wp.logo_data_url || null);
            setProfile((prev) => ({
              ...prev,
              ...wp,
              services: Array.isArray(wp.services) && wp.services.length
                ? wp.services
                : prev.services,
              core_values: Array.isArray(wp.core_values) ? wp.core_values.join(", ") : prev.core_values
            }));
            if (wp.company_name && !form?.context?.business_name) {
              update("context.business_name", wp.company_name);
            }
            if (wp.primary_industry && !form?.context?.primary_industry_category) {
              update("context.primary_industry_category", wp.primary_industry);
            }
            if (Array.isArray(wp.services) && wp.services.length) {
              const primary = wp.services[0];
              if (primary?.service_name) updateService("service_name", primary.service_name);
              if (primary?.service_description) updateService("service_description", primary.service_description);
              if (primary?.service_category) updateService("service_category", primary.service_category);
            }
          }
          const serviceDraft = ws?.data?.draft_service_idea || ws?.data?.service_idea_validation;
          if (serviceDraft && typeof serviceDraft === "object") {
            setServiceForm((prev) => ({ ...prev, ...serviceDraft }));
          }
          if (ws?.data?.market_research && typeof ws.data.market_research === "object") {
            setMarketResearch(ws.data.market_research);
            setStageOneResearchReady(true);
          }
          setWorkspaceId(wsId);
          setWorkspaceNameStore(ws?.name || null);
          if (!isProductPath) setDecisionStatus(ws?.data?.decision?.status || null);
          setWorkspaceName(ws?.name || String(defaults.workspace_name || "").trim() || "");
          setWorkspaceNameTouched(true);
          return;
        }
        setWorkspaceId(wsId);
        setWorkspaceNameStore(ws?.name || null);
        if (!isProductPath) setDecisionStatus(ws?.data?.decision?.status || null);
        setIdeaValidation(iv);
        setWorkspaceName(ws?.name || String(defaults.workspace_name || "").trim() || "");
        setWorkspaceNameTouched(true);
        const wp = ws?.data?.workspace_profile;
        const next = mergeStageDefaultsIntoBusinessForm(structuredClone(iv));
        next.pathway = form.pathway || next.pathway || "business_idea";
        if (wp && typeof wp === "object") {
          setWorkspaceLogoStore(wp.logo_data_url || null);
          setProfile((prev) => ({
            ...prev,
            ...wp,
            services: Array.isArray(wp.services) && wp.services.length
              ? wp.services
              : prev.services,
            core_values: Array.isArray(wp.core_values) ? wp.core_values.join(", ") : prev.core_values
          }));
          if (wp.company_name && !next.context.business_name) {
            next.context.business_name = wp.company_name;
          }
          if (wp.primary_industry && !next.context.primary_industry) {
            next.context.primary_industry = wp.primary_industry;
          }
        }
        // Restore previously generated insights
        if (ws?.data?.market_research && typeof ws.data.market_research === "object") {
          setMarketResearch(ws.data.market_research);
          setStageOneResearchReady(true);
        }
        const serviceDraft = ws?.data?.draft_service_idea || ws?.data?.service_idea_validation;
        if (serviceDraft && typeof serviceDraft === "object") {
          setServiceForm((prev) => ({ ...prev, ...serviceDraft }));
        } else if (wp && Array.isArray(wp.services) && wp.services.length) {
          const primary = wp.services[0];
          if (primary?.service_name) updateService("service_name", primary.service_name);
          if (primary?.service_description) updateService("service_description", primary.service_description);
          if (primary?.service_category) updateService("service_category", primary.service_category);
        }
        const bt = String(next?.context?.business_type ?? "").trim();
        next.context.business_type_category = BUSINESS_TYPE_OPTIONS.includes(bt) ? bt : "Other";
        next.context.business_type_other = BUSINESS_TYPE_OPTIONS.includes(bt) ? "" : bt;
        const pi = String(next?.context?.primary_industry ?? "").trim();
        next.context.primary_industry_category = PRIMARY_INDUSTRY_OPTIONS.includes(pi) ? pi : pi ? "Other" : "IT";
        next.context.primary_industry_other = PRIMARY_INDUSTRY_OPTIONS.includes(pi) ? "" : pi;
        const cs = String(next?.problem?.customer_segment ?? "").trim();
        next.problem.customer_segment_category = CUSTOMER_SEGMENT_OPTIONS.includes(cs) ? cs : cs ? "Other" : "SMEs";
        next.problem.customer_segment_other = CUSTOMER_SEGMENT_OPTIONS.includes(cs) ? "" : cs;
        const frequencyFields = deriveFrequencyFields(next?.problem?.frequency ?? "");
        next.problem.frequency = frequencyFields.frequency;
        next.problem.frequency_category = frequencyFields.frequency_category;
        next.problem.frequency_custom = frequencyFields.frequency_custom;
        const du = String(next?.offer?.deliverable_unit ?? "").trim();
        next.offer.deliverable_unit_category = DELIVERABLE_UNIT_OPTIONS.includes(du) ? du : du ? "Other" : "unit";
        next.offer.deliverable_unit_other = DELIVERABLE_UNIT_OPTIONS.includes(du) ? "" : du;
        next.context.founder_hours_per_week = String(next.context?.founder_hours_per_week ?? "40");
        next.offer.price_per_unit = String(next.offer?.price_per_unit ?? "");
        next.demand.expected_units_per_month = String(next.demand?.expected_units_per_month ?? "");
        next.demand.expected_customers = String(next.demand?.expected_customers ?? "");
        next.demand.sales_cycle_days = String(next.demand?.sales_cycle_days ?? "");
        next.demand.payment_terms_days = String(next.demand?.payment_terms_days ?? "14");
        next.costs.variable_cost_per_unit = String(next.costs?.variable_cost_per_unit ?? "");
        next.costs.fixed_costs_monthly = String(next.costs?.fixed_costs_monthly ?? "");
        next.costs.founder_draw_monthly = String(next.costs?.founder_draw_monthly ?? "");
        next.costs.contractor_costs_monthly = String(next.costs?.contractor_costs_monthly ?? "");
        next.capacity.team_size = String(next.capacity?.team_size ?? "1");
        next.capacity.capacity_units_per_person_per_month = String(next.capacity?.capacity_units_per_person_per_month ?? "");
        next.cash.starting_cash = String(next.cash?.starting_cash ?? "");
        next.cash.upfront_costs = String(next.cash?.upfront_costs ?? "");
        setForm(next);
      } catch (e) {
        setError(humanizeValidationError(e));
      } finally {
        setIsPrefilling(false);
      }
    }
    prefill();
  }, [BUSINESS_TYPE_OPTIONS, CUSTOMER_SEGMENT_OPTIONS, DELIVERABLE_UNIT_OPTIONS, PRIMARY_INDUSTRY_OPTIONS, editingWorkspaceId, setDecisionStatus, setIdeaValidation, setWorkspaceId, setWorkspaceNameStore, storedWorkspaceId]);

  function selectPathway(value) {
    setStageOneResearchReady(false);
    setMarketResearch(null);
    setMrError(null);
    setShowBuilderMarketInsight(false);
    setCurrentBusinessStageIndex(0);
    setCurrentServiceStageIndex(0);
    setForm((prev) => ({
      ...prev,
      pathway: value
    }));
  }

  function update(path, value) {
    setStageOneResearchReady(false);
    setMarketResearch(null);
    setMrError(null);
    setShowBuilderMarketInsight(false);
    setError(null);
    setForm((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  }

  function updateService(path, value) {
    setStageOneResearchReady(false);
    setMarketResearch(null);
    setMrError(null);
    setShowBuilderMarketInsight(false);
    setError(null);
    setServiceForm((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  }

  function updateProfile(path, value) {
    setProfile((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  }

  async function handleProfileLogoChange(file) {
    if (!file) return;
    try {
      const dataUrl = await imageFileToDataUrl(file);
      updateProfile("logo_data_url", dataUrl);
      setWorkspaceLogoStore(dataUrl);
      setSavedNotice("Logo ready to save.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load logo.");
    }
  }

  function clearProfileLogo() {
    updateProfile("logo_data_url", "");
    setWorkspaceLogoStore(null);
  }

  function normaliseValidationHistoryEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const id = String(entry.id || "").trim();
    if (!id) return null;
    return {
      id,
      type: String(entry.type || "validation"),
      title: String(entry.title || entry.service_name || "Validation"),
      created_at: entry.created_at || new Date().toISOString(),
      status: entry.status || entry.decision_status || "pending",
      summary: String(entry.summary || entry.outcome || "").trim(),
      score: typeof entry.score === "number" ? entry.score : null,
      payload: entry.payload || null,
      result: entry.result || null,
    };
  }

  function buildUnifiedValidationHistory(data) {
    const validationHistory = Array.isArray(data?.validation_history) ? data.validation_history : [];
    const serviceHistory = Array.isArray(data?.service_validation_history) ? data.service_validation_history : [];
    const merged = new Map();

    validationHistory.forEach((entry) => {
      const normalized = normaliseValidationHistoryEntry(entry);
      if (normalized) merged.set(normalized.id, normalized);
    });

    serviceHistory.forEach((entry) => {
      const normalized = normaliseValidationHistoryEntry({
        id: entry?.id,
        type: "service_validation",
        title: entry?.service_name || entry?.payload?.service_name || "Service validation",
        created_at: entry?.created_at,
        status: entry?.status || entry?.decision_status || "pending",
        summary: entry?.summary || entry?.result?.outcome || "Service validation completed",
        score: typeof entry?.result?.scores?.viability_score === "number" ? entry.result.scores.viability_score : null,
        payload: entry?.payload || null,
        result: entry?.result || null,
      });
      if (!normalized) return;
      if (!merged.has(normalized.id)) {
        merged.set(normalized.id, normalized);
        return;
      }
      const existing = merged.get(normalized.id);
      merged.set(normalized.id, {
        ...normalized,
        ...existing,
        type: existing?.type || normalized.type,
        title: existing?.title || normalized.title,
        status: existing?.status || normalized.status || "pending",
        payload: existing?.payload || normalized.payload || null,
        result: existing?.result || normalized.result || null,
      });
    });

    return Array.from(merged.values()).sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
  }

  function hydrateBusinessFormForEditor(source) {
    const next = structuredClone(source || form);
    next.pathway = "business_idea";
    next.context ||= {};
    next.problem ||= {};
    next.offer ||= {};
    next.demand ||= {};
    next.costs ||= {};
    next.capacity ||= {};
    next.cash ||= {};
    next.go_to_market ||= {};

    const bt = String(next?.context?.business_type ?? "").trim();
    next.context.business_type_category = BUSINESS_TYPE_OPTIONS.includes(bt) ? bt : bt ? "Other" : "Technology";
    next.context.business_type_other = BUSINESS_TYPE_OPTIONS.includes(bt) ? "" : bt;

    const pi = String(next?.context?.primary_industry ?? "").trim();
    next.context.primary_industry_category = PRIMARY_INDUSTRY_OPTIONS.includes(pi) ? pi : pi ? "Other" : "IT";
    next.context.primary_industry_other = PRIMARY_INDUSTRY_OPTIONS.includes(pi) ? "" : pi;

    const cs = String(next?.problem?.customer_segment ?? "").trim();
    next.problem.customer_segment_category = CUSTOMER_SEGMENT_OPTIONS.includes(cs) ? cs : cs ? "Other" : "SMEs";
    next.problem.customer_segment_other = CUSTOMER_SEGMENT_OPTIONS.includes(cs) ? "" : cs;
    const frequencyFields = deriveFrequencyFields(next?.problem?.frequency ?? "");
    next.problem.frequency = frequencyFields.frequency;
    next.problem.frequency_category = frequencyFields.frequency_category;
    next.problem.frequency_custom = frequencyFields.frequency_custom;

    const du = String(next?.offer?.deliverable_unit ?? "").trim();
    next.offer.deliverable_unit_category = DELIVERABLE_UNIT_OPTIONS.includes(du) ? du : du ? "Other" : "unit";
    next.offer.deliverable_unit_other = DELIVERABLE_UNIT_OPTIONS.includes(du) ? "" : du;

    next.context.founder_hours_per_week = String(next.context?.founder_hours_per_week ?? "40");
    next.offer.price_per_unit = String(next.offer?.price_per_unit ?? "");
    next.demand.expected_units_per_month = String(next.demand?.expected_units_per_month ?? "");
    next.demand.expected_customers = String(next.demand?.expected_customers ?? "");
    next.demand.sales_cycle_days = String(next.demand?.sales_cycle_days ?? "");
    next.demand.payment_terms_days = String(next.demand?.payment_terms_days ?? "14");
    next.costs.variable_cost_per_unit = String(next.costs?.variable_cost_per_unit ?? "");
    next.costs.fixed_costs_monthly = String(next.costs?.fixed_costs_monthly ?? "");
    next.costs.founder_draw_monthly = String(next.costs?.founder_draw_monthly ?? "");
    next.costs.contractor_costs_monthly = String(next.costs?.contractor_costs_monthly ?? "");
    next.capacity.team_size = String(next.capacity?.team_size ?? "1");
    next.capacity.capacity_units_per_person_per_month = String(next.capacity?.capacity_units_per_person_per_month ?? "");
    next.cash.starting_cash = String(next.cash?.starting_cash ?? "");
    next.cash.upfront_costs = String(next.cash?.upfront_costs ?? "");
    return next;
  }

  async function editHistoryEntry(entry) {
    if (!activeWorkspaceId) return;
    if (entry?.status === "accepted" || entry?.status === "rejected") {
      setError(null);
      try {
        const ws = await apiRequest(`/validation/${activeWorkspaceId}`, "GET");
        const data = ws?.data || {};
        setWorkspaceId(activeWorkspaceId);
        setWorkspaceNameStore(ws?.name || null);
        setWorkspaceName(ws?.name || "");
        setWorkspaceNameTouched(true);
        setCurrency(data?.currency || serviceCurrency || "GBP");

        if (entry.type === "service_validation") {
          const serviceHistory = Array.isArray(data.service_validation_history) ? data.service_validation_history : [];
          const serviceEntry = serviceHistory.find((item) => item?.id === entry.id) || entry;
          const payload = serviceEntry?.payload || data.draft_service_idea || null;
          if (payload && typeof payload === "object") {
            setDraftServiceIdea(payload);
          }
          setValidation(serviceEntry?.result || entry.result || null);
          setServiceDecisionStatus(entry.status);
          setDecisionStatus(null);
          await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
            data: {
              active_service_validation_id: entry.id,
              ...(payload && typeof payload === "object" ? { draft_service_idea: payload } : {})
            }
          });
        } else {
          const payload = entry.payload || data.draft_idea_validation || data.idea_validation || null;
          if (payload && typeof payload === "object") {
            setDraftIdeaValidation(payload);
            setInputs(payload);
          }
          setIdeaValidation(entry.result || data.idea_validation || null);
          setDecisionStatus(entry.status);
          setServiceDecisionStatus(null);
          await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
            data: {
              active_validation_id: entry.id,
              ...(payload && typeof payload === "object" ? { draft_idea_validation: payload } : {})
            }
          });
        }

        navigate("/results");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not open this validation dashboard.");
      }
      return;
    }
    setError(null);
    try {
      const ws = await apiRequest(`/validation/${activeWorkspaceId}`, "GET");
      const data = ws?.data || {};
      setWorkspaceId(activeWorkspaceId);
      setWorkspaceNameStore(ws?.name || null);
      setWorkspaceName(ws?.name || "");
      setWorkspaceNameTouched(true);

      if (entry.type === "service_validation") {
        const serviceHistory = Array.isArray(data.service_validation_history) ? data.service_validation_history : [];
        const serviceEntry = serviceHistory.find((item) => item?.id === entry.id);
        const payload = serviceEntry?.payload || entry.payload || data.draft_service_idea;
        if (!payload || typeof payload !== "object") {
          setError("We could not find the saved service inputs for this history item.");
          return;
        }
        setForm((prev) => ({ ...prev, pathway: "product_service_idea" }));
        setServiceForm((prev) => ({ ...prev, ...payload }));
        setServiceCurrency(serviceEntry?.currency || data.currency || serviceCurrency || "GBP");
        setDraftServiceIdea(payload);
        setValidation(serviceEntry?.result || entry.result || null);
        setEditingHistoryEntry({
          id: entry.id,
          type: "service_validation",
          created_at: serviceEntry?.created_at || entry.created_at || new Date().toISOString(),
        });
        await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
          data: {
            active_service_validation_id: entry.id,
            draft_service_idea: payload,
          }
        });
      } else {
        const payload = entry.payload || data.draft_idea_validation || data.idea_validation;
        if (!payload || typeof payload !== "object") {
          setError("We could not find the saved business inputs for this history item.");
          return;
        }
        const hydrated = hydrateBusinessFormForEditor(payload);
        setForm(hydrated);
        setDraftIdeaValidation(payload);
        setValidation(entry.result || null);
        setEditingHistoryEntry({
          id: entry.id,
          type: "business_validation",
          created_at: entry.created_at || new Date().toISOString(),
        });
        await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
          data: {
            active_validation_id: entry.id,
            draft_idea_validation: payload,
          }
        });
      }

      setContentTab("builder");
      setMode("fill");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this validation history item.");
    }
  }

  async function deleteHistoryEntry(entryId) {
    if (!activeWorkspaceId) return;
    const ok = window.confirm("Delete this validation history item?");
    if (!ok) return;
    setError(null);
    try {
      const ws = await apiRequest(`/validation/${activeWorkspaceId}`, "GET");
      const existing = Array.isArray(ws?.data?.validation_history) ? ws.data.validation_history : [];
      const serviceExisting = Array.isArray(ws?.data?.service_validation_history) ? ws.data.service_validation_history : [];
      const nextHistory = existing.filter((item) => item?.id !== entryId);
      const nextServiceHistory = serviceExisting.filter((item) => item?.id !== entryId);
      await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
        data: {
          validation_history: nextHistory,
          service_validation_history: nextServiceHistory,
        }
      });
      setValidationHistory(
        buildUnifiedValidationHistory({
          validation_history: nextHistory,
          service_validation_history: nextServiceHistory,
        })
      );
      setSavedServiceIdeas(nextServiceHistory);
      setSavedNotice("Validation history deleted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete validation history item.");
    }
  }

  function validateProfileDraft() {
    if (!enabledForms.workspace_profile) return null;
    if (!String(profile.company_name || "").trim()) return "Company name is required in the workspace profile.";
    if (!String(profile.business_type || "").trim()) return "Business type is required in the workspace profile.";
    if (!String(profile.primary_industry || "").trim()) return "Primary industry is required in the workspace profile.";
    if (!String(profile.about_company || "").trim()) return "About company is required in the workspace profile.";
    if (!String(profile.country || "").trim()) return "Country is required in the workspace profile.";
    if (!String(profile.city || "").trim()) return "City is required in the workspace profile.";
    if (!String(profile.email || "").trim()) return "Email is required in the workspace profile.";
    if (!String(profile.operating_stage || "").trim()) return "Operating stage is required in the workspace profile.";
    if (!String(profile.delivery_model || "").trim()) return "Delivery model is required in the workspace profile.";
    const svc = Array.isArray(profile.services) ? profile.services : [];
    if (!svc.length || svc.some((s) => !String(s.service_name || "").trim() || !String(s.service_category || "").trim())) {
      return "Add at least one service with a name and category.";
    }
    return null;
  }

  const canRun = useMemo(() => {
    if (isCreateWorkspace) return !validateProfileDraft();
    if (isProductPath) {
      const required = [
        String(serviceForm.service_name || "").trim().length >= 3,
        String(serviceForm.service_description || "").trim().length >= 10,
        String(serviceForm.target_customer_type || "").trim(),
        String(serviceForm.target_market_scope || "").trim(),
        parseNumber(serviceForm.price_per_sale, 0) > 0,
        parseNumber(serviceForm.expected_sales_per_month, 0) >= 0,
        parseNumber(serviceForm.direct_labour_cost_per_sale, 0) >= 0,
        parseNumber(serviceForm.other_direct_cost_per_sale, 0) >= 0,
        parseNumber(serviceForm.monthly_software_cost, 0) >= 0,
        parseNumber(serviceForm.monthly_marketing_cost, 0) >= 0,
        parseNumber(serviceForm.monthly_admin_cost, 0) >= 0,
        parseNumber(serviceForm.hours_required_per_sale, 0) > 0,
        parseNumber(serviceForm.available_delivery_hours_per_month, 0) > 0,
        String(serviceForm.demand_evidence_type || "").trim(),
        String(serviceForm.differentiation_level || "").trim()
      ];
      return required.every(Boolean);
    }
    const bn = String(form.context.business_name || "").trim();
    const sn = String(form.offer?.service_type || "").trim();
    return bn.length >= 2 || sn.length >= 2;
  }, [
    form.context.business_name,
    form.offer?.service_type,
    isCreateWorkspace,
    isProductPath,
    profile,
    serviceForm
  ]);
  const canEdit = !isLoading && !isPrefilling;

  function startFilling() {
    if (!selectedCount) return setError("Select at least one section to continue.");
    setError(null);
    if (isBusinessStageFlow) setCurrentBusinessStageIndex(0);
    if (isServiceStageFlow) setCurrentServiceStageIndex(0);
    setMode("fill");
  }

  function updateFrequency(value) {
    const nextValue = String(value || "").trim().toLowerCase();
    setError(null);
    setStageOneResearchReady(false);
    setMarketResearch(null);
    setMrError(null);
    setForm((prev) => {
      const next = structuredClone(prev);
      next.problem.frequency_category = nextValue;
      if (nextValue === "custom") {
        next.problem.frequency = String(next.problem.frequency_custom || "").trim();
      } else {
        next.problem.frequency_custom = "";
        next.problem.frequency = nextValue;
      }
      return next;
    });
  }

  function updateCustomFrequency(value) {
    setError(null);
    setStageOneResearchReady(false);
    setMarketResearch(null);
    setMrError(null);
    setForm((prev) => {
      const next = structuredClone(prev);
      next.problem.frequency_custom = value;
      next.problem.frequency = value;
      next.problem.frequency_category = "custom";
      return next;
    });
  }

  function buildBusinessIdeaPayloadForResearch() {
    const payload = structuredClone(form);
    payload.existing_business = null;
    payload.context ||= {};
    payload.problem ||= {};
    payload.offer ||= {};
    payload.demand ||= {};
    payload.costs ||= {};
    payload.capacity ||= {};
    payload.cash ||= {};

    const bt = String(payload.context.business_type_category || "").trim();
    const btOther = String(payload.context.business_type_other || "").trim();
    payload.context.business_type = bt === "Other" ? btOther || "Other" : bt || "Other";

    const pi = String(payload.context.primary_industry_category || "").trim();
    const piOther = String(payload.context.primary_industry_other || "").trim();
    payload.context.primary_industry = pi === "Other" ? piOther || "Other" : pi || "Other";

    const cs = String(payload.problem.customer_segment_category || "").trim();
    const csOther = String(payload.problem.customer_segment_other || "").trim();
    payload.problem.customer_segment = cs === "Other" ? csOther || "Other" : cs || "Other";

    const duCat = String(payload.offer.deliverable_unit_category || "").trim();
    const duOther = String(payload.offer.deliverable_unit_other || "").trim();
    payload.offer.deliverable_unit = duCat === "Other" ? duOther || "unit" : duCat || "unit";

    payload.context.founder_hours_per_week = parseNumber(payload.context.founder_hours_per_week, 40);
    payload.offer.price_per_unit = parseNumber(payload.offer.price_per_unit, 0);
    payload.demand.expected_units_per_month = parseNumber(payload.demand.expected_units_per_month, 0);
    payload.demand.expected_customers = parseIntSafe(payload.demand.expected_customers, 0);
    payload.demand.sales_cycle_days = parseIntSafe(payload.demand.sales_cycle_days, 0);
    payload.demand.payment_terms_days = parseIntSafe(payload.demand.payment_terms_days, 14);
    payload.costs.variable_cost_per_unit = parseNumber(payload.costs.variable_cost_per_unit, 0);
    payload.costs.fixed_costs_monthly = parseNumber(payload.costs.fixed_costs_monthly, 0);
    payload.costs.founder_draw_monthly = parseNumber(payload.costs.founder_draw_monthly, 0);
    payload.costs.contractor_costs_monthly = parseNumber(payload.costs.contractor_costs_monthly, 0);
    payload.capacity.team_size = Math.max(1, parseIntSafe(payload.capacity.team_size, 1));
    payload.capacity.capacity_units_per_person_per_month = parseNumber(payload.capacity.capacity_units_per_person_per_month, 0);
    payload.cash.starting_cash = parseNumber(payload.cash.starting_cash, 0);
    payload.cash.upfront_costs = parseNumber(payload.cash.upfront_costs, 0);

    delete payload.context.business_type_category;
    delete payload.context.business_type_other;
    delete payload.context.primary_industry_category;
    delete payload.context.primary_industry_other;
    delete payload.problem.customer_segment_category;
    delete payload.problem.customer_segment_other;
    delete payload.offer.deliverable_unit_category;
    delete payload.offer.deliverable_unit_other;
    return payload;
  }

  function buildServiceIdeaPayloadForResearch() {
    return {
      ...structuredClone(serviceForm),
      currency: serviceCurrency || "GBP",
    };
  }

  function validateBusinessStage(_stageKey) {
    // Business idea stages are optional — the user can proceed at any point.
    return null;
  }

  function validateServiceStage(stageKey) {
    if (!isServiceStageFlow) return null;
    if (stageKey === "service_basics") {
      if (!String(serviceForm.service_name || "").trim()) return "Service name is required.";
      if (String(serviceForm.service_name || "").trim().length < 3) return "Service name should be at least 3 characters.";
      if (!String(serviceForm.service_description || "").trim()) return "Service description is required.";
      if (String(serviceForm.service_description || "").trim().length < 10) return "Service description should be at least 10 characters.";
      if (!String(serviceForm.service_category || "").trim()) return "Service category is required.";
      if (!String(serviceForm.target_customer_type || "").trim()) return "Target customer type is required.";
      if (!String(serviceForm.target_market_scope || "").trim()) return "Target market scope is required.";
      return null;
    }
    if (stageKey === "revenue_inputs") {
      if (parseNumber(serviceForm.price_per_sale, 0) <= 0) return "Price per sale must be greater than 0.";
      if (parseNumber(serviceForm.expected_sales_per_month, -1) < 0) return "Expected sales per month cannot be negative.";
      return null;
    }
    if (stageKey === "direct_costs") {
      if (String(serviceForm.direct_labour_cost_per_sale || "").trim() === "") return "Direct labour cost per sale is required.";
      return null;
    }
    if (stageKey === "fixed_costs") {
      if (String(serviceForm.monthly_software_cost || "").trim() === "") return "Monthly software cost is required.";
      if (String(serviceForm.monthly_marketing_cost || "").trim() === "") return "Monthly marketing cost is required.";
      if (String(serviceForm.monthly_admin_cost || "").trim() === "") return "Monthly admin cost is required.";
      return null;
    }
    if (stageKey === "capacity_inputs") {
      if (parseNumber(serviceForm.hours_required_per_sale, 0) <= 0) return "Hours required must be greater than 0.";
      if (parseNumber(serviceForm.available_delivery_hours_per_month, 0) <= 0) return "Available delivery hours per month must be greater than 0.";
      return null;
    }
    if (stageKey === "demand_inputs") {
      if (!String(serviceForm.demand_evidence_type || "").trim()) return "Demand evidence type is required.";
      return null;
    }
    if (stageKey === "competition") {
      if (!String(serviceForm.differentiation_level || "").trim()) return "Differentiation level is required.";
      return null;
    }
    return null;
  }

  async function goToNextBusinessStage() {
    const stageError = validateBusinessStage(currentBusinessStageKey);
    if (stageError) {
      setError(stageError);
      return;
    }
    if (!isLastBusinessStage) {
      await runMarketResearch({ useCurrentForm: true, markStageOneReady: true, showInBuilder: true });
      return;
    }
    setError(null);
    setCurrentBusinessStageIndex((prev) => Math.min(prev + 1, Math.max(0, businessStageKeys.length - 1)));
  }

  function goToPreviousBusinessStage() {
    setError(null);
    setCurrentBusinessStageIndex((prev) => Math.max(prev - 1, 0));
  }

  async function goToNextServiceStage() {
    const stageError = validateServiceStage(currentServiceStageKey);
    if (stageError) {
      setError(stageError);
      return;
    }
    if (!isLastServiceStage) {
      await runMarketResearch({
        useCurrentForm: true,
        markStageOneReady: true,
        showInBuilder: true,
        researchSource: "service",
      });
      return;
    }
    setError(null);
    setCurrentServiceStageIndex((prev) => Math.min(prev + 1, Math.max(0, serviceStageKeys.length - 1)));
  }

  function goToPreviousServiceStage() {
    setError(null);
    setCurrentServiceStageIndex((prev) => Math.max(prev - 1, 0));
  }

  async function saveWorkspace(shouldEvaluate = false) {
    setIsLoading(true);
    setError(null);
    setSavedNotice(null);
    try {
      const profileError = validateProfileDraft();
      if (profileError) {
        setError(profileError);
        setIsLoading(false);
        return;
      }
      // For idea validation, always keep the existing workspace name — never overwrite it with business idea name.
      // workspaceName is the idea label only; the actual workspace name comes from the store.
      const wsName = isCreateWorkspace
        ? String(profile.company_name || "").trim() || derivedWorkspaceName
        : String(useWorkspaceStore.getState().workspaceName || workspaceName || "").trim() || "My workspace";

      let wsId = editingWorkspaceId || storedWorkspaceId;
      if (isCreateWorkspace) {
        const profilePayload = {
          ...profile,
          company_name: String(profile.company_name || "").trim(),
          logo_data_url: String(profile.logo_data_url || "").trim() || null,
          legal_name: String(profile.legal_name || "").trim() || null,
          registration_number: String(profile.registration_number || "").trim() || null,
          about_company: String(profile.about_company || "").trim(),
          tagline: String(profile.tagline || "").trim() || null,
          year_established: profile.year_established ? Number(profile.year_established) : null,
          company_size: profile.company_size || null,
          core_values: String(profile.core_values || "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          secondary_industries: Array.isArray(profile.secondary_industries)
            ? profile.secondary_industries.filter(Boolean)
            : [],
          services: (profile.services || []).map((s) => ({
            service_name: String(s.service_name || "").trim(),
            service_category: s.service_category,
            service_description: String(s.service_description || "").trim() || null
          })),
          country: String(profile.country || "").trim(),
          city: String(profile.city || "").trim(),
          state_or_region: String(profile.state_or_region || "").trim() || null,
          postcode: String(profile.postcode || "").trim() || null,
          address_line_1: String(profile.address_line_1 || "").trim() || null,
          address_line_2: String(profile.address_line_2 || "").trim() || null,
          email: String(profile.email || "").trim(),
          phone_number: String(profile.phone_number || "").trim() || null,
          website: String(profile.website || "").trim() || null,
          linkedin_url: String(profile.linkedin_url || "").trim() || null,
          twitter_url: String(profile.twitter_url || "").trim() || null,
          instagram_url: String(profile.instagram_url || "").trim() || null,
          facebook_url: String(profile.facebook_url || "").trim() || null,
          monthly_revenue_range: profile.monthly_revenue_range || null,
          employee_count: profile.employee_count ? Number(profile.employee_count) : null,
          operating_stage: profile.operating_stage,
          delivery_model: profile.delivery_model,
          target_customer_type: profile.target_customer_type || null,
          primary_revenue_model: profile.primary_revenue_model || null,
          key_offering_focus: String(profile.key_offering_focus || "").trim() || null
        };

        const existingProducts = Array.isArray(existingCatalogue?.products) ? existingCatalogue.products : [];
        const serviceProducts = (profilePayload.services || [])
          .filter((s) => s?.service_name)
          .map((s) => ({
            id: crypto.randomUUID(),
            name: s.service_name,
            type: "service",
            base_price: 0,
            discount: 0,
            freight_cost: 0,
            archived: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }));
        const nextProducts = serviceProducts.reduce((acc, svc) => {
          const exists = acc.some((p) => String(p?.name || "").trim().toLowerCase() === svc.name.toLowerCase());
          return exists ? acc : [svc, ...acc];
        }, existingProducts);
        const nextCatalogue = {
          products: nextProducts,
          customers: Array.isArray(existingCatalogue?.customers) ? existingCatalogue.customers : [],
          vendors: Array.isArray(existingCatalogue?.vendors) ? existingCatalogue.vendors : []
        };

        if (wsId) {
          await apiRequest(
            `/validation/${wsId}`,
            "PATCH",
            { data: { catalogue: nextCatalogue } },
            { timeoutMs: 120000 }
          );
        } else {
          const ws = await apiRequest(
            "/validation/create",
            "POST",
            { name: wsName, data: { catalogue: nextCatalogue } },
            { timeoutMs: 120000 }
          );
          wsId = ws.id;
        }

        setWorkspaceId(wsId);
        setWorkspaceNameStore(wsName);
        setWorkspaceLogoStore(profilePayload.logo_data_url || null);
        setDecisionStatus(null);
        setIdeaValidation(null);

        await apiRequest(
          "/workspace/profile",
          "POST",
          { workspace_id: wsId, profile: profilePayload },
          { timeoutMs: 120000 }
        );

        setSavedNotice("Workspace saved.");
        if (returnTo) {
          navigate(returnTo, { replace: true });
        } else {
          navigate("/dashboard", { replace: true });
        }
        return;
      }

      const payload = structuredClone(form);
      payload.existing_business = null;
      const bt = String(payload.context.business_type_category || "").trim();
      const btOther = String(payload.context.business_type_other || "").trim();
      payload.context.business_type = bt === "Other" ? btOther || "Other" : bt || "Other";
      delete payload.context.business_type_category;
      delete payload.context.business_type_other;
      const pi = String(payload.context.primary_industry_category || "").trim();
      const piOther = String(payload.context.primary_industry_other || "").trim();
      payload.context.primary_industry = pi === "Other" ? piOther || "Other" : pi || "Other";
      delete payload.context.primary_industry_category;
      delete payload.context.primary_industry_other;
      const cs = String(payload.problem.customer_segment_category || "").trim();
      const csOther = String(payload.problem.customer_segment_other || "").trim();
      payload.problem.customer_segment = cs === "Other" ? csOther || "Other" : cs || "Other";
      delete payload.problem.customer_segment_category;
      delete payload.problem.customer_segment_other;
      payload.context.founder_hours_per_week = parseNumber(payload.context.founder_hours_per_week, 40);
      if (!String(payload.context.business_name || "").trim() && String(payload.offer?.service_type || "").trim()) {
        payload.context.business_name = String(payload.offer.service_type).trim();
      }
      payload.offer.price_per_unit = parseNumber(payload.offer.price_per_unit, 0);
      const duCat = String(payload.offer.deliverable_unit_category || "").trim();
      const duOther = String(payload.offer.deliverable_unit_other || "").trim();
      payload.offer.deliverable_unit = duCat === "Other" ? duOther || "unit" : duCat || "unit";
      delete payload.offer.deliverable_unit_category;
      delete payload.offer.deliverable_unit_other;
      payload.demand.expected_units_per_month = parseNumber(payload.demand.expected_units_per_month, 0);
      payload.demand.expected_customers = parseIntSafe(payload.demand.expected_customers, 0);
      payload.demand.sales_cycle_days = parseIntSafe(payload.demand.sales_cycle_days, 0);
      payload.demand.payment_terms_days = parseIntSafe(payload.demand.payment_terms_days, 14);
      payload.costs.variable_cost_per_unit = parseNumber(payload.costs.variable_cost_per_unit, 0);
      payload.costs.fixed_costs_monthly = parseNumber(payload.costs.fixed_costs_monthly, 0);
      payload.costs.founder_draw_monthly = parseNumber(payload.costs.founder_draw_monthly, 0);
      payload.costs.contractor_costs_monthly = parseNumber(payload.costs.contractor_costs_monthly, 0);
      payload.capacity.team_size = Math.max(1, parseIntSafe(payload.capacity.team_size, 1));
      payload.capacity.capacity_units_per_person_per_month = parseNumber(payload.capacity.capacity_units_per_person_per_month, 0);
      payload.cash.starting_cash = parseNumber(payload.cash.starting_cash, 0);
      payload.cash.upfront_costs = parseNumber(payload.cash.upfront_costs, 0);
      const fixedMonthly = payload.costs.fixed_costs_monthly + payload.costs.founder_draw_monthly + payload.costs.contractor_costs_monthly;
      const startingCash = Math.max(0, payload.cash.starting_cash - payload.cash.upfront_costs);
      setInputs({ price_per_unit: payload.offer.price_per_unit, units_per_month: payload.demand.expected_units_per_month, fixed_costs_monthly: fixedMonthly, variable_cost_per_unit: payload.costs.variable_cost_per_unit, starting_cash: startingCash });
      setCurrency(payload.context.currency || "GBP");
      const nextCatalogue = existingCatalogue || { products: [], customers: [], vendors: [] };
      // Only write idea_validation to the live field when the user explicitly accepts.
      // All other saves (draft, insight generation) stay in draft_idea_validation only
      // so other modules never see unaccepted data.
      const workspacePatch = {
        draft_idea_validation: isProductPath ? null : payload,
        draft_service_idea: isProductPath ? serviceForm : null,
        ...(shouldEvaluate && !isProductPath ? { idea_validation: payload } : {}),
        ...(isProductPath ? {} : { catalogue: nextCatalogue })
      };
      if (wsId) {
        await apiRequest(
          `/validation/${wsId}`,
          "PATCH",
          { data: workspacePatch },
          { timeoutMs: 120000 }
        );
        setWorkspaceId(wsId);
        // Don't touch the workspace name — validation is separate from workspace identity
        if (!isProductPath) setDecisionStatus(null);
        // Only update the live ideaValidation store on explicit acceptance
        if (shouldEvaluate && !isProductPath) setIdeaValidation(payload);
        else setDraftIdeaValidation(payload);
      } else {
        const ws = await apiRequest(
          "/validation/create",
          "POST",
          { name: wsName, data: workspacePatch },
          { timeoutMs: 120000 }
        );
        wsId = ws.id;
        setWorkspaceId(wsId);
        setWorkspaceNameStore(ws.name || wsName);
        if (!isProductPath) setDecisionStatus(null);
        if (shouldEvaluate && !isProductPath) setIdeaValidation(payload);
        else setDraftIdeaValidation(payload);
      }

      if (enabledForms.workspace_profile) {
        const profilePayload = {
          ...profile,
          company_name: String(profile.company_name || "").trim(),
          logo_data_url: String(profile.logo_data_url || "").trim() || null,
          legal_name: String(profile.legal_name || "").trim() || null,
          registration_number: String(profile.registration_number || "").trim() || null,
          about_company: String(profile.about_company || "").trim(),
          tagline: String(profile.tagline || "").trim() || null,
          year_established: profile.year_established ? Number(profile.year_established) : null,
          company_size: profile.company_size || null,
          core_values: String(profile.core_values || "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          secondary_industries: Array.isArray(profile.secondary_industries)
            ? profile.secondary_industries.filter(Boolean)
            : [],
          services: (profile.services || []).map((s) => ({
            service_name: String(s.service_name || "").trim(),
            service_category: s.service_category,
            service_description: String(s.service_description || "").trim() || null
          })),
          country: String(profile.country || "").trim(),
          city: String(profile.city || "").trim(),
          state_or_region: String(profile.state_or_region || "").trim() || null,
          postcode: String(profile.postcode || "").trim() || null,
          address_line_1: String(profile.address_line_1 || "").trim() || null,
          address_line_2: String(profile.address_line_2 || "").trim() || null,
          email: String(profile.email || "").trim(),
          phone_number: String(profile.phone_number || "").trim() || null,
          website: String(profile.website || "").trim() || null,
          linkedin_url: String(profile.linkedin_url || "").trim() || null,
          twitter_url: String(profile.twitter_url || "").trim() || null,
          instagram_url: String(profile.instagram_url || "").trim() || null,
          facebook_url: String(profile.facebook_url || "").trim() || null,
          monthly_revenue_range: profile.monthly_revenue_range || null,
          employee_count: profile.employee_count ? Number(profile.employee_count) : null,
          operating_stage: profile.operating_stage,
          delivery_model: profile.delivery_model,
          target_customer_type: profile.target_customer_type || null,
          primary_revenue_model: profile.primary_revenue_model || null,
          key_offering_focus: String(profile.key_offering_focus || "").trim() || null
        };
        await apiRequest(
          "/workspace/profile",
          "POST",
          { workspace_id: wsId, profile: profilePayload },
          { timeoutMs: 120000 }
        );
        setWorkspaceLogoStore(profilePayload.logo_data_url || null);
      }
      if (shouldEvaluate) {
        if (isProductPath) {
          const serviceName = String(serviceForm?.service_name || "").trim();
          const serviceDescription = String(serviceForm?.service_description || "").trim();
          if (!serviceName) {
            setError("Please enter a product / service name to continue.");
            setIsLoading(false);
            return;
          }
          if (serviceDescription.length < 10) {
            setError("Service description should be at least 10 characters.");
            setIsLoading(false);
            return;
          }
          try {
            const payloadService = {
              service_name: serviceName,
              service_category: String(serviceForm?.service_category || "").trim().toLowerCase() || "consulting",
              service_description: serviceDescription,
              target_customer_type: String(serviceForm?.target_customer_type || "").trim(),
              target_market_scope: String(serviceForm?.target_market_scope || "").trim().toLowerCase(),
              price_per_sale: parseNumber(serviceForm?.price_per_sale, 0),
              expected_sales_per_month: parseNumber(serviceForm?.expected_sales_per_month, 0),
              direct_labour_cost_per_sale: parseNumber(serviceForm?.direct_labour_cost_per_sale, 0),
              contractor_cost_per_sale: parseNumber(serviceForm?.contractor_cost_per_sale, 0),
              materials_cost_per_sale: parseNumber(serviceForm?.materials_cost_per_sale, 0),
              travel_cost_per_sale: parseNumber(serviceForm?.travel_cost_per_sale, 0),
              other_direct_cost_per_sale: parseNumber(serviceForm?.other_direct_cost_per_sale, 0),
              monthly_software_cost: parseNumber(serviceForm?.monthly_software_cost, 0),
              monthly_marketing_cost: parseNumber(serviceForm?.monthly_marketing_cost, 0),
              monthly_admin_cost: parseNumber(serviceForm?.monthly_admin_cost, 0),
              monthly_rent_cost: parseNumber(serviceForm?.monthly_rent_cost, 0),
              monthly_other_fixed_cost: parseNumber(serviceForm?.monthly_other_fixed_cost, 0),
              hours_required_per_sale: parseNumber(serviceForm?.hours_required_per_sale, 0),
              available_delivery_hours_per_month: parseNumber(serviceForm?.available_delivery_hours_per_month, 0),
              demand_evidence_type: String(serviceForm?.demand_evidence_type || "").trim().toLowerCase(),
              number_of_interested_leads: parseIntSafe(serviceForm?.number_of_interested_leads, 0),
              number_of_paying_customers: parseIntSafe(serviceForm?.number_of_paying_customers, 0),
              competitor_price_low: parseNumber(serviceForm?.competitor_price_low, 0),
              competitor_price_high: parseNumber(serviceForm?.competitor_price_high, 0),
              differentiation_level: String(serviceForm?.differentiation_level || "").trim().toLowerCase()
            };
            const result = await apiRequest(
              "/service-ideas/validate",
              "POST",
              payloadService,
              { timeoutMs: 120000 }
            );
            setValidation(result);
            setServiceDecisionStatus(null);

          if (wsId) {
              const isEditingServiceHistory = editingHistoryEntry?.type === "service_validation";
              const validationId = isEditingServiceHistory ? editingHistoryEntry.id : crypto.randomUUID();
              const createdAt = isEditingServiceHistory
                ? editingHistoryEntry.created_at || new Date().toISOString()
                : new Date().toISOString();
              try {
                const ws = await apiRequest(`/validation/${wsId}`, "GET");
                const history = Array.isArray(ws?.data?.service_validation_history) ? ws.data.service_validation_history : [];
                const validationHistoryExisting = Array.isArray(ws?.data?.validation_history) ? ws.data.validation_history : [];
                const nextServiceHistoryBase = history.filter((item) => item?.id !== validationId);
                const nextValidationHistoryBase = validationHistoryExisting.filter((item) => item?.id !== validationId);
                const entry = {
                  id: validationId,
                  created_at: createdAt,
                  service_name: payloadService.service_name,
                  payload: payloadService,
                  result,
                  decision_status: null,
                  currency: serviceCurrency || "GBP"
                };
                await apiRequest(
                  `/validation/${wsId}`,
                  "PATCH",
                  {
                    data: {
                      validation_history: [
                        {
                        id: validationId,
                        type: "service_validation",
                        title: payloadService.service_name,
                        created_at: createdAt,
                        status: "pending",
                        score: typeof result?.scores?.viability_score === "number" ? result.scores.viability_score : null,
                        summary: String(result?.outcome || "").trim() || "Service validation completed",
                        payload: payloadService,
                        result,
                      },
                      ...nextValidationHistoryBase
                    ],
                      service_validation_history: [entry, ...nextServiceHistoryBase],
                      active_service_validation_id: validationId,
                      draft_service_idea: { ...serviceForm, ...payloadService }
                    }
                  },
                  { timeoutMs: 120000 }
                );
                setSavedServiceIdeas([entry, ...nextServiceHistoryBase]);
                setValidationHistory(
                  buildUnifiedValidationHistory({
                    validation_history: [
                      {
                        id: validationId,
                        type: "service_validation",
                        title: payloadService.service_name,
                        created_at: createdAt,
                        status: "pending",
                        score: typeof result?.scores?.viability_score === "number" ? result.scores.viability_score : null,
                        summary: String(result?.outcome || "").trim() || "Service validation completed",
                        payload: payloadService,
                        result,
                      },
                      ...nextValidationHistoryBase
                    ],
                    service_validation_history: [entry, ...nextServiceHistoryBase],
                  })
                );
                setEditingHistoryEntry(null);
              } catch (e) {
                console.warn("Failed to persist service validation history:", e);
              }
            }
            navigate("/results");
          } catch (payloadErr) {
            const msg = humanizeValidationError(payloadErr);
            console.error("Service validation payload error:", payloadErr);
            setError(msg);
            setIsLoading(false);
            return;
          }
        } else {
          const result = await apiRequest(
            "/validation/evaluate",
            "POST",
            { idea_validation: payload },
            { timeoutMs: 120000 }
          );
          setValidation(result);
          if (wsId) {
            const isEditingBusinessHistory = editingHistoryEntry?.type === "business_validation";
            const validationId = isEditingBusinessHistory ? editingHistoryEntry.id : crypto.randomUUID();
            const createdAt = isEditingBusinessHistory
              ? editingHistoryEntry.created_at || new Date().toISOString()
              : new Date().toISOString();
            try {
              const ws = await apiRequest(`/validation/${wsId}`, "GET");
              const existing = Array.isArray(ws?.data?.validation_history) ? ws.data.validation_history : [];
              const nextHistoryBase = existing.filter((item) => item?.id !== validationId);
              const nextEntry = {
                id: validationId,
                type: "business_validation",
                title: String(payload?.context?.business_name || wsName || "Business validation"),
                created_at: createdAt,
                status: "pending",
                score: typeof result?.score === "number" ? result.score : null,
                summary: String(result?.classification || result?.outcome || "Business validation completed"),
                payload,
                result,
              };
              await apiRequest(`/validation/${wsId}`, "PATCH", {
                data: {
                  validation_history: [nextEntry, ...nextHistoryBase],
                  active_validation_id: validationId,
                }
              }, { timeoutMs: 120000 });
              setValidationHistory([normaliseValidationHistoryEntry(nextEntry), ...nextHistoryBase.map(normaliseValidationHistoryEntry).filter(Boolean)].filter(Boolean));
              setEditingHistoryEntry(null);
            } catch (historyErr) {
              console.warn("Failed to persist validation history:", historyErr);
            }
          }
          navigate("/results");
        }
      } else {
        setValidation(null);
        setSavedNotice("Workspace saved.");
        if (fromOtherModule) {
          if (returnTo) {
            navigate(returnTo, { replace: true });
          } else {
            navigate("/dashboard", { replace: true });
          }
        }
      }
    } catch (e) {
      const msg = humanizeValidationError(e);
      console.error("Validation run failed:", e);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  async function runMarketResearch(options = {}) {
    const {
      useCurrentForm = false,
      markStageOneReady = false,
      showInBuilder = false,
      researchSource = isProductPath ? "service" : "business",
      forceRefresh = false,
    } = options;
    if (showInBuilder) {
      setShowBuilderMarketInsight(true);
      setContentTab("builder");
    }

    // Skip API call if form data hasn't changed and we already have insights
    if (!forceRefresh && marketResearch && useCurrentForm) {
      const payload = researchSource === "service" ? buildServiceIdeaPayloadForResearch() : buildBusinessIdeaPayloadForResearch();
      const currentHash = JSON.stringify(payload);
      if (currentHash === lastResearchHash) {
        if (markStageOneReady) setStageOneResearchReady(true);
        return;
      }
    }

    setMrLoading(true);
    setMrError(null);
    setError(null);
    try {
      const wsId = editingWorkspaceId || storedWorkspaceId;
      const payload = researchSource === "service" ? buildServiceIdeaPayloadForResearch() : buildBusinessIdeaPayloadForResearch();
      const body = useCurrentForm
        ? { idea_validation: payload }
        : wsId
          ? { workspace_id: wsId }
          : { idea_validation: payload };
      if (useCurrentForm) setLastResearchHash(JSON.stringify(payload));
      const result = await apiRequest("/validation/market-research", "POST", body, { timeoutMs: 120000 });
      setMarketResearch(result);
      if (markStageOneReady) setStageOneResearchReady(true);
      // Persist insights to workspace so they survive page refreshes
      try {
        await apiRequest("/validation/me", "PATCH", { data: { market_research: result } });
      } catch {
        // non-critical — insights are already in state
      }
    } catch (e) {
      setMrError(e instanceof Error ? e.message : "Market research failed. Please try again.");
      if (markStageOneReady) setStageOneResearchReady(false);
    } finally {
      setMrLoading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between [@media(max-height:820px)]:gap-2">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18h6" />
              <path d="M10 22h4" />
              <path d="M12 2a7 7 0 0 0-4 12c.6.5 1 1.2 1.1 2h5.8c.1-.8.5-1.5 1.1-2A7 7 0 0 0 12 2Z" />
            </svg>
          </div>
          <div>
            <div className="text-2xl font-semibold tracking-tight text-slate-900">
              {fromOtherModule ? "Create Workspace" : "Idea Validation"}
            </div>
            <div className="mt-1 text-sm text-slate-600 [@media(max-height:820px)]:hidden">
              {fromOtherModule
                ? "Tell us about your workspace so we can set things up."
                : "Choose what to fill first, then generate a deterministic report."}
            </div>
          </div>
        </div>
        {!isCreateWorkspace ? (
          <div className="flex items-center gap-2">
            <div className="w-[240px] max-w-full">
              <SegmentedTabs
                ariaLabel="Validation content tabs"
                value={contentTab}
                onChange={setContentTab}
                size="sm"
                options={[
                  { value: "builder", label: "Builder" },
                  { value: "market_research", label: "Market research" },
                  { value: "history", label: "History" }
                ]}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        {isPrefilling ? (
          <SectionCard title="Loading workspace">
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <Spinner size={16} /> Loading your saved inputs...
            </div>
          </SectionCard>
        ) : null}

        {error ? (
          <div className="mb-4">
            <InlineAlert kind="error" message={error} />
          </div>
        ) : null}
        {savedNotice ? (
          <div className="mb-4">
            <InlineAlert message={savedNotice} />
          </div>
        ) : null}

        {(contentTab === "builder" &&
          showBuilderMarketInsight &&
          (isBusinessStageFlow || isServiceStageFlow)) &&
          !isCreateWorkspace ? (
          <div className="space-y-4">
            {/* Stage Insight header bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-50 to-accent-50 px-4 py-3 dark:border-slate-700 dark:from-slate-900 dark:to-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 17l3-3 3 3M9 11l3-3 3 3" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {isBusinessStageFlow ? currentBusinessStageMeta?.label || "Stage" : isServiceStageFlow ? currentServiceStageMeta?.label || "Stage" : "Stage"} insights
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Generated from your inputs for this stage</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => runMarketResearch({
                    useCurrentForm: isBusinessStageFlow || isServiceStageFlow,
                    markStageOneReady: true,
                    showInBuilder: true,
                    researchSource: isServiceStageFlow ? "service" : "business",
                    forceRefresh: true,
                  })}
                  disabled={mrLoading}
                >
                  {mrLoading ? <Spinner size={14} /> : null}
                  Refresh
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setError(null); setShowBuilderMarketInsight(false); }}
                >
                  ← Back to stage
                </Button>
              </div>
            </div>
            {mrError ? <InlineAlert kind="error" message={mrError} /> : null}

            {mrLoading ? (
              <SectionCard title="Updating Insight">
                <div className="flex items-center gap-3 text-sm text-slate-600">
                  <Spinner size={20} />
                  Searching live market data and synthesising the next stage insight... This may take up to 30 seconds.
                </div>
              </SectionCard>
            ) : marketResearch ? (
              <>
                {(insightVisibility.showSummary || insightVisibility.showValidationResult) && (marketResearch.idea_validation_result || marketResearch.executive_summary) ? (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    {insightVisibility.showSummary && marketResearch.executive_summary ? (
                      <SectionCard title="Executive Summary" subtitle="Plain-English verdict on whether this idea is worth pursuing.">
                        <div className="text-sm leading-6 text-slate-700">{marketResearch.executive_summary}</div>
                      </SectionCard>
                    ) : null}

                    {insightVisibility.showValidationResult && marketResearch.idea_validation_result ? (
                      <SectionCard title="Idea Validation Result" subtitle="The final recommendation distilled from the live market research.">
                        <div className="space-y-3 text-sm">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-xl bg-slate-50 p-3">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overall Score</div>
                              <div className="mt-1 text-base font-semibold text-slate-900">{marketResearch.idea_validation_result.overall_score || "Fair"}</div>
                            </div>
                            <div className="rounded-xl bg-slate-50 p-3">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended Action</div>
                              <div className="mt-1 text-base font-semibold text-slate-900">{marketResearch.idea_validation_result.recommended_action || "Research more"}</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs">
                            {marketResearch.idea_validation_result.market_demand ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Market demand: {marketResearch.idea_validation_result.market_demand}</span> : null}
                            {marketResearch.idea_validation_result.competition_level ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Competition: {marketResearch.idea_validation_result.competition_level}</span> : null}
                            {marketResearch.idea_validation_result.pricing_opportunity ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Pricing: {marketResearch.idea_validation_result.pricing_opportunity}</span> : null}
                            {marketResearch.idea_validation_result.execution_risk ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Execution risk: {marketResearch.idea_validation_result.execution_risk}</span> : null}
                          </div>
                        </div>
                      </SectionCard>
                    ) : null}
                  </div>
                ) : null}

                {/* Viability Score */}
                {insightVisibility.showViabilityScore && marketResearch.viability_score ? (() => {
                  const vs = marketResearch.viability_score;
                  const scoreColors = {
                    "Very Strong": "bg-emerald-50 border-emerald-200 text-emerald-900",
                    "Strong": "bg-green-50 border-green-200 text-green-900",
                    "Fair": "bg-amber-50 border-amber-200 text-amber-900",
                    "Weak": "bg-rose-50 border-rose-200 text-rose-900",
                  };
                  const barColors = {
                    "Very Strong": "bg-emerald-500",
                    "Strong": "bg-green-500",
                    "Fair": "bg-amber-500",
                    "Weak": "bg-rose-500",
                  };
                  const colorClass = scoreColors[vs.label] || scoreColors["Fair"];
                  const barClass = barColors[vs.label] || barColors["Fair"];
                  return (
                    <div className={`rounded-2xl border p-5 ${colorClass}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide opacity-60">Viability Score</div>
                          <div className="mt-1 text-3xl font-bold">{vs.score ?? "–"}<span className="text-base font-semibold opacity-60">/100</span></div>
                          <div className="mt-1 text-lg font-semibold">{vs.label}</div>
                        </div>
                        <div className="max-w-sm flex-1 text-sm opacity-80">{vs.summary}</div>
                      </div>
                      <div className="mt-3 h-2 w-full rounded-full bg-black/10">
                        <div className={`h-2 rounded-full ${barClass}`} style={{ width: `${Math.min(100, vs.score ?? 0)}%` }} />
                      </div>
                      {vs.recommended_action ? (
                        <div className="mt-3 text-sm font-semibold opacity-80">Recommended action: {vs.recommended_action}</div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {vs.market_demand ? <span className="rounded-full bg-black/10 px-2 py-0.5 font-semibold">Demand: {vs.market_demand}</span> : null}
                        {vs.competition_level ? <span className="rounded-full bg-black/10 px-2 py-0.5 font-semibold">Competition: {vs.competition_level}</span> : null}
                        {vs.pricing_opportunity ? <span className="rounded-full bg-black/10 px-2 py-0.5 font-semibold">Pricing: {vs.pricing_opportunity}</span> : null}
                        {vs.execution_risk ? <span className="rounded-full bg-black/10 px-2 py-0.5 font-semibold">Exec risk: {vs.execution_risk}</span> : null}
                      </div>
                    </div>
                  );
                })() : null}

                {/* Market Opportunity */}
                {insightVisibility.showMarketOpportunity && marketResearch.market_opportunity ? (
                  <SectionCard title="Market Opportunity">
                    <div className="mb-3 text-sm text-slate-700">{marketResearch.market_opportunity.summary}</div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Market Size</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{marketResearch.market_opportunity.market_size || "–"}</div>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Growth Rate</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{marketResearch.market_opportunity.growth_rate || "–"}</div>
                      </div>
                      {Array.isArray(marketResearch.market_opportunity.key_trends) && marketResearch.market_opportunity.key_trends.length ? (
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Key Trends</div>
                          <ul className="list-disc list-inside space-y-0.5 text-xs text-slate-700">
                            {marketResearch.market_opportunity.key_trends.map((t, i) => <li key={i}>{t}</li>)}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                    {marketResearch.market_opportunity.location_opportunity ? (
                      <div className="mt-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
                        {marketResearch.market_opportunity.location_opportunity}
                      </div>
                    ) : null}
                  </SectionCard>
                ) : null}

                {/* Target Customer + Problem Validation */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {insightVisibility.showTargetCustomer && marketResearch.target_customer ? (
                    <SectionCard title="Target Customer">
                      <div className="space-y-2 text-sm">
                        {marketResearch.target_customer.profile ? (
                          <div><span className="font-semibold text-slate-700">Profile: </span>{marketResearch.target_customer.profile}</div>
                        ) : null}
                        {marketResearch.target_customer.willingness_to_pay ? (
                          <div><span className="font-semibold text-slate-700">Willingness to pay: </span>{marketResearch.target_customer.willingness_to_pay}</div>
                        ) : null}
                        {marketResearch.target_customer.urgency ? (
                          <div><span className="font-semibold text-slate-700">Urgency: </span>{marketResearch.target_customer.urgency}</div>
                        ) : null}
                        {Array.isArray(marketResearch.target_customer.pain_points) && marketResearch.target_customer.pain_points.length ? (
                          <div>
                            <div className="font-semibold text-slate-700 mb-1">Pain Points</div>
                            <ul className="list-disc list-inside space-y-0.5 text-slate-600">
                              {marketResearch.target_customer.pain_points.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                          </div>
                        ) : null}
                        {marketResearch.target_customer.buying_behaviour ? (
                          <div><span className="font-semibold text-slate-700">Buying behaviour: </span>{marketResearch.target_customer.buying_behaviour}</div>
                        ) : null}
                      </div>
                    </SectionCard>
                  ) : null}

                  {insightVisibility.showProblemValidation && marketResearch.problem_validation ? (
                    <SectionCard title="Problem Validation">
                      <div className="space-y-2 text-sm">
                        {marketResearch.problem_validation.evidence_strength ? (
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${marketResearch.problem_validation.evidence_strength === "Strong" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : marketResearch.problem_validation.evidence_strength === "Weak" ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>
                              Evidence: {marketResearch.problem_validation.evidence_strength}
                            </span>
                          </div>
                        ) : null}
                        {marketResearch.problem_validation.frequency_assessment ? (
                          <div className="text-slate-600">{marketResearch.problem_validation.frequency_assessment}</div>
                        ) : null}
                        {marketResearch.problem_validation.severity ? (
                          <div><span className="font-semibold text-slate-700">Severity: </span>{marketResearch.problem_validation.severity}</div>
                        ) : null}
                        {Array.isArray(marketResearch.problem_validation.evidence) && marketResearch.problem_validation.evidence.length ? (
                          <ul className="list-disc list-inside space-y-0.5 text-slate-600">
                            {marketResearch.problem_validation.evidence.map((e, i) => <li key={i}>{e}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    </SectionCard>
                  ) : null}
                </div>

                {/* Demand Signals */}
                {insightVisibility.showDemandSignals && marketResearch.demand_signals ? (
                  <SectionCard title="Demand Signals">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {marketResearch.demand_signals.search_trend ? (
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${marketResearch.demand_signals.search_trend === "rising" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : marketResearch.demand_signals.search_trend === "declining" ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`}>
                          Search: {marketResearch.demand_signals.search_trend}
                        </span>
                      ) : null}
                    </div>
                    {Array.isArray(marketResearch.demand_signals.signals) && marketResearch.demand_signals.signals.length ? (
                      <ul className="list-disc list-inside space-y-1 text-sm text-slate-600">
                        {marketResearch.demand_signals.signals.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    ) : null}
                    {marketResearch.demand_signals.online_discussion ? (
                      <div className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{marketResearch.demand_signals.online_discussion}</div>
                    ) : null}
                  </SectionCard>
                ) : null}

                {/* Alternative Solutions */}
                {insightVisibility.showAlternativeSolutions && Array.isArray(marketResearch.alternative_solutions) && marketResearch.alternative_solutions.length ? (
                  <SectionCard title="Alternative Solutions">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <th className="pb-2 pr-4">Name</th>
                            <th className="pb-2 pr-4">Type</th>
                            <th className="pb-2">Weakness</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {marketResearch.alternative_solutions.map((alt, i) => (
                            <tr key={i}>
                              <td className="py-2 pr-4 font-medium text-slate-900">{alt.name}</td>
                              <td className="py-2 pr-4 text-slate-500">{alt.type || "–"}</td>
                              <td className="py-2 text-slate-600">{alt.weakness}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </SectionCard>
                ) : null}

                {/* Competitor Matrix */}
                {insightVisibility.showCompetitorMatrix && Array.isArray(marketResearch.competitor_matrix) && marketResearch.competitor_matrix.length ? (
                  <SectionCard title="Competitor Matrix">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <th className="pb-2 pr-4">Competitor</th>
                            <th className="pb-2 pr-4">Positioning</th>
                            <th className="pb-2 pr-4">Strengths</th>
                            <th className="pb-2 pr-4">Weaknesses</th>
                            <th className="pb-2">Est. Price</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {marketResearch.competitor_matrix.map((comp, i) => (
                            <tr key={i}>
                              <td className="py-2 pr-4 font-medium text-slate-900 align-top">{comp.name}</td>
                              <td className="py-2 pr-4 text-slate-600 align-top">{comp.positioning || "–"}</td>
                              <td className="py-2 pr-4 text-slate-600 align-top">{Array.isArray(comp.strengths) ? comp.strengths.join(", ") : comp.strengths || "–"}</td>
                              <td className="py-2 pr-4 text-slate-600 align-top">{Array.isArray(comp.weaknesses) ? comp.weaknesses.join(", ") : comp.weaknesses || "–"}</td>
                              <td className="py-2 text-slate-600 align-top">{comp.est_price || "–"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </SectionCard>
                ) : null}

                {/* Competitor Pricing */}
                {insightVisibility.showCompetitorPricing && Array.isArray(marketResearch.competitor_pricing) && marketResearch.competitor_pricing.length ? (
                  <SectionCard title="Competitor Pricing Intelligence">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <th className="pb-2 pr-4">Competitor</th>
                            <th className="pb-2 pr-4">Price Range</th>
                            <th className="pb-2 pr-4">Model</th>
                            <th className="pb-2">Free Plan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {marketResearch.competitor_pricing.map((cp, i) => (
                            <tr key={i}>
                              <td className="py-2 pr-4 font-medium text-slate-900">{cp.competitor}</td>
                              <td className="py-2 pr-4 text-slate-600">{cp.price_range || "–"}</td>
                              <td className="py-2 pr-4 text-slate-600">{cp.model || "–"}</td>
                              <td className="py-2 text-slate-600">{cp.free_plan ? "Yes" : "No"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </SectionCard>
                ) : null}

                {/* Pricing Strategy + Recommended Range */}
                {insightVisibility.showPricingStrategy || insightVisibility.showRecommendedPriceRange ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {insightVisibility.showPricingStrategy && marketResearch.pricing_strategy ? (
                    <SectionCard title="Pricing Strategy">
                      <div className="space-y-2 text-sm">
                        {marketResearch.pricing_strategy.recommended_model ? (
                          <div><span className="font-semibold text-slate-700">Recommended model: </span>{marketResearch.pricing_strategy.recommended_model}</div>
                        ) : null}
                        {marketResearch.pricing_strategy.rationale ? (
                          <div className="text-slate-600">{marketResearch.pricing_strategy.rationale}</div>
                        ) : null}
                        {marketResearch.pricing_strategy.launch_offer ? (
                          <div className="rounded-xl bg-brand-50 p-3 text-brand-900 text-xs font-medium">
                            Launch offer: {marketResearch.pricing_strategy.launch_offer}
                          </div>
                        ) : null}
                      </div>
                    </SectionCard>
                  ) : null}

                  {insightVisibility.showRecommendedPriceRange && marketResearch.recommended_price_range ? (
                    <SectionCard title="Recommended Price Range">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {[["low", "Entry"], ["mid", "Mid"], ["premium", "Premium"]].map(([key, label]) => (
                          <div key={key} className="rounded-xl bg-slate-50 p-3">
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
                            <div className="mt-1 text-sm font-bold text-slate-900">
                              {marketResearch.recommended_price_range[key] ?? "–"}
                            </div>
                          </div>
                        ))}
                      </div>
                      {marketResearch.recommended_price_range.notes ? (
                        <div className="mt-2 text-xs text-slate-500">{marketResearch.recommended_price_range.notes}</div>
                      ) : null}
                    </SectionCard>
                  ) : null}
                </div>
                ) : null}

                {/* Positioning + Go-to-Market */}
                {insightVisibility.showPositioning || insightVisibility.showGoToMarket ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {insightVisibility.showPositioning && marketResearch.positioning ? (
                    <SectionCard title="Positioning Recommendation">
                      <div className="space-y-2 text-sm">
                        {marketResearch.positioning.headline_message ? (
                          <div className="rounded-xl bg-brand-50 p-3 text-sm font-semibold text-brand-900">
                            &ldquo;{marketResearch.positioning.headline_message}&rdquo;
                          </div>
                        ) : null}
                        {marketResearch.positioning.value_proposition ? (
                          <div><span className="font-semibold text-slate-700">Value prop: </span>{marketResearch.positioning.value_proposition}</div>
                        ) : null}
                        {marketResearch.positioning.differentiation ? (
                          <div><span className="font-semibold text-slate-700">Differentiation: </span>{marketResearch.positioning.differentiation}</div>
                        ) : null}
                      </div>
                    </SectionCard>
                  ) : null}

                  {insightVisibility.showGoToMarket && marketResearch.go_to_market ? (
                    <SectionCard title="Go-To-Market Recommendation">
                      <div className="space-y-2 text-sm">
                        {Array.isArray(marketResearch.go_to_market.primary_channels) && marketResearch.go_to_market.primary_channels.length ? (
                          <div>
                            <span className="font-semibold text-slate-700">Primary channels: </span>
                            {marketResearch.go_to_market.primary_channels.join(", ")}
                          </div>
                        ) : null}
                        {marketResearch.go_to_market.timeline ? (
                          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{marketResearch.go_to_market.timeline}</div>
                        ) : null}
                        {Array.isArray(marketResearch.go_to_market.quick_wins) && marketResearch.go_to_market.quick_wins.length ? (
                          <div>
                            <div className="font-semibold text-slate-700 mb-1">Quick wins</div>
                            <ul className="list-disc list-inside space-y-0.5 text-slate-600">
                              {marketResearch.go_to_market.quick_wins.map((t, i) => <li key={i}>{t}</li>)}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </SectionCard>
                  ) : null}
                </div>
                ) : null}

                {/* Risks */}
                {insightVisibility.showRisks && Array.isArray(marketResearch.risks) && marketResearch.risks.length ? (
                  <SectionCard title="Risks &amp; Barriers">
                    <div className="space-y-2">
                      {marketResearch.risks.map((r, i) => {
                        const severityClass = r.severity === "High" ? "bg-rose-50 text-rose-700 ring-rose-200" : r.severity === "Medium" ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-slate-100 text-slate-600 ring-slate-200";
                        return (
                          <div key={i} className="rounded-xl border border-slate-100 bg-white p-3 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-slate-900">{r.risk}</span>
                              {r.severity ? (
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${severityClass}`}>{r.severity}</span>
                              ) : null}
                            </div>
                            {r.mitigation ? <div className="mt-1 text-slate-600">{r.mitigation}</div> : null}
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                ) : null}

                {/* Next Best Actions */}
                {insightVisibility.showNextActions && Array.isArray(marketResearch.next_actions) && marketResearch.next_actions.length ? (
                  <SectionCard title="Next Best Actions">
                    <div className="space-y-3">
                      {marketResearch.next_actions.map((action, i) => (
                        <div key={i} className="flex gap-3">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                            {action.step ?? i + 1}
                          </div>
                          <div className="flex-1 text-sm">
                            <div className="font-semibold text-slate-900">{action.action}</div>
                            {action.why ? <div className="mt-0.5 text-slate-600">{action.why}</div> : null}
                            {action.timeframe ? (
                              <div className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">{action.timeframe}</div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                ) : null}

                {stageOneResearchReady ? (
                  <div className="rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 to-accent-50 p-5 dark:border-slate-700 dark:from-slate-900 dark:to-slate-800">
                    <div className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">What would you like to do next?</div>
                    <div className="mb-4 text-xs text-slate-500 dark:text-slate-400">Choose how to proceed based on these insights.</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setStageOneResearchReady(false);
                          setShowBuilderMarketInsight(false);
                          setLastResearchHash(null);
                        }}
                        className="flex flex-col items-start gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Modify inputs</span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">Go back and adjust your stage inputs</span>
                      </button>

                      {/* Reject: always for business idea; only at last stage for product/service */}
                      {(!isServiceStageFlow || isLastServiceStage) && (
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setStageOneResearchReady(false);
                          setShowBuilderMarketInsight(false);
                          saveWorkspace(true);
                        }}
                        className="flex flex-col items-start gap-1.5 rounded-xl border border-rose-100 bg-white px-4 py-3 text-left shadow-sm transition hover:border-rose-200 hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50 text-rose-500 dark:bg-rose-900/20">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </span>
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Reject idea</span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">Mark this idea as rejected</span>
                      </button>
                      )}

                      {(isBusinessStageFlow ? !isLastBusinessStage : !isLastServiceStage) ? (
                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setStageOneResearchReady(false);
                            setShowBuilderMarketInsight(false);
                            if (isBusinessStageFlow) {
                              setCurrentBusinessStageIndex((prev) => Math.min(prev + 1, Math.max(0, businessStageKeys.length - 1)));
                            } else {
                              setCurrentServiceStageIndex((prev) => Math.min(prev + 1, Math.max(0, serviceStageKeys.length - 1)));
                            }
                          }}
                          className="flex flex-col items-start gap-1.5 rounded-xl border border-brand-100 bg-white px-4 py-3 text-left shadow-sm transition hover:border-brand-200 hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/20">
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
                          </span>
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Next stage</span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">Continue to the next set of inputs</span>
                        </button>
                      ) : null}

                      {/* Accept: always for business idea; only at last stage for product/service */}
                      {(!isServiceStageFlow || isLastServiceStage) && (
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setStageOneResearchReady(false);
                          setShowBuilderMarketInsight(false);
                          saveWorkspace(true);
                        }}
                        className="flex flex-col items-start gap-1.5 rounded-xl border border-emerald-100 bg-white px-4 py-3 text-left shadow-sm transition hover:border-emerald-200 hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
                        </span>
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Accept & evaluate</span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">Save and run the financial evaluation</span>
                      </button>
                      )}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : contentTab === "market_research" && !isCreateWorkspace ? (
          <div className="space-y-4">
            <SectionCard
              title="Market research"
              subtitle="Full research report accumulated from your validation inputs."
            >
              {mrError ? <InlineAlert kind="error" message={mrError} /> : null}
            </SectionCard>

            {mrLoading ? (
              <SectionCard title="Updating Market Research">
                <div className="flex items-center gap-3 text-sm text-slate-600">
                  <Spinner size={20} />
                  Updating the accumulated market research... This may take up to 30 seconds.
                </div>
              </SectionCard>
            ) : marketResearch ? (
              <>
                {marketResearch.idea_validation_result || marketResearch.executive_summary ? (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    {marketResearch.executive_summary ? (
                      <SectionCard title="Executive Summary" subtitle="Plain-English verdict on whether this idea is worth pursuing.">
                        <div className="text-sm leading-6 text-slate-700">{marketResearch.executive_summary}</div>
                      </SectionCard>
                    ) : null}

                    {marketResearch.idea_validation_result ? (
                      <SectionCard title="Idea Validation Result" subtitle="The latest combined recommendation from the research gathered so far.">
                        <div className="space-y-3 text-sm">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-xl bg-slate-50 p-3">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overall Score</div>
                              <div className="mt-1 text-base font-semibold text-slate-900">{marketResearch.idea_validation_result.overall_score || "Fair"}</div>
                            </div>
                            <div className="rounded-xl bg-slate-50 p-3">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended Action</div>
                              <div className="mt-1 text-base font-semibold text-slate-900">{marketResearch.idea_validation_result.recommended_action || "Research more"}</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs">
                            {marketResearch.idea_validation_result.market_demand ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Market demand: {marketResearch.idea_validation_result.market_demand}</span> : null}
                            {marketResearch.idea_validation_result.competition_level ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Competition: {marketResearch.idea_validation_result.competition_level}</span> : null}
                            {marketResearch.idea_validation_result.pricing_opportunity ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Pricing: {marketResearch.idea_validation_result.pricing_opportunity}</span> : null}
                            {marketResearch.idea_validation_result.execution_risk ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Execution risk: {marketResearch.idea_validation_result.execution_risk}</span> : null}
                          </div>
                        </div>
                      </SectionCard>
                    ) : null}
                  </div>
                ) : null}

                {marketResearch.viability_score ? (() => {
                  const vs = marketResearch.viability_score;
                  const scoreColors = {
                    "Very Strong": "bg-emerald-50 border-emerald-200 text-emerald-900",
                    "Strong": "bg-green-50 border-green-200 text-green-900",
                    "Fair": "bg-amber-50 border-amber-200 text-amber-900",
                    "Weak": "bg-rose-50 border-rose-200 text-rose-900",
                  };
                  const barColors = {
                    "Very Strong": "bg-emerald-500",
                    "Strong": "bg-green-500",
                    "Fair": "bg-amber-500",
                    "Weak": "bg-rose-500",
                  };
                  const colorClass = scoreColors[vs.label] || scoreColors["Fair"];
                  const barClass = barColors[vs.label] || barColors["Fair"];
                  return (
                    <div className={`rounded-2xl border p-5 ${colorClass}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide opacity-60">Viability Score</div>
                          <div className="mt-1 text-3xl font-bold">{vs.score ?? "-"}<span className="text-base font-semibold opacity-60">/100</span></div>
                          <div className="mt-1 text-lg font-semibold">{vs.label}</div>
                        </div>
                        <div className="max-w-sm flex-1 text-sm opacity-80">{vs.summary}</div>
                      </div>
                      <div className="mt-3 h-2 w-full rounded-full bg-black/10">
                        <div className={`h-2 rounded-full ${barClass}`} style={{ width: `${Math.min(100, vs.score ?? 0)}%` }} />
                      </div>
                    </div>
                  );
                })() : null}

                {marketResearch.market_opportunity ? (
                  <SectionCard title="Market Opportunity">
                    <div className="mb-3 text-sm text-slate-700">{marketResearch.market_opportunity.summary}</div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Market Size</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{marketResearch.market_opportunity.market_size || "-"}</div>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Growth Rate</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{marketResearch.market_opportunity.growth_rate || "-"}</div>
                      </div>
                      {Array.isArray(marketResearch.market_opportunity.key_trends) && marketResearch.market_opportunity.key_trends.length ? (
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Key Trends</div>
                          <ul className="list-disc list-inside space-y-0.5 text-xs text-slate-700">
                            {marketResearch.market_opportunity.key_trends.map((t, i) => <li key={i}>{t}</li>)}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </SectionCard>
                ) : null}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {marketResearch.target_customer ? (
                    <SectionCard title="Target Customer">
                      <div className="space-y-2 text-sm">
                        {marketResearch.target_customer.profile ? <div><span className="font-semibold text-slate-700">Profile: </span>{marketResearch.target_customer.profile}</div> : null}
                        {Array.isArray(marketResearch.target_customer.pain_points) && marketResearch.target_customer.pain_points.length ? (
                          <div>
                            <div className="font-semibold text-slate-700 mb-1">Pain Points</div>
                            <ul className="list-disc list-inside space-y-0.5 text-slate-600">
                              {marketResearch.target_customer.pain_points.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                          </div>
                        ) : null}
                        {marketResearch.target_customer.buying_behaviour ? <div><span className="font-semibold text-slate-700">Buying behaviour: </span>{marketResearch.target_customer.buying_behaviour}</div> : null}
                        {marketResearch.target_customer.urgency ? <div><span className="font-semibold text-slate-700">Urgency: </span>{marketResearch.target_customer.urgency}</div> : null}
                        {marketResearch.target_customer.willingness_to_pay ? <div><span className="font-semibold text-slate-700">Willingness to pay: </span>{marketResearch.target_customer.willingness_to_pay}</div> : null}
                      </div>
                    </SectionCard>
                  ) : null}

                  {marketResearch.problem_validation ? (
                    <SectionCard title="Problem Validation">
                      <div className="space-y-2 text-sm">
                        {marketResearch.problem_validation.frequency_assessment ? <div className="text-slate-600">{marketResearch.problem_validation.frequency_assessment}</div> : null}
                        {marketResearch.problem_validation.severity ? <div><span className="font-semibold text-slate-700">Severity: </span>{marketResearch.problem_validation.severity}</div> : null}
                        {Array.isArray(marketResearch.problem_validation.evidence) && marketResearch.problem_validation.evidence.length ? (
                          <ul className="list-disc list-inside space-y-0.5 text-slate-600">
                            {marketResearch.problem_validation.evidence.map((e, i) => <li key={i}>{e}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    </SectionCard>
                  ) : null}
                </div>

                {marketResearch.demand_signals ? (
                  <SectionCard title="Demand Signals">
                    {Array.isArray(marketResearch.demand_signals.signals) && marketResearch.demand_signals.signals.length ? (
                      <ul className="list-disc list-inside space-y-1 text-sm text-slate-600">
                        {marketResearch.demand_signals.signals.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    ) : null}
                    {marketResearch.demand_signals.online_discussion ? (
                      <div className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{marketResearch.demand_signals.online_discussion}</div>
                    ) : null}
                  </SectionCard>
                ) : null}

                {Array.isArray(marketResearch.competitor_matrix) && marketResearch.competitor_matrix.length ? (
                  <SectionCard title="Competitor Matrix">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <th className="pb-2 pr-4">Competitor</th>
                            <th className="pb-2 pr-4">Positioning</th>
                            <th className="pb-2 pr-4">Strengths</th>
                            <th className="pb-2 pr-4">Weaknesses</th>
                            <th className="pb-2">Est. Price</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {marketResearch.competitor_matrix.map((comp, i) => (
                            <tr key={i}>
                              <td className="py-2 pr-4 font-medium text-slate-900 align-top">{comp.name}</td>
                              <td className="py-2 pr-4 text-slate-600 align-top">{comp.positioning || "-"}</td>
                              <td className="py-2 pr-4 text-slate-600 align-top">{Array.isArray(comp.strengths) ? comp.strengths.join(", ") : comp.strengths || "-"}</td>
                              <td className="py-2 pr-4 text-slate-600 align-top">{Array.isArray(comp.weaknesses) ? comp.weaknesses.join(", ") : comp.weaknesses || "-"}</td>
                              <td className="py-2 text-slate-600 align-top">{comp.est_price || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </SectionCard>
                ) : null}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {marketResearch.pricing_strategy ? (
                    <SectionCard title="Pricing Strategy">
                      <div className="space-y-2 text-sm">
                        {marketResearch.pricing_strategy.recommended_model ? <div><span className="font-semibold text-slate-700">Recommended model: </span>{marketResearch.pricing_strategy.recommended_model}</div> : null}
                        {marketResearch.pricing_strategy.rationale ? <div className="text-slate-600">{marketResearch.pricing_strategy.rationale}</div> : null}
                        {marketResearch.pricing_strategy.launch_offer ? <div className="rounded-xl bg-brand-50 p-3 text-brand-900 text-xs font-medium">Launch offer: {marketResearch.pricing_strategy.launch_offer}</div> : null}
                      </div>
                    </SectionCard>
                  ) : null}

                  {marketResearch.recommended_price_range ? (
                    <SectionCard title="Recommended Price Range">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {[["low", "Entry"], ["mid", "Mid"], ["premium", "Premium"]].map(([key, label]) => (
                          <div key={key} className="rounded-xl bg-slate-50 p-3">
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
                            <div className="mt-1 text-sm font-bold text-slate-900">{marketResearch.recommended_price_range[key] ?? "-"}</div>
                          </div>
                        ))}
                      </div>
                    </SectionCard>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {marketResearch.positioning ? (
                    <SectionCard title="Positioning Recommendation">
                      <div className="space-y-2 text-sm">
                        {marketResearch.positioning.headline_message ? <div className="rounded-xl bg-brand-50 p-3 text-sm font-semibold text-brand-900">&ldquo;{marketResearch.positioning.headline_message}&rdquo;</div> : null}
                        {marketResearch.positioning.value_proposition ? <div><span className="font-semibold text-slate-700">Value prop: </span>{marketResearch.positioning.value_proposition}</div> : null}
                        {marketResearch.positioning.differentiation ? <div><span className="font-semibold text-slate-700">Differentiation: </span>{marketResearch.positioning.differentiation}</div> : null}
                      </div>
                    </SectionCard>
                  ) : null}

                  {marketResearch.go_to_market ? (
                    <SectionCard title="Go-To-Market Recommendation">
                      <div className="space-y-2 text-sm">
                        {Array.isArray(marketResearch.go_to_market.primary_channels) && marketResearch.go_to_market.primary_channels.length ? (
                          <div><span className="font-semibold text-slate-700">Primary channels: </span>{marketResearch.go_to_market.primary_channels.join(", ")}</div>
                        ) : null}
                        {marketResearch.go_to_market.timeline ? <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{marketResearch.go_to_market.timeline}</div> : null}
                      </div>
                    </SectionCard>
                  ) : null}
                </div>

                {Array.isArray(marketResearch.risks) && marketResearch.risks.length ? (
                  <SectionCard title="Risks &amp; Barriers">
                    <div className="space-y-2">
                      {marketResearch.risks.map((r, i) => (
                        <div key={i} className="rounded-xl border border-slate-100 bg-white p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900">{r.risk}</span>
                            {r.severity ? <span className="rounded-full px-2 py-0.5 text-xs font-semibold ring-1 bg-slate-100 text-slate-600 ring-slate-200">{r.severity}</span> : null}
                          </div>
                          {r.mitigation ? <div className="mt-1 text-slate-600">{r.mitigation}</div> : null}
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                ) : null}

                {Array.isArray(marketResearch.next_actions) && marketResearch.next_actions.length ? (
                  <SectionCard title="Next Best Actions">
                    <div className="space-y-3">
                      {marketResearch.next_actions.map((action, i) => (
                        <div key={i} className="flex gap-3">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                            {action.step ?? i + 1}
                          </div>
                          <div className="flex-1 text-sm">
                            <div className="font-semibold text-slate-900">{action.action}</div>
                            {action.why ? <div className="mt-0.5 text-slate-600">{action.why}</div> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                ) : null}
              </>
            ) : (
              <SectionCard title="No Research Yet">
                <div className="text-sm text-slate-600">
                  Complete a stage in the builder to start accumulating market research here.
                </div>
              </SectionCard>
            )}
          </div>
        ) : contentTab === "history" && !isCreateWorkspace ? (
          <SectionCard
            title="Validation history"
            subtitle="Track previous validations and their current status."
          >
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { key: "all", label: "All" },
                  { key: "pending", label: "Pending" },
                  { key: "accepted", label: "Accepted" },
                  { key: "rejected", label: "Rejected" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setHistoryFilter(item.key)}
                    className={
                      "rounded-2xl border p-4 text-left transition " +
                      (historyFilter === item.key
                        ? "border-brand-300 bg-brand-50 text-brand-900"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")
                    }
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</div>
                    <div className="mt-2 text-2xl font-semibold">{historyCounts[item.key]}</div>
                  </button>
                ))}
              </div>

              {filteredValidationHistory.length ? (
                filteredValidationHistory.map((entry) => {
                  const badgeClass =
                    entry.status === "accepted"
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                      : entry.status === "rejected"
                        ? "bg-rose-50 text-rose-700 ring-rose-200"
                        : "bg-amber-50 text-amber-700 ring-amber-200";
                  return (
                    <div key={entry.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-slate-900">{entry.title}</div>
                          <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ${badgeClass}`}>
                            {String(entry.status || "pending").toUpperCase()}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">
                            {entry.type === "service_validation" ? "Service" : "Business"}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {new Date(entry.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="secondary" onClick={() => editHistoryEntry(entry)}>
                          {entry.status === "accepted" || entry.status === "rejected" ? "Go to dashboard" : "Modify"}
                        </Button>
                        <Button variant="ghost" onClick={() => deleteHistoryEntry(entry.id)}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                  {validationHistory.length
                    ? "No items match this filter yet."
                    : "No validation history yet. Run a validation and it will appear here."}
                </div>
              )}
            </div>
          </SectionCard>
        ) : mode === "select" && !isCreateWorkspace ? (
          <>
            {!fromOtherModule ? (
              <SectionCard
                title="What are you validating?"
                subtitle="Choose the option that best matches your idea."
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {canEvaluateIdea && (
                  <button
                    type="button"
                    onClick={() => selectPathway("business_idea")}
                    className={
                      "rounded-2xl border p-4 text-left transition " +
                      (form.pathway === "business_idea" ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white hover:bg-slate-50")
                    }
                  >
                    <div className="text-sm font-semibold text-slate-900">Business idea</div>
                    <div className="mt-1 text-xs text-slate-600">A service, marketplace, or company concept you want to start.</div>
                  </button>
                  )}
                  <button
                    type="button"
                    onClick={() => selectPathway("product_service_idea")}
                    className={
                      "rounded-2xl border p-4 text-left transition " +
                      (form.pathway === "product_service_idea" ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white hover:bg-slate-50")
                    }
                  >
                    <div className="text-sm font-semibold text-slate-900">Product / service idea</div>
                    <div className="mt-1 text-xs text-slate-600">A product or offering you want to build or add.</div>
                  </button>
                </div>
              </SectionCard>
            ) : null}

            <div className="mt-4">
              {isBusinessStageFlow || isServiceStageFlow ? (
                <SectionCard
                  title="Validation stages"
                  subtitle="You’ll complete the validation one stage at a time."
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {formBlocks.map((b, index) => (
                      <div key={b.key} className="rounded-2xl border border-slate-200 bg-white p-4 text-left">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                            {index + 1}
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{b.label}</div>
                            <div className="mt-1 text-xs text-slate-600">{b.desc}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              ) : (
                <SectionCard
                  title={fromOtherModule ? "Select sections to build your workspace" : "Choose the sections you want to fill"}
                  subtitle={fromOtherModule ? "You'll fill them in any order." : "You'll fill them in any order."}
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {formBlocks.map((b) => {
                      const checked = Boolean(enabledForms[b.key]);
                      return (
                        <button
                          key={b.key}
                          type="button"
                          onClick={() => setEnabledForms((prev) => ({ ...prev, [b.key]: !checked }))}
                          className={
                            "flex items-start justify-between gap-3 rounded-2xl border p-4 text-left transition " +
                            (checked ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white hover:bg-slate-50")
                          }
                        >
                          <div>
                            <div className={"text-sm font-semibold " + (checked ? "text-brand-900" : "text-slate-900")}>{b.label}</div>
                            <div className="mt-1 text-xs text-slate-600">{b.desc}</div>
                          </div>
                          <div className="pt-1">
                            <div
                              className={
                                "h-5 w-5 rounded-full ring-2 ring-offset-2 " +
                                (checked ? "bg-brand-600 ring-brand-200 ring-offset-white" : "bg-white ring-slate-200 ring-offset-white")
                              }
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </SectionCard>
              )}
            </div>
          </>
        ) : (
          <SectionCard
            title={fromOtherModule ? "Workspace inputs" : "Validation inputs"}
            subtitle={
              isBusinessStageFlow
                ? currentBusinessStageMeta?.label || ""
                : isServiceStageFlow
                  ? currentServiceStageMeta?.label || ""
                  : (fromOtherModule ? "Open any section and fill it in any order." : "Open any section and fill it in any order.")
            }
          >
            <div className="space-y-3">
              {enabledForms.business && !isProductPath && (!isBusinessStageFlow || currentBusinessStageKey === "business") ? (
                <details className="rounded-2xl border border-slate-200 bg-white p-4" open>
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                    {isProductPath ? "Product details" : "Business details"}
                  </summary>
                  <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <div className="md:col-span-2 xl:col-span-3">
                      <FieldLabel
                        info={
                          isProductPath
                            ? "Name of your product or service idea (used as the workspace label)."
                            : "Name of your business idea (used as the workspace label)."
                        }
                      >
                        {isProductPath ? "Product idea name" : "Business idea name"}
                      </FieldLabel>
                      <Input value={workspaceName} disabled={Boolean(editingWorkspaceId)} onChange={(e) => { setWorkspaceNameTouched(true); setWorkspaceName(e.target.value); }} />
                    </div>
                      <div className="md:col-span-2 xl:col-span-3">
                      <FieldLabel info="The name you want to validate. This is required.">
                        {isProductPath ? "Product / service name *" : "Business name *"}
                      </FieldLabel>
                      <Input value={form.context.business_name} onChange={(e) => update("context.business_name", e.target.value)} />
                    </div>
                      <div className="md:col-span-2 xl:col-span-3">
                      <FieldLabel info="Brief description of the product or service you are offering.">
                        {isProductPath ? "Product / service offering *" : "Business offering *"}
                      </FieldLabel>
                      {isProductPath && workspaceServices.length ? (
                        <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-2">
                          <select
                            className="ea-input"
                            value={serviceSelection}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              setServiceSelection(nextValue);
                              if (!nextValue) return;
                              if (nextValue === "__other__") {
                                update("offer.service_type", "");
                                return;
                              }
                              const svc = workspaceServices.find((s) => s.service_name === nextValue);
                              if (svc) {
                                update("offer.service_type", svc.service_name);
                                if (!form.problem.problem_type && svc.service_description) {
                                  update("problem.problem_type", svc.service_description);
                                }
                              }
                            }}
                          >
                            <option value="">Select from workspace services</option>
                            {workspaceServices.map((svc) => (
                              <option key={svc.service_name} value={svc.service_name}>
                                {svc.service_name}
                              </option>
                            ))}
                            <option value="__other__">Other (type new)</option>
                          </select>
                          <Input
                            value={form.offer.service_type}
                            onChange={(e) => {
                              setServiceSelection("__other__");
                              update("offer.service_type", e.target.value);
                            }}
                            placeholder="Describe your product or service"
                          />
                        </div>
                      ) : (
                        <Input value={form.offer.service_type} onChange={(e) => update("offer.service_type", e.target.value)} />
                      )}
                    </div>
                    <div>
                      <FieldLabel info="Choose the closest category.">
                        {isProductPath ? "Product category" : "Business type"}
                      </FieldLabel>
                      <select value={form.context.business_type_category} onChange={(e) => update("context.business_type_category", e.target.value)} className="ea-input">
                        {BUSINESS_TYPE_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                      </select>
                      {form.context.business_type_category === "Other" ? <div className="mt-2"><Input value={form.context.business_type_other} onChange={(e) => update("context.business_type_other", e.target.value)} placeholder="Type business type" /></div> : null}
                    </div>
                    <div>
                      <FieldLabel info="Choose the primary industry you operate in.">
                        {isProductPath ? "Target industry" : "Primary industry"}
                      </FieldLabel>
                      <select value={form.context.primary_industry_category} onChange={(e) => update("context.primary_industry_category", e.target.value)} className="ea-input">
                        {PRIMARY_INDUSTRY_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                      </select>
                      {form.context.primary_industry_category === "Other" ? <div className="mt-2"><Input value={form.context.primary_industry_other} onChange={(e) => update("context.primary_industry_other", e.target.value)} placeholder="Type primary industry" /></div> : null}
                    </div>
                    <div>
                      <FieldLabel info="Where you'll operate (city/country).">Location</FieldLabel>
                      <Input value={form.context.location} onChange={(e) => update("context.location", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel info="Currency used across the validation.">Currency</FieldLabel>
                      <select value={form.context.currency} onChange={(e) => update("context.currency", e.target.value)} className="ea-input">
                        {CURRENCY_CODES.map((c) => (<option key={c} value={c}>{currencyLabel(c)}</option>))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel info="Your weekly availability.">Founder hours / week</FieldLabel>
                      <NumberInput placeholder="40" value={form.context.founder_hours_per_week} onChange={(v) => update("context.founder_hours_per_week", v)} />
                    </div>
                    {isBusinessStageFlow ? (
                      <>
                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel info="Who you're selling to.">Customer segment</FieldLabel>
                          <select value={form.problem.customer_segment_category} onChange={(e) => update("problem.customer_segment_category", e.target.value)} className="ea-input">
                            {CUSTOMER_SEGMENT_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                          </select>
                          {form.problem.customer_segment_category === "Other" ? <div className="mt-2"><Input value={form.problem.customer_segment_other} onChange={(e) => update("problem.customer_segment_other", e.target.value)} placeholder="Type customer segment" /></div> : null}
                        </div>

                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel info="Short problem statement.">Problem (short)</FieldLabel>
                          <Input value={form.problem.problem_type} onChange={(e) => update("problem.problem_type", e.target.value)} />
                        </div>

                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel info="How often does this problem occur?">Frequency</FieldLabel>
                          <select
                            value={form.problem.frequency_category || ""}
                            onChange={(e) => updateFrequency(e.target.value)}
                            className="ea-input"
                          >
                            <option value="">Select frequency</option>
                            {FREQUENCY_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {formatEnumLabel(option)}
                              </option>
                            ))}
                          </select>
                          {form.problem.frequency_category === "custom" ? (
                            <div className="mt-2">
                              <Input
                                value={form.problem.frequency_custom || ""}
                                onChange={(e) => updateCustomFrequency(e.target.value)}
                                placeholder="Type custom frequency"
                              />
                            </div>
                          ) : null}
                        </div>

                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel info="What alternatives do customers use today?">Alternatives</FieldLabel>
                          <Input value={form.problem.alternatives} onChange={(e) => update("problem.alternatives", e.target.value)} />
                        </div>
                      </>
                    ) : null}
                  </div>
                </details>
              ) : null}

              {enabledForms.workspace_profile ? (
                <details className="rounded-2xl border border-slate-200 bg-white p-4" open>
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                    Workspace profile
                  </summary>
                  <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div className="md:col-span-2 xl:col-span-3">
                      <FieldLabel info="Legal or trading name.">Company name *</FieldLabel>
                      <Input value={profile.company_name} onChange={(e) => updateProfile("company_name", e.target.value)} />
                    </div>
                    <div className="md:col-span-2 xl:col-span-3">
                      <FieldLabel info="This logo becomes the workspace logo and is reused in documents where needed.">
                        Workspace logo
                      </FieldLabel>
                      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                              {profile.logo_data_url ? (
                                <img src={profile.logo_data_url} alt="Workspace logo preview" className="h-full w-full object-contain" />
                              ) : (
                                <span className="text-xs font-semibold text-slate-400">No logo</span>
                              )}
                            </div>
                            <div className="space-y-1">
                              <div className="text-sm font-semibold text-slate-900">Brand your workspace once</div>
                              <div className="text-sm text-slate-600">
                                Upload a PNG, JPG, or SVG logo to use across your workspace and generated documents.
                              </div>
                              <div className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                                Used in workspace profile, blueprints, and financial documents
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="inline-flex cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                              Upload logo
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  void handleProfileLogoChange(file);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            {profile.logo_data_url ? (
                              <Button variant="ghost" onClick={clearProfileLogo}>
                                Remove
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <FieldLabel>Legal name</FieldLabel>
                      <Input value={profile.legal_name} onChange={(e) => updateProfile("legal_name", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Registration number</FieldLabel>
                      <Input value={profile.registration_number} onChange={(e) => updateProfile("registration_number", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Business type *</FieldLabel>
                      <select value={profile.business_type} onChange={(e) => updateProfile("business_type", e.target.value)} className="ea-input">
                        {PROFILE_BUSINESS_TYPES.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>Primary industry *</FieldLabel>
                      <select value={profile.primary_industry} onChange={(e) => updateProfile("primary_industry", e.target.value)} className="ea-input">
                        {PROFILE_INDUSTRIES.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                      </select>
                    </div>
                    <div className="md:col-span-2 xl:col-span-3">
                      <FieldLabel info="Short overview of what you do.">About company *</FieldLabel>
                      <textarea value={profile.about_company} onChange={(e) => updateProfile("about_company", e.target.value)} className="min-h-20 ea-input" />
                    </div>
                    <div className="md:col-span-2 xl:col-span-3">
                      <FieldLabel>Tagline</FieldLabel>
                      <Input value={profile.tagline} onChange={(e) => updateProfile("tagline", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Year established</FieldLabel>
                      <Input type="number" value={profile.year_established} onChange={(e) => updateProfile("year_established", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Company size</FieldLabel>
                      <select value={profile.company_size} onChange={(e) => updateProfile("company_size", e.target.value)} className="ea-input">
                        {PROFILE_COMPANY_SIZES.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                      </select>
                    </div>

                    <div className="md:col-span-2 xl:col-span-3">
                      <FieldLabel info="Add your services. At least one is required.">Services *</FieldLabel>
                      <div className="space-y-2">
                        {profile.services.map((svc, idx) => (
                          <div key={idx} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-3">
                            <Input
                              value={svc.service_name}
                              onChange={(e) => {
                                const next = structuredClone(profile.services);
                                next[idx].service_name = e.target.value;
                                updateProfile("services", next);
                              }}
                              placeholder="Service name"
                            />
                            <select
                              value={svc.service_category}
                              onChange={(e) => {
                                const next = structuredClone(profile.services);
                                next[idx].service_category = e.target.value;
                                updateProfile("services", next);
                              }}
                              className="ea-input"
                            >
                              {PROFILE_INDUSTRIES.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                            </select>
                            <Input
                              value={svc.service_description}
                              onChange={(e) => {
                                const next = structuredClone(profile.services);
                                next[idx].service_description = e.target.value;
                                updateProfile("services", next);
                              }}
                              placeholder="Service description"
                            />
                            <div className="md:col-span-3 flex justify-end">
                              <Button
                                variant="ghost"
                                disabled={profile.services.length <= 1}
                                onClick={() => {
                                  const next = profile.services.filter((_, i) => i !== idx);
                                  updateProfile("services", next);
                                }}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        ))}
                        <Button
                          variant="secondary"
                          onClick={() => updateProfile("services", [...profile.services, { service_name: "", service_category: "consulting", service_description: "" }])}
                        >
                          Add service
                        </Button>
                      </div>
                    </div>

                    <div>
                      <FieldLabel>Vision</FieldLabel>
                      <Input value={profile.vision} onChange={(e) => updateProfile("vision", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Mission</FieldLabel>
                      <Input value={profile.mission} onChange={(e) => updateProfile("mission", e.target.value)} />
                    </div>
                    <div className="md:col-span-2 xl:col-span-3">
                      <FieldLabel>Core values (comma separated)</FieldLabel>
                      <Input value={profile.core_values} onChange={(e) => updateProfile("core_values", e.target.value)} />
                    </div>

                    <div>
                      <FieldLabel>Country *</FieldLabel>
                      <Input value={profile.country} onChange={(e) => updateProfile("country", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>City *</FieldLabel>
                      <Input value={profile.city} onChange={(e) => updateProfile("city", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>State / Region</FieldLabel>
                      <Input value={profile.state_or_region} onChange={(e) => updateProfile("state_or_region", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Postcode</FieldLabel>
                      <Input value={profile.postcode} onChange={(e) => updateProfile("postcode", e.target.value)} />
                    </div>
                    <div className="md:col-span-2 xl:col-span-3">
                      <FieldLabel>Address line 1</FieldLabel>
                      <Input value={profile.address_line_1} onChange={(e) => updateProfile("address_line_1", e.target.value)} />
                    </div>
                    <div className="md:col-span-2 xl:col-span-3">
                      <FieldLabel>Address line 2</FieldLabel>
                      <Input value={profile.address_line_2} onChange={(e) => updateProfile("address_line_2", e.target.value)} />
                    </div>

                    <div>
                      <FieldLabel>Email *</FieldLabel>
                      <Input value={profile.email} onChange={(e) => updateProfile("email", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Phone</FieldLabel>
                      <Input value={profile.phone_number} onChange={(e) => updateProfile("phone_number", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Website</FieldLabel>
                      <Input value={profile.website} onChange={(e) => updateProfile("website", e.target.value)} />
                    </div>

                    <div>
                      <FieldLabel>LinkedIn</FieldLabel>
                      <Input value={profile.linkedin_url} onChange={(e) => updateProfile("linkedin_url", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Twitter</FieldLabel>
                      <Input value={profile.twitter_url} onChange={(e) => updateProfile("twitter_url", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Instagram</FieldLabel>
                      <Input value={profile.instagram_url} onChange={(e) => updateProfile("instagram_url", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Facebook</FieldLabel>
                      <Input value={profile.facebook_url} onChange={(e) => updateProfile("facebook_url", e.target.value)} />
                    </div>

                    <div>
                      <FieldLabel>Monthly revenue range</FieldLabel>
                      <select value={profile.monthly_revenue_range} onChange={(e) => updateProfile("monthly_revenue_range", e.target.value)} className="ea-input">
                        <option value="">Select</option>
                        {PROFILE_MONTHLY_REVENUE.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>Employee count</FieldLabel>
                      <Input type="number" value={profile.employee_count} onChange={(e) => updateProfile("employee_count", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Operating stage *</FieldLabel>
                      <select value={profile.operating_stage} onChange={(e) => updateProfile("operating_stage", e.target.value)} className="ea-input">
                        {PROFILE_OPERATING_STAGE.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>Delivery model *</FieldLabel>
                      <select value={profile.delivery_model} onChange={(e) => updateProfile("delivery_model", e.target.value)} className="ea-input">
                        {PROFILE_DELIVERY_MODEL.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>Target customer type</FieldLabel>
                      <select value={profile.target_customer_type} onChange={(e) => updateProfile("target_customer_type", e.target.value)} className="ea-input">
                        <option value="">Select</option>
                        {PROFILE_TARGET_CUSTOMER.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>Primary revenue model</FieldLabel>
                      <select value={profile.primary_revenue_model} onChange={(e) => updateProfile("primary_revenue_model", e.target.value)} className="ea-input">
                        <option value="">Select</option>
                        {PROFILE_REVENUE_MODEL.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                      </select>
                    </div>
                    <div className="md:col-span-2 xl:col-span-3">
                      <FieldLabel>Key offering focus</FieldLabel>
                      <Input value={profile.key_offering_focus} onChange={(e) => updateProfile("key_offering_focus", e.target.value)} />
                    </div>
                  </div>
                </details>
              ) : null}

              {isProductPath && (enabledForms.service_basics || enabledForms.revenue_inputs || enabledForms.direct_costs || enabledForms.fixed_costs || enabledForms.capacity_inputs || enabledForms.demand_inputs || enabledForms.competition) ? (
                <>
                  {enabledForms.service_basics && (!isServiceStageFlow || currentServiceStageKey === "service_basics") ? (
                    <details className="rounded-2xl border border-slate-200 bg-white p-4" open>
                      <summary className="cursor-pointer text-sm font-semibold text-slate-900">Service basics</summary>
                      <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel info="Name of the service idea you want to validate.">Service name *</FieldLabel>
                          {combinedServiceOptions.length ? (
                            <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-2">
                              <select
                                className="ea-input"
                                value={serviceSelection}
                                onChange={(e) => {
                                  const nextValue = e.target.value;
                                  setServiceSelection(nextValue);
                                  if (!nextValue) return;
                                  if (nextValue === "__other__") return;

                                  const historyEntry = savedServiceIdeas.find(
                                    (entry) =>
                                      String(entry?.service_name || entry?.payload?.service_name || "").trim() === nextValue
                                  );
                                  if (historyEntry?.payload) {
                                    setServiceForm((prev) => ({ ...prev, ...historyEntry.payload }));
                                    return;
                                  }

                                  const svc = workspaceServices.find((s) => s.service_name === nextValue);
                                  if (svc) {
                                    updateService("service_name", svc.service_name);
                                    if (!serviceForm.service_description && svc.service_description) {
                                      updateService("service_description", svc.service_description);
                                    }
                                    if (svc.service_category) updateService("service_category", svc.service_category);
                                    return;
                                  }

                                  updateService("service_name", nextValue);
                                }}
                              >
                                <option value="">Select from saved services</option>
                                {combinedServiceOptions.map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                                <option value="__other__">Other (type new)</option>
                              </select>
                              <Input
                                value={serviceForm.service_name}
                                onChange={(e) => {
                                  setServiceSelection("__other__");
                                  updateService("service_name", e.target.value);
                                }}
                                placeholder="Type service name"
                              />
                            </div>
                          ) : (
                            <Input value={serviceForm.service_name} onChange={(e) => updateService("service_name", e.target.value)} />
                          )}
                        </div>
                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel info="Short description of what the service delivers.">Service description *</FieldLabel>
                          <textarea
                            className="min-h-20 ea-input"
                            value={serviceForm.service_description}
                            onChange={(e) => updateService("service_description", e.target.value)}
                          />
                        </div>
                        <div>
                          <FieldLabel info="Choose the closest category.">Service category *</FieldLabel>
                          <select value={serviceForm.service_category} onChange={(e) => updateService("service_category", e.target.value)} className="ea-input">
                            {SERVICE_CATEGORY_OPTIONS.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                          </select>
                        </div>
                        <div>
                          <FieldLabel info="Who this service is for.">Target customer type *</FieldLabel>
                          <select value={serviceForm.target_customer_type} onChange={(e) => updateService("target_customer_type", e.target.value)} className="ea-input">
                            {TARGET_CUSTOMER_OPTIONS.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                          </select>
                        </div>
                        <div>
                          <FieldLabel info="Geographic reach for the service.">Target market scope *</FieldLabel>
                          <select value={serviceForm.target_market_scope} onChange={(e) => updateService("target_market_scope", e.target.value)} className="ea-input">
                            {TARGET_MARKET_SCOPE_OPTIONS.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                          </select>
                        </div>
                      </div>
                    </details>
                  ) : null}

                    {enabledForms.revenue_inputs && (!isServiceStageFlow || currentServiceStageKey === "revenue_inputs") ? (
                      <details className="rounded-2xl border border-slate-200 bg-white p-4" open>
                        <summary className="cursor-pointer text-sm font-semibold text-slate-900">Revenue inputs</summary>
                        <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2">
                          <div>
                            <FieldLabel info="Price charged per sale.">Price per sale *</FieldLabel>
                            <NumberInput placeholder="0" value={serviceForm.price_per_sale} onChange={(v) => updateService("price_per_sale", v)} />
                          </div>
                        <div>
                          <FieldLabel info="Expected sales volume per month.">Expected sales per month *</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.expected_sales_per_month} onChange={(v) => updateService("expected_sales_per_month", v)} />
                        </div>
                      </div>
                    </details>
                  ) : null}

                  {enabledForms.direct_costs && (!isServiceStageFlow || currentServiceStageKey === "direct_costs") ? (
                    <details className="rounded-2xl border border-slate-200 bg-white p-4">
                      <summary className="cursor-pointer text-sm font-semibold text-slate-900">Direct delivery costs</summary>
                      <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div>
                          <FieldLabel info="Labour cost to deliver one sale.">Direct labour cost per sale *</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.direct_labour_cost_per_sale} onChange={(v) => updateService("direct_labour_cost_per_sale", v)} />
                        </div>
                        <div>
                          <FieldLabel info="Contractor cost to deliver one sale.">Contractor cost per sale</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.contractor_cost_per_sale} onChange={(v) => updateService("contractor_cost_per_sale", v)} />
                        </div>
                        <div>
                          <FieldLabel info="Materials or tools cost per sale.">Materials/tools cost per sale</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.materials_cost_per_sale} onChange={(v) => updateService("materials_cost_per_sale", v)} />
                        </div>
                        <div>
                          <FieldLabel info="Travel cost per sale.">Travel cost per sale</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.travel_cost_per_sale} onChange={(v) => updateService("travel_cost_per_sale", v)} />
                        </div>
                        <div>
                          <FieldLabel info="Any other direct cost per sale.">Other direct cost per sale</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.other_direct_cost_per_sale} onChange={(v) => updateService("other_direct_cost_per_sale", v)} />
                        </div>
                      </div>
                    </details>
                  ) : null}

                  {enabledForms.fixed_costs && (!isServiceStageFlow || currentServiceStageKey === "fixed_costs") ? (
                    <details className="rounded-2xl border border-slate-200 bg-white p-4">
                      <summary className="cursor-pointer text-sm font-semibold text-slate-900">Fixed monthly costs</summary>
                      <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div>
                          <FieldLabel info="Recurring software costs per month.">Monthly software cost *</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.monthly_software_cost} onChange={(v) => updateService("monthly_software_cost", v)} />
                        </div>
                        <div>
                          <FieldLabel info="Recurring marketing costs per month.">Monthly marketing cost *</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.monthly_marketing_cost} onChange={(v) => updateService("monthly_marketing_cost", v)} />
                        </div>
                        <div>
                          <FieldLabel info="Recurring admin costs per month.">Monthly admin cost *</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.monthly_admin_cost} onChange={(v) => updateService("monthly_admin_cost", v)} />
                        </div>
                        <div>
                          <FieldLabel info="Rent or workspace costs per month.">Monthly rent/workspace cost</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.monthly_rent_cost} onChange={(v) => updateService("monthly_rent_cost", v)} />
                        </div>
                        <div>
                          <FieldLabel info="Any other fixed monthly cost.">Other fixed cost</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.monthly_other_fixed_cost} onChange={(v) => updateService("monthly_other_fixed_cost", v)} />
                        </div>
                      </div>
                    </details>
                  ) : null}

                    {enabledForms.capacity_inputs && (!isServiceStageFlow || currentServiceStageKey === "capacity_inputs") ? (
                      <details className="rounded-2xl border border-slate-200 bg-white p-4">
                        <summary className="cursor-pointer text-sm font-semibold text-slate-900">Capacity inputs</summary>
                        <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2">
                          <div>
                            <FieldLabel info="Hours required to deliver one sale.">Hours required *</FieldLabel>
                            <NumberInput placeholder="0" value={serviceForm.hours_required_per_sale} onChange={(v) => updateService("hours_required_per_sale", v)} />
                          </div>
                          <div>
                          <div className="flex items-center justify-between gap-2">
                            <FieldLabel info="Total delivery hours available per month. Suggested = expected sales per month × hours required.">
                              Available delivery hours per month *
                            </FieldLabel>
                            {suggestedDeliveryHours ? (
                              <button
                                type="button"
                                onClick={() => updateService("available_delivery_hours_per_month", String(suggestedDeliveryHours))}
                                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                              >
                                Use {suggestedDeliveryHours}
                              </button>
                            ) : null}
                          </div>
                         <NumberInput placeholder={suggestedDeliveryHours ? String(suggestedDeliveryHours) : "0"} value={serviceForm.available_delivery_hours_per_month} onChange={(v) => updateService("available_delivery_hours_per_month", v)} />
                          {workforceStatus ? (
                            <div className="mt-1 text-[11px] text-slate-500">
                              {workforceStatus.message} (Suggested: {suggestedDeliveryHours} hours/month.)
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </details>
                  ) : null}

                  {enabledForms.demand_inputs && (!isServiceStageFlow || currentServiceStageKey === "demand_inputs") ? (
                    <details className="rounded-2xl border border-slate-200 bg-white p-4">
                      <summary className="cursor-pointer text-sm font-semibold text-slate-900">Demand evidence</summary>
                      <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div>
                          <FieldLabel info="Strength of demand evidence.">Demand evidence type *</FieldLabel>
                          <select value={serviceForm.demand_evidence_type} onChange={(e) => updateService("demand_evidence_type", e.target.value)} className="ea-input">
                            {DEMAND_EVIDENCE_OPTIONS.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                          </select>
                        </div>
                        <div>
                          <FieldLabel info="Number of interested leads.">Interested leads</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.number_of_interested_leads} onChange={(v) => updateService("number_of_interested_leads", v)} />
                        </div>
                        <div>
                          <FieldLabel info="Number of paying customers.">Paying customers</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.number_of_paying_customers} onChange={(v) => updateService("number_of_paying_customers", v)} />
                        </div>
                      </div>
                    </details>
                  ) : null}

                  {enabledForms.competition && (!isServiceStageFlow || currentServiceStageKey === "competition") ? (
                    <details className="rounded-2xl border border-slate-200 bg-white p-4">
                      <summary className="cursor-pointer text-sm font-semibold text-slate-900">Competitive positioning</summary>
                      <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div>
                          <FieldLabel info="Lowest competitor price you see.">Competitor price (low)</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.competitor_price_low} onChange={(v) => updateService("competitor_price_low", v)} />
                        </div>
                        <div>
                          <FieldLabel info="Highest competitor price you see.">Competitor price (high)</FieldLabel>
                          <NumberInput placeholder="0" value={serviceForm.competitor_price_high} onChange={(v) => updateService("competitor_price_high", v)} />
                        </div>
                        <div>
                          <FieldLabel info="How differentiated your offer is.">Differentiation level *</FieldLabel>
                          <select value={serviceForm.differentiation_level} onChange={(e) => updateService("differentiation_level", e.target.value)} className="ea-input">
                            {DIFFERENTIATION_OPTIONS.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                          </select>
                        </div>
                      </div>
                    </details>
                  ) : null}
                </>
              ) : null}

              {enabledForms.offer_demand && (!isBusinessStageFlow || currentBusinessStageKey === "offer_demand") ? (
                <details className="rounded-2xl border border-slate-200 bg-white p-4" open>
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">Offer & demand</summary>
                  <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {!isBusinessStageFlow ? (
                      <>
                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel info="Who you're selling to.">Customer segment</FieldLabel>
                          <select value={form.problem.customer_segment_category} onChange={(e) => update("problem.customer_segment_category", e.target.value)} className="ea-input">
                            {CUSTOMER_SEGMENT_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                          </select>
                          {form.problem.customer_segment_category === "Other" ? <div className="mt-2"><Input value={form.problem.customer_segment_other} onChange={(e) => update("problem.customer_segment_other", e.target.value)} placeholder="Type customer segment" /></div> : null}
                        </div>

                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel info="Short problem statement.">Problem (short)</FieldLabel>
                          <Input value={form.problem.problem_type} onChange={(e) => update("problem.problem_type", e.target.value)} />
                        </div>

                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel info="How often does this problem occur?">Frequency</FieldLabel>
                          <select
                            value={form.problem.frequency_category || ""}
                            onChange={(e) => updateFrequency(e.target.value)}
                            className="ea-input"
                          >
                            <option value="">Select frequency</option>
                            {FREQUENCY_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {formatEnumLabel(option)}
                              </option>
                            ))}
                          </select>
                          {form.problem.frequency_category === "custom" ? (
                            <div className="mt-2">
                              <Input
                                value={form.problem.frequency_custom || ""}
                                onChange={(e) => updateCustomFrequency(e.target.value)}
                                placeholder="Type custom frequency"
                              />
                            </div>
                          ) : null}
                        </div>

                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel info="What alternatives do customers use today?">Alternatives</FieldLabel>
                          <Input value={form.problem.alternatives} onChange={(e) => update("problem.alternatives", e.target.value)} />
                        </div>
                      </>
                    ) : null}

                    <div>
                      <FieldLabel info="How you charge customers.">Pricing model</FieldLabel>
                      <select value={form.offer.pricing_model} onChange={(e) => update("offer.pricing_model", e.target.value)} className="ea-input">
                        {PRICING_MODEL_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                      </select>
                    </div>

                    <div>
                      <FieldLabel info="The unit you deliver (for pricing and capacity).">Deliverable unit</FieldLabel>
                      <select value={form.offer.deliverable_unit_category} onChange={(e) => update("offer.deliverable_unit_category", e.target.value)} className="ea-input">
                        {DELIVERABLE_UNIT_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                      </select>
                      {form.offer.deliverable_unit_category === "Other" ? <div className="mt-2"><Input value={form.offer.deliverable_unit_other} onChange={(e) => update("offer.deliverable_unit_other", e.target.value)} placeholder="Type deliverable unit" /></div> : null}
                    </div>

                    <div>
                      <FieldLabel info="Price per deliverable unit.">Price per unit</FieldLabel>
                      <NumberInput placeholder="0" value={form.offer.price_per_unit} onChange={(v) => update("offer.price_per_unit", v)} />
                    </div>

                    <div>
                      <FieldLabel info="Expected sales volume (units).">Units / month</FieldLabel>
                      <NumberInput placeholder="0" value={form.demand.expected_units_per_month} onChange={(v) => update("demand.expected_units_per_month", v)} />
                    </div>

                    <div>
                      <FieldLabel info="Expected number of customers (optional).">Customers</FieldLabel>
                      <NumberInput placeholder="0" value={form.demand.expected_customers} onChange={(v) => update("demand.expected_customers", v)} />
                    </div>

                    <div>
                      <FieldLabel info="Days from lead to closed sale (optional).">Sales cycle (days)</FieldLabel>
                      <NumberInput placeholder="30" value={form.demand.sales_cycle_days} onChange={(v) => update("demand.sales_cycle_days", v)} />
                    </div>

                    <div>
                      <FieldLabel info="Days until cash is received after sale.">Payment terms (days)</FieldLabel>
                      <NumberInput placeholder="14" value={form.demand.payment_terms_days} onChange={(v) => update("demand.payment_terms_days", v)} />
                    </div>
                  </div>
                </details>
              ) : null}

              {enabledForms.costs && (!isBusinessStageFlow || currentBusinessStageKey === "costs") ? (
                <details className="rounded-2xl border border-slate-200 bg-white p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">Costs</summary>
                  <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <FieldLabel info="Variable cost to deliver one unit.">Variable cost / unit</FieldLabel>
                      <NumberInput placeholder="0" value={form.costs.variable_cost_per_unit} onChange={(v) => update("costs.variable_cost_per_unit", v)} />
                    </div>
                    <div>
                      <FieldLabel info="Fixed monthly operating costs.">Fixed costs / month</FieldLabel>
                      <NumberInput placeholder="0" value={form.costs.fixed_costs_monthly} onChange={(v) => update("costs.fixed_costs_monthly", v)} />
                    </div>
                    <div>
                      <FieldLabel info="Optional: how much you pay yourself each month.">Founder draw / month</FieldLabel>
                      <NumberInput placeholder="0" value={form.costs.founder_draw_monthly} onChange={(v) => update("costs.founder_draw_monthly", v)} />
                    </div>
                    <div>
                      <FieldLabel info="Optional: contractor or freelancer costs per month.">Contractors / month</FieldLabel>
                      <NumberInput placeholder="0" value={form.costs.contractor_costs_monthly} onChange={(v) => update("costs.contractor_costs_monthly", v)} />
                    </div>
                  </div>
                </details>
              ) : null}

              {enabledForms.capacity_cash && (!isBusinessStageFlow || currentBusinessStageKey === "capacity_cash") ? (
                <details className="rounded-2xl border border-slate-200 bg-white p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">Capacity & cash</summary>
                  <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <FieldLabel info="How many people are delivering the work.">Team size</FieldLabel>
                      <NumberInput placeholder="1" value={form.capacity.team_size} onChange={(v) => update("capacity.team_size", v)} />
                    </div>
                    <div>
                      <FieldLabel info="How many units one person can deliver per month.">
                        Capacity units per person per month
                      </FieldLabel>
                        <NumberInput
                          placeholder={recommendedCapacityPerPerson ? String(recommendedCapacityPerPerson) : "0"}
                          value={form.capacity.capacity_units_per_person_per_month}
                          onChange={(v) => update("capacity.capacity_units_per_person_per_month", v)}
                        />
                        {recommendedCapacityPerPerson || capacityRecommendation ? (
                          <div className="mt-2 text-xs text-slate-500">
                            {recommendedCapacityPerPerson ? `Recommended: ${recommendedCapacityPerPerson} units per person.` : ""}
                            {recommendedCapacityPerPerson && capacityRecommendation ? " " : ""}
                            {capacityRecommendation || ""}
                          </div>
                        ) : null}
                    </div>
                    <div>
                      <FieldLabel info="Cash available before profitability.">Starting cash</FieldLabel>
                      <NumberInput placeholder="0" value={form.cash.starting_cash} onChange={(v) => update("cash.starting_cash", v)} />
                    </div>
                    <div>
                      <FieldLabel info="One-time costs before revenue starts.">Upfront costs</FieldLabel>
                      <NumberInput placeholder="0" value={form.cash.upfront_costs} onChange={(v) => update("cash.upfront_costs", v)} />
                    </div>
                  </div>
                </details>
              ) : null}

              {enabledForms.go_to_market && (!isBusinessStageFlow || currentBusinessStageKey === "go_to_market") ? (
                <details className="rounded-2xl border border-slate-200 bg-white p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">Go-to-market</summary>
                  <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <FieldLabel info="Who you are primarily selling to.">Target market</FieldLabel>
                      <select value={form.go_to_market.target_market} onChange={(e) => update("go_to_market.target_market", e.target.value)} className="ea-input">
                        {["B2C", "B2B", "B2G", "Marketplace", "Other"].map((o) => (<option key={o} value={o}>{o}</option>))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel info="Typical customer spend level for your offer.">Customer budget level</FieldLabel>
                      <select value={form.go_to_market.customer_budget_level} onChange={(e) => update("go_to_market.customer_budget_level", e.target.value)} className="ea-input">
                        {["Unknown", "Low", "Mid", "High", "Enterprise"].map((o) => (<option key={o} value={o}>{o}</option>))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel info="Optional: a narrower niche inside your primary industry.">Sub-industry (optional)</FieldLabel>
                      <Input value={form.go_to_market.sub_industry} onChange={(e) => update("go_to_market.sub_industry", e.target.value)} />
                    </div>
                    <div className="md:col-span-2 xl:col-span-3">
                      <FieldLabel info="Select the channels you plan to use first.">Go-to-market channels</FieldLabel>
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                        {GTM_CHANNEL_OPTIONS.map((ch) => {
                          const selected = Array.isArray(form.go_to_market.channels) && form.go_to_market.channels.includes(ch);
                          return (
                            <button
                              key={ch}
                              type="button"
                              onClick={() => {
                                const cur = Array.isArray(form.go_to_market.channels) ? form.go_to_market.channels : [];
                                const next = selected ? cur.filter((x) => x !== ch) : [...cur, ch];
                                update("go_to_market.channels", next);
                              }}
                              className={"rounded-2xl border px-3 py-2 text-sm font-semibold transition " + (selected ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}
                            >
                              {ch}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </details>
              ) : null}
              {null}
            </div>
          </SectionCard>
        )}

        {contentTab === "builder" &&
        !(showBuilderMarketInsight &&
          (isBusinessStageFlow || isServiceStageFlow)) ? (
        <div className="sticky bottom-0 z-20 mt-4 py-3">
          <div className="flex items-center justify-center gap-3 pr-16 sm:pr-20">
            <div>
              {mode === "fill" && isBusinessStageFlow ? (
                <Button
                  variant="ghost"
                  disabled={!canEdit || currentBusinessStageIndex === 0}
                  onClick={goToPreviousBusinessStage}
                >
                  Back
                </Button>
              ) : mode === "fill" && isServiceStageFlow ? (
                <Button
                  variant="ghost"
                  disabled={!canEdit || currentServiceStageIndex === 0}
                  onClick={goToPreviousServiceStage}
                >
                  Back
                </Button>
              ) : mode === "fill" && !isCreateWorkspace ? (
                <Button variant="ghost" disabled={!canEdit} onClick={() => setMode("select")}>Change sections</Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {mode === "select" ? (
                <Button disabled={!canEdit || !selectedCount} onClick={startFilling}>Continue</Button>
              ) : (
                <div className="flex items-center gap-2">
                  {mode === "fill" && isBusinessStageFlow && !isLastBusinessStage ? (
                    <Button
                      disabled={isLoading || isPrefilling}
                      onClick={goToNextBusinessStage}
                    >
                      Get insights
                    </Button>
                  ) : mode === "fill" && isServiceStageFlow && !isLastServiceStage ? (
                    <Button
                      disabled={isLoading || isPrefilling}
                      onClick={goToNextServiceStage}
                    >
                      Get insights
                    </Button>
                  ) : mode === "fill" ? (
                    <Button
                      variant="secondary"
                      disabled={isLoading || isPrefilling || !canRun}
                      onClick={() =>
                        isCreateWorkspace
                          ? saveWorkspace(false)
                          : fromOtherModule && !storedWorkspaceId && !editingWorkspaceId
                            ? saveWorkspace(false)
                            : saveWorkspace(true)
                      }
                    >
                      {isLoading ? <Spinner size={16} /> : null}
                      {isLoading
                        ? "Running..."
                        : isCreateWorkspace
                          ? (storedWorkspaceId || editingWorkspaceId ? "Save workspace" : "Create workspace")
                          : fromOtherModule && !storedWorkspaceId && !editingWorkspaceId
                            ? "Create workspace"
                            : "Evaluate"}
                    </Button>
                  ) : (
                    <Button disabled={isLoading || isPrefilling || !canRun} onClick={() => saveWorkspace(false)}>
                      {isLoading ? <Spinner size={16} /> : null}
                      {isLoading ? "Saving..." : "Save workspace"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
          {error ? (
            <div className="mt-2">
              <InlineAlert kind="error" message={error} />
            </div>
          ) : null}
        </div>
        ) : null}
      </div>
    </div>
  );
}
