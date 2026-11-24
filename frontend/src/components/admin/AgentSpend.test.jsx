import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AgentSpend from "./AgentSpend";

const usage = {
  window_days: 30,
  complete: true,
  agent: {
    calls: 12, searches: 8, tokens: 9000, model_cost_usd: 0.012, search_cost_usd: 0.12, estimated_cost_usd: 0.132,
    credits_charged: 14, charges: 7,
    by_feature: [{ label: "agent_research", calls: 10, tokens: 8000, estimated_cost_usd: 0.13, credits: 0 }],
    by_user: [{ user_id: "u1", email: "a@x.test", calls: 20, estimated_cost_usd: 0.132, credits: 14 }],
  },
};

describe("AgentSpend", () => {
  it("shows the Agent's cost beside the credits it charged", () => {
    render(<AgentSpend usage={usage} />);
    expect(screen.getByText("Agent spending")).toBeTruthy();
    expect(screen.getAllByText("$0.1320").length).toBeGreaterThan(0);
    expect(screen.getAllByText("14").length).toBe(2);
    expect(screen.getByText("7 charges")).toBeTruthy();
    expect(screen.getByText("agent_research")).toBeTruthy();
    expect(screen.getByText("a@x.test")).toBeTruthy();
    expect(screen.getByText("Last 30 days")).toBeTruthy();
  });

  it("renders nothing without Agent data and says when the window is empty", () => {
    const { container } = render(<AgentSpend usage={{}} />);
    expect(container.innerHTML).toBe("");
    render(<AgentSpend usage={{ window_days: 7, agent: { calls: 0, searches: 0, charges: 0, by_feature: [], by_user: [] } }} />);
    expect(screen.getByText("No Agent activity recorded in this window.")).toBeTruthy();
  });
});
