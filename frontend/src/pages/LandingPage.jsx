import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import logoUrl from "../enterprate-logo.png";

const PAIN_ITEMS = [
  { icon: "😰", text: '"I want to hire but I genuinely don\'t know if I can afford it six months from now."' },
  { icon: "📉", text: '"I\'m thinking of raising prices but terrified of losing customers and ending up worse off."' },
  { icon: "💸", text: '"My accountant shows me last month\'s numbers. I need to know what next month looks like."' },
  { icon: "🤷", text: '"I guessed wrong on a big decision last year. I can\'t afford to guess again."' },
];

const STEPS = [
  { n: "1", title: "Connect your business data", body: "Securely link your revenue, costs, headcount, and cashflow data. Works with Xero, QuickBooks, spreadsheets, or manual input. No technical setup required." },
  { n: "2", title: "EnterprateAI builds your live business model", body: "The system automatically maps relationships between every revenue stream, cost centre, and operational element, creating a dynamic model unique to your business." },
  { n: "3", title: "Run decision simulations", body: "Choose a scenario: hire a team member, raise prices by 15%, cut marketing spend. See the full ripple effect across your business over 6, 12, and 24 months." },
  { n: "4", title: "Act with certainty, not guesswork", body: "Get a clear recommendation: go, wait, or adapt. With the exact numbers behind each conclusion so you commit with confidence." },
];

const EXAMPLES = [
  {
    tag: "👤 Hiring Decision",
    title: "Should you hire a new team member?",
    impacts: [
      { type: "neg", text: "Cash runway reduces: 8 → 5 months" },
      { type: "neg", text: "Break even shifts by +2 months" },
      { type: "warn", text: "Risk increases under low revenue scenarios" },
      { type: "neg", text: "Monthly burn rate increases by £3,500" },
    ],
    rec: "Delay hiring by 2 months or use a contractor to preserve cashflow stability. Safe to hire from Month 3.",
  },
  {
    tag: "💰 Pricing Decision",
    title: "Planning to raise your prices?",
    impacts: [
      { type: "pos", text: "Revenue increases by +12%" },
      { type: "pos", text: "Profit margin improves by +18%" },
      { type: "pos", text: "Remains profitable with up to 8% churn" },
      { type: "pos", text: "Break even improves by 1.5 months" },
    ],
    rec: "Increase pricing by 15%. Revenue remains positive even under moderate churn. Implement with a 30 day notice period.",
  },
  {
    tag: "✂️ Cost Reduction",
    title: "Thinking of cutting marketing spend?",
    impacts: [
      { type: "pos", text: "Immediate cashflow improves by £2,100/mo" },
      { type: "warn", text: "Pipeline impact: −22% leads by Month 3" },
      { type: "neg", text: "Revenue dip: −£6,400 by Month 5" },
      { type: "warn", text: "Net effect negative beyond Month 4" },
    ],
    rec: "Do not cut marketing budget. Short term saving creates a revenue hole in Month 4 to 6. Instead, reallocate £800/mo from offline to digital for better ROI.",
  },
];

const TESTIMONIALS = [
  {
    quote: "I was about to hire a second developer. EnterprateAI ran the simulation and showed me my cash runway would drop to 4 months under two realistic revenue scenarios. I hired a contractor instead. Six months later, that decision saved my business.",
    name: "Sarah K.",
    role: "Founder, Brightpath Digital — London",
    init: "S",
    color: "bg-brand-500",
  },
  {
    quote: "We were debating a price increase for months. EnterprateAI modelled three scenarios in minutes — showed us we could raise by 18% and still retain 94% of customers. We raised prices within a week. Best decision we made this year.",
    name: "Marcus O.",
    role: "Director, Osei Consulting — Birmingham",
    init: "M",
    color: "bg-accent-500",
  },
  {
    quote: "As a solo founder I was making £40k decisions based on spreadsheets and gut feel. EnterprateAI gave me the confidence of a CFO without the cost of one. I now run every major decision through it before acting.",
    name: "Rachel T.",
    role: "Founder, Trent Creative Studio — Manchester",
    init: "R",
    color: "bg-emerald-500",
  },
];

const PLANS = [
  {
    name: "Starter",
    monthly: 24,
    annual: 20,
    desc: "Perfect for solo founders and early stage businesses.",
    features: ["1 workspace", "Up to 5 decision simulations/month", "Business blueprint generator", "Basic cashflow forecasting", "Email support"],
    highlight: false,
  },
  {
    name: "Growth",
    monthly: 49,
    annual: 40,
    desc: "For growing businesses making multiple decisions monthly.",
    features: ["3 workspaces", "Unlimited simulations", "Full scenario intelligence", "Team collaboration (up to 5)", "Advanced risk detection", "Priority support"],
    highlight: true,
    badge: "Most Popular",
  },
  {
    name: "Scale",
    monthly: 99,
    annual: 83,
    desc: "For established businesses with complex decision needs.",
    features: ["Unlimited workspaces", "Unlimited simulations", "Multi-entity modelling", "Unlimited team members", "API access", "Dedicated onboarding"],
    highlight: false,
  },
];

const FAQS = [
  { q: "Is my business data secure?", a: "Yes. All data is encrypted in transit (TLS 1.3) and at rest (AES-256). We are ICO Registered, GDPR compliant, and never share or sell your data. You can delete your data at any time." },
  { q: "Do I need to connect my accounts?", a: "No. You can enter your data manually, upload a spreadsheet, or optionally connect Xero or QuickBooks for automatic updates. Manual entry works perfectly for most early stage businesses." },
  { q: "How is this different from my accountant's spreadsheet?", a: "Your accountant shows you what already happened. EnterprateAI models your business as a live system and simulates what will happen next — across all your interconnected costs, revenues, and decisions — before you commit." },
  { q: "What if my business is very small or early-stage?", a: "EnterprateAI is specifically designed for UK SMEs, including early stage businesses with as few as 2–3 months of trading data. The simpler your business, the faster the setup." },
  { q: "What happens after my 14-day free trial?", a: "At the end of your trial you choose a plan. There is no automatic charge — you will be asked explicitly to select a plan and enter payment details. You can also continue on a free read-only tier indefinitely." },
  { q: "Is EnterprateAI GDPR compliant?", a: "Yes, fully. We are ICO Registered (UK data protection authority), process all data within UK/EU jurisdictions, and provide a full Data Processing Agreement (DPA) on request for business customers." },
  { q: "How quickly can I run my first simulation?", a: "Most users run their first decision simulation within 15 minutes of signing up. Our onboarding flow guides you through connecting your data and building your first business model step by step." },
  { q: "Can I cancel anytime?", a: "Yes. No lock-in contracts, no cancellation fees. Cancel from your account settings in 30 seconds. Your data remains accessible for 30 days after cancellation." },
];

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-4 py-4 text-left"
      >
        <span className="text-sm font-semibold text-slate-800">{q}</span>
        <span className={`mt-0.5 shrink-0 text-brand-500 transition-transform duration-200 ${open ? "rotate-45" : ""}`}>✕</span>
      </button>
      {open && <p className="pb-4 text-sm leading-relaxed text-slate-500">{a}</p>}
    </div>
  );
}

export default function LandingPage() {
  const [annualBilling, setAnnualBilling] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [exitShown, setExitShown] = useState(false);
  const [exitDismissed, setExitDismissed] = useState(false);
  const exitTimerRef = useRef(null);
  const navigate = useNavigate();

  // Unlock scroll — body has overflow-hidden globally for the app shell
  useEffect(() => {
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    function onMouseLeave(e) {
      if (e.clientY <= 10 && !exitDismissed && !exitShown) {
        exitTimerRef.current = setTimeout(() => setExitShown(true), 400);
      }
    }
    document.addEventListener("mouseleave", onMouseLeave);
    return () => {
      document.removeEventListener("mouseleave", onMouseLeave);
      clearTimeout(exitTimerRef.current);
    };
  }, [exitDismissed, exitShown]);

  return (
    <div className="min-h-screen bg-white font-sans text-slate-800 antialiased">

      {/* ── Exit intent popup ── */}
      {exitShown && !exitDismissed && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
            <button
              type="button"
              onClick={() => { setExitDismissed(true); setExitShown(false); }}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600"
            >✕</button>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Before you go</p>
            <h3 className="mt-2 text-xl font-bold text-slate-900">Try it free for 14 days.</h3>
            <p className="mt-2 text-sm text-slate-500">No credit card. No commitment. Run your first decision simulation and see exactly what it will do to your business.</p>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="mt-5 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 transition"
            >
              Start My Free Trial →
            </button>
            <p className="mt-3 text-center text-xs text-slate-400">14 days free · No card required · Cancel anytime</p>
          </div>
        </div>
      )}

      {/* ── Sticky navbar ── */}
      <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="#hero" className="flex items-center gap-2">
            <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto sm:h-8" />
          </a>
          <ul className="hidden items-center gap-6 md:flex">
            {[["#modules", "Features"], ["#how-it-works", "How It Works"], ["#examples", "See It Work"], ["#pricing", "Pricing"], ["#faq", "FAQ"]].map(([href, label]) => (
              <li key={href}>
                <a href={href} className="text-sm font-medium text-slate-600 transition hover:text-brand-600">{label}</a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Link to="/login" className="hidden text-sm font-medium text-slate-600 hover:text-slate-900 sm:block">Sign in</Link>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
            >
              Start Free Trial
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="ml-1 flex h-9 w-9 flex-col items-center justify-center gap-1.5 md:hidden"
              aria-label="Menu"
            >
              <span className={`block h-0.5 w-5 bg-slate-700 transition-all ${mobileMenuOpen ? "translate-y-2 rotate-45" : ""}`} />
              <span className={`block h-0.5 w-5 bg-slate-700 transition-all ${mobileMenuOpen ? "opacity-0" : ""}`} />
              <span className={`block h-0.5 w-5 bg-slate-700 transition-all ${mobileMenuOpen ? "-translate-y-2 -rotate-45" : ""}`} />
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="border-t border-slate-100 bg-white px-4 pb-4 md:hidden">
            <ul className="mt-3 flex flex-col gap-3">
              {[["#modules", "Features"], ["#how-it-works", "How It Works"], ["#examples", "See It Work"], ["#pricing", "Pricing"], ["#faq", "FAQ"]].map(([href, label]) => (
                <li key={href}>
                  <a href={href} onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-slate-700">{label}</a>
                </li>
              ))}
              <li><Link to="/login" className="block text-sm font-medium text-slate-700">Sign in</Link></li>
            </ul>
          </div>
        )}
      </nav>

      {/* ══════════════════════════════════════════
          HERO
      ══════════════════════════════════════════ */}
      <section id="hero" className="relative overflow-hidden bg-gradient-to-br from-slate-50 via-brand-50/40 to-white pb-16 pt-14 sm:pt-20">
        <div className="pointer-events-none absolute -right-32 -top-32 h-[500px] w-[500px] rounded-full bg-brand-100/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-[400px] w-[400px] rounded-full bg-accent-100/30 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 lg:items-center">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
                </span>
                UK Built · SEIS Approved · GDPR Compliant
              </div>

              <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl xl:text-5xl">
                Know Exactly What Hiring, Raising Prices, or Cutting Costs Will Do —{" "}
                <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
                  Before You Do It
                </span>
              </h1>

              <p className="mt-5 text-lg leading-relaxed text-slate-600">
                EnterprateAI builds a live model of your business and simulates every major decision,
                showing you the exact impact on cash, revenue, and risk over 6, 12, and 24 months.{" "}
                <strong className="text-slate-800">Act with certainty. Stop guessing.</strong>
              </p>

              <p className="mt-3 text-sm font-medium text-slate-500">
                Most tools show what <em>already happened.</em>{" "}
                EnterprateAI shows what <em>will happen next.</em>
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => navigate("/login")}
                  className="rounded-xl bg-brand-600 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-200 transition hover:bg-brand-700 active:scale-95"
                >
                  Start My Free 14-Day Trial →
                </button>
                <a
                  href="#how-it-works"
                  className="flex items-center justify-center rounded-xl border border-slate-200 px-7 py-3.5 text-base font-semibold text-slate-700 transition hover:border-brand-200 hover:text-brand-700"
                >
                  See How It Works
                </a>
              </div>

              <div className="mt-5 flex flex-wrap gap-4 text-sm text-slate-500">
                <span className="flex items-center gap-1.5"><span className="text-emerald-500">✓</span> 14-day free trial</span>
                <span className="flex items-center gap-1.5"><span className="text-emerald-500">✓</span> No credit card required</span>
                <span className="flex items-center gap-1.5"><span className="text-emerald-500">✓</span> Set up in under 15 minutes</span>
              </div>
            </div>

            {/* Preview card */}
            <div className="relative">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-200/60">
                <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <span className="h-3 w-3 rounded-full bg-rose-400" />
                  <span className="h-3 w-3 rounded-full bg-amber-400" />
                  <span className="h-3 w-3 rounded-full bg-emerald-400" />
                  <span className="ml-3 text-xs font-medium text-slate-500">Decision Simulation: Hiring Analysis</span>
                </div>
                <div className="space-y-3 p-5">
                  {[
                    { label: "Revenue Impact", value: "+£8,400/mo", tag: "↑ 18% by Month 6", tagColor: "text-emerald-600", bg: "bg-emerald-50" },
                    { label: "Cash Runway", value: "8 → 5 months", tag: "↓ Consider contractor first", tagColor: "text-amber-600", bg: "bg-amber-50" },
                    { label: "Break even shift", value: "+2 months", tag: "→ Safe threshold: hire in Month 3", tagColor: "text-brand-600", bg: "bg-brand-50" },
                  ].map((m) => (
                    <div key={m.label} className={`rounded-xl p-3 ${m.bg}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{m.label}</span>
                        <span className="text-sm font-bold text-slate-900">{m.value}</span>
                      </div>
                      <p className={`mt-1 text-xs font-medium ${m.tagColor}`}>{m.tag}</p>
                    </div>
                  ))}
                  <div className="rounded-xl border border-brand-100 bg-brand-50 p-3">
                    <p className="text-xs font-semibold text-brand-700">AI Recommendation</p>
                    <p className="mt-1 text-xs text-slate-600">Delay full-time hire by 2 months or use contractor to preserve cashflow. Safe to hire from Month 3 under all revenue scenarios.</p>
                  </div>
                  <svg viewBox="0 0 280 60" className="w-full" aria-hidden="true">
                    <polyline points="0,55 47,45 93,32 140,22 187,14 233,9 280,5" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points="0,55 47,53 93,50 140,48 187,46 233,44 280,42" fill="none" stroke="#f43f8f" strokeWidth="2" strokeDasharray="4,3" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
                    <line x1="0" y1="38" x2="280" y2="38" stroke="#e2e8f0" strokeWidth="1" />
                  </svg>
                  <div className="flex gap-4 text-[11px] text-slate-400">
                    <span><span className="font-bold text-brand-500">—</span> With hire</span>
                    <span><span className="font-bold text-accent-500">- -</span> Without hire</span>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-3 -right-3 rounded-xl border border-emerald-200 bg-white px-3 py-2 shadow-lg text-xs font-semibold text-emerald-700">
                ✓ Decision made with confidence
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          TRUST BAR
      ══════════════════════════════════════════ */}
      <section className="border-y border-slate-100 bg-slate-50/60 py-4">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs font-medium text-slate-500">
            {["🇬🇧 UK Built", "🏅 SEIS Approved", "🛡️ ICO Registered", "🔒 GDPR Compliant", "⚖️ Registered in England & Wales", "🏢 Built for UK SMEs"].map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          PAIN SECTION
      ══════════════════════════════════════════ */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">Sound Familiar?</h2>
            <p className="mt-3 text-slate-500">Every week, UK small business owners make high-stakes decisions with incomplete information.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PAIN_ITEMS.map((p) => (
              <div key={p.icon} className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                <div className="mb-3 text-3xl">{p.icon}</div>
                <p className="text-sm leading-relaxed text-slate-600 italic">{p.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <p className="text-lg font-semibold text-slate-800">There is now a better way. ↓</p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          MODULES
      ══════════════════════════════════════════ */}
      <section id="modules" className="bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">The Platform</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">One Platform. Every Tool Your Business Needs.</h2>
            <p className="mt-3 text-slate-500">From validating your idea to running live decision simulations — everything in one place.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: "💡",
                name: "Idea Validation",
                tag: "Available now",
                tagColor: "bg-emerald-100 text-emerald-700",
                desc: "Test your business idea before you invest a penny. Get a market viability score, competitive landscape analysis, target customer profile, and a clear go or no-go recommendation — based on real data.",
              },
              {
                icon: "⚡",
                name: "Decision Simulation",
                tag: "Available now",
                tagColor: "bg-emerald-100 text-emerald-700",
                desc: "Simulate any major business decision — hiring, pricing, cutting costs — and see the exact impact on cash, revenue, and risk across 6, 12, and 24 months before you commit.",
              },
              {
                icon: "📋",
                name: "Business Blueprints",
                tag: "Available now",
                tagColor: "bg-emerald-100 text-emerald-700",
                desc: "Generate professional business plans, pitch decks, executive summaries, and strategy documents in minutes. Tailored to your business data and ready to share with investors or partners.",
              },
              {
                icon: "💷",
                name: "Financials",
                tag: "Available now",
                tagColor: "bg-emerald-100 text-emerald-700",
                desc: "Track invoices, expenses, contracts, and quotations. Get real-time financial intelligence including cashflow forecasting, revenue trends, and profit margin analysis — all in one dashboard.",
              },
              {
                icon: "📦",
                name: "Catalogue",
                tag: "Available now",
                tagColor: "bg-emerald-100 text-emerald-700",
                desc: "Manage your full product and service catalogue, customer database, and vendor relationships. Keep everything organised and linked to your financial and operational data.",
              },
              {
                icon: "⚖️",
                name: "Business Registration",
                tag: "Available now",
                tagColor: "bg-emerald-100 text-emerald-700",
                desc: "Navigate UK company registration, legal structure decisions, and compliance requirements with guided step-by-step support. Know exactly what you need to do and when.",
              },
              {
                icon: "🏪",
                name: "Marketplace",
                tag: "Available now",
                tagColor: "bg-emerald-100 text-emerald-700",
                desc: "Discover and connect with other UK businesses. Find suppliers, partners, and customers within the EnterprateAI ecosystem to grow your network and opportunities.",
              },
            ].map((m) => (
              <div key={m.name} className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-brand-200 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-3xl">{m.icon}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.tagColor}`}>{m.tag}</span>
                </div>
                <h3 className="mt-3 font-bold text-slate-900">{m.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{m.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="rounded-xl bg-brand-600 px-7 py-3 text-sm font-semibold text-white shadow transition hover:bg-brand-700"
            >
              Access All Modules Free for 14 Days →
            </button>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          DIFFERENTIATOR
      ══════════════════════════════════════════ */}
      <section className="bg-slate-900 py-16 text-white sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <span className="rounded-full bg-brand-500/20 px-3 py-1 text-xs font-semibold text-brand-300">Why EnterprateAI</span>
            <h2 className="mt-3 text-2xl font-extrabold sm:text-3xl">Your Business, Modelled as a Living System</h2>
            <p className="mt-3 text-slate-400">Spreadsheets show snapshots. Accountants show history. EnterprateAI shows you <strong className="text-white">what happens next.</strong></p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { emoji: "🔗", title: "Built as a System", body: "Models your business as interconnected components. Every decision ripples across revenue, costs, and cashflow — exactly like the real world." },
              { emoji: "⚡", title: "Simulate Before You Spend", body: "Test any decision — hire, raise prices, cut costs — and see the complete financial outcome before committing a single pound." },
              { emoji: "📊", title: "See Ripple Effects", body: "Visualise how one decision cascades across your business at 6, 12, and 24 months with clear go / wait / adapt guidance." },
              { emoji: "🛡️", title: "Detect Risk Early", body: "Identifies structural vulnerabilities in your cashflow and operations weeks before they become real problems." },
            ].map((c) => (
              <div key={c.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="mb-3 text-3xl">{c.emoji}</div>
                <h3 className="mb-2 font-semibold">{c.title}</h3>
                <p className="text-sm leading-relaxed text-slate-400">{c.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-6">
              <h4 className="mb-4 font-semibold text-rose-300">Before EnterprateAI</h4>
              <ul className="space-y-2 text-sm text-slate-300">
                {["Making decisions on gut feel and last month's numbers", "Finding out the impact after it's too late to change course", "Guessing at cashflow and hoping for the best", "Reacting to problems after they've already cost you money"].map((t) => <li key={t} className="flex items-start gap-2"><span className="shrink-0 mt-0.5 text-rose-400">✕</span>{t}</li>)}
              </ul>
            </div>
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6">
              <h4 className="mb-4 font-semibold text-emerald-300">With EnterprateAI</h4>
              <ul className="space-y-2 text-sm text-slate-300">
                {["Simulate any decision and see the exact financial outcome first", "Know the impact on cash, revenue, and risk before committing", "Precise cashflow forecasting based on your live business model", "Spot vulnerabilities weeks early and act before they escalate"].map((t) => <li key={t} className="flex items-start gap-2"><span className="shrink-0 mt-0.5 text-emerald-400">✓</span>{t}</li>)}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          HOW IT WORKS
      ══════════════════════════════════════════ */}
      <section id="how-it-works" className="py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">The Process</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">From Your Data to Clear Decisions in Minutes</h2>
            <p className="mt-3 text-slate-500">No lengthy setup. No consultants. No spreadsheet hell.</p>
          </div>
          <div className="relative">
            <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-slate-100" aria-hidden="true" />
            <div className="space-y-8">
              {STEPS.map((s) => (
                <div key={s.n} className="flex gap-5">
                  <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white shadow-md shadow-brand-200">
                    {s.n}
                  </div>
                  <div className="pb-2 pt-1.5">
                    <h3 className="font-semibold text-slate-900">{s.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          EXAMPLES
      ══════════════════════════════════════════ */}
      <section id="examples" className="bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">See It In Action</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Real Decision Outputs</h2>
            <p className="mt-3 text-slate-500">This is exactly what EnterprateAI produces for your business decisions.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {EXAMPLES.map((ex) => (
              <div key={ex.tag} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4">
                  <span className="text-xs font-semibold text-slate-500">{ex.tag}</span>
                  <h3 className="mt-1 font-semibold text-slate-900">{ex.title}</h3>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Impact Analysis</p>
                  <ul className="space-y-1.5">
                    {ex.impacts.map((imp) => (
                      <li key={imp.text} className={`flex items-start gap-2 text-xs ${imp.type === "pos" ? "text-emerald-600" : imp.type === "warn" ? "text-amber-600" : "text-rose-500"}`}>
                        <span className="mt-0.5 shrink-0">{imp.type === "pos" ? "↑" : imp.type === "warn" ? "⚠" : "↓"}</span>
                        {imp.text}
                      </li>
                    ))}
                  </ul>
                  <div className="rounded-xl border border-brand-100 bg-brand-50 p-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-brand-600">Recommendation</p>
                    <p className="text-xs leading-relaxed text-slate-600">{ex.rec}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-slate-400">Results are generated from <em>your actual business data</em> and update dynamically as conditions change.</p>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          MID-PAGE CTA
      ══════════════════════════════════════════ */}
      <section className="bg-gradient-to-r from-brand-600 to-brand-700 py-14 text-white">
        <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-extrabold sm:text-3xl">Ready to Simulate Your First Decision — Free?</h2>
          <p className="mt-3 text-brand-100">14-day free trial. No credit card required. Set up in under 15 minutes.</p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-7 rounded-xl bg-white px-8 py-3.5 text-sm font-bold text-brand-700 shadow transition hover:bg-brand-50 active:scale-95"
          >
            Start My Free Trial →
          </button>
          <p className="mt-3 text-xs text-brand-200">No spam · No commitment · Cancel anytime</p>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          TESTIMONIALS
      ══════════════════════════════════════════ */}
      <section id="testimonials" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">What Users Say</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Business Owners Who Stopped Guessing</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className={`rounded-2xl border p-6 ${i === 0 ? "border-brand-200 bg-brand-50" : "border-slate-100 bg-white"}`}>
                <div className="mb-3 flex text-amber-400 text-sm">★★★★★</div>
                <blockquote className="text-sm leading-relaxed text-slate-700 italic">"{t.quote}"</blockquote>
                <div className="mt-5 flex items-center gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${t.color}`}>{t.init}</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                    <p className="text-xs text-slate-400">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          PRICING
      ══════════════════════════════════════════ */}
      <section id="pricing" className="bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">Pricing</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Simple, Transparent Pricing</h2>
            <p className="mt-3 text-slate-500">Every plan includes a 14-day free trial. No credit card required to start.</p>
            <div className="mt-5 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
              <button type="button" onClick={() => setAnnualBilling(false)} className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${!annualBilling ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-700"}`}>Monthly</button>
              <button type="button" onClick={() => setAnnualBilling(true)} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${annualBilling ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-700"}`}>
                Annual <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${annualBilling ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700"}`}>Save 17%</span>
              </button>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {PLANS.map((plan) => (
              <div key={plan.name} className={`relative overflow-hidden rounded-2xl border bg-white p-6 ${plan.highlight ? "border-brand-400 ring-2 ring-brand-200 shadow-xl shadow-brand-100" : "border-slate-200"}`}>
                {plan.badge && (
                  <div className="absolute right-5 top-5 rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-bold text-white">{plan.badge}</div>
                )}
                <h3 className="font-bold text-slate-900">{plan.name}</h3>
                <div className="mt-2 flex items-end gap-1">
                  <span className="text-3xl font-extrabold text-slate-900">£{annualBilling ? plan.annual : plan.monthly}</span>
                  <span className="mb-1 text-sm text-slate-400">/mo</span>
                </div>
                {annualBilling && <p className="text-xs text-emerald-600">Billed annually (save £{(plan.monthly - plan.annual) * 12}/yr)</p>}
                <p className="mt-2 text-xs text-slate-500">{plan.desc}</p>
                <ul className="mt-5 space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                      <span className="mt-0.5 shrink-0 text-emerald-500">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => navigate("/login")}
                  className={`mt-6 w-full rounded-xl px-4 py-3 text-sm font-semibold transition ${plan.highlight ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100"}`}
                >
                  Start Free Trial
                </button>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-slate-400">All prices exclude VAT. Cancel anytime — no lock-in contracts, no cancellation fees.</p>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FAQ
      ══════════════════════════════════════════ */}
      <section id="faq" className="py-16 sm:py-20">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">FAQ</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Common Questions</h2>
          </div>
          <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white px-6">
            {FAQS.map((f) => <FAQItem key={f.q} q={f.q} a={f.a} />)}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FINAL CTA
      ══════════════════════════════════════════ */}
      <section className="bg-gradient-to-br from-slate-900 to-brand-900 py-16 text-white sm:py-20">
        <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-extrabold sm:text-3xl">Stop Guessing. Start Knowing.</h2>
          <p className="mt-4 text-slate-300">Try EnterprateAI free for 14 days. No credit card. No commitment. Run your first simulation in minutes.</p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-8 rounded-xl bg-brand-500 px-10 py-4 text-base font-bold text-white shadow-xl shadow-brand-900/50 transition hover:bg-brand-400 active:scale-95"
          >
            Start My Free 14-Day Trial →
          </button>
          <div className="mt-6 flex flex-wrap justify-center gap-4 text-xs text-slate-400">
            <span>✓ 14-day free trial</span>
            <span>✓ No credit card required</span>
            <span>✓ Cancel anytime</span>
            <span>✓ GDPR compliant</span>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════ */}
      <footer className="border-t border-slate-100 bg-white py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto" />
            <div className="flex flex-wrap justify-center gap-5 text-xs text-slate-400">
              <Link to="/login" className="hover:text-slate-600">Sign In</Link>
              <a href="mailto:support@enterprate.ai" className="hover:text-slate-600">support@enterprate.ai</a>
              <span>Enterprate Limited · Registered in England &amp; Wales</span>
            </div>
          </div>
          <p className="mt-6 text-center text-[11px] text-slate-300">
            © {new Date().getFullYear()} Enterprate Limited. All rights reserved.
            ICO Registered · GDPR Compliant · SEIS Approved
          </p>
        </div>
      </footer>
    </div>
  );
}
