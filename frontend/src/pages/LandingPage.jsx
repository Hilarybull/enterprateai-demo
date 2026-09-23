import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import logoUrl from "../enterprate-logo.png";
import { apiRequest } from "../api/client";
import { useAuthStore } from "../store/auth";


const PLANS = [
  {
    name: "Explorer", monthly: 0, annual: 0, free: true,
    creditsCaption: "50 Credits",
    desc: "For Exploring",
    features: ["Basic Idea Validation", "AI Business Plan Generator", "Invoices, Receipts, Contracts, Expense Tracker", "Receive and Request for Quotations", "Products, Customers, Vendors", "Business Registration Guide, Verification", "1 Marketplace listing"],
    highlight: false,
  },
  {
    name: "Starter", tier: "Insight", monthly: 19, annual: 15.83, annualSaving: 38, free: false,
    desc: "For solo founders and new service businesses that want more planning, proposals, simulations, and intelligence",
    ctaLabel: "Get Started - 500 credits/mo",
    features: ["Everything on the Explorer Plan", "Comprehensive Idea Validation", "AI Business Proposals Generator", "AI Sales Letters Generator", "Manage, Receive and Request for Proposals, Quotations", "4 Scenario simulations", "Fragility Index", "Adaptive Scenario Intelligence", "Multiple marketplace listings"],
    highlight: true, badge: "Best Value",
  },
  {
    name: "Decision Engine",
    monthly: 59,
    annual: 49.17,
    annualSaving: 118,
    free: false,
    desc: "For teams that need deeper AI support, live-plan intelligence, and multi-user decision making",
    ctaLabel: "Get Started - 2000 credits/mo",
    features: ["Everything on the Starter Plan", "3rd Party Integrations", "Live Business Plan Intelligence", "Multiple Scenario Simulations"],
    highlight: false,
  },
];

function Icon({ d, className = "h-5 w-5" }) {
  const paths = d.split(" M ").map((p, i) => (i === 0 ? p : "M " + p));
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {paths.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

// Handwritten annotation with a curved arrow, matching the mockup's hand-drawn callouts.
// Hidden below 768px (fully removed from layout, not just visually) so it can never
// overlap or clip on tablet/mobile. Parents must allow overflow: visible since these
// are meant to sit outside the card/photo they point at.
function Annotation({ children, className = "", color = "text-brand-500", rotate = "-rotate-6", arrow = "down", showFrom = "md" }) {
  const arrows = {
    down: "M6 3c1 12 4 20 11 25m0 0-7-1m7 1-2-7",
    downLeft: "M26 3c-4 11-12 19-21 23m0 0 7 1m-7-1 2-6",
    up: "M6 29c1-12 4-20 11-25m0 0-7 1m7-1-2 7",
    upLeft: "M26 29c-4-11-12-19-21-23m0 0 7-1m-7 1 2 6",
    left: "M29 16c-12 1-20 4-25 11m0 0 1-7m-1 7 7 2",
    leftUp: "M29 6c-12 1-21 5-25 13m0 0 2-7m-2 7 7 1",
  };
  const visibility = showFrom === "lg" ? "hidden lg:block" : "hidden md:block";
  return (
    <div className={`pointer-events-none ${visibility} ${className}`} aria-hidden="true">
      <p className={`${rotate} whitespace-nowrap leading-snug ${color}`} style={{ fontFamily: "'Caveat', cursive", fontWeight: 600, fontSize: "24px" }}>
        {children}
      </p>
      <svg className={`h-10 w-10 ${color}`} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={arrows[arrow]} />
      </svg>
    </div>
  );
}
const ROLES = ["Founder / Co-founder","Business Owner","Operations Manager","Sales / Business Development","Finance / Accounting","Marketing","Product / Tech","Investor / Advisor","Other"];

export default function LandingPage() {
  const [annualBilling, setAnnualBilling] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [articlesOpen, setArticlesOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const featuresRef = useRef(null);
  const articlesRef = useRef(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingForm, setBookingForm] = useState({ name: "", email: "", company: "", phone: "", role: "", message: "" });
  const [bookingStatus, setBookingStatus] = useState("idle");
  const [bookingError, setBookingError] = useState("");

  function openBooking() { setBookingOpen(true); setBookingStatus("idle"); setBookingError(""); }
  function closeBooking() { setBookingOpen(false); }
  function setBookingField(field) { return (e) => setBookingForm(f => ({ ...f, [field]: e.target.value })); }
  async function submitBooking(e) {
    e.preventDefault();
    if (!bookingForm.name.trim() || !bookingForm.email.trim() || !bookingForm.company.trim()) return;
    setBookingStatus("loading");
    setBookingError("");
    try {
      await apiRequest("/demo/book", "POST", {
        name: bookingForm.name.trim(), email: bookingForm.email.trim(),
        company: bookingForm.company.trim(), phone: bookingForm.phone.trim() || undefined,
        role: bookingForm.role || undefined, message: bookingForm.message.trim() || undefined,
      });
      setBookingStatus("success");
    } catch (err) {
      setBookingStatus("error");
      setBookingError(err?.message || "Something went wrong. Please try again.");
    }
  }

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
    // The free essentials page is public, so it should never be sent through the login gate.
    if (path === "/essentials") {
      navigate(path);
      return;
    }
    const token = localStorage.getItem("ea_token");
    navigate(token ? path : `/login?next=${encodeURIComponent(path)}`);
  }

  // Generic CTA — go to dashboard if logged in (non-demo), signup otherwise
  function goToApp() {
    const token = localStorage.getItem("ea_token");
    const isDemo = localStorage.getItem("ea_email") === "demo";
    if (isDemo) {
      logout();
      navigate("/login?signup=1");
    } else {
      navigate(token ? "/dashboard" : "/login?signup=1");
    }
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
  const logout = useAuthStore((s) => s.logout);

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
        <div className={`mx-auto flex max-w-[1600px] items-center px-4 sm:px-6 transition-all duration-200 ${scrolled ? "py-2" : "py-3"}`}>
          <a href="#hero" className="shrink-0 mr-6"><img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto sm:h-8" /></a>
          <ul className="hidden flex-1 items-center justify-center gap-3 xl:gap-4 xl:flex">
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
                <div className="absolute left-0 top-full z-50 mt-3 w-[680px] rounded-2xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5">
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
                          { label: "Free Business Essentials", path: "/essentials" },
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
            {[["#how-it-works", "How it works"], ["#activities", "Use cases"], ["#testimonials", "Testimonials"], ["#pricing", "Pricing"]].map(([href, label]) => (
              <li key={href}><a href={href} className="whitespace-nowrap text-sm font-medium text-slate-600 transition hover:text-brand-600">{label}</a></li>
            ))}
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
            <li>
              <Link to="/research" className="whitespace-nowrap text-sm font-medium text-slate-600 transition hover:text-brand-600">R&amp;D</Link>
            </li>
          </ul>
          <div className="flex shrink-0 items-center gap-3 ml-6">
            <Link to="/login" className="hidden whitespace-nowrap text-sm font-medium text-slate-600 hover:text-slate-900 xl:block">Sign in</Link>
            <Link to="/book-demo" className="hidden whitespace-nowrap rounded-xl border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-600 transition hover:bg-brand-50 xl:block">Book a Demo</Link>
            <button type="button" onClick={() => goToApp()} className="hidden whitespace-nowrap rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 xl:block">
              Get Started Free
            </button>
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
              {[["#how-it-works", "How it works"], ["#activities", "Use cases"], ["#testimonials", "Testimonials"], ["#pricing", "Pricing"]].map(([href, label]) => (
                <li key={href}><a href={href} onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-slate-700">{label}</a></li>
              ))}
              <li><Link to="/blog" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-slate-700">Articles</Link></li>
              <li><Link to="/research" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-slate-700">R&amp;D</Link></li>
              <li><Link to="/login" className="block text-sm font-medium text-slate-700">Sign in</Link></li>
              <li><Link to="/book-demo" onClick={() => setMobileMenuOpen(false)} className="block rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white text-center">Book a Demo</Link></li>
            </ul>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Features</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {[
                  { label: "Idea Validation", path: "/validation" },
                  { label: "Business Plan", path: "/blueprint?doc=business_plan" },
                  { label: "Business Proposal", path: "/blueprint?doc=client_proposal" },
                  { label: "Sales Letter", path: "/blueprint?doc=sales_letter" },
                  { label: "Free Business Essentials", path: "/essentials" },
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
      <section id="hero" className="relative overflow-hidden bg-gradient-to-b from-brand-50/70 via-white to-white pb-6 pt-6 sm:pb-8 sm:pt-8">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -right-16 top-0 h-[520px] w-[520px] rounded-full bg-gradient-to-br from-purple-300/60 to-brand-300/50 blur-2xl sm:h-[620px] sm:w-[620px]" />
          <div className="absolute right-10 top-14 hidden h-64 w-64 opacity-80 sm:block" style={{ backgroundImage: "radial-gradient(circle, #A5B4FC 2px, transparent 2px)", backgroundSize: "18px 18px" }} />
        </div>
        <div className="relative mx-auto max-w-[1600px] px-4 sm:px-6">
          <div className="grid items-center gap-8 lg:grid-cols-[1.15fr_1fr]">
            <div className="text-center lg:text-left">
              <span className="text-xs font-bold uppercase tracking-widest text-brand-600">AI-Native Business Decision Intelligence</span>
              <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl lg:text-[2.35rem]">
                Build a More Resilient<br />Business with <span className="bg-gradient-to-r from-accent-500 to-purple-600 bg-clip-text text-transparent">Intelligence.</span>
              </h1>
              <p className="mt-2 text-base font-bold text-slate-800 sm:text-lg">Plan, operate, sell and grow from one intelligent business workspace.</p>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-500 sm:text-base lg:mx-0">
                EnterprateAI gives startups and small businesses practical tools to run their business, build better plans, identify risks and simulate important decisions before committing time or money.
              </p>
              <p className="mt-2 text-sm font-bold text-slate-800">Get your first business insight in less than 20 minutes.</p>
              <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <button type="button" onClick={() => goToApp()} className="w-full rounded-lg bg-[#1F5BFF] px-7 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1747CC] active:scale-95 sm:w-auto">
                  Start Free
                </button>
                <a href="#how-it-works" className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#1F5BFF] bg-white px-7 py-3 text-sm font-semibold text-[#1F5BFF] transition hover:bg-blue-50 sm:w-auto">
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  See How It Works
                </a>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 lg:justify-start">
                {["No credit card required", "Start in minutes", "Private & secure"].map((t) => (
                  <span key={t} className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <svg className="h-3.5 w-3.5 shrink-0 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative mx-auto flex w-full max-w-lg items-center gap-3 lg:max-w-none lg:pl-6">
              <div className="flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-brand-900/10">
                <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-300" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                  <div className="ml-2 flex-1 rounded-md bg-white px-3 py-1 text-[11px] text-slate-300 ring-1 ring-slate-100">Search anything...</div>
                </div>
                <div className="flex">
                  <div className="hidden w-28 shrink-0 border-r border-slate-100 bg-slate-50/60 py-2.5 xl:block">
                    {["Home", "My Business", "Documents", "Planning", "Intelligence", "Marketplace"].map((n, i) => (
                      <div key={n} className={`mx-2 mb-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[10.5px] font-medium ${i === 0 ? "bg-brand-600 text-white" : "text-slate-500"}`}>{n}</div>
                    ))}
                  </div>
                  <div className="flex-1 p-3">
                    <p className="text-sm font-bold text-slate-900">Good morning, Jordan</p>
                    <p className="text-[11px] text-slate-400">Here's what's happening today.</p>
                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      {[
                        { t: "Idea Validation", d: "Test insights before you invest.", c: "bg-rose-50 text-rose-500", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
                        { t: "Business Plan", d: "Create a plan with AI.", c: "bg-brand-50 text-brand-600", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
                        { t: "Scenario Sim.", d: "See outcomes before you decide.", c: "bg-purple-50 text-purple-500", icon: "M3 3v18h18M7 15l4-6 4 4 5-8" },
                        { t: "Risk Signals", d: "Spot risks early.", c: "bg-amber-50 text-amber-500", icon: "M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-8.25 3.75h.008v.008h-.008v-.008z" },
                      ].map((c) => (
                        <div key={c.t} className="rounded-md border border-slate-100 p-2">
                          <div className={`mb-1 flex h-5 w-5 items-center justify-center rounded ${c.c}`}>
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d={c.icon} /></svg>
                          </div>
                          <p className="text-[11px] font-bold text-slate-800 leading-tight">{c.t}</p>
                          <p className="mt-0.5 text-[11px] leading-tight text-slate-400">{c.d}</p>
                          <svg className="mt-0.5 h-2.5 w-2.5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="hidden w-24 shrink-0 border-l border-slate-100 p-2.5 xl:block">
                    <p className="text-[10.5px] font-semibold text-slate-500">Business Health</p>
                    <div className="relative mx-auto mt-2 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "conic-gradient(#22C55E 0% 78%, #E2E8F0 78% 100%)" }}>
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[11px] font-extrabold text-slate-900">78</div>
                    </div>
                    <p className="mt-2 text-center text-[10px] font-semibold text-emerald-600 leading-tight">Growing steadily<br />+12% this month</p>
                  </div>
                </div>
                <div className="border-t border-slate-100 px-4 py-2">
                  <p className="mb-1 text-[10.5px] font-semibold text-slate-500">Recent Activity</p>
                  <div className="space-y-1">
                    {[
                      { a: "Business plan updated · 2 days ago", c: "bg-brand-400" },
                      { a: "Scenario simulated · 1 day ago", c: "bg-emerald-400" },
                      { a: "Invoice created · 2 hours ago", c: "bg-purple-400" },
                    ].map((r) => (
                      <div key={r.a} className="flex items-center gap-1.5 text-[10.5px] text-slate-400"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.c}`} />{r.a}</div>
                    ))}
                  </div>
                </div>
              </div>
              <Annotation className="w-28 shrink-0 text-left" color="text-brand-500" rotate="-rotate-3" arrow="left" showFrom="lg">
                Smarter<br />decisions.<br />Brighter<br />tomorrow.
              </Annotation>
            </div>
          </div>
        </div>
      </section>

      {/* INTRO */}
      <section className="py-6 sm:py-8">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">Everything You Need to Build and Grow a Stronger Business</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">Instead of stitching together multiple tools, EnterprateAI brings your essential business activities, planning and decision intelligence into one connected workspace.</p>
        </div>
      </section>

      {/* PANEL 1 — FREE BUSINESS ESSENTIALS (green) */}
      <section className="py-2 sm:py-3">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
          <div className="relative grid items-center gap-6 rounded-[20px] bg-gradient-to-br from-emerald-50 via-teal-50/70 to-emerald-50 p-5 sm:p-6 lg:grid-cols-[40%_35%_25%]">
            <div className="text-center lg:text-left">
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-600">Free Business Essentials</span>
              <h3 className="mt-2 text-xl font-extrabold text-slate-900 sm:text-2xl">Run Your Business Without<br />Paying for Multiple Apps</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">
                Create the everyday documents and records your business needs, <strong className="font-bold text-slate-800">free</strong>.
              </p>
              <p className="mt-2 text-xs font-semibold text-slate-500 sm:text-sm">Invoice &nbsp;•&nbsp; Quotation &nbsp;•&nbsp; Receipt &nbsp;•&nbsp; Contract &nbsp;•&nbsp; Idea Validation</p>
              <button type="button" onClick={() => goToFeature("/financials")} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#1F5BFF] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1747CC]">
                Explore Free Tools <span aria-hidden="true">→</span>
              </button>
            </div>
            <div className="relative mx-auto w-full max-w-sm pt-20 lg:max-w-none">
              <Annotation className="absolute left-2 top-0" color="text-brand-500" rotate="-rotate-2" arrow="down">
                More time for<br />what matters
              </Annotation>
              <div className="aspect-[4/3] overflow-hidden rounded-2xl">
                <img src="/panel-essentials.png" alt="Business owner working on invoices and quotations" className="h-full w-full object-cover" />
              </div>
            </div>
            <div className="flex w-full flex-col justify-center gap-2 pr-1 lg:pr-6">
              {[
                { l: "Invoice", c: "bg-emerald-100 text-emerald-600" },
                { l: "Quotation", c: "bg-sky-100 text-sky-600" },
                { l: "Receipt", c: "bg-purple-100 text-purple-600" },
                { l: "Contract", c: "bg-orange-100 text-orange-600" },
              ].map((d) => (
                <div key={d.l} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 shadow-sm">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${d.c}`}>
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  </span>
                  <span className="text-[11px] font-bold text-slate-700">{d.l}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PANEL 2 — BUSINESS PLANNING & GROWTH TOOLS (blue) */}
      <section id="activities" className="py-2 sm:py-3">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
          <div className="grid items-center gap-10 rounded-[20px] bg-gradient-to-br from-sky-50 via-blue-50/70 to-sky-50 p-4 sm:p-5 lg:grid-cols-2">
            <div className="relative order-2 mx-auto w-full max-w-sm pb-3 lg:order-1 lg:mx-0 lg:max-w-none">
              <Annotation className="relative z-10 mb-1" color="text-brand-500" rotate="-rotate-2" arrow="downLeft" showFrom="lg">
                Turn<br />your idea<br />into a plan
              </Annotation>
              <div className="relative">
                <div className="aspect-[16/10] overflow-hidden rounded-2xl">
                  <img src="/panel-planning.png" alt="Two founders reviewing a business plan together" className="h-full w-full object-cover" />
                </div>
                <div className="absolute bottom-3 right-2 w-32 rounded-lg bg-white/95 p-2 shadow-xl ring-1 ring-black/5 backdrop-blur-sm sm:bottom-4 sm:right-2 sm:w-36 sm:p-2.5">
                  <p className="text-[9px] font-bold text-slate-800">Business Plan</p>
                  <ul className="mt-1 space-y-[3px]">
                    {["Executive Summary", "Market Analysis", "Business Model", "Financial Projections", "Risks & Mitigation", "Go To Market"].map((s) => (
                      <li key={s} className="flex items-center gap-1 text-[7px] text-slate-500">
                        <span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-sm bg-brand-100 text-brand-600">
                          <svg className="h-[6px] w-[6px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        </span>{s}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1.5 border-t border-slate-100 pt-1.5">
                    <p className="text-[7px] font-bold text-slate-600">Growth Projection</p>
                    <div className="mt-1 flex items-end gap-[3px] h-6">
                      {[30, 42, 38, 55, 64, 80].map((h, i) => (
                        <div key={i} className="flex-1 rounded-t-sm bg-gradient-to-t from-brand-500 to-brand-300" style={{ height: `${h}%` }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="order-1 text-center lg:order-2 lg:text-left">
              <span className="text-xs font-bold uppercase tracking-widest text-brand-600">Business Planning &amp; Growth Tools</span>
              <h3 className="mt-2 text-xl font-extrabold text-slate-900 sm:text-2xl">Turn Your Business Idea<br />Into a Clear Plan for Growth</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">
                Move from an idea or growing business to a structured plan you can actually use. Create your business plan, understand what you need to become funding-ready, prepare professional proposals and discover new commercial opportunities.
              </p>
              <p className="mt-2 text-xs font-semibold text-slate-500 sm:text-sm">Business Plan Generator &nbsp;•&nbsp; Funding Readiness &nbsp;•&nbsp; Proposal Generator &nbsp;•&nbsp; Marketplace</p>
              <button type="button" onClick={() => goToFeature("/blueprint?doc=business_plan")} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#1F5BFF] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1747CC]">
                Start Planning <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* PANEL 3 — BUSINESS DECISION INTELLIGENCE (purple) */}
      <section id="testimonials" className="py-2 sm:py-3">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
          <div className="grid items-center gap-6 rounded-[20px] bg-gradient-to-br from-purple-50 via-violet-50/70 to-purple-50 p-4 sm:p-5 lg:grid-cols-2 xl:grid-cols-[36%_38%_26%]">
            <div className="text-center lg:text-left">
              <span className="text-xs font-bold uppercase tracking-widest text-purple-600">Business Decision Intelligence</span>
              <h3 className="mt-2 text-xl font-extrabold text-slate-900 sm:text-2xl">Don't Just Run Your Business.<br />Understand What Happens Next.</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">
                EnterprateAI turns your business information into forward-looking intelligence that helps you make better decisions.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">
                Understand where your business is vulnerable, explore different scenarios and see how important decisions could affect your business before you act.
              </p>
              <p className="mt-2 text-xs font-semibold text-slate-500 sm:text-sm">Live Business Plan &nbsp;•&nbsp; Scenario Simulation &nbsp;•&nbsp; Adaptive Recommendations &nbsp;•&nbsp; Fragility Index</p>
              <button type="button" onClick={() => goToFeature("/simulation")} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#1F5BFF] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1747CC]">
                Explore Decision Intelligence <span aria-hidden="true">→</span>
              </button>
            </div>

            <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5 lg:mx-0 lg:max-w-none">
              <div className="p-3">
                <div className="flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 15l4-6 4 4 5-8" /></svg>
                  <p className="text-[11px] font-bold text-slate-800">Scenario Simulation</p>
                </div>
                <p className="mt-2 text-[10px] font-semibold text-slate-400">Select a scenario</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <div className="flex flex-1 items-center justify-between rounded-md border border-slate-200 px-2 py-1.5 text-[10.5px] font-medium text-slate-600">
                    Increase marketing spend
                    <svg className="h-2.5 w-2.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </div>
                  <span className="shrink-0 rounded-md bg-brand-600 px-2 py-1.5 text-[9.5px] font-bold text-white">Run Simulation</span>
                </div>
                <div className="mt-2 flex items-center gap-3 text-[9.5px] text-slate-400">
                  <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-blue-500" />Base Case</span>
                  <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-purple-500" />Growth Scenario</span>
                </div>
                <svg viewBox="0 0 200 60" className="mt-1.5 h-14 w-full" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[12, 24, 36, 48].map((y) => (<line key={y} x1="0" x2="200" y1={y} y2={y} stroke="#EEF2FF" strokeWidth="1" />))}
                  <polygon points="8,50 55,34 100,37 150,15 192,9 192,58 8,58" fill="url(#growthFill)" />
                  <polyline points="8,50 55,42 100,44 150,32 192,27" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="8,50 55,34 100,37 150,15 192,9" fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  {[[8, 50], [55, 34], [100, 37], [150, 15], [192, 9]].map(([x, y]) => (<circle key={x} cx={x} cy={y} r="2.2" fill="#8B5CF6" />))}
                </svg>
                <div className="mt-0.5 flex justify-between text-[9.5px] text-slate-300"><span>Year 1</span><span>Year 2</span><span>Year 3</span></div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100">
                <div className="p-3 text-center">
                  <p className="text-[10.5px] font-bold text-slate-500">Fragility Index</p>
                  <div className="relative mx-auto mt-1.5 h-12 w-12">
                    <svg viewBox="0 0 36 36" className="h-12 w-12 -rotate-90">
                      <circle cx="18" cy="18" r="15" fill="none" stroke="#E2E8F0" strokeWidth="4" pathLength="100" />
                      <circle cx="18" cy="18" r="15" fill="none" stroke="#22C55E" strokeWidth="4" strokeDasharray="28 100" strokeLinecap="round" pathLength="100" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
                      <span className="text-sm font-extrabold text-slate-900">28</span>
                      <span className="text-[8px] font-bold text-emerald-600">Low</span>
                    </div>
                  </div>
                  <p className="mt-1 text-[9px] text-slate-400 leading-tight">Resilient in most scenarios</p>
                </div>
                <div className="p-3">
                  <p className="text-[10.5px] font-bold text-slate-500">Top Recommendations</p>
                  <ul className="mt-1.5 space-y-1">
                    {[
                      { t: "Diversify revenue streams", c: "bg-orange-500" },
                      { t: "Build a cash buffer", c: "bg-emerald-500" },
                      { t: "Monitor key cost drivers", c: "bg-blue-500" },
                    ].map((r, i) => (
                      <li key={r.t} className="flex items-start gap-1 text-[9.5px] text-slate-500 leading-tight">
                        <span className={`mt-[1px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white ${r.c}`}>{i + 1}</span>{r.t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="relative mx-auto hidden w-full max-w-sm pt-14 xl:mx-0 xl:block xl:max-w-none">
              <Annotation className="absolute right-2 top-0 text-right" color="text-purple-500" rotate="-rotate-2" arrow="down" showFrom="xl">
                See what's next<br />before you act
              </Annotation>
              <div className="aspect-[4/3] overflow-hidden rounded-2xl">
                <img src="/panel-decision.png" alt="Founder reviewing scenario simulation data" className="h-full w-full object-cover" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — 3 simple steps */}
      <section id="how-it-works" className="bg-white py-6 sm:py-8">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
          <h2 className="mb-4 text-center text-2xl font-extrabold text-slate-900 sm:text-3xl">From Idea to Better Decisions in Three Simple Steps</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              { n: "1", title: "Create Your Business Workspace", body: "Tell EnterprateAI about your business or idea.", c: "bg-brand-600" },
              { n: "2", title: "Use the Tools You Need", body: "Validate an idea, create invoices, build your business plan, prepare for funding or find opportunities.", c: "bg-brand-600" },
              { n: "3", title: "Let EnterprateAI Build Intelligence Around Your Business", body: "See risks, simulations, recommendations and insights based on your own business information.", c: "bg-purple-600" },
            ].map((s, i, arr) => (
              <div key={s.n} className="relative flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${s.c}`}>{s.n}</div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 leading-snug">{s.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{s.body}</p>
                </div>
                {i < arr.length - 1 && (
                  <span className="pointer-events-none absolute -right-4 top-1/2 hidden -translate-y-1/2 text-slate-500 sm:block">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 12h14" /></svg>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PERSONAS */}
      <section className="bg-brand-50/30 py-6 sm:py-8">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
          <h2 className="mb-4 text-center text-2xl font-extrabold text-slate-900 sm:text-3xl">Built for Ambitious Founders and Business Owners</h2>
          <div className="grid items-center gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_150px] lg:gap-6">
            {[
              {
                title: "For Startups", to: "/validation", c: "bg-brand-100 text-brand-600",
                body: "Validate your idea, create your business plan, prepare for funding and start building with confidence.",
                icon: "M13 10V3L4 14h7v7l9-11h-7z",
              },
              {
                title: "For Small Businesses", to: "/essentials", c: "bg-purple-100 text-purple-600",
                body: "Manage your business while using your data to understand risks, test decisions and identify opportunities for growth.",
                icon: "M3 9l1-5h16l1 5M4 9v10a1 1 0 001 1h4a1 1 0 001-1v-4h4v4a1 1 0 001 1h4a1 1 0 001-1V9M4 9h16",
              },
            ].map((p) => (
              <div key={p.title} className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm sm:flex-row sm:items-start sm:text-left">
                <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full ${p.c}`}>
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d={p.icon} /></svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-bold text-slate-900">{p.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">{p.body}</p>
                  <button type="button" onClick={() => goToFeature(p.to)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#1F5BFF] bg-white px-5 py-2.5 text-sm font-semibold text-[#1F5BFF] transition hover:bg-blue-50">
                    {p.title} <span aria-hidden="true">→</span>
                  </button>
                </div>
              </div>
            ))}
            <Annotation className="self-center text-right" color="text-brand-600" rotate="-rotate-1" arrow="left" showFrom="lg">
              Stronger<br />businesses<br />together<br />tomorrow
            </Annotation>
          </div>
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
          <div className="mx-auto grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:items-stretch [&>*:last-child]:sm:col-span-2 [&>*:last-child]:sm:mx-auto [&>*:last-child]:sm:w-full [&>*:last-child]:sm:max-w-sm [&>*:last-child]:lg:col-span-1 [&>*:last-child]:lg:mx-0 [&>*:last-child]:lg:max-w-none">
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
                <p className="mt-1 text-center text-xs text-slate-400">{plan.free ? plan.creditsCaption : annualBilling ? `Billed annually (save £${plan.annualSaving}/yr)` : "Billed monthly"}</p>
                {plan.desc && <p className="mt-3 text-center text-xs text-slate-500">{plan.desc}</p>}
                <button type="button" onClick={() => goToApp()} className={`mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold transition ${plan.free ? "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50" : "bg-brand-600 text-white hover:bg-brand-700"}`}>
                  {plan.free ? "Start Free" : plan.ctaLabel}
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

      {/* FINAL CTA */}
      <section className="py-4 sm:py-6">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-600 to-purple-600 px-6 py-6 text-white sm:px-12 sm:py-8">
            <div className="pointer-events-none absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "28px 28px" }} />
            <div className="relative flex flex-col items-center gap-6 text-center lg:flex-row lg:items-center lg:justify-between lg:text-left">
              <div className="max-w-xl">
                <h2 className="text-2xl font-extrabold sm:text-3xl">Build a More Resilient Business Today.</h2>
                <p className="mt-3 text-sm leading-relaxed text-white/85 sm:text-base">
                  Start with the business tools you need now. As your business develops, EnterprateAI gives you the intelligence to understand it more deeply, test important decisions and grow with greater clarity.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-5">
                <div className="flex shrink-0 flex-col items-center gap-3 sm:flex-row">
                  <button type="button" onClick={() => goToApp()} className="w-full rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-[#1F5BFF] shadow-lg transition hover:bg-blue-50 active:scale-95 sm:w-auto">
                    Start Free
                  </button>
                  <Link to="/book-demo" className="flex w-full items-center justify-center rounded-lg border border-white px-8 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10 active:scale-95 sm:w-auto">
                    Book a Demo
                  </Link>
                </div>
                <Annotation className="shrink-0" color="text-white/80" rotate="-rotate-2" arrow="left">
                  Ideas today.<br />A stronger tomorrow.
                </Annotation>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-white py-8 border-t border-slate-100">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 gap-8 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto" />
              <p className="mt-3 max-w-[220px] text-sm leading-relaxed text-slate-500">AI-native Business Decision Intelligence for ambitious founders and businesses.</p>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Product</h4>
              <ul className="mt-4 space-y-2">
                <li><a href="#hero" className="text-sm text-slate-500 hover:text-brand-600 transition">Features</a></li>
                <li><a href="#pricing" className="text-sm text-slate-500 hover:text-brand-600 transition">Pricing</a></li>
                <li><button type="button" onClick={() => goToFeature("/financials")} className="text-sm text-slate-500 hover:text-brand-600 transition">Integrations</button></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Solutions</h4>
              <ul className="mt-4 space-y-2">
                <li><a href="#activities" className="text-sm text-slate-500 hover:text-brand-600 transition">For Startups</a></li>
                <li><Link to="/essentials" className="text-sm text-slate-500 hover:text-brand-600 transition">For Small Businesses</Link></li>
                <li><a href="#how-it-works" className="text-sm text-slate-500 hover:text-brand-600 transition">For Growth</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Resources</h4>
              <ul className="mt-4 space-y-2">
                <li><Link to="/blog" className="text-sm text-slate-500 hover:text-brand-600 transition">Articles</Link></li>
                <li><Link to="/research" className="text-sm text-slate-500 hover:text-brand-600 transition">Guides</Link></li>
                <li><a href="mailto:support@enterpate.ai" className="text-sm text-slate-500 hover:text-brand-600 transition">Help Centre</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Company</h4>
              <ul className="mt-4 space-y-2">
                <li><Link to="/legal/privacy" className="text-sm text-slate-500 hover:text-brand-600 transition">Privacy Policy</Link></li>
                <li><Link to="/legal/terms" className="text-sm text-slate-500 hover:text-brand-600 transition">Terms of Service</Link></li>
                <li><a href="mailto:support@enterpate.ai" className="text-sm text-slate-500 hover:text-brand-600 transition">Contact</a></li>
              </ul>
            </div>
          </div>
          <p className="shrink-0 text-xs text-slate-400 lg:pb-1">© {new Date().getFullYear()} EnterprateAI. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Book a Demo modal */}
      {bookingOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)" }} onClick={closeBooking}>
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-brand-600 px-6 py-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">Book a guided walkthrough</h2>
                  <p className="mt-1 text-sm text-brand-100">We'll reach out within 1 business day to schedule your demo.</p>
                </div>
                <button onClick={closeBooking} className="ml-4 mt-0.5 text-brand-200 hover:text-white transition">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="px-6 py-5">
              {bookingStatus === "success" ? (
                <div className="py-6 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-100">
                    <svg className="h-7 w-7 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">Request received!</h3>
                  <p className="mt-2 text-sm text-slate-500">Our team will reach out within <strong>1 business day</strong> to schedule your personalised walkthrough.</p>
                  <button onClick={closeBooking} className="mt-5 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition">Done</button>
                </div>
              ) : (
                <form onSubmit={submitBooking} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">Full name *</label>
                      <input value={bookingForm.name} onChange={setBookingField("name")} required placeholder="Jane Smith" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">Work email *</label>
                      <input type="email" value={bookingForm.email} onChange={setBookingField("email")} required placeholder="jane@company.com" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">Company *</label>
                      <input value={bookingForm.company} onChange={setBookingField("company")} required placeholder="Acme Ltd" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">Phone</label>
                      <input type="tel" value={bookingForm.phone} onChange={setBookingField("phone")} placeholder="+44 7700 000000" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Your role</label>
                    <select value={bookingForm.role} onChange={setBookingField("role")} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                      <option value="">Select a role…</option>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Anything specific you'd like to cover?</label>
                    <textarea value={bookingForm.message} onChange={setBookingField("message")} rows={2} placeholder="e.g. invoicing workflow, team management…" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none" />
                  </div>
                  {bookingError && <p className="text-xs text-rose-600">{bookingError}</p>}
                  <div className="flex items-center gap-3 pt-1">
                    <button type="submit" disabled={bookingStatus === "loading"} className="flex-1 rounded-xl bg-brand-600 py-2.5 text-sm font-bold text-white shadow transition hover:bg-brand-700 active:scale-95 disabled:opacity-70">
                      {bookingStatus === "loading" ? "Sending…" : "Request demo →"}
                    </button>
                    <Link to="/book-demo" onClick={closeBooking} className="text-xs font-medium text-slate-500 hover:text-brand-600 transition whitespace-nowrap">
                      Try sandbox instead
                    </Link>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
