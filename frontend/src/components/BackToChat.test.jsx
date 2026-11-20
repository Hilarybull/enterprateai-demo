import React from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BackToChat from "./BackToChat";
import { cameFrom, noteCameFrom } from "../lib/cameFrom";

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/agent");
});
afterEach(cleanup);
function at(path) { render(<MemoryRouter initialEntries={[path]}><BackToChat /></MemoryRouter>); }

test("a page opened from the agent offers a return to that conversation", () => {
  noteCameFrom("conversation-7", "/integrations");
  at("/integrations");
  expect(screen.getByRole("link", { name: "Return to agent" }).getAttribute("href")).toBe("/agent");
  expect(cameFrom().chat).toBe("conversation-7");
});

test("the integration callback retains the return action", () => {
  noteCameFrom("conversation-7", "/integrations");
  at("/integrations/callback?provider=xero&status=connected");
  expect(screen.getByRole("link", { name: "Return to agent" })).toBeTruthy();
  expect(cameFrom().chat).toBe("conversation-7");
});

test("returning hides the button but preserves the conversation ID for restoration", () => {
  noteCameFrom("conversation-7", "/integrations");
  at("/agent");
  expect(screen.queryByRole("link")).toBeNull();
  expect(cameFrom().chat).toBe("conversation-7");
});

test("visiting an unrelated page does not show a stale return action", () => {
  noteCameFrom("conversation-7", "/integrations");
  at("/catalogue");
  expect(screen.queryByRole("link")).toBeNull();
  expect(cameFrom()).toBeNull();
});
