// The owner, 27 Oct: "these should be on the agent chat page, panel": a funding message handed over ("?chat=") opens the
// panel and is sent there, and the Agent's reply is the conversation.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../lib/agent", async () => {
  const real = await vi.importActual("../lib/agent");
  return { ...real, getConversation: () => [], submitAgentRequest: vi.fn(async () => ({ kind: "answer", message: "How much do you need, and what's it for?", actions: [] })) };
});
import { submitAgentRequest } from "../lib/agent";
import BusinessAssistant from "./BusinessAssistant";
import { useWorkspaceStore } from "../store/workspace";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

it("opens with the handed-over message sent, and the address is tidied", async () => {
  useWorkspaceStore.setState({ workspaceId: "b1" });
  window.history.replaceState(null, "", "/dashboard?chat=I%20need%20funding");
  render(<MemoryRouter><BusinessAssistant /></MemoryRouter>);
  expect(await screen.findByText("How much do you need, and what's it for?")).toBeTruthy();
  expect(submitAgentRequest).toHaveBeenCalledWith(expect.objectContaining({ text: "I need funding", businessId: "b1" }));
  expect(document.querySelector("[data-conversation-panel]")).toBeTruthy();
  await waitFor(() => expect(window.location.search).toBe(""));
});

it("a message typed in the dashboard's Agent box is carried on in the side panel (the owner, 27 Oct: 'it should be by the side')", async () => {
  useWorkspaceStore.setState({ workspaceId: "b1" });
  const { toSidePanel } = await vi.importActual("../lib/agent");
  render(<MemoryRouter><BusinessAssistant /></MemoryRouter>);
  let taken;
  await act(async () => { taken = toSidePanel("i need funding"); });
  expect(taken).toBe(true);
  expect(await screen.findAllByText("How much do you need, and what's it for?")).toBeTruthy();
  expect(document.querySelector("[data-conversation-panel]")).toBeTruthy();
});
