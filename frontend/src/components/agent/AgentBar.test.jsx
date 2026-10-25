import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../../lib/agent", () => ({ submitAgentRequest: vi.fn(), agentErrorMessage: (_e, m) => m, getConversation: () => [] }));
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
});
