// Loading states: a skeleton shaped like the page while its request is pending, then the real
// content in the same container, and a card with "Try again" when the request fails.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  AgentRunSkeleton, DashboardSkeleton, LoadError, ReadinessDetailSkeleton, SLOW_TEXT, SettingsSkeleton, ShellSkeleton, SkeletonBlock, SkeletonCard,
  SkeletonKpi, SkeletonRegion, SkeletonTable, SkeletonText,
} from "./Skeleton";
import { QuestionForm } from "./agent/AgentBits";
import AgentRunPage from "../pages/AgentRunPage";
import ReadinessPage from "../pages/ReadinessPage";
import { useWorkspaceStore } from "../store/workspace";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

/** A request that stays pending until the test settles it. */
function held() {
  let settle;
  const promise = new Promise((resolve) => { settle = resolve; });
  const json = (body, status = 200) => settle(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  return { promise, json };
}

describe("the shared skeleton shapes", () => {
  it("draws blocks, text, cards, tables and KPI tiles from one grey shape, hidden from screen readers", () => {
    const { container } = render(<div>
      <SkeletonBlock className="h-4 w-10" /><SkeletonText lines={3} /><SkeletonCard /><SkeletonKpi />
      <SkeletonTable rows={5} widths={["7rem", "minmax(0,1fr)", "6rem"]} /></div>);
    expect(container.querySelectorAll(".ea-skeleton").length).toBeGreaterThan(10);
    expect([...container.querySelectorAll(".ea-skeleton")].every((el) => el.closest("[aria-hidden='true']"))).toBe(true);
    const rows = container.querySelectorAll("[data-skeleton-row]");
    expect(rows.length).toBe(6);                                          // a header line and five rows
    expect(rows[1].style.gridTemplateColumns).toBe("7rem minmax(0,1fr) 6rem");      // the real column widths
    expect(container.querySelector(".h-\\[124px\\]")).toBeTruthy();        // a KPI tile is the height of a real one
  });

  it("uses the app's soft grey with a 1.2s shimmer, and stays still when motion is reduced", () => {
    expect(css).toMatch(/\.ea-skeleton\s*\{[^}]*background-color:\s*#EEF0F6;[^}]*animation:\s*ea-shimmer 1\.2s/s);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.ea-skeleton\s*\{\s*animation:\s*none;\s*background-image:\s*none;/);
  });

  it("marks the loading region busy with a hidden label, and says so when it is slow", () => {
    vi.useFakeTimers();
    render(<SkeletonRegion label="launch plan"><SkeletonText /></SkeletonRegion>);
    const region = screen.getByRole("status", { name: "Loading launch plan" });
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(within(region).getByText("Loading launch plan").className).toContain("sr-only");
    expect(screen.queryByText(SLOW_TEXT)).toBeNull();
    act(() => { vi.advanceTimersByTime(7900); });
    expect(screen.queryByText(SLOW_TEXT)).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText("Still loading. This is taking longer than usual.")).toBeTruthy();
  });

  it("replaces the skeleton with a card and 'Try again' when the load failed", () => {
    const again = vi.fn();
    render(<LoadError what="your launch plan" onRetry={again} />);
    expect(screen.getByRole("alert").textContent).toContain("We couldn't load your launch plan.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("shapes each page's skeleton like the page", () => {
    const part = (root, name) => root.querySelectorAll(`[data-part='${name}']`);
    let view = render(<ReadinessDetailSkeleton label="launch plan" />);
    expect(part(view.container, "header").length).toBe(1);
    expect(part(view.container, "ring").length).toBe(1);
    expect(part(view.container, "checklist")[0].querySelectorAll("[data-skeleton-row]").length).toBe(6);
    expect(part(view.container, "side")[0].children.length).toBe(3);
    view.unmount();
    view = render(<AgentRunSkeleton />);
    expect(part(view.container, "box").length).toBe(2);                   // What happened / What happens next
    expect(part(view.container, "action").length).toBe(1);
    expect(part(view.container, "plan")[0].querySelectorAll("[data-skeleton-row]").length).toBe(3);
    view.unmount();
    view = render(<DashboardSkeleton />);
    expect(part(view.container, "tile").length).toBe(4);
    expect(part(view.container, "ask").length).toBe(1);
    expect(part(view.container, "approvals")[0].querySelectorAll("[data-skeleton-row]").length).toBe(3);
    expect(part(view.container, "stage")[0].children.length).toBe(3);
    expect(part(view.container, "kpis")[0].children.length).toBe(5);
    expect(part(view.container, "insights")[0].children.length).toBe(4);
    expect(view.container.querySelector("button, a")).toBeNull();          // nothing to click while loading
    view.unmount();
    render(<SettingsSkeleton />);
    expect(screen.getByRole("status", { name: "Loading Agent settings" })).toBeTruthy();
  });

  it("starts the app as the shell with skeletons and a progress bar, not a centred spinner", () => {
    const { container } = render(<ShellSkeleton />);
    expect(screen.getByRole("progressbar", { name: "Loading EnterprateAI" })).toBeTruthy();
    expect(container.querySelector("aside")).toBeTruthy();                // the sidebar's place
    expect(container.querySelector("[data-part='workspace']")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading your dashboard" })).toBeTruthy();
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(screen.queryByText(/^Loading(\.\.\.|…)$/)).toBeNull();
  });

  it("keeps a working button's label, with a spinner inside it, and disables it", () => {
    render(<QuestionForm question="Q" fields={[{ key: "a", label: "A", type: "text" }]} submitting onSubmit={() => {}} />);
    const button = screen.getByRole("button", { name: "Working…" });
    expect(button.disabled).toBe(true);
    expect(button.querySelector("[data-button-spinner]")).toBeTruthy();
  });
});

const RUN = {
  run: { id: "run-1", family: "Sell & Revenue", title: "Enquiry to Quote", goal: "Prepare a quotation", status: "running", summary: "The task has started.",
    steps_planned: [{ key: "classify", title: "Classify the enquiry" }, { key: "customer", title: "Match the customer" }], current_step: "customer", refs: {}, credits_used: 0 },
  steps: [], step_attempts: [], approvals: [], history: [], can: {},
};

describe("the Agent task page", () => {
  beforeEach(() => { localStorage.setItem("ea_token", "test"); });
  const mount = () => render(<MemoryRouter initialEntries={["/agent/runs/run-1"]}><Routes><Route path="/agent/runs/:runId" element={<AgentRunPage />} /></Routes></MemoryRouter>);

  it("shows its skeleton while the task is loading, then the task in the same container", async () => {
    const request = held();
    globalThis.fetch = vi.fn(() => request.promise);
    const { container } = mount();
    const skeleton = screen.getByRole("status", { name: "Loading this task" });
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
    const frame = skeleton.className;
    expect(frame).toContain("mx-auto max-w-4xl space-y-5");
    expect(screen.queryByText("Enquiry to Quote")).toBeNull();
    await act(async () => { request.json(RUN); });
    expect(await screen.findByText("Enquiry to Quote")).toBeTruthy();
    expect(container.querySelector("[aria-busy]")).toBeNull();            // busy goes when the content arrives
    expect(container.firstElementChild.className).toBe(frame);            // same width and spacing: nothing jumps sideways
    expect(screen.getByText("What happened")).toBeTruthy();
  });

  it("shows a card with 'Try again' when the task can't be loaded, and loads it on a second go", async () => {
    let fail = true;
    globalThis.fetch = vi.fn(async () => (fail
      ? new Response(JSON.stringify({ detail: "Server error" }), { status: 500, headers: { "Content-Type": "application/json" } })
      : new Response(JSON.stringify(RUN), { status: 200, headers: { "Content-Type": "application/json" } })));
    mount();
    expect((await screen.findByRole("alert")).textContent).toContain("We couldn't load this task.");
    expect(screen.queryByRole("status", { name: "Loading this task" })).toBeNull();      // never an endless skeleton
    fail = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(await screen.findByText("Enquiry to Quote")).toBeTruthy();
  });
});

describe("launch plans and funding cases", () => {
  beforeEach(() => { localStorage.setItem("ea_token", "test"); useWorkspaceStore.setState({ workspaceId: "ws1" }); });
  const mount = (path, feature = "launch") => render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path={`/${feature}`} element={<ReadinessPage feature={feature} />} />
    <Route path={`/${feature}/:subjectId`} element={<ReadinessPage feature={feature} />} /></Routes></MemoryRouter>);

  it("shows the launch plan's skeleton while it loads, and the error card when it can't be loaded", async () => {
    const request = held();
    globalThis.fetch = vi.fn(() => request.promise);
    mount("/launch/l1");
    const skeleton = screen.getByRole("status", { name: "Loading launch plan" });
    expect(skeleton.querySelectorAll("[data-part='checklist'] [data-skeleton-row]").length).toBe(6);
    expect(screen.queryByText(/^Loading(\.\.\.|…)$/)).toBeNull();
    await act(async () => { request.json({ detail: "Server error" }, 500); });
    expect((await screen.findByRole("alert")).textContent).toContain("We couldn't load your launch plan.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading launch plan" })).toBeNull();
  });

  it("shows five placeholder rows for the list, then the list", async () => {
    const request = held();
    globalThis.fetch = vi.fn(() => request.promise);
    mount("/funding", "funding");
    const skeleton = screen.getByRole("status", { name: "Loading your funding cases" });
    expect(skeleton.querySelectorAll("[data-skeleton-row]").length).toBe(5);
    await act(async () => { request.json({ enabled: true, can: {}, items: [{ id: "f1", title: "Seed round", status: "draft", target_amount: 50000, currency: "GBP", summary: {} }] }); });
    expect(await screen.findByText("Seed round")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading your funding cases" })).toBeNull();
  });
});
