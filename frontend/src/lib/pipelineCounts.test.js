import { describe, expect, it } from "vitest";
import { pipelineCounts } from "./pipelineCounts";

describe("C6: the pipeline counters count what they say", () => {
  it("counts drafts waiting for approval, contracts out for signature and quotations waiting for a reply", () => {
    const contracts = [{ status: "draft" }, { status: "awaiting_approval" }, { status: "pending" }, { status: "active" }, { status: "Draft" }];
    const quotes = [{ status: "draft" }, { status: "sent" }, { status: "viewed" }, { status: "accepted" }, { status: "awaiting approval" }];
    expect(pipelineCounts(contracts, quotes)).toEqual({ contractDrafts: 3, contractsOut: 1, quoteDrafts: 2, quotesAwaitingReply: 2 });
  });

  it("an Agent draft waiting in Needs Approval is never counted as 0", () => {
    expect(pipelineCounts([{ status: "draft", agent_run_id: "r1" }], [{ status: "draft", agent_run_id: "r2" }]))
      .toEqual({ contractDrafts: 1, contractsOut: 0, quoteDrafts: 1, quotesAwaitingReply: 0 });
  });
});
