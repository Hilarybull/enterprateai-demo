export const BILLING = { monthly: "monthly", annual: "annual" };

export const PLANS = [
  {
    key: "free_trial",
    label: "Free Trial",
    tagline: "Try everything, no card needed",
    monthlyPrice: 0,
    annualPrice: 0,
    annualSaving: 0,
    trialDays: 14,
    color: "slate",
    cta: "Start Free Trial",
    ctaStyle: "solid",
    features: [
      "Idea & service validation",
      "Business blueprint generation",
      "Scenario simulation & risk detection",
      "Catalogue & financials management",
      "Full access for 14 days",
      "No credit card required",
    ],
  },
  {
    key: "insight_starter",
    label: "Insight Starter",
    tagline: "Perfect for solo founders exploring ideas",
    monthlyPrice: 25,
    annualPrice: 20,
    annualTotal: 240,
    annualSaving: 60,
    trialDays: null,
    color: "brand",
    cta: "Subscribe",
    ctaStyle: "outline",
    features: [
      "Idea & service validation",
      "Business blueprints (plans, proposals, sales letters)",
      "Catalogue (products, customers, vendors)",
      "Financials (invoices, quotations, expenses, contracts)",
      "Export financial reports",
      "1 user workspace",
    ],
  },
  {
    key: "decision_engine",
    label: "Decision Engine",
    tagline: "For businesses ready to scale decisions",
    monthlyPrice: 49,
    annualPrice: 40,
    annualTotal: 480,
    annualSaving: 108,
    trialDays: null,
    color: "brand",
    badge: "Most Popular",
    cta: "Subscribe",
    ctaStyle: "solid",
    features: [
      "Everything in Insight Starter",
      "Unlimited scenario simulation",
      "Risk detection & scenario alerts",
      "AI-powered recommendations",
      "1 user workspace",
    ],
  },
  {
    key: "strategic_intelligence",
    label: "Strategic Intelligence",
    tagline: "Enterprise-grade intelligence for growing teams",
    monthlyPrice: 99,
    annualPrice: 83.33,
    annualTotal: 1000,
    annualSaving: 188,
    trialDays: null,
    color: "purple",
    cta: "Subscribe",
    ctaStyle: "outline",
    features: [
      "Everything in Decision Engine",
      "Multi-user workspace access",
      "Access control per module & feature",
      "Priority support",
    ],
  },
];

// Which top-level modules each plan can access
export const PLAN_MODULE_ACCESS = {
  free_trial:              ["dashboard", "validation", "blueprint", "simulation", "catalogue", "financials"],
  insight_starter:         ["dashboard", "validation", "blueprint", "catalogue", "financials"],
  decision_engine:         ["dashboard", "validation", "blueprint", "simulation", "catalogue", "financials"],
  strategic_intelligence:  ["dashboard", "validation", "blueprint", "simulation", "catalogue", "financials"],
};

// Minimum plan needed to access a module (for upgrade prompts)
export const MODULE_MIN_PLAN = {
  simulation: "decision_engine",
};

const PLAN_ORDER = ["free_trial", "insight_starter", "decision_engine", "strategic_intelligence"];

export function planRank(planKey) {
  const idx = PLAN_ORDER.indexOf(planKey);
  return idx === -1 ? 0 : idx;
}

/**
 * Returns true if the user's plan grants access to this module.
 * Grandfathered users (signed up before restrictions were introduced) always pass.
 * An expired trial falls back to insight_starter access.
 */
export function planHasModuleAccess(planKey, moduleKey, status) {
  if (status === "grandfathered") return true;
  const effectivePlan = (planKey === "free_trial" && status === "expired")
    ? "insight_starter"
    : (planKey ?? "free_trial");
  const allowed = PLAN_MODULE_ACCESS[effectivePlan] ?? PLAN_MODULE_ACCESS.free_trial;
  return allowed.includes(moduleKey);
}

export function getPlan(key) {
  return PLANS.find((p) => p.key === key) ?? null;
}

export function formatPrice(price) {
  if (price === 0) return "£0";
  return `£${Number.isInteger(price) ? price : price.toFixed(2)}`;
}

export function planLabel(planKey, status) {
  if (status === "grandfathered") return "Early Access";
  if (planKey === "free_trial" && status === "expired") return "Trial Expired";
  if (planKey === "free_trial") return "Free Trial";
  return getPlan(planKey)?.label ?? planKey;
}
