import { expect, test } from "vitest";
import { statusWords } from "./vocab";
import { stepsOf } from "../components/ResultSummary";

const result = { assessment_type: "business_risk_initial", score: null, ready_at: 75, blockers: [
  { key: "concentration", label: "Delta Offices Ltd is 100% of your paid income", kind: "failed" },
  { key: "key_person", label: "The business slows down without you", kind: "partial", why: "A month away would slow the work and the income." }] };

test("a risk result says risks, never readiness words or a score (24 Oct)", () => {
  expect(statusWords(result, {}).sentence).toBe("2 risks to act on.");
  expect(statusWords(result, {}).score).toBe("");
  expect(statusWords({ ...result, blockers: [] }, {}).sentence).toBe("No risks found in your records.");
});

test("each risk card has a short title, the finding underneath and a button", () => {
  const [a, b] = stepsOf(result);
  expect(a.title).toBe("Relying on one customer");
  expect(a.why).toBe("Delta Offices Ltd is 100% of your paid income.");
  expect([a.cta, a.to]).toEqual(["Run a what-if: lose them", "/simulation?template=tmpl_client_loss"]);
  expect([b.title, b.badge, b.why]).toEqual(["Cover if you're away for a month", "Watch", "The business slows down without you. A month away would slow the work and the income."]);
  expect(a.field && b.field).toBe(true);      // shown as buttons, not text links
});
