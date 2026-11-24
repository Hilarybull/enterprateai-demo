// Every API call answered from recorded fixtures (the backend's own synthetic business, "A"). Unknown calls get an empty
// answer, never a network request: nothing reaches a server or a database.
import { readFileSync } from "node:fs";
const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

export async function stubApi(page, { transition = true, gate = false, runs = null } = {}) {
  const dashboard = load("dashboard");
  if (transition) dashboard.context = { ...(dashboard.context || {}), transition: { from: "pre_launch", message: "You've taken your first payment. Your launch items stay here until 2 Nov 2026, then the dashboard moves fully to running the business." } };
  const summary = load("agent_summary");
  const firstValue = load("first_value");
  if (gate) {
    firstValue.result.premium_gate = { allowed: false, reason: "plan", primary: { label: "Upgrade to continue", to: "/pricing" }, secondary: [],
      message: "You already have an initial assessment. I can now research competitor prices and market price bands. Full Pricing Intelligence is available on an eligible plan." };
  }
  const workspace = { id: "A", name: "Altmosphere Consulting", user_id: "owner@example.test", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-14T00:00:00Z",
    data: { workspace_profile: { company_name: "Altmosphere Consulting", country: "United Kingdom", city: "Leeds" }, onboarding: { completed: true } } };
  await page.route("http://api.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path === "/auth/me") body = { id: "owner@example.test", email: "owner@example.test", name: "Hilary Owner", email_verified: true, has_password: true };
    else if (path === "/validation/me" || path === "/validation/A") body = workspace;
    else if (path === "/validation/list") body = [workspace];
    else if (path === "/businesses/A/dashboard") body = dashboard;
    else if (path === "/businesses/A/agent/summary") body = summary;
    else if (path.endsWith("/first-value")) body = firstValue;
    else if (path === "/credits/balance") body = { available_credits: 348 };
    else if (path === "/auth/restrictions" || path === "/auth/grants") body = [];
    else if (path === "/plans/my") body = { plan_key: "growth", status: "active", plan: { key: "growth", name: "Growth" } };
    else if (path.includes("first-results")) body = { items: [] };
    else if (path === "/businesses/A/workflow-runs" && runs) body = { items: runs, total: runs.length, counts: { needs_attention: runs.length } };
    else if (/\/(list|inbox|memberships|runs|approvals|documents)$/.test(path)) body = [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("ea_token", "e2e-token");
    localStorage.setItem("ea_email", "owner@example.test");
    localStorage.setItem("ea_first_value_session", "sess-1");
    localStorage.setItem("ea_cookie_consent", JSON.stringify({ operational: true, analytics: false }));
    localStorage.setItem("ea_workspace", JSON.stringify({ state: { workspaceId: "A", workspaceName: "Altmosphere Consulting", currency: "GBP" }, version: 0 }));
  });
}
