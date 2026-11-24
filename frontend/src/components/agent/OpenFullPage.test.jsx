// P1.11: a slide-over has "Open full page" to the task's own page.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import AgentRows from "./AgentRows";

afterEach(cleanup);

describe("slide-overs", () => {
  it("the question panel opens the task's full page", () => {
    const run = { id: "run-9", workflow_key: "new_invoice", title: "New invoice", status: "running", created_at: new Date().toISOString(),
      pending_question: { question: "Who is it for?", fields: [{ key: "customer", label: "Customer", type: "text", required: true }] } };
    render(<MemoryRouter><AgentRows runs={[run]} empty="Nothing" onOpen={() => {}} onReview={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getAllByRole("button", { name: "Answer" })[0]);
    expect(screen.getByRole("link", { name: "Open full page" }).getAttribute("href")).toBe("/agent/runs/run-9");
  });
});
