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

describe("the Agent Centre bar uses the Agent card's pathway (the owner's choice, 22 Oct)", () => {
  it("hands what was typed to the dashboard's Agent card, as if typed there", async () => {
    function Where() { return <p data-testid="where">{useLocation().pathname}{useLocation().search}</p>; }
    render(<MemoryRouter initialEntries={["/agent"]}><Routes>
      <Route path="/agent" element={<AgentBar businessId="b1" />} />
      <Route path="*" element={<Where />} /></Routes></MemoryRouter>);
    typeAndSend("I need funding readiness");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/dashboard?ask=I%20need%20funding%20readiness"));
    expect(submitAgentRequest).not.toHaveBeenCalled();
  });
});
