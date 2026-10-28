// The owner's test report, 27 Oct: a dashboard question was saved into the funding case's thread and wiped it (1); a message
// handed to the panel showed an older thread, stuck on "Thinking…", its reply landing in the old thread (2); the idea page
// and the panel both answered the same message (3).
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const store = { items: [], chats: {}, slow: null };
vi.mock("../lib/agent", async () => {
  const real = await vi.importActual("../lib/agent");
  return { ...real, submitAgentRequest: vi.fn(async ({ text }) => ({ kind: "answer", message: `Reply to: ${text}`, actions: [] })), saveChat: vi.fn(async () => ({})),
    listChats: vi.fn(async () => { if (store.slow) await store.slow; return { items: store.items }; }), getChat: vi.fn(async (_b, id) => store.chats[id]) };
});
import { getChat, saveChat, submitAgentRequest } from "../lib/agent";
import BusinessAssistant, { isModuleThread } from "./BusinessAssistant";
import { useWorkspaceStore } from "../store/workspace";

const recent = new Date(Date.now() - 2 * 60 * 1000).toISOString();
beforeEach(() => { useWorkspaceStore.setState({ workspaceId: "b1", workspaceName: "Acme" }); vi.clearAllMocks(); store.slow = null; });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); try { localStorage.removeItem("ea_panel_open"); } catch { /* fine */ } });

it("never restores or writes over a module's thread (1)", async () => {
  expect(isModuleThread("case-123")).toBe(true);
  expect(isModuleThread("idea-check")).toBe(true);
  expect(isModuleThread("c1abc")).toBe(false);
  store.items = [{ id: "case-f1", title: "I need funding", at: recent }];
  store.chats = { "case-f1": { id: "case-f1", messages: [{ role: "user", content: "I need funding" }, { role: "assistant", content: "You're at 40/100." }] } };
  try { localStorage.setItem("ea_panel_open", "1"); } catch { /* fine */ }
  const { toSidePanel } = await vi.importActual("../lib/agent");
  render(<MemoryRouter><BusinessAssistant /></MemoryRouter>);
  await waitFor(() => expect(getChat).not.toHaveBeenCalled());
  expect(screen.queryByText("You're at 40/100.")).toBeNull();
  await act(async () => { toSidePanel("So, am I ready to launch my new service?"); });
  expect(await screen.findByText("Reply to: So, am I ready to launch my new service?")).toBeTruthy();
  await waitFor(() => expect(saveChat).toHaveBeenCalled());
  expect(saveChat.mock.calls.every(([, id]) => !isModuleThread(id))).toBe(true);
});

it("a handed-over message starts its own thread, even when an older one finishes loading after it (2)", async () => {
  let release;
  store.slow = new Promise((r) => { release = r; });
  store.items = [{ id: "c1old", title: "Is my idea worth it?", at: recent }];
  store.chats = { c1old: { id: "c1old", messages: [{ role: "user", content: "Is my idea worth it?" }, { role: "assistant", content: "Fair, 57/100." }] } };
  window.history.replaceState(null, "", "/dashboard?chat=Am%20I%20ready%20to%20launch%3F");
  render(<MemoryRouter><BusinessAssistant /></MemoryRouter>);
  expect((await screen.findAllByText("Am I ready to launch?")).length).toBeGreaterThan(0);      // shown at once
  await act(async () => { release(); });
  expect(await screen.findByText("Reply to: Am I ready to launch?")).toBeTruthy();
  expect(screen.queryByText("Fair, 57/100.")).toBeNull();      // never swapped for the older thread
  const ids = new Set(saveChat.mock.calls.map(([, id]) => id));
  expect(ids.has("c1old")).toBe(false);
});

it("a page with its own assistant answers its own message: the panel leaves it alone (3)", async () => {
  window.history.replaceState(null, "", "/check/idea?tab=assistant&chat=Is%20it%20worth%20launching%3F");
  render(<MemoryRouter><BusinessAssistant /></MemoryRouter>);
  await new Promise((r) => setTimeout(r, 30));
  expect(submitAgentRequest).not.toHaveBeenCalled();
});

it("the floating button opens the Agent Centre, the one general chat, and is hidden there and on pages with their own (the owner, 27 Oct)", async () => {
  const { AgentLauncher, hasOwnChat } = await import("./BusinessAssistant");
  const { Routes, Route, useLocation } = await import("react-router-dom");
  expect(hasOwnChat("/funding/abc")).toBe(true);
  expect(hasOwnChat("/launch/abc")).toBe(true);
  expect(hasOwnChat("/check/idea")).toBe(true);
  expect(hasOwnChat("/launch", "?tab=assistant")).toBe(true);
  expect(hasOwnChat("/dashboard")).toBe(false);
  let at = "";
  const Where = () => { const l = useLocation(); at = `${l.pathname}${l.search}`; return null; };
  render(<MemoryRouter initialEntries={["/dashboard"]}><AgentLauncher /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Ask about your business" }));
  await waitFor(() => expect(at).toBe("/agent"));
  expect(screen.queryByRole("button", { name: "Ask about your business" })).toBeNull();      // not on the Agent Centre itself
  cleanup();
  render(<MemoryRouter initialEntries={["/funding/abc?tab=assistant"]}><AgentLauncher /></MemoryRouter>);
  expect(screen.queryByRole("button", { name: "Ask about your business" })).toBeNull();
});

it("a message handed over from anywhere goes on in the Agent Centre", async () => {
  const { AgentLauncher } = await import("./BusinessAssistant");
  const { Routes, Route, useLocation } = await import("react-router-dom");
  const { toSidePanel } = await vi.importActual("../lib/agent");
  let at = "";
  const Where = () => { const l = useLocation(); at = `${l.pathname}${l.search}`; return null; };
  render(<MemoryRouter initialEntries={["/dashboard"]}><AgentLauncher /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
  let taken;
  await act(async () => { taken = toSidePanel("create an invoice for Mark"); });
  expect(taken).toBe(true);
  await waitFor(() => expect(at).toBe("/agent?chat=create%20an%20invoice%20for%20Mark"));
});
