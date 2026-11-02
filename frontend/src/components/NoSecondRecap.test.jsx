import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GoalLauncher from "./GoalLauncher";
import { useAuthStore } from "../store/auth";

vi.mock("./GoogleSignInButton", () => ({ default: () => null }));

// The owner, 2 Nov: "the recap is not supposed to show... I already recaped and confirmed on the landing page"
const Q = (key, label, def) => ({ key, label, type: "text", required: true, default: def, proposed: true });
const session = (over) => ({ id: "sess-1", state: "collecting_context", entry_mode: "free_text", goal_key: "need_funding", goal_label: "Funding", next: "questions", currency: "NGN",
  resolution: { original_goal: "I need funding", resolution_class: "direct", message: "", recommended_path: [] }, questions: [Q("amount", "How much?", "10000000"), Q("use", "For what?", "stock")],
  summary: [{ key: "amount", label: "How much?", value: "₦10m", proposed: true, from_message: true }, { key: "use", label: "For what?", value: "stock", proposed: true, from_message: true }],
  proposed: { amount: 10000000, use: "stock" }, inputs: {}, missing: [], authenticated: false, retention_days: 7, ...over });

let calls;
beforeEach(() => {
  calls = [];
  localStorage.clear();
  sessionStorage.clear();
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method || "GET", body });
    const out = init.method === "POST" && /task-sessions$/.test(path) ? session() : init.method === "POST" && /\/inputs$/.test(path) ? session({ next: "identity", proposed: {} }) : {};
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); useAuthStore.setState({ token: null, email: null }); window.history.replaceState({}, "", "/"); });

async function say() {
  render(<MemoryRouter><GoalLauncher /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("What do you want EnterprateAI to do for your business?"), { target: { value: "I need funding: ₦10m for stock" } });
  await act(async () => { fireEvent.click(document.querySelector("[data-goal-launcher] form button[type='submit']")); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
}

it("signed in, what was said is used as said, with no summary to confirm", async () => {
  useAuthStore.setState({ token: "tok-1", email: "owner@example.test" });
  localStorage.setItem("ea_token", "tok-1");
  await say();
  expect(document.querySelector("[data-summary]")).toBeNull();
  expect(calls.find((c) => /\/inputs$/.test(c.path))?.body?.confirm).toBe(true);
});

it("signed out on the landing page, the one confirmation is still there", async () => {
  await say();
  expect(document.querySelector("[data-summary]")).toBeTruthy();
  expect(calls.find((c) => /\/inputs$/.test(c.path))).toBeUndefined();
});
