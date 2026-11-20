import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../api/client";
import Popup from "../Popup";
import { pageNumbers } from "../Pagination";
import TenderMatch from "./TenderMatch";

const pageSize = 10;
const button = "min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-brand-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800";

export default function TenderMatchesPopup({ workspaceId, stage, onClose }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const top = useRef(null);
  useEffect(() => {
    let active = true;
    setData(null); setFailed(false);
    const query = new URLSearchParams({ workspace_id: workspaceId, stage, page: String(page), page_size: String(pageSize) });
    apiRequest(`/public-tenders/recommendations?${query}`, "GET", null, { timeoutMs: 90000 })
      .then((result) => { if (active && result.workspace_id === workspaceId) setData(result); })
      .catch(() => { if (active) setFailed(true); });
    top.current?.scrollIntoView?.({ block: "nearest" });
    return () => { active = false; };
  }, [workspaceId, stage, page, retry]);
  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <Popup title={stage === "award" ? "Related awarded contracts" : "Tenders for your business"} onClose={onClose}
    footer={data && total > pageSize && <nav aria-label="Recommendation pages" className="flex flex-wrap items-center justify-between gap-2">
      <p className="w-full text-xs text-slate-500 sm:w-auto" aria-live="polite">Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</p>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={button} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="px-2 text-sm sm:hidden">{page} / {pages}</span>
        <div className="hidden gap-1 sm:flex">{pageNumbers(pages, page).map((number, index) => number === "…" ? <span key={`gap-${index}`} className="px-2">…</span> : <button key={number} type="button" className={button} aria-label={`Page ${number}`} aria-current={number === page ? "page" : undefined} onClick={() => setPage(number)}>{number}</button>)}</div>
        <button type="button" className={button} disabled={!data.more} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </nav>}>
    <div ref={top} className="space-y-3">
      {failed ? <div role="alert" className="text-sm">We couldn’t load these recommendations. <button type="button" className="font-semibold text-brand-600 underline" onClick={() => setRetry(value => value + 1)}>Try again</button></div>
        : !data ? <p role="status">Loading recommendations…</p>
        : <><p className="text-sm text-slate-500">{total} matching {stage === "award" ? "awarded contracts" : "tenders"}</p>{data.items?.length ? data.items.map(item => <TenderMatch key={item.id} item={item} stage={stage} />) : <p className="text-sm">No matching opportunities available right now.</p>}</>}
    </div>
  </Popup>;
}
