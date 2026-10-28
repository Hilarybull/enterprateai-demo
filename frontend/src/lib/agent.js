import { apiRequest, apiRequestCached } from "../api/client";
import { useAuthStore } from "../store/auth";

// One client for the EnterprateAI Agent. Every entry point (dashboard panel,
// assistant chat, Agent Centre, quick actions) sends the same canonical request.

// Fired after any Agent action completes (a workflow started, an approval decided, a question
// answered...). Pages showing business records listen for it and reload, so a receipt the
// Agent has just sent doesn't keep showing as "Not issued".
export const AGENT_CHANGED_EVENT = "ea:agent:changed";

function announce(promise) {
  const tell = () => {
    try { window.dispatchEvent(new CustomEvent(AGENT_CHANGED_EVENT)); } catch { /* never break the action */ }
  };
  promise.then(tell, tell);      // a failed step may still have changed records before it stopped
  return promise;
}

// ── The conversation with the Agent ──────────────────────────────────────────
// One conversation per business and per signed-in user, shared by the chat bubble and the
// Agent box, kept for the browser session and sent with every message so a follow-up has its
// context. It never crosses businesses: the business id is part of the key.
const memoryConversations = new Map();
function conversationKey(businessId) {
  let who = "me";
  try { who = useAuthStore.getState().email || "me"; } catch { /* signed-out or not loaded */ }
  return `ea:agent:conversation:${businessId}:${who}`;
}
export function getConversation(businessId) {
  if (!businessId) return [];
  const key = conversationKey(businessId);
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) || "null");
    if (Array.isArray(stored)) return stored;
  } catch { /* storage unavailable: the in-memory copy is used */ }
  return memoryConversations.get(key) || [];
}
function setConversation(businessId, turns) {
  const key = conversationKey(businessId);
  const kept = turns.slice(-20);
  memoryConversations.set(key, kept);
  try { sessionStorage.setItem(key, JSON.stringify(kept)); } catch { /* fine without it */ }
}
/** An earlier conversation, opened again: what the Agent is told was said, so it carries on from there (27 Oct). */
export function continueConversation(businessId, messages) {
  if (!businessId) return;
  setConversation(businessId, (messages || []).filter((m) => (m.role === "user" || m.role === "assistant") && m.content).map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) })));
}
export function clearConversation(businessId) {
  if (!businessId) return;
  const key = conversationKey(businessId);
  memoryConversations.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* fine without it */ }
}


/** What the Agent said, in words, for any kind of reply (used in the chat and kept in the conversation). */
export function replyText(res) {
  if (!res) return "";
  if (res.kind === "multi") return (res.results || []).map(replyText).filter(Boolean).join("\n\n");
  if (res.kind === "workflow") {
    const run = res.run || {};
    if ((res.runs || []).length > 1) return `I've started ${res.runs.length} tasks. Each one waits for your review before anything is sent.`;
    if (run.status === "succeeded") return [run.summary, run.next_action].filter(Boolean).join(" ");
    if (run.status === "awaiting_approval") return `${run.summary || "I've prepared it."} It's in Needs Approval: nothing is sent until you approve it.`;
    if (run.pending_question) return run.pending_question.question;
    return run.error || run.next_action || "I've started working on that.";
  }
  if (res.kind === "answer") {
    const evidence = (res.evidence || []).map((ev) => `• ${ev.label}: ${ev.value}`).join("\n");
    return [res.message, evidence, res.source].filter(Boolean).join("\n\n");
  }
  return res.message || "";
}

export function submitAgentRequest({ businessId, text, capability, params, sourceChannel = "text", sourceReference, recommendationId, background = false, confirmed = false, page = null, caseId = null }) {
  const typed = typeof text === "string" && text.trim() ? text.trim() : null;
  const history = typed ? getConversation(businessId).slice(-18) : [];
  const sent = apiRequest("/agent/requests", "POST", {
    history,
    business_id: businessId,
    text: text || null,
    capability: capability || null,
    params: params || {},
    source_channel: sourceChannel,
    source_reference: sourceReference || null,
    recommendation_id: recommendationId || null,
    confirmed: Boolean(confirmed),      // a priced task's price was shown and Start pressed
    // The task is started and carried on by the server; the screen watches it and shows its step.
    background: Boolean(background),
    // Sent from a module's own Assistant: its conversation answers, never another module's (the owner, 27 Oct)
    ...(page ? { page } : {}),
    ...(caseId ? { case_id: caseId } : {}),      // the case or plan the page is on: its answer is about that one (28 Oct)
  }, { timeoutMs: 120000 });
  if (typed) {
    // Both sides of the exchange are kept, so the next message carries them.
    sent.then((res) => {
      const said = replyText(res).slice(0, 4000);
      setConversation(businessId, [...getConversation(businessId), { role: "user", content: typed.slice(0, 4000) }, ...(said ? [{ role: "assistant", content: said }] : [])]);
    }, () => {});
  }
  return announce(sent);
}

export const getAgentSummary = (businessId) => apiRequestCached(`/businesses/${businessId}/agent/summary`);
export const getRun = (runId) => apiRequest(`/workflow-runs/${runId}`, "GET");
/** Where "See details" goes: the task's own result when it has one (an idea's validation results), else its task page
 *  (the owner, 26 Oct: "see details should be going to the validation result not agent centre"). */
export async function detailsOf(runId, { wait = 0 } = {}) {
  // `wait`: seconds to give a task just started to reach its result (an idea's validation takes a few)
  const until = Date.now() + wait * 1000;
  for (;;) {
    try {
      const got = await getRun(runId);
      const run = got?.run || got;
      const to = (run?.outcome?.links || []).find((l) => l.primary)?.to;
      if (to) return to;
      if (!["queued", "running"].includes(run?.status) || Date.now() >= until) return `/agent/runs/${runId}`;
    } catch { if (Date.now() >= until) return `/agent/runs/${runId}`; }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
export const listRuns = (businessId, query = "") => apiRequest(`/businesses/${businessId}/workflow-runs${query}`, "GET");
export const approveAction = (runId, approvalId) => announce(apiRequest(`/workflow-runs/${runId}/approvals/${approvalId}/approve`, "POST", {}, { timeoutMs: 120000 }));
export const rejectAction = (runId, approvalId, note) => announce(apiRequest(`/workflow-runs/${runId}/approvals/${approvalId}/reject`, "POST", { note: note || null }));
export const answerRun = (runId, answers, background = false) =>
  announce(apiRequest(`/workflow-runs/${runId}/input`, "POST", background ? { answers, background: true } : { answers }, { timeoutMs: 120000 }));
// Change a drafted quotation while it waits for approval: it must then be approved again (AC-09).
export const editDraft = (runId, changes) => announce(apiRequest(`/workflow-runs/${runId}/draft`, "POST", changes, { timeoutMs: 120000 }));
export const cancelRun = (runId) => announce(apiRequest(`/workflow-runs/${runId}/cancel`, "POST", {}));
// A task stopped because the customer has no usable email address: save one and carry on.
export const fixCustomerEmail = (runId, email) => announce(apiRequest(`/workflow-runs/${runId}/customer-email`, "POST", { email }, { timeoutMs: 120000 }));
// Mark an invoice disputed, voided, cancelled or credited (with a reason and date), or reopen it.
export const setInvoiceState = (businessId, invoiceId, state, reason, date) =>
  announce(apiRequest(`/businesses/${businessId}/invoices/${encodeURIComponent(invoiceId)}/state`, "POST", { state, reason: reason || null, date: date || null }));
// A send that couldn't be confirmed and is unsafe to retry: the user says whether it arrived
// ("delivered": recorded as sent, nothing goes out) or not ("resend").
export const resolveDelivery = (runId, outcome) => announce(apiRequest(`/workflow-runs/${runId}/delivery`, "POST", { outcome }, { timeoutMs: 120000 }));

// The business's time zone decides what "today" is on documents the Agent creates. If none
// is stored yet, the browser's is saved once (owners only; anyone else's attempt is ignored).
const _zoneTried = new Set();
export function ensureBusinessTimezone(businessId, workspace) {
  try {
    const profile = workspace?.data?.workspace_profile;
    // C5: a business with a country works on its country's clock (the server's default): whoever's browser opens the
    // page never sets it ("Africa/Lagos" for a UK business). The browser's zone is used only when no country is known.
    if (!businessId || !workspace || workspace.id !== businessId || profile?.timezone || String(profile?.country || "").trim() || _zoneTried.has(businessId)) return;
    _zoneTried.add(businessId);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) apiRequest(`/businesses/${businessId}/agent/policy`, "PUT", { timezone: zone, timezone_source: "browser" }).catch(() => {});
  } catch {
    // A convenience only: never in the way of the page.
  }
}
export const retryRun = (runId) => announce(apiRequest(`/workflow-runs/${runId}/retry`, "POST", {}, { timeoutMs: 120000 }));
// What the owner has asked the assistant to remember about this business (never shared across businesses).
export const getAgentMemory = (businessId) => apiRequest(`/businesses/${businessId}/agent/memory`, "GET");
export const saveAgentFact = (businessId, text) => apiRequest(`/businesses/${businessId}/agent/memory`, "POST", { text });
export const forgetAgentFact = (businessId, factId) => apiRequest(`/businesses/${businessId}/agent/memory/${encodeURIComponent(factId)}`, "DELETE");
// Every quotation, invoice, contract, proposal, purchase order, credit note and receipt, with its status.
/** A query string from the values that are set ("" and null are left out). */
export const queryOf = (values = {}) => {
  const q = new URLSearchParams(Object.entries(values).filter(([, v]) => v !== "" && v != null).map(([k, v]) => [k, String(v)])).toString();
  return q ? `?${q}` : "";
};
// One page of documents: { kind, q, order, limit, offset }. The server filters, searches and orders before cutting the page.
export const listDocuments = (businessId, page = {}) => apiRequest(`/businesses/${businessId}/agent/documents${queryOf(page)}`, "GET");
export const getAgentPolicy = (businessId) => apiRequest(`/businesses/${businessId}/agent/policy`, "GET");
export const saveAgentPolicy = (businessId, patch) => apiRequest(`/businesses/${businessId}/agent/policy`, "PUT", patch);

// Business records changed: let waiting workflows react now (fire-and-forget).
export function wakeAgent(businessId) {
  if (typeof businessId !== "string" || !businessId) return;
  try {
    apiRequest(`/businesses/${encodeURIComponent(businessId)}/agent/wake`, "POST", {}).catch(() => {});
  } catch {
    // Waking the Agent is best-effort and must never break a save.
  }
}

// Server error codes (see backend app/shared/utils/errors.py) in plain words.
const ERROR_CODE_TEXT = {
  feature_unavailable: "Agent workflows aren't switched on for this workspace yet, so nothing was started. Please try again later.",
  service_unavailable: "The Agent couldn't reach its records just now. Nothing was changed, so it's safe to retry.",
  server_error: "Something went wrong on our side. Nothing was changed, so it's safe to retry.",
  channel_not_allowed: "That kind of request can only come from a connected system.",
  integration_unavailable: "Integration unavailable: the connected service didn't respond. It's safe to retry.",
};

// Turns any API error into a sentence a customer can act on, never a raw code.
export function agentErrorMessage(e, fallback = "Something went wrong. Please try again.") {
  const raw = e instanceof Error ? e.message : String(e || "");
  if (e?.code === "NETWORK_ERROR" || raw === "NETWORK_ERROR") {
    return "Can't reach EnterprateAI right now. Check your connection; nothing was changed, so it's safe to retry.";
  }
  if (e?.code === "TIMEOUT") {
    return "That's taking longer than expected. It may still finish, so give it a minute before trying again.";
  }
  const status = e?.status || Number(raw.match(/^HTTP (\d+):/)?.[1]) || 0;
  let data = e?.data;
  if (!data) {
    try { data = JSON.parse(raw.replace(/^HTTP \d+:\s*/s, "")); } catch { data = null; }
  }
  const detail = data?.detail;
  const code = data?.code || detail?.code || detail?.reason_code;
  if (code && ERROR_CODE_TEXT[code]) return ERROR_CODE_TEXT[code];
  if (code && REASON_LABEL[code]) return `${REASON_LABEL[code]}${detail?.message ? `: ${detail.message}` : "."}`;
  const said = typeof detail === "string" ? detail : detail?.message;
  if (status === 401) return "Your session has ended. Please sign in again.";
  if (status === 402) {
    // 402 covers several different things; "out of credits" is only one of them.
    const why = detail?.error;
    if (why === "FEATURE_NOT_FOUND") return "This isn't set up on the price list yet, so nothing was charged and nothing was run. Please tell support.";
    if (why === "FEATURE_DISABLED") return "This is switched off at the moment. Nothing was charged.";
    if (why === "FEATURE_NOT_ENTITLED") return "Your plan doesn't include this. Upgrade to use it.";
    return said || "You have no credits left. Top up.";
  }
  if (status === 403) return said ? `Permission changed: ${said}` : "Permission changed: you no longer have access to do this.";
  if (status === 404) return "This item no longer exists, or you don't have access to it.";
  if (status === 409) return said || "This changed since you opened it. Refresh and try again.";
  if (status === 429) return "Too many requests at once. Wait a moment, then it's safe to retry.";
  if (status >= 500) return ERROR_CODE_TEXT.server_error;
  if (said) return said;
  if (raw && !/^HTTP \d+:/.test(raw) && !raw.startsWith("{")) return raw;
  return fallback;
}

export const RUN_STATUS_LABEL = {
  created: "Starting",
  running: "In progress",
  awaiting_approval: "Needs approval",
  succeeded: "Completed",
  failed: "Needs attention",
  cancelled: "Cancelled",
};

export const SUBSTATUS_LABEL = {
  waiting_for_information: "Waiting for your answer",
  waiting_for_external_event: "Waiting",
  blocked: "Action required",
  retry_available: "Didn't go through",
  delivery_status_uncertain: "Delivery status uncertain",
};

const REASON_LABEL = {
  permission_changed: "Permission changed",
  source_state_changed: "Source data changed",
  credits_exhausted: "No credits left",
  plan_limit: "Plan limit reached",
  action_failed: "Didn't go through",
  delivery_status_uncertain: "Delivery status uncertain",
  delivery_unconfirmed: "Delivery not confirmed",
  duplicate_closed: "Closed as a duplicate",
  invalid_customer_destination: "Customer email problem",
  reminders_exhausted: "Still unpaid after reminders",
  payment_amount_mismatch: "Payment amount mismatch",
  invoice_disputed: "Invoice disputed",
  invoice_voided: "Invoice voided",
  invoice_cancelled: "Invoice cancelled",
  invoice_credited: "Invoice credited",
};

export function runStateLabel(run) {
  if (!run) return "";
  if (run.retrying) return "Waiting to finish";
  if (run.display_status === "waiting_for_review") return "Waiting for your review";      // its draft is pending (QA, 15 Oct)      // the Agent is handling it: nothing for the owner to do (QA, 15 Oct)
  if (run.status === "failed") return REASON_LABEL[run.reason_code] || SUBSTATUS_LABEL[run.substatus] || "Needs attention";
  if (run.status === "running" && run.substatus) return SUBSTATUS_LABEL[run.substatus] || "In progress";
  if (run.display_status === "nothing_to_do" || (run.status === "succeeded" && run.outcome?.skipped)) return "Nothing to do";      // C2: not "Completed"
  return RUN_STATUS_LABEL[run.status] || run.status;
}

export function runTone(run) {
  if (!run) return "slate";
  if (run.status === "succeeded") return run.outcome?.skipped ? "slate" : "emerald";
  if (run.status === "failed") return "rose";
  if (run.status === "awaiting_approval" || run.substatus === "waiting_for_information") return "amber";
  if (run.status === "cancelled") return "slate";
  return "indigo";
}

// A typed reply to the Agent's buttons (the owner, 27 Oct: "it recommends actions in the chat, and no option to type to go
// ahead", "it should be smart"): "yes" or "go ahead" is the first button, a button's own name is that button, "not now" closes
// them; anything else is a new message (null).
const _YES_WORDS = /\b(?:yes|yeah|yep|yup|ok|okay|sure|go ahead|go on|go for it|do it|do that|start it|start|proceed|continue|please do|please|sounds good|lets do it|lets go|thats fine|fine|alright|great|perfect|cool)\b/g;
// Every word a yes-word ("yes, go ahead", "ok do it please"): a yes, never one that says something more
const _isYes = (text) => {
  const t = _plain(text);
  return t.length > 0 && t.replace(_YES_WORDS, " ").replace(/\b(?:and|then|now|just)\b/g, " ").trim() === "";
};
const _NO = /^\s*(?:no|nope|not now|cancel|stop|later|skip|leave it|never mind)\b[\s.!]*$/i;
const _plain = (t) => String(t || "").toLowerCase().replace(/[“”"'’.,!?]/g, "").replace(/\s+/g, " ").trim();
export function offerFor(text, offers) {
  const all = (offers || []).filter((o) => o && o.label);
  const live = all.filter((o) => !o.dismiss);
  if (!live.length) return null;
  const said = _plain(text);
  if (!said) return null;
  if (_NO.test(text)) return all.find((o) => o.dismiss) || { dismiss: true };
  // A button named: "open it" for the only Open, "start a new launch plan", "fix allocations"
  const named = live.find((o) => { const l = _plain(o.label); return said === l || (said.length > 3 && (said.includes(l) || l.includes(said))); })
    || (/^\s*open\b/i.test(text) ? live.filter((o) => /^open\b/i.test(o.label)).length === 1 && live.find((o) => /^open\b/i.test(o.label)) : null);
  if (named) return named;
  return _isYes(text) ? live[0] : null;
}

// The Agent panel's conversations, kept on the server per person and business (the owner, 27 Oct: "hope it stores history
// conversations too"): the list, one, and saving the current one.
export const listChats = (businessId) => apiRequest(`/businesses/${businessId}/agent/chats`, "GET");
export const getChat = (businessId, id) => apiRequest(`/businesses/${businessId}/agent/chats/${id}`, "GET");
export const saveChat = (businessId, id, messages) => apiRequest(`/businesses/${businessId}/agent/chats/${id}`, "PUT", { messages });
/** A typed message carried on in the side panel when it is on the page (the owner, 27 Oct: "it should be by the side");
 *  false when it isn't, and the caller answers in place as before. */
export function toSidePanel(text) {
  const detail = { text, handled: false };
  try { window.dispatchEvent(new CustomEvent("ea:chat", { detail })); } catch { return false; }
  return detail.handled;
}
/** Where a funding or launch message is carried on (the owner's mockups, 27 Oct): its case's Assistant tab when there is one
 *  case to open, with the message sent there; null for anything else (or no answer within a few seconds). */
export async function caseChatPath(businessId, text) {
  const said = String(text || "").trim();
  if (!businessId || !said) return null;
  const asked = await apiRequest("/agent/readiness-question", "POST", { business_id: businessId, text: said }, { timeoutMs: 10000 }).catch(() => null);
  return asked?.converse && asked.to ? `${asked.to}${asked.to.includes("?") ? "&" : "?"}message=${encodeURIComponent(said.slice(0, 500))}` : null;
}
export const newChatId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
