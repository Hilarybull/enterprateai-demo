import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import Input from "../components/Input";
import SectionCard from "../components/SectionCard";
import Spinner from "../components/Spinner";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import InfoTip from "../components/InfoTip";
import NumberInput, { parseIntSafe, parseNumber } from "../components/NumberInput";
import { CURRENCY_CODES, currencyLabel } from "../lib/currencies";

function humanizeValidationError(e) {
  const msg = e instanceof Error ? e.message : String(e || "");
  if (msg === "NETWORK_ERROR") {
    const base = import.meta.env.VITE_API_URL ?? import.meta.env.REACT_APP_BACKEND_URL ?? "http://localhost:8000";
    return `Can't reach the server at ${base}. Start the backend and check your API URL.`;
  }
  if (msg === "TIMEOUT") return "The server is taking too long to respond. Check the backend logs and try again.";
  if (msg.startsWith("HTTP 401:")) return "Please sign in to continue.";
  if (msg.startsWith("HTTP 422:")) return "Please enter a business name or product / service name to continue.";
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

export default function ValidationWizardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editingWorkspaceId = searchParams.get("workspace_id");
  const fromOtherModule = searchParams.get("from") === "module";
  const isCreateWorkspace = fromOtherModule;
  const returnTo = searchParams.get("return");
  const storedWorkspaceId = useWorkspaceStore((s) => s.workspaceId);

  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceNameStore = useWorkspaceStore((s) => s.setWorkspaceName);
  const setDecisionStatus = useWorkspaceStore((s) => s.setDecisionStatus);
  const setInputs = useWorkspaceStore((s) => s.setInputs);
  const setIdeaValidation = useWorkspaceStore((s) => s.setIdeaValidation);
  const setValidation = useWorkspaceStore((s) => s.setValidation);
  const setCurrency = useWorkspaceStore((s) => s.setCurrency);

  const [mode, setMode] = useState(fromOtherModule ? "fill" : "select"); // select | fill
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isPrefilling, setIsPrefilling] = useState(false);
  const [savedNotice, setSavedNotice] = useState(null);
  const [existingCatalogue, setExistingCatalogue] = useState({ products: [], customers: [], vendors: [] });

  const [workspaceName, setWorkspaceName] = useState("");
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

  const [form, setForm] = useState(() => ({
    pathway: "business_idea",
    context: { business_name: "", business_type_category: "Technology", business_type_other: "", primary_industry_category: "IT", primary_industry_other: "", location: "", currency: "GBP", founder_hours_per_week: "40", stage: "idea" },
    problem: { customer_segment_category: "SMEs", customer_segment_other: "", problem_type: "", frequency: "", alternatives: "" },
    offer: { service_type: "", pricing_model: "fixed_job", price_per_unit: "", deliverable_unit_category: "unit", deliverable_unit_other: "" },
    demand: { expected_units_per_month: "", expected_customers: "", sales_cycle_days: "", payment_terms_days: "14" },
    costs: { variable_cost_per_unit: "", fixed_costs_monthly: "", founder_draw_monthly: "", contractor_costs_monthly: "" },
    capacity: { team_size: "1", capacity_units_per_person_per_month: "" },
    cash: { starting_cash: "", upfront_costs: "" },
    go_to_market: { target_market: "B2C", customer_budget_level: "Unknown", sub_industry: "", channels: [] }
  }));
  const [profile, setProfile] = useState(() => ({
    company_name: "",
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
    return [
      {
        key: "business",
        label: "Workspace details",
        desc: "Name, industry, currency, and context."
      },
      { key: "offer_demand", label: "Offer & demand", desc: "Offer, pricing, volume assumptions, and sales cycle." },
      { key: "costs", label: "Costs", desc: "Fixed and variable costs behind the model." },
      { key: "capacity_cash", label: "Capacity & cash", desc: "Capacity assumptions and starting cash/runway inputs." },
      { key: "go_to_market", label: "Go-to-market", desc: "Target market and acquisition channels." }
    ];
  }, [isCreateWorkspace]);

  const [enabledForms, setEnabledForms] = useState(() =>
    isCreateWorkspace
      ? { workspace_profile: true }
      : { business: true, offer_demand: true, costs: true, capacity_cash: true, go_to_market: true }
  );
  const selectedCount = useMemo(() => Object.values(enabledForms).filter(Boolean).length, [enabledForms]);

  const derivedWorkspaceName = useMemo(() => {
    if (isCreateWorkspace) {
      const pn = String(profile?.company_name || "").trim();
      return pn || "Workspace";
    }
    const bn = String(form?.context?.business_name || "").trim();
    if (!bn) return isProductPath ? "Product Validation" : "Idea Validation";
    return `${bn} - Validation`;
  }, [form?.context?.business_name, isCreateWorkspace, isProductPath, profile?.company_name]);

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

  useEffect(() => setCurrency(form?.context?.currency || "USD"), [form?.context?.currency, setCurrency]);

  useEffect(() => {
    if (isCreateWorkspace) {
      setEnabledForms({ workspace_profile: true });
      setMode("fill");
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
  }, [isCreateWorkspace]);

  useEffect(() => {
    async function prefill() {
      const wsId = editingWorkspaceId || storedWorkspaceId;
      if (!wsId) return;
      setIsPrefilling(true);
      setError(null);
      try {
        const ws = await apiRequest(`/validation/${wsId}`, "GET");
        const iv = ws?.data?.idea_validation || ws?.data?.draft_idea_validation;
        setExistingCatalogue(ws?.data?.catalogue || { products: [], customers: [], vendors: [] });
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
            setProfile((prev) => ({
              ...prev,
              ...wp,
              services: Array.isArray(wp.services) && wp.services.length
                ? wp.services
                : prev.services,
              core_values: Array.isArray(wp.core_values) ? wp.core_values.join(", ") : prev.core_values
            }));
          }
          setWorkspaceId(wsId);
          setWorkspaceNameStore(ws?.name || null);
          setDecisionStatus(ws?.data?.decision?.status || null);
          setWorkspaceName(ws?.name || "");
          setWorkspaceNameTouched(true);
          return;
        }
        setWorkspaceId(wsId);
        setWorkspaceNameStore(ws?.name || null);
        setDecisionStatus(ws?.data?.decision?.status || null);
        setIdeaValidation(iv);
        setWorkspaceName(ws?.name || "");
        setWorkspaceNameTouched(true);
        const wp = ws?.data?.workspace_profile;
        if (wp && typeof wp === "object") {
          setProfile((prev) => ({
            ...prev,
            ...wp,
            services: Array.isArray(wp.services) && wp.services.length
              ? wp.services
              : prev.services,
            core_values: Array.isArray(wp.core_values) ? wp.core_values.join(", ") : prev.core_values
          }));
        }
        const next = structuredClone(iv);
        const bt = String(next?.context?.business_type ?? "").trim();
        next.context.business_type_category = BUSINESS_TYPE_OPTIONS.includes(bt) ? bt : "Other";
        next.context.business_type_other = BUSINESS_TYPE_OPTIONS.includes(bt) ? "" : bt;
        const pi = String(next?.context?.primary_industry ?? "").trim();
        next.context.primary_industry_category = PRIMARY_INDUSTRY_OPTIONS.includes(pi) ? pi : pi ? "Other" : "IT";
        next.context.primary_industry_other = PRIMARY_INDUSTRY_OPTIONS.includes(pi) ? "" : pi;
        const cs = String(next?.problem?.customer_segment ?? "").trim();
        next.problem.customer_segment_category = CUSTOMER_SEGMENT_OPTIONS.includes(cs) ? cs : cs ? "Other" : "SMEs";
        next.problem.customer_segment_other = CUSTOMER_SEGMENT_OPTIONS.includes(cs) ? "" : cs;
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

  function update(path, value) {
    setForm((prev) => {
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
    const bn = String(form.context.business_name || "").trim();
    const sn = String(form.offer?.service_type || "").trim();
    return bn.length >= 2 || sn.length >= 2;
  }, [form.context.business_name, form.offer?.service_type, isCreateWorkspace, profile, enabledForms.workspace_profile]);
  const canEdit = !isLoading && !isPrefilling;

  function startFilling() {
    if (!selectedCount) return setError("Select at least one section to continue.");
    setError(null);
    setMode("fill");
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
      const wsName = String((isCreateWorkspace ? profile.company_name : workspaceName) || "").trim() || derivedWorkspaceName;

      let wsId = editingWorkspaceId || storedWorkspaceId;
      if (isCreateWorkspace) {
        const profilePayload = {
          ...profile,
          company_name: String(profile.company_name || "").trim(),
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
        const serviceProducts = profilePayload.services
          .filter((s) => s.service_name)
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
      setCurrency(payload.context.currency || "USD");
      const productFromValidation = isProductPath
        ? {
            id: crypto.randomUUID(),
            name: String(payload.context.business_name || payload.offer.service_type || "Product").trim(),
            type: "service",
            base_price: Number(payload.offer.price_per_unit || 0),
            discount: 0,
            freight_cost: 0,
            archived: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        : null;
      const existingProducts = Array.isArray(existingCatalogue?.products) ? existingCatalogue.products : [];
      const nextProducts = productFromValidation
        ? existingProducts.some(
            (p) =>
              String(p?.name || "").trim().toLowerCase() === productFromValidation.name.toLowerCase()
          )
          ? existingProducts
          : [productFromValidation, ...existingProducts]
        : existingProducts;
      const nextCatalogue = {
        products: nextProducts,
        customers: Array.isArray(existingCatalogue?.customers) ? existingCatalogue.customers : [],
        vendors: Array.isArray(existingCatalogue?.vendors) ? existingCatalogue.vendors : []
      };
      if (wsId) {
        await apiRequest(
          `/validation/${wsId}`,
          "PATCH",
          { data: { draft_idea_validation: payload, catalogue: nextCatalogue } },
          { timeoutMs: 120000 }
        );
        setWorkspaceId(wsId);
        setWorkspaceNameStore(wsName);
        setDecisionStatus(null);
        setIdeaValidation(payload);
      } else {
        const ws = await apiRequest(
          "/validation/create",
          "POST",
          { name: wsName, data: { draft_idea_validation: payload, catalogue: nextCatalogue } },
          { timeoutMs: 120000 }
        );
        wsId = ws.id;
        setWorkspaceId(wsId);
        setWorkspaceNameStore(ws.name || wsName);
        setDecisionStatus(null);
        setIdeaValidation(payload);
      }

      if (enabledForms.workspace_profile) {
        const profilePayload = {
          ...profile,
          company_name: String(profile.company_name || "").trim(),
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
      }
      if (shouldEvaluate) {
        const result = await apiRequest(
          "/validation/evaluate",
          "POST",
          { idea_validation: payload },
          { timeoutMs: 120000 }
        );
        setValidation(result);
        navigate("/results");
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
            <div className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
              Sections selected: {selectedCount} / {formBlocks.length}
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

        {mode === "select" && !isCreateWorkspace ? (
          <>
            {!fromOtherModule ? (
              <SectionCard
                title="What are you validating?"
                subtitle="Choose the option that best matches your idea."
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => update("pathway", "business_idea")}
                    className={
                      "rounded-2xl border p-4 text-left transition " +
                      (form.pathway === "business_idea" ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white hover:bg-slate-50")
                    }
                  >
                    <div className="text-sm font-semibold text-slate-900">Business idea</div>
                    <div className="mt-1 text-xs text-slate-600">A service, marketplace, or company concept you want to start.</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => update("pathway", "product_service_idea")}
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
            </div>
          </>
        ) : (
          <SectionCard
            title={fromOtherModule ? "Workspace inputs" : "Validation inputs"}
            subtitle={fromOtherModule ? "Open any section and fill it in any order." : "Open any section and fill it in any order."}
          >
            <div className="space-y-3">
              {enabledForms.business ? (
                <details className="rounded-2xl border border-slate-200 bg-white p-4" open>
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                    {isProductPath ? "Product details" : "Workspace details"}
                  </summary>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    <div className="md:col-span-2 lg:col-span-3">
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
                    <div className="md:col-span-2 lg:col-span-3">
                      <FieldLabel info="The name you want to validate. This is required.">
                        {isProductPath ? "Product / service name *" : "Business name *"}
                      </FieldLabel>
                      <Input value={form.context.business_name} onChange={(e) => update("context.business_name", e.target.value)} />
                    </div>
                    <div className="md:col-span-2 lg:col-span-3">
                      <FieldLabel info="Short description of what you're building.">
                        {isProductPath ? "What product or service are you building?" : "What are you building?"}
                      </FieldLabel>
                      <Input value={form.offer.service_type} onChange={(e) => update("offer.service_type", e.target.value)} />
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
                  </div>
                </details>
              ) : null}

              {enabledForms.workspace_profile ? (
                <details className="rounded-2xl border border-slate-200 bg-white p-4" open>
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                    Workspace profile
                  </summary>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    <div className="md:col-span-2 lg:col-span-3">
                      <FieldLabel info="Legal or trading name.">Company name *</FieldLabel>
                      <Input value={profile.company_name} onChange={(e) => updateProfile("company_name", e.target.value)} />
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
                        {PROFILE_BUSINESS_TYPES.map((o) => (<option key={o} value={o}>{o.replaceAll("_", " ")}</option>))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>Primary industry *</FieldLabel>
                      <select value={profile.primary_industry} onChange={(e) => updateProfile("primary_industry", e.target.value)} className="ea-input">
                        {PROFILE_INDUSTRIES.map((o) => (<option key={o} value={o}>{o.replaceAll("_", " ")}</option>))}
                      </select>
                    </div>
                    <div className="md:col-span-2 lg:col-span-3">
                      <FieldLabel info="Short overview of what you do.">About company *</FieldLabel>
                      <textarea value={profile.about_company} onChange={(e) => updateProfile("about_company", e.target.value)} className="min-h-20 ea-input" />
                    </div>
                    <div className="md:col-span-2 lg:col-span-3">
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
                        {PROFILE_COMPANY_SIZES.map((o) => (<option key={o} value={o}>{o}</option>))}
                      </select>
                    </div>

                    <div className="md:col-span-2 lg:col-span-3">
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
                              {PROFILE_INDUSTRIES.map((o) => (<option key={o} value={o}>{o.replaceAll("_", " ")}</option>))}
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
                    <div className="md:col-span-2 lg:col-span-3">
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
                    <div className="md:col-span-2 lg:col-span-3">
                      <FieldLabel>Address line 1</FieldLabel>
                      <Input value={profile.address_line_1} onChange={(e) => updateProfile("address_line_1", e.target.value)} />
                    </div>
                    <div className="md:col-span-2 lg:col-span-3">
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
                        {PROFILE_MONTHLY_REVENUE.map((o) => (<option key={o} value={o}>{o}</option>))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>Employee count</FieldLabel>
                      <Input type="number" value={profile.employee_count} onChange={(e) => updateProfile("employee_count", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Operating stage *</FieldLabel>
                      <select value={profile.operating_stage} onChange={(e) => updateProfile("operating_stage", e.target.value)} className="ea-input">
                        {PROFILE_OPERATING_STAGE.map((o) => (<option key={o} value={o}>{o.replaceAll("_", " ")}</option>))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>Delivery model *</FieldLabel>
                      <select value={profile.delivery_model} onChange={(e) => updateProfile("delivery_model", e.target.value)} className="ea-input">
                        {PROFILE_DELIVERY_MODEL.map((o) => (<option key={o} value={o}>{o}</option>))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>Target customer type</FieldLabel>
                      <select value={profile.target_customer_type} onChange={(e) => updateProfile("target_customer_type", e.target.value)} className="ea-input">
                        <option value="">Select</option>
                        {PROFILE_TARGET_CUSTOMER.map((o) => (<option key={o} value={o}>{o}</option>))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>Primary revenue model</FieldLabel>
                      <select value={profile.primary_revenue_model} onChange={(e) => updateProfile("primary_revenue_model", e.target.value)} className="ea-input">
                        <option value="">Select</option>
                        {PROFILE_REVENUE_MODEL.map((o) => (<option key={o} value={o}>{o.replaceAll("_", " ")}</option>))}
                      </select>
                    </div>
                    <div className="md:col-span-2 lg:col-span-3">
                      <FieldLabel>Key offering focus</FieldLabel>
                      <Input value={profile.key_offering_focus} onChange={(e) => updateProfile("key_offering_focus", e.target.value)} />
                    </div>
                  </div>
                </details>
              ) : null}

              {enabledForms.offer_demand ? (
                <details className="rounded-2xl border border-slate-200 bg-white p-4" open>
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">Offer & demand</summary>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    <div className="md:col-span-2 lg:col-span-3">
                      <FieldLabel info="Who you're selling to.">Customer segment</FieldLabel>
                      <select value={form.problem.customer_segment_category} onChange={(e) => update("problem.customer_segment_category", e.target.value)} className="ea-input">
                        {CUSTOMER_SEGMENT_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                      </select>
                      {form.problem.customer_segment_category === "Other" ? <div className="mt-2"><Input value={form.problem.customer_segment_other} onChange={(e) => update("problem.customer_segment_other", e.target.value)} placeholder="Type customer segment" /></div> : null}
                    </div>

                    <div className="md:col-span-2 lg:col-span-3">
                      <FieldLabel info="Short problem statement.">Problem (short)</FieldLabel>
                      <Input value={form.problem.problem_type} onChange={(e) => update("problem.problem_type", e.target.value)} />
                    </div>

                    <div className="md:col-span-2 lg:col-span-3">
                      <FieldLabel info="How often does this problem occur?">Frequency</FieldLabel>
                      <Input value={form.problem.frequency} onChange={(e) => update("problem.frequency", e.target.value)} />
                    </div>

                    <div className="md:col-span-2 lg:col-span-3">
                      <FieldLabel info="What alternatives do customers use today?">Alternatives</FieldLabel>
                      <Input value={form.problem.alternatives} onChange={(e) => update("problem.alternatives", e.target.value)} />
                    </div>

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

              {enabledForms.costs ? (
                <details className="rounded-2xl border border-slate-200 bg-white p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">Costs</summary>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
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

              {enabledForms.capacity_cash ? (
                <details className="rounded-2xl border border-slate-200 bg-white p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">Capacity & cash</summary>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <FieldLabel info="How many people are delivering the work.">Team size</FieldLabel>
                      <NumberInput placeholder="1" value={form.capacity.team_size} onChange={(v) => update("capacity.team_size", v)} />
                    </div>
                    <div>
                      <FieldLabel info="How many units one person can deliver per month.">
                        Capacity units / person / month
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

              {enabledForms.go_to_market ? (
                <details className="rounded-2xl border border-slate-200 bg-white p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">Go-to-market</summary>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
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
                    <div className="md:col-span-2 lg:col-span-3">
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

        <div className="sticky bottom-0 z-20 -mx-6 mt-4 border-t border-slate-200 bg-transparent px-6 py-3">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
            <div>
              {mode === "fill" && !isCreateWorkspace ? (
                <Button variant="ghost" disabled={!canEdit} onClick={() => setMode("select")}>Change sections</Button>
              ) : (
                <div className="h-10" />
              )}
            </div>
            <div className="flex items-center gap-2">
              {mode === "select" ? (
                <Button disabled={!canEdit || !selectedCount} onClick={startFilling}>Continue</Button>
              ) : (
                <div className="flex items-center gap-2">
                  {mode === "fill" ? (
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
            <div className="mx-auto mt-2 max-w-6xl">
              <InlineAlert kind="error" message={error} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
