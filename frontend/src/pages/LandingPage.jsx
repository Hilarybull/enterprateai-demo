import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import logoUrl from "../enterprate-logo.png";
import { apiRequest } from "../api/client";

const PROBLEMS = [
  {
    icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
    title: "Repeated work",
    body: "You enter the same business data in multiple places like plans, invoices, and proposals, wasting time and risking inconsistencies.",
  },
  {
    icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
    title: "Rising cost",
    body: "Juggling multiple tools and services adds up quickly, draining resources that could be invested in growth.",
  },
  {
    icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
    title: "Hidden risk",
    body: "Without clear visibility into your business operations and decisions, risks go unnoticed until it's too late.",
  },
];

const PILLARS = [
  { icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2", label: "Plan", path: "/blueprint" },
  { icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z", label: "Operate", path: "/catalogue" },
  { icon: "M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z", label: "Sell", path: "/financials" },
  { icon: "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z", label: "Decide", path: "/simulation" },
];

const FEATURES = [
  { icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2", label: "Plan", body: "Validate ideas, create business plans, and build a solid foundation for growth, all in one intelligent workspace.", path: "/blueprint" },
  { icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z", label: "Operate", body: "Manage products, customers, vendors, and business data seamlessly with tools designed for efficiency.", path: "/catalogue" },
  { icon: "M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z", label: "Sell", body: "Generate proposals, invoices, quotations, and marketplace listings instantly from your business data.", path: "/financials" },
  { icon: "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z", label: "Decide", body: "Simulate scenarios, assess fragility, and make data-driven decisions with adaptive intelligence before committing resources.", path: "/simulation" },
];

const BENEFITS = [
  { icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", title: "Save time", body: "Input your business data once and reuse it across plans, proposals, invoices, and simulations." },
  { icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z", title: "Cut cost", body: "Replace multiple expensive tools with one integrated platform designed for small business needs." },
  { icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", title: "Reduce risk", body: "Identify business fragility and test decisions before acting, protecting your resources and reputation." },
  { icon: "M13 10V3L4 14h7v7l9-11h-7z", title: "Move faster", body: "Generate documents, proposals, and plans instantly with intelligent automation from your workspace." },
  { icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", title: "Make better decisions", body: "Simulate scenarios and assess outcomes with adaptive intelligence, choosing the best path forward." },
  { icon: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z", title: "Grow with intelligence", body: "Leverage AI-powered insights and recommendations tailored to your business context and goals." },
];

const HOW_IT_WORKS = [
  { n: "1", icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z", title: "Input once", body: "Add your business data, products, customers, and context into your workspace." },
  { n: "2", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15", title: "Generate everywhere", body: "Automatically create plans, proposals, invoices, quotations, and marketplace listings from your data." },
  { n: "3", icon: "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z", title: "Simulate before acting", body: "Test decisions and scenarios with adaptive intelligence before committing resources." },
  { n: "4", icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z", title: "Grow with intelligence", body: "Receive AI-powered insights, fragility assessments, and recommendations tailored to your business." },
];

const ACTIVITIES = [
  { icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z", label: "Validate a business idea", desc: "Test your concept with structured validation frameworks before investing time and money.", path: "/validation" },
  { icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01", label: "Create a business plan", desc: "Build comprehensive, professional business plans using your workspace data and intelligent templates.", path: "/blueprint" },
  { icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", label: "Generate a proposal", desc: "Create winning business proposals and sales letters automatically from your business information.", path: "/blueprint" },
  { icon: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z", label: "Create invoices and quotations", desc: "Generate professional invoices and quotations instantly from your products and customer data.", path: "/financials" },
  { icon: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z", label: "Launch to marketplace", desc: "List your services on the EnterprateAI marketplace and connect with potential clients.", path: "/marketplace" },
  { icon: "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z", label: "Simulate a decision", desc: "Test business decisions and scenarios with adaptive scenario intelligence before committing.", path: "/simulation" },
  { icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z", label: "Discover business risks", desc: "Assess your business fragility index and identify hidden vulnerabilities before they impact you.", path: "/simulation" },
];

const TESTIMONIALS = [
  { quote: "I was unsure about taking on a new employee, but the scenario intelligence helped me model the hiring decision perfectly. I could see the exact impact on my cash flow before making any commitment.", name: "Victor", role: "Rhema Concept London", init: "V", color: "bg-brand-500" },
  { quote: "Using this platform gave me the confidence to model a price increase. Seeing the simulated impact on our bottom line removed the fear of losing customers and helped us grow revenue securely.", name: "Irene A.", role: "Sombeauty London Ltd UK", init: "IA", color: "bg-accent-500" },
  { quote: "This is like having a virtual CFO in my pocket. It gives me incredible confidence in my daily decisions and helps me run my auto business with a level of clarity I never thought possible.", name: "Gilbert C.", role: "OIC3 Auto Services Ltd UK", init: "GC", color: "bg-emerald-500" },
];

const PLANS = [
  {
    name: "Explorer", monthly: 0, annual: 0, free: true,
    desc: "For testing the platform and starting simple",
    features: ["No credit card required", "Basic idea validation", "Business plan access", "Invoices and quotations", "Marketplace listing", "Basic business workspace"],
    highlight: false,
  },
  {
    name: "Starter", tier: "Insight", monthly: 19, annual: 15.83, annualSaving: 38, free: false,
    desc: "For solo founders and new service businesses that want more planning, proposals, simulations, and intelligence",
    features: ["Idea validations", "Business plans", "Business proposals", "Sales letters", "Scenario simulation", "Fragility Index", "Adaptive Scenario Intelligence", "Unlimited products, customers & vendors", "Unlimited invoices & quotations", "1 marketplace listing", "1 user"],
    highlight: true, badge: "Best Value",
  },
];

const FAQS = [
  { q: "Is EnterprateAI free to start?", a: "Yes. The Explorer plan is free forever with no credit card required. You get basic idea validation, a business plan, unlimited financial tools, and more, all powered by AI credits." },
  { q: "Do I need a credit card to try EnterprateAI?", a: "No. You can start completely free on the Explorer plan with no credit card required. Upgrade to a paid plan whenever you are ready." },
  { q: "What type of businesses can use EnterprateAI?", a: "EnterprateAI is built for UK small businesses — founders, freelancers, consultants, service providers, suppliers, agencies, and early-stage startups. If you run a small business and want to save time, reduce cost, and make better decisions, EnterprateAI is for you." },
  { q: "Is this only for business plans?", a: "No. EnterprateAI covers the full business operating cycle — planning, operations, sales documents, marketplace listings, decision simulations, fragility analysis, and growth intelligence. Business plans are just one output." },
  { q: "Can I create invoices and quotations?", a: "Yes. EnterprateAI generates professional invoices and quotations directly from your saved business, product, customer, and service data — no manual re-entry needed." },
  { q: "How does decision simulation work?", a: "You input a business scenario — like a price change, new hire, or cost cut — and EnterprateAI models the likely impact across your revenue, cashflow, profitability, and risk exposure before you commit." },
  { q: "Is my business data secure?", a: "Yes. All data is encrypted in transit (TLS 1.3) and at rest (AES-256). We are ICO Registered, GDPR compliant, and never share or sell your data. You can delete your data at any time." },
  { q: "Can I cancel anytime?", a: "Yes. No lock-in contracts, no cancellation fees. Cancel from your account settings in 30 seconds. Your data remains accessible for 30 days after cancellation." },
];

const TRUST = [
  { icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", label: "Free to start" },
  { icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z", label: "No credit card required" },
  { icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z", label: "GDPR compliant" },
  { icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4", label: "Registered UK company" },
  { icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z", label: "Built for small businesses" },
];

function Icon({ d, className = "h-5 w-5" }) {
  const paths = d.split(" M ").map((p, i) => (i === 0 ? p : "M " + p));
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {paths.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button type="button" onClick={() => setOpen(v => !v)} className="flex w-full items-start justify-between gap-4 py-4 text-left">
        <span className="text-sm font-medium text-slate-800">{q}</span>
        <span className={`mt-0.5 shrink-0 text-slate-400 transition-transform duration-200 text-lg leading-none ${open ? "rotate-45" : ""}`}>+</span>
      </button>
      {open && <p className="pb-4 text-sm leading-relaxed text-slate-500">{a}</p>}
    </div>
  );
}

export default function LandingPage() {
  const [annualBilling, setAnnualBilling] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [articlesOpen, setArticlesOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const featuresRef = useRef(null);
  const articlesRef = useRef(null);

  const [blogCategories, setBlogCategories] = useState([]);

  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 10); }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    apiRequest("/blog/categories", "GET")
      .then((data) => { if (Array.isArray(data)) setBlogCategories(data); })
      .catch(() => {});
  }, []);

  // Navigate to an in-app feature — skip login if already authenticated
  function goToFeature(path) {
    setFeaturesOpen(false);
    setArticlesOpen(false);
    const token = localStorage.getItem("ea_token");
    navigate(token ? path : "/login");
  }

  // Generic CTA — go to dashboard if logged in, login otherwise
  function goToApp() {
    const token = localStorage.getItem("ea_token");
    navigate(token ? "/dashboard" : "/login");
  }
  useEffect(() => {
    function handleClick(e) {
      if (featuresRef.current && !featuresRef.current.contains(e.target)) setFeaturesOpen(false);
      if (articlesRef.current && !articlesRef.current.contains(e.target)) setArticlesOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);
  const [showExitPopup, setShowExitPopup] = useState(false);
  const [exitDismissed, setExitDismissed] = useState(false);
  const exitTimerRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    function onMouseLeave(e) {
      if (e.clientY > 10) return;
      clearTimeout(exitTimerRef.current);
      const hasToken = !!localStorage.getItem("ea_token");
      if (!hasToken && !exitDismissed && !showExitPopup) {
        exitTimerRef.current = setTimeout(() => setShowExitPopup(true), 400);
      }
    }
    document.addEventListener("mouseleave", onMouseLeave);
    return () => { document.removeEventListener("mouseleave", onMouseLeave); clearTimeout(exitTimerRef.current); };
  }, [exitDismissed, showExitPopup]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-white font-sans text-slate-800 antialiased">

      {/* Exit popup */}
      {showExitPopup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 sm:p-8 shadow-2xl">
            <button type="button" onClick={() => { setShowExitPopup(false); setExitDismissed(true); }} className="absolute right-4 top-4 text-slate-400 hover:text-slate-600">✕</button>
            <div className="mb-1 flex items-center gap-2"><span className="text-2xl">👋</span><span className="text-xs font-semibold uppercase tracking-widest text-brand-600">Before you go</span></div>
            <h3 className="mt-2 text-xl font-bold text-slate-900">Get started for free</h3>
            <p className="mt-2 text-sm text-slate-500">EnterprateAI gives you the business intelligence tools to validate ideas, run scenario simulations, and make smarter decisions — completely free to start.</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              {["Validate your business idea in minutes", "Run scenario simulations before committing", "Generate investor-ready business plans"].map(f => (
                <li key={f} className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span>{f}</li>
              ))}
            </ul>
            <button type="button" onClick={() => goToApp()} className="mt-5 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 transition">Get Started Free →</button>
            <button type="button" onClick={() => { setShowExitPopup(false); setExitDismissed(true); }} className="mt-2 w-full rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">Maybe later</button>
            <p className="mt-3 text-center text-xs text-slate-400">Free plan · No credit card required</p>
          </div>
        </div>
      )}

      {/* NAV */}
      <nav className={`fixed top-0 left-0 right-0 z-50 border-b border-slate-100 bg-white/95 backdrop-blur transition-all duration-200 ${scrolled ? "shadow-sm" : ""}`}>
        <div className={`mx-auto flex max-w-[1280px] items-center justify-between px-4 sm:px-6 transition-all duration-200 ${scrolled ? "py-2" : "py-3"}`}>
          <a href="#hero" className="shrink-0"><img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto sm:h-8" /></a>
          <ul className="hidden items-center gap-5 xl:flex">
            {/* Features mega-dropdown */}
            <li ref={featuresRef} className="relative">
              <button
                type="button"
                onClick={() => setFeaturesOpen(v => !v)}
                className="flex items-center gap-1 whitespace-nowrap text-sm font-medium text-slate-600 transition hover:text-brand-600"
              >
                Features
                <svg className={`h-3.5 w-3.5 transition-transform ${featuresOpen ? "rotate-180" : ""}`} viewBox="0 0 16 16" fill="currentColor"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              {featuresOpen && (
                <div className="absolute left-1/2 top-full z-50 mt-3 w-[720px] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5">
                  <div className="grid grid-cols-4 gap-0 p-6">
                    {[
                      {
                        heading: "Plan & Prepare", desc: "Validate ideas and create business documents faster.",
                        items: [
                          { label: "Idea Validation", path: "/validation" },
                          { label: "One-Click Business Plan Generator", path: "/blueprint?doc=business_plan" },
                          { label: "One-Click Business Proposal Generator", path: "/blueprint?doc=client_proposal" },
                          { label: "One-Click Sales Letter Generator", path: "/blueprint?doc=sales_letter" },
                        ],
                      },
                      {
                        heading: "Operate & Manage", desc: "Create invoices, quotations, receipts, expenses, and contracts.",
                        items: [
                          { label: "Free Invoice Generator", path: "/financials?tab=invoices" },
                          { label: "Free Quotation Generator", path: "/financials?tab=quotes" },
                          { label: "Free Receipt Generator", path: "/financials?tab=receipts" },
                          { label: "Expense Tracking", path: "/financials?tab=expenses" },
                          { label: "Contract Management", path: "/financials?tab=contracts" },
                        ],
                      },
                      {
                        heading: "Sell & Grow", desc: "Launch to marketplace and increase visibility.",
                        items: [
                          { label: "One-Click Marketplace Listing", path: "/marketplace" },
                          { label: "RFQ to Quotation", path: "/financials?tab=quotes" },
                          { label: "Marketplace Visibility", path: "/marketplace" },
                        ],
                      },
                      {
                        heading: "Decision Intelligence", desc: "Simulate decisions and get business recommendations.",
                        items: [
                          { label: "Business Scenario Simulation", path: "/simulation" },
                          { label: "Business Intelligence Recommendations", path: "/simulation" },
                          { label: "Fragility Index", path: "/simulation" },
                          { label: "Adaptive Scenario Intelligence", path: "/simulation" },
                        ],
                      },
                    ].map((col) => (
                      <div key={col.heading} className="px-3 first:pl-0 last:pr-0 border-r border-slate-100 last:border-r-0">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">{col.heading}</p>
                        <p className="mt-0.5 mb-3 text-[11px] text-slate-400 leading-snug">{col.desc}</p>
                        <ul className="space-y-2">
                          {col.items.map((item) => (
                            <li key={item.label}>
                              <button type="button" onClick={() => goToFeature(item.path)} className="block text-left text-[12.5px] text-slate-600 hover:text-brand-600 transition leading-snug">{item.label}</button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </li>
            {/* Articles dropdown */}
            <li ref={articlesRef} className="relative">
              <button
                type="button"
                onClick={() => setArticlesOpen(v => !v)}
                className="flex items-center gap-1 whitespace-nowrap text-sm font-medium text-slate-600 transition hover:text-brand-600"
              >
                Articles
                <svg className={`h-3.5 w-3.5 transition-transform ${articlesOpen ? "rotate-180" : ""}`} viewBox="0 0 16 16" fill="currentColor"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              {articlesOpen && (
                <div className="absolute left-1/2 top-full z-50 mt-3 w-[480px] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5">
                  <div className="p-5">
                    <button
                      type="button"
                      onClick={() => { setArticlesOpen(false); navigate("/blog"); }}
                      className="mb-4 flex w-full items-start justify-between rounded-xl bg-brand-50 px-4 py-3 text-left hover:bg-brand-100 transition"
                    >
                      <div>
                        <p className="text-sm font-bold text-brand-700">Articles Hub</p>
                        <p className="mt-0.5 text-[11px] text-slate-500 leading-snug max-w-[300px]">Insights to help small businesses plan, operate, sell, reduce risk, and grow with intelligence.</p>
                      </div>
                      <span className="text-brand-500 text-lg">→</span>
                    </button>
                    {blogCategories.length > 0 ? (
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                        {blogCategories.map((cat) => (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => { setArticlesOpen(false); navigate(`/blog?category=${cat.slug}`); }}
                            className="text-left text-[12.5px] text-slate-600 hover:text-brand-600 transition py-0.5"
                          >
                            {cat.name}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-slate-400">No categories yet.</p>
                    )}
                  </div>
                </div>
              )}
            </li>
            {[["#how-it-works", "How it works"], ["#activities", "Use cases"], ["#testimonials", "Testimonials"], ["#pricing", "Pricing"], ["#faq", "FAQ"]].map(([href, label]) => (
              <li key={href}><a href={href} className="whitespace-nowrap text-sm font-medium text-slate-600 transition hover:text-brand-600">{label}</a></li>
            ))}
          </ul>
          <div className="flex shrink-0 items-center gap-3">
            <Link to="/login" className="hidden whitespace-nowrap text-sm font-medium text-slate-600 hover:text-slate-900 xl:block">Sign in</Link>
            <button type="button" onClick={() => goToApp()} className="hidden whitespace-nowrap rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 xl:block">Create My Free Business Workspace</button>
            <button type="button" onClick={() => setMobileMenuOpen(v => !v)} className="ml-1 flex h-9 w-9 flex-col items-center justify-center gap-1.5 xl:hidden" aria-label="Menu">
              <span className={`block h-0.5 w-5 bg-slate-700 transition-all ${mobileMenuOpen ? "translate-y-2 rotate-45" : ""}`} />
              <span className={`block h-0.5 w-5 bg-slate-700 transition-all ${mobileMenuOpen ? "opacity-0" : ""}`} />
              <span className={`block h-0.5 w-5 bg-slate-700 transition-all ${mobileMenuOpen ? "-translate-y-2 -rotate-45" : ""}`} />
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="border-t border-slate-100 bg-white px-4 pb-4 xl:hidden">
            <ul className="mt-3 flex flex-col gap-3">
              {[["#how-it-works", "How it works"], ["#activities", "Use cases"], ["#testimonials", "Testimonials"], ["#pricing", "Pricing"], ["#faq", "FAQ"]].map(([href, label]) => (
                <li key={href}><a href={href} onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-slate-700">{label}</a></li>
              ))}
              <li><Link to="/login" className="block text-sm font-medium text-slate-700">Sign in</Link></li>
            </ul>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Features</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {[
                  { label: "Idea Validation", path: "/validation" },
                  { label: "Business Plan", path: "/blueprint?doc=business_plan" },
                  { label: "Business Proposal", path: "/blueprint?doc=client_proposal" },
                  { label: "Sales Letter", path: "/blueprint?doc=sales_letter" },
                  { label: "Invoice Generator", path: "/financials?tab=invoices" },
                  { label: "Quotation Generator", path: "/financials?tab=quotes" },
                  { label: "Receipt Generator", path: "/financials?tab=receipts" },
                  { label: "Expense Tracking", path: "/financials?tab=expenses" },
                  { label: "Contract Management", path: "/financials?tab=contracts" },
                  { label: "Marketplace Listing", path: "/marketplace" },
                  { label: "RFQ to Quotation", path: "/financials?tab=quotes" },
                  { label: "Scenario Simulation", path: "/simulation" },
                  { label: "BI Recommendations", path: "/simulation" },
                  { label: "Fragility Index", path: "/simulation" },
                ].map(f => (
                  <button key={f.label} type="button" onClick={() => { setMobileMenuOpen(false); goToFeature(f.path); }} className="py-0.5 text-left text-xs text-slate-600 hover:text-brand-600">{f.label}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </nav>

      <div className="h-[61px]" />

      {/* HERO */}
      <section id="hero" className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-700 to-brand-800 pb-20 pt-16 sm:pt-24 text-white">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <img src="/her0.png" alt="" aria-hidden="true" className="h-full w-full object-cover object-center opacity-[0.18] select-none" />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-brand-900/40" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "32px 32px" }} />
        <div className="pointer-events-none absolute -right-40 -top-40 h-[600px] w-[600px] rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-[400px] w-[400px] rounded-full bg-accent-500/20 blur-3xl" />
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
          <h1 className="mt-5 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            Run your small business with more clarity, less cost, and better decisions.
          </h1>
          <p className="mt-3 text-sm font-semibold text-white sm:text-base">Your Business Operating System</p>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-white/90 sm:text-base">
            Input your business data once. Use it everywhere. Plan, operate, sell, simulate decisions, and grow with intelligence.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button type="button" onClick={() => goToApp()} className="w-full rounded-xl border border-white/40 bg-white/10 px-8 py-3.5 text-sm font-bold text-white transition hover:bg-white/20 active:scale-95 sm:w-auto">
              Create My Free Business Workspace
            </button>
            <a href="#how-it-works" className="flex w-full items-center justify-center rounded-xl bg-slate-800/80 px-8 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-900 sm:w-auto">
              See How It Works
            </a>
          </div>
          <p className="mt-4 text-xs text-white/80">Free to start. No credit card required.</p>

          {/* Pillar cards */}
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PILLARS.map(p => (
              <button key={p.label} type="button" onClick={() => goToFeature(p.path)} className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-5 backdrop-blur-sm transition hover:bg-white/20 active:scale-95">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500">
                  <Icon d={p.icon} className="h-6 w-6 text-white" />
                </div>
                <span className="text-sm font-bold text-white">{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="bg-brand-50/30 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">The Problem</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Small businesses lack clarity</h2>
            <p className="mt-3 mx-auto max-w-xl text-slate-500">Most small business owners face scattered information, repeated work, rising costs, and hidden risks, making it hard to make confident decisions.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            {PROBLEMS.map(p => (
              <div key={p.title} className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50">
                  <Icon d={p.icon} className="h-5 w-5 text-rose-500" />
                </div>
                <h3 className="font-bold text-slate-900">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">The Solution</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">One workspace for planning, operations, visibility, and smarter decisions.</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(f => (
              <div key={f.label} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 hover:border-brand-200 hover:shadow-md transition">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500">
                  <Icon d={f.icon} className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-bold text-slate-900">{f.label}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{f.body}</p>
                <button type="button" onClick={() => goToFeature(f.path)} className="mt-4 text-left text-sm font-semibold text-brand-600 hover:text-brand-700 transition">
                  Explore {f.label} →
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="bg-brand-50/30 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">Why It Matters</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Built to help small businesses become more resilient.</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map(b => (
              <div key={b.title} className="rounded-2xl border border-slate-200 bg-white p-6 hover:border-brand-200 hover:shadow-sm transition">
                <div className="mb-3">
                  <Icon d={b.icon} className="h-6 w-6 text-brand-500" />
                </div>
                <h3 className="font-semibold text-slate-900">{b.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="py-16 sm:py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">How It Works</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Input once. Use everywhere. Decide smarter.</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map(s => (
              <div key={s.n} className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center">
                <div className="mb-3">
                  <Icon d={s.icon} className="h-6 w-6 text-slate-400" />
                </div>
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{s.n}</div>
                <h3 className="font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ACTIVITIES */}
      <section id="activities" className="bg-brand-50/30 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">Choose Your Starting Point</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">What do you want to do today?</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ACTIVITIES.map(a => (
              <div key={a.label} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-3">
                  <Icon d={a.icon} className="h-6 w-6 text-slate-400" />
                </div>
                <h3 className="font-semibold text-slate-900">{a.label}</h3>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-slate-500">{a.desc}</p>
                <button type="button" onClick={() => goToFeature(a.path)} className="mt-5 w-full rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700">
                  Start here →
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section id="testimonials" className="bg-brand-50/30 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">What Users Say</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Business Owners Who Stopped Guessing</h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="mb-3 text-amber-400 text-sm">★★★★★</div>
                <blockquote className="text-sm leading-relaxed text-slate-700 italic">"{t.quote}"</blockquote>
                <div className="mt-5 flex items-center gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${t.color}`}>{t.init}</div>
                  <div><p className="text-sm font-semibold text-slate-900">{t.name}</p><p className="text-xs text-slate-400">{t.role}</p></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MISSION */}
      <section className="bg-brand-50/30 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">Our Mission</span>
          <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Helping more small businesses survive, grow, and make better decisions.</h2>
          <p className="mt-5 text-slate-600">Too many small businesses fail not because of poor ideas, but because of poor information, scattered tools, and uninformed decisions.</p>
          <p className="mt-3 text-slate-600">EnterprateAI exists to change that. We provide UK entrepreneurs with an intelligent workspace that brings clarity to complexity, reduces operational costs, and empowers better decision-making through adaptive intelligence.</p>
          <p className="mt-3 text-slate-600">We believe that every small business deserves access to the same quality of business intelligence and decision support that larger enterprises enjoy, without the enterprise price tag.</p>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">Pricing</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Start free. Upgrade when your business needs more intelligence.</h2>
            <div className="mt-6 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button type="button" onClick={() => setAnnualBilling(false)} className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${!annualBilling ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-700"}`}>Monthly</button>
              <button type="button" onClick={() => setAnnualBilling(true)} className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition ${annualBilling ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-700"}`}>
                Annual <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Save 17%</span>
              </button>
            </div>
          </div>
          <div className="mx-auto grid max-w-3xl gap-5 sm:grid-cols-2 sm:items-stretch">
            {PLANS.map(plan => (
              <div key={plan.name} className={`relative flex flex-col rounded-2xl border bg-white p-6 ${plan.highlight ? "border-brand-400 ring-2 ring-brand-200 shadow-xl shadow-brand-100" : "border-slate-200"}`}>
                {plan.badge && <div className="absolute left-1/2 -top-3.5 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-xs font-bold text-white">{plan.badge}</div>}
                <div className="mt-2 text-center">
                  <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                </div>
                <div className="mt-3 text-center">
                  {plan.free ? (
                    <><span className="text-4xl font-extrabold text-slate-900">£0</span></>
                  ) : (
                    <><span className="text-4xl font-extrabold text-slate-900">£{annualBilling ? plan.annual : plan.monthly}</span><span className="text-sm text-slate-400">/mo</span></>
                  )}
                </div>
                <p className="mt-1 text-center text-xs text-slate-400">{plan.free ? "Free forever" : annualBilling ? `Billed annually (save £${plan.annualSaving}/yr)` : "Billed monthly"}</p>
                {plan.desc && <p className="mt-3 text-center text-xs text-slate-500">{plan.desc}</p>}
                <button type="button" onClick={() => goToApp()} className={`mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold transition ${plan.free ? "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50" : "bg-brand-600 text-white hover:bg-brand-700"}`}>
                  {plan.free ? "Start Free" : `Get Started - £${plan.monthly}/month`}
                </button>
                <ul className="mt-5 flex-1 space-y-2.5">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-600"><span className="mt-0.5 shrink-0 text-brand-500">✓</span>{f}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-slate-400">Prices exclude VAT where applicable. Cancel anytime.</p>
        </div>
      </section>

      {/* TRUST ROW */}
      <section className="pb-16 sm:pb-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {TRUST.map(t => (
              <div key={t.label} className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white p-5 text-center">
                <Icon d={t.icon} className="h-7 w-7 text-brand-500" />
                <span className="text-xs font-medium text-slate-600">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="bg-brand-50/30 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">Common Questions</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Everything you need to know</h2>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 sm:px-6">
            {FAQS.map(f => <FAQItem key={f.q} q={f.q} a={f.a} />)}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-brand-600 py-20 text-white">
        <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-extrabold sm:text-3xl lg:text-4xl">Start building a clearer, stronger business today.</h2>
          <p className="mt-4 text-base text-white/80">Input your business data once. Use it to plan, operate, sell, simulate, and grow with intelligence.</p>
          <button type="button" onClick={() => goToApp()} className="mt-8 rounded-xl border border-white/40 bg-white/10 px-10 py-4 text-base font-semibold text-white transition hover:bg-white/20 active:scale-95">
            Create My Free Business Workspace
          </button>
          <p className="mt-4 text-sm text-white/70">Free to start. No credit card required.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-slate-900 py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-10 sm:grid-cols-3">
            <div>
              <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto" />
              <p className="mt-4 text-sm leading-relaxed text-slate-400">The intelligent business decision engine for UK entrepreneurs. Navigate complexity with clarity and confidence.</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Legal &amp; Compliance</h4>
              <ul className="mt-4 space-y-2">
                <li><Link to="/legal/privacy" className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition"><Icon d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" className="h-3.5 w-3.5 shrink-0 text-slate-500" /> Privacy Policy</Link></li>
                <li><Link to="/legal/terms" className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition"><Icon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" className="h-3.5 w-3.5 shrink-0 text-slate-500" /> Terms of Service</Link></li>
                <li><a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition"><Icon d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" className="h-3.5 w-3.5 shrink-0 text-slate-500" /> ICO Website</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Contact Us</h4>
              <ul className="mt-4 space-y-2">
                <li><a href="mailto:support@enterpate.ai" className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition"><Icon d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" className="h-3.5 w-3.5 shrink-0 text-slate-500" /> support@enterpate.ai</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-10 border-t border-slate-800 pt-6">
            <p className="text-center text-xs text-slate-500">© {new Date().getFullYear()} Enterprate Limited. All rights reserved. Registered in England &amp; Wales.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
