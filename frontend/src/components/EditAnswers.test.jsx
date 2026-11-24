// Edit and run again, on the result itself (the owner's QA, 15 Oct): the answers in place, Save and check again, the new result shown.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import FirstValueCard from "./FirstValueCard";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const base = (score, over = {}) => ({ assessment_type: "funding_readiness_initial", headline: "Funding readiness", score, score_label: "out of 100", evidence_coverage: 50,
  strengths: [], blockers: [], criteria: [], metrics: [], free_next_actions: [], premium_gate: { allowed: true }, _session: "sess-1",
  _edit: { questions: [{ key: "amount", label: "How much funding do you need?", type: "number" }, { key: "stage", label: "What stage is the business at?", type: "choice",
    options: [{ value: "pre_revenue", label: "Not trading yet" }, { value: "trading", label: "Trading" }] }], answers: { amount: 250000, stage: "pre_revenue" } }, ...over });

describe("edit and run again on the result", () => {
  it("opens the answers, sends only what changed, and shows the new result", async () => {
    const call = vi.spyOn(client, "apiRequest").mockResolvedValue({ session_id: "sess-1", result: base(41), edit: base(41)._edit });
    const onUpdated = vi.fn();
    render(<MemoryRouter><FirstValueCard result={base(22)} onUpdated={onUpdated} /></MemoryRouter>);
    expect(document.querySelector("[data-fv-score]").textContent.startsWith("22")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit answers" }));
    expect(screen.getByLabelText("How much funding do you need?").value).toBe("250,000");
    expect(screen.getByRole("button", { name: "Save and check again" }).disabled).toBe(true);      // nothing changed yet
    fireEvent.change(screen.getByLabelText("What stage is the business at?"), { target: { value: "trading" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save and check again" })); });
    expect(call).toHaveBeenCalledWith("/task-sessions/sess-1/answers", "POST", { answers: { stage: "trading" } }, { timeoutMs: 30000 });
    await waitFor(() => expect(document.querySelector("[data-fv-score]").textContent.startsWith("41")).toBe(true));
    expect(onUpdated).toHaveBeenCalled();
    expect(document.querySelector("[data-edit-form]")).toBeNull();
  });

  it("isn't offered when the result has nothing to edit", () => {
    render(<MemoryRouter><FirstValueCard result={base(22, { _edit: null })} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "Edit answers" })).toBeNull();
  });
});
