// The idea being tested, as the Assistant tab shows it (the owner's mockups, 27 Oct: Idea Validation): the shared
// conversation with the idea's cards, its research started from the chat at the price on its button.
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiRequest } from "../../api/client";
import { getChat } from "../../lib/agent";
import { premiumFlow } from "../ResearchReview";
import CaseAssistant, { ideaSubject } from "./CaseAssistant";

export default function IdeaAssistant({ businessId, onTab }) {
  const [idea, setIdea] = useState(undefined);
  const [first, setFirst] = useState(null);      // the context and the conversation, read together and handed to the chat
  const [params, setParams] = useSearchParams();
  const autoRun = params.get("run") === "1";      // Run the idea validation, pressed on the Assessment tab
  const ranAuto = () => { const p = new URLSearchParams(params); p.delete("run"); setParams(p, { replace: true }); };
  const context = useCallback(() => apiRequest(`/businesses/${businessId}/agent/assistant-context?kind=idea&case_id=idea`, "GET"), [businessId]);
  const load = useCallback(() => context().then((c) => setIdea(c?.idea || null), () => setIdea(null)), [context]);
  useEffect(() => {
    let live = true;
    Promise.all([context().catch(() => ({})), getChat(businessId, "idea-check").then((c) => c?.messages || [], () => [])]).then(([c, messages]) => {
      if (!live) return;
      setFirst({ ctx: c || {}, messages });
      setIdea(c?.idea || null);
    });
    return () => { live = false; };
  }, [businessId, context]);
  const research = async ({ fresh = false } = {}) => {
    let problem = "";
    const flow = premiumFlow({ base: `/businesses/${businessId}/quick-check/test_idea/premium`, body: { answers: idea?.answers || {}, ...(fresh ? { fresh: true } : {}) }, businessId, onError: (m) => { problem = m; } });
    const got = await flow();
    if (got?.gate) return { problem: got.gate.message || "That isn't included in your plan yet." };
    const done = got?.start ? await got.start() : got;
    if (problem) return { problem: `${problem} Nothing was charged.` };
    const run = done?.research || {};
    // Failed or timed out with nothing found: said, and nothing taken (charged only when it finishes; QA, 30 Oct)
    if (run.error && !(run.counts?.sources > 0)) {
      return { problem: /timeout|took too long/i.test(String(run.error)) ? "The research took too long this time, so it stopped and nothing was charged. Try again in a moment."
        : "The research didn't finish this time, so nothing was charged. Try again in a moment." };
    }
    // The same research as before, shown again: said, never passed off as a new search (the owner, 28 Oct)
    return run.repeat ? { repeat: run.created_at || true, run: run.id }
      : { completed: true, run: run.id, message: run.findings
        ? `Done. I found ${run.findings} thing${run.findings === 1 ? "" : "s"} for your idea${run.charged ? ` (${run.charged} credits)` : ""}. They're in the Research tab for you to accept or reject; your result updates as you accept them.`
        : "Done. Nothing new turned up with a checked source, so nothing was charged. What I worked out is in the Research tab to review." };
  };
  // Until both are read, the chat's own loading state: never a first result that the real one then replaces
  const subject = ideaSubject(idea || {});
  if (idea === undefined || !first) return <CaseAssistant key="loading" businessId={businessId} feature="idea" subject={subject} score={null} onTab={onTab} loading />;
  return <CaseAssistant key="ready" businessId={businessId} feature="idea" subject={subject} score={subject.summary.score} onTab={onTab} onChanged={load} onResearch={research} autoRun={autoRun} onAutoRun={ranAuto}
    initialCtx={first.ctx} initialMessages={first.messages} />;
}
