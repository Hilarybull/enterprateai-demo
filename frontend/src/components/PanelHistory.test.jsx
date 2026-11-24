// The owner, 27 Oct: "I can't remember asking all these", "hope it stores history conversations too", "it should also bring the
// current chat to view", "why is the chat name E2E Car Wash Abuja".
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const store = { items: [], chats: {} };
vi.mock("../lib/agent", async () => {
  const real = await vi.importActual("../lib/agent");
  return { ...real, submitAgentRequest: vi.fn(), saveChat: vi.fn(async () => ({})),
    listChats: vi.fn(async () => ({ items: store.items })), getChat: vi.fn(async (_b, id) => store.chats[id]) };
});
import BusinessAssistant from "./BusinessAssistant";
import { useWorkspaceStore } from "../store/workspace";

// Opened by its button: it is closed on every load (the owner's test, 27 Oct)
const mountOpen = () => render(<MemoryRouter><BusinessAssistant /></MemoryRouter>);      // the Agent Centre's chat, always open
const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const old = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
beforeEach(() => {
  useWorkspaceStore.setState({ workspaceId: "b1", workspaceName: "E2E Car Wash Abuja" });
  try { localStorage.setItem("ea_panel_open", "1"); } catch { /* fine */ }
});
afterEach(() => { cleanup(); try { localStorage.removeItem("ea_panel_open"); } catch { /* fine */ } });

it("reopens the current conversation, named for itself, and History opens an earlier one", async () => {
  store.items = [{ id: "now1", title: "How ready am I for funding?", at: recent }, { id: "old1", title: "Create an invoice for Mark", at: old }];
  store.chats = { now1: { id: "now1", messages: [{ role: "user", content: "How ready am I for funding?" }, { role: "assistant", content: "80 so far." }] },
    old1: { id: "old1", messages: [{ role: "user", content: "Create an invoice for Mark" }, { role: "assistant", content: "It's in Needs Approval." }] } };
  mountOpen();
  expect(await screen.findByText("80 so far.")).toBeTruthy();
  expect(screen.getAllByText("How ready am I for funding?").length).toBeGreaterThan(0);      // the header names the conversation
  expect(screen.queryByText("E2E Car Wash Abuja")).toBeNull();
  await act(async () => { fireEvent.click(document.querySelector("[data-chat-history-button]")); });
  await act(async () => { fireEvent.click(document.querySelector("[data-chat-item='old1']")); });
  expect(await screen.findByText("It's in Needs Approval.")).toBeTruthy();
  expect(screen.queryByText("80 so far.")).toBeNull();
});

it("the last conversation is brought back on load, however long ago it was", async () => {
  // The owner's QA, 27 Oct: "the chat is lost after a page reload. Restore the last conversation on load"; "+" starts a new one
  store.items = [{ id: "old1", title: "Create an invoice for Mark", at: old }];
  mountOpen();
  expect(await screen.findByText("It's in Needs Approval.")).toBeTruthy();
});

it("closes the conversation list with its Back button", async () => {
  const { default: BusinessAssistant } = await import("./BusinessAssistant");
  const { MemoryRouter } = await import("react-router-dom");
  const { render: draw, screen: s, fireEvent: fire, act: run } = await import("@testing-library/react");
  await run(async () => { draw(<MemoryRouter><BusinessAssistant /></MemoryRouter>); });
  await run(async () => { fire.click(document.querySelector("[data-chat-history-button]")); });
  const back = await s.findByRole("button", { name: /Back to the conversation/ });
  await run(async () => { fire.click(back); });
  expect(document.querySelector("[data-chat-history]")).toBeNull();
});
