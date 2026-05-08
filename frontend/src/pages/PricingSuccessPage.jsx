import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { planLabel } from "../lib/plans";
import logoUrl from "../enterprate-logo.png";

export default function PricingSuccessPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const refreshSubscription = useAuthStore((s) => s.refreshSubscription);
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Give Stripe webhook a moment to process, then fetch updated sub
      await new Promise((r) => setTimeout(r, 1500));
      const updated = await refreshSubscription();
      setSub(updated);
      setLoading(false);
    }
    load();
  }, [refreshSubscription]);

  const sessionId = params.get("session_id");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl text-center dark:border-slate-800 dark:bg-slate-900">
        <img src={logoUrl} alt="EnterprateAI" className="mx-auto mb-6 h-8 w-auto object-contain" />

        {loading ? (
          <div className="flex flex-col items-center gap-4">
            <svg className="h-10 w-10 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
            </svg>
            <p className="text-sm text-slate-500 dark:text-slate-400">Confirming your subscription…</p>
          </div>
        ) : (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <svg className="h-8 w-8 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>

            <h1 className="mt-5 text-2xl font-extrabold text-slate-900 dark:text-slate-100">
              You're all set!
            </h1>

            {sub && sub.plan_key !== "free_trial" ? (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Your <strong className="text-slate-800 dark:text-slate-200">{planLabel(sub.plan_key, sub.status)}</strong> subscription is now active.
                All features for your plan are unlocked.
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Your payment was processed successfully. Your plan will be activated shortly.
              </p>
            )}

            {sessionId && (
              <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                Reference: {sessionId.slice(-12)}
              </p>
            )}

            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="w-full rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
              >
                Go to dashboard
              </button>
              <button
                type="button"
                onClick={() => navigate("/pricing")}
                className="w-full rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                View plans
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
