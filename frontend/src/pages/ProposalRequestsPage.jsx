import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/Badge";
import Spinner from "../components/Spinner";
import { apiRequest } from "../api/client";
import enterprateLogo from "../logo.png";

const TYPES = ["", "general", "technical", "financial", "creative", "consulting"];
const cap = (s) => String(s || "").replace(/^\w/, (c) => c.toUpperCase());

function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function ProposalRequestsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams();
    if (search.trim()) qs.set("search", search.trim());
    if (type) qs.set("type", type);
    const t = setTimeout(() => {
      apiRequest(`/proposals/public/requests${qs.toString() ? `?${qs}` : ""}`, "GET")
        .then((d) => { if (!cancelled) { setItems(d.items || []); setError(null); } })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message.replace(/^HTTP \d+:\s*/i, "") : "Failed to load"); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, type]);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f8fafc_45%,#f8fafc_100%)] dark:bg-slate-950">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/marketplace" className="flex items-center gap-2">
            <img src={enterprateLogo} alt="EnterprateAI" className="h-6 w-auto max-w-[130px] object-contain sm:h-7" />
          </Link>
          <Link to="/marketplace" className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400">All businesses</Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-16 pt-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Open proposal requests</h1>
        <p className="mt-1 text-sm text-slate-500">Briefs from businesses looking for proposals. Open one to apply.</p>

        <div className="mt-5 flex flex-wrap gap-2">
          <input
            className="ea-input max-w-xs flex-1"
            placeholder="Search requests…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="ea-input max-w-[160px]" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t} value={t}>{t ? cap(t) : "All types"}</option>)}
          </select>
        </div>

        <div className="mt-5 space-y-2">
          {loading ? (
            <div className="flex justify-center py-16"><Spinner size={22} /></div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-slate-900">{error}</div>
          ) : !items.length ? (
            <p className="py-12 text-center text-sm text-slate-500">No open requests right now.</p>
          ) : (
            items.map((r) => {
              const deadline = fmtDate(r.deadline);
              return (
                <Link
                  key={r.id}
                  to={`/marketplace/request/${r.id}`}
                  className="block rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">{cap(r.type || "general")}</Badge>
                    {deadline ? <span className="text-xs text-slate-500">Deadline {deadline}</span> : null}
                  </div>
                  <div className="mt-1.5 font-semibold text-slate-900 dark:text-slate-100">{r.title}</div>
                  {r.company_name ? <div className="text-xs text-slate-500">{r.company_name}</div> : null}
                  {r.description ? (
                    <p className="mt-1.5 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{r.description}</p>
                  ) : null}
                </Link>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
