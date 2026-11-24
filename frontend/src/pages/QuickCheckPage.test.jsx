// The owner's mockups, 27 Oct: Idea Validation opens on its Assistant, with the check, its research and the catalogue beside it.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../components/readiness/IdeaAssistant", () => ({ default: () => <div data-idea-assistant>assistant</div> }));
vi.mock("../components/QuickCheck", () => ({ default: ({ goalKey }) => <div data-quick-check={goalKey}>check</div>, QUICK_CHECKS: { test_idea: { title: "Test a business idea", intro: "" }, price_offer: { title: "Pricing", intro: "" } } }));
vi.mock("./ReadinessPage", () => ({ SavedResearch: ({ goal }) => <div data-saved-research={goal}>research</div> }));
vi.mock("../components/readiness/CaseAssistant", () => ({ SideCards: ({ feature }) => <div data-side-cards={feature}>side</div> }));
vi.mock("../api/client", () => ({ apiRequest: vi.fn(async () => ({ business: { name: "Fashionista" } })) }));
vi.mock("../components/CheckAssistant", () => ({ default: ({ topic, said }) => <div data-check-assistant={topic} data-said={said}>chat</div> }));
import QuickCheckPage from "./QuickCheckPage";
import { useWorkspaceStore } from "../store/workspace";

afterEach(cleanup);
const at = (path) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/check/:goal" element={<QuickCheckPage />} /></Routes></MemoryRouter>);

it("opens the idea on its Assistant, with Assessment, Research and Catalogue tabs", async () => {
  useWorkspaceStore.setState({ workspaceId: "b1" });
  at("/check/idea");
  expect(screen.getByRole("heading", { name: "Idea Validation" })).toBeTruthy();
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Assistant", "Assessment", "Research", "Catalogue"]);
  expect(document.querySelector("[data-idea-assistant]")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Assessment" }));
  await waitFor(() => expect(document.querySelector('[data-quick-check="test_idea"]')).toBeTruthy());      // the quick check until a validation has run
  fireEvent.click(screen.getByRole("tab", { name: "Research" }));
  expect(document.querySelector('[data-saved-research="test_idea"]')).toBeTruthy();
});

it("a sentence handed to the check still opens the check", async () => {
  useWorkspaceStore.setState({ workspaceId: "b1" });
  at("/check/idea?said=a%20mobile%20car%20wash");
  await waitFor(() => expect(document.querySelector('[data-quick-check="test_idea"]')).toBeTruthy());      // the quick check until a validation has run
  cleanup();
  at("/check/pricing?said=soap%20bars");
  expect(document.querySelector('[data-check-assistant="pricing"]').getAttribute("data-said")).toBe("soap bars");      // the check, in its chat
});

it("opens the pricing, customers and risks checks as one chat with the check in it, no Result tab (the owner, 1 Nov)", () => {
  useWorkspaceStore.setState({ workspaceId: "b1" });
  at("/check/pricing?tab=result");
  expect(screen.queryAllByRole("tab")).toEqual([]);
  expect(document.querySelector('[data-check-assistant="pricing"]')).toBeTruthy();
});

it("shows the business beside the check's chat, as the case pages do (the owner, 1 Nov)", async () => {
  useWorkspaceStore.setState({ workspaceId: "b1" });
  at("/check/pricing");
  await waitFor(() => expect(document.querySelector('[data-side-cards="pricing"]')).toBeTruthy());
});

it("the Assessment tab offers Run the idea validation, asked in the Assistant (the owner, 30 Oct)", async () => {
  useWorkspaceStore.setState({ workspaceId: "b1" });
  at("/check/idea?tab=assessment");
  const run = await screen.findByRole("button", { name: "Run the idea validation" });
  fireEvent.click(run);
  await waitFor(() => expect(document.querySelector("[data-idea-assistant]")).toBeTruthy());
});
