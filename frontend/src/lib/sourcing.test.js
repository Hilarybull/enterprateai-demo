import { beforeEach, expect, it, vi } from "vitest";
import { apiRequest } from "../api/client";
import { saveSourcingDraft } from "./sourcing";

vi.mock("../api/client", () => ({ apiRequest: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

it("recognises a committed save after a timed-out response without writing again", async () => {
  const fields = { kind: "RFP", title: "Camping", description: "Tent rental",
    requirements: [{ text: "Insurance", weight: 2, mandatory: true, format: "document" }] };
  const record = { id: "request", ...fields, sourcing_kind: "RFP",
    requirements: [{ format: "document", mandatory: true, weight: 2, text: "Insurance" }] };
  apiRequest.mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "TIMEOUT" }))
    .mockResolvedValueOnce({ record });
  expect(await saveSourcingDraft("request", "buyer", fields)).toEqual(record);
  expect(apiRequest.mock.calls.map((call) => call[1])).toEqual(["PUT", "GET"]);
  expect(apiRequest.mock.calls[0][0]).toBe("/proposals/sourcing/drafts/request?workspace_id=buyer");
});

it("preserves the failure when the saved record does not contain the current edits", async () => {
  const failure = Object.assign(new Error("timeout"), { code: "TIMEOUT" });
  apiRequest.mockRejectedValueOnce(failure).mockResolvedValueOnce({ record: { title: "Old title" } });
  await expect(saveSourcingDraft("request", "buyer", { kind: "RFP", title: "New title" })).rejects.toBe(failure);
});

it("does not reconcile a permission rejection", async () => {
  const failure = Object.assign(new Error("denied"), { status: 403 });
  apiRequest.mockRejectedValueOnce(failure);
  await expect(saveSourcingDraft("request", "buyer", { kind: "RFP", title: "Camping" })).rejects.toBe(failure);
  expect(apiRequest).toHaveBeenCalledTimes(1);
});
