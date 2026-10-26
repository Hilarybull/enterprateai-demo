// Every credit sentence a user sees, in one place: what they get, the cost (or the most it can cost), and what they have
// left. Plain words, numbers as digits, "credits" (never "AI Credits" mid-sentence), "Free" when it is free. Never a
// price-list code, never "fields", "held" or "committed".

const n = (v) => Number(v || 0).toLocaleString("en-GB");
const credits = (v) => `${n(v)} credit${Number(v) === 1 ? "" : "s"}`;
const left = (balance) => (balance == null ? "" : ` You have ${n(balance)}.`);
const willDo = (action) => { const a = String(action || "").trim(); return a ? `I'll ${a[0].toLowerCase()}${a.slice(1)}` : "I'll do this"; };

export const creditCopy = {
  free: () => "Free",
  // One sentence (the owner's QA, 23 Oct): "I'll write a business plan. It costs 40 credits, and you have 90."
  confirmFixed: ({ action, cost, balance }) => (cost ? `${willDo(action)}. It costs ${credits(cost)}${balance == null ? "." : `, and you have ${n(balance)}.`}` : `${willDo(action)}. It's free.`),
  confirmVariable: ({ action, max, balance }) =>
    (max ? `${action}. Up to ${credits(max)}, and you only pay for what I find.${left(balance)}` : `${action}. Free.`),
  done: ({ used, balance }) => `Done. Used ${credits(used)}.${balance == null ? "" : ` ${n(balance)} left.`}`,
  doneVariable: ({ used, findings, balance }) =>
    `Done. Used ${credits(used)} for ${findings} finding${findings === 1 ? "" : "s"}.${balance == null ? "" : ` ${n(balance)} left.`}`,
  nothingFound: () => "I couldn't find anything useful this time, so nothing was charged.",
  unavailable: () => "Research isn't available right now. Nothing was charged.",
  insufficient: ({ cost, balance }) => `This needs ${credits(cost)} and you have ${n(balance)}.`,
  planGate: ({ feature, plan }) => `${feature} is on the ${plan} plan.`,
  agentAuto: ({ did, cost }) => `While you were away I ${did} (${credits(cost)}).`,
};

// Words a user must never see in credit copy (tests read every template against this).
export const NOT_FOR_USERS = /\b(fields?|held|hold|committed|commit|agent_task|_full|AI fills)\b/i;

// "Welcome credits": Explorer's 50 welcome AI credits, one-off and never expiring (the owner, 26 Oct); a date only if one is set.
export function welcomeWords(info) {
  if (!info?.welcome_expires_at) return "Welcome credits";
  const d = new Date(info.welcome_expires_at);
  return Number.isNaN(d.getTime()) ? "Welcome credits" : `Welcome credits · valid to ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}
