import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuthStore } from "../store/auth";

const FEATURE_LABELS = {
  idea_validation: "Idea Validation",
  market_data_refresh: "Market Data Refresh",
  business_plan_full: "Business Plan (Full)",
  business_plan_section: "Business Plan (Section)",
  proposal_full: "Business Proposal (Full)",
  proposal_section: "Business Proposal (Section)",
  sales_letter_full: "Sales Letter (Full)",
  sales_letter_section: "Sales Letter (Section)",
  scenario_simulation: "Scenario Simulation",
  fragility_ai_interpretation: "Fragility Index AI",
  suggest_field: "AI Field Suggestion",
};

const TYPE_LABELS = {
  allocation: "Allocation",
  deduction: "Deduction",
  hold: "Hold",
  hold_release: "Hold Released",
  refund: "Refund",
  expiry: "Expired",
  top_up: "Top-up",
  admin_adjustment: "Admin Adjustment",
  promotion: "Promotion",
};

const STATUS_COLORS = {
  completed: "text-emerald-700 bg-emerald-50 border-emerald-200",
  pending: "text-amber-700 bg-amber-50 border-amber-200",
  failed: "text-rose-700 bg-rose-50 border-rose-200",
  reversed: "text-slate-600 bg-slate-100 border-slate-200",
};

export default function CreditsPage() {
  const navigate = useNavigate();
  const creditInfo = useAuthStore((s) => s.creditInfo);
  const creditBalance = useAuthStore((s) => s.creditBalance);

  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filterFeature, setFilterFeature] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest("/credits/transactions?limit=200", "GET");
      setTransactions(Array.isArray(data?.transactions) ? data.transactions : []);
    } catch (e) {
      setError("Failed to load transaction history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const filtered = transactions.filter((t) => {
    if (filterFeature && t.feature_code !== filterFeature) return false;
    if (filterType && t.transaction_type !== filterType) return false;
    if (filterStatus && t.status !== filterStatus) return false;
    return true;
  });

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const available = creditBalance ?? 0;
  const allocation = creditInfo?.monthly_allocation ?? 0;
  const resetAt = creditInfo?.next_reset_at;
  const planCode = creditInfo?.plan_code ?? "explorer";

  return (
    <div className="w-full max-w-4xl mx-auto space-y-5 px-2 sm:px-4 pb-8">
      <button type="button" onClick={() => navigate(-1)}
        className="group flex items-center gap-1.5 text-sm font-semibold text-slate-400 hover:text-brand-600 transition-colors">
        <svg className="h-4 w-4 transition-transform group-hover:-translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5m7 7l-7-7 7-7" /></svg>
        Back
      </button>

      {/* Balance summary */}
      <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-indigo-700 p-5 text-white">
        <div className="text-xs font-bold uppercase tracking-widest text-white/60 mb-1">AI Credits</div>
        <div className="text-3xl font-black leading-none mb-1">
          {available.toLocaleString()}
        </div>
        <div className="text-sm text-white/70">
          {planCode === "explorer" ? "Free trial allocation · one-time" : "Purchase more credits when needed"}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-white/10 px-3 py-2">
            <div className="text-[10px] font-bold uppercase text-white/50">Available</div>
            <div className="text-sm font-bold">{available.toLocaleString()}</div>
          </div>
          <div className="rounded-xl bg-white/10 px-3 py-2">
            <div className="text-[10px] font-bold uppercase text-white/50">Used (all time)</div>
            <div className="text-sm font-bold">{(creditInfo?.lifetime_credits_used ?? 0).toLocaleString()}</div>
          </div>
          <div className="rounded-xl bg-white/10 px-3 py-2">
            <div className="text-[10px] font-bold uppercase text-white/50">Issued (all time)</div>
            <div className="text-sm font-bold">{(creditInfo?.lifetime_credits_issued ?? 0).toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select value={filterFeature} onChange={(e) => { setFilterFeature(e.target.value); setPage(0); }}
          className="ea-input text-xs py-1.5 px-3 h-auto">
          <option value="">All features</option>
          {Object.entries(FEATURE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(0); }}
          className="ea-input text-xs py-1.5 px-3 h-auto">
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }}
          className="ea-input text-xs py-1.5 px-3 h-auto">
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="reversed">Reversed</option>
        </select>
        {(filterFeature || filterType || filterStatus) && (
          <button type="button" onClick={() => { setFilterFeature(""); setFilterType(""); setFilterStatus(""); setPage(0); }}
            className="text-xs text-slate-400 hover:text-slate-600 px-2">
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">Loading transactions…</div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-rose-600">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">No transactions found.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider">Feature</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-500 uppercase tracking-wider">Credits</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-500 uppercase tracking-wider">Balance</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {paginated.map((t) => {
                    const isDebit = t.transaction_type === "deduction" || t.transaction_type === "hold" || t.transaction_type === "expiry";
                    const isCredit = t.transaction_type === "allocation" || t.transaction_type === "refund" || t.transaction_type === "top_up" || t.transaction_type === "promotion" || t.transaction_type === "hold_release" || t.transaction_type === "admin_adjustment";
                    return (
                      <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                          {t.created_at ? new Date(t.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                          <div className="text-[10px] text-slate-400">
                            {t.created_at ? new Date(t.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : ""}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {FEATURE_LABELS[t.feature_code] || t.feature_code || "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {TYPE_LABELS[t.transaction_type] || t.transaction_type || "—"}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold tabular-nums ${isDebit ? "text-rose-600" : isCredit ? "text-emerald-600" : "text-slate-700"}`}>
                          {isDebit ? "−" : isCredit ? "+" : ""}{Math.abs(t.credits).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600 tabular-nums font-medium">
                          {typeof t.balance_after === "number" ? t.balance_after.toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_COLORS[t.status] || "text-slate-600 bg-slate-100 border-slate-200"}`}>
                            {t.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                <span className="text-xs text-slate-400">
                  {filtered.length} transaction{filtered.length !== 1 ? "s" : ""} · page {page + 1} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                    className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                    Previous
                  </button>
                  <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                    className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
