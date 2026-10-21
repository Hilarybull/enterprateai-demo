// Pinned on the dashboard (the owner's brief, 20 Oct): every pinned item, funding or launch, is the same full-width strip:
// an icon, the case's name, one status line, ONE button ("Open") and a ⋯ menu with Unpin, Run the check again and Edit
// answers. No "Pinned ·" label, no pin icon, no X. The full result card shows only right after a fresh run.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import PinnedCards, { stripStatus, usePinned } from "./PinnedCards";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.search}</p>; }
const item = (id, title, extra = {}) => ({ id, kind: "funding", title, label: `Funding readiness · ${title}`, score: null, to_do: 0,
  verdict: "Not ready to approach funders yet", pack: { ready: 1, total: 2 }, open: `/funding/${id}`, answers: `/funding/${id}?tab=answers`, again: `/funding/${id}?check=again`, ...extra });

function Dashboard({ exclude = null }) {
  const pinned = usePinned("b1");
  return <MemoryRouter><PinnedCards pinned={pinned} excludeId={exclude} /><Where /></MemoryRouter>;
}
const serve = (items) => vi.spyOn(client, "apiRequest").mockImplementation(async (path, method) => (method === "GET" ? { items, more: 0 } : {}));

describe("pinned items on the dashboard", () => {
  it("funding and launch are two identical strips, each with exactly one visible button and a ⋯ menu", async () => {
    serve([item("fc1", "₦5m loan for 2 more washing bays", { score: 38, to_do: 6 }), item("lp1", "Mobile car wash in Abuja", { kind: "launch", open: "/launch/lp1" })]);
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(container.querySelectorAll("[data-pinned-card]").length).toBe(2));
    const [funding, launch] = container.querySelectorAll("[data-pinned-card]");
    expect(funding.className).toBe(launch.className);      // the same strip
    for (const strip of [funding, launch]) {
      const visible = [...strip.querySelectorAll("button")].filter((b) => !b.hasAttribute("data-strip-menu"));
      expect(visible.map((b) => b.textContent)).toEqual(["Open"]);
      expect(strip.querySelector("[data-strip-menu]")).toBeTruthy();
      expect(strip.textContent).not.toMatch(/Pinned/);
      expect(strip.querySelector("[data-unpin]")).toBeNull();      // Unpin lives in the menu
      expect(strip.className).toContain("rounded-2xl");
      expect(strip.className).toContain("p-5");
      expect(strip.textContent).not.toMatch(/[–—]/);
    }
    expect(funding.querySelector("[data-strip-title]").getAttribute("title")).toBe("₦5m loan for 2 more washing bays");
    expect(funding.querySelector("[data-pinned-score]").textContent).toBe("38/100 · 6 things to do");
    expect(launch.querySelector("[data-pinned-score]").textContent).toBe("Not checked yet");
    // Which is which, said on each strip.
    expect(funding.querySelector("[data-strip-kind]").textContent).toBe("Funding readiness");
    expect(launch.querySelector("[data-strip-kind]").textContent).toBe("Launch readiness");
    expect(container.querySelector("[data-pinned]").className).toContain("gap-3");
  });

  it("Open goes to the case; the menu holds Unpin, Run the check again and Edit answers", async () => {
    const call = serve([item("fc2", "Second site")]);
    const { container } = render(<Dashboard />);
    const strip = await waitFor(() => { const el = container.querySelector("[data-pinned-card='fc2']"); expect(el).toBeTruthy(); return el; });
    await act(async () => { fireEvent.click(within(strip).getByRole("button", { name: "Open" })); });
    expect(screen.getByTestId("where").textContent).toBe("/funding/fc2");
    await act(async () => { fireEvent.click(strip.querySelector("[data-strip-menu]")); });
    expect(within(strip).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Unpin", "Run the check again", "Edit answers"]);
    await act(async () => { fireEvent.click(within(strip).getByRole("menuitem", { name: "Edit answers" })); });
    expect(screen.getByTestId("where").textContent).toBe("/funding/fc2?tab=answers");
    await act(async () => { fireEvent.click(strip.querySelector("[data-strip-menu]")); });
    await act(async () => { fireEvent.click(within(strip).getByRole("menuitem", { name: "Unpin" })); });
    expect(call).toHaveBeenCalledWith("/businesses/b1/pinned/fc2/unpin", "POST", {});
  });

  it("the result card's case is never shown twice; more than three show View all", async () => {
    serve([item("a", "A"), item("b", "B"), item("c", "C"), item("d", "D"), item("fc1", "Result")]);
    const { container } = render(<Dashboard exclude="fc1" />);
    await waitFor(() => expect(container.querySelectorAll("[data-pinned-card]").length).toBe(3));
    expect(container.querySelector("[data-pinned-card='fc1']")).toBeNull();
    expect(screen.getByRole("button", { name: "View all pinned (4)" })).toBeTruthy();
  });

  it("says the status in one line", () => {
    expect(stripStatus(38, 6)).toBe("38/100 · 6 things to do");
    expect(stripStatus(38, 1)).toBe("38/100 · 1 thing to do");
    expect(stripStatus(null, 6)).toBe("Not checked yet");
  });
});
