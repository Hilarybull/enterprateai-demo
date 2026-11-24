import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import GoalLauncher from "../components/GoalLauncher";
import AgentCentrePage from "./AgentCentrePage";
import { useWorkspaceStore } from "../store/workspace";
import { useAuthStore } from "../store/auth";

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });
function AgentRoute() {
  const location = useLocation();
  window.history.replaceState(null, "", location.pathname + location.search);
  return <AgentCentrePage />;
}

it("lets the owner dismiss a task-list failure without clearing the conversation", async () => {
  localStorage.setItem("ea_token", "test");
  useAuthStore.setState({ token: "test", email: "owner@example.test" });
  useWorkspaceStore.setState({ workspaceId: "business", workspaceName: "Apex Consulting" });
  globalThis.fetch = vi.fn(async url => new Response(JSON.stringify(/workflow-runs/.test(String(url)) ? { detail: "busy" } : {}),
    { status: /workflow-runs/.test(String(url)) ? 503 : 200, headers: { "Content-Type": "application/json" } }));
  render(<MemoryRouter initialEntries={["/agent"]}><AgentCentrePage /></MemoryRouter>);
  const dismiss = await screen.findByRole("button", { name: "Dismiss task list notice" });
  fireEvent.click(dismiss);
  expect(screen.queryByRole("button", { name: "Dismiss task list notice" })).toBeNull();
  expect(screen.getByPlaceholderText(/Ask EnterprateAI anything/)).toBeTruthy();
});

it("carries signed landing answers to the real agent chat while unrelated sidebar requests are slow", async () => {
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem("ea_token", "test");
  useAuthStore.setState({ token: "test", email: "owner@example.test" });
  useWorkspaceStore.setState({ workspaceId: "business", workspaceName: "Apex Consulting", currency: "GBP" });
  const calls = [];
  let finishReply;
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, body, method: init.method || "GET" });
    if (/\/task-sessions$/.test(path)) return json({ id: "landing", goal_key: "need_funding", goal_label: "I need funding", next: "identity", authenticated: true,
      business_id: "business", currency: "GBP", missing: [], questions: [], proposed: {}, summary: [],
      inputs: { amount: 10000, use: "food", route: "loan", timing: "Within 3 months", stage: "Trading", traction: "3 customers" },
      resolution: { original_goal: "I need funding", resolution_class: "composite_goal" } });
    if (/\/agent\/requests$/.test(path)) return json({ kind: "pending_reply", job_id: "one-handover" });
    if (/\/agent\/replies\/one-handover$/.test(path)) return new Promise(resolve => { finishReply = () => resolve(json({ state: "complete", result: { kind: "answer", message: "I've kept your funding answers. Let's continue here." } })); });
    if (/\/agent\/summary$/.test(path)) return json({ needs_approval_count: 2, needs_approval: [] });
    if (/\/workflow-runs/.test(path)) return json({ items: [], total: 0, counts: { active: 1 } });
    if (/assistant-context\?kind=funding/.test(path)) return json({ business: { name: "Apex Consulting", location: "Toronto" }, activity: [] });
    if (/agent\/documents|launch-initiatives/.test(path)) return new Promise(() => {});
    return json({});
  });
  render(<MemoryRouter initialEntries={["/"]}><Routes><Route path="/" element={<GoalLauncher />} /><Route path="/agent" element={<AgentRoute />} /></Routes></MemoryRouter>);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "I need funding" })); });
  await waitFor(() => expect(document.querySelector("[data-recap-ok]") || document.querySelector("[data-agent-page]")).toBeTruthy());
  if (document.querySelector("[data-recap-ok]")) await act(async () => { fireEvent.click(document.querySelector("[data-recap-ok]")); });
  await waitFor(() => expect(finishReply).toBeTypeOf("function"));
  expect(screen.getByText("Thinking…")).toBeTruthy();
  expect(document.querySelector("[data-chat-skeleton]")).toBeNull();
  expect(screen.getByText("Toronto")).toBeTruthy();
  const requests = calls.filter(call => /\/agent\/requests$/.test(call.path));
  expect(requests).toHaveLength(1);
  expect(requests[0].body.text).toContain("GBP 10,000 for food");
  expect(requests[0].body.text).toContain("within 3 months");
  expect(requests[0].body.text).toContain("3 customers");
  expect(requests[0].body.defer_reply).toBe(true);
  expect(calls.some(call => /\/(prepare|resume|attach-user)$/.test(call.path))).toBe(false);
  await act(async () => { finishReply(); });
  expect(await screen.findByText("I've kept your funding answers. Let's continue here.")).toBeTruthy();
});
