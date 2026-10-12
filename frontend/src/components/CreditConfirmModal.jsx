import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuthStore } from "../store/auth";

/**
 * Before a paid action (QA PF1, PF2). The plan is checked first, by the server: refused, the owner is told which plan
 * includes it, never shown a cost. Free (deterministic work, Credit System v2 §6), it runs at once with no question.
 * Otherwise the cost shown is the server's price, the one the wallet will take.
 *
 * `featureCode`: the price list's code (the server's answer wins). `creditCost`: shown only if the check can't be made.
 */
export default function CreditConfirmModal({ featureName, featureCode = null, creditCost = 0, onConfirm, onCancel }) {
  const creditInfo = useAuthStore((s) => s.creditInfo);
  const creditBalance = useAuthStore((s) => s.creditBalance);
  const [check, setCheck] = useState(featureCode ? null : { cost: creditCost, entitled: true });
  const ran = useRef(false);

  useEffect(() => {
    if (!featureCode) return undefined;
    let live = true;
    apiRequest("/credits/check", "POST", { feature_code: featureCode })
      .then((r) => {
        if (!live) return;
        setCheck({ entitled: r?.entitled !== false, refusal: r?.refusal || null, cost: Number(r?.cost_shown ?? r?.required_credits ?? 0),
          available: typeof r?.available_credits === "number" ? r.available_credits : null, name: r?.feature_name });
      })
      .catch(() => { if (live) setCheck({ entitled: true, cost: creditCost, unchecked: true }); });
    return () => { live = false; };
  }, [featureCode, creditCost]);

  // Free and allowed: nothing to confirm.
  useEffect(() => {
    if (check && check.entitled && check.cost <= 0 && !ran.current) { ran.current = true; onConfirm?.(); }
  }, [check, onConfirm]);

  if (!check || (check.entitled && check.cost <= 0)) {
    return check ? null : (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="status" aria-label="Checking your plan" data-credit-checking>
        <div className="rounded-2xl bg-white px-5 py-4 text-sm text-slate-600 shadow-xl dark:bg-slate-900 dark:text-slate-300">Checking your plan…</div>
      </div>
    );
  }

  const available = check.available ?? creditInfo?.available_credits ?? creditBalance ?? 0;
  const cost = check.cost;
  const canAfford = available >= cost;
  const remaining = canAfford ? available - cost : 0;
  const title = check.name || featureName;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div role="dialog" aria-label={check.entitled ? "Credit usage" : "Not on your plan"} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">{check.entitled ? "Credit Usage" : "Not on your plan"}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{title}</div>
            </div>
          </div>

          {!check.entitled ? (
            // Refused by plan: said so, with the plan that includes it. No cost is shown, and nothing is charged.
            <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900" data-plan-refusal>
              {check.refusal?.message || "This isn't included in your plan."} Nothing was charged.
            </p>
          ) : (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2 mb-4 dark:border-slate-700 dark:bg-slate-800">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">Action cost</span>
                <span className="font-bold text-slate-900 dark:text-white" data-credit-cost>{cost} credit{cost !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">Your balance</span>
                <span className={`font-bold ${canAfford ? "text-slate-900 dark:text-white" : "text-rose-600"}`}>
                  {available.toLocaleString()} credits
                </span>
              </div>
              {canAfford && (
                <div className="flex justify-between text-sm border-t border-slate-200 dark:border-slate-600 pt-2">
                  <span className="text-slate-600 dark:text-slate-400">After action</span>
                  <span className="font-bold text-slate-700 dark:text-slate-300" data-credit-after>{remaining.toLocaleString()} credits</span>
                </div>
              )}
            </div>
          )}

          {check.entitled && !canAfford && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 mb-4 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300">
              You need {cost} credits but only have {available}. Top up or change your plan to continue.
            </div>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={onCancel}
              className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
              Cancel
            </button>
            {check.entitled && canAfford ? (
              <button type="button" onClick={onConfirm} className="flex-1 rounded-xl bg-brand-600 py-2 text-sm font-bold text-white hover:bg-brand-700 transition">
                Use {cost} credit{cost !== 1 ? "s" : ""}
              </button>
            ) : (
              <button type="button" onClick={() => { onCancel(); window.location.href = "/pricing"; }}
                className="flex-1 rounded-xl bg-brand-600 py-2 text-sm font-bold text-white hover:bg-brand-700 transition">
                {check.entitled ? "Get more credits" : `See ${check.refusal?.minimum_plan_label || "the"} plan`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
