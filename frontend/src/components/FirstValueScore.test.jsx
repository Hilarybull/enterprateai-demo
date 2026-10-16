// §2/§3: the quick check's score is labelled Provisional with its coverage beside it; once the full assessment exists its
// summary is shown instead (never two scores), and a full assessment with missing data shows no score.
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import FirstValueCard from "./FirstValueCard";

afterEach(cleanup);
const base = { assessment_type: "launch_readiness_initial", headline: "Launch readiness", score: 62, evidence_coverage: 40, currency_sign: "£",
  strengths: [], blockers: [], metrics: [], premium_next_action: { label: "Check my launch", explains: "" }, free_next_actions: [] };

describe("the first-value card's score", () => {
  it("is Provisional before the full assessment, with coverage beside it", () => {
    render(<MemoryRouter><FirstValueCard result={{ ...base, provisional: true }} /></MemoryRouter>);
    expect(document.querySelector("[data-fv-provisional]").textContent).toBe("Provisional");
    expect(document.querySelector("[data-fv-coverage]").textContent).toContain("40%");
  });

  it("a full check that can't score yet never hides the score from this request's answers (QA, 15 Oct)", () => {
    const assessment = { assessment_id: "a1", kind: "funding", case_id: "fc1", title: "Market · £250k", classification: "insufficient_evidence", score: null, evidence_coverage: 40 };
    render(<MemoryRouter><FirstValueCard result={{ ...base, provisional: true, assessment }} /></MemoryRouter>);
    expect(document.querySelector("[data-fv-score]").textContent.startsWith("62")).toBe(true);
    expect(document.querySelector("[data-fv-score]").textContent).not.toContain("No score yet");
    expect(document.querySelector("[data-fv-earlier]").textContent).toContain("Full check: not enough evidence to score yet (40% evidence)");
    expect(document.querySelector("[data-fv-source]").textContent).toBe("Market · £250k · From your answers");
  });
});
