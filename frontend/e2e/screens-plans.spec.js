// The owner's business plan conversation (27 Oct), in the Agent Centre chat at 1440, 1280 and 390 wide: "i need a business
// plan" → "but you said I only have 3" → "create a new one, Drone cleaning"; and a card's Postpone said in one toast. The
// replies are stubs shaped as the server now gives them (tests/test_round14_business_plans.py checks the server's own).
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const OUT = process.env.SCREENS_OUT || "e2e/out/screens";
mkdirSync(OUT, { recursive: true });
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const LIST = "You have 10 business plans, 3 waiting for your review: “Land Clearing” (waiting for your review), “E2E Car Wash Abuja” (waiting for your review), “Bush Clearing” (waiting for your review), “Drone Cleaning”, “Balcony Washing”, and 5 more. Open one, or create a new one?";
const waiting = [{ type: "draft", kind: "business_plan", draft_id: "d1", title: "Business plan: Land Clearing", subtitle: "Needs your review", created_at: ago(20), to: "/blueprint?review=d1" },
  { type: "draft", kind: "business_plan", draft_id: "d2", title: "Business plan: E2E Car Wash Abuja", subtitle: "Needs your review", created_at: ago(30), to: "/blueprint?review=d2" }];

for (const [w, h, label] of [[1440, 900, "1440"], [1280, 800, "1280"], [390, 844, "phone"]]) {
  test(`plan conversation ${label}`, async ({ page }) => {
    test.setTimeout(150000);
    await page.setViewportSize({ width: w, height: h });
    await stubApi(page, { transition: false });
    const asked = [];
    await page.route("http://api.test/**", async (route) => {
      const url = new URL(route.request().url());
      const p = url.pathname;
      const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (p === "/businesses/A/agent/summary") return json({ needs_approval: waiting, needs_approval_count: 2, entitlement: { plan: "growth", is_paid: true } });
      if (p === "/businesses/A/workflow-runs") return json({ items: [], total: 0, counts: { needs_approval: 2 } });
      if (p === "/businesses/A/agent/chats") return json({ items: [] });
      if (p === "/businesses/A/agent/assistant-context") return json({ business: { name: "E2E Car Wash Abuja", stage: "Operating", location: "Abuja, Nigeria" }, revenue: { total: 994276, currency: "NGN", months: [] }, activity: [] });
      if (p === "/businesses/A/agent/chat/postpone") return json({ key: "d1", until: new Date(Date.now() + 5 * 86400000).toISOString() });
      if (p === "/agent/requests" && route.request().method() === "POST") {
        const body = JSON.parse(route.request().postData() || "{}");
        asked.push(body);
        if (/but you said/i.test(body.text)) return json({ kind: "answer", message: "Sorry, I wasn't clear. 3 of your plans are waiting for your review; you have 10 business plans in all: “Land Clearing”, “E2E Car Wash Abuja”, “Bush Clearing”, “Drone Cleaning”, “Balcony Washing”, “Alchemy Test”, “Car Detailing”, “Mobile Wash”. And 2 more. Would you like to open one, or create a new one?" });
        if (/create a new one/i.test(body.text)) return json({ kind: "needs_input", capability: "business_plan_draft", message: "Happy to draft your business plan for Drone cleaning. One quick question so it fits.",
          fields: [{ key: "purpose", label: "Who will read it?", type: "choice", required: true, options: [{ value: "investors", label: "Investors, to raise funding" }, { value: "planning", label: "Me and my team, to plan" }] }] });
        return json({ kind: "answer", message: LIST, offers: [{ label: "Open “Land Clearing”", to: "/blueprint?review=d1" }, { label: "Create a new one", capability: "business_plan_draft", params: { existing_plan: "new" } }] });
      }
      return route.fallback();
    });
    await page.addInitScript(() => localStorage.setItem("ea_workspace", JSON.stringify({ state: { workspaceId: "A", workspaceName: "E2E Car Wash Abuja", currency: "NGN" }, version: 0 })));
    await page.goto("/agent");
    await page.waitForSelector('[data-card="approvals"]', { timeout: 30000 });
    // the suggestions on one line, the History and New icons in the chat's header
    const chips = page.locator("[data-chat-chips]");
    const one = await chips.evaluate((el) => { const tops = [...el.children].map((c) => c.getBoundingClientRect().top); return Math.max(...tops) - Math.min(...tops) < 2; });
    expect(one).toBe(true);
    await expect(page.locator("[data-chat-header] [data-chat-history-button]")).toBeVisible();
    await page.screenshot({ path: `${OUT}/plans-${label}-chips.png` });
    const say = async (text) => { await page.fill("#agent-chat-input", text); await page.click('button[aria-label="Send"]'); };
    await say("i need a business plan");
    await expect(page.getByText("You have 10 business plans, 3 waiting for your review", { exact: false })).toBeVisible();
    await say("but you said I only have 3");
    await expect(page.getByText("Sorry, I wasn't clear.", { exact: false })).toBeVisible();
    await say("create a new one, Drone cleaning");
    await expect(page.getByText("Happy to draft your business plan for Drone cleaning", { exact: false })).toBeVisible();
    await page.locator("[data-conversation-panel]").evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.screenshot({ path: `${OUT}/plans-${label}-conversation.png` });
    expect(asked.map((a) => a.text)).toEqual(["i need a business plan", "but you said I only have 3", "create a new one, Drone cleaning"]);
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();      // the plan's one question, answered later
    // Postpone: one toast naming the item, Undo, the item gone from the card; nothing said in the chat
    await page.locator("[data-conversation-panel]").evaluate((el) => el.scrollTo(0, 0));
    const first = page.locator('[data-card="approvals"] li').first();
    if (label === "phone") { await first.getByRole("button", { name: /More/ }).click(); await page.getByRole("menuitem", { name: "Postpone" }).click(); }
    else await first.getByRole("button", { name: "Postpone" }).click();
    await page.locator("[data-postpone-choice]").getByRole("button", { name: "Next week" }).click();
    await expect(page.getByText(/^Business plan: Land Clearing postponed to /)).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(page.locator("[data-conversation-panel]").getByText(/postponed/i)).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/plans-${label}-postpone-toast.png` });
  });
}
