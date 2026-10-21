// The pricing PDF (19 Oct 2026): Explorer and Starter are 1 user seat; Decision Engine 3 included, more at £15/mo each.
// The owner invites within the seats, gives each member a monthly allowance from the team's pooled credits, and buys seats.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

let seats;
const calls = [];
vi.mock("../api/client", () => ({
  apiRequest: vi.fn(async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === "/workspace/seats") return seats;
    if (path === "/workspace/members") return [{ id: "m1", email: "amy@team.test", permission_type: "module", permissions: { modules: ["dashboard"] }, role: "member", credits: { monthly: 100, used: 40, left: 60 } }];
    if (path.endsWith("/credits")) return { id: "m1", credits: { monthly: body.monthly, used: 40, left: body.monthly - 40 } };
    return [];
  }),
}));
vi.mock("../components/InviteModal", () => ({ default: () => <div data-testid="invite-modal" /> }));
const { default: TeamPage } = await import("./TeamPage");

afterEach(() => { cleanup(); calls.length = 0; });
const mount = async () => { render(<MemoryRouter><TeamPage /></MemoryRouter>); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const DE = { plan: "decision_engine", included: 3, extra: 0, total: 3, used: 2, free: 1, can_invite: true, can_buy: true, seat_price: 15, seat_credits: 250 };

describe("seats and team credits", () => {
  it("on Decision Engine with a seat free: invites, shows each member's credits, and can change their allowance", async () => {
    seats = DE;
    await mount();
    expect(document.querySelector("[data-seats-used]").textContent).toBe("2 of 3 seats in use");
    expect(screen.getByRole("button", { name: "Add a seat · £15/mo" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Invite member/ })[0]);
    expect(screen.getByTestId("invite-modal")).toBeTruthy();
    const credits = document.querySelector("[data-member-credits]");
    expect(credits.textContent).toContain("40 of 100 used");
    fireEvent.click(credits);
    fireEvent.change(screen.getByLabelText("Monthly AI credits for amy@team.test"), { target: { value: "200" } });
    await act(async () => { fireEvent.submit(document.querySelector("[data-member-credits-form]")); });
    expect(calls.find((c) => c.path === "/workspace/members/m1/credits").body).toEqual({ monthly: 200 });
    expect(document.querySelector("[data-member-credits]").textContent).toContain("40 of 200 used");
  });

  it("with every seat in use: says so and offers an extra seat, never the invite", async () => {
    seats = { ...DE, used: 3, free: 0, can_invite: false };
    await mount();
    fireEvent.click(screen.getAllByRole("button", { name: /Invite member/ })[0]);
    expect(screen.queryByTestId("invite-modal")).toBeNull();
    expect(document.querySelector("[data-seat-note]").textContent).toBe("All 3 seats are in use. Add a seat (£15/mo) or remove a member first.");
  });

  it("on a one-seat plan: points to Decision Engine and keeps each member on their own credits", async () => {
    seats = { plan: "starter_insight", included: 1, extra: 0, total: 1, used: 1, free: 0, can_invite: false, can_buy: false, seat_price: 15, seat_credits: 250 };
    await mount();
    expect(screen.getByRole("link", { name: "See Decision Engine" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Invite member/ })[0]);
    expect(document.querySelector("[data-seat-note]").textContent).toContain("Inviting your team is on Decision Engine");
  });
});
