import { useState, useEffect } from "react";

const APP_URL = import.meta.env.VITE_APP_URL || "https://app.enterprateai.com";

const NAV_LINKS = [
  { label: "How It Works", href: "#how-it-works" },
  { label: "Why a Business Plan", href: "#why-plan" },
  { label: "Who It's For", href: "#who" },
  { label: "Marketplace", href: `${APP_URL}/marketplace` },
];

const QUESTIONS = [
  "What exactly does your business do?",
  "Who are your customers?",
  "Is there real demand?",
  "How will the business make money?",
  "What are your costs?",
  "What risks should be considered?",
  "How much funding do you need?",
  "How will the money be used?",
];

const STEPS = [
  {
    n: "1",
    title: "Validate your business idea",
    body: "Check whether your idea makes commercial sense before spending more time, money, or energy.",
    detail: "EnterprateAI helps you assess your idea based on customer need, market opportunity, pricing, costs, demand evidence, risks, and growth potential.",
  },
  {
    n: "2",
    title: "Generate your business plan",
    body: "Once you accept your validation result, EnterprateAI uses the same data to generate a structured business plan.",
    bullets: ["No blank page.", "No confusing templates.", "No starting from scratch."],
    detail: "You get a clearer plan covering your business model, customers, services, pricing, operations, financial assumptions, risks, and growth direction.",
  },
  {
    n: "3",
    title: "Launch to marketplace and test traction",
    body: "After your plan is created, you can launch your product or service to the marketplace and start testing visibility.",
    detail: "Because funders do not just want ideas. They want to see clarity, preparation, and signs of market interest.",
  },
];

const PLAN_POINTS = [
  "What your business does",
  "Who your customers are",
  "What problem you solve",
  "How your business makes money",
  "What your costs are",
  "What funding you need",
  "How the funding will be used",
  "What risks you understand",
  "How the business can grow",
];

const WHO = [
  "New business owners",
  "Startup founders",
  "Grant applicants",
  "Small businesses seeking loans",
  "Entrepreneurs preparing for investment",
  "Consultants and service providers launching new offers",
  "Founders who need a business plan quickly",
];

const DIFFERENTIATORS = [
  "Your idea validation becomes the foundation for your business plan.",
  "Your business plan becomes the foundation for your marketplace launch.",
  "Your marketplace launch helps you test visibility and traction.",
  "Your business data becomes more useful for better decisions.",
];

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

function CheckIcon({ className = "" }) {
  return (
    <svg className={`h-4 w-4 shrink-0 ${className}`} viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
    </svg>
  );
}

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "auto";
    document.body.style.overflowX = "hidden";
    return () => {
      document.body.style.overflow = "";
      document.body.style.overflowX = "";
    };
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden bg-white font-sans text-slate-900 antialiased">

      {/* NAV */}
      <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="EnterprateAI" className="h-8 w-auto" />
          </a>

          <nav className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map(l =>
              l.href.startsWith("#")
                ? <button key={l.label} onClick={() => scrollTo(l.href.slice(1))} className="text-sm font-medium text-slate-600 hover:text-brand-600 transition-colors">{l.label}</button>
                : <a key={l.label} href={l.href} className="text-sm font-medium text-slate-600 hover:text-brand-600 transition-colors">{l.label}</a>
            )}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <a href={`${APP_URL}/login`} className="text-sm font-semibold text-slate-600 hover:text-brand-600 transition-colors">Log in</a>
            <a href={`${APP_URL}/login`} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors">Get Started Free</a>
          </div>

          <button type="button" className="md:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => setMobileMenuOpen(v => !v)}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {mobileMenuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-slate-100 bg-white px-4 pb-4 md:hidden">
            {NAV_LINKS.map(l =>
              l.href.startsWith("#")
                ? <button key={l.label} onClick={() => { scrollTo(l.href.slice(1)); setMobileMenuOpen(false); }} className="block w-full py-2.5 text-left text-sm font-medium text-slate-700">{l.label}</button>
                : <a key={l.label} href={l.href} className="block py-2.5 text-sm font-medium text-slate-700">{l.label}</a>
            )}
            <div className="mt-3 flex gap-3">
              <a href={`${APP_URL}/login`} className="flex-1 rounded-xl border border-slate-200 py-2 text-center text-sm font-semibold text-slate-700">Log in</a>
              <a href={`${APP_URL}/login`} className="flex-1 rounded-xl bg-brand-600 py-2 text-center text-sm font-semibold text-white">Get Started</a>
            </div>
          </div>
        )}
      </header>

      {/* HERO */}
      <section className="bg-gradient-to-b from-slate-50 to-white py-20 sm:py-24 lg:py-28">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Validate your idea.{" "}
            <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">Generate your business plan.</span>{" "}
            Launch to marketplace. Test traction.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
            Before you apply for a grant, loan, investment, partnership, or business support, make sure your business is clear, structured, and ready to be taken seriously.
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-slate-500">
            EnterprateAI helps you turn your business idea into a structured business plan and market-ready profile using your own business information.
          </p>
          <div className="mt-10">
            <a
              href={`${APP_URL}/login`}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-8 py-4 text-base font-bold text-white shadow-lg hover:bg-brand-700 transition-colors"
            >
              Create My Funding Plan Free
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </a>
          </div>
          <p className="mt-4 text-sm text-slate-400">Free to start. No credit card required.</p>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl mb-2">
            Don't Apply for Funding With Scattered Ideas
          </h2>
          <p className="text-base text-slate-500 mb-8 leading-relaxed">
            Many business owners want funding, but they are not ready when funders ask the important questions.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 mb-8">
            {QUESTIONS.map(q => (
              <div key={q} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-accent-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                </svg>
                <span className="text-sm text-slate-700">{q}</span>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-brand-100 bg-brand-50 px-6 py-5">
            <p className="text-sm font-semibold text-brand-700">
              If these answers are not clear, your funding conversation becomes weak.
            </p>
            <p className="mt-1 text-sm text-brand-600">
              EnterprateAI helps you organise the answers before you apply.
            </p>
          </div>
        </div>
      </section>

      {/* 3 STEPS */}
      <section id="how-it-works" className="py-20 bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-500 mb-2">How It Works</p>
            <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">Get Funding-Ready in 3 Simple Steps</h2>
          </div>
          <div className="space-y-6">
            {STEPS.map(({ n, title, body, bullets, detail }) => (
              <div key={n} className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
                <div className="flex items-start gap-5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-lg font-extrabold text-white">
                    {n}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-bold text-slate-900 mb-2">{title}</h3>
                    <p className="text-sm text-slate-600 leading-relaxed mb-3">{body}</p>
                    {bullets && (
                      <ul className="mb-3 space-y-1">
                        {bullets.map(b => (
                          <li key={b} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-brand-500 shrink-0"></span>
                            {b}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-sm text-slate-500 leading-relaxed">{detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY A BUSINESS PLAN */}
      <section id="why-plan" className="py-20 bg-white">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="mb-10">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-500 mb-2">Why It Matters</p>
            <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl mb-4">Why a Business Plan Matters for Funding</h2>
            <p className="text-base text-slate-500 leading-relaxed">A business plan helps you show:</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 mb-8">
            {PLAN_POINTS.map(point => (
              <div key={point} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <CheckIcon className="text-brand-500" />
                <span className="text-sm text-slate-700">{point}</span>
              </div>
            ))}
          </div>
          <div className="rounded-2xl bg-slate-900 text-white px-7 py-6 space-y-3">
            <p className="text-sm leading-relaxed text-slate-300">It is not just a document. It is your business argument.</p>
            <p className="text-sm font-semibold text-rose-400">If your plan is weak, your funding application may struggle.</p>
            <p className="text-sm font-semibold text-emerald-400">If your plan is clear, your conversation becomes stronger.</p>
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section id="who" className="py-20 bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="mb-10">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-500 mb-2">Who It's For</p>
            <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl mb-4">Built for Business Owners Who Need to Move Fast</h2>
            <p className="text-base text-slate-500 leading-relaxed">EnterprateAI is for:</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 mb-8">
            {WHO.map((item, i) => (
              <div
                key={item}
                className={`flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm${i === WHO.length - 1 && WHO.length % 2 !== 0 ? " sm:col-span-2" : ""}`}
              >
                <CheckIcon className="text-brand-500" />
                <span className="text-sm text-slate-700">{item}</span>
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-500 leading-relaxed">
            Whether you are still testing your idea or preparing to speak to funders, EnterprateAI helps you move from idea to structured plan faster.
          </p>
        </div>
      </section>

      {/* FROM IDEA TO FUNDING */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="mb-10">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-500 mb-2">The Journey</p>
            <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl mb-4">From Idea to Funding Preparation Faster</h2>
            <p className="text-base text-slate-500 leading-relaxed mb-2">Most business owners already have the idea.</p>
            <p className="text-base text-slate-500 leading-relaxed">The problem is turning that idea into something clear, structured, and funder-friendly.</p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-7">
            <p className="text-base text-slate-500 mb-6">EnterprateAI helps you move from:</p>
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
              <div className="flex-1 rounded-xl border border-rose-100 bg-rose-50 px-5 py-4 text-center">
                <p className="text-sm font-semibold text-rose-700 italic">"I have an idea."</p>
              </div>
              <div className="flex items-center justify-center">
                <svg className="h-6 w-6 text-brand-400 rotate-90 sm:rotate-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </div>
              <div className="flex-1 rounded-xl border border-emerald-100 bg-emerald-50 px-5 py-4 text-center">
                <p className="text-sm font-semibold text-emerald-700 italic leading-relaxed">
                  "I have validated my idea, generated a business plan, launched my offer, and started testing traction."
                </p>
              </div>
            </div>
            <p className="mt-6 text-center text-sm font-semibold text-brand-600">All from one connected workspace.</p>
          </div>
        </div>
      </section>

      {/* WHAT MAKES IT DIFFERENT */}
      <section className="py-20 bg-gradient-to-br from-brand-600 to-brand-800 text-white">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="mb-10">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-200 mb-2">What Makes It Different</p>
            <h2 className="text-2xl font-extrabold sm:text-3xl mb-4">What Makes EnterprateAI Different?</h2>
            <p className="text-brand-100 text-base leading-relaxed mb-1">Most tools help you write a document.</p>
            <p className="text-white font-semibold text-base leading-relaxed">EnterprateAI helps you prepare the business behind the document.</p>
          </div>
          <div className="space-y-4 mb-10">
            {DIFFERENTIATORS.map((d, i) => (
              <div key={i} className="flex items-start gap-4 rounded-xl bg-white/10 border border-white/20 px-5 py-4">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-xs font-bold text-white">
                  {i + 1}
                </div>
                <p className="text-sm text-brand-100 leading-relaxed">{d}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl bg-white/10 border border-white/20 px-6 py-5 text-center space-y-1">
            <p className="text-sm text-brand-100">So you are not just creating a business plan.</p>
            <p className="text-base font-bold text-white">You are preparing your business to be clearer, stronger, and more funding-ready.</p>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-20 bg-slate-900 text-white">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-400 mb-4">Before You Apply, Get Ready</p>
          <p className="text-slate-400 text-base leading-relaxed mb-2">Funding does not start with an application. It starts with preparation.</p>
          <div className="my-8 grid gap-2 sm:grid-cols-2 max-w-md mx-auto text-left">
            {["Validate your idea.", "Generate your business plan.", "Launch to marketplace.", "Test traction."].map(step => (
              <div key={step} className="flex items-center gap-2 text-sm text-slate-300">
                <CheckIcon className="text-brand-400" />
                {step}
              </div>
            ))}
          </div>
          <p className="text-slate-400 text-sm mb-8">Get your business ready for funding in less than 20 minutes.</p>
          <a
            href={`${APP_URL}/login`}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-8 py-4 text-base font-bold text-white hover:bg-brand-700 transition-colors shadow-lg"
          >
            Create My Funding Plan Free
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </a>
          <p className="mt-4 text-sm text-slate-500">Free to start. No credit card required.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-slate-100 bg-white py-8">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <img src="/logo.png" alt="EnterprateAI" className="h-7 w-auto" />
            <div className="flex flex-wrap justify-center gap-5 text-xs text-slate-400">
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
