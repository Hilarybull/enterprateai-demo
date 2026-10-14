// B9: a prepared document (a funding pack) is listed under Documents and opens where it lives; the run page links to it.
// C1: the History filter is built from the registry. C4: no question is built inside another question.
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentList, useCapabilityOptions } from "./AgentCentrePage";
import { askFor } from "../components/agent/TaskFlow";

afterEach(cleanup);

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("B9: prepared documents", () => {
  it("lists a funding pack under Documents with no amount, and opens it where it lives", () => {
    const onOpen = vi.fn();
    const pack = { kind: "funding_pack_draft", kind_label: "Funding pack", id: "run:r1", reference: "Business plan summary, Cash flow", party: "", total: null,
      currency: null, status: "prepared", status_label: "Ready for your review", date: "2026-10-14", run_id: "r1", from_agent: true, to: "/funding/c1?tab=documents" };
    render(<MemoryRouter><DocumentList documents={{ items: [pack], kinds: [], total: 1 }} kind="" onKind={() => {}} onOpen={onOpen} onEdit={() => {}} /></MemoryRouter>);
    expect(screen.getByText("Funding pack Business plan summary, Cash flow")).toBeTruthy();
    expect(screen.getByText("Ready for your review")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/£0\.00/);
    fireEvent.click(screen.getByText("Funding pack Business plan summary, Cash flow"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ to: "/funding/c1?tab=documents" }));
  });

  it("the run page links to what the task prepared", async () => {
    const run = { id: "r1", status: "succeeded", workflow_key: "funding_pack_draft", title: "Funding Pack Draft", summary: "Funding pack draft ready for review.",
      steps_planned: [{ key: "prepare", title: "Draft the funding pack" }], current_step: "prepare",
      outcome: { links: [{ label: "Funding pack", to: "/funding/c1?tab=documents" }] } };
    globalThis.fetch = vi.fn(async () => json({ run, steps: [], approvals: [], history: [], can: {} }));
    const { default: AgentRunPage } = await import("./AgentRunPage");
    render(<MemoryRouter initialEntries={["/agent/runs/r1"]}><Routes><Route path="/agent/runs/:runId" element={<AgentRunPage />} /></Routes></MemoryRouter>);
    const link = await screen.findByRole("link", { name: "Open funding pack" });
    expect(link.getAttribute("href")).toBe("/funding/c1?tab=documents");
  });
});

describe("C1: the History filter", () => {
  it("offers every task in the registry by its own title", async () => {
    const workflows = Array.from({ length: 32 }, (_, i) => ({ workflow_key: `task_${i}`, title: `Task ${String(i).padStart(2, "0")}` }));
    globalThis.fetch = vi.fn(async () => json({ workflows }));
    const { result } = renderHook(() => useCapabilityOptions());
    await waitFor(() => expect(result.current.length).toBe(32));
    expect(result.current[0]).toEqual(["task_0", "Task 00"]);
  });
});

describe("C4: questions read as questions", () => {
  it("never puts a label that is already a question's words inside another question", () => {
    expect(askFor({ key: "problem", label: "What the customer needs", type: "textarea" })).toBe("Tell me what the customer needs.");
    expect(askFor({ key: "method", label: "How it was paid", type: "choice" })).toBe("Tell me how it was paid.");
    expect(askFor({ key: "problem", label: "What the customer needs", question: "What does the customer need?" })).toBe("What does the customer need?");
    expect(askFor({ key: "valid_until", label: "Valid until", type: "date" })).toBe("How long should it stay valid?");      // a proposal or a quotation
    expect(askFor({ key: "x", label: "What is what?" })).not.toMatch(/What is the what/i);
  });
});
