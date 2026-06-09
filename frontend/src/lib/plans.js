export const BILLING = { monthly: "monthly", annual: "annual" };

export const PLANS = [
  {
    key: "explorer",
    label: "Explorer",
    tagline: "Test the platform, no card needed",
    monthlyPrice: 0,
    annualPrice: 0,
    annualSaving: 0,
    cta: "Start Free",
    ctaStyle: "solid",
    features: [
      "1 idea validation/month",
      "Business Registration Guide",
      "1 business plan (read-only)",
      "10 sales letters/month",
      "25 products · 25 customers · 10 vendors",
      "5 invoices & 5 quotations/month",
      "1 marketplace listing",
      "Basic PDF reports",
    ],
  },
  {
    key: "starter_insight",
    label: "Starter Insight",
    tagline: "Solo founders & new service businesses",
    monthlyPrice: 19,
    annualPrice: 15.83,
    annualTotal: 190,
    annualSaving: 38,
    cta: "Subscribe",
    ctaStyle: "outline",
    features: [
      "5 idea validations/month",
      "5 business plans/month",
      "5 proposals · 30 sales letters/month",
      "250 products · 500 customers · 250 vendors",
      "50 invoices · 50 quotations/month",
      "2 scenario simulations",
      "Basic Fragility Index",
      "Adaptive Scenario Intelligence",
      "1 marketplace listing",
      "1 user",
    ],
  },
  // {
  //   key: "decision_engine",
  //   label: "Decision Engine",
  //   tagline: "Micro-businesses ready to scale decisions",
  //   monthlyPrice: 49,
  //   annualPrice: 40.83,
  //   annualTotal: 490,
  //   annualSaving: 98,
  //   badge: "Most Popular",
  //   cta: "Subscribe",
  //   ctaStyle: "solid",
  //   features: [
  //     "10 idea validations/month",
  //     "Unlimited business plans",
  //     "50 proposals · 100 sales letters/month",
  //     "2,500 products · customers · vendors",
  //     "Unlimited invoices & quotations",
  //     "50 scenario simulations/month",
  //     "Standard Fragility Index",
  //     "Adaptive Scenario Intelligence",
  //     "RFQ automation workflow",
  //     "10 listings · 1 featured/month",
  //     "3 users included",
  //   ],
  // },
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
  // Explorer: 1 marketplace listing included, no simulation
  explorer:              ["dashboard", "validation", "blueprint", "catalogue", "financials", "registration", "marketplace"],
  // Starter Insight: 2 scenario simulations included
  starter_insight:       ["dashboard", "validation", "blueprint", "simulation", "catalogue", "financials", "registration", "marketplace"],
  decision_engine:       ["dashboard", "validation", "blueprint", "simulation", "catalogue", "financials", "registration", "marketplace"],
  growth_navigator:      ["dashboard", "validation", "blueprint", "simulation", "catalogue", "financials", "registration", "marketplace"],
  strategic_business_os: ["dashboard", "validation", "blueprint", "simulation", "catalogue", "financials", "registration", "marketplace"],
};

// Minimum plan needed to access a module (for upgrade prompts)
export const MODULE_MIN_PLAN = {
  simulation: "starter_insight",
};

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

export function getPlan(key) {
  return PLANS.find((p) => p.key === normalisePlanKey(key)) ?? null;
}

export function formatPrice(price) {
  if (price === 0) return "£0";
  return `£${Number.isInteger(price) ? price : price.toFixed(2)}`;
}

export function planLabel(planKey, status) {
  if (status === "grandfathered") return "Early Access";
  const normalised = normalisePlanKey(planKey);
  if (normalised === "explorer" && status === "expired") return "Trial Expired";
  if (normalised === "explorer") return "Explorer";
  return getPlan(normalised)?.label ?? planKey;
}
