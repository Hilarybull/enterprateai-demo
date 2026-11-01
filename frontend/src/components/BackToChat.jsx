import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { cameFrom, forgetCameFrom, opensHere } from "../lib/cameFrom";

/** On any page a chat link opened: one link back to that conversation (the owner, 29 Oct: "there should be a nav back to the
 *  convo that brought me there"). Gone once back there, or when closed. */
export default function BackToChat() {
  const { pathname } = useLocation();
  const [back, setBack] = useState(() => (opensHere(cameFrom(), pathname) ? cameFrom() : null));
  useEffect(() => {
    const got = cameFrom();
    if (got && !opensHere(got, pathname)) { forgetCameFrom(); setBack(null); return; }      // back where it started, or elsewhere
    setBack(got);
  }, [pathname]);
  if (!back) return null;
  return (
    <div className="mb-3 flex items-center gap-3" data-back-to-chat>
      {/* a distinct button, the same as on an Agent draft (the owner, 1 Nov) */}
      <a href={back.to} className="group flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-indigo-800 shadow-sm hover:bg-indigo-50 dark:border-indigo-700 dark:bg-slate-900 dark:text-indigo-200">
        <svg className="h-4 w-4 transition-transform group-hover:-translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5m7 7l-7-7 7-7" /></svg>
        Back to the conversation in {back.name}
      </a>
      <button type="button" aria-label="Close" onClick={() => { forgetCameFrom(); setBack(null); }} className="text-slate-400 hover:text-slate-600">×</button>
    </div>
  );
}
