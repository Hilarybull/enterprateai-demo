import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  apiRequest: vi.fn(async (path) => (path === "/auth/login" ? { access_token: "tok" } : {})),
  apiRequestCached: vi.fn(async () => null),
  clearSessionCache: vi.fn(),
  sessionGet: vi.fn(async () => ({ email: "b@x.test" })),
}));

import { useAuthStore } from "./auth";
import { useWorkspaceStore } from "./workspace";
import { continueConversation, getConversation } from "../lib/agent";
import { recallDashboard, rememberDashboard } from "../lib/dashboard";

const DASH = { enabled: true, business_id: "biz-a", context: {} };

// New-User Test S1: what one account leaves in the browser, the next never finds
function leaveDataBehind() {
  localStorage.setItem("ea_token", "a-token");
  localStorage.setItem("ea_email", "a@x.test");
  localStorage.setItem("ea_greeted:biz-a", "{}");
  localStorage.setItem("ea_chat_fresh:biz-a", "now");
  localStorage.setItem("ea_blueprint_docs:a", "[{\"title\":\"Plan\"}]");
  localStorage.setItem("ea_task_session:a@x.test", "t1");
  sessionStorage.setItem("ea_review_draft:r1", "{}");
  sessionStorage.setItem("ea:dashboard:last:biz-a", "{}");
  sessionStorage.setItem("ea:agent:conversation:biz-a:a@x.test", "[{}]");
  useWorkspaceStore.setState({ workspaceId: "biz-a", workspaceName: "A Ltd", workspaceOwnerEmail: "a@x.test" });
  useAuthStore.setState({ token: "a-token", email: "a@x.test" });
  continueConversation("biz-a", [{ role: "user", content: "ORCHID-7731" }]);
  rememberDashboard("biz-a", DASH);
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

describe("two accounts on one browser", () => {
  it("a chat and the dashboard are never written to browser storage", () => {
    useAuthStore.setState({ email: "a@x.test" });
    continueConversation("biz-a", [{ role: "user", content: "ORCHID-7731" }]);
    rememberDashboard("biz-a", DASH);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("ORCHID-7731");
    expect(Object.keys(sessionStorage).filter((k) => /dashboard|conversation/.test(k))).toEqual([]);
    expect(getConversation("biz-a")).toHaveLength(1);
    expect(recallDashboard("biz-a")?.business_id).toBe("biz-a");
  });

  it("signing out leaves nothing of the account behind, and keeps the browser's own settings", () => {
    leaveDataBehind();
    localStorage.setItem("ea_theme", "dark");
    localStorage.setItem("ea_cookie_consent", "yes");
    localStorage.setItem("ea_task_session:anon", "someone-signed-out");
    useAuthStore.getState().logout();
    const left = Object.keys(localStorage).filter((k) => k !== "ea_workspace").sort();
    expect(left).toEqual(["ea_cookie_consent", "ea_theme"]);
    expect(Object.keys(sessionStorage)).toEqual([]);
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
    expect(JSON.stringify(localStorage.getItem("ea_workspace") || "")).not.toContain("biz-a");
    useAuthStore.setState({ email: "a@x.test" });
    expect(getConversation("biz-a")).toEqual([]);
    expect(recallDashboard("biz-a")).toBeNull();
  });

  it("another account signing in over the last one, with no sign-out, finds nothing of it", async () => {
    leaveDataBehind();
    localStorage.setItem("ea_browser_owner", "a@x.test");
    localStorage.setItem("ea_task_session:anon", "t-anon");
    await useAuthStore.getState().login("b@x.test", "password");
    expect(localStorage.getItem("ea_greeted:biz-a")).toBeNull();
    expect(localStorage.getItem("ea_task_session:a@x.test")).toBeNull();
    expect(sessionStorage.getItem("ea_review_draft:r1")).toBeNull();
    expect(localStorage.getItem("ea_token")).toBe("tok");
    expect(localStorage.getItem("ea_task_session:anon")).toBe("t-anon");      // not attached by this: the server asks first
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
    expect(recallDashboard("biz-a")).toBeNull();
  });

  it("the same account signing in again keeps its own place", async () => {
    localStorage.setItem("ea_browser_owner", "b@x.test");
    localStorage.setItem("ea_chat_fresh:biz-b", "now");
    await useAuthStore.getState().login("b@x.test", "password");
    expect(localStorage.getItem("ea_chat_fresh:biz-b")).toBe("now");
  });
});

describe("answers from the card they signed in from", () => {
  it("carry on with no question, in that tab only, and go on sign-out", async () => {
    const { cameFromCard, markCardSignIn } = await import("../lib/browserData");
    expect(cameFromCard("s1")).toBe(false);      // left on a shared browser: still asked
    markCardSignIn("s1");
    expect(cameFromCard("s1")).toBe(true);
    expect(cameFromCard("s2")).toBe(false);
    localStorage.setItem("ea_browser_owner", "a@x.test");
    await useAuthStore.getState().login("b@x.test", "password");      // signing in keeps it
    expect(cameFromCard("s1")).toBe(true);
    useAuthStore.getState().logout();
    expect(cameFromCard("s1")).toBe(false);
  });
});
