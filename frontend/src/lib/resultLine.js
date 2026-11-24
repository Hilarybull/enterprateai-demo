// The one line a chat ends on when its check is done (the owner's brief, 25 Oct): a short summary and a button to the
// result's own page ("2 risks to act on." · View your risk check). The full result is only ever on that page, the same
// from the landing page, the dashboard's Agent card and the Agent Centre.
import { kindOf, statusWords } from "./vocab";
import { resultHome } from "./resultHome";

const PAGE = { risks: "/check/risks", idea: "/check/idea", pricing: "/check/pricing", customers: "/check/customers" };
const VIEW = { risks: "View your risk check", funding: "View your funding readiness", launch: "View your launch readiness", idea: "View your idea check",
  pricing: "View your pricing check", customers: "View your customer plan", plan: "View your business plan", other: "View your result" };

const GOAL_KIND = { need_funding: "funding", launch: "launch", test_idea: "idea", create_business_plan: "plan", business_risks: "risks", more_customers: "customers" };
const READY_WORDS = { funding: "Your funding case is set up.", launch: "Your launch plan is set up.", idea: "Your idea check is ready.",
  plan: "I'm writing your business plan.", risks: "Your risk check is ready." };

/** { text, cta, to } for a finished check, from its result, or from the hand-off when the work has no result card (a plan). */
export function resultLine(result, handoff = {}, goalKey = "") {
  if (result) {
    const kind = kindOf(result);
    const { score, sentence } = statusWords(result);
    const so = result.score_partial ? " so far" : "";
    const text = kind === "risks" || kind === "customers" || !score ? sentence : `${score}${so} · ${sentence}`;
    return { text, cta: VIEW[kind] || VIEW.other, to: resultHome(result) || PAGE[kind] || handoff?.to || null };
  }
  const kind = GOAL_KIND[goalKey] || "other";
  return { text: handoff?.message || READY_WORDS[kind] || "It's ready.", cta: handoff?.to ? VIEW[kind] : null, to: handoff?.to || null };
}
