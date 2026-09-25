import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest, invalidateWorkspaceCache } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import logoUrl from "../enterprate-logo.png";

// Same option values the full workspace form uses (WorkspaceProfile schema).
const BUSINESS_TYPES = [
  ["sole_trader", "Sole trader"], ["partnership", "Partnership"], ["limited_company", "Limited company"],
  ["llp", "LLP"], ["non_profit", "Non-profit"], ["startup", "Startup"],
];
const INDUSTRIES = [
  ["consulting", "Consulting"], ["technology", "Technology"], ["finance", "Finance"], ["healthcare", "Healthcare"],
  ["education", "Education"], ["retail", "Retail"], ["ecommerce", "E-commerce"], ["logistics", "Logistics"],
  ["manufacturing", "Manufacturing"], ["real_estate", "Real estate"], ["marketing", "Marketing"], ["other", "Other"],
];
const STAGES = [
  ["idea", "Just an idea"], ["pre_revenue", "Pre-revenue"], ["early_revenue", "Early revenue"],
  ["growing", "Growing"], ["established", "Established"],
];
const SIZES = [["solo", "Just me"], ["2-5", "2–5"], ["6-10", "6–10"], ["11-50", "11–50"], ["51-200", "51–200"], ["200+", "200+"]];

const STEPS = [
  { key: "identity", title: "What's your business called?", desc: "This names your workspace. You can change it anytime." },
  { key: "about", title: "Tell us about it", desc: "A short description helps us tailor plans, proposals and insights." },
  { key: "location", title: "Where are you based?", desc: "Used on your invoices, quotations and marketplace listing." },
  { key: "services", title: "What do you offer?", desc: "Add up to three products or services. You can add more later." },
];

const inputCls = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

function Field({ label, optional, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-300">
        {label}{optional && <span className="ml-1 font-normal text-slate-400">(optional)</span>}
      </span>
      {children}
    </label>
  );
}

function Select({ value, onChange, options, placeholder }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      <option value="">{placeholder}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState({
    company_name: "", business_type: "", primary_industry: "",
    tagline: "", about_company: "", operating_stage: "", company_size: "",
    country: "", city: "", phone_number: "", website: "",
    services: ["", "", ""],
  });

  const set = (key) => (value) => setAnswers((a) => ({ ...a, [key]: value }));
  const setService = (i) => (value) => setAnswers((a) => ({ ...a, services: a.services.map((s, j) => (j === i ? value : s)) }));

  async function finish(finalAnswers) {
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...finalAnswers,
        services: (finalAnswers.services || []).filter((s) => s.trim()).map((s) => ({ service_name: s.trim() })),
      };
      const res = await apiRequest("/workspace/profile/onboarding", "POST", { answers: payload });
      const ws = useWorkspaceStore.getState();
      ws.setWorkspaceId(res.workspace_id);
      ws.setWorkspaceName(res.workspace_name || "My workspace");
      if (res.company_name) ws.setWorkspaceCompanyName?.(res.company_name);
      invalidateWorkspaceCache();
      ws.clearWsDoc?.();
      window.dispatchEvent(new CustomEvent("ea:workspace:refresh"));
      navigate(next, { replace: true });
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).replace(/^HTTP \d+:\s*/, "") || "Could not save. Please try again.");
      setSaving(false);
    }
  }

  // Skipping a step clears that step's answers so the default is kept.
  function skipStep() {
    const cleared = { ...answers };
    const k = STEPS[step].key;
    if (k === "identity") Object.assign(cleared, { company_name: "", business_type: "", primary_industry: "" });
    if (k === "about") Object.assign(cleared, { tagline: "", about_company: "", operating_stage: "", company_size: "" });
    if (k === "location") Object.assign(cleared, { country: "", city: "", phone_number: "", website: "" });
    if (k === "services") cleared.services = ["", "", ""];
    setAnswers(cleared);
    if (step < STEPS.length - 1) setStep(step + 1);
    else finish(cleared);
  }

  function next_() {
    if (answers.about_company.trim() && answers.about_company.trim().length < 10 && STEPS[step].key === "about") {
      setError("Please write at least 10 characters, or leave it blank.");
      return;
    }
    setError("");
    if (step < STEPS.length - 1) setStep(step + 1);
    else finish(answers);
  }

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[linear-gradient(135deg,_#f7f8ff_0%,_#ffffff_55%,_#fff2f5_100%)] px-4 py-10 dark:bg-slate-950 dark:bg-none">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center justify-between">
          <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto" />
          <button type="button" disabled={saving} onClick={() => finish({})}
            className="text-[13px] font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200">
            Skip setup
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <span key={s.key} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-700"}`} />
            ))}
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-600">Set up your workspace · Step {step + 1} of {STEPS.length}</p>
          <h1 className="mt-1.5 text-xl font-extrabold text-slate-900 dark:text-slate-100">{current.title}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{current.desc}</p>

          <div className="mt-6 space-y-4">
            {current.key === "identity" && (
              <>
                <Field label="Business name">
                  <input className={inputCls} value={answers.company_name} maxLength={120} autoFocus
                    onChange={(e) => set("company_name")(e.target.value)} placeholder="e.g. Apex Consulting Ltd" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Business type" optional><Select value={answers.business_type} onChange={set("business_type")} options={BUSINESS_TYPES} placeholder="Choose…" /></Field>
                  <Field label="Industry" optional><Select value={answers.primary_industry} onChange={set("primary_industry")} options={INDUSTRIES} placeholder="Choose…" /></Field>
                </div>
              </>
            )}
            {current.key === "about" && (
              <>
                <Field label="Tagline" optional>
                  <input className={inputCls} value={answers.tagline} maxLength={140} onChange={(e) => set("tagline")(e.target.value)} placeholder="One line about what you do" />
                </Field>
                <Field label="Description" optional>
                  <textarea className={`${inputCls} min-h-[96px]`} value={answers.about_company} maxLength={2000}
                    onChange={(e) => set("about_company")(e.target.value)} placeholder="Who you serve and how you help them" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Stage" optional><Select value={answers.operating_stage} onChange={set("operating_stage")} options={STAGES} placeholder="Choose…" /></Field>
                  <Field label="Team size" optional><Select value={answers.company_size} onChange={set("company_size")} options={SIZES} placeholder="Choose…" /></Field>
                </div>
              </>
            )}
            {current.key === "location" && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Country" optional><input className={inputCls} value={answers.country} maxLength={80} onChange={(e) => set("country")(e.target.value)} placeholder="United Kingdom" /></Field>
                  <Field label="City" optional><input className={inputCls} value={answers.city} maxLength={80} onChange={(e) => set("city")(e.target.value)} placeholder="London" /></Field>
                </div>
                <Field label="Phone" optional><input className={inputCls} value={answers.phone_number} maxLength={40} onChange={(e) => set("phone_number")(e.target.value)} inputMode="tel" /></Field>
                <Field label="Website" optional><input className={inputCls} value={answers.website} maxLength={200} onChange={(e) => set("website")(e.target.value)} placeholder="https://" inputMode="url" /></Field>
              </>
            )}
            {current.key === "services" && answers.services.map((s, i) => (
              <Field key={i} label={`Product or service ${i + 1}`} optional>
                <input className={inputCls} value={s} maxLength={120} onChange={(e) => setService(i)(e.target.value)}
                  placeholder={["e.g. Bookkeeping", "e.g. Payroll", "e.g. Tax returns"][i]} />
              </Field>
            ))}
          </div>

          {error && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}

          <div className="mt-7 flex items-center gap-3">
            {step > 0 && (
              <button type="button" disabled={saving} onClick={() => { setError(""); setStep(step - 1); }}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                Back
              </button>
            )}
            <button type="button" disabled={saving} onClick={skipStep}
              className="ml-auto rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200">
              Skip
            </button>
            <button type="button" disabled={saving} onClick={next_}
              className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {saving ? "Saving…" : last ? "Finish" : "Continue"}
            </button>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">You can edit your workspace anytime from the sidebar.</p>
      </div>
    </div>
  );
}
