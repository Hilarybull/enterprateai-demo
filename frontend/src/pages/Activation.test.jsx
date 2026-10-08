// Activation emails, as people meet them: the unsubscribe and preference pages, the switch in
// account settings, the sign-up choice, and the administrator's view of the journeys.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import EmailPreferencesPage, { TipsPrompt, TipsSwitch, UnsubscribePage } from "./EmailPreferencesPage";
import AccountSettings, { EmailSection, PlanSection, PrivacySection, ProfileSection, SecuritySection } from "./AccountSettings";
import ActivationAdmin from "../components/admin/ActivationAdmin";
import LoginPage from "./LoginPage";
import { useAuthStore } from "../store/auth";

let calls;
let routes;
beforeEach(() => {
  calls = [];
  routes = [];
  localStorage.clear();
  sessionStorage.clear();
  useAuthStore.setState({ token: null, email: null, hydrated: true });
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "").replace(/^.*?(\/email\/|\/auth\/|\/admin\/|\/credits\/)/, "$1");
    const method = init.method || "GET";
    const call = { method, path, body: typeof init.body === "string" ? JSON.parse(init.body) : null };
    calls.push(call);
    const hit = routes.find((r) => r.method === method && r.match.test(path.split("?")[0]));
    const out = await (hit ? hit.reply(call) : { status: 404, body: { detail: "Not found." } });
    if (out.status === 204) return new Response(null, { status: 204 });      // "no content" really has none
    return new Response(JSON.stringify(out.body), { status: out.status || 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
if (!globalThis.ResizeObserver) globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };      // the sign-in page measures itself
const mount = (path, element) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={element} /></Routes></MemoryRouter>);
const sent = (method, re) => calls.filter((c) => c.method === method && re.test(c.path));

describe("unsubscribing and preferences", () => {
  it("unsubscribes on one click, without signing in, and says what is not affected", async () => {
    routes = [{ method: "POST", match: /^\/email\/unsubscribe$/, reply: () => ({ body: { ok: true, message: "You won't receive any more tips from EnterprateAI. Messages about your account, such as password resets, are not affected." } }) }];
    mount("/email/unsubscribe?token=tok.abc", <UnsubscribePage />);
    expect(sent("POST", /unsubscribe/).length).toBe(0);                    // opening the page (or a link scanner doing so) changes nothing
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    await screen.findByRole("heading", { name: "You're unsubscribed" });
    expect(sent("POST", /unsubscribe/)[0].path).toBe("/email/unsubscribe?token=tok.abc");
    expect(screen.getByText(/You won't receive any more tips/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Email preferences/ }).getAttribute("href")).toBe("/email/preferences?token=tok.abc");
  });

  it("says so when the link isn't valid", async () => {
    mount("/email/unsubscribe?token=bad", <UnsubscribePage />);
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect((await screen.findByText("This link isn't valid any more.")).getAttribute("role")).toBe("alert");
  });

  it("the preference page has one switch, and a stopped address can't be switched back on from it", async () => {
    let prefs = { email: "ada@example.test", product_tips: false, status: "unsubscribed", can_resubscribe: true };
    routes = [{ method: "GET", match: /^\/email\/preferences$/, reply: () => ({ body: prefs }) },
      { method: "PUT", match: /^\/email\/preferences$/, reply: ({ body }) => { prefs = { ...prefs, product_tips: body.product_tips, status: body.product_tips ? "subscribed" : "unsubscribed" }; return { body: prefs }; } }];
    mount("/email/preferences?token=tok.abc", <EmailPreferencesPage />);
    const box = await screen.findByRole("switch", { name: "Getting-started guides and product tips" });
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    await screen.findByText("Saved. You'll receive tips.");
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(sent("PUT", /preferences/)[0]).toMatchObject({ path: "/email/preferences?token=tok.abc", body: { product_tips: true } });
    expect(screen.getByText(/Messages about your account, such as password resets and receipts, are not affected/)).toBeTruthy();
    cleanup();
    prefs = { product_tips: false, status: "suppressed", can_resubscribe: false };
    mount("/email/preferences?token=tok.abc", <EmailPreferencesPage />);
    expect((await screen.findByRole("switch", { name: /Getting-started guides/ })).disabled).toBe(true);
    expect(screen.getByText(/couldn't be delivered or was reported/)).toBeTruthy();
    cleanup();
    mount("/email/preferences", <EmailPreferencesPage />);
    expect(screen.getByText(/Open this page from the link in one of our emails/)).toBeTruthy();
  });

  it("a signed-in person has the same switch in their account, with no token", async () => {
    useAuthStore.setState({ token: "t", email: "ada@example.test", hydrated: true });
    routes = [{ method: "GET", match: /^\/auth\/me\/email-preferences$/, reply: () => ({ body: { product_tips: true, status: "subscribed", can_resubscribe: true } }) },
      { method: "PUT", match: /^\/auth\/me\/email-preferences$/, reply: ({ body }) => ({ body: { product_tips: body.product_tips, status: "unsubscribed", can_resubscribe: true } }) }];
    mount("/", <TipsSwitch />);
    const box = await screen.findByRole("switch", { name: "Getting-started guides and product tips" });
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);
    await screen.findByText("Saved. You won't receive tips.");
    expect(sent("PUT", /email-preferences/)[0].body).toEqual({ product_tips: false });
  });
});

describe("sign-up", () => {
  it("offers tips as an optional choice that starts unticked", async () => {
    mount("/login?signup=1", <LoginPage />);
    const box = await screen.findByLabelText(/Send me getting-started guides and product tips by email/);
    expect(box.checked).toBe(false);
    expect(box.required).toBe(false);
    expect(box.closest("label").textContent).toContain("you can unsubscribe at any time");
    cleanup();
    mount("/login", <LoginPage />);
    await waitFor(() => expect(screen.queryByLabelText(/Send me getting-started guides/)).toBeNull());      // only when creating an account
  });
});

describe("administrator view", () => {
  const board = (over = {}) => ({ config: { enabled: true, dry_run: true, cohort: "internal", internal_accounts: 2, sample_percent: 10, holdout_percent: 10, one_click_unsubscribe: false },
    eligible_users: 12, no_permission_recorded: 340, eligible_without_workspace: 5,
    steps: [{ step: "a1", journey: "A", subject: "Create your EnterprateAI workspace", scheduled: 3, sent: 9, delivered: 8, bounced: 1, complained: 0, cancelled: 2, holdout: 1, failed: 0 }],
    emailed: { users: 10, workspace_7d: 4, workspace_14d: 5, first_task_14d: 2 }, holdout: { users: 4, workspace_7d: 1, workspace_14d: 1, first_task_14d: 0 },
    guardrails: { unsubscribed: 1, suppressed: 1, bounced: 1, complained: 0 },
    copy_notes: [{ step: "a1", was: "Your EnterprateAI workspace is ready", now: "Create your EnterprateAI workspace", why: "Nothing is ready yet." }], ...over });
  const journey = (over = {}) => ({ user: { id: "ada@example.test", email: "ada@example.test", verified: true, verified_at: "2026-10-01T09:00:00Z", timezone: "Europe/London" },
    permission: { may_email: false, reason: "no_permission_recorded", status: "unknown", source: null, collected_at: null, unsubscribed_at: null, suppression_reason: null },
    cohort: { in_rollout: true, holdout: false },
    steps: [{ journey: "A", step: "a1", subject: "Create your EnterprateAI workspace", state: "sent", due_at: "2026-10-01T09:10:00Z", sent_at: "2026-10-01T09:15:00Z", attempts: 1,
      template_version: "2026-10-v1", delivery_status: "delivered", stopped_reason: null },
    { journey: "A", step: "a2", subject: "A simple way to get started", state: "cancelled", due_at: "2026-10-02T09:00:00Z", sent_at: null, attempts: 0, template_version: "2026-10-v1",
      delivery_status: null, stopped_reason: "workspace_created" }], ...over });
  beforeEach(() => { useAuthStore.setState({ token: "t", email: "tech.support@enterprateai.com", hydrated: true }); });

  it("shows the mode, activation against the holdout, the steps and the guardrails", async () => {
    routes = [{ method: "GET", match: /^\/admin\/activation$/, reply: () => ({ body: board() }) }];
    mount("/", <ActivationAdmin />);
    await screen.findByText("Dry run. Steps are scheduled and reported, but no email is sent.");
    expect(screen.getByText(/Rollout: 2 internal accounts\./)).toBeTruthy();
    const tiles = screen.getByRole("region", { name: "Activation at a glance" });
    expect(within(tiles).getByText("Workspace in 7 days").parentElement.textContent).toBe("Workspace in 7 days40%Holdout: 25%");
    expect(within(tiles).getByText("No permission on record").parentElement.textContent).toContain("340");
    expect(screen.getByText(/Activation is read from workspaces and records, never from opens or clicks/).textContent).toContain("1 unsubscribed, 1 bounced, 0 complaints, 1 suppressed");
    const row = within(screen.getByRole("table", { name: "Sends by step" })).getByText("A · a1").closest("tr");
    expect([...row.querySelectorAll("td")].slice(1).map((td) => td.textContent)).toEqual(["3", "9", "8", "2", "1", "1 / 0", "0"]);
    expect(screen.getByText(/"Your EnterprateAI workspace is ready" became "Create your EnterprateAI workspace"/)).toBeTruthy();
  });

  it("a dry run lists who would get what and why, now or at a chosen time", async () => {
    const asked = [];
    routes = [{ method: "GET", match: /^\/admin\/activation$/, reply: () => ({ body: board() }) },
      { method: "GET", match: /^\/admin\/activation\/dry-run(\?at=.*)?$/, reply: (call) => { asked.push(call.path); return { body: { at: "2026-10-06T12:00:00+00:00", selected: [{ user_id: "new@example.test", action: "enrol", journey: "A", steps: ["a1", "a2"], why: "verified, permission recorded, no workspace" },
        { user_id: "out@example.test", action: "skip", journey: null, why: "not_in_rollout" }],
        due: [{ user_id: "ada@example.test", journey: "A", step: "a2", result: "would_cancel", why: "workspace_created" },
          { user_id: "late@example.test", journey: "A", step: "a1", result: "would_defer", why: "outside 09:00 to 18:00 where they are (it would be 19:30 in Europe/London)", until: "2026-10-07T08:00:00+00:00", timezone: "Europe/London" }] } }; } }];
    mount("/", <ActivationAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Run a dry run" }));
    const table = await screen.findByRole("table", { name: "Dry run" });
    expect(within(table).getByText("enrol journey A (a1, a2)")).toBeTruthy();
    expect(within(table).getByText("verified, permission recorded, no workspace")).toBeTruthy();
    expect(within(table).getByText("A · a2: would cancel")).toBeTruthy();
    expect(within(table).getByText("Created a workspace")).toBeTruthy();
    expect(within(table).getByText("Not in the current rollout")).toBeTruthy();      // and who is left out, with the reason
    expect(within(table).getByText("outside 09:00 to 18:00 where they are (it would be 19:30 in Europe/London) · next window opens 7 Oct, 09:00 London")).toBeTruthy();
    expect(screen.getByText(/if the job ran now, and why/)).toBeTruthy();
    expect(asked).toEqual(["/admin/activation/dry-run"]);
    fireEvent.change(screen.getByLabelText("As at"), { target: { value: "2026-10-06T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Run a dry run" }));
    expect(screen.queryByRole("table", { name: "Dry run" })).toBeNull();      // the old answer goes when the time changes
    expect(screen.getByText(/if the job ran at the chosen time, and why/)).toBeTruthy();
    await waitFor(() => expect(asked.length).toBe(2));
    const second = await screen.findByRole("table", { name: "Dry run" });
    const account = within(second).getByText("late@example.test");
    expect(account.getAttribute("title")).toBe("late@example.test");      // one line, cut short if need be, the whole address on hover
    expect(account.className).toContain("w-[260px]");
    expect(account.className).toContain("whitespace-nowrap");
    expect(account.className).toContain("text-ellipsis");
    // The wording follows the run on show, not the field: emptying the field clears the table and reads "now" again.
    fireEvent.change(screen.getByLabelText("As at"), { target: { value: "" } });
    expect(screen.queryByRole("table", { name: "Dry run" })).toBeNull();
    expect(screen.getByText(/if the job ran now, and why/)).toBeTruthy();
    expect(asked[1]).toBe(`/admin/activation/dry-run?at=${encodeURIComponent(new Date("2026-10-06T12:00").toISOString())}`);
  });

  it("looks up one user's journey and records permission only with evidence", async () => {
    let seen = journey();
    routes = [{ method: "GET", match: /^\/admin\/activation$/, reply: () => ({ body: board() }) },
      { method: "GET", match: /^\/admin\/activation\/users\/.+$/, reply: ({ path }) => (path.includes("ada") ? { body: seen } : { status: 404, body: { detail: "No account with that email." } }) },
      { method: "PUT", match: /\/permission$/, reply: ({ body }) => { seen = journey({ permission: { ...seen.permission, may_email: true, reason: body.status, status: body.status, source: `${body.source} (recorded by tech.support@enterprateai.com)` } }); return { body: seen }; } }];
    mount("/", <ActivationAdmin />);
    fireEvent.change(await screen.findByLabelText("Account email"), { target: { value: "nobody@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));
    await screen.findByText("No account with that email.");
    fireEvent.change(screen.getByLabelText("Account email"), { target: { value: "Ada@Example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));
    await screen.findByText("No: No permission on record");
    const steps = screen.getByRole("table", { name: "Journey steps" });
    expect(within(within(steps).getByText("A · a2").closest("tr")).getByText("Created a workspace")).toBeTruthy();
    expect(within(within(steps).getByText("A · a1").closest("tr")).getByText("delivered")).toBeTruthy();
    const form = screen.getByRole("form", { name: "Record permission" });
    expect(within(form).getByRole("button", { name: "Record" }).disabled).toBe(true);      // no evidence, no record
    fireEvent.change(within(form).getByLabelText("Evidence"), { target: { value: "Sign-up form v2, 12 Sept" } });
    fireEvent.click(within(form).getByRole("button", { name: "Record" }));
    await screen.findByText("Recorded.");
    expect(sent("PUT", /permission$/)[0]).toMatchObject({ path: "/admin/activation/users/ada%40example.test/permission", body: { status: "subscribed", source: "Sign-up form v2, 12 Sept" } });
    expect(screen.getByText("Yes")).toBeTruthy();
  });
});

describe("round 1: not set up, and the one-time question", () => {
  beforeEach(() => { useAuthStore.setState({ token: "t", email: "ada@example.test", hydrated: true }); });

  it("E-1: where the feature isn't set up, an ordinary user sees a plain line or nothing, never an error", async () => {
    routes = [{ method: "GET", match: /^\/auth\/me\/email-preferences$/, reply: () => ({ body: { available: false, product_tips: false, status: "unknown", can_resubscribe: false, ask_once: false } }) }];
    mount("/", <TipsSwitch />);
    await screen.findByText("Email tips aren't available yet.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    cleanup();
    const { container } = mount("/", <TipsSwitch quietWhenUnavailable />);
    await waitFor(() => expect(sent("GET", /email-preferences/).length).toBe(2));
    await waitFor(() => expect(container.textContent).toBe(""));
    cleanup();
    mount("/", <TipsPrompt />);
    await waitFor(() => expect(sent("GET", /email-preferences/).length).toBe(3));
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    routes = [{ method: "GET", match: /^\/email\/preferences$/, reply: () => ({ status: 503, body: { detail: { code: "not_set_up", message: "x" } } }) }];
    mount("/email/preferences?token=tok.abc", <EmailPreferencesPage />);
    await screen.findByText("Email tips aren't available yet.");
  });

  it("E-1: the admin page says to run the migration", async () => {
    useAuthStore.setState({ token: "t", email: "tech.support@enterprateai.com", hydrated: true });
    routes = [{ method: "GET", match: /^\/admin\/activation$/, reply: () => ({ status: 503, body: { detail: { code: "not_set_up", message: "Activation emails aren't set up on this server: run migration 033." } } }) }];
    mount("/", <ActivationAdmin />);
    expect((await screen.findByText("Activation emails aren't set up on this server: run migration 033.")).closest("[role=alert]")).toBeTruthy();
  });

  it("E-2: after a Google sign-up the question is asked once, unticked, and only a tick is sent as a yes", async () => {
    const ask = { available: true, product_tips: false, status: "unknown", can_resubscribe: true, ask_once: true, wording: "Send me getting-started guides and product tips by email. Optional; you can unsubscribe at any time." };
    routes = [{ method: "GET", match: /^\/auth\/me\/email-preferences$/, reply: () => ({ body: ask }) },
      { method: "POST", match: /^\/auth\/me\/email-preferences\/prompt$/, reply: ({ body }) => ({ body: { ...ask, ask_once: false, product_tips: body.product_tips } }) }];
    mount("/", <TipsPrompt />);
    const box = await screen.findByLabelText(/Send me getting-started guides and product tips by email\. Optional; you can unsubscribe at any time\./);
    expect(box.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sent("POST", /prompt$/)[0].body).toEqual({ product_tips: false });      // closing it is recorded, and is not consent
    cleanup();
    mount("/", <TipsPrompt />);
    fireEvent.click(await screen.findByRole("button", { name: "No thanks" }));
    await waitFor(() => expect(sent("POST", /prompt$/).length).toBe(2));
    expect(sent("POST", /prompt$/)[1].body).toEqual({ product_tips: false });
    cleanup();
    mount("/", <TipsPrompt />);
    fireEvent.click(await screen.findByLabelText(/Send me getting-started guides/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent("POST", /prompt$/).length).toBe(3));
    expect(sent("POST", /prompt$/)[2].body).toEqual({ product_tips: true });
    cleanup();
    routes = [{ method: "GET", match: /^\/auth\/me\/email-preferences$/, reply: () => ({ body: { ...ask, ask_once: false } }) }];
    mount("/", <TipsPrompt />);
    await waitFor(() => expect(sent("GET", /email-preferences$/).length).toBe(4));
    expect(screen.queryByRole("dialog")).toBeNull();                      // answered: never again
  });
});

describe("account settings", () => {
  const prefs = { available: true, product_tips: true, status: "subscribed", can_resubscribe: true, ask_once: false, last_changed_at: "2026-10-03T09:00:00Z", last_changed_from: "sign-up" };
  beforeEach(() => {
    useAuthStore.setState({ token: "t", email: "ada@example.test", name: "Ada Lovelace", picture: null, authProvider: "google", hasPassword: false, hydrated: true,
      subscription: { plan_key: "explorer", status: "active" }, creditInfo: { available_credits: 1250 } });
  });

  it("has the dashboard header and a section list; on a phone the list opens each section with a way back", async () => {
    routes = [{ method: "GET", match: /^\/auth\/me\/email-preferences$/, reply: () => ({ body: prefs }) }];
    mount("/account", <AccountSettings workspace={<p>Workspace profile here</p>} />);
    expect(screen.getByText("Settings", { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Account Settings");
    expect(screen.getByRole("heading", { level: 1 }).querySelector("span").className).toContain("text-brand-600");
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Profile", "Sign-in & security", "Email preferences", "Privacy & cookies", "Workspace", "Team", "Plan & credits"]);
    expect(screen.getByText("How you appear in EnterprateAI.")).toBeTruthy();      // a plain link to /account opens Profile on a wider screen
    expect(screen.queryByText("Workspace profile here")).toBeNull();
    expect(nav.className).toContain("block");                             // no section chosen: on a phone the list is the page
    expect(nav.className).not.toContain("hidden");
    fireEvent.click(within(nav).getByRole("button", { name: "Email preferences" }));
    expect(within(nav).getByRole("button", { name: "Email preferences" }).getAttribute("aria-current")).toBe("page");
    expect(nav.className).toContain("hidden md:block");                   // a section is open: the list steps aside on a phone
    await screen.findByText("Account messages: always on");
    fireEvent.click(screen.getByRole("button", { name: "All settings" }));
    expect(nav.className).not.toContain("hidden");
  });

  it("the business profile opens from ?section=workspace, and from the older ?tab=workspace", () => {
    for (const path of ["/account?section=workspace", "/account?tab=workspace"]) {
      mount(path, <AccountSettings workspace={<p>Workspace profile here</p>} />);
      expect(screen.getByText("Workspace profile here")).toBeTruthy();
      expect(screen.queryByText("How you appear in EnterprateAI.")).toBeNull();
      cleanup();
    }
  });

  it("email preferences: account messages are locked on, tips are a real switch, and the last change is shown", async () => {
    routes = [{ method: "GET", match: /^\/auth\/me\/email-preferences$/, reply: () => ({ body: prefs }) }];
    mount("/", <EmailSection />);
    const locked = screen.getByRole("switch", { name: "Account messages" });
    expect(locked.getAttribute("aria-checked")).toBe("true");
    expect(locked.disabled).toBe(true);
    expect(screen.getByText(/they can't be switched off/)).toBeTruthy();
    const tips = await screen.findByRole("switch", { name: "Getting-started guides and product tips" });
    expect(tips.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Last changed 3 Oct 2026 · from sign-up")).toBeTruthy();
  });

  it("profile: Save is off until something changes, and confirms in place", async () => {
    routes = [{ method: "PATCH", match: /^\/auth\/me$/, reply: ({ body }) => ({ body: { name: body.name, picture: null, auth_provider: "google", has_password: false } }) }];
    mount("/", <ProfileSection />);
    expect(screen.getByText("Signed in with Google")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change photo" })).toBeTruthy();
    expect(screen.getByLabelText("Email address").disabled).toBe(true);
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Ada L." } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect((await screen.findByText("Saved")).getAttribute("role")).toBe("status");
    expect(sent("PATCH", /^\/auth\/me$/)[0].body).toEqual({ name: "Ada L." });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(true));      // saved: nothing left to save
  });

  it("security: shows how you sign in, offers to set a password, and signs out other devices keeping this one", async () => {
    routes = [{ method: "POST", match: /^\/auth\/me\/sign-out-others$/, reply: () => ({ body: { access_token: "fresh-token", token_type: "bearer" } }) }];
    mount("/", <SecuritySection />);
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set a password" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out of other devices" }));
    await screen.findByText("Signed out everywhere else. This device stays signed in.");
    expect(localStorage.getItem("ea_token")).toBe("fresh-token");
    expect(useAuthStore.getState().token).toBe("fresh-token");
  });

  it("privacy: consent status with Change, a data download, and deletion only once the email is typed", async () => {
    localStorage.setItem("ea_cookie_consent", "accepted");
    routes = [{ method: "POST", match: /^\/auth\/me\/delete$/, reply: () => ({ status: 204, body: null }) }];
    mount("/", <PrivacySection />);
    expect(screen.getByText("Given")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download my data" })).toBeTruthy();
    const form = screen.getByRole("form", { name: "Delete account" });
    const del = within(form).getByRole("button", { name: "Delete my account" });
    expect(del.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText("Type your email address to confirm"), { target: { value: "ada@example" } });
    expect(del.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText("Type your email address to confirm"), { target: { value: "Ada@Example.test" } });
    expect(del.disabled).toBe(false);
    fireEvent.click(del);
    await waitFor(() => expect(sent("POST", /delete$/).length).toBe(1));
    expect(sent("POST", /delete$/)[0].body).toEqual({ confirm: "Ada@Example.test" });
    await waitFor(() => expect(useAuthStore.getState().token).toBeNull());      // signed out once the account is gone
  });

  it("plan and credits: the plan, credits left, and what the allocation is", () => {
    mount("/", <PlanSection />);
    expect(screen.getByText("Explorer")).toBeTruthy();
    expect(screen.getByText("1,250")).toBeTruthy();
    expect(screen.getByText("Free trial allocation")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeTruthy();
    cleanup();
    useAuthStore.setState({ subscription: { plan_key: "growth", status: "active", current_period_end: "2026-11-05T00:00:00Z" } });
    mount("/", <PlanSection />);
    expect(screen.getByText("5 November 2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change plan" })).toBeTruthy();
  });
});
