// Every credit sentence a user sees, in one place: what they get, the cost (or the most it can cost), and what they have
// left. Plain words, numbers as digits, "credits" (never "AI Credits" mid-sentence), "Free" when it is free. Never a
// price-list code, never "fields", "held" or "committed".

const n = (v) => Number(v || 0).toLocaleString("en-GB");
const credits = (v) => `${n(v)} credit${Number(v) === 1 ? "" : "s"}`;
const left = (balance) => (balance == null ? "" : ` You have ${n(balance)}.`);

export const creditCopy = {
  free: () => "Free",
  confirmFixed: ({ action, cost, balance }) => (cost ? `${action}. ${credits(cost)}.${left(balance)}` : `${action}. Free.`),
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
