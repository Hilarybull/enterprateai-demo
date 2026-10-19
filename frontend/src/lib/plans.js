import { isPlatformModuleGranted } from "./permissions";

export const BILLING = { monthly: "monthly", annual: "annual" };

// The plans as sold (EnterprateAI_Pricing_Plans_AI_Agent_Final.pdf, 19 Oct 2026): names, lines, prices and features word for word.
export const PLANS = [
  {
    key: "explorer",
    label: "Explorer",
    headline: "Start simple.",
    tagline: "For new businesses getting organised",
    monthlyPrice: 0,
    annualPrice: 0,
    annualSaving: 0,
    cta: "Get started free",
    ctaStyle: "solid",
    features: [
      "50 welcome AI credits (valid 60 days)",
      "AI Agent access (credit-based)",
      "1 user seat",
      "Invoices, Quotes, Receipts & Contracts",
      "Expense, Customer & Product Records",
      "1 Marketplace Listing",
      "Basic Idea Validation",
    ],
  },
  {
    key: "starter_insight",
    label: "Starter",
    headline: "Plan, launch and grow.",
    tagline: "For founders and solo businesses",
    monthlyPrice: 19,
    annualPrice: 15.83,
    annualTotal: 190,
    annualSaving: 38,
    cta: "Choose Starter",
    ctaStyle: "outline",
    features: [
      "Everything in Explorer",
      "500 AI credits each month",
      "AI Agent access (credit-based)",
      "1 user seat",
      "AI Business Plan Generator",
      "Product/Service Launch Readiness",
      "AI-Powered Funding Readiness",
      "Proposals & Sales Letters Generator",
      "Pricing & Customer Growth Insights",
      "Up to 10 Marketplace Listings*",
      "Scenario Simulations",
      "Request for Proposal",
      "RFQ-to-Quote Workflow",
      "AI-Powered Decision Recommendations",
    ],
  },
  {
    key: "decision_engine",
    label: "Decision Engine",
    headline: "Decide with confidence.",
    tagline: "For growing businesses and teams",
    monthlyPrice: 59,
    annualPrice: 49.17,
    annualTotal: 590,
    annualSaving: 118,
    badge: "Most Popular",
    cta: "Choose Decision Engine",
    ctaStyle: "solid",
    features: [
      "Everything in Starter",
      "2,000 pooled AI credits / month",
      "AI Agent access (credit-based)",
      "3 user seats included",
      "Extra seat: £15/mo (+250 AI credits)",
      "Live & Adaptive Business Plan Intelligence",
      "Access to RFP Leads",
      "Third-Party Integrations",
      "Unlimited Marketplace Listings",
      "AI-Powered Decision Recommendations",
    ],
  },
  // {
  //   key: "growth_navigator",
  //   label: "Growth Navigator",
  //   tagline: "Growing SMEs & service firms",
  //   monthlyPrice: 99,
  //   annualPrice: 82.50,
  //   annualTotal: 990,
  //   annualSaving: 198,
  //   cta: "Subscribe",
  //   ctaStyle: "outline",
  //   features: [
  //     "20 idea validations/month",
  //     "Unlimited business plans & proposals",
  //     "10,000 products · customers · vendors",
  //     "Unlimited invoices, quotations & contracts",
  //     "250 scenario simulations/month",
  //     "Advanced Fragility Index",
  //     "Advanced Adaptive Scenario Intelligence",
  //     "RFQ automation workflow",
  //     "25 listings · 5 featured/month",
  //     "10 users included",
  //   ],
  // },
  // {
  //   key: "strategic_business_os",
  //   label: "Strategic Business OS",
  //   tagline: "Complete operating intelligence for established SMEs",
  //   monthlyPrice: 249,
  //   annualPrice: 207.50,
  //   annualTotal: 2490,
  //   annualSaving: 498,
  //   cta: "Subscribe",
  //   ctaStyle: "outline",
  //   features: [
  //     "40 idea validations/month",
  //     "Unlimited everything",
  //     "50,000+ records across all entities",
  //     "Unlimited simulations + multi-entity",
  //     "Advanced Fragility Index + multi-entity",
  //     "Advanced ASI + multi-entity",
  //     "100 listings · 20 featured/month",
  //     "Board/investor-style PDF reports",
  //     "25 users included",
  //     "Priority onboarding support",
  //   ],
  // },
];

// Normalise legacy plan keys stored in existing subscriptions
const LEGACY_KEY_MAP = {
  free_trial: "explorer",
  insight_starter: "starter_insight",
  strategic_intelligence: "growth_navigator",
};
export function normalisePlanKey(key) {
  return LEGACY_KEY_MAP[key] ?? key ?? "explorer";
}

// Which top-level modules each plan can access
export const PLAN_MODULE_ACCESS = {
  // Explorer (free): core tools. Proposals, integrations and the live plan are paid.
  explorer: ["dashboard", "validation", "blueprint", "simulation", "catalogue", "financials", "registration", "marketplace", "operations"],
  // Starter: everything on Explorer + proposals.
  starter_insight: ["dashboard", "validation", "blueprint", "simulation", "catalogue", "financials", "registration", "marketplace", "proposals", "operations"],
  // Decision Engine: everything on Starter + integrations and Live Business Plan Intelligence.
  decision_engine: ["dashboard", "validation", "blueprint", "simulation", "catalogue", "financials", "registration", "marketplace", "proposals", "operations", "integrations", "live_plan", "funding_pack"],
  growth_navigator: ["dashboard", "validation", "blueprint", "simulation", "catalogue", "financials", "registration", "marketplace", "proposals", "operations", "integrations", "live_plan", "funding_pack"],
  strategic_business_os: ["dashboard", "validation", "blueprint", "simulation", "catalogue", "financials", "registration", "marketplace", "proposals", "operations", "integrations", "live_plan", "funding_pack"],
};

// Minimum plan needed to access a module (for upgrade prompts)
export const MODULE_MIN_PLAN = {
  simulation: "explorer",
  integrations: "decision_engine",
  live_plan: "decision_engine",
  funding_pack: "decision_engine",      // preparing the funding pack (the owner, 16 Oct)
  proposals: "starter_insight",
};

// Scenario templates available for manual runs on the Starter plan.
// All other paid plans get every template.
export const STARTER_ALLOWED_SCENARIOS = ["tmpl_client_loss", "tmpl_payment_delay", "tmpl_revenue_drop", "tmpl_cost_increase"];

/**
 * Returns true if the plan can run this scenario template manually.
 * The baseline projection ("do_nothing_projection") is always allowed.
 */
export function planAllowsScenario(planKey, scenarioTemplateId, status) {
  if (status === "grandfathered") return true;
  if (!scenarioTemplateId || scenarioTemplateId === "do_nothing_projection") return true;
  const normalised = normalisePlanKey(planKey);
  if (normalised === "explorer") return false; // free plan — no manual scenarios
  if (normalised === "starter_insight") return STARTER_ALLOWED_SCENARIOS.includes(scenarioTemplateId);
  return true;
}

const PLAN_ORDER = ["explorer", "starter_insight", "decision_engine", "growth_navigator", "strategic_business_os"];

export function planRank(planKey) {
  const idx = PLAN_ORDER.indexOf(normalisePlanKey(planKey));
  return idx === -1 ? 0 : idx;
}

/**
 * Returns true if the user's plan grants access to this module.
 */
export function planHasModuleAccess(planKey, moduleKey, status) {
  if (status === "grandfathered") return true;
  const normalised = normalisePlanKey(planKey);
  const effectivePlan = (normalised === "explorer" && status === "expired")
    ? "explorer"
    : (normalised ?? "explorer");
  const allowed = PLAN_MODULE_ACCESS[effectivePlan] ?? PLAN_MODULE_ACCESS.explorer;
  return allowed.includes(moduleKey);
}

/** The funding pack is included from Decision Engine (the owner, 16 Oct); an admin grant of "funding_pack" opens it too. */
export function hasFundingPack(subscription, platformGrants) {
  return planHasModuleAccess(subscription?.plan_key ?? "explorer", "funding_pack", subscription?.status ?? "trial")
    || isPlatformModuleGranted("funding_pack", platformGrants);
}

export function getPlan(key) {
  return PLANS.find((p) => p.key === normalisePlanKey(key)) ?? null;
}

export function formatPrice(price) {
  if (price === 0) return "£0";
  return `£${Number.isInteger(price) ? price : price.toFixed(2)}`;
}

// QA U4: every plan's name as people see it, the plans not on sale included. A key is never shown as it is stored.
const PLAN_NAMES = { explorer: "Explorer", starter_insight: "Starter", decision_engine: "Decision Engine",
  growth_navigator: "Growth Navigator", strategic_business_os: "Strategic Business OS" };
const words = (key) => String(key || "").replace(/[_-]+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());

export function planLabel(planKey, status) {
  if (status === "grandfathered") return "Early Access";
  const normalised = normalisePlanKey(planKey);
  if (normalised === "explorer" && status === "expired") return "Trial Expired";
  return getPlan(normalised)?.label ?? PLAN_NAMES[normalised] ?? (words(normalised) || "Explorer");
}

/**
 * What the account can use, by name (QA U4): its plan, or the reason it has more than its plan. An admin's
 * full-access grant reads "Full access (test grant)", never the top plan's key.
 */
export function accessLabel(subscription) {
  const source = subscription?.access_source;
  if (source === "admin full-access grant") return "Full access (test grant)";
  if (source === "early-access account" || subscription?.status === "grandfathered") return "Early Access";
  return planLabel(subscription?.plan_key, subscription?.status);
}

// Paid features (proposals, RFQ replies, multiple listings) need Starter or above.
// Mirrors has_paid_access() in backend/app/modules/plans/access.py.
export function hasPaidAccess(planKey, status) {
  if (status === "grandfathered") return true;
  if (status === "trial" || status === "expired") return false;
  return planRank(planKey) >= planRank("starter_insight");
}
