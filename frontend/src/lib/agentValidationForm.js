// The Idea Validation form, filled by the Agent from what the owner said in the chat. Only the fields still empty are
// filled: nothing the owner typed here is replaced. Each Agent task fills the form once.
export const AGENT_FORM_APPLIED_KEY = "ea_v4_agent_form_applied";

const empty = (v) => v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);

export function fillEmpty(current, drafted) {
  const form = { ...(current || {}) };
  let filled = 0;
  for (const [step, fields] of Object.entries(drafted || {})) {
    if (!/^step\d+$/.test(step) || !fields || typeof fields !== "object") continue;
    const now = { ...(form[step] || {}) };
    for (const [key, value] of Object.entries(fields)) {
      if (empty(value) || !empty(now[key])) continue;
      now[key] = value;
      filled += 1;
    }
    form[step] = now;
  }
  return { form, filled };
}

export function alreadyApplied(runId) {
  try { return Boolean(runId) && window.localStorage.getItem(AGENT_FORM_APPLIED_KEY) === runId; } catch { return false; }
}

export function markApplied(runId) {
  try { window.localStorage.setItem(AGENT_FORM_APPLIED_KEY, runId); } catch { /* the form is still filled */ }
}
