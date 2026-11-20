import { Link } from "react-router-dom";

export default function TenderMatch({ item, stage }) {
  return <Link to={`/marketplace?tab=tenders&stage=${stage}&tender=${encodeURIComponent(item.id)}`} className="block min-w-0 space-y-2 rounded-xl border border-slate-200 p-4 transition hover:border-brand-300 hover:bg-brand-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 dark:border-slate-700">
    <p className="break-words text-sm font-semibold">{item.title}</p>
    <p className="break-words text-xs text-slate-500">{item.buyer || "Buyer not specified"}</p>
    <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">{(item.reasons || []).map(reason => <li key={reason}>{reason}</li>)}</ul>
    <span className="inline-block text-xs font-semibold text-brand-600">View details →</span>
  </Link>;
}
