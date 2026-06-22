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
import ConfirmDialog from "../components/ConfirmDialog";
import { generateValidationInsightPdf } from "../lib/reports/index";
import ValidationLoadingOverlay from "../components/ValidationLoadingOverlay";

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

function FormSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={"overflow-hidden rounded-2xl border bg-white transition-colors " + (open ? "border-brand-200 shadow-sm" : "border-slate-200")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <svg
          className={"h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 " + (open ? "rotate-180" : "")}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? <div className="px-5 pb-5">{children}</div> : null}
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
    pathway: "",
    context: {
      business_name: defaults.business_name || "",
      business_type_category: defaults.business_type_category || "Technology",
      business_type_other: defaults.business_type_other || "",
      primary_industry_category: defaults.primary_industry_category || "IT",
      primary_industry_other: defaults.primary_industry_other || "",
      location: defaults.location || "",
      currency: defaults.currency || "GBP",
      founder_hours_per_week: "40",
      stage: "idea",
      description: "" // NEW: for the large textarea idea
    },
    problem: {
      customer_segment_category: defaults.customer_segment_category || "SMEs",
      customer_segment_other: defaults.customer_segment_other || "",
      problem_type: defaults.problem_type || "", // Map to "What problem?"
      severity: "Moderate", // NEW
      frequency: frequencyFields.frequency,
      frequency_category: frequencyFields.frequency_category,
      frequency_custom: frequencyFields.frequency_custom,
      alternatives: defaults.alternatives || ""
    },
    offer: {
      service_type: defaults.service_type || "", // Map to "How solve better?"
      pricing_model: "fixed_job",
      price_per_unit: "",
      deliverable_unit_category: "unit",
      deliverable_unit_other: ""
    },
    validation: {
      spoken_count: "No", // NEW
      demand_proof: [] // NEW: Checkboxes
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
  const [isValidating, setIsValidating] = useState(false);
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
  const [lastEvaluationId, setLastEvaluationId] = useState(null);
  const [showBuilderMarketInsight, setShowBuilderMarketInsight] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historyTypeFilter, setHistoryTypeFilter] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [historyRequestHandled, setHistoryRequestHandled] = useState(false);
  const [businessMarketResearch, setBusinessMarketResearch] = useState(null);
  const [businessResearchHash, setBusinessResearchHash] = useState(null);
  const [serviceMarketResearch, setServiceMarketResearch] = useState(null);
  const [serviceResearchHash, setServiceResearchHash] = useState(null);
  const [mrResearchTab, setMrResearchTab] = useState("business");
  const [mrLoading, setMrLoading] = useState(false);
  const [mrError, setMrError] = useState(null);
  const [insightPdfLoading, setInsightPdfLoading] = useState(false);
  const [lastResearchHash, setLastResearchHash] = useState(null);
  const [showAdvancedOffer, setShowAdvancedOffer] = useState(false);
  const initialStageDefaults = useMemo(() => loadValidationStageDefaults(), []);

  const [workspaceName, setWorkspaceName] = useState(() => String(loadValidationStageDefaults().workspace_name || "").trim());
  const [workspaceNameTouched, setWorkspaceNameTouched] = useState(false);

  const BUSINESS_TYPE_OPTIONS = useMemo(() => ["SaaS", "Service / Consulting", "E-commerce", "Agency", "Marketplace", "Physical Product", "Other"], []);
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
    customer_need_frequency: "Monthly", // NEW
    differentiator: "", // NEW
    demand_validation_proof: [], // NEW
    differentiation_level: "medium", // NEW
    estimated_price: "" // NEW
  }));
  const [serviceCurrency, setServiceCurrency] = useState("GBP");
  const serviceCurrencySymbol = useMemo(() => currencyLabel(serviceCurrency), [serviceCurrency]);
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
    const q = historySearch.trim().toLowerCase();
    return validationHistory.filter((entry) => {
      if (historyFilter !== "all" && entry.status !== historyFilter) return false;
      if (historyTypeFilter === "business" && entry.type !== "business_validation") return false;
      if (historyTypeFilter === "service" && entry.type !== "service_validation") return false;
      if (q && !String(entry.title || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [historyFilter, historyTypeFilter, historySearch, validationHistory]);
  const activeWorkspaceId = editingWorkspaceId || storedWorkspaceId;

  const isProductPath = form.pathway === "product_service_idea";
  const marketResearch = isProductPath ? serviceMarketResearch : businessMarketResearch;
  const tabMarketResearch = mrResearchTab === "service" ? serviceMarketResearch : businessMarketResearch;
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
      { key: "go_to_market", label: "Go to market", desc: "Target market and acquisition channels." }
    ];
  }, [isCreateWorkspace, isProductPath]);

  const [enabledForms, setEnabledForms] = useState(() =>
    isCreateWorkspace
      ? { workspace_profile: true }
      : isProductPath
        ? { workspace_profile: false } // Disabled redundant sections for product path
        : { business: true } // Removed redundant sections for business path
  );
  const selectedCount = useMemo(() => Object.values(enabledForms).filter(Boolean).length, [enabledForms]);
  const isBusinessStageFlow = mode === "fill" && !isCreateWorkspace && form.pathway === "business_idea";
  const isServiceStageFlow = mode === "fill" && !isCreateWorkspace && isProductPath;
  const isLastBusinessStage = true;
  const isLastServiceStage = true;
  const insightVisibility = useMemo(() => ({
    showSummary: true,
    showValidationResult: true,
    showMarketOpportunity: true,
    showTargetCustomer: true,
    showProblemValidation: true,
    showDemandSignals: true,
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
  }), []);

  const derivedWorkspaceName = useMemo(() => {
    if (isCreateWorkspace) {
      const pn = String(profile?.company_name || "").trim();
      return pn || "Workspace";
    }
    // For business idea / service paths, workspace name is set independently — do not derive from idea fields.
    return "";
  }, [isCreateWorkspace, profile?.company_name]);

  // Auto-derive B2B/B2C/B2G from the customer segment so we don't ask twice
  const derivedTargetMarket = useMemo(() => {
    const seg = String(form?.problem?.customer_segment_category || "").trim().toLowerCase();
    if (["freelancers", "households", "consumers"].includes(seg)) return "B2C";
    if (["smes", "startups", "enterprises", "smbs", "corporate"].includes(seg)) return "B2B";
    if (["government", "public sector"].includes(seg)) return "B2G";
    return null;
  }, [form?.problem?.customer_segment_category]);

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

  // Silently sync the derived target market whenever customer segment changes
  useEffect(() => {
    if (!derivedTargetMarket) return;
    if (form?.go_to_market?.target_market === derivedTargetMarket) return;
    update("go_to_market.target_market", derivedTargetMarket);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedTargetMarket]);

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
          differentiation_level: draft.differentiation_level ?? "medium",
          country: draft.country ?? ""
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
      setEnabledForms({ workspace_profile: false });
      return;
    }
    setEnabledForms((prev) => ({
      business: true,
      ...(prev.workspace_profile ? { workspace_profile: true } : {})
    }));
  }, [isCreateWorkspace, isProductPath]);


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
            setBusinessMarketResearch(ws.data.market_research);
          }
          if (ws?.data?.service_market_research && typeof ws.data.service_market_research === "object") {
            setServiceMarketResearch(ws.data.service_market_research);
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
          setBusinessMarketResearch(ws.data.market_research);
        }
        if (ws?.data?.service_market_research && typeof ws.data.service_market_research === "object") {
          setServiceMarketResearch(ws.data.service_market_research);
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
    setBusinessMarketResearch(null);
    setBusinessResearchHash(null);
    setServiceMarketResearch(null);
    setServiceResearchHash(null);
    setMrError(null);
    setForm((prev) => ({
      ...prev,
      pathway: value
    }));
  }

  function update(path, value) {
    setMrError(null);
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
    setMrError(null);
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

    // Prefer specific business/service idea names over generic workspace titles
    const payload = entry.payload || {};
    let title = "Validation";

    if (entry.type === "service_validation" || entry.service_name || payload.service_name) {
      title = entry.service_name || payload.service_name || entry.title || "Service Validation";
    } else {
      // For business validations, prefer business_name from entry (backend) or payload
      title = entry.business_name || payload.business_name || payload.context?.business_name || entry.title || "Business Validation";
    }

    return {
      id,
      type: String(entry.type || "validation"),
      title: String(title).trim(),
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
        ...entry,
        type: "service_validation",
        title: entry?.service_name || entry?.payload?.service_name || entry?.title || "Service validation",
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
    setError(null);
    try {
      const ws = await apiRequest(`/validation/${activeWorkspaceId}`, "GET");
      const data = ws?.data || {};
      setWorkspaceId(activeWorkspaceId);
      setWorkspaceNameStore(ws?.name || null);
      setWorkspaceName(ws?.name || "");
      setWorkspaceNameTouched(true);

      const isViewing = entry.status === "accepted" || entry.status === "rejected";

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
        setServiceDecisionStatus(entry.status || null);
        setDecisionStatus(null);
        setEditingHistoryEntry({
          id: entry.id,
          type: "service_validation",
          created_at: serviceEntry?.created_at || entry.created_at || new Date().toISOString(),
        });
        if (isViewing) {
          // Load the stored insight so the panel can show it immediately
          const mr = serviceEntry?.market_research || data.service_market_research || null;
          if (mr && typeof mr === "object") {
            setServiceMarketResearch(mr);
          }
        }
        await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
          data: {
            active_service_validation_id: entry.id,
            draft_service_idea: payload,
            ...(isViewing ? {} : { service_market_research: null }),
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
        setIdeaValidation(payload);
        setDecisionStatus(entry.status || null);
        setServiceDecisionStatus(null);
        setEditingHistoryEntry({
          id: entry.id,
          type: "business_validation",
          created_at: entry.created_at || new Date().toISOString(),
        });
        if (isViewing) {
          const mr = entry.market_research || data.market_research || null;
          if (mr && typeof mr === "object") {
            setBusinessMarketResearch(mr);
          }
        }
        await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
          data: {
            active_validation_id: entry.id,
            draft_idea_validation: payload,
            ...(isViewing ? {} : { market_research: null }),
          }
        });
      }

      setMrError(null);
      setContentTab("builder");
      setMode("fill");

      if (isViewing) {
        // Viewing mode — clear research cache to force fresh pull if needed, then navigate to report
        setBusinessMarketResearch(null);
        setBusinessResearchHash(null);
        setServiceMarketResearch(null);
        setServiceResearchHash(null);
        navigate("/results");
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this validation history item.");
    }
  }

  async function updateHistoryEntryStatus(entryId, status) {
    if (!activeWorkspaceId) return;
    setError(null);
    try {
      const ws = await apiRequest(`/validation/${activeWorkspaceId}`, "GET");
      const data = ws?.data || {};
      const vHistory = Array.isArray(data.validation_history) ? data.validation_history : [];
      const sHistory = Array.isArray(data.service_validation_history) ? data.service_validation_history : [];
      const now = new Date().toISOString();

      const nextVHistory = vHistory.map((e) =>
        e?.id === entryId ? { ...e, status, decided_at: now } : e
      );
      const nextSHistory = sHistory.map((e) =>
        e?.id === entryId ? { ...e, decision_status: status, decided_at: now } : e
      );

      await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
        data: {
          validation_history: nextVHistory,
          service_validation_history: nextSHistory,
          ...(status === "accepted" ? { active_validation_id: entryId } : {}),
        }
      });

      setValidationHistory((prev) =>
        prev.map((e) => e.id === entryId ? { ...e, status } : e)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update validation status.");
    }
  }

  function deleteHistoryEntry(entryId) {
    if (!activeWorkspaceId) return;
    setConfirmDialog({
      message: "Delete this validation history item? This cannot be undone.",
      onConfirm: async () => {
        setConfirmDialog(null);
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
      },
      onCancel: () => setConfirmDialog(null),
    });
  }

  function bulkDeleteEntries(ids) {
    if (!activeWorkspaceId || !ids.size) return;
    setConfirmDialog({
      message: `Delete ${ids.size} selected validation${ids.size > 1 ? "s" : ""}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        setError(null);
        try {
          const ws = await apiRequest(`/validation/${activeWorkspaceId}`, "GET");
          const existing = Array.isArray(ws?.data?.validation_history) ? ws.data.validation_history : [];
          const serviceExisting = Array.isArray(ws?.data?.service_validation_history) ? ws.data.service_validation_history : [];
          const nextHistory = existing.filter((item) => !ids.has(item?.id));
          const nextServiceHistory = serviceExisting.filter((item) => !ids.has(item?.id));
          await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
            data: { validation_history: nextHistory, service_validation_history: nextServiceHistory },
          });
          setValidationHistory(buildUnifiedValidationHistory({ validation_history: nextHistory, service_validation_history: nextServiceHistory }));
          setSavedServiceIdeas(nextServiceHistory);
          setBulkSelected(new Set());
          setSavedNotice(`${ids.size} validation${ids.size > 1 ? "s" : ""} deleted.`);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not delete selected items.");
        }
      },
      onCancel: () => setConfirmDialog(null),
    });
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
        String(serviceForm.service_name || "").trim().length >= 2,
        String(serviceForm.service_description || "").trim().length >= 5,
        String(serviceForm.target_customer_type || "").trim(),
        String(serviceForm.target_market_scope || "").trim(),
        // Use estimated_price and demand_validation_proof which are what's actually in the form
        parseNumber(serviceForm.estimated_price, 0) >= 0,
        parseNumber(serviceForm.expected_sales_per_month, 0) >= 0,
        // Remove hidden capacity requirements that are not in the form
        (serviceForm.demand_validation_proof || []).length > 0,
        String(serviceForm.differentiator || "").trim().length >= 5
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
    setMode("fill");
  }

  function updateFrequency(value) {
    const nextValue = String(value || "").trim().toLowerCase();
    setError(null);
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
    payload.validation ||= {};

    // Map simplified fields for backend/AI consumption
    payload.context.business_offering = payload.context.description || payload.context.business_offering;
    if (!payload.problem.problem_type && payload.problem.description) {
      payload.problem.problem_type = payload.problem.description;
    }
    // Append severity to problem context for better AI understanding
    if (payload.problem.severity) {
      payload.problem.problem_type = `${payload.problem.problem_type} [Severity: ${payload.problem.severity}]`;
    }
    // Map spoken_count and proof into a summary field if needed, or just send
    payload.demand_evidence = (payload.validation.demand_proof || []).join(", ");
    if (payload.validation.spoken_count && payload.validation.spoken_count !== "No") {
      payload.demand_evidence += ` (Spoken to ${payload.validation.spoken_count} users)`;
    }

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
    const DEMAND_EVIDENCE_LABELS = {
      assumption_only: "assumption only — no validated evidence yet",
      market_research: "secondary market research conducted",
      enquiries: "initial interest or enquiries received",
      LOIs: "letters of intent or signed commitments",
      paid_pilot: "paying customers or paid pilot completed",
    };
    const DIFFERENTIATION_LABELS = {
      low: "low — similar to existing alternatives",
      medium: "medium — some differentiation from competitors",
      high: "high — clearly differentiated from alternatives",
    };
    const raw = structuredClone(serviceForm);
    return {
      ...raw,
      currency: serviceCurrency || "GBP",
      demand_evidence_type:
        DEMAND_EVIDENCE_LABELS[raw.demand_evidence_type] || raw.demand_evidence_type || "",
      differentiation_level:
        DIFFERENTIATION_LABELS[raw.differentiation_level] || raw.differentiation_level || "",
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


  async function saveWorkspace(shouldEvaluate = false) {
    setIsLoading(true);
    if (shouldEvaluate) setIsValidating(true);
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
              differentiation_level: String(serviceForm?.differentiation_level || "").trim().toLowerCase(),
              country: String(serviceForm?.country || "").trim() || null
            };
            const result = await apiRequest(
              "/service-ideas/validate",
              "POST",
              payloadService,
              { timeoutMs: 120000 }
            );
            setValidation(result);
            setServiceDecisionStatus(null);

            let validationId = null;
            if (wsId) {
              const isEditingServiceHistory = editingHistoryEntry?.type === "service_validation";
              validationId = isEditingServiceHistory ? editingHistoryEntry.id : crypto.randomUUID();
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
            setLastEvaluationId(validationId);
            setSavedNotice("Validation complete. Redirecting to report...");
            if (marketResearch) setShowBuilderMarketInsight(true);

            // Redirect to results page after a short delay for the "Complete" feeling
            setTimeout(() => {
              navigate("/results");
            }, 800);
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
          let validationId = null;
          if (wsId) {
            const isEditingBusinessHistory = editingHistoryEntry?.type === "business_validation";
            validationId = isEditingBusinessHistory ? editingHistoryEntry.id : crypto.randomUUID();
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
                title: String(payload?.context?.business_name || "Business validation"),
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
              setValidationHistory(
                buildUnifiedValidationHistory({
                  validation_history: [nextEntry, ...nextHistoryBase],
                  service_validation_history: Array.isArray(ws?.data?.service_validation_history) ? ws.data.service_validation_history : [],
                })
              );
              setEditingHistoryEntry(null);
            } catch (historyErr) {
              console.warn("Failed to persist validation history:", historyErr);
            }
          }
          setLastEvaluationId(validationId);
          setSavedNotice("Validation complete. Redirecting to report...");
          if (marketResearch) setShowBuilderMarketInsight(true);

          // Redirect to results page after a short delay for the "Complete" feeling
          setTimeout(() => {
            navigate("/results");
          }, 800);
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
      setIsValidating(false);
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

    const payload = researchSource === "service" ? buildServiceIdeaPayloadForResearch() : buildBusinessIdeaPayloadForResearch();
    const currentHash = JSON.stringify(payload);
    const storedHash = researchSource === "service" ? serviceResearchHash : businessResearchHash;
    const cachedResearch = researchSource === "service" ? serviceMarketResearch : businessMarketResearch;

    // Return cached insights if form hasn't changed since last generation
    if (!forceRefresh && cachedResearch && storedHash === currentHash) {
      if (markStageOneReady) setStageOneResearchReady(true);
      return;
    }

    setMrLoading(true);
    setMrError(null);
    setError(null);
    try {
      const wsId = editingWorkspaceId || storedWorkspaceId;
      const body = wsId
        ? { workspace_id: wsId, idea_validation: payload }
        : { idea_validation: payload };
      const result = await apiRequest("/validation/market-research", "POST", body, { timeoutMs: 120000 });
      if (researchSource === "service") {
        setServiceMarketResearch(result);
        setServiceResearchHash(currentHash);
      } else {
        setBusinessMarketResearch(result);
        setBusinessResearchHash(currentHash);
      }
      if (markStageOneReady) setStageOneResearchReady(true);
      // Persist insights to workspace so they survive page refreshes
      try {
        const dataKey = researchSource === "service" ? "service_market_research" : "market_research";
        await apiRequest("/validation/me", "PATCH", { data: { [dataKey]: result } });
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
    <div className=" EA_Wizard_Root min-h-screen bg-slate-50 dark:bg-slate-950 font-inter">
      <ValidationLoadingOverlay isVisible={isValidating} />
      <div className="EA_Wizard_Container max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
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
              {mode === "fill" ? (
                <button
                  type="button"
                  onClick={() => setMode("select")}
                  className="group flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 transition-all hover:bg-slate-50 hover:text-brand-600"
                >
                  <svg className="h-4 w-4 transition-transform group-hover:-translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M19 12H5m7 7l-7-7 7-7" />
                  </svg>
                  Back to pathways
                </button>
              ) : (
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
              )}
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

          {contentTab === "market_research" && !isCreateWorkspace ? (
            <div className="space-y-4">
              <SectionCard
                title="Market research"
                subtitle="Full research report accumulated from your validation inputs."
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {(businessMarketResearch || serviceMarketResearch) ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setMrResearchTab("business")}
                        className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${mrResearchTab === "business" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                      >
                        Business idea
                      </button>
                      <button
                        onClick={() => setMrResearchTab("service")}
                        className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${mrResearchTab === "service" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                      >
                        Service / product
                      </button>
                    </div>
                  ) : <div />}
                  {tabMarketResearch ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={insightPdfLoading}
                      onClick={async () => {
                        setInsightPdfLoading(true);
                        try {
                          await generateValidationInsightPdf({
                            data: tabMarketResearch,
                            title: `${mrResearchTab === "service" ? "Service / Product" : "Business Idea"} Market Research Report`,
                            businessName: workspaceName || form?.context?.business_name || serviceForm?.service_name || "Business",
                            type: mrResearchTab,
                          });
                        } catch {
                          // silent
                        } finally {
                          setInsightPdfLoading(false);
                        }
                      }}
                    >
                      {insightPdfLoading ? <Spinner size={14} /> : (
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                        </svg>
                      )}
                      {insightPdfLoading ? "Generating..." : "Download report"}
                    </Button>
                  ) : null}
                </div>
                {mrError ? <InlineAlert kind="error" message={mrError} /> : null}
              </SectionCard>

              {mrLoading ? (
                <SectionCard title="Updating Market Research">
                  <div className="flex items-center gap-3 text-sm text-slate-600">
                    <Spinner size={20} />
                    Updating the accumulated market research... This may take up to 30 seconds.
                  </div>
                </SectionCard>
              ) : tabMarketResearch ? (
                <>
                  {tabMarketResearch.idea_validation_result || tabMarketResearch.executive_summary ? (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                      {tabMarketResearch.executive_summary ? (
                        <SectionCard title="Executive Summary" subtitle="Plain-English verdict on whether this idea is worth pursuing.">
                          <div className="text-sm leading-6 text-slate-700">{tabMarketResearch.executive_summary}</div>
                        </SectionCard>
                      ) : null}

                      {tabMarketResearch.idea_validation_result ? (
                        <SectionCard title="Idea Validation Result" subtitle="The latest combined recommendation from the research gathered so far.">
                          <div className="space-y-3 text-sm">
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded-xl bg-slate-50 p-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overall Score</div>
                                <div className="mt-1 text-base font-semibold text-slate-900">{tabMarketResearch.idea_validation_result.overall_score || "Fair"}</div>
                              </div>
                              <div className="rounded-xl bg-slate-50 p-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended Action</div>
                                <div className="mt-1 text-base font-semibold text-slate-900">{tabMarketResearch.idea_validation_result.recommended_action || "Research more"}</div>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs">
                              {tabMarketResearch.idea_validation_result.market_demand ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Market demand: {tabMarketResearch.idea_validation_result.market_demand}</span> : null}
                              {tabMarketResearch.idea_validation_result.competition_level ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Competition: {tabMarketResearch.idea_validation_result.competition_level}</span> : null}
                              {tabMarketResearch.idea_validation_result.pricing_opportunity ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Pricing: {tabMarketResearch.idea_validation_result.pricing_opportunity}</span> : null}
                              {tabMarketResearch.idea_validation_result.execution_risk ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Execution risk: {tabMarketResearch.idea_validation_result.execution_risk}</span> : null}
                            </div>
                          </div>
                        </SectionCard>
                      ) : null}
                    </div>
                  ) : null}

                  {tabMarketResearch.viability_score ? (() => {
                    const vs = tabMarketResearch.viability_score;
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

                  {tabMarketResearch.market_opportunity ? (
                    <SectionCard title="Market Opportunity">
                      <div className="mb-3 text-sm text-slate-700">{tabMarketResearch.market_opportunity.summary}</div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Market Size</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">{tabMarketResearch.market_opportunity.market_size || "-"}</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Growth Rate</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">{tabMarketResearch.market_opportunity.growth_rate || "-"}</div>
                        </div>
                        {Array.isArray(tabMarketResearch.market_opportunity.key_trends) && tabMarketResearch.market_opportunity.key_trends.length ? (
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Key Trends</div>
                            <ul className="list-disc list-inside space-y-0.5 text-xs text-slate-700">
                              {tabMarketResearch.market_opportunity.key_trends.map((t, i) => <li key={i}>{t}</li>)}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </SectionCard>
                  ) : null}

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {tabMarketResearch.target_customer ? (
                      <SectionCard title="Target Customer">
                        <div className="space-y-2 text-sm">
                          {tabMarketResearch.target_customer.profile ? <div><span className="font-semibold text-slate-700">Profile: </span>{tabMarketResearch.target_customer.profile}</div> : null}
                          {Array.isArray(tabMarketResearch.target_customer.pain_points) && tabMarketResearch.target_customer.pain_points.length ? (
                            <div>
                              <div className="font-semibold text-slate-700 mb-1">Pain Points</div>
                              <ul className="list-disc list-inside space-y-0.5 text-slate-600">
                                {tabMarketResearch.target_customer.pain_points.map((p, i) => <li key={i}>{p}</li>)}
                              </ul>
                            </div>
                          ) : null}
                          {tabMarketResearch.target_customer.buying_behaviour ? <div><span className="font-semibold text-slate-700">Buying behaviour: </span>{tabMarketResearch.target_customer.buying_behaviour}</div> : null}
                          {tabMarketResearch.target_customer.urgency ? <div><span className="font-semibold text-slate-700">Urgency: </span>{tabMarketResearch.target_customer.urgency}</div> : null}
                          {tabMarketResearch.target_customer.willingness_to_pay ? <div><span className="font-semibold text-slate-700">Willingness to pay: </span>{tabMarketResearch.target_customer.willingness_to_pay}</div> : null}
                        </div>
                      </SectionCard>
                    ) : null}

                    {tabMarketResearch.problem_validation ? (
                      <SectionCard title="Problem Validation">
                        <div className="space-y-2 text-sm">
                          {tabMarketResearch.problem_validation.frequency_assessment ? <div className="text-slate-600">{tabMarketResearch.problem_validation.frequency_assessment}</div> : null}
                          {tabMarketResearch.problem_validation.severity ? <div><span className="font-semibold text-slate-700">Severity: </span>{tabMarketResearch.problem_validation.severity}</div> : null}
                          {Array.isArray(tabMarketResearch.problem_validation.evidence) && tabMarketResearch.problem_validation.evidence.length ? (
                            <ul className="list-disc list-inside space-y-0.5 text-slate-600">
                              {tabMarketResearch.problem_validation.evidence.map((e, i) => <li key={i}>{e}</li>)}
                            </ul>
                          ) : null}
                        </div>
                      </SectionCard>
                    ) : null}
                  </div>

                  {tabMarketResearch.demand_signals ? (
                    <SectionCard title="Demand Signals">
                      {Array.isArray(tabMarketResearch.demand_signals.signals) && tabMarketResearch.demand_signals.signals.length ? (
                        <ul className="list-disc list-inside space-y-1 text-sm text-slate-600">
                          {tabMarketResearch.demand_signals.signals.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      ) : null}
                      {tabMarketResearch.demand_signals.online_discussion ? (
                        <div className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{tabMarketResearch.demand_signals.online_discussion}</div>
                      ) : null}
                    </SectionCard>
                  ) : null}

                  {Array.isArray(tabMarketResearch.competitor_matrix) && tabMarketResearch.competitor_matrix.length ? (
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
                            {tabMarketResearch.competitor_matrix.map((comp, i) => (
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
                    {tabMarketResearch.pricing_strategy ? (
                      <SectionCard title="Pricing Strategy">
                        <div className="space-y-2 text-sm">
                          {tabMarketResearch.pricing_strategy.recommended_model ? <div><span className="font-semibold text-slate-700">Recommended model: </span>{tabMarketResearch.pricing_strategy.recommended_model}</div> : null}
                          {tabMarketResearch.pricing_strategy.rationale ? <div className="text-slate-600">{tabMarketResearch.pricing_strategy.rationale}</div> : null}
                          {tabMarketResearch.pricing_strategy.launch_offer ? <div className="rounded-xl bg-brand-50 p-3 text-brand-900 text-xs font-medium">Launch offer: {tabMarketResearch.pricing_strategy.launch_offer}</div> : null}
                        </div>
                      </SectionCard>
                    ) : null}

                    {tabMarketResearch.recommended_price_range ? (
                      <SectionCard title="Recommended Price Range">
                        <div className="grid grid-cols-3 gap-2 text-center">
                          {[["low", "Entry"], ["mid", "Mid"], ["premium", "Premium"]].map(([key, label]) => (
                            <div key={key} className="rounded-xl bg-slate-50 p-3">
                              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
                              <div className="mt-1 text-sm font-bold text-slate-900">{tabMarketResearch.recommended_price_range[key] ?? "-"}</div>
                            </div>
                          ))}
                        </div>
                      </SectionCard>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {tabMarketResearch.positioning ? (
                      <SectionCard title="Positioning Recommendation">
                        <div className="space-y-2 text-sm">
                          {tabMarketResearch.positioning.headline_message ? <div className="rounded-xl bg-brand-50 p-3 text-sm font-semibold text-brand-900">&ldquo;{tabMarketResearch.positioning.headline_message}&rdquo;</div> : null}
                          {tabMarketResearch.positioning.value_proposition ? <div><span className="font-semibold text-slate-700">Value prop: </span>{tabMarketResearch.positioning.value_proposition}</div> : null}
                          {tabMarketResearch.positioning.differentiation ? <div><span className="font-semibold text-slate-700">Differentiation: </span>{tabMarketResearch.positioning.differentiation}</div> : null}
                        </div>
                      </SectionCard>
                    ) : null}

                    {tabMarketResearch.go_to_market ? (
                      <SectionCard title="Go to Market Recommendation">
                        <div className="space-y-2 text-sm">
                          {Array.isArray(tabMarketResearch.go_to_market.primary_channels) && tabMarketResearch.go_to_market.primary_channels.length ? (
                            <div><span className="font-semibold text-slate-700">Primary channels: </span>{tabMarketResearch.go_to_market.primary_channels.join(", ")}</div>
                          ) : null}
                          {tabMarketResearch.go_to_market.timeline ? <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{tabMarketResearch.go_to_market.timeline}</div> : null}
                        </div>
                      </SectionCard>
                    ) : null}
                  </div>

                  {Array.isArray(tabMarketResearch.risks) && tabMarketResearch.risks.length ? (
                    <SectionCard title="Risks &amp; Barriers">
                      <div className="space-y-2">
                        {tabMarketResearch.risks.map((r, i) => (
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

                  {Array.isArray(tabMarketResearch.next_actions) && tabMarketResearch.next_actions.length ? (
                    <SectionCard title="Next Best Actions">
                      <div className="space-y-3">
                        {tabMarketResearch.next_actions.map((action, i) => (
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
                    {mrResearchTab === "service"
                      ? "Complete a stage in the product/service builder to generate research here."
                      : "Complete a stage in the business idea builder to generate research here."}
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
                {/* Stat filter cards */}
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
                      onClick={() => { setHistoryFilter(item.key); setBulkSelected(new Set()); }}
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

                {/* Search + type filter */}
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="Search by name..."
                    value={historySearch}
                    onChange={(e) => { setHistorySearch(e.target.value); setBulkSelected(new Set()); }}
                    className="flex-1 min-w-[160px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                  <select
                    value={historyTypeFilter}
                    onChange={(e) => { setHistoryTypeFilter(e.target.value); setBulkSelected(new Set()); }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  >
                    <option value="all">All types</option>
                    <option value="business">Business</option>
                    <option value="service">Service</option>
                  </select>
                </div>

                {/* Bulk action bar */}
                {bulkSelected.size > 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={bulkSelected.size === filteredValidationHistory.length && filteredValidationHistory.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setBulkSelected(new Set(filteredValidationHistory.map((h) => h.id)));
                          } else {
                            setBulkSelected(new Set());
                          }
                        }}
                        className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                      />
                      <span className="text-sm font-semibold text-brand-800">
                        {bulkSelected.size} selected
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setBulkSelected(new Set())}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="border-rose-300 text-rose-600 hover:bg-rose-50"
                        onClick={() => bulkDeleteEntries(bulkSelected)}
                      >
                        Delete selected
                      </Button>
                    </div>
                  </div>
                ) : filteredValidationHistory.length > 0 ? (
                  <div className="flex items-center gap-2 px-1">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={(e) => {
                        if (e.target.checked) setBulkSelected(new Set(filteredValidationHistory.map((h) => h.id)));
                      }}
                      className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                    />
                    <span className="text-xs text-slate-400">Select all</span>
                  </div>
                ) : null}

              </div>
            </SectionCard>
          ) : mode === "select" && !isCreateWorkspace ? (
            <>
              {!fromOtherModule ? (
                <div className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white shadow-lg md:p-8">
                  <div className="relative z-10 max-w-xl">
                    <h1 className="text-xl font-bold md:text-3xl leading-tight">Validate your vision</h1>
                    <p className="mt-2 text-xs font-medium text-brand-100 md:text-base opacity-90">
                      Turn your assumptions into a data-backed business case. Choose a pathway below to begin.
                    </p>
                  </div>
                  <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
                  <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-brand-400/20 blur-3xl" />
                </div>
              ) : null}

              {!fromOtherModule ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {canEvaluateIdea && (
                      <button
                        type="button"
                        onClick={() => selectPathway("business_idea")}
                        className={
                          "group relative flex flex-col items-start gap-3 overflow-hidden rounded-3xl border-2 p-5 text-left transition-all duration-300 " +
                          (form.pathway === "business_idea"
                            ? "border-brand-500 bg-brand-50/50 shadow-md ring-1 ring-brand-500"
                            : "border-slate-100 bg-white hover:border-brand-200 hover:shadow-lg")
                        }
                      >
                        <div className={"flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110 " + (form.pathway === "business_idea" ? "bg-brand-600 text-white" : "bg-slate-50 text-slate-500")}>
                          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12c.6.5 1 1.2 1.1 2h5.8c.1-.8.5-1.5 1.1-2A7 7 0 0 0 12 2Z" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={"text-base font-bold " + (form.pathway === "business_idea" ? "text-brand-900" : "text-slate-900")}>Business concept</div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-500">Validate the problem-solution fit and general viability of your idea.</p>
                        </div>
                        {form.pathway === "business_idea" ? (
                          <div className="absolute right-4 top-4">
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white">
                              <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </div>
                          </div>
                        ) : null}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => selectPathway("product_service_idea")}
                      className={
                        "group relative flex flex-col items-start gap-3 overflow-hidden rounded-3xl border-2 p-5 text-left transition-all duration-300 " +
                        (form.pathway === "product_service_idea"
                          ? "border-brand-500 bg-brand-50/50 shadow-md ring-1 ring-brand-500"
                          : "border-slate-100 bg-white hover:border-brand-200 hover:shadow-lg")
                      }
                    >
                      <div className={"flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110 " + (form.pathway === "product_service_idea" ? "bg-brand-600 text-white" : "bg-slate-50 text-slate-500")}>
                        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={"text-base font-bold " + (form.pathway === "product_service_idea" ? "text-brand-900" : "text-slate-900")}>Product / Service</div>
                        <p className="mt-1 text-xs leading-relaxed text-slate-500">Perform a deep-dive analysis of a specific offering and its competitive positioning.</p>
                      </div>
                      {form.pathway === "product_service_idea" ? (
                        <div className="absolute right-4 top-4">
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white">
                            <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        </div>
                      ) : null}
                    </button>
                  </div>

                  {form.pathway && (
                    <div className="flex justify-center pt-2">
                      <Button
                        size="lg"
                        onClick={() => setMode("fill")}
                        className="group min-w-[200px] shadow-lg shadow-brand-200"
                      >
                        Start Validation Wizard
                        <svg className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M5 12h14m-7-7l7 7-7 7" />
                        </svg>
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}

              {!fromOtherModule && (
                <div className="mt-12">
                  <SectionCard
                    title="Validation history"
                    subtitle="Resume or view your previous analysis items."
                    badge={filteredValidationHistory.length ? String(filteredValidationHistory.length) : null}
                  >
                    <div className="space-y-3">
                      {/* Reuse the history list JSX logic here, but move the actual definition to a separate fragment/variable to avoid duplication */}
                      {filteredValidationHistory.length ? (
                        filteredValidationHistory.map((entry) => {
                          const badgeClass =
                            entry.status === "accepted"
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                              : entry.status === "rejected"
                                ? "bg-rose-50 text-rose-700 ring-rose-200"
                                : "bg-amber-50 text-amber-700 ring-amber-200";
                          const isChecked = bulkSelected.has(entry.id);
                          return (
                            <div
                              key={entry.id}
                              onClick={() => editHistoryEntry(entry)}
                              className={`flex w-full cursor-pointer flex-wrap items-start justify-between gap-3 rounded-2xl border bg-white p-4 shadow-sm text-left transition hover:border-brand-300 hover:shadow-md ${isChecked ? "border-brand-300 bg-brand-50/40" : "border-slate-200"}`}
                            >
                              <div className="flex items-start gap-3 min-w-0 flex-1">
                                <div onClick={(e) => e.stopPropagation()} className="mt-0.5 shrink-0">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      const next = new Set(bulkSelected);
                                      if (e.target.checked) next.add(entry.id); else next.delete(entry.id);
                                      setBulkSelected(next);
                                    }}
                                    className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                                  />
                                </div>
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
                              </div>
                              <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <Button size="sm" variant="secondary" onClick={() => editHistoryEntry(entry)}>
                                  {entry.status === "accepted" || entry.status === "rejected" ? "View" : "Resume"}
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
                            ? "No items match this filter."
                            : "No validation history yet. Run a validation and it will appear here."}
                        </div>
                      )}
                    </div>
                  </SectionCard>
                </div>
              )}
            </>
          ) : (
            <SectionCard
              title={fromOtherModule ? "Workspace inputs" : "Validation inputs"}
              subtitle="Follow the sections below to validate your concept with real market data."
            >
              <div className="space-y-6">
                {!isCreateWorkspace && (
                  <button
                    type="button"
                    onClick={() => setMode("select")}
                    className="group flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-brand-600 transition-colors"
                    disabled={isLoading}
                  >
                    <svg className="h-4 w-4 transition-transform group-hover:-translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M19 12H5m7 7l-7-7 7-7" />
                    </svg>
                    Back to pathway selection
                  </button>
                )}

                <div className="space-y-3">
                  {isBusinessStageFlow ? (
                    <div className="space-y-8">
                      {/* Section 1 — The Idea */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 1 — The Idea</h3>
                        </div>
                        <div className="grid grid-cols-1 gap-6">
                          <div>
                            <FieldLabel info="What is your business idea? Describe it clearly.">1. What is your business idea?</FieldLabel>
                            <textarea
                              className="ea-input min-h-[120px] py-3 text-sm leading-relaxed"
                              placeholder="e.g. AI bookkeeping assistant for UK SMEs..."
                              value={form.context.description}
                              onChange={(e) => update("context.description", e.target.value)}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Section 2 — Problem */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 2 — Problem</h3>
                        </div>
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                          <div className="md:col-span-2">
                            <FieldLabel info="The core issue you are addressing.">2. What problem are you trying to solve?</FieldLabel>
                            <textarea
                              className="ea-input min-h-[100px] py-3 text-sm"
                              placeholder="Describe the pain point..."
                              value={form.problem.problem_type}
                              onChange={(e) => update("problem.problem_type", e.target.value)}
                            />
                          </div>
                          <div>
                            <FieldLabel info="Who is the primary audience for this?">3. Who experiences this problem?</FieldLabel>
                            <select className="ea-input" value={form.problem.customer_segment_category} onChange={(e) => update("problem.customer_segment_category", e.target.value)}>
                              {["Individuals", "Students", "Professionals", "SMEs", "Enterprises", "Government", "Other"].map(o => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <FieldLabel info="How severe is the impact on them?">4. How painful is this problem?</FieldLabel>
                            <select className="ea-input" value={form.problem.severity} onChange={(e) => update("problem.severity", e.target.value)}>
                              {["Mild", "Moderate", "Severe", "Critical"].map(o => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Section 3 — Existing Alternatives */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 3 — Existing Alternatives</h3>
                        </div>
                        <div>
                          <FieldLabel info="How do they manage today?">5. How do people solve this problem today?</FieldLabel>
                          <textarea
                            className="ea-input min-h-[100px] py-3 text-sm"
                            placeholder="e.g. Manual spreadsheets, hiring expensive consultants..."
                            value={form.problem.alternatives}
                            onChange={(e) => update("problem.alternatives", e.target.value)}
                          />
                        </div>
                      </div>

                      {/* Section 4 — Your Solution */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 4 — Your Solution</h3>
                        </div>
                        <div>
                          <FieldLabel info="Your unique edge or primary value.">6. How does your solution solve the problem better?</FieldLabel>
                          <textarea
                            className="ea-input min-h-[100px] py-3 text-sm"
                            placeholder="Describe your unique value or edge..."
                            value={form.offer.service_type}
                            onChange={(e) => update("offer.service_type", e.target.value)}
                          />
                        </div>
                      </div>

                      {/* Section 5 — Market */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 5 — Market</h3>
                        </div>
                        <div>
                          <FieldLabel info="Territory reach.">7. Where is your target market?</FieldLabel>
                          <select className="ea-input" value={form.context.location} onChange={(e) => update("context.location", e.target.value)}>
                            {["Local", "National", "Regional", "Global"].map(o => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 6 — Confidence</h3>
                        </div>
                        <div className="space-y-6">
                          <div>
                            <FieldLabel info="Direct user feedback.">8. Have you spoken to potential users?</FieldLabel>
                            <div className="flex flex-wrap gap-2">
                              {["No", "1–5", "6–20", "20+"].map((label) => (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() => update("validation.spoken_count", label)}
                                  className={"rounded-full px-5 py-2 text-sm font-semibold transition-all " + ((form.validation?.spoken_count || "No") === label ? "bg-brand-600 text-white shadow-md border-transparent" : "bg-white border-2 border-slate-100 text-slate-600 hover:border-brand-200")}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <FieldLabel info="Evidence of demand.">9. Do you have any proof people want this?</FieldLabel>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                              {["Waiting list", "Survey responses", "Pre-orders", "Existing customers", "Social media interest", "None yet"].map((item) => {
                                const isSelected = (form.validation.demand_proof || []).includes(item);
                                return (
                                  <button
                                    key={item}
                                    type="button"
                                    onClick={() => {
                                      const current = form.validation?.demand_proof || [];
                                      const next = item === "None yet" ? ["None yet"] : (isSelected ? current.filter(i => i !== item) : [...current.filter(i => i !== "None yet"), item]);
                                      update("validation.demand_proof", next);
                                    }}
                                    className={"flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition " + (isSelected ? "border-brand-500 bg-brand-50" : "border-slate-100 bg-white hover:border-slate-200")}
                                  >
                                    <div className={"h-5 w-5 rounded border-2 flex items-center justify-center transition " + (isSelected ? "bg-brand-600 border-brand-600 text-white" : "border-slate-300 bg-white")}>
                                      {isSelected && <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M20 6L9 17l-5-5" /></svg>}
                                    </div>
                                    <span className={"text-sm font-medium " + (isSelected ? "text-brand-900" : "text-slate-600")}>{item}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : isServiceStageFlow ? (
                    <div className="space-y-8">
                      {/* Section 1 */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 1 — The Concept</h3>
                        </div>
                        <div className="grid grid-cols-1 gap-6">
                          <div>
                            <FieldLabel info="Name of your service or product.">1. Product / Service Name</FieldLabel>
                            <Input placeholder="e.g. Premium Tech Support" value={serviceForm.service_name} onChange={(e) => updateService("service_name", e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel info="Concise mission.">2. Describe it in one sentence</FieldLabel>
                            <textarea
                              className="ea-input min-h-[80px] py-3 text-sm"
                              placeholder="e.g. On-demand technical consulting for growing creative agencies."
                              value={serviceForm.service_description}
                              onChange={(e) => updateService("service_description", e.target.value)}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Section 2 */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 2 — Problem & Audience</h3>
                        </div>
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                          <div className="md:col-span-2">
                            <FieldLabel info="Target customers.">3. Who is it for?</FieldLabel>
                            <Input placeholder="Describe your customers..." value={serviceForm.target_customer_type} onChange={(e) => updateService("target_customer_type", e.target.value)} />
                          </div>
                          <div className="md:col-span-2">
                            <FieldLabel info="The pain point.">4. What problem does it solve?</FieldLabel>
                            <textarea
                              className="ea-input min-h-[80px] py-3 text-sm"
                              placeholder="Describe the problem..."
                              value={serviceForm.problem_to_solve}
                              onChange={(e) => updateService("problem_to_solve", e.target.value)}
                            />
                          </div>
                          <div className="md:col-span-2">
                            <FieldLabel info="Usage frequency.">5. How often would customers need it?</FieldLabel>
                            <div className="flex flex-wrap gap-2">
                              {["Daily", "Weekly", "Monthly", "Occasionally"].map((label) => (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() => updateService("customer_need_frequency", label)}
                                  className={"rounded-full px-5 py-2 text-sm font-semibold transition-all " + (serviceForm.customer_need_frequency === label ? "bg-brand-600 text-white shadow-md border-transparent" : "bg-white border-2 border-slate-100 text-slate-600 hover:border-brand-200")}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Section 3 */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 3 — Alternatives</h3>
                        </div>
                        <div className="grid grid-cols-1 gap-6">
                          <div>
                            <FieldLabel info="Current habits.">6. What do customers currently use instead?</FieldLabel>
                            <textarea
                              className="ea-input min-h-[80px] py-3 text-sm"
                              placeholder="e.g. Existing manual habits, competitors, spreadsheets..."
                              value={serviceForm.competitors_alternatives}
                              onChange={(e) => updateService("competitors_alternatives", e.target.value)}
                            />
                          </div>
                          <div>
                            <FieldLabel info="Primary differentiator.">7. Why would they choose yours?</FieldLabel>
                            <textarea
                              className="ea-input min-h-[80px] py-3 text-sm"
                              placeholder="Lower cost, better quality, faster speed, etc."
                              value={serviceForm.differentiator}
                              onChange={(e) => updateService("differentiator", e.target.value)}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Section 4 */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 4 — Validation</h3>
                        </div>
                        <div className="space-y-6">
                          <div>
                            <FieldLabel info="Validated demand signals.">8. Have you validated demand?</FieldLabel>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                              {["Interviews", "Surveys", "Waitlist", "Sales", "Social engagement", "None"].map((item) => {
                                const isSelected = (serviceForm.demand_validation_proof || []).includes(item);
                                return (
                                  <button
                                    key={item}
                                    type="button"
                                    onClick={() => {
                                      const current = serviceForm.demand_validation_proof || [];
                                      const next = item === "None" ? ["None"] : (isSelected ? current.filter(i => i !== item) : [...current.filter(i => i !== "None"), item]);
                                      updateService("demand_validation_proof", next);
                                    }}
                                    className={"flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition " + (isSelected ? "border-brand-500 bg-brand-50" : "border-slate-100 bg-white hover:border-slate-200")}
                                  >
                                    <div className={"h-5 w-5 rounded border-2 flex items-center justify-center transition " + (isSelected ? "bg-brand-600 border-brand-600 text-white" : "border-slate-300 bg-white")}>
                                      {isSelected && <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M20 6L9 17l-5-5" /></svg>}
                                    </div>
                                    <span className={"text-sm font-medium " + (isSelected ? "text-brand-900" : "text-slate-600")}>{item}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div>
                            <FieldLabel info="Pricing strategy.">9. Estimated selling price (Optional)</FieldLabel>
                            <div className="relative max-w-[200px]">
                              <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                                {serviceCurrencySymbol}
                              </div>
                              <NumberInput
                                key={!!serviceForm.estimated_price}
                                className="pl-7 bg-white dark:bg-slate-900 border-slate-200"
                                placeholder="0.00"
                                value={serviceForm.estimated_price}
                                onChange={(v) => updateService("estimated_price", v)}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : !isCreateWorkspace ? (
                    <div className="space-y-3">
                      <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                        <div className="text-sm font-semibold text-slate-600">Please choose a validation path on the landing page.</div>
                        <button onClick={() => setMode("select")} className="mt-2 text-xs font-bold text-brand-600 hover:underline">Go back to selection</button>
                      </div>
                    </div>
                  ) : null}

                  {enabledForms.workspace_profile ? (
                    <FormSection title="Workspace profile" defaultOpen>
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
                    </FormSection>
                  ) : null}

                  {isProductPath && (enabledForms.service_basics || enabledForms.revenue_inputs || enabledForms.direct_costs || enabledForms.fixed_costs || enabledForms.capacity_inputs || enabledForms.demand_inputs || enabledForms.competition) ? (
                    <>
                      {enabledForms.service_basics ? (
                        <FormSection title="Service basics" defaultOpen>
                          <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div className="md:col-span-2 xl:col-span-4">
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
                            <div className="md:col-span-2 xl:col-span-4">
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
                            <div>
                              <FieldLabel info="Country where the service will be offered. Used to tailor market insights.">Country</FieldLabel>
                              <Input
                                value={serviceForm.country}
                                onChange={(e) => updateService("country", e.target.value)}
                                placeholder="e.g. United Kingdom"
                              />
                            </div>
                          </div>
                        </FormSection>
                      ) : null}

                      {enabledForms.revenue_inputs ? (
                        <FormSection title="Revenue inputs" defaultOpen>
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
                        </FormSection>
                      ) : null}

                      {enabledForms.direct_costs ? (
                        <FormSection title="Direct delivery costs">
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
                        </FormSection>
                      ) : null}

                      {enabledForms.fixed_costs ? (
                        <FormSection title="Fixed monthly costs">
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
                        </FormSection>
                      ) : null}

                      {enabledForms.capacity_inputs ? (
                        <FormSection title="Capacity inputs">
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
                        </FormSection>
                      ) : null}

                      {enabledForms.demand_inputs ? (
                        <FormSection title="Demand evidence">
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
                        </FormSection>
                      ) : null}

                      {enabledForms.competition ? (
                        <FormSection title="Competitive positioning">
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
                        </FormSection>
                      ) : null}
                    </>
                  ) : null}

                  {enabledForms.offer_demand ? (
                    <FormSection title="Offer & demand" defaultOpen>
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
                          <NumberInput
                            key={!!form.offer.price_per_unit}
                            placeholder={form.offer.price_per_unit ? "" : "0"}
                            className="pl-7 bg-white dark:bg-slate-900"
                            value={form.offer.price_per_unit}
                            onChange={(v) => update("offer.price_per_unit", v)}
                          />
                        </div>

                        <div>
                          <FieldLabel info="Expected sales volume (units).">Units / month</FieldLabel>
                          <NumberInput placeholder={form.demand.expected_units_per_month ? "" : "0"} value={form.demand.expected_units_per_month} onChange={(v) => update("demand.expected_units_per_month", v)} />
                        </div>

                        {/* Advanced optional inputs — collapsed by default to reduce form friction */}
                        <div className="md:col-span-2 xl:col-span-3">
                          <button
                            type="button"
                            onClick={() => setShowAdvancedOffer((v) => !v)}
                            className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700"
                          >
                            <svg
                              className={"h-3.5 w-3.5 shrink-0 transition-transform duration-200 " + (showAdvancedOffer ? "rotate-180" : "")}
                              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                            >
                              <path d="m6 9 6 6 6-6" />
                            </svg>
                            Advanced — optional
                            <span className="ml-0.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">3 fields</span>
                          </button>
                          {showAdvancedOffer && (
                            <div className="mt-3 grid grid-cols-1 items-start gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 md:grid-cols-3">
                              <div>
                                <FieldLabel info="Number of unique customers. Leave at 0 if each customer = 1 unit.">Customers (optional)</FieldLabel>
                                <NumberInput placeholder="0" value={form.demand.expected_customers} onChange={(v) => update("demand.expected_customers", v)} />
                              </div>
                              <div>
                                <FieldLabel info="Average days from initial contact to closed sale. Leave 0 if unknown.">Sales cycle (days)</FieldLabel>
                                <NumberInput placeholder="30" value={form.demand.sales_cycle_days} onChange={(v) => update("demand.sales_cycle_days", v)} />
                              </div>
                              <div>
                                <FieldLabel info="Days until cash arrives after invoicing. Affects cash-flow runway.">Payment terms (days)</FieldLabel>
                                <NumberInput placeholder="14" value={form.demand.payment_terms_days} onChange={(v) => update("demand.payment_terms_days", v)} />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </FormSection>
                  ) : null}

                  {enabledForms.costs ? (
                    <FormSection title="Costs">
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
                        {/* Founder hours relocated here from Stage 1 in guided stage flow */}
                        {isBusinessStageFlow ? (
                          <div className="md:col-span-2 xl:col-span-3">
                            <div className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-700 mb-2">
                              How many hours per week can you personally commit? This helps calculate your maximum output capacity.
                            </div>
                            <FieldLabel info="Your weekly capacity commitment — used to calculate maximum sustainable output.">Founder hours / week</FieldLabel>
                            <NumberInput placeholder="40" value={form.context.founder_hours_per_week} onChange={(v) => update("context.founder_hours_per_week", v)} />
                          </div>
                        ) : null}
                      </div>
                    </FormSection>
                  ) : null}

                  {enabledForms.capacity_cash ? (
                    <FormSection title="Capacity & cash">
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
                    </FormSection>
                  ) : null}

                  {enabledForms.go_to_market ? (
                    <FormSection title="Go to market">
                      <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div>
                          <FieldLabel info="Derived from your customer segment. Use the override if needed.">Target market</FieldLabel>
                          <div className="flex items-center gap-2">
                            {derivedTargetMarket ? (
                              <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-bold text-brand-800">
                                <svg className="h-3.5 w-3.5 text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                                {form.go_to_market.target_market || "—"}
                              </div>
                            ) : null}
                            <select
                              value={form.go_to_market.target_market}
                              onChange={(e) => update("go_to_market.target_market", e.target.value)}
                              className={"ea-input " + (derivedTargetMarket ? "text-xs text-slate-500" : "")}
                              title="Override auto-derived target market"
                            >
                              {["B2C", "B2B", "B2G", "Marketplace", "Other"].map((o) => (<option key={o} value={o}>{o}</option>))}
                            </select>
                          </div>
                          {derivedTargetMarket && (
                            <p className="mt-1 text-xs text-slate-400">
                              Auto-set from &ldquo;{form.problem.customer_segment_category}&rdquo; — override above if different
                            </p>
                          )}
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
                          <FieldLabel info="Select the channels you plan to use first.">Go to market channels</FieldLabel>
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
                    </FormSection>
                  ) : null}
                  {null}

                  {/* Navigation Footer — Moved from sticky position to end of scrollable area */}
                  {contentTab === "builder" && (
                    <div className="mt-12 pt-8 border-t border-slate-100 flex flex-col items-center gap-6">
                      <div className="flex w-full items-center justify-between gap-4">
                        <button
                          type="button"
                          onClick={() => setMode("select")}
                          className="text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors"
                          disabled={isLoading}
                        >
                          ← Go back
                        </button>

                        <div className="flex-1 max-w-md">
                          {lastEvaluationId ? (
                            <div className="flex w-full gap-2">
                              <Button
                                className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700 border-0"
                                disabled={isLoading}
                                onClick={async () => {
                                  await updateHistoryEntryStatus(lastEvaluationId, "accepted");
                                  setLastEvaluationId(null);
                                  setSavedNotice("Validation accepted.");
                                }}
                              >
                                Accept Validation
                              </Button>
                              <Button
                                className="flex-1 border-rose-200 text-rose-600 hover:bg-rose-50"
                                variant="secondary"
                                disabled={isLoading}
                                onClick={async () => {
                                  await updateHistoryEntryStatus(lastEvaluationId, "rejected");
                                  setLastEvaluationId(null);
                                  setSavedNotice("Validation rejected.");
                                }}
                              >
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <Button
                              className="w-full bg-slate-900 text-white hover:bg-slate-800 border-0 h-12 text-base font-bold shadow-xl shadow-slate-200"
                              disabled={isLoading || isPrefilling || !canRun}
                              onClick={() => saveWorkspace(isCreateWorkspace ? false : true)}
                            >
                              {isLoading ? null : <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 1 1-7.6-13.5 8.38 8.38 0 0 1 3.8.9" /><path d="M22 2L12 12" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>}
                              {isLoading ? (isCreateWorkspace ? "Creating Workspace..." : "Running Intelligence Engine...") : (isCreateWorkspace ? "Create Workspace" : "Run Validation Analysis")}
                            </Button>
                          )}
                        </div>
                      </div>

                      {error && (
                        <div className="w-full">
                          <InlineAlert kind="error" message={error} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>
          )}

        </div >
        {
          confirmDialog ? (
            <ConfirmDialog
              message={confirmDialog.message}
              confirmLabel="Delete"
              danger
              onConfirm={confirmDialog.onConfirm}
              onCancel={confirmDialog.onCancel}
            />
          ) : null
        }
      </div>
    </div>
  );
}
