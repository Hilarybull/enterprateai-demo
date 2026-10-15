import { useState } from "react";
import { apiRequest } from "../../api/client";

// Superadmin: a business's latest research runs, topic by topic: the queries sent, results, pages loaded, sources kept
// and dropped with why, the model's calls, and why a topic ended with no sources. Over GET /admin/research-runs/{id}.
export default function ResearchDiagnostics() {
  const [businessId, setBusinessId] = useState("");
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async (e) => {
    e?.preventDefault();
    if (!businessId.trim()) return;
    setBusy(true);
    try { setState(await apiRequest(`/admin/research-runs/${encodeURIComponent(businessId.trim())}`, "GET")); }
    catch (err) { setState({ error: err?.message || "Couldn't load the runs." }); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-research-diagnostics>
      <form onSubmit={load} className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <label className="flex min-w-[16rem] flex-1 flex-col text-[12.5px] font-semibold text-slate-600">Business id
          <input value={businessId} onChange={(e) => setBusinessId(e.target.value)} className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal dark:border-slate-700 dark:bg-slate-950" />
        </label>
        <button type="submit" disabled={busy} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">{busy ? "Loading…" : "Show runs"}</button>
      </form>
      {state?.error && <p role="alert" className="text-sm text-rose-700">{state.error}</p>}
      {state?.health && (
        <p className="text-[13px] text-slate-600">Search: {state.health.search} · Model: {state.health.model}{state.health.last_error ? ` · Last error: ${state.health.last_error}` : ""}</p>
      )}
      {state?.runs?.length === 0 && <p className="text-sm text-slate-500">No research runs for this business.</p>}
      {(state?.runs || []).map((r) => (
        <section key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900" data-run={r.id}>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{r.goal} · {r.status} · {r.seconds ?? "?"}s · charged {r.charged ?? 0}
            {r.error && <span className="ml-2 text-rose-700">error: {r.error}</span>}</p>
          <p className="text-[12px] text-slate-500">{r.created_at} · {r.id} · counts {JSON.stringify(r.counts || {})}</p>
          <p className="text-[12px] text-slate-500">Context: {JSON.stringify(r.diagnostics?.context || r.context || {})}</p>
          {r.diagnostics?.provider_fallbacks && Object.keys(r.diagnostics.provider_fallbacks).length > 0 && (
            <p className="mt-1 text-[12px] text-amber-800">Model fallbacks: {Object.entries(r.diagnostics.provider_fallbacks).map(([k, v]) => `${k}: ${v.error}`).join(" · ")}</p>
          )}
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-[12px]">
              <thead className="text-slate-500"><tr><th className="pr-3">Topic</th><th className="pr-3">Outcome</th><th className="pr-3">Results</th><th className="pr-3">Pages</th><th className="pr-3">Cited</th><th className="pr-3">Kept</th><th>Queries, drops and errors</th></tr></thead>
              <tbody>
                {Object.entries(r.diagnostics?.topics || {}).map(([k, t]) => (
                  <tr key={k} className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="py-1 pr-3 font-semibold">{t.label || k}</td>
                    <td className={`py-1 pr-3 ${t.outcome === "found" ? "text-emerald-700" : "text-amber-800"}`}>{t.outcome}</td>
                    <td className="py-1 pr-3">{t.results}</td><td className="py-1 pr-3">{t.pages_loaded}</td><td className="py-1 pr-3">{t.cited}</td><td className="py-1 pr-3">{t.kept}</td>
                    <td className="py-1">
                      {(t.queries || []).map((q) => <div key={q.q}>{q.provider}: “{q.q}” → {q.results}{q.error ? ` (${q.error})` : ""}</div>)}
                      {(t.dropped || []).map((d) => <div key={d} className="text-slate-500">dropped {d}</div>)}
                      {(t.pages_failed || []).map((d) => <div key={d} className="text-slate-500">page failed {d}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(r.diagnostics?.llm || []).map((c, n) => (
            <p key={n} className="mt-1 text-[12px] text-slate-500">Model call ({(c.topics || []).join(", ")}): {c.provider} {c.model} · {c.seconds}s · {c.tokens ?? "?"} tokens{c.error ? ` · ${c.error}` : ""}</p>
          ))}
        </section>
      ))}
    </div>
  );
}
