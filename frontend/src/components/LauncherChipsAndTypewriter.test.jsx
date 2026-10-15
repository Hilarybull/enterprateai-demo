// Goal chips: a click always starts the chip that was under the pointer at pointerdown, whatever has rotated since, and
// each chip opens its own goal. The typewriter animates only the placeholder: the field's value is only ever what was typed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GoalLauncher, { GOALS_EVERY_MS } from "./GoalLauncher";

vi.mock("./GoogleSignInButton", () => ({ default: () => null }));
let posts;
beforeEach(() => {
  posts = []; localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, "", "/");
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const body = init.body ? JSON.parse(init.body) : null;
    if (init.method === "POST" && /\/task-sessions$/.test(path)) posts.push(body);
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const mount = () => render(<MemoryRouter><GoalLauncher /></MemoryRouter>);
const group = () => screen.getByRole("group", { name: "Popular business goals" });
const visibleGoals = () => within(group()).getAllByRole("button").filter((b) => !b.disabled);

describe("goal chips", () => {
  it("each chip opens its own goal", async () => {
    mount();
    for (const chip of visibleGoals().map((b) => b.getAttribute("data-goal"))) {
      const button = group().querySelector(`[data-goal="${chip}"]:not([disabled])`);
      await act(async () => { fireEvent.pointerDown(button); fireEvent.click(button); });
      expect(posts.at(-1)).toMatchObject({ key: chip, entry_mode: "business_goal" });
    }
  });

  it("a click starts the chip under the pointer at pointerdown, even if the set rotated in between", async () => {
    vi.useFakeTimers();
    mount();
    const first = visibleGoals()[0];
    const key = first.getAttribute("data-goal");
    act(() => { fireEvent.pointerDown(first); });
    act(() => { vi.advanceTimersByTime(GOALS_EVERY_MS * 2); });      // paused by the pointerdown: nothing rotates
    expect(visibleGoals()[0].getAttribute("data-goal")).toBe(key);
    await act(async () => { fireEvent.click(first); });
    expect(posts.at(-1)).toMatchObject({ key });
  });

  it("pauses on hover, focus and touch", () => {
    vi.useFakeTimers();
    mount();
    const start = visibleGoals().map((b) => b.textContent);
    for (const hold of [() => fireEvent.mouseEnter(group()), () => fireEvent.focus(visibleGoals()[0]), () => fireEvent.touchStart(group())]) {
      act(hold);
      act(() => { vi.advanceTimersByTime(GOALS_EVERY_MS * 2); });
      expect(visibleGoals().map((b) => b.textContent)).toEqual(start);
    }
  });
});

describe("the typewriter placeholder", () => {
  it("animates only the placeholder, stops on focus, and the goal is sent exactly as typed", async () => {
    vi.useFakeTimers();
    mount();
    const box = screen.getByLabelText("What do you want EnterprateAI to do for your business?");
    act(() => { vi.advanceTimersByTime(1500); });
    expect(box.value).toBe("");
    expect(box.getAttribute("placeholder")).not.toBe("");
    act(() => { fireEvent.focus(box); });
    const still = box.getAttribute("placeholder");
    act(() => { vi.advanceTimersByTime(1500); });
    expect(box.getAttribute("placeholder")).toBe(still);      // stopped on focus
    vi.useRealTimers();
    await act(async () => { fireEvent.change(box, { target: { value: "Help me price my cupcake boxes" } }); });
    await act(async () => { fireEvent.submit(box.closest("form")); });
    expect(posts.at(-1)).toMatchObject({ text: "Help me price my cupcake boxes", entry_mode: "free_text" });
  });
});
