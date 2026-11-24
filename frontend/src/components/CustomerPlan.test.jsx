// The customer plan (the owner, 26 Oct: "so where is the plan?"): the goal, each step with its words ready to edit and send.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import CustomerPlan from "./CustomerPlan";

afterEach(cleanup);
const plan = { goal: "Your goal: 5 new customers in 3 months, about 1 every 2 weeks.", steps: [
  { key: "referrals", title: "Ask your customers to pass your name on", why: "You have 2 paying customers.", target: "Message all 2 this week", draft: "Hello Raphael, thank you.", send: "whatsapp" },
  { key: "marketplace", title: "Share your Marketplace listing", why: "Put the link in every message.", to: "/marketplace/profile", cta: "Open your listing", draft: "" }] };

it("shows the goal, the steps, and copies what the owner edited", () => {
  render(<MemoryRouter><CustomerPlan plan={plan} /></MemoryRouter>);
  expect(document.querySelector("[data-plan-goal]").textContent).toBe(plan.goal);
  expect(screen.getByText("1. Ask your customers to pass your name on")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Your message: Ask your customers to pass your name on"), { target: { value: "Hi Raphael" } });
  expect(document.querySelector("[data-plan-whatsapp]")).toBeNull();      // Copy only for now (the owner, 26 Oct)
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open your listing" }).getAttribute("href")).toBe("/marketplace/profile");
});

it("shows nothing without steps", () => {
  render(<MemoryRouter><CustomerPlan plan={{ steps: [] }} /></MemoryRouter>);
  expect(document.querySelector("[data-customer-plan]")).toBeNull();
});

it("Share your listing gives the public link to copy, never the edit page (the owner, 26 Oct)", async () => {
  useWorkspaceStore.setState({ workspaceId: "b1" });
  vi.spyOn(client, "apiRequest").mockResolvedValue({ directory: { slug: "e2e-car-wash-abuja", public: true } });
  render(<MemoryRouter><CustomerPlan plan={{ steps: [{ key: "marketplace", title: "Share your Marketplace listing", why: "Put the link in every message.", share: true }] }} /></MemoryRouter>);
  expect((await screen.findByLabelText("Your Marketplace link")).value).toBe(`${window.location.origin}/marketplace/business/e2e-car-wash-abuja`);
  expect(screen.queryByRole("link", { name: "Open your listing" })).toBeNull();
});
