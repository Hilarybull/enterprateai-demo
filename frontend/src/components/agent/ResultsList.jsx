import { useEffect, useState } from "react";
import { apiRequest } from "../../api/client";
import Pagination, { PAGE_SIZE, pageSlice } from "../Pagination";
import { gapsLine } from "../FirstResultPanel";
import { latestOf, openOf } from "../FirstValueCard";
import { useNavigate } from "react-router-dom";

// Agent Centre > Results: the latest first result of each check on this business (from the homepage, a quick check, or
// updated by adopted research), kept after it is dismissed or saved for later on the dashboard. Opens in the same drawer.
const BAND_TONE = { Strong: "bg-emerald-50 text-emerald-700 ring-emerald-200", Fair: "bg-amber-50 text-amber-700 ring-amber-200",
  Weak: "bg-rose-50 text-rose-700 ring-rose-200", "Not ready yet": "bg-rose-50 text-rose-700 ring-rose-200", "Not ready": "bg-rose-50 text-rose-700 ring-rose-200",
  Ready: "bg-emerald-50 text-emerald-700 ring-emerald-200", "Conditionally ready": "bg-amber-50 text-amber-700 ring-amber-200", "Insufficient evidence": "bg-slate-50 text-slate-600 ring-slate-200" };
const day = (at) => { try { return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; } };

export function useResultsCount(businessId) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!businessId) return undefined;
    let live = true;
    apiRequest(`/businesses/${businessId}/first-results`, "GET").then((r) => { if (live) setN((r?.items || []).length); }).catch(() => {});
    return () => { live = false; };
  }, [businessId]);
  return n;
}

export default function ResultsList({ businessId, empty }) {
  const [items, setItems] = useState(null);
  const navigate = useNavigate();
  const [page, setPage] = useState(1);      // its own pager, by its own count (never History's)
  useEffect(() => {
    if (!businessId) return undefined;
    let live = true;
    apiRequest(`/businesses/${businessId}/first-results`, "GET").then((r) => { if (live) setItems(r?.items || []); }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [businessId]);
  if (items === null) return <p role="status" className="px-5 py-10 text-center text-sm text-slate-500">Loading your results…</p>;
  if (!items.length) return <p className="px-5 py-10 text-center text-sm text-slate-500">{empty}</p>;
  const at = pageSlice(items.length, page);
  return (
    <>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-results-list>
        {items.slice(at.offset, at.offset + PAGE_SIZE).map((row) => { const latest = latestOf(row.result); const band = latest.full ? latest.band : row.band; return (
          <li key={row.goal_key} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {row.headline}
                {band && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${BAND_TONE[band] || BAND_TONE["Insufficient evidence"]}`} data-result-band>{band}</span>}
                {row.adopted ? <span className="text-[11px] font-normal text-emerald-700">Updated with research (version {row.adopted})</span> : null}
              </p>
              {/* P0.6c: the same snapshot as the Agent card and the drawer: the latest check, with the first result as earlier. */}
              <p className="mt-0.5 text-[13px] text-slate-600 dark:text-slate-300" data-result-numbers>{latest.full ? `${latest.source} · ${latest.score}` : (row.result.key_numbers || []).join(" · ")}</p>
              <p className="text-[12px] text-slate-500">{latest.full ? latest.earlier : gapsLine(row.result.gaps)}{row.at ? ` · ${day(row.at)}` : ""}</p>
            </div>
            {openOf(row.result) && (
              <button type="button" onClick={() => navigate(openOf(row.result).to)} data-result-open
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">{openOf(row.result).label}</button>
            )}
          </li>
        ); })}
      </ul>
      <Pagination total={items.length} page={at.page} noun="results" className="border-t border-slate-100 dark:border-slate-800" onPage={setPage} onMore={setPage} />
    </>
  );
}
