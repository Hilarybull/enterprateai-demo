import { useEffect, useState } from "react";
import { apiRequest } from "../../api/client";

export default function ReadinessProgress({ businessId, item, onReady }) {
  const [problem, setProblem] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true, timer, checks = 0;
    const poll = async () => {
      try {
        const result = await apiRequest(`/businesses/${encodeURIComponent(businessId)}/agent/readiness-work/${encodeURIComponent(item.topic || "funding")}/${encodeURIComponent(item.case_id)}`);
        if (!live) return;
        if (result.problem) { setProblem(result.problem); return; }
        if (result.card) { onReady(result.card); return; }
        if (++checks >= 150) { setProblem("This is taking longer. Check again to see the saved result."); return; }
        timer = setTimeout(poll, 4000);
      } catch { if (live) setProblem("I couldn’t check the result. Check again to continue; this won’t restart the research."); }
    };
    timer = setTimeout(poll, 1000);
    return () => { live = false; clearTimeout(timer); };
  }, [businessId, item.case_id, item.topic, attempt]); // The parent replaces this card when it finishes.
  return <div role="status" className="max-w-xl rounded-xl border p-4 text-sm">
    {problem || "Researching and preparing your drafts. They will appear here for review."}
    {problem && <button type="button" className="ml-2 min-h-11 rounded-lg border px-3 py-2" onClick={() => { setProblem(""); setAttempt(n => n + 1); }}>Check again</button>}
  </div>;
}
