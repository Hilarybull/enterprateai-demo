import REGISTRY from "./entitlements.json";
import { PLAN_MODULE_ACCESS } from "../lib/plans";

// QA U6: what each public feature page says beyond its summary: who it is for, how it works in three steps, and
// what is free and what is paid. Free and paid are never written here: they are read from the entitlement
// registry (entitlements.json, kept equal to backend/app/modules/plans/capabilities.py by a test).
//
// `tasks`: the Agent tasks behind the feature (registry keys). `quota`: a counted task or listing.
// `module`: the app area it lives in, for a feature with no Agent task of its own (the plans' module table).
// `byHand`: the tool is on every plan when the owner does it themselves (the Operate & Manage tools are all in
// the free plan's modules). `rfq`: reading Marketplace requests for a quotation, on paid plans only.
// `image`: a picture the homepage already uses, for the group it belongs to.

const IMAGES = {
  "plan-and-prepare": { src: "/panel-planning.png", alt: "Two founders reviewing a business plan together" },
  "operate-and-manage": { src: "/panel-essentials.png", alt: "Business owner working on invoices and quotations" },
  "decision-intelligence": { src: "/panel-decision.png", alt: "Founder reviewing scenario simulation data" },
};

export const FEATURE_DETAILS = {
  agent: {
    who: "Anyone running a small business who would rather say what needs doing than find the right screen.",
    steps: [
      { title: "Tell it the job", body: "Say what you need in your own words: an invoice, a quotation, a plan, or a question about your business." },
      { title: "It does the work", body: "It reads your records, asks only for what is missing, and prepares the document or the answer." },
      { title: "You approve", body: "It waits for your say-so. Nothing is sent, and nothing leaves your business, until you approve it." },
    ],
    tasks: ["new_invoice", "enquiry_to_quote", "payment_followup"],
  },
  "idea-validation": {
    who: "Founders with an idea who want to know whether it holds up before they spend money on it.",
    steps: [
      { title: "Describe the idea", body: "What you will sell, to whom, at what price, and what it costs you to deliver." },
      { title: "Add what you know", body: "Expected sales, how much you can deliver in a month, and any evidence that people will pay." },
      { title: "Read the result", body: "What looks strong, what is weak, what is not known yet, and what to test next." },
    ],
    tasks: ["idea_validation"],
  },
  "business-plan": {
    who: "Founders and owners who need a written plan, for themselves, a lender or an investor.",
    steps: [
      { title: "Start from your workspace", body: "Your profile, offerings and figures are already there, so nothing is typed twice." },
      { title: "Get a first draft", body: "Each section of the plan is drafted from what your workspace holds." },
      { title: "Edit and keep it", body: "Change any section, then keep the plan beside your other business documents." },
    ],
    tasks: ["business_plan_draft"],
  },
  "business-proposal": {
    who: "Businesses that win work by pitching to clients, and want each proposal to start from their own offerings.",
    steps: [
      { title: "Name the client", body: "Who it is for, the problem they have, and what you will do about it." },
      { title: "Get a draft", body: "A proposal written in your business's voice, from your offerings." },
      { title: "Approve it", body: "Edit it, then approve it. It goes nowhere until you do." },
    ],
    tasks: ["new_proposal"],
  },
  "sales-letter": {
    who: "Businesses with an offering to promote that want a first draft of the letter to send.",
    steps: [
      { title: "Choose an offering", body: "Pick what the letter is about and who it is for." },
      { title: "Read the first version", body: "A sales letter written from that offering." },
      { title: "Make it yours", body: "Change anything before you use it." },
    ],
    module: "blueprint",
  },
  "business-essentials": {
    who: "Small businesses that want their invoices, quotations, receipts, expenses and contracts in one free place.",
    steps: [
      { title: "Add your customers and offerings", body: "Once, in your catalogue. Every document reuses them." },
      { title: "Create what you need", body: "Invoices, quotations, receipts, expenses and contracts, from one place." },
      { title: "Keep track", body: "What is sent, what is paid and what is still to come, at a glance." },
    ],
    tasks: ["new_invoice", "enquiry_to_quote", "receipt_send", "record_expense", "new_contract"], byHand: true,
  },
  "invoice-generator": {
    who: "Anyone who bills customers and wants to see at a glance what has been paid and what hasn't.",
    steps: [
      { title: "Pick the customer", body: "From your customers, or add a new one as you go." },
      { title: "Add the items", body: "From your catalogue or typed in, with VAT and any discount worked out for you." },
      { title: "Send and track it", body: "Approve it, send it, and see when it is paid." },
    ],
    tasks: ["new_invoice"], byHand: true,
  },
  "quotation-generator": {
    who: "Businesses that price work before they do it, and want an accepted quotation to become the invoice.",
    steps: [
      { title: "Start from the request", body: "Who it is for and what they asked for." },
      { title: "Price it", body: "Prices from your catalogue or typed in, with how long the quotation is valid." },
      { title: "Turn it into an invoice", body: "When the customer accepts, the quotation becomes the invoice." },
    ],
    tasks: ["enquiry_to_quote"], byHand: true,
  },
  "receipt-generator": {
    who: "Businesses whose customers want a receipt when they pay.",
    steps: [
      { title: "Record the payment", body: "Against the invoice it settles." },
      { title: "Prepare the receipt", body: "Filled in from the invoice and the payment." },
      { title: "Approve and send", body: "It is sent only when you approve it." },
    ],
    tasks: ["receipt_send"], byHand: true,
  },
  "expense-tracking": {
    who: "Owners who want to know what the business spends, and what it still owes its suppliers.",
    steps: [
      { title: "Record what you spend", body: "The amount, the supplier and what it was for." },
      { title: "Mark it paid or unpaid", body: "So what you owe is never a surprise." },
      { title: "See the effect", body: "Your cash position and runway follow what you record." },
    ],
    tasks: ["record_expense"], byHand: true,
  },
  "contract-management": {
    who: "Businesses with ongoing agreements, with customers or suppliers, whose start and end dates need watching.",
    steps: [
      { title: "Create or add a contract", body: "With a customer or a supplier." },
      { title: "Set its dates", body: "Start and end dates you can see coming." },
      { title: "Keep it with the customer", body: "Linked to who it is with, beside their invoices and quotations." },
    ],
    tasks: ["new_contract"], byHand: true,
  },
  marketplace: {
    who: "Businesses that want to be found by other businesses looking for what they offer.",
    steps: [
      { title: "Build your profile", body: "From what your workspace already says about your business." },
      { title: "Choose what to show", body: "Which offerings appear, and which requests you want to receive." },
      { title: "Go live", body: "Businesses looking for what you offer can find you." },
    ],
    tasks: ["marketplace_profile"], quota: "marketplace_listings",
  },
  "rfq-to-quotation": {
    who: "Businesses that receive requests for a quotation on the Marketplace and want to answer them quickly.",
    steps: [
      { title: "A request comes in", body: "A business asks you for a quotation on the Marketplace." },
      { title: "A draft is prepared", body: "From the request and the prices in your catalogue." },
      { title: "You approve it", body: "Nothing is sent until you do." },
    ],
    tasks: ["enquiry_to_quote"], rfq: true,
  },
  "marketplace-visibility": {
    who: "Businesses on the Marketplace that want buyers searching by service and location to find them.",
    steps: [
      { title: "List your business", body: "Your profile and the offerings you choose." },
      { title: "Be searchable", body: "By service, by location and by trust status." },
      { title: "Answer requests", body: "Reply to the businesses that find you." },
    ],
    tasks: ["marketplace_offering"], quota: "marketplace_listings",
  },
  "claim-your-business": {
    who: "Owners whose business already has a profile on the Marketplace.",
    steps: [
      { title: "Find your business", body: "Search the Marketplace for its profile." },
      { title: "Show you manage it", body: "Confirm that the business is yours." },
      { title: "Take control", body: "Then choose what the profile says." },
    ],
    tasks: ["marketplace_profile"],
  },
  "scenario-simulation": {
    who: "Owners of a trading business who want to see what a decision would do before they make it.",
    steps: [
      { title: "Pick a decision", body: "Losing a customer, a late payment, a price or a cost change." },
      { title: "It is worked out", body: "From your own records, not from averages." },
      { title: "Compare", body: "See your business with the decision and without it." },
    ],
    tasks: ["scenario_help"], quota: "scenario_help",
  },
  recommendations: {
    who: "Owners who want their own records turned into a short list of things worth doing next.",
    steps: [
      { title: "Your records are read", body: "Sales, costs, customers and what is owed." },
      { title: "Recommendations appear", body: "Each one with the reason it is suggested." },
      { title: "Act on one", body: "Or test it first as a scenario." },
    ],
    module: "dashboard",
  },
  "fragility-index": {
    who: "Owners who want to see where the business is exposed: how much depends on one customer, and how long the cash would last.",
    steps: [
      { title: "Revenue by customer", body: "How much of your income comes from each customer, read from your invoices." },
      { title: "Cash runway", body: "How many months your cash would last at the rate you spend it now." },
      { title: "Where you are exposed", body: "Each pressure point, with what would make the business less fragile." },
    ],
    tasks: ["risk_concentration"],
  },
  "adaptive-scenarios": {
    who: "Owners whose business is changing stage, who want to know which decisions matter at the stage they are at.",
    steps: [
      { title: "Your stage is known", body: "From your records: idea, pre-launch, operating or growing." },
      { title: "Scenarios are suggested", body: "The ones that matter at that stage." },
      { title: "Run the ones you want", body: "And see what each would do." },
    ],
    tasks: ["expansion_scenario"], quota: "scenario_help",
  },
};

const PLAN_LABEL = Object.fromEntries(REGISTRY.plans.map((p) => [p.key, p.label]));
const ORDER = REGISTRY.plans.map((p) => p.key);
const FREE_PLAN = ORDER[0];
const SHOWN_PLANS = ["explorer", "starter_insight", "decision_engine"];      // the plans on sale

/** The cheapest plan that includes a task, from the registry; null when no plan lists it. */
export function minPlanFor(task) {
  return ORDER.find((plan) => (REGISTRY.adds[plan] || []).includes(task)) || null;
}

/** The cheapest plan whose modules include this area of the app. */
const minPlanForModule = (module) => ORDER.find((plan) => (PLAN_MODULE_ACCESS[plan] || []).includes(module)) || null;

function quotaWords(key, n) {
  if (n === null || n === undefined) return "No limit";
  if (n === 0) return "Not included";
  return key === "marketplace_listings" ? `${n} listing${n === 1 ? "" : "s"}` : `${n} a month`;
}

/**
 * What is free and what is paid for one feature, in lines, from the registry: [{ plan, text }] plus notes.
 * Never invented: a feature with nothing in the registry says only what its own tool is.
 */
export function featureAccess(slug) {
  const d = FEATURE_DETAILS[slug] || {};
  const rows = [];
  const notes = [];
  if (d.byHand) rows.push({ plan: PLAN_LABEL[FREE_PLAN], text: "Free on every plan when you do it yourself." });
  if (d.tasks?.length) {
    const plans = [...new Set(d.tasks.map(minPlanFor).filter(Boolean))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    const [from, ...more] = plans;
    if (from) {
      rows.push({ plan: PLAN_LABEL[from], text: from === FREE_PLAN
        ? (d.byHand ? "The Agent can prepare it for you on the free plan too." : "Included on the free plan.")
        : `Included from ${PLAN_LABEL[from]}.` });
      for (const plan of more) rows.push({ plan: PLAN_LABEL[plan], text: `More is included from ${PLAN_LABEL[plan]}.` });
      notes.push("Work the Agent does uses AI Credits. The cost is shown before it starts.");
    }
  } else if (d.module && minPlanForModule(d.module)) {
    const from = minPlanForModule(d.module);
    rows.push({ plan: PLAN_LABEL[from], text: from === FREE_PLAN ? "Included on the free plan." : `Included from ${PLAN_LABEL[from]}.` });
  }
  if (d.quota) {
    for (const plan of SHOWN_PLANS) rows.push({ plan: PLAN_LABEL[plan], text: quotaWords(d.quota, REGISTRY.quotas[plan]?.[d.quota]), quota: true });
  }
  if (d.rfq) rows.push({ plan: PLAN_LABEL.starter_insight, text: "Reading and answering Marketplace requests for a quotation is on paid plans, from Starter." });
  return { rows, notes };
}

/** Everything a feature page shows, for one feature of the public site's map. */
export function featureDetail(feature) {
  const d = FEATURE_DETAILS[feature.slug] || {};
  return {
    who: d.who || null,      // each feature's own words (QA P5-2): never a sentence shared with another
    steps: d.steps || [],
    access: featureAccess(feature.slug),
    image: feature.group ? IMAGES[feature.group.slug] || null : null,
  };
}
