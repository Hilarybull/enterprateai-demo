// The words people see for the Agent's results (the owner's brief, 17 Oct; PRD 12.1). One place, so every page says the same
// thing. No engine terms in user-facing copy: no "snapshot", "ruleset", "tier", "provenance", "assessment" or "criterion".

export const WORDS = {
  coverage: { funding: "of what funders ask for", launch: "of what a launch needs", other: "of what this check needs" },
  gates: "Must-haves",
  blocker: "Must fix",
  unknown: "Need from you",
  partial: "Partly there",
  researched: "Found online",
  estimated: "My estimate",
  calculated: "Worked out",
  adopt: "Adopt",
  adoptAll: "Adopt all",
  ready: "What looks ready",
  missing: "What is missing",
  canHelp: "What I can help you resolve",
  nextSteps: "Your next steps",
  found: "What I found for you",
};

/** The kind of result: funding, launch, idea, pricing or customers. */
export function kindOf(result) {
  const t = result?.assessment_type || "";
  if (t.startsWith("funding")) return "funding";
  if (t.startsWith("launch")) return "launch";
  if (t.startsWith("idea")) return "idea";
  if (t.startsWith("pricing")) return "pricing";
  if (t.startsWith("customer")) return "customers";
  if (t.startsWith("business_risk")) return "risks";
  return "other";
}

const READY = { funding: "Ready to approach funders.", launch: "Ready to launch.", idea: "Worth taking further.", pricing: "Your price looks healthy.",
  customers: "Set up to win customers.", risks: "No big risks right now.", other: "Looks ready." };
const NOT_YET = { funding: "Not ready for funding yet.", launch: "Not ready to launch yet.", idea: "Not proven yet.", pricing: "Your price isn't checked yet.",
  customers: "Not set up to win customers yet.", other: "Not ready yet." };

/** "42/100 · Not ready for funding yet. 3 things to do first." and "I know 50% of what funders ask for". */
export function statusWords(result, latest) {
  const kind = kindOf(result);
  const gaps = Array.isArray(result?.case_steps) ? result.case_steps.length : (result?.blockers || []).length;
  const failed = (result?.blockers || []).filter((b) => b.kind === "failed").length;
  let n = typeof latest?.score === "string" ? Number(String(latest.score).split("/")[0]) : Number(result?.score);
  // Not enough known for the check's own score: the score from what is known, with its basis (never "no score").
  // Always a score (the owner, 22 Oct): the points from what is known when the check can't give its own
  const partial = !Number.isFinite(n) && Number.isFinite(Number(result?.partial_score)) && result?.partial_score !== null;
  if (partial) n = Number(result.partial_score);
  // The one "ready" threshold, as the checklist sets it (22 Oct: 75), sent with the result
  const readyAt = Number.isFinite(Number(result?.ready_at)) ? Number(result.ready_at) : 75;
  const ready = !partial && (Number.isFinite(n) ? n >= readyAt && failed === 0 : gaps === 0);
  // Risks are said as risks, never "Not ready yet" (the owner, 24 Oct)
  const sentence = kind === "risks" ? (gaps ? `${gaps} ${gaps === 1 ? "risk" : "risks"} to act on.` : "No risks found in your records.")
    : kind === "customers" ? (gaps ? `${gaps} ${gaps === 1 ? "thing" : "things"} to fix to win more customers.` : "Nothing in your records is holding back new customers.")
    : ready ? READY[kind] : `${NOT_YET[kind]}${gaps ? ` ${gaps} ${gaps === 1 ? "thing" : "things"} to do first.` : ""}`;
  const coverage = Math.max(0, Math.min(100, Math.round(Number(latest?.coverage ?? result?.evidence_coverage ?? 0))));
  const known = `${partial ? "Based on" : "I know"} ${coverage}% ${(WORDS.coverage[kind] || WORDS.coverage.other)}`;
  const score = kind === "risks" || kind === "customers" ? "" : Number.isFinite(n) ? `${n}/100` : String(result?.score ?? "");      // no total
  return { score, sentence, known, ready, kind };
}

/** How a gap is said on its badge. */
export const gapWord = (kind) => (kind === "failed" ? WORDS.blocker : kind === "partial" ? WORDS.partial : WORDS.unknown);

/** How a finding is said on its badge. */
export function foundWord(item) {
  if (item?.derive || item?.basis === "calculated") return WORDS.calculated;
  if (item?.kind === "researched") return WORDS.researched;
  if (item?.kind === "estimated") return WORDS.estimated;
  return "";
}
