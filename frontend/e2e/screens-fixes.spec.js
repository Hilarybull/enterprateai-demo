// The owner's fixes of 27 Oct, each seen in a browser: the slow scenario, the formatted preview, one concentration figure,
// the funding score beside the chat, the module chats kept to their own topic, the launch plan's side cards and title, the
// idea page loading, and every card's "View …" link opening beside the chat. Every API call is answered by stubs shaped as
// the server answers them: nothing reaches a server or a database. Run: npx playwright test screens-fixes
import { readFileSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const OUT = process.env.SCREENS_OUT || "e2e/out/screens";
mkdirSync(OUT, { recursive: true });
const funding = JSON.parse(readFileSync(new URL("./fixtures/funding_case.json", import.meta.url), "utf8"));
const launch = JSON.parse(readFileSync(new URL("./fixtures/launch_plan.json", import.meta.url), "utf8"));
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const shot = (page, name) => page.screenshot({ path: `${OUT}/fix-${name}.png` });
const business = { name: "E2E Car Wash Abuja", stage: "Operating", sector: "Car wash and detailing", location: "Abuja, Nigeria", founded: "2021", employees: "12",
  description: "Hand car washing and interior detailing for offices and households in Abuja.", website: "e2ecarwash.ng" };
const activity = [{ kind: "invoice_paid", title: "Invoice paid", detail: "₦120,000 from Raphael", at: ago(2) }, { kind: "customer_added", title: "New customer added", detail: "Northbridge Solutions", at: ago(6) },
  { kind: "invoice_sent", title: "Invoice sent", detail: "₦80,000 to Ada", at: ago(30) }, { kind: "research", title: "Research finished", detail: "Funding options", at: ago(50) },
  { kind: "quote_sent", title: "Quotation sent", detail: "₦45,000 to Bola", at: ago(90) }, { kind: "invoice_paid", title: "Invoice paid", detail: "₦60,000 from Ada", at: ago(140) }];
const context = { business, revenue: { total: 994276, pct: 12, months: [40, 55, 48, 62, 70, 66, 74, 80, 77, 85, 90, 99].map((n) => n * 1000), currency: "NGN", has_any: true },
  records: [{ key: "profile", label: "Business profile", available: true }], activity: activity.slice(0, 3), approvals: { count: 0, items: [] }, research: { state: "none", max: 60 }, working: false,
  // the dashboard's figure (business.concentration): one number on both
  risk: { customer: "Raphael", share: 99.9, others: 0.1, tail: 0, level: "High" },
  idea: { answers: { description: "Mobile car interior detailing", customer: "SMEs with staff cars in Abuja", price: 25000, cost: 11000, capacity: 60, demand: "assumption" },
    inputs: [{ key: "customer", label: "Customer profile", available: true }, { key: "demand", label: "Current demand evidence", available: false }],
    score_out_of_100: 57, viability: "Fair", strengths: ["Target customer identified", "Workable margin"], weaknesses: ["Demand is largely unproven"],
    metrics: [{ label: "Margin", value: "56%" }], criteria: [{ key: "margin", label: "Margin", state: "met" }, { key: "demand", label: "Demand evidence", state: "unmet" }] } };

async function stubs(page, extra = async () => false) {
  await stubApi(page, { transition: false });
  await page.addInitScript(() => localStorage.setItem("ea_workspace", JSON.stringify({ state: { workspaceId: "A", workspaceName: "E2E Car Wash Abuja", currency: "NGN" }, version: 0 })));
  await page.route("http://api.test/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (await extra(p, url, json, route)) return undefined;
    if (p === "/businesses/A/agent/assistant-context") return json(context);
    if (p === "/businesses/A/agent/activity") return json({ items: activity });
    if (p === "/businesses/A/agent/chats") return json({ items: [] });
    return route.fallback();
  });
}

test("1. a slow scenario says it's working, then posts its result in the chat", async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let asked = 0;
  await stubs(page, async (p, url, json, route) => {
    if (p === "/businesses/A/agent/summary") return json({ needs_approval: [], needs_approval_count: 0, entitlement: { plan: "growth", is_paid: true } }), true;
    if (p === "/businesses/A/workflow-runs") return json({ items: [], total: 0, counts: {} }), true;
    if (p === "/businesses/A/agent/chat/scenario" && route.request().method() === "POST") return json({ type: "scenario", kind: "order_reduction", pending: true, job_id: "j1", title: "Main customer orders down 30%" }), true;
    if (p === "/businesses/A/agent/chat/scenario/j1") {
      asked += 1;
      return json(asked < 2 ? { pending: true, job_id: "j1" } : { type: "scenario", kind: "order_reduction", title: "Main customer orders down 30%", months: 6, worse: true, to: "/simulation",
        summary: "If your main customer's orders fell by about 30%, monthly revenue would go from ₦331,425 to ₦232,100 and profit from ₦181,425 to ₦82,100. After 6 months you'd have about ₦492,600 in cash, against ₦1,088,550 as things are.",
        rows: [{ label: "Monthly revenue", before: "₦331,425", after: "₦232,100" }, { label: "Monthly profit", before: "₦181,425", after: "₦82,100" }, { label: "Cash after 6 months", before: "₦1,088,550", after: "₦492,600" }] }), true;
    }
    return false;
  });
  await page.goto("/agent");
  await page.getByRole("button", { name: "Simulate order reduction" }).click();
  await expect(page.getByText("This one is taking a little longer.")).toBeVisible();
  await page.locator("[data-conversation-panel]").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot(page, "1a-scenario-working");
  await expect(page.locator('[data-card="scenario"]')).toBeVisible({ timeout: 20000 });
  await page.locator("[data-conversation-panel]").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot(page, "1b-scenario-result");
  expect(await page.locator("body").textContent()).not.toContain("check the Agent Centre");
  // 3. the concentration figure: the dashboard's, 99.9%
  await page.locator("[data-conversation-panel]").evaluate((el) => el.scrollTo(0, 0));
  await expect(page.getByText("Raphael makes up 99.9% of your customer revenue.", { exact: false })).toBeVisible();
  await shot(page, "3-concentration");
  // the Agent Centre's links: profile and history open beside the chat
  await page.getByRole("button", { name: "View profile →" }).click();
  await expect(page.getByRole("dialog", { name: "Business profile" })).toBeVisible();
  await shot(page, "7a-agent-view-profile");
  await page.getByRole("button", { name: "Close" }).click();
  await page.locator('[data-side="activity"]').getByRole("button", { name: "View all →" }).click();
  await expect(page.locator("[data-activity-all] li")).toHaveCount(6);
  await shot(page, "7b-agent-activity-all");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/agent$/);
});

test("2. Review shows the document formatted, not its HTML or markdown", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubs(page, async (p, url, json) => {
    if (p === "/businesses/A/agent/summary") return json({ needs_approval: [{ type: "draft", kind: "business_plan", draft_id: "d1", title: "Business Plan for Land Clearing", subtitle: "Draft ready for review", age: "1d", to: "/blueprint?review=d1", created_at: ago(24) }], needs_approval_count: 1, entitlement: { plan: "growth", is_paid: true } }), true;
    if (p === "/businesses/A/workflow-runs") return json({ items: [], total: 0, counts: {} }), true;
    if (p === "/businesses/A/agent/chat/preview") return json({ found: true, kind: "business_plan", title: "Business Plan for Land Clearing", to: "/blueprint?review=d1", editable: true,
      text: '<div class="cover-page">\n# Business Plan\n\n**Land Clearing**\n\nAbuja, Nigeria\n</div>\n<div class="page-break"></div>\n\n## Executive Summary\n\nLand Clearing prepares farmland for planting across the Federal Capital Territory.\n\n## Services\n\n- Bush clearing\n- Stump removal\n\n| Service | Price |\n| --- | --- |\n| Bush clearing (per hectare) | ₦180,000 |\n| Stump removal (per stump) | ₦6,500 |' }), true;
    return false;
  });
  await page.goto("/agent");
  await page.locator('[data-card="approvals"] li').first().getByRole("button", { name: "Review" }).click();
  const doc = page.locator("[data-preview-text]");
  await expect(doc.locator("h2", { hasText: "Executive Summary" })).toBeVisible();
  expect(await doc.textContent()).not.toMatch(/<div|##|\*\*/);
  await doc.scrollIntoViewIfNeeded();
  await shot(page, "2-review-formatted");
});

const fundingSubject = { ...funding, title: "₦25m funding to buy car wash equipment", data: { ...funding.data, currency: "NGN" },
  summary: { ...funding.summary, score: 40, classification: "not_ready", score_partial: false, open_actions: 5 } };
const fundingChat = [
  { role: "user", content: "I need funding for new equipment.", at: ago(3) },
  { role: "assistant", content: "Your funding case is set up. You're at 40/100.", at: ago(3), links: [{ label: "Open your funding case", to: `/funding/${funding.id}?tab=overview` }] },
  { role: "user", content: "Am I ready to launch mobile detailing?", at: ago(2) },
  { role: "assistant", content: "Your launch plan is at 0/100 so far.", at: ago(2) },
  { role: "user", content: "What's missing for the funding?", at: ago(1) },
  { role: "assistant", content: "Three things: your use of funds, a cash forecast and proof of revenue.", at: ago(1) },
];

test("4a. Funding: the score beside the chat, no link to the case inside it, no launch exchange", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubs(page, async (p, url, json) => {
    if (p === `/businesses/A/funding-cases/${funding.id}`) return json(fundingSubject), true;
    if (p.endsWith(`/cases/${funding.id}/overview`)) return json({ detail: "Not found." }, 404), true;
    if (p === `/businesses/A/agent/chats/case-${funding.id}`) return json({ id: `case-${funding.id}`, messages: fundingChat }), true;
    return false;
  });
  await page.goto(`/funding/${funding.id}?tab=assistant`);
  await page.waitForSelector('[data-side="score"]', { timeout: 30000 });
  await expect(page.locator('[data-side="download"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Open your funding case" })).toHaveCount(0);
  await expect(page.getByText("Am I ready to launch mobile detailing?")).toHaveCount(0);
  await shot(page, "4a-funding");
  // its links: View profile and View all beside the chat, View checklist the Checklist tab
  await page.getByRole("button", { name: "View profile →" }).click();
  await shot(page, "7c-funding-view-profile");
  await page.getByRole("button", { name: "Close" }).click();
  await page.locator('[data-side="activity"]').getByRole("button", { name: "View all →" }).click();
  await shot(page, "7d-funding-activity-all");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "View checklist →" }).click();
  await expect(page).toHaveURL(new RegExp(`/funding/${funding.id}\\?tab=overview`));
  await shot(page, "7e-funding-view-checklist");
});

test("4b. Launch: the service in the title, the Readiness Snapshot and why not launch yet", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubs(page, async (p, url, json) => {
    if (p === `/businesses/A/launch-initiatives/${launch.id}`) return json(launch), true;
    if (p.endsWith(`/cases/${launch.id}/overview`)) return json({ detail: "Not found." }, 404), true;
    if (p === `/businesses/A/agent/chats/case-${launch.id}`) return json({ id: `case-${launch.id}`, messages: [{ role: "user", content: "Am I ready to launch?", at: ago(1) },
      { role: "assistant", content: "Not yet: there isn't enough evidence to check it. Start with who your customers are and some dated proof of demand.", at: ago(1) }] }), true;
    return false;
  });
  await page.goto(`/launch/${launch.id}?tab=assistant`);
  await page.waitForSelector('[data-side="launch-snapshot"]', { timeout: 30000 });
  await expect(page.locator("[data-assistant-header] h1")).toHaveText("Launch Readiness: Mobile car detailing");
  await shot(page, "4b-launch");
  await page.locator('[data-side="launch-snapshot"]').getByRole("button", { name: "View details →" }).click();
  await expect(page.locator("[data-breakdown] li")).toHaveCount(launch.sections.length);
  await shot(page, "7f-launch-view-details");
  await page.getByRole("button", { name: "Close" }).click();
  await page.locator('[data-side="launch-why-not"]').getByRole("button", { name: "View all →" }).click();
  await shot(page, "7g-launch-why-not-all");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(new RegExp(`/launch/${launch.id}\\?tab=assistant`));
});

test("4c. Idea: a loading state until the data is in, then the chat without the launch score", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let release;
  const held = new Promise((ok) => { release = ok; });
  await stubs(page, async (p, url, json) => {
    if (p === "/businesses/A/agent/assistant-context") { await held; return json(context), true; }
    if (p === "/businesses/A/agent/chats/idea-check") return json({ id: "idea-check", messages: [{ role: "user", content: "Is my idea worth launching?", at: ago(1) },
      { role: "assistant", content: "You're not quite ready yet. You still need to show some evidence of demand, like enquiries or pilot customers. Your launch score is now 0/100 so far, with 16 things to do.", at: ago(1) }] }), true;
    return false;
  });
  await page.goto("/check/idea?tab=assistant");
  await page.waitForSelector("[data-assistant-loading]", { timeout: 30000 });
  await shot(page, "4c-idea-loading");
  release();
  await expect(page.getByText("You're not quite ready yet.", { exact: false })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("launch score", { exact: false })).toHaveCount(0);
  await shot(page, "4d-idea-ready");
  await page.getByRole("button", { name: "View profile →" }).click();
  await shot(page, "7h-idea-view-profile");
  await page.getByRole("button", { name: "Close" }).click();
});
