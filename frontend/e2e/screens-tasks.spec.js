// The Agent Centre's Tasks panel and sheets (the owner's QA, 27 Oct), at 1440×900 and 390×844: one tab opened in place
// ("← Needs Approval · 5"), cards with Show more, Documents with one search box and a filter menu, the profile and activity
// sheets, and the conversation kept over a reload. Every API call is a stub: nothing reaches a server or a database.
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const OUT = process.env.SCREENS_OUT || "e2e/out/screens";
mkdirSync(OUT, { recursive: true });
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const waiting = [
  { type: "draft", kind: "business_plan", draft_id: "d1", title: "Business plan: Land Clearing", subtitle: "Needs your review", created_at: ago(20), to: "/blueprint?review=d1" },
  { type: "draft", kind: "business_plan", draft_id: "d2", title: "Business plan: E2E Car Wash Abuja", subtitle: "Needs your review", created_at: ago(30), to: "/blueprint?review=d2" },
  { type: "draft", kind: "idea_validation", draft_id: "d3", title: "Idea validation: bush clearing", subtitle: "Needs your review", created_at: ago(40) },
  { type: "approval", kind: "payment", approval_id: "a1", run_id: "r1", title: "Payment follow-up for Northbridge Solutions, invoice INV-1042 now 14 days overdue", subtitle: "₦120,000", created_at: ago(2) },
  { type: "approval", kind: "quotation", approval_id: "a2", run_id: "r2", title: "Quotation for Raphael: monthly fleet wash", subtitle: "₦450,000", created_at: ago(70) },
];
const run = (n, bucket, status) => ({ id: `run-${bucket}-${n}`, title: [`Receipt sending for Ada, invoice INV-10${n}`, `Enquiry to quote: interior detailing for Bola's office fleet of ${n + 3} cars`, `Business plan for Drone Cleaning`][n % 3],
  bucket, status, display_status: status, capability: ["receipt_send", "enquiry_to_quote", "business_plan_draft"][n % 3], workflow_key: ["receipt_send", "enquiry_to_quote", "business_plan_draft"][n % 3],
  created_at: ago(n * 9 + 3), subtitle: "" });
const COUNTS = { needs_approval: 6, needs_attention: 3, active: 0, completed: 38, history: 82 };
const docs = [
  { kind: "business_plan_draft", kind_label: "Business plan", id: "run:p1", reference: "Business plan: Land Clearing", party: "", status: "prepared", status_label: "Ready for your review", date: ago(24).slice(0, 10), updated_at: ago(24), run_id: "p1", draft_id: "d1" },
  { kind: "business_plan_draft", kind_label: "Business plan", id: "run:p2", reference: "Business plan: Drone Cleaning", party: "", status: "prepared", status_label: "Ready for your review", date: ago(50).slice(0, 10), updated_at: ago(50), run_id: "p2" },
  { kind: "quotation", kind_label: "Quotation", id: "q1", reference: "QUO-0012", party: "Raphael", status: "sent", status_label: "Sent, awaiting reply", date: "2026-10-20", updated_at: "2026-10-20T10:00:00Z", run_id: "r9", total: 450000, currency: "NGN" },
  { kind: "invoice", kind_label: "Invoice", id: "i1", reference: "INV-1042", party: "Northbridge Solutions", status: "overdue", status_label: "Overdue", date: "2026-10-12", updated_at: "2026-10-12T10:00:00Z", run_id: "r1", total: 120000, currency: "NGN" },
];
const saved = { id: "c-last", messages: [{ role: "user", content: "Simulate a payment delay", at: ago(3) }, { role: "assistant", content: "If customers paid 60 days late, you'd have about ₦212,400 after 6 months.", at: ago(3),
  cards: [{ type: "scenario", title: "Payments arriving 60 days late", months: 6, worse: true, summary: "", rows: [{ label: "Cash after 6 months", before: "₦1,086,550", after: "₦212,400" }] }] }] };

async function open(page, at = "/agent", size = [1440, 900]) {
  await page.setViewportSize({ width: size[0], height: size[1] });
  await stubApi(page, { transition: false });
  await page.route("http://api.test/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/businesses/A/agent/summary") return json({ needs_approval: waiting, needs_approval_count: 5, entitlement: { plan: "growth", is_paid: true } });
    if (p === "/businesses/A/workflow-runs") {
      const b = url.searchParams.get("bucket");
      const n = COUNTS[b] ?? 0;
      const status = { needs_attention: "awaiting_approval", completed: "succeeded", history: "succeeded", needs_approval: "waiting_for_review" }[b] || "running";
      const limit = Number(url.searchParams.get("limit") || 10);
      return json({ items: Array.from({ length: Math.min(n, limit) }, (_, i) => run(i, b, status)), total: n, counts: COUNTS });
    }
    if (p === "/businesses/A/agent/documents") return json({ items: docs, total: 15, all_total: 15, counts: { business_plan_draft: 10, quotation: 3, invoice: 2 },
      kinds: [{ key: "business_plan_draft", label: "Business plan" }, { key: "quotation", label: "Quotation" }, { key: "invoice", label: "Invoice" }] });
    if (p === "/businesses/A/agent/chats") return json({ items: [{ id: "c-last", title: "Simulate a payment delay", at: ago(3), count: 2 }] });
    if (p === "/businesses/A/agent/chats/c-last") return json(saved);
    if (p === "/businesses/A/agent/assistant-context") return json({ business: { name: "E2E Car Wash Abuja", stage: "Operating", location: "Abuja, Nigeria" },
      revenue: { total: 994276, currency: "NGN", months: [], monthly: 994276, monthly_months: 1 }, activity: [{ kind: "invoice_paid", title: "Invoice paid", detail: "₦120,000 from Raphael", at: ago(2) }] });
    if (p === "/businesses/A/agent/activity") return json({ items: [{ kind: "invoice_paid", title: "Invoice paid", detail: "₦120,000 from Raphael", at: ago(2) },
      { kind: "customer_added", title: "New customer added", detail: "Northbridge Solutions", at: ago(26) }, { kind: "invoice_sent", title: "Invoice sent", detail: "₦80,000 to Ada", at: ago(50) }] });
    if (p === "/workspace/profile") return json({ workspace_id: "A", profile: { company_name: "E2E Car Wash Abuja", about_company: "Hand car washing and interior detailing for offices in Abuja.",
      primary_industry: "Car wash and detailing", city: "Abuja", country: "Nigeria", email: "hello@e2ecarwash.ng" } });
    if (p === "/businesses/A/agent/chat/preview") return json({ found: true, kind: "business_plan", title: "Business plan: Land Clearing", editable: true, to: "/blueprint?review=d1",
      text: "## Executive Summary\n\nLand Clearing prepares farmland for planting across the Federal Capital Territory." });
    return route.fallback();
  });
  await page.addInitScript(() => localStorage.setItem("ea_workspace", JSON.stringify({ state: { workspaceId: "A", workspaceName: "E2E Car Wash Abuja", currency: "NGN" }, version: 0 })));
  await page.goto(at);
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/tasks-${name}.png` });

for (const [w, h, label] of [[1440, 900, "1440"], [390, 844, "phone"]]) {
  test(`tasks panel and sheets ${label}`, async ({ page }) => {
    test.setTimeout(150000);
    await open(page, "/agent", [w, h]);
    // 1. the last conversation is back after a reload, with its card
    await expect(page.getByText("If customers paid 60 days late", { exact: false })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-card="scenario"]')).toBeVisible();
    if (label === "phone") await page.click("[data-tasks-button]");
    const panel = page.locator("[data-task-panel]").last();
    await panel.getByRole("tab", { name: /^Needs Approval/ }).click();
    await expect(panel.locator("[data-task-header]")).toHaveText("Needs Approval · 5");
    await expect(panel.locator("[data-task-cards] > li")).toHaveCount(5);      // the count and the list are one
    await shot(page, `${label}-needs-approval`);
    await panel.getByRole("button", { name: "Back to all tasks" }).click();
    await panel.getByRole("tab", { name: /^Needs You/ }).click();
    await expect(panel.locator("[data-task-header]")).toHaveText("Needs You · 3");
    await shot(page, `${label}-needs-you`);
    await panel.getByRole("button", { name: "Back to all tasks" }).click();
    await panel.getByRole("tab", { name: /^Active/ }).click();
    await expect(panel.locator("[data-task-empty]")).toBeVisible();
    await shot(page, `${label}-active-empty`);
    await panel.getByRole("button", { name: "Back to all tasks" }).click();
    await panel.getByRole("tab", { name: /^History/ }).click();
    await expect(panel.getByPlaceholder("Search tasks")).toBeVisible();
    await expect(panel.locator("[data-show-more]")).toBeVisible();
    await shot(page, `${label}-history`);
    await panel.getByRole("button", { name: "Back to all tasks" }).click();
    await panel.getByRole("tab", { name: /^Documents/ }).click();
    await expect(panel.locator("[data-task-header]")).toHaveText("Documents · 15");
    await expect(panel.locator("[data-document]").first()).toContainText("Business plan: Land Clearing");
    await shot(page, `${label}-documents`);
    await panel.locator("[data-doc-filter]").click();
    await shot(page, `${label}-documents-filter`);
    await page.keyboard.press("Escape");
    await panel.locator("[data-doc-filter]").click();      // closed again
    // a document opens in the chat, as Review does
    await panel.locator("[data-document]").first().getByRole("button", { name: "Open" }).click();
    await expect(page.locator("[data-preview-text]")).toBeVisible({ timeout: 15000 });
    await page.locator("[data-conversation-panel]").evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await shot(page, `${label}-document-in-chat`);
    await expect(page).toHaveURL(/\/agent/);
    // the sheets
    if (label === "phone") await page.click("[data-tasks-button]");
    await panel.getByRole("button", { name: "Back to all tasks" }).click();
    await page.locator('[data-side="workspace"]').last().getByRole("button", { name: "View profile →" }).click();
    await expect(page.locator("[data-profile-group]")).toHaveCount(3);
    await shot(page, `${label}-profile-sheet`);
    await page.locator("[data-add-field]").first().click();
    await shot(page, `${label}-profile-add`);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator('[data-side="activity"]').last().getByRole("button", { name: "View all →" }).click();
    await expect(page.locator("[data-activity-day]").first()).toBeVisible({ timeout: 3000 });      // at once, never a skeleton for seconds
    await shot(page, `${label}-activity-sheet`);
  });
}

// The owner, 28 Oct: the filter chips on one line, scrolling sideways when they don't fit
for (const [w, h, label] of [[1440, 900, "1440"], [1280, 800, "1280"], [390, 844, "phone"]]) {
  test(`task chips on one line ${label}`, async ({ page }) => {
    await open(page, "/agent", [w, h]);
    await page.waitForSelector("[data-task-chips]", { state: "attached", timeout: 30000 });
    if (label === "phone") await page.click("[data-tasks-button]");
    const chips = page.locator("[data-task-chips]").last();
    const one = await chips.evaluate((el) => { const tops = [...el.children].map((c) => c.getBoundingClientRect().top); return Math.max(...tops) - Math.min(...tops) < 2; });
    expect(one).toBe(true);
    await chips.screenshot({ path: `${OUT}/tasks-${label}-chips-row.png` });
    await page.screenshot({ path: `${OUT}/tasks-${label}-chips.png` });
  });
}
