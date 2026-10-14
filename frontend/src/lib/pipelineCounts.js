// C6: the Business Operations pipeline counters, counted as they are. A draft (the Agent's, waiting in Needs Approval,
// or one made by hand) has not gone out; a contract that is "pending" is out with the customer for signature; a
// quotation that is sent or viewed is waiting for the customer's reply.
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "_");

export const QUOTE_WAITING = ["sent", "viewed", "submitted", "negotiation", "in_negotiation", "pending", "awaiting_response"];
export const DRAFT = ["draft", "awaiting_approval"];

export function pipelineCounts(contracts = [], rangeQuotes = []) {
  return {
    contractDrafts: contracts.filter((c) => DRAFT.includes(norm(c.status))).length,
    contractsOut: contracts.filter((c) => norm(c.status) === "pending").length,
    quoteDrafts: rangeQuotes.filter((q) => DRAFT.includes(norm(q.status))).length,
    quotesAwaitingReply: rangeQuotes.filter((q) => QUOTE_WAITING.includes(norm(q.status))).length,
  };
}
