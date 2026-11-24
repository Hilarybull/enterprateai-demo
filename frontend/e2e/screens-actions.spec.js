// The Agent Centre chat's buttons do the work in the chat (the owner, 27 Oct): each one pressed, its result captured.
// Every API call is answered by stubs shaped as the server answers them: nothing reaches a server or a database.
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const OUT = process.env.SCREENS_OUT || "e2e/out/screens";
mkdirSync(OUT, { recursive: true });
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const waiting = [
  { type: "approval", kind: "payment", approval_id: "a1", run_id: "r1", title: "Payment follow-up draft", subtitle: "For Northbridge Solutions", age: "2h", created_at: ago(2) },
  { type: "draft", kind: "business_plan", draft_id: "d1", run_id: "r3", title: "Business Plan for Land Clearing", subtitle: "Draft ready for review", age: "1d", to: "/blueprint?review=d1", created_at: ago(24) },
];
const posted = [];

async function open(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubApi(page, { transition: false });
  await page.route("http://api.test/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (route.request().method() === "POST") posted.push(p);
    if (p === "/businesses/A/agent/summary") return json({ needs_approval: waiting.filter((w) => !posted.includes("/businesses/A/agent/chat/postpone") || w.approval_id !== "a1"), needs_approval_count: posted.includes("/businesses/A/agent/chat/postpone") ? 1 : 2, entitlement: { plan: "growth", is_paid: true } });
    if (p === "/businesses/A/workflow-runs") return json({ items: [], total: 0, counts: { needs_approval: 2 } });
    if (p === "/businesses/A/agent/chats") return json({ items: [] });
    if (p === "/businesses/A/agent/assistant-context") return json({ business: { name: "E2E Car Wash Abuja", stage: "Operating", location: "Abuja, Nigeria" }, revenue: { total: 994276, currency: "NGN", months: [] },
      risk: { customer: "Raphael", share: 82, others: 18, tail: 0, level: "High" }, activity: [] });
    if (p === "/businesses/A/agent/chat/scenario") return json(JSON.parse(route.request().postData()).kind === "payment_delay"
      ? { type: "scenario", kind: "payment_delay", title: "Payments arriving 60 days late", months: 6, run_id: "s2", worse: true, to: "/simulation",
          summary: "If customers paid 60 days late, revenue stays at ₦331,425 a month but the cash arrives later: after 6 months you'd have about ₦212,400, against ₦1,086,550 as things are.",
          rows: [{ label: "Monthly revenue", before: "₦331,425", after: "₦331,425" }, { label: "Monthly profit", before: "₦181,425", after: "₦181,425" }, { label: "Cash after 6 months", before: "₦1,086,550", after: "₦212,400" }] }
      : { type: "scenario", kind: "order_reduction", title: "Main customer orders down 30%", months: 6, run_id: "s1", worse: true, to: "/simulation",
          summary: "If your main customer's orders fell by about 30%, monthly revenue would go from ₦331,425 to ₦249,894 and profit from ₦181,425 to ₦99,894. After 6 months you'd have about ₦599,364 in cash, against ₦1,088,550 as things are.",
          rows: [{ label: "Monthly revenue", before: "₦331,425", after: "₦249,894" }, { label: "Monthly profit", before: "₦181,425", after: "₦99,894" }, { label: "Cash after 6 months", before: "₦1,088,550", after: "₦599,364" }] });
    if (p === "/businesses/A/agent/chat/preview" && url.searchParams.get("draft_id")) return json({ found: true, kind: "business_plan", title: "Business Plan for Land Clearing", to: "/blueprint?review=d1", editable: true,
      text: "## Executive Summary\n\nLand Clearing prepares farmland for planting across the Federal Capital Territory, clearing bush and stumps for smallholder and commercial farms.\n\n## The opportunity\n\nFarm owners lose weeks each season to manual clearing..." });
    if (p === "/businesses/A/agent/chat/preview") return json({ found: true, kind: "payment_reminder", title: "Payment follow-up draft", customer: "Northbridge Solutions", to_email: "finance@northbridge.ng", total: 120000, currency: "NGN", editable: true,
      message: "Hi, a friendly reminder that invoice INV-1042 for ₦120,000 is now 14 days overdue. Please let us know if there's anything we can help with. Kind regards, E2E Car Wash Abuja" });
    if (p === "/businesses/A/agent/chat/revise") return json({ ok: true, message: "Done. Here's the updated draft. It waits for your approval again; nothing has been sent.",
      preview: { found: true, kind: "payment_reminder", title: "Payment follow-up draft", customer: "Northbridge Solutions", total: 120000, currency: "NGN", editable: true,
        message: "Hi, invoice INV-1042 for ₦120,000 is now 14 days overdue. Could you settle it by Friday? Kind regards, E2E Car Wash Abuja" } });
    if (p === "/businesses/A/agent/chat/postpone") return json({ key: "a1", until: new Date(Date.now() + 86400000).toISOString() });
    if (p === "/businesses/A/agent/chat/attach") return json({ evidence_id: "e1", name: "prices.txt",
      message: "It's your price list: interior detailing at ₦25,000 a car and about 40 cars a month. I've saved prices.txt with your business evidence, where your funding and launch checks can use it. Nothing was shared." });
    if (p === "/businesses/A/quick-check/more_customers/premium/quote") return json({ allowed: true, cost: 40, max: 40, topics: ["Customer segments"], balance: 348 });
    return route.fallback();
  });
  await page.goto("/agent");
  await page.waitForSelector('[data-card="approvals"]', { timeout: 30000 });
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/action-${name}.png` });
const chat = (page) => page.locator("[data-conversation-panel]");

test("each button does its work in the chat", async ({ page }) => {
  test.setTimeout(180000);
  await open(page);
  await page.getByRole("button", { name: "Simulate order reduction" }).click();
  await expect(page.locator('[data-card="scenario"]').first()).toBeVisible();
  await chat(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot(page, "1-order-reduction");
  await page.getByRole("button", { name: "Simulate payment delay" }).click();
  await expect(page.locator('[data-card="scenario"]').nth(1)).toBeVisible();
  await chat(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot(page, "2-payment-delay");
  await page.getByRole("button", { name: "Find new customer segments" }).click();
  await page.getByRole("button", { name: "See what it costs" }).click();
  await expect(page.getByText("Up to 40 credits, and you only pay for what I find.")).toBeVisible();
  await chat(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot(page, "3-segments-price");
  await chat(page).evaluate((el) => el.scrollTo(0, 0));
  await page.locator('[data-card="approvals"] li').nth(1).getByRole("button", { name: "Review" }).click();
  await expect(page.locator('[data-preview-text]')).toBeVisible();
  await page.locator('[data-preview-text]').scrollIntoViewIfNeeded();
  await shot(page, "4-review-draft");
  await page.locator('[data-card="approvals"] li').first().getByRole("button", { name: "Edit" }).click();
  await page.fill("#agent-chat-input", "Ask them to pay by Friday");
  await page.click('button[aria-label="Send"]');
  await expect(page.getByText("Done. Here's the updated draft.")).toBeVisible();
  await chat(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot(page, "5-edit-in-chat");
  await chat(page).evaluate((el) => el.scrollTo(0, 0));
  await page.locator('[data-card="approvals"] li').first().getByRole("button", { name: "Postpone" }).click();
  await expect(page.locator("[data-postpone-choice]")).toBeVisible();
  await shot(page, "6-postpone-ask");
  await page.locator("[data-postpone-choice]").getByRole("button", { name: "Tomorrow" }).click();
  await expect(page.getByText(/^Payment follow-up draft postponed to /)).toHaveCount(1);      // one toast naming it (the owner, 27 Oct)
  await chat(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot(page, "7-postponed");
  await page.setInputFiles("[data-chat-file]", { name: "prices.txt", mimeType: "text/plain", buffer: Buffer.from("Interior detailing 25000 per car") });
  await expect(page.getByText(/I've saved prices.txt with your business evidence/)).toBeVisible();
  await chat(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot(page, "8-attached");
  expect(posted).toEqual(expect.arrayContaining(["/businesses/A/agent/chat/scenario", "/businesses/A/agent/chat/revise", "/businesses/A/agent/chat/postpone", "/businesses/A/agent/chat/attach"]));
  await expect(page).toHaveURL(/\/agent$/);      // never left the chat
});
