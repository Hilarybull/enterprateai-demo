import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../../api/client";
import TenderMatchesPopup from "./TenderMatchesPopup";
import TenderMatch from "./TenderMatch";

export default function TenderRecommendations({ workspaceId }) {
  return workspaceId ? <Recommendations key={workspaceId} workspaceId={workspaceId} /> : null;
}

function Recommendations({ workspaceId }) {
  const dismissKey = `ea_tender_recommendations_hidden:${workspaceId}`;
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(dismissKey) === "1"; } catch { return false; } });
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [popupStage, setPopupStage] = useState(null);
  const hasAwards = data?.award_count > 0 && Array.isArray(data?.awards) && data.awards.length > 0;
  const previewLimit = hasAwards ? 1 : 2;
  useEffect(() => {
    let active = true;
    if (dismissed) return;
    setFailed(false);
    apiRequest(`/public-tenders/recommendations?workspace_id=${encodeURIComponent(workspaceId)}`, "GET", null, { timeoutMs: 90000 })
      .then((value) => { if (active && value.workspace_id === workspaceId) setData(value); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [workspaceId, retry, dismissed]);
  if (data && !failed && !(data.open_count > 0 || data.award_count > 0)) return null;
  if (dismissed) return <button type="button" className="min-h-11 rounded-lg px-3 py-2 text-sm font-semibold text-brand-700" onClick={() => { try { localStorage.removeItem(dismissKey); } catch {} setDismissed(false); }}>Show tender recommendations</button>;
  return <section aria-label="Tender recommendations" className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900">
    <div className="flex justify-end"><button type="button" aria-label="Dismiss tender recommendations" className="min-h-11 min-w-11 rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => { try { localStorage.setItem(dismissKey, "1"); } catch {} setDismissed(true); }}>×</button></div>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-brand-600">EnterprateAI opportunities</p><h2 className="mt-1 text-lg font-semibold">Tenders for your business</h2></div><Link className="inline-flex min-h-10 items-center justify-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" to="/marketplace?tab=tenders">Browse tenders</Link></div>
    {failed ? <div role="alert" className="text-sm text-slate-600">We couldn’t load your tender recommendations. <button type="button" className="font-semibold text-brand-600 underline" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>
      : !data ? <p role="status" className="text-sm text-slate-500">Finding opportunities for your business…</p>
      : data.profile_needed ? <p className="text-sm text-slate-600">Add your industry and services so EnterprateAI can find relevant tenders. <Link className="text-brand-600 underline" to="/account?section=workspace">Update business profile</Link></p>
      : <>
        <p className="text-sm text-slate-600 dark:text-slate-300">{data.open_count} open tender{data.open_count === 1 ? "" : "s"} match your business.{hasAwards && <> {data.award_count} related awarded contract{data.award_count === 1 ? "" : "s"} to research for potential subcontracting.</>}</p>
        <div className={`grid min-w-0 gap-5 ${hasAwards ? "md:grid-cols-2" : ""}`}>
          {[["Open tenders", data.open || [], "open", data.open_count], ...(hasAwards ? [["Awarded contracts", data.awards, "award", data.award_count]] : [])].map(([title, items, stage, count]) => <div key={stage} className="min-w-0 space-y-3">
            <h3 className="font-semibold">{title}</h3>
            {items.length ? items.slice(0, previewLimit).map(item => <TenderMatch key={item.id} item={item} stage={stage} />) : <p className="text-sm text-slate-500">No matching {title.toLowerCase()} available right now.</p>}
          </div>)}
        </div>
        <div className="flex flex-wrap gap-3">{[["open", data.open_count], ...(hasAwards ? [["award", data.award_count]] : [])].filter(([,count]) => count > previewLimit).map(([stage,count]) => <button key={stage} type="button" className="min-h-11 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700" onClick={() => setPopupStage(stage)}>See more {hasAwards ? stage === "award" ? "awarded contracts" : "open tenders" : ""} <span className="text-xs">({count})</span></button>)}</div>
        <p className="text-xs text-slate-500">Matches use your saved industry, services and products.{hasAwards && " An award does not confirm that subcontracting is available."}</p>
      </>}
    {popupStage && <TenderMatchesPopup workspaceId={workspaceId} stage={popupStage} onClose={() => setPopupStage(null)} />}
  </section>;
}
