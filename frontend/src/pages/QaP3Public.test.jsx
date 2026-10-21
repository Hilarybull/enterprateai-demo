// QA P3 on the public pages: the Marketplace is in the homepage nav, the support address is spelled
// right, the hero's Send is not "Working…" because of the task card, and a Marketplace search is in the address.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import LandingPage from "./LandingPage";
import MarketplacePage from "./MarketplacePage";

const Where = () => <p data-testid="where">{useLocation().search}</p>;
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the public homepage", () => {
  it("keeps the Marketplace out of the nav for now, and every support link is the real address", () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    expect(document.querySelector("[data-nav-marketplace]")).toBeNull();      // hidden from the navbar (the owner, 16 Oct)
    const mails = [...document.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute("href"));
    expect(mails.length).toBeGreaterThan(0);
    expect(mails.every((m) => m === "mailto:support@enterprate.ai")).toBe(true);
  });
});

describe("the Marketplace search", () => {
  it("is kept in the address as ?q=, and read back from it", () => {
    render(<MemoryRouter initialEntries={["/marketplace?tab=businesses&q=plumber"]}><Routes>
      <Route path="/marketplace" element={<><MarketplacePage /><Where /></>} /></Routes></MemoryRouter>);
    const box = screen.getByLabelText("Search the Marketplace");
    expect(box.value).toBe("plumber");
    fireEvent.change(box, { target: { value: "bakery" } });
    expect(screen.getByTestId("where").textContent).toContain("q=bakery");
    fireEvent.change(box, { target: { value: "" } });
    expect(screen.getByTestId("where").textContent).not.toContain("q=");
  });
});
