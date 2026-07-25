import { useState, useEffect } from "react";

const APP_URL = import.meta.env.VITE_APP_URL || "https://enterprate.ai";

const QUESTIONS = [
  { icon: "💼", text: "What exactly does your business do?" },
  { icon: "👥", text: "Who are your customers?" },
  { icon: "📊", text: "Is there real demand?" },
  { icon: "💰", text: "How will the business make money?" },
  { icon: "🧾", text: "What are your costs?" },
  { icon: "⚠️", text: "What risks should be considered?" },
  { icon: "🏦", text: "How much funding do you need?" },
  { icon: "📋", text: "How will the money be used?" },
];

const STEPS = [
  {
    n: "01",
    icon: "✅",
    title: "Validate Your Business Idea",
    body: "Check whether your idea makes commercial sense before spending more time, money, or energy.",
    detail: "Get scored on customer need, market opportunity, pricing, costs, demand evidence, risks, and growth potential.",
    color: "from-emerald-500 to-teal-600",
    light: "bg-emerald-50 border-emerald-100",
    tag: "Start here",
  },
  {
    n: "02",
    icon: "📄",
    title: "Generate Your Business Plan",
    body: "EnterprateAI uses your validation data to instantly generate a structured, investor-ready business plan.",
    bullets: ["No blank page.", "No confusing templates.", "No starting from scratch."],
    detail: "Covering your business model, customers, pricing, operations, financial assumptions, risks, and growth direction.",
    color: "from-brand-500 to-brand-700",
    light: "bg-brand-50 border-brand-100",
    tag: "Most popular",
  },
  {
    n: "03",
    icon: "🚀",
    title: "Launch to Marketplace and Test Traction",
    body: "List your product or service and start testing real visibility with UK businesses.",
    detail: "Funders want to see clarity, preparation, and signs of market interest — not just ideas.",
    color: "from-accent-500 to-rose-600",
    light: "bg-rose-50 border-rose-100",
    tag: "Go live",
  },
];

const PLAN_POINTS = [
  { icon: "🏢", text: "What your business does" },
  { icon: "👤", text: "Who your customers are" },
  { icon: "🔍", text: "What problem you solve" },
  { icon: "💸", text: "How your business makes money" },
  { icon: "🧾", text: "What your costs are" },
  { icon: "🏦", text: "What funding you need" },
  { icon: "📌", text: "How the funding will be used" },
  { icon: "⚠️", text: "What risks you understand" },
  { icon: "📈", text: "How the business can grow" },
];

const WHO = [
  { icon: "🌱", label: "New business owners" },
  { icon: "💡", label: "Startup founders" },
  { icon: "🏛️", label: "Grant applicants" },
  { icon: "🏦", label: "Small businesses seeking loans" },
  { icon: "📈", label: "Entrepreneurs preparing for investment" },
  { icon: "🛎️", label: "Consultants and service providers" },
  { icon: "⚡", label: "Founders who need a plan quickly" },
];

const TESTIMONIALS = [
  {
    quote: "I went from having a rough idea to a complete business plan in under 25 minutes. The validation score gave me the confidence to walk into my bank meeting prepared.",
    name: "Sarah K.",
    role: "Founder, UK Retail Business",
    rating: 5,
    init: "S",
  },
  {
    quote: "As a grant applicant, I had no idea how to structure my business case. EnterprateAI did it for me and I walked away with exactly what the council needed to see.",
    name: "James O.",
    role: "Social Enterprise Founder, London",
    rating: 5,
    init: "J",
  },
  {
    quote: "I've tried three other tools. This is the only one that actually helped me think through the business properly, not just fill in a template.",
    name: "Amina R.",
    role: "Startup Founder, Manchester",
    rating: 5,
    init: "A",
  },
];

const FAQS = [
  { q: "Do I need any business experience?", a: "No. EnterprateAI is built for everyone — from first-time founders to experienced operators. The platform guides you step by step through each part of the process." },
  { q: "How long does it take to get a business plan?", a: "Most users complete their validation and generate a full business plan in under 20 minutes. The more detail you provide, the stronger the output." },
  { q: "Is this really free to start?", a: "Yes. The Explorer plan is completely free with no credit card required. You get idea validation, a business plan, and financial tools with no upfront cost." },
  { q: "Can I use this for a grant or loan application?", a: "Yes. The business plan output is structured specifically to answer the questions funders, grant bodies, and lenders ask. Many users take the output directly into their applications." },
  { q: "Is my data secure?", a: "Absolutely. All data is encrypted in transit and at rest. We are ICO Registered and fully GDPR compliant. Your data is never shared or sold." },
  { q: "What if my idea is still early stage?", a: "That is exactly the right time to use EnterprateAI. Validating early saves you months of effort in the wrong direction." },
];

function Star() {
  return (
    <svg className="h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" />
    </svg>
  );
}

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-2xl border transition-all duration-200 ${open ? "border-brand-200 bg-brand-50" : "border-slate-100 bg-white"}`}>
      <button type="button" onClick={() => setOpen(v => !v)} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left">
        <span className="text-sm font-semibold text-slate-800">{q}</span>
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${open ? "bg-brand-600" : "bg-slate-100"}`}>
          <svg className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-45 text-white" : "text-slate-500"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </div>
      </button>
      {open && <p className="px-6 pb-5 text-sm leading-relaxed text-slate-600">{a}</p>}
    </div>
  );
}

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "auto";
    document.body.style.overflowX = "hidden";
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.body.style.overflow = "";
      document.body.style.overflowX = "";
    };
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden bg-white font-sans text-slate-900 antialiased">

      {/* NAV */}
      <header className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? "border-b border-slate-100 bg-white/95 shadow-sm backdrop-blur-sm" : "bg-transparent"}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="EnterprateAI" className="h-8 w-auto" />
          </a>

          <nav className="hidden items-center gap-8 md:flex">
            {[
              { label: "How It Works", id: "how-it-works" },
              { label: "Why It Matters", id: "why-plan" },
              { label: "Who It's For", id: "who" },
              { label: "FAQ", id: "faq" },
            ].map(l => (
              <button key={l.label} onClick={() => scrollTo(l.id)} className="text-sm font-medium text-slate-600 hover:text-brand-600 transition-colors">
                {l.label}
              </button>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <a href={`${APP_URL}/login`} className="text-sm font-semibold text-slate-600 hover:text-brand-600 transition-colors">Log in</a>
            <a href={`${APP_URL}/login`} className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 transition-all hover:shadow-md">
              Get Started Free
            </a>
          </div>

          <button type="button" className="md:hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={() => setMobileMenuOpen(v => !v)}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {mobileMenuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-slate-100 bg-white px-4 pb-4 shadow-lg md:hidden">
            {[
              { label: "How It Works", id: "how-it-works" },
              { label: "Why It Matters", id: "why-plan" },
              { label: "Who It's For", id: "who" },
              { label: "FAQ", id: "faq" },
            ].map(l => (
              <button key={l.label} onClick={() => { scrollTo(l.id); setMobileMenuOpen(false); }} className="block w-full py-3 text-left text-sm font-medium text-slate-700 border-b border-slate-50 last:border-0">
                {l.label}
              </button>
            ))}
            <div className="mt-4 flex gap-3">
              <a href={`${APP_URL}/login`} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-center text-sm font-semibold text-slate-700">Log in</a>
              <a href={`${APP_URL}/login`} className="flex-1 rounded-xl bg-brand-600 py-2.5 text-center text-sm font-bold text-white">Get Started Free</a>
            </div>
          </div>
        )}
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 py-24 sm:py-32 text-white">
        {/* Background decoration */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-1/4 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
          <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-accent-500/15 blur-3xl" />
          <div className="absolute inset-0" style={{backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)", backgroundSize: "40px 40px"}} />
        </div>

        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white backdrop-blur-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Free to start · No credit card required · ICO Registered
          </div>

          <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Get Your Business{" "}
            <span className="bg-gradient-to-r from-brand-300 to-accent-400 bg-clip-text text-transparent">
              Funding-Ready
            </span>
            <br />in Under 20 Minutes
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
            Before you apply for a grant, loan, investment, or partnership — validate your idea, generate a structured business plan, and launch to marketplace. All from one workspace.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <a
              href={`${APP_URL}/login`}
              className="group inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-600 px-8 py-4 text-base font-bold text-white shadow-xl shadow-brand-900/40 transition-all hover:from-brand-400 hover:to-brand-500 hover:shadow-2xl sm:w-auto"
            >
              Create My Funding Plan Free
              <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </a>
            <button onClick={() => scrollTo("how-it-works")} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-8 py-4 text-base font-semibold text-white backdrop-blur-sm hover:bg-white/20 transition-all sm:w-auto">
              See How It Works
            </button>
          </div>

          <p className="mt-5 text-sm text-slate-400">Free to start. No credit card. No commitment. Cancel anytime.</p>

          {/* Stats */}
          <div className="mt-14 grid grid-cols-3 gap-6 border-t border-white/10 pt-10">
            {[
              { n: "20 min", label: "Average time to a complete business plan" },
              { n: "100%", label: "Free to start — no card required" },
              { n: "3 steps", label: "From idea to marketplace launch" },
            ].map(({ n, label }) => (
              <div key={n} className="text-center">
                <p className="text-2xl font-extrabold text-white sm:text-3xl">{n}</p>
                <p className="mt-1 text-xs text-slate-400 leading-snug">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TRUST BAR */}
      <section className="border-b border-slate-100 bg-slate-50 py-5">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10">
            {[
              { icon: "🔒", text: "ICO Registered" },
              { icon: "🛡️", text: "GDPR Compliant" },
              { icon: "🇬🇧", text: "Built for UK SMEs" },
              { icon: "🔐", text: "AES-256 Encrypted" },
              { icon: "⭐", text: "Trusted by Founders" },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                <span>{icon}</span>
                {text}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="py-24 bg-white">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <div className="mb-4 inline-block rounded-full bg-rose-50 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-rose-500">The Problem</div>
            <h2 className="text-3xl font-extrabold text-slate-900 sm:text-4xl">
              Most Funding Applications Fail<br />
              <span className="text-rose-500">Before They Even Start</span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-slate-500 leading-relaxed">
              Funders, lenders, and grant bodies ask the same important questions — and most business owners are not prepared to answer them clearly.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {QUESTIONS.map(({ icon, text }) => (
              <div key={text} className="group flex items-start gap-4 rounded-2xl border border-slate-100 bg-slate-50 px-5 py-4 transition-all hover:border-rose-200 hover:bg-rose-50">
                <span className="text-xl">{icon}</span>
                <span className="text-sm font-medium text-slate-700 leading-relaxed group-hover:text-rose-700">{text}</span>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl bg-gradient-to-r from-brand-600 to-brand-800 p-7 text-white text-center">
            <p className="text-lg font-bold mb-2">If you cannot answer these clearly, your funding conversation becomes weak.</p>
            <p className="text-brand-200 text-sm">EnterprateAI helps you organise every answer before you apply — in under 20 minutes.</p>
            <a href={`${APP_URL}/login`} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-bold text-brand-700 hover:bg-brand-50 transition-colors">
              Get Prepared Now — It's Free
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
            </a>
          </div>
        </div>
      </section>

      {/* 3 STEPS */}
      <section id="how-it-works" className="py-24 bg-slate-50">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="mb-14 text-center">
            <div className="mb-4 inline-block rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-brand-600">How It Works</div>
            <h2 className="text-3xl font-extrabold text-slate-900 sm:text-4xl">Get Funding-Ready in 3 Simple Steps</h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-slate-500">No experience needed. No expensive consultants. Just clear answers that funders want to see.</p>
          </div>

          <div className="space-y-6">
            {STEPS.map(({ n, icon, title, body, bullets, detail, color, light, tag }) => (
              <div key={n} className={`relative rounded-3xl border ${light} bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow`}>
                <div className={`absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b ${color}`} />
                <div className="p-7 pl-8">
                  <div className="flex items-start gap-5">
                    <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${color} text-2xl shadow-lg`}>
                      {icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-3 mb-2">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{n}</span>
                        <span className={`rounded-full bg-gradient-to-r ${color} px-3 py-0.5 text-xs font-bold text-white`}>{tag}</span>
                      </div>
                      <h3 className="text-lg font-extrabold text-slate-900 mb-2">{title}</h3>
                      <p className="text-sm text-slate-600 leading-relaxed mb-3">{body}</p>
                      {bullets && (
                        <div className="mb-3 flex flex-wrap gap-2">
                          {bullets.map(b => (
                            <span key={b} className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{b}</span>
                          ))}
                        </div>
                      )}
                      <p className="text-sm text-slate-500 leading-relaxed">{detail}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 text-center">
            <a href={`${APP_URL}/login`} className="inline-flex items-center gap-2 rounded-2xl bg-brand-600 px-8 py-4 text-base font-bold text-white shadow-lg shadow-brand-200 hover:bg-brand-700 transition-all">
              Start My 3 Steps Free
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
            </a>
            <p className="mt-3 text-xs text-slate-400">Free forever plan available. No credit card required.</p>
          </div>
        </div>
      </section>

      {/* WHY A BUSINESS PLAN */}
      <section id="why-plan" className="py-24 bg-slate-900 text-white">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <div className="mb-4 inline-block rounded-full bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-slate-300">Why It Matters</div>
            <h2 className="text-3xl font-extrabold sm:text-4xl">Why a Business Plan Matters for Funding</h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-slate-400 leading-relaxed">
              It is not just a document. It is your business argument. A strong plan opens doors. A weak one closes them.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 mb-10">
            {PLAN_POINTS.map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 hover:bg-white/10 transition-colors">
                <span className="text-lg">{icon}</span>
                <span className="text-sm text-slate-300">{text}</span>
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
              <p className="text-3xl mb-2">😟</p>
              <p className="text-sm font-bold text-rose-400 mb-1">If your plan is weak</p>
              <p className="text-sm text-slate-400">Your funding application may struggle. Funders move on to the next applicant.</p>
            </div>
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
              <p className="text-3xl mb-2">😊</p>
              <p className="text-sm font-bold text-emerald-400 mb-1">If your plan is clear</p>
              <p className="text-sm text-slate-400">Your conversation becomes stronger. Funders take you seriously and engage further.</p>
            </div>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="py-24 bg-white">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <div className="mb-4 inline-block rounded-full bg-amber-50 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-amber-600">What Founders Say</div>
            <h2 className="text-3xl font-extrabold text-slate-900 sm:text-4xl">Real Business Owners. Real Results.</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {TESTIMONIALS.map(({ quote, name, role, rating, init }) => (
              <div key={name} className="relative flex flex-col rounded-3xl border border-slate-100 bg-slate-50 p-7 shadow-sm hover:shadow-md transition-shadow">
                <div className="mb-4 flex gap-0.5">
                  {Array.from({ length: rating }).map((_, i) => <Star key={i} />)}
                </div>
                <p className="flex-1 text-sm leading-relaxed text-slate-600 mb-6">"{quote}"</p>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                    {init}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{name}</p>
                    <p className="text-xs text-slate-400">{role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section id="who" className="py-24 bg-gradient-to-br from-brand-600 to-brand-800 text-white">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <div className="mb-4 inline-block rounded-full bg-white/15 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-brand-100">Who It's For</div>
            <h2 className="text-3xl font-extrabold sm:text-4xl">Built for Business Owners Who Need to Move Fast</h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-brand-100">Whether you are testing your first idea or preparing to speak to funders next week.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 mb-10">
            {WHO.map(({ icon, label }, i) => (
              <div
                key={label}
                className={`flex items-center gap-4 rounded-2xl border border-white/20 bg-white/10 px-5 py-4 backdrop-blur-sm hover:bg-white/20 transition-colors${i === WHO.length - 1 && WHO.length % 2 !== 0 ? " sm:col-span-2" : ""}`}
              >
                <span className="text-2xl">{icon}</span>
                <span className="text-sm font-semibold text-white">{label}</span>
              </div>
            ))}
          </div>
          <div className="text-center">
            <a href={`${APP_URL}/login`} className="inline-flex items-center gap-2 rounded-2xl bg-white px-8 py-4 text-base font-bold text-brand-700 shadow-xl hover:bg-brand-50 transition-colors">
              This Is for Me — Get Started Free
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
            </a>
          </div>
        </div>
      </section>

      {/* JOURNEY */}
      <section className="py-24 bg-white">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <div className="mb-4 inline-block rounded-full bg-emerald-50 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-emerald-600">The Transformation</div>
            <h2 className="text-3xl font-extrabold text-slate-900 sm:text-4xl">From Idea to Funding-Ready — Faster</h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-slate-500">Most business owners already have the idea. The problem is turning that idea into something clear, structured, and funder-friendly.</p>
          </div>

          <div className="relative rounded-3xl border border-slate-100 bg-slate-50 p-8 md:p-10">
            <div className="flex flex-col gap-6 md:flex-row md:items-stretch md:gap-8">
              <div className="flex-1 rounded-2xl border-2 border-rose-200 bg-rose-50 p-6 text-center">
                <p className="text-3xl mb-3">😰</p>
                <p className="text-xs font-bold uppercase tracking-widest text-rose-400 mb-3">Before EnterprateAI</p>
                <p className="text-sm font-semibold text-rose-700 italic leading-relaxed">"I have an idea but I don't know how to present it. I don't have a business plan. I'm not sure if it will work."</p>
                <div className="mt-4 space-y-1.5 text-left">
                  {["No clear plan", "No validation", "Not funder-ready"].map(t => (
                    <div key={t} className="flex items-center gap-2 text-xs text-rose-500">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" /></svg>
                      {t}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-center">
                <div className="flex flex-col items-center gap-2 md:flex-col">
                  <div className="h-8 w-0.5 bg-brand-200 md:h-0.5 md:w-8 rotate-90 md:rotate-0"></div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 shadow-lg">
                    <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                  </div>
                  <div className="h-8 w-0.5 bg-brand-200 md:h-0.5 md:w-8 rotate-90 md:rotate-0"></div>
                </div>
              </div>

              <div className="flex-1 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-6 text-center">
                <p className="text-3xl mb-3">🚀</p>
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-500 mb-3">After EnterprateAI</p>
                <p className="text-sm font-semibold text-emerald-700 italic leading-relaxed">"I've validated my idea, generated a business plan, launched my offer, and started testing traction — all from one workspace."</p>
                <div className="mt-4 space-y-1.5 text-left">
                  {["Idea validated", "Plan generated", "Funding-ready"].map(t => (
                    <div key={t} className="flex items-center gap-2 text-xs text-emerald-600">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" /></svg>
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-6 text-center text-sm font-bold text-brand-600">All from one connected workspace. In under 20 minutes.</p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <div className="mb-4 inline-block rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-brand-600">FAQ</div>
            <h2 className="text-3xl font-extrabold text-slate-900 sm:text-4xl">Everything You Need to Know</h2>
          </div>
          <div className="space-y-3">
            {FAQS.map(({ q, a }) => <FAQItem key={q} q={q} a={a} />)}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative overflow-hidden py-28 bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 text-white">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-1/3 h-64 w-64 rounded-full bg-brand-500/20 blur-3xl" />
          <div className="absolute bottom-0 right-1/3 h-64 w-64 rounded-full bg-accent-500/15 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-300 mb-4">Before You Apply, Get Ready</p>
          <h2 className="text-3xl font-extrabold sm:text-5xl mb-4 leading-tight">
            Funding Starts With<br />
            <span className="bg-gradient-to-r from-brand-300 to-accent-400 bg-clip-text text-transparent">Preparation, Not Application</span>
          </h2>
          <p className="text-slate-400 text-base leading-relaxed mb-8 max-w-xl mx-auto">
            Validate your idea. Generate your business plan. Launch to marketplace. Test traction. Get your business ready for funding in less than 20 minutes.
          </p>

          <div className="mb-10 grid grid-cols-2 gap-3 max-w-sm mx-auto text-left sm:grid-cols-2">
            {["✅ Validate your idea", "📄 Generate your plan", "🚀 Launch to marketplace", "📊 Test traction"].map(step => (
              <div key={step} className="text-sm font-medium text-slate-300">{step}</div>
            ))}
          </div>

          <a
            href={`${APP_URL}/login`}
            className="group inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-600 px-10 py-5 text-lg font-bold text-white shadow-2xl shadow-brand-900/50 transition-all hover:from-brand-400 hover:to-brand-500"
          >
            Create My Funding Plan Free
            <svg className="h-5 w-5 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </a>
          <p className="mt-5 text-sm text-slate-500">Free to start. No credit card. No commitment.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-slate-100 bg-white py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-5 sm:flex-row">
            <img src="/logo.png" alt="EnterprateAI" className="h-8 w-auto" />
            <div className="flex flex-wrap justify-center gap-6 text-xs text-slate-400">
              <a href={`${APP_URL}/legal/privacy`} className="hover:text-brand-600 transition-colors">Privacy Policy</a>
              <a href={`${APP_URL}/legal/terms`} className="hover:text-brand-600 transition-colors">Terms of Service</a>
              <a href={`${APP_URL}/legal/disclaimer`} className="hover:text-brand-600 transition-colors">Disclaimer</a>
              <a href={`${APP_URL}/marketplace`} className="hover:text-brand-600 transition-colors">Marketplace</a>
              <a href={`${APP_URL}/login`} className="hover:text-brand-600 transition-colors">Log in</a>
            </div>
          </div>
          <p className="mt-6 text-center text-xs text-slate-300">
            © {new Date().getFullYear()} EnterprateAI. All rights reserved. ICO Registered · GDPR Compliant · Built in the UK 🇬🇧
          </p>
        </div>
      </footer>
    </div>
  );
}
