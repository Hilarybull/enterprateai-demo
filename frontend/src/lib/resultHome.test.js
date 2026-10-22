import { expect, it } from "vitest";
import { resultHome } from "./resultHome";

// A funding or launch result opens on its case page, wherever it comes from (22 Oct: "it should open as usual").
it("knows where a result lives", () => {
  expect(resultHome({ assessment: { kind: "funding", case_id: "c1" } })).toBe("/funding/c1?tab=overview");
  expect(resultHome({ assessment: { kind: "launch", initiative_id: "l1" } })).toBe("/launch/l1?tab=overview");
  expect(resultHome({ assessment_type: "pricing_health_initial" })).toBeNull();
});
