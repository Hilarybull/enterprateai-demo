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
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-slate-50 to-white px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl">
        {/* Logo */}
        <Link to="/" className="inline-flex items-center gap-2 mb-10">
          <img src={logoUrl} alt="EnterprateAI" className="h-8 w-auto" />
          <span className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">Beta</span>
        </Link>

        {/* Hero */}
        <div className="text-center mb-10">
          <span className="inline-block rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-brand-700 mb-4">
            Interactive Demo Sandbox
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Try EnterprateAI. No sign-up needed
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-500 max-w-lg mx-auto">
            Jump straight into a fully loaded demo environment. A guided tour walks you through every feature, or skip the tour and explore freely.
          </p>
        </div>

        {/* Primary CTA — Sandbox */}
        <div className="rounded-2xl bg-brand-600 p-6 text-center shadow-lg mb-6">
          <div className="flex justify-center mb-2">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 16.5c-1.5 1.5-1.5 3.5-1.5 3.5s2 0 3.5-1.5L18 7a3 3 0 0 0-4-4L4.5 16.5z"/>
              <path d="M9 15l-2 5 5-2"/>
              <path d="M14.5 9.5l-5 5"/>
            </svg>
          </div>
          <h2 className="text-lg font-bold text-white mb-1">Launch the sandbox</h2>
          <p className="text-sm text-brand-100 mb-5">
            Pre-loaded with sample data &middot; All features unlocked &middot; Nothing gets saved
          </p>
          <button
            onClick={launchSandbox}
            disabled={sandboxLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-3.5 text-sm font-bold text-brand-700 shadow transition hover:bg-brand-50 active:scale-95 disabled:opacity-70"
          >
            {sandboxLoading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-300 border-t-brand-700 inline-block" />
                Launching…
              </>
            ) : (
              "Start interactive tour →"
            )}
          </button>
          {sandboxError && (
            <p className="mt-3 text-xs text-rose-300">{sandboxError}</p>
          )}
          <p className="mt-4 text-xs text-brand-200">
            Or{" "}
            <Link to="/login?signup=1" className="underline hover:text-white transition">
              create your own free account
            </Link>
          </p>
        </div>

        {/* Feature grid */}
        <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">
          What you'll explore
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-10">
          {FEATURES.map(({ icon, title, desc }) => (
            <div key={title} className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
              <div className="flex justify-center mb-2 text-brand-600">{FEATURE_ICON[icon]}</div>
              <div className="text-[12px] font-bold text-slate-900 mb-0.5">{title}</div>
              <div className="text-[11px] text-slate-500 leading-snug">{desc}</div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="flex items-center gap-4 my-10">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">or book a personal demo</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        {/* Secondary CTA — Booking form */}
        {formStatus === "success" ? (
          <div className="rounded-2xl border border-brand-200 bg-white p-8 shadow-sm text-center mb-8">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-100">
              <svg className="h-7 w-7 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-900">Request received!</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Our team will reach out within <strong>1 business day</strong> to schedule a walkthrough tailored to your business.
            </p>
            <button
              onClick={() => setFormStatus("idle")}
              className="mt-5 text-sm font-semibold text-brand-600 hover:underline"
            >
              Submit another request
            </button>
          </div>
        ) : (
          <div className="mb-8">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-slate-900">Book a guided walkthrough</h2>
              <p className="mt-2 text-sm text-slate-500">
                Prefer a personalised demo with one of our team? Fill in your details and we'll be in touch within 1 business day.
              </p>
              <ul className="mt-3 space-y-1">
                {[
                  "Live product demo tailored to your business type",
                  "Q&A with a product specialist",
                  "Guidance on getting started quickly",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="mt-0.5 shrink-0 font-bold text-brand-500">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <form onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4 sm:p-8">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="ea-label block mb-1">Full name <span className="text-rose-500">*</span></label>
                  <input
                    required
                    value={form.name}
                    onChange={set("name")}
                    placeholder="Jane Smith"
                    className="ea-input w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  />
                </div>
                <div>
                  <label className="ea-label block mb-1">Work email <span className="text-rose-500">*</span></label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    placeholder="jane@company.com"
                    className="ea-input w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="ea-label block mb-1">Company / Business name <span className="text-rose-500">*</span></label>
                  <input
                    required
                    value={form.company}
                    onChange={set("company")}
                    placeholder="Acme Ltd"
                    className="ea-input w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  />
                </div>
                <div>
                  <label className="ea-label block mb-1">Phone <span className="text-slate-400 font-normal">(optional)</span></label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={set("phone")}
                    placeholder="+44 7700 000000"
                    className="ea-input w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  />
                </div>
              </div>

              <div>
                <label className="ea-label block mb-1">Your role</label>
                <select
                  value={form.role}
                  onChange={set("role")}
                  className="ea-input w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 bg-white"
                >
                  <option value="">Select your role…</option>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <label className="ea-label block mb-1">What would you like to see? <span className="text-slate-400 font-normal">(optional)</span></label>
                <textarea
                  rows={3}
                  value={form.message}
                  onChange={set("message")}
                  placeholder="e.g. How do I validate my business idea? Can I import my Xero data? How does the marketplace work?"
                  className="ea-input w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
              </div>

              {formStatus === "error" && (
                <p className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-600">{formError}</p>
              )}

              <button
                type="submit"
                disabled={formStatus === "loading"}
                className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                {formStatus === "loading" ? "Sending…" : "Request a Demo →"}
              </button>

              <p className="text-center text-xs text-slate-400">
                Prefer to sign up now?{" "}
                <Link to="/login?signup=1" className="font-semibold text-brand-600 hover:underline">
                  Create a free account
                </Link>
              </p>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
