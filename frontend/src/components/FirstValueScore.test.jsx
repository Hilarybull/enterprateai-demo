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

  it("shows the full assessment's own summary once it exists, and no score when data is missing", () => {
    const assessment = { assessment_id: "a1", classification: "insufficient_evidence", score: null, evidence_coverage: 80 };
    render(<MemoryRouter><FirstValueCard result={{ ...base, provisional: true, assessment }} /></MemoryRouter>);
    const shown = document.querySelector("[data-fv-assessment]").textContent;
    expect(shown).toContain("No score yet") && expect(shown).toContain("Insufficient evidence");
    expect(document.querySelector("[data-fv-provisional]")).toBeNull();
    expect(document.querySelector("[data-fv-coverage]").textContent).toContain("80%");
    // F-1: the full check leads; the first result is kept, said as earlier, never as the headline score.
    expect(document.querySelector("[data-fv-earlier]").textContent).toContain("Earlier: 62/100 (first result)");
    expect(document.querySelector("[data-fv-score]").textContent.startsWith("No score yet")).toBe(true);
  });
});
