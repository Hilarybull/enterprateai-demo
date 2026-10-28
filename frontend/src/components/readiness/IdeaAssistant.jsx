// The idea being tested, as the Assistant tab shows it (the owner's mockups, 27 Oct: Idea Validation): the shared
// conversation with the idea's cards, its research started from the chat at the price on its button.
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../api/client";
import { getChat } from "../../lib/agent";
import { premiumFlow } from "../ResearchReview";
import CaseAssistant, { ideaSubject } from "./CaseAssistant";

export default function IdeaAssistant({ businessId, onTab }) {
  const [idea, setIdea] = useState(undefined);
  const [first, setFirst] = useState(null);      // the context and the conversation, read together and handed to the chat
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
    if (problem) return { problem };
    // The same research as before, shown again: said, never passed off as a new search (the owner, 28 Oct)
    return done?.research?.repeat ? { repeat: done.research.created_at || true } : {};
  };
  // Until both are read, the chat's own loading state: never a first result that the real one then replaces
  const subject = ideaSubject(idea || {});
  if (idea === undefined || !first) return <CaseAssistant key="loading" businessId={businessId} feature="idea" subject={subject} score={null} onTab={onTab} loading />;
  return <CaseAssistant key="ready" businessId={businessId} feature="idea" subject={subject} score={subject.summary.score} onTab={onTab} onChanged={load} onResearch={research}
    initialCtx={first.ctx} initialMessages={first.messages} />;
}
