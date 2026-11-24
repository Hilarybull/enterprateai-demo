// QA PF1: why a paid action was refused, in words, from the server's own answer. A plan refusal names the plan it
// needs and the one the account is on; credits say what is needed and what there is. Never an error code
// ("FEATURE NOT FOUND"), never raw JSON.

/** The structured reason the server gave (`detail`), from an apiRequest error. */
export function refusalOf(err) {
  const detail = err?.data?.detail ?? err?.detail;
  if (detail && typeof detail === "object") return detail;
  const m = String(err?.message || "").match(/^HTTP \d+:\s*(\{[\s\S]*\})\s*$/);
  if (m) {
    try { const parsed = JSON.parse(m[1]); return parsed?.detail && typeof parsed.detail === "object" ? parsed.detail : parsed; } catch { /* not JSON */ }
  }
  return typeof detail === "string" ? { message: detail } : null;
}

export const isPlanRefusal = (err) => refusalOf(err)?.error === "FEATURE_NOT_ENTITLED" || refusalOf(err)?.upgrade === true;

const looksLikeACode = (text) => /^[A-Z][A-Z0-9_]+$/.test(String(text || "").trim());

/** One sentence for the person: what happened, and that nothing was charged. */
export function refusalMessage(err, fallback = "That couldn't be done just now. Nothing was charged.") {
  const d = refusalOf(err);
  if (!d) return fallback;
  if (d.error === "FEATURE_NOT_ENTITLED") {
    return d.message || `This is included from the ${d.minimum_plan_label || "Starter"} plan.`;
  }
  if (d.error === "INSUFFICIENT_CREDITS") {
    const need = Number(d.required) || 0;
    const have = Number(d.available) || 0;
    // The same sentence everywhere credits run short: "This needs 40 credits; you have 31. Top up."
    return need ? `This needs ${need} credit${need === 1 ? "" : "s"}; you have ${have}. Top up.` : `You have ${have ? have : "no"} credit${have === 1 ? "" : "s"} left. Top up.`;
  }
  if (d.message && !looksLikeACode(d.message)) return d.message;
  return fallback;
}
