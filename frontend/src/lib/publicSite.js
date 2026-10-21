import { shownTestimonials } from "../content/testimonials";

// The public site's map, in one place (QA F): the top navigation, the Features and Articles menus, the footer,
// and the page for each feature. The header, the footer, the pages and the route test all read it, so a link
// can never point at a page that isn't there.
//
// Content is taken from what the product does today (the landing page's own sections, expanded). Nothing here
// is a statistic or a claim about results. Customer quotes come only from content/testimonials.js, with consent;
// each feature page's detail, and what is free and what is paid, from content/featureDetails.js (QA U6).

export const FEATURE_GROUPS = [
  {
    slug: "plan-and-prepare", heading: "Plan & Prepare", desc: "Validate ideas and create business documents faster.",
    items: [
      { slug: "idea-validation", label: "Idea Validation", app: "/validation",
        summary: "Score a business idea from your own numbers before you invest in it.",
        points: ["A first viability result from your price, costs, expected sales, capacity and evidence of demand",
          "What looks strong, what is weak and what is simply not known yet, kept apart",
          "The next things to test, in plain words"] },
      { slug: "business-plan", label: "Business Plan Generator", app: "/blueprint?doc=business_plan",
        summary: "A structured business plan drafted from what your workspace already knows.",
        points: ["Built from your business profile, offerings and figures", "Every section editable before you share it",
          "Kept beside your other business documents"] },
      { slug: "business-proposal", label: "Business Proposal Generator", app: "/blueprint?doc=client_proposal",
        summary: "Client proposals prepared in your business's voice.",
        points: ["Starts from the client, the problem and what you offer", "Edited and approved by you before it goes anywhere"] },
      { slug: "sales-letter", label: "Sales Letter Generator", app: "/blueprint?doc=sales_letter",
        summary: "A sales letter for an offering, ready for you to review.",
        points: ["Written from your offering and who it is for", "Yours to change before you use it"] },
    ],
  },
  {
    slug: "operate-and-manage", heading: "Operate & Manage", desc: "Create invoices, quotations, receipts, expenses, and contracts.",
    items: [
      { slug: "business-essentials", label: "Free Business Essentials", app: "/essentials",
        summary: "The everyday tools a small business needs, free to use.",
        points: ["Invoices, quotations, receipts, expenses and contracts in one place", "Your customers and catalogue reused across all of them"] },
      { slug: "invoice-generator", label: "Free Invoice Generator", app: "/operations?tab=Sales&sub=Invoices",
        summary: "Create, send and track invoices.",
        points: ["Line items from your catalogue, with VAT and discounts", "Payment status you can see at a glance"] },
      { slug: "quotation-generator", label: "Free Quotation Generator", app: "/operations?tab=Sales&sub=Quotations",
        summary: "Quotations that turn into invoices when they are accepted.",
        points: ["Prices from your catalogue, or typed in", "Validity dates and terms that say where they came from"] },
      { slug: "receipt-generator", label: "Free Receipt Generator", app: "/operations?tab=Sales&sub=Receipts",
        summary: "Receipts for payments you have received.", points: ["Linked to the invoice they settle", "Sent only when you approve"] },
      { slug: "expense-tracking", label: "Expense Tracking", app: "/operations?tab=Transactions",
        summary: "Record what the business spends.", points: ["Paid and unpaid expenses", "Feeds your cash position and runway"] },
      { slug: "contract-management", label: "Contract Management", app: "/operations?tab=Contracts",
        summary: "Keep contracts with customers and suppliers in one place.", points: ["Start and end dates you can see coming", "Linked to the customer they are with"] },
    ],
  },
  {
    slug: "sell-and-grow", heading: "Sell & Grow", desc: "Launch to marketplace and increase visibility.",
    items: [
      { slug: "marketplace", label: "One-Click Marketplace Listing", app: "/marketplace",
        summary: "List your business on the EnterprateAI Marketplace.",
        points: ["A public profile built from your workspace", "Choose which offerings to show and which requests you want"] },
      { slug: "rfq-to-quotation", label: "RFQ to Quotation", app: "/operations?tab=Sales&sub=Quotations",
        summary: "Turn a request for a quotation into a draft quotation.", points: ["Prices from your catalogue", "Nothing is sent until you approve it"] },
      { slug: "marketplace-visibility", label: "Marketplace Visibility", app: "/marketplace",
        summary: "Be found by businesses looking for what you offer.", points: ["Search by service, location and trust status"] },
      { slug: "claim-your-business", label: "Already listed? Claim your business", app: "/marketplace?find=1",
        summary: "If your business already has a profile, claim it and take control of it.",
        points: ["Show that you manage the business", "Then choose what the profile says"] },
    ],
  },
  {
    slug: "decision-intelligence", heading: "Decision Intelligence", desc: "Simulate decisions and get business recommendations.",
    items: [
      { slug: "scenario-simulation", label: "Business Scenario Simulation", app: "/simulation",
        summary: "See what a decision would do to your business before you make it.",
        points: ["Losing a customer, a late payment, a price or cost change", "Worked out from your own records"] },
      { slug: "recommendations", label: "Business Intelligence Recommendations", app: "/simulation",
        summary: "Recommendations drawn from what your records show.", points: ["Each one says why it is suggested"] },
      { slug: "fragility-index", label: "Fragility Index", app: "/simulation",
        summary: "Where your business is vulnerable.", points: ["Customer concentration, cash runway and other pressure points"] },
      { slug: "adaptive-scenarios", label: "Adaptive Scenario Intelligence", app: "/simulation",
        summary: "Scenarios that follow your business as it changes.", points: ["Suggested from the stage your business is at"] },
    ],
  },
];

// The Agent has its own page too (it is what the homepage leads with).
export const AGENT_FEATURE = {
  slug: "agent", label: "The EnterprateAI Agent", app: "/dashboard",
  summary: "Tell it the job in your own words. It does the work and asks only for what it needs.",
  points: ["Reads your records and asks only for what is missing", "Prepares invoices, quotations, plans and answers",
    "Waits for your approval: nothing is sent until you say so"],
};

export const FEATURE_PAGES = [AGENT_FEATURE, ...FEATURE_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g })))];
export const featureBySlug = (slug) => FEATURE_PAGES.find((f) => f.slug === slug) || null;
export const groupBySlug = (slug) => FEATURE_GROUPS.find((g) => g.slug === slug) || null;

// Top navigation, in order. Features and Articles open menus; the rest are pages.
/** The top navigation as shown now: an item with a `when` appears only while it has something to show. */
export const visibleNav = () => TOP_NAV.filter((n) => !n.when || n.when());

export const TOP_NAV = [
  { key: "features", label: "Features", to: "/features", menu: "features" },
  { key: "how", label: "How it works", to: "/how-it-works" },
  { key: "use-cases", label: "Use cases", to: "/use-cases" },
  // Shown only while there are real, consented testimonials to show (content/testimonials.js).
  { key: "testimonials", label: "Testimonials", to: "/testimonials", when: () => shownTestimonials().length > 0 },
  { key: "pricing", label: "Pricing", to: "/pricing" },
  { key: "articles", label: "Articles", to: "/articles", menu: "articles" },
  // Hidden from the navbar for now (the owner, 16 Oct); the /marketplace page itself still works.
  // { key: "marketplace", label: "Marketplace", to: "/marketplace" },
  { key: "research", label: "R&D", to: "/research" },
];

export const FOOTER = [
  { heading: "Product", links: [{ label: "Features", to: "/features" }, { label: "Pricing", to: "/pricing" }, { label: "How it works", to: "/how-it-works" }] },
  { heading: "Solutions", links: [{ label: "For Startups", to: "/use-cases#startups" }, { label: "For Small Businesses", to: "/use-cases#small-businesses" }, { label: "For Growth", to: "/marketplace" }] },
  { heading: "Resources", links: [{ label: "Articles", to: "/articles" }, { label: "Research & Development", to: "/research" }, { label: "Help Centre", href: "mailto:support@enterprate.ai" }] },
  { heading: "Company", links: [...(shownTestimonials().length ? [{ label: "Testimonials", to: "/testimonials" }] : []), { label: "Privacy Policy", to: "/legal/privacy" }, { label: "Terms of Service", to: "/legal/terms" }, { label: "Contact", href: "mailto:support@enterprate.ai" }] },
];
