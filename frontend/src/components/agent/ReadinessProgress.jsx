import { useEffect, useState } from "react";
import { apiRequest } from "../../api/client";
import ThinkingProgress from "./ThinkingProgress";

export default function ReadinessProgress({ businessId, item, onReady }) {
  const [problem, setProblem] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    setProblem("");
    let live = true, timer, checks = 0;
    const poll = async () => {
      try {
        const result = await apiRequest(`/businesses/${encodeURIComponent(businessId)}/agent/readiness-work/${encodeURIComponent(item.topic || "funding")}/${encodeURIComponent(item.case_id)}${item.options ? "?options=true" : ""}`);
        if (!live) return;
        if (result.problem) { setProblem(result.problem); return; }
        if (result.card) { setReady(true); onReady(result.card); return; }
        if (++checks >= 150) { setProblem("This is taking longer. Check again to see the saved result."); return; }
        timer = setTimeout(poll, 4000);
      } catch { if (live) setProblem("I couldn’t check the result. Check again to continue; this won’t restart the research."); }
    };
    timer = setTimeout(poll, 1000);
    return () => { live = false; clearTimeout(timer); };
  }, [businessId, item.case_id, item.topic, item.options, attempt]); // The parent replaces this card when it finishes.
  if (ready) return null;
  return <div className="w-full max-w-xl rounded-xl border p-4 text-sm">
    {problem ? <p role="status">{problem}</p> : <ThinkingProgress detail={item.options ? "Searching for funding options that match your case. Results will appear here with their sources." : "Researching and preparing your drafts. They will appear here for review."} />}
    {problem && <button type="button" className="ml-2 min-h-11 rounded-lg border px-3 py-2" onClick={() => { setProblem(""); setAttempt(n => n + 1); }}>Check again</button>}
  </div>;
}
