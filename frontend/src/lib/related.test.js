import { expect, it } from "vitest";
import { relatedReady, relatedServices } from "./related";

// F-8 (22 Oct): shown only when the check says ready (75 or above, all gates pass), current, with nothing blocking.
it("shows the related services only for a current, ready case with nothing blocking", () => {
  expect(relatedReady({ classification: "conditionally_ready", score: 74 })).toBe(false);
  expect(relatedReady({ classification: "ready", score: 75, freshness: "current", blockers: [] })).toBe(true);
  expect(relatedReady({ classification: "not_ready", score: 93, blockers: [{ code: "G2" }] })).toBe(true);      // 93: always shown
  expect(relatedReady({ classification: "insufficient_evidence", score: null }, 75, 93)).toBe(true);
  expect(relatedReady({ classification: "insufficient_evidence", score: null, known_score: 95 })).toBe(true);
  expect(relatedReady({ classification: "insufficient_evidence", score: null })).toBe(false);
});

it("opens each tool on this case, says what is done, and upgrades what the plan lacks", () => {
  const items = relatedServices({ feature: "funding", subject: { id: "c1", summary: { pack: { ready: 2, total: 2 } } }, packLocked: true });
  expect(items[0]).toMatchObject({ to: "/funding/c1?tab=documents", cta: "View funding pack", title: "Your funding pack is ready", locked: true });
  expect(items.find((x) => x.key === "scenario").to).toBe("/funding/c1?tab=scenarios");
  expect(relatedServices({ feature: "launch", subject: { id: "l1" } }).map((x) => x.key)).toEqual(["pricing", "plan", "marketplace", "invoice", "funding"]);
  // what is already done is left out
  expect(relatedServices({ feature: "funding", subject: { id: "c1", related_done: { marketplace: true, launch: true } } }).map((x) => x.key)).toEqual(["pack", "plan", "invoice", "catalogue", "scenario"]);
});
