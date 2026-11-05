import { describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({ apiRequest: vi.fn(), apiRequestCached: vi.fn(), getApiBaseUrl: () => "" }));
import { claimedEntities } from "./directory";

const tester = { id: "w1", name: "Tester", data: { workspace_profile: { company_name: "Tester" } } };
const claim = (over) => ({ id: "c1", status: "verified", target: "w1", business_id: "w1", profile: { name: "Larger Beer test" }, ...over });

describe("businesses to switch to from the workspace card", () => {
  it("lists one claimed into a workspace already there, saying which", () => {
    expect(claimedEntities([claim()], [tester])).toEqual([{ id: "c1", name: "Larger Beer test", business_id: "w1", inside: "Tester" }]);
  });
  it("leaves out a new business, which is already a workspace on the list", () => {
    expect(claimedEntities([claim({ target: "new" })], [tester])).toEqual([]);
  });
  it("leaves out a claim that isn't approved, and one whose workspace has gone", () => {
    expect(claimedEntities([claim({ status: "revoked" })], [tester])).toEqual([]);
    expect(claimedEntities([claim({ business_id: "gone" })], [tester])).toEqual([]);
  });
  it("doesn't repeat a workspace's own verified profile", () => {
    expect(claimedEntities([claim({ profile: { name: "tester" } })], [tester])).toEqual([]);
  });
});
