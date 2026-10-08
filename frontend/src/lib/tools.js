import { MODULE_MIN_PLAN, getPlan, planHasModuleAccess } from "./plans";
import { hasModuleAccess, isPlatformModuleGranted, isPlatformModuleRestricted } from "./permissions";

// The Tool Library (PRD-AD-001 s8.4): every tool the account may open, grouped and described
// in plain words. The dashboard shows what deserves attention now; this lists everything.
// Each tool opens the existing page for the current business: no copies, no separate data.
export const TOOL_GROUPS = ["Plan", "Operate", "Sell", "Intelligence", "Agents"];

export const TOOLS = [
  { id: "validation", group: "Plan", name: "Idea Validation", to: "/validation", moduleKey: "validation",
    description: "Test a business idea against the market before you commit to it.", keywords: "validate concept viability market research" },
  { id: "business_plan", group: "Plan", name: "Business Plan", to: "/blueprint?tab=business-plans", moduleKey: "blueprint",
    description: "Write and keep a business plan built from your own figures.", keywords: "plan document investor" },
  { id: "blueprints", group: "Plan", name: "Business Blueprints", to: "/blueprint", moduleKey: "blueprint",
    description: "Proposals, sales letters and other business documents, drafted for you.", keywords: "documents templates proposal letter" },
  { id: "live_plan", group: "Plan", name: "Live Business Plan", to: "/business-plan", moduleKey: "live_plan",
    description: "Track your plan against what is actually happening, month by month.", keywords: "plan vs actual tracking forecast" },
  { id: "launch_readiness", group: "Plan", name: "Launch Readiness Check", to: "/launch", moduleKey: null,
    description: "What must be in place before you launch, what is blocking you and what to do next.", keywords: "launch ready blockers checklist prerequisites go live new service capacity" },
  { id: "funding_readiness", group: "Plan", name: "Funding Readiness Check", to: "/funding", moduleKey: null,
    description: "How prepared you are to approach funders, what evidence is missing and what to do next.", keywords: "funding investors equity raise use of funds pitch investor readiness forecast" },
  { id: "registration", group: "Plan", name: "Business Registration", to: "/registration", moduleKey: "registration",
    description: "Register the business and keep on top of legal and compliance steps.", keywords: "company legal compliance incorporate" },

  { id: "operations", group: "Operate", name: "Business Operations", to: "/operations", moduleKey: "operations",
    description: "Sales, procurement, contracts and transactions in one place.", keywords: "essentials overview" },
  { id: "invoices", group: "Operate", name: "Invoices & Receipts", to: "/operations?tab=Sales&sub=Invoices", moduleKey: "operations",
    description: "Raise invoices, record payments and send receipts.", keywords: "billing payment receipt overdue receivables cash flow" },
  { id: "expenses", group: "Operate", name: "Expenses & Transactions", to: "/operations?tab=Transactions", moduleKey: "operations",
    description: "Record what you spend and see every transaction.", keywords: "costs spending cash flow burn runway" },
  { id: "contracts", group: "Operate", name: "Contracts", to: "/operations?tab=Contracts", moduleKey: "operations",
    description: "Customer and vendor contracts, from draft to signed.", keywords: "agreement signature" },
  { id: "catalogue", group: "Operate", name: "Catalogue", to: "/catalogue", moduleKey: "catalogue",
    description: "Your products and services, customers and vendors.", keywords: "products customers vendors prices" },
  { id: "integrations", group: "Operate", name: "Integrations", to: "/integrations", moduleKey: "integrations",
    description: "Bring in data from your accounting and other services.", keywords: "import xero accounting connect" },
  { id: "team", group: "Operate", name: "Team", to: "/team", moduleKey: null,
    description: "Invite people and choose what each of them can do.", keywords: "members roles permissions invite" },

  { id: "quotations", group: "Sell", name: "Quotations", to: "/operations?tab=Sales&sub=Quotations", moduleKey: "operations",
    description: "Prepare quotations and see which have been accepted.", keywords: "quote estimate pipeline" },
  { id: "procurement", group: "Sell", name: "Procurement & RFQs", to: "/operations?tab=Procurement", moduleKey: "operations",
    description: "Request proposals, compare responses and award work.", keywords: "rfq proposals suppliers tender" },
  { id: "marketplace_profile", group: "Sell", name: "Marketplace Profile", to: "/marketplace/profile", moduleKey: null,
    description: "What the public sees about your business, and the opportunities you want to receive.", keywords: "claim listing public profile enquiries rfq proposals directory visibility" },
  { id: "marketplace", group: "Sell", name: "Marketplace", to: "/marketplace", moduleKey: "marketplace",
    description: "Find businesses to work with and be found by them.", keywords: "discover directory leads" },
  { id: "referrals", group: "Sell", name: "Referrals", to: "/referrals", moduleKey: null,
    description: "Refer other businesses and earn from each one.", keywords: "refer earn commission" },

  { id: "simulation", group: "Intelligence", name: "Scenarios & Simulation", to: "/simulation", moduleKey: "simulation",
    description: "See what a decision would do to revenue and cash before you make it.", keywords: "what if scenario stress test forecast fragility risk runway cash flow resilience client loss cost increase" },
  { id: "reports", group: "Intelligence", name: "Financial Reports", to: "/operations?tab=Reports", moduleKey: "operations",
    description: "Revenue, costs, cash and margins over time.", keywords: "report cash forecast profit cash flow runway burn margins revenue receivables" },
  { id: "dashboard", group: "Intelligence", name: "Adaptive Dashboard", to: "/dashboard", moduleKey: "dashboard",
    description: "What matters most to the business right now, and what to do next.", keywords: "overview insights health fragility risk alert concentration runway cash flow business health report" },

  { id: "agent_centre", group: "Agents", name: "Agent Centre", to: "/agent", moduleKey: "operations",
    description: "Everything the EnterprateAI Agent is doing, what needs you, and what it has finished.", keywords: "agent tasks approvals automation risk concentration payment follow-up reminders" },
  { id: "credits", group: "Agents", name: "AI Credits", to: "/credits", moduleKey: null,
    description: "See your AI Credit balance and how it has been used.", keywords: "credits balance usage top up" },
];

/**
 * What the current account can do with one tool:
 *   "available"  open it
 *   "upgrade"    on a higher plan: shown, clearly labelled, links to plans (no data behind it)
 *   "hidden"     not for this user (workspace role, or switched off by an administrator)
 */
export function toolAccess(tool, { subscription, platformGrants, platformRestrictions, isMemberMode, memberPermissionType, memberPermissions }) {
  if (!tool.moduleKey) return { state: "available" };
  if (isPlatformModuleRestricted(tool.moduleKey, platformRestrictions)) return { state: "hidden" };
  if (isMemberMode && !hasModuleAccess(tool.moduleKey, memberPermissionType, memberPermissions)) return { state: "hidden" };
  const onPlan = planHasModuleAccess(subscription?.plan_key ?? "free_trial", tool.moduleKey, subscription?.status ?? "trial")
    || isPlatformModuleGranted(tool.moduleKey, platformGrants);
  if (onPlan) return { state: "available" };
  const plan = getPlan(MODULE_MIN_PLAN[tool.moduleKey]);
  return { state: "upgrade", plan: plan?.label || "a higher plan" };
}

export function searchTools(tools, query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return tools;
  return tools.filter((t) => {
    const text = `${t.name} ${t.description} ${t.keywords} ${t.group}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
