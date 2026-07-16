import { useAuthStore } from "../store/auth";

export default function CreditConfirmModal({ featureName, creditCost, onConfirm, onCancel }) {
  const creditInfo = useAuthStore((s) => s.creditInfo);
  const creditBalance = useAuthStore((s) => s.creditBalance);
  const available = creditInfo?.available_credits ?? creditBalance ?? 0;
  const canAfford = available >= creditCost;
  const remaining = canAfford ? available - creditCost : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">Credit Usage</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{featureName}</div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2 mb-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">Action cost</span>
              <span className="font-bold text-slate-900 dark:text-white">{creditCost} credit{creditCost !== 1 ? "s" : ""}</span>
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
                <span className="font-bold text-slate-700 dark:text-slate-300">{remaining.toLocaleString()} credits</span>
              </div>
            )}
          </div>

          {!canAfford && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 mb-4 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300">
              You need {creditCost} credits but only have {available}. Upgrade your plan to continue.
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            {canAfford ? (
              <button
                type="button"
                onClick={onConfirm}
                className="flex-1 rounded-xl bg-brand-600 py-2 text-sm font-bold text-white hover:bg-brand-700 transition"
              >
                Use {creditCost} credit{creditCost !== 1 ? "s" : ""}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { onCancel(); window.location.href = "/pricing"; }}
                className="flex-1 rounded-xl bg-brand-600 py-2 text-sm font-bold text-white hover:bg-brand-700 transition"
              >
                Upgrade plan
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
