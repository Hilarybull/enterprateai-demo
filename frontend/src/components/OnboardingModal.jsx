import { useState } from "react";
import { useNavigate } from "react-router-dom";
import logoUrl from "../enterprate-logo.png";

const STEPS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    title: "Create your workspace",
    desc: "Your workspace is the foundation. Name your business, set your logo and define your services — everything else builds from here.",
    highlight: true,
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M12 2a7 7 0 0 0-4 12c.6.5 1 1.2 1.1 2h5.8c.1-.8.5-1.5 1.1-2A7 7 0 0 0 12 2Z" />
      </svg>
    ),
    title: "Validate your idea",
    desc: "AI scores your business concept for market fit, viability and risk so you know what you are working with before spending a penny.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M6 2h12" />
        <path d="M10 2v6l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V2" />
        <path d="M8 14h8" />
      </svg>
    ),
    title: "Run financial simulations",
    desc: "Model scenarios like pricing changes, new hires and market shifts to see the impact on your bottom line before you commit.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    title: "Invite your team",
    desc: "Bring collaborators in. Share your workspace, delegate tasks and build your business together.",
  },
];

const STORAGE_KEY = "ea_onboarded";

export function markOnboarded() {
  try { localStorage.setItem(STORAGE_KEY, "1"); } catch (_) {}
}

export function hasSeenOnboarding() {
  try { return !!localStorage.getItem(STORAGE_KEY); } catch (_) { return false; }
}

export default function OnboardingModal({ onDismiss }) {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);

  function handleCreate() {
    markOnboarded();
    setLeaving(true);
    setTimeout(() => {
      onDismiss?.();
      navigate("/validation?from=module&return=/dashboard");
    }, 180);
  }

  function handleSkip() {
    markOnboarded();
    onDismiss?.();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
        onClick={handleSkip}
      />

      {/* Card */}
      <div
        className={`relative z-10 w-full max-w-2xl rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700 transition-all duration-200 ${
          leaving ? "scale-95 opacity-0" : "scale-100 opacity-100"
        }`}
      >
        {/* Header */}
        <div className="relative overflow-hidden rounded-t-3xl bg-gradient-to-br from-brand-600 via-brand-500 to-accent-500 px-8 py-8 text-white">
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-white/5" />
          <div className="relative">
            <img src={logoUrl} alt="EnterprateAI" className="mb-4 h-8 w-auto brightness-0 invert" />
            <h2 className="text-2xl font-bold tracking-tight">Welcome to EnterprateAI</h2>
            <p className="mt-1.5 text-sm text-white/80">
              Your AI powered business operating system. Let's get you set up in four steps.
            </p>
          </div>
        </div>

        {/* Steps */}
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {STEPS.map((step, i) => (
            <div
              key={i}
              className={`flex items-start gap-4 px-8 py-4 ${
                step.highlight
                  ? "bg-brand-50 dark:bg-brand-950/30"
                  : ""
              }`}
            >
              {/* Step number + icon */}
              <div className="mt-0.5 flex shrink-0 flex-col items-center gap-1.5">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-2xl ${
                    step.highlight
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {step.icon}
                </div>
                <span
                  className={`text-[10px] font-bold tabular-nums ${
                    step.highlight ? "text-brand-600" : "text-slate-400"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>

              {/* Text */}
              <div className="min-w-0 py-1">
                <p
                  className={`text-[13px] font-semibold ${
                    step.highlight
                      ? "text-brand-800 dark:text-brand-300"
                      : "text-slate-800 dark:text-slate-200"
                  }`}
                >
                  {step.title}
                  {step.highlight && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-brand-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                      Start here
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {step.desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 rounded-b-3xl border-t border-slate-100 px-8 py-5 dark:border-slate-800">
          <button
            onClick={handleSkip}
            className="text-sm text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline dark:hover:text-slate-200"
          >
            I'll explore on my own
          </button>
          <button
            onClick={handleCreate}
            className="flex items-center gap-2 rounded-2xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-600/25 transition hover:bg-brand-700 active:scale-95"
          >
            Create My Workspace
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
