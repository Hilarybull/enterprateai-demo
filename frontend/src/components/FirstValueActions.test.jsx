import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import FirstValueCard from "./FirstValueCard";
import { useWorkspaceStore } from "../store/workspace";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const result = {
  assessment_type: "pricing_health_initial", headline: "Pricing health", score: "Strong", evidence_coverage: 40, currency_sign: "£",
  strengths: [], blockers: [], metrics: [], premium_next_action: { label: "Find my best price", explains: "I can now research prices." },
  free_next_actions: [
    { label: "Save the price in your catalogue", to: "/catalogue", catalogue: { name: "Deep clean", base_price: 120, cost_of_sales: 45 } },
    { label: "Create a quotation", to: "/operations?tab=Sales&sub=Quotations&new=quote" },
  ],
};

describe("the result card's free actions", () => {
  it("Save the price saves it to the catalogue in one press, and says so", async () => {
    useWorkspaceStore.setState({ workspaceId: "ws1" });
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ saved: true, created: true, product: { name: "Deep clean", base_price: 120 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    render(<MemoryRouter><FirstValueCard result={result} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Save the price in your catalogue" }));
    await waitFor(() => expect(document.querySelector("[data-fv-done]")).toBeTruthy());
    const post = calls.find((c) => c.method === "POST");
    expect(post.url).toMatch(/\/businesses\/ws1\/catalogue\/from-check$/);
    expect(post.body).toEqual({ name: "Deep clean", base_price: 120, cost_of_sales: 45 });
    expect(document.querySelector("[data-fv-done]").textContent).toMatch(/Added in your catalogue: Deep clean at £120\./);
  });
});
