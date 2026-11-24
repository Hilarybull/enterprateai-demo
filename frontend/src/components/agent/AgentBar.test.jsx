import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../../lib/agent", async () => ({ submitAgentRequest: vi.fn(), agentErrorMessage: (_e, m) => m, getConversation: () => [],
  offerFor: (await vi.importActual("../../lib/agent")).offerFor, toSidePanel: (await vi.importActual("../../lib/agent")).toSidePanel, caseChatPath: async () => null }));
vi.mock("../GoalLauncher", () => ({ AgentGoalChat: ({ text }) => <div data-quick-check="need_funding" data-text={text}>chat</div>,
  agentCardPath: (t) => `/dashboard?ask=${encodeURIComponent(t)}` }));
vi.mock("./TaskFlow", () => ({ useTaskFlow: () => ({ ask: vi.fn(), element: null }) }));
import { submitAgentRequest } from "../../lib/agent";
import AgentBar from "./AgentBar";

const typeAndSend = (text) => {
  fireEvent.change(screen.getByLabelText("Ask EnterprateAI"), { target: { value: text } });
  fireEvent.submit(screen.getByLabelText("Ask EnterprateAI").closest("form"));
};

describe("the Agent Centre bar answers where it was asked (the owner's brief, 25 Oct)", () => {
  it("runs the check under the bar, on the Agent Centre, never a jump to the dashboard", async () => {
    submitAgentRequest.mockResolvedValue({ kind: "check", goal_key: "need_funding", said: "I need funding readiness" });
    function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }
    render(<MemoryRouter initialEntries={["/agent"]}><Routes>
      <Route path="/agent" element={<><AgentBar businessId="b1" /><Where /></>} />
      <Route path="*" element={<p data-testid="where">elsewhere</p>} /></Routes></MemoryRouter>);
    typeAndSend("I need funding readiness");
    await waitFor(() => expect(document.querySelector("[data-quick-check='need_funding']")).not.toBeNull());
    expect(submitAgentRequest).toHaveBeenCalledWith(expect.objectContaining({ businessId: "b1", text: "I need funding readiness", sourceChannel: "text" }));
    expect(screen.getByTestId("where").textContent).toBe("/agent");
    expect(document.querySelector("[data-you-asked]").textContent).toBe("I need funding readiness");
  });

  it("typing 'yes, go ahead' at its buttons runs the first, never insisting on a click (the owner, 27 Oct)", async () => {
    submitAgentRequest.mockResolvedValue({ kind: "answer", message: "₦5m grant for equipment: 40/100 so far, not ready yet.",
      actions: [{ label: "Open “₦5m grant for equipment”", to: "/funding/c1" }] });
    function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }
    render(<MemoryRouter initialEntries={["/agent"]}><Routes>
      <Route path="/agent" element={<><AgentBar businessId="b1" /><Where /></>} />
      <Route path="*" element={<Where />} /></Routes></MemoryRouter>);
    typeAndSend("How ready am I for funding?");
    await screen.findByRole("button", { name: "Open “₦5m grant for equipment”" });
    typeAndSend("yes, go ahead");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/funding/c1"));
    expect(submitAgentRequest).toHaveBeenCalledTimes(1);      // the button, never a new message
  });
});
