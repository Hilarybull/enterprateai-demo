// Simulation audit, Phase 7: forecast accuracy across every business (admin only). GET /v1/scenario-intelligence/admin/accuracy
import { useEffect, useState } from "react";
import { apiRequest } from "../../api/client";

const pct = (v) => (v == null ? "—" : `${v}%`);

export default function SimulationAccuracyAdmin() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try { setReport(await apiRequest("/v1/scenario-intelligence/admin/accuracy", "GET")); }
    catch (e) { setError(e?.message || "The accuracy report could not be loaded."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4" data-simulation-accuracy-admin>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Simulation accuracy</h2>
          <p className="text-sm text-slate-500">Each saved forecast against what the business's records show for months that have since completed.</p>
        </div>
        <button type="button" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>
      {error ? <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
      {report ? (
        <>
          <div className={`rounded-xl p-3 text-sm font-semibold ${report.status === "review needed" ? "bg-rose-50 text-rose-700" : report.status === "within thresholds" ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-700"}`} data-accuracy-status>
            Status: {report.status}
          </div>
          {report.alerts?.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-rose-700">{report.alerts.map((a) => <li key={a}>{a}</li>)}</ul>
          ) : null}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[["Forecast error (WAPE)", pct(report.overall?.wape_pct)], ["Bias", report.overall?.bias_pct == null ? "—" : `${report.overall.bias_pct > 0 ? "+" : ""}${report.overall.bias_pct}%`],
              ["Months compared", report.overall?.months ?? 0], ["Inside the 90% range", pct(report.range_coverage_pct)]].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
                <div className="mt-1 text-xl font-bold text-slate-900">{value}</div>
              </div>
            ))}
          </div>
          <div className="text-xs text-slate-500">
            {report.runs_compared} run(s) compared across {report.businesses_with_completed_months} of {report.businesses} business(es).
            Review thresholds: WAPE above {report.thresholds?.wape_pct}%, bias outside ±{report.thresholds?.bias_pct}% (over {report.thresholds?.min_months}+ months),
            range coverage below {report.thresholds?.coverage_floor_pct}%.
          </div>
          {[["By confidence level (high should be the most accurate)", report.by_confidence], ["By model version", report.by_model_version]].map(([title, rows]) => (
            <div key={title} className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
              <table className="min-w-full text-sm">
                <thead className="text-xs text-slate-500"><tr><th className="px-3 py-1 text-left">Group</th><th className="px-3 py-1 text-right">Months</th><th className="px-3 py-1 text-right">WAPE</th><th className="px-3 py-1 text-right">Bias</th></tr></thead>
                <tbody>
                  {Object.entries(rows || {}).map(([k, v]) => (
                    <tr key={k} className="border-t border-slate-100"><td className="px-3 py-1">{k}</td><td className="px-3 py-1 text-right">{v.months}</td><td className="px-3 py-1 text-right">{pct(v.wape_pct)}</td><td className="px-3 py-1 text-right">{pct(v.bias_pct)}</td></tr>
                  ))}
                  {!Object.keys(rows || {}).length ? <tr><td className="px-3 py-2 text-slate-500" colSpan={4}>No completed months yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
          ))}
          <div className="text-xs text-slate-500">{report.method}</div>
        </>
      ) : null}
    </div>
  );
}
