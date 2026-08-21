import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuthStore } from "../store/auth";
import logoUrl from "../enterprate-logo.png";
import { TOUR_STEPS } from "../context/DemoTourContext";
import { useDemoTour } from "../context/DemoTourContext";

const FEATURE_ICON = {
  dashboard: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
    </svg>
  ),
  validation: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a7 7 0 0 0-4 12c.6.5 1 1.2 1.1 2h5.8c.1-.8.5-1.5 1.1-2A7 7 0 0 0 12 2Z"/>
      <path d="M9 18h6"/><path d="M10 22h4"/>
    </svg>
  ),
  simulation: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h12"/><path d="M10 2v6l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V2"/>
      <path d="M8 14h8"/>
    </svg>
  ),
  blueprint: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19a2 2 0 0 0 2 2h14"/><path d="M6 2h14v17H6a2 2 0 0 0-2 2V4a2 2 0 0 1 2-2Z"/>
    </svg>
  ),
  catalogue: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
      <polyline points="3.3 7.3 12 12 20.7 7.3"/><line x1="12" y1="22" x2="12" y2="12"/>
    </svg>
  ),
  financials: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  ),
  integrations: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  ),
  marketplace: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>
  ),
};

const FEATURES = [
  { icon: "dashboard", title: "Dashboard", desc: "Live revenue, cash balance & AI recommendations" },
  { icon: "validation", title: "Idea Validation", desc: "Score your concept before investing a penny" },
  { icon: "simulation", title: "Simulation", desc: "Test decisions risk-free before committing" },
  { icon: "blueprint", title: "Business Blueprints", desc: "Generate plans and proposals in seconds" },
  { icon: "catalogue", title: "Catalogue", desc: "Products, customers, vendors in one place" },
  { icon: "financials", title: "Financials", desc: "Invoicing and expense tracking with zero re-entry" },
  { icon: "integrations", title: "Integrations", desc: "Connect QuickBooks, Xero, Zoho, Stripe" },
  { icon: "marketplace", title: "Marketplace", desc: "List your business and get discovered by buyers" },
];

const ROLES = [
  "Founder / Co-founder",
  "Business Owner",
  "Operations Manager",
  "Sales / Business Development",
  "Finance / Accounting",
  "Marketing",
  "Product / Tech",
  "Investor / Advisor",
  "Other",
];

export default function BookDemoPage() {
  const navigate = useNavigate();
  const { startTour } = useDemoTour() || {};
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxError, setSandboxError] = useState(null);

  const [form, setForm] = useState({ name: "", email: "", company: "", phone: "", role: "", message: "" });
  const [formStatus, setFormStatus] = useState("idle"); // idle | loading | success | error
  const [formError, setFormError] = useState("");

  function set(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function exitDemoMode() {
    localStorage.removeItem("ea_token");
    localStorage.removeItem("ea_email");
    sessionStorage.removeItem("ea_tour_active");
    sessionStorage.removeItem("ea_tour_step");
    sessionStorage.removeItem("ea_tour_done");
  }

  async function launchSandbox() {
    setSandboxLoading(true);
    setSandboxError(null);
    try {
      const data = await apiRequest("/auth/demo", "POST");
      const token = data?.access_token ?? data?.token;
      if (!token) throw new Error("no_token");
      localStorage.setItem("ea_token", token);
      localStorage.setItem("ea_email", "demo");
      sessionStorage.removeItem("ea_tour_done");
      await useAuthStore.getState().hydrate();
      startTour?.();
    } catch {
      setSandboxError("Demo sandbox is unavailable right now. Please try again shortly.");
    } finally {
      setSandboxLoading(false);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.company.trim()) return;
    setFormStatus("loading");
    setFormError("");
    try {
      await apiRequest("/demo/book", "POST", {
        name: form.name.trim(),
        email: form.email.trim(),
        company: form.company.trim(),
        phone: form.phone.trim() || undefined,
        role: form.role || undefined,
        message: form.message.trim() || undefined,
      });
      setFormStatus("success");
    } catch (err) {
      setFormStatus("error");
      setFormError(err?.message || "Something went wrong. Please try again.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col">

      {/* NAVBAR */}
      <nav className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/90 px-6 py-3 backdrop-blur">
        <Link to="/" className="inline-flex items-center gap-2">
          <img src={logoUrl} alt="EnterprateAI" className="h-8 w-auto" />
          <span className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">Beta</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/login" onClick={exitDemoMode} className="text-sm font-medium text-slate-600 hover:text-slate-900 transition">Sign in</Link>
          <Link to="/login?signup=1" onClick={exitDemoMode} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700">Get Started Free</Link>
        </div>
      </nav>

      {/* SPLIT BODY */}
      <div className="flex flex-1 flex-col lg:flex-row">

      {/* LEFT PANEL — brand */}
      <div className="relative flex flex-col justify-between overflow-hidden bg-brand-700 px-8 py-10 text-white lg:w-[45%]">
        {/* background texture */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "28px 28px" }} />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -top-20 right-0 h-64 w-64 rounded-full bg-brand-500/40 blur-3xl" />

        <div className="relative">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-brand-300">Interactive Sandbox</p>
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            Try EnterprateAI.<br />No sign-up needed.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-white/80">
            Jump into a fully loaded demo environment with real sample data. A guided tour walks you through every feature, or explore freely at your own pace.
          </p>

          <button
            onClick={launchSandbox}
            disabled={sandboxLoading}
            data-tour="book-demo-start"
            className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-bold text-brand-700 shadow-lg transition hover:bg-brand-50 active:scale-95 disabled:opacity-70 sm:w-auto"
          >
            {sandboxLoading ? (
              <><span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-300 border-t-brand-700" />Launching…</>
            ) : "Start interactive tour →"}
          </button>
          {sandboxError && <p className="mt-3 text-xs text-rose-300">{sandboxError}</p>}
          <p className="mt-4 text-sm text-white/60">
            Or{" "}
            <Link to="/login?signup=1" onClick={exitDemoMode} className="text-white/80 underline underline-offset-2 hover:text-white transition">create your own free account</Link>
          </p>
        </div>

        {/* Feature list */}
        <div className="relative mt-10 grid grid-cols-2 gap-x-4 gap-y-2">
          {FEATURES.map(({ icon, title }) => (
            <div key={title} className="flex items-center gap-2">
              <span className="text-brand-300">{FEATURE_ICON[icon]}</span>
              <span className="text-sm font-medium text-white/90">{title}</span>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT PANEL — booking form */}
      <div className="flex flex-1 flex-col justify-center bg-slate-50 px-6 py-10 sm:px-10 lg:overflow-y-auto">
        <div className="mx-auto w-full max-w-md">
          {formStatus === "success" ? (
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100">
                <svg className="h-8 w-8 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              </div>
              <h2 className="text-2xl font-extrabold text-slate-900">Request received!</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-500">
                Our team will reach out within <strong>1 business day</strong> to schedule a walkthrough tailored to your business.
              </p>
              <button onClick={() => setFormStatus("idle")} className="mt-6 text-sm font-semibold text-brand-600 hover:underline">Submit another request</button>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-2xl font-extrabold text-slate-900">Book a guided walkthrough</h2>
                <p className="mt-1 text-sm text-slate-500">Prefer a personalised demo with our team? Fill in your details and we'll be in touch within 1 business day.</p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-700">Full name <span className="text-rose-500">*</span></label>
                    <input required value={form.name} onChange={set("name")} placeholder="Jane Smith" className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-700">Work email <span className="text-rose-500">*</span></label>
                    <input required type="email" value={form.email} onChange={set("email")} placeholder="jane@company.com" className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-700">Company <span className="text-rose-500">*</span></label>
                    <input required value={form.company} onChange={set("company")} placeholder="Acme Ltd" className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-700">Phone <span className="text-slate-400 font-normal">(optional)</span></label>
                    <input type="tel" value={form.phone} onChange={set("phone")} placeholder="+44 7700 000000" className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">Your role</label>
                  <select value={form.role} onChange={set("role")} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
                    <option value="">Select your role…</option>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">What would you like to see? <span className="text-slate-400 font-normal">(optional)</span></label>
                  <textarea rows={3} value={form.message} onChange={set("message")} placeholder="e.g. invoicing workflow, idea validation, marketplace listing…" className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                </div>

                {formStatus === "error" && (
                  <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{formError}</p>
                )}

                <button type="submit" disabled={formStatus === "loading"} className="w-full rounded-xl bg-brand-600 py-3 text-sm font-bold text-white shadow transition hover:bg-brand-700 active:scale-95 disabled:opacity-60">
                  {formStatus === "loading" ? "Sending…" : "Request a Demo →"}
                </button>

                <p className="text-center text-xs text-slate-400">
                  Prefer to sign up now?{" "}
                  <Link to="/login?signup=1" onClick={exitDemoMode} className="font-semibold text-brand-600 hover:underline">Create a free account</Link>
                </p>
              </form>
            </>
          )}
        </div>
      </div>
      </div>

      {/* FOOTER */}
      <footer className="border-t border-slate-200 bg-white py-6 px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
          <Link to="/" className="inline-flex items-center gap-2">
            <img src={logoUrl} alt="EnterprateAI" className="h-6 w-auto opacity-80" />
          </Link>
          <p className="text-xs text-slate-400">© {new Date().getFullYear()} EnterprateAI. All rights reserved.</p>
          <div className="flex gap-4 text-xs text-slate-500">
            <Link to="/privacy" className="hover:text-slate-800 transition">Privacy</Link>
            <Link to="/terms" className="hover:text-slate-800 transition">Terms</Link>
            <Link to="/login" className="hover:text-slate-800 transition">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
