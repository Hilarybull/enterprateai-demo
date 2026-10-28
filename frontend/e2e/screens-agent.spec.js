// The Agent Centre as a full-page chat with the task tabs beside it (the owner, 27 Oct), at desktop and phone width.
// Every API call is answered by stubs: nothing reaches a server or a database. Run: npx playwright test screens-agent
import { mkdirSync } from "node:fs";
import { test } from "@playwright/test";
import { stubApi } from "./stub.js";

const OUT = process.env.SCREENS_OUT || "e2e/out/screens";
mkdirSync(OUT, { recursive: true });
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const waiting = [
  { type: "approval", kind: "payment", approval_id: "a1", run_id: "r1", title: "Payment follow-up draft", subtitle: "For Northbridge Solutions", age: "2h", created_at: ago(2) },
  { type: "approval", kind: "quote", approval_id: "a2", run_id: "r2", title: "Quote #Q-1042", subtitle: "Ready to send to Metro Systems", age: "5h", created_at: ago(5) },
  { type: "draft", kind: "business_plan", draft_id: "d1", run_id: "r3", title: "Business plan: car wash expansion", subtitle: "Draft ready for review", age: "1d", to: "/blueprint?review=d1", created_at: ago(24) },
];
const runs = [
  { id: "r1", title: "Payment follow-up for Northbridge Solutions", workflow_key: "payment_follow_up", bucket: "needs_approval", status: "awaiting_approval", created_at: ago(2), updated_at: ago(2) },
  { id: "r2", title: "Quotation for Metro Systems", workflow_key: "quote_send", bucket: "needs_approval", status: "awaiting_approval", created_at: ago(5), updated_at: ago(5) },
  { id: "r4", title: "Invoice for BrightTech Ltd", workflow_key: "invoice_send", bucket: "needs_approval", status: "awaiting_approval", created_at: ago(30), updated_at: ago(30) },
];

for (const [width, height, label] of [[1440, 900, "1440x900"], [1024, 700, "1024x700"], [390, 844, "phone"]]) {
  test(`agent centre ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    let slow = label === "1440x900";      // the first look while the data is still on its way: skeletons
    await stubApi(page, { transition: false });
    await page.route("http://api.test/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/businesses/A/agent/summary" && slow) { await new Promise((r) => setTimeout(r, 4000)); slow = false; }
      if (path === "/businesses/A/agent/summary") return json({ needs_approval: waiting, needs_approval_count: waiting.length, entitlement: { plan: "growth", is_paid: true, can_prepare: true, can_approve: true } });
      if (path === "/businesses/A/workflow-runs") return json({ items: runs, total: runs.length, counts: { active: 1, needs_approval: 3, needs_attention: 2, completed: 7, history: 14 } });
      if (path === "/businesses/A/agent/chats") return json({ items: [] });
      if (path === "/businesses/A/agent/assistant-context" && new URL(route.request().url()).searchParams.get("kind") === "idea")
        return json({ idea: { answers: { description: "Mobile car interior detailing" }, score_out_of_100: 57, weaknesses: ["Needs demand evidence"] } });
      if (path === "/businesses/A/agent/assistant-context") return json({
        business: { name: "E2E Car Wash Abuja", stage: "Operating", location: "Abuja, Nigeria" }, revenue: { total: 994276, currency: "NGN", months: [] },
        risk: { customer: "Raphael", share: 99, others: 1, tail: 0, level: "High" },
        activity: [{ kind: "research", title: "Research adopted", detail: "Customer plan", at: ago(24) }, { kind: "customer_added", title: "Research ready to review", detail: "Funding readiness", at: ago(48) },
          { kind: "quote_sent", title: "Quotation approved", detail: "Sent after your approval", at: ago(50) }] });
      if (path === "/businesses/A/funding-cases") return json({ items: [{ id: "f1", status: "preparing", title: "₦25m equity for equipment", summary: { score: 73, open_actions: 5 } }] });
      if (path === "/businesses/A/launch-initiatives") return json({ items: [{ id: "l1", status: "preparing", title: "Drone Cleaning, November 2026", summary: { score: 35, next_action: { title: "CAC registration missing." } } }] });
      return route.fallback();
    });
    await page.goto("/agent");
    await page.waitForSelector("[data-agent-chat]", { timeout: 30000 });
    if (label === "1440x900") await page.screenshot({ path: `${OUT}/agent-centre-${label}-loading.png` });
    await page.waitForTimeout(label === "1440x900" ? 5000 : 2500);
    await page.screenshot({ path: `${OUT}/agent-centre-${label}.png` });
    // Nothing but the chat (and the side panel when taller) scrolls: the page itself fits the window
    const fit = await page.evaluate(() => {
      const area = document.querySelector('[data-tour="content-area"]');
      const chat = document.querySelector("[data-agent-chat]").getBoundingClientRect();
      return { page: document.documentElement.scrollHeight - window.innerHeight, area: area.scrollHeight - area.clientHeight, chatBottom: Math.round(chat.bottom), height: window.innerHeight };
    });
    console.log(label, JSON.stringify(fit));
    await page.fill("#agent-chat-input", "What should I do next?");
    await page.click('button[aria-label="Send"]');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/agent-centre-${label}-next.png` });
    if (label === "1440x900") {
      await page.click('[data-agent-tabs] button:has-text("Needs Approval")');
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/agent-centre-${label}-tasks.png` });
    }
    if (label === "phone") {
      await page.click("[data-tasks-button]");
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/agent-centre-phone-tasks.png` });
    }
  });
}
