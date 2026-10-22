import { expect, it } from "vitest";
import { itemConfidence } from "./itemConfidence";

const now = new Date("2026-10-22");
it("labels each item by its own sources (P11, 22 Oct)", () => {
  expect(itemConfidence({ kind: "researched", sources: [{ publisher: "GOV.UK", date: "2025-03-13" }, { publisher: "Invest Leeds", date: "2025-03-27" }] }, now).label).toBe("High");
  expect(itemConfidence({ kind: "researched", sources: [{ publisher: "GOV.UK", date: "2025-03-13" }] }, now)).toEqual({ label: "Medium", reason: "Only one source." });
  expect(itemConfidence({ kind: "researched", sources: [{ publisher: "ONS", date: "2019-01-01" }] }, now).label).toBe("Low");
  expect(itemConfidence({ kind: "estimated", method: "fixed costs × 3" }, now)).toEqual({ label: "Low", reason: "Estimated: fixed costs × 3" });
  expect(itemConfidence({ kind: "reused", value: 450 }, now).label).toBe("From you");
});
