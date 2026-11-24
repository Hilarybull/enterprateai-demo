// QA follow-up R12: the modal says Close (the task waits in Needs You), the homepage header goes to the
// Dashboard when signed in, the first goal puts the cursor in the task's reply box, and a typed item
// becomes the catalogue offering it names.
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ChatQuestionThread } from "./agent/TaskFlow";
import { LineItems, catalogueItemNamed } from "./agent/AgentBits";
import GoalLauncher from "./GoalLauncher";
import LandingPage from "../pages/LandingPage";
import { useAuthStore } from "../store/auth";

const realMatchMedia = window.matchMedia;
beforeEach(() => {
  window.matchMedia = (q) => ({ matches: /prefers-reduced-motion/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  localStorage.clear();
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const out = (init.method || "GET") === "POST" && /task-sessions$/.test(String(url)) ? {
      id: "s1", state: "collecting_context", entry_mode: "quick_task", goal_key: "create_invoice", goal_label: "Create Invoice", next: "questions",
      questions: [{ key: "customer", label: "Who is it for?", type: "text", required: true, default: "" }], inputs: {}, proposed: {}, summary: [], missing: ["customer"],
      authenticated: false, retention_days: 7, resolution: { original_goal: "Create Invoice", resolution_class: "direct_supported", message: "I'll prepare it.", recommended_path: [] } } : {};
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.matchMedia = realMatchMedia; useAuthStore.setState({ token: null }); });

describe("R12", () => {
  it("(a) the dialog's button closes it and says the task waits", () => {
    const onCancel = vi.fn();
    render(<ChatQuestionThread fields={[{ key: "a", label: "First", type: "text", required: true }]} onSubmit={() => {}} onCancel={onCancel} />);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.getAttribute("title")).toBe("The task stays in Needs You, to finish later");
    fireEvent.click(close);
    expect(onCancel).toHaveBeenCalled();
  });

  it("(b) signed in, the homepage header offers the Dashboard instead of Sign in", () => {
    useAuthStore.setState({ token: "t" });
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    const link = document.querySelector("[data-nav-account]");
    expect(link.textContent).toBe("Dashboard");
    expect(link.getAttribute("href")).toBe("/dashboard");
  });

  it("(c) the first goal typed in the hero puts the cursor in the task's reply box", async () => {
    render(<MemoryRouter><GoalLauncher /></MemoryRouter>);
    const prompt = document.getElementById("goal-prompt");
    prompt.focus();
    fireEvent.change(prompt, { target: { value: "create an invoice" } });
    await act(async () => { fireEvent.submit(prompt.closest("form")); });
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole("region", { name: "Your task" })).getByLabelText("Who is it for?")));
  });

  it("(d) a typed item becomes the catalogue offering it names, and the columns are labelled", () => {
    const cat = [{ id: "p1", name: "End of tenancy cleaning", unit_price: 220 }];
    expect(catalogueItemNamed("end of tenancy clean", cat).id).toBe("p1");
    let rows;
    function Host() { const [v, setV] = useState([{ product_id: null, name: "", quantity: 1, unit_price: "", other: true }]); rows = v; return <LineItems field={{ catalogue: cat }} value={v} onChange={setV} />; }
    render(<Host />);
    const desc = screen.getByLabelText("Item description");
    fireEvent.change(desc, { target: { value: "end of tenancy clean" } });
    fireEvent.blur(desc);
    expect(rows[0]).toMatchObject({ product_id: "p1", other: false, unit_price: 220 });
    expect(document.querySelector("[data-line-headings]").textContent).toBe("ItemQtyUnit price");
  });
});

describe("R3 on the result card", () => {
  it("labels partly-there evidence as early evidence, and only the unknown as not known yet", async () => {
    const { default: FirstValueCard } = await import("./FirstValueCard");
    const result = { assessment_type: "idea_viability_initial", headline: "Initial Idea Viability", score: 85, score_label: "out of 100", evidence_coverage: 86,
      criteria: [], strengths: [], metrics: [], free_next_actions: [], premium_next_action: { label: "Validate the weak points", explains: "" },
      blockers: [{ key: "demand", label: "Demand evidence is early", kind: "partial", state: "partially_met" },
        { key: "competitors", label: "Competitor pricing is unknown", kind: "unknown", state: "unknown" }] };
    render(<MemoryRouter><FirstValueCard result={result} /></MemoryRouter>);
    // One count on the card (the owner's brief, 20 Oct): the steps carry the labels; partly there is never "not known yet".
    const badges = [...document.querySelectorAll("[data-next-step]")].map((li) => li.querySelector("span").textContent);
    expect(badges).toContain("Partly there");
    expect(badges).toContain("Need from you");
  });
});
