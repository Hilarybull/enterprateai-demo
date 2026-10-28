// The owner's recheck of 28 Oct, at 1440, 1024 and 390: the funding chat replies are the server's own, recorded from the
// tests' business (backend/tests/make_e2e_fixtures.py); the Agent Centre lists, the launch Checklist and the dashboard's
// hand-off are drawn from stubs shaped as the server answers. Nothing reaches a server or a database.
import { readFileSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const OUT = process.env.SCREENS_OUT || "e2e/out/screens";
mkdirSync(OUT, { recursive: true });
const funding = JSON.parse(readFileSync(new URL("./fixtures/funding_case.json", import.meta.url), "utf8"));
const launch = JSON.parse(readFileSync(new URL("./fixtures/launch_plan.json", import.meta.url), "utf8"));
const replies = JSON.parse(readFileSync(new URL("./fixtures/recheck_replies.json", import.meta.url), "utf8"));
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const SIZES = [[1440, 900, "1440"], [1024, 768, "1024"], [390, 844, "phone"]];
const context = { business: { name: "E2E Car Wash Abuja", stage: "Operating", location: "Abuja, Nigeria" }, revenue: { total: 994276, all_time: 994276, months: [], currency: "NGN", has_any: true },
  records: [], activity: [], approvals: { count: 0, items: [] }, research: { state: "none", max: 60 }, working: false };
const runs = {
  active: [{ id: "research:rr_x:active", title: "Do all for me: Funding readiness", label: "Do all for me: Funding readiness", summary: "0 findings · Free · Researching", bucket: "active", status: "running", display_status: "running", created_at: ago(0.3) }],
  needs_attention: [{ id: "r1", title: "Receipt Sending", label: "Receipt Sending, REC-2201026", status: "awaiting_approval", display_status: "awaiting_approval", bucket: "needs_attention", created_at: ago(170), summary: "Waiting for your approval to send." },
    { id: "r2", title: "Receipt Sending", label: "Receipt Sending, REC-1201026", status: "awaiting_approval", display_status: "awaiting_approval", bucket: "needs_attention", created_at: ago(171), summary: "Waiting for your approval to send." }],
  history: [{ id: "h1", title: "Business Plan Draft", label: "Business Plan Draft: Drone Cleaning", status: "succeeded", display_status: "succeeded", bucket: "completed", created_at: ago(30), summary: "Your business plan is ready to review." },
    { id: "h2", title: "Business Plan Draft", label: "Business Plan Draft, 24 Oct", status: "succeeded", display_status: "succeeded", bucket: "completed", created_at: ago(90), summary: "Your business plan is ready to review." },
    { id: "h3", title: "Business Plan Draft", label: "Business Plan Draft, 22 Oct", status: "succeeded", display_status: "succeeded", bucket: "completed", created_at: ago(140), summary: "Your business plan is ready to review. It was written from your business profile and the details you gave in the chat, and it is waiting in Business Blueprints." }],
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/recheck-${name}.png` });

async function stubs(page, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await stubApi(page, { transition: false });
  await page.addInitScript(() => localStorage.setItem("ea_workspace", JSON.stringify({ state: { workspaceId: "A", workspaceName: "E2E Car Wash Abuja", currency: "NGN" }, version: 0 })));
  await page.route("http://api.test/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === `/businesses/A/funding-cases/${funding.id}`) return json({ ...funding, data: { ...funding.data, currency: "NGN" }, summary: { ...funding.summary, score: 73, classification: "not_ready", open_actions: 2 } });
    if (p === `/businesses/A/launch-initiatives/${launch.id}`) return json(launch);
    if (/\/cases\/[^/]+\/overview$/.test(p)) return json({ detail: "Not found." }, 404);
    if (p === "/businesses/A/agent/assistant-context") return json(context);
    if (/\/agent\/chats\/case-/.test(p)) return json({ id: "case", messages: [] });
    if (p === "/businesses/A/agent/chats") return json({ items: [] });
    if (p === "/agent/requests" && route.request().method() === "POST") {
      const said = JSON.parse(route.request().postData() || "{}").text;
      const r = replies[said] || { kind: "answer", message: "Noted.", actions: [] };
      return json({ ...r, ...(r.cards ? { cards: r.cards.map((c) => ({ ...c, case_id: funding.id })) } : {}), ...(r.case_id ? { case_id: funding.id } : {}) });      // this page's case
    }
    if (p === "/businesses/A/agent/summary") return json({ needs_approval: [], needs_approval_count: 0, entitlement: { plan: "growth", is_paid: true } });
    if (p === "/businesses/A/workflow-runs") {
      const b = url.searchParams.get("bucket");
      const items = runs[b] || [];
      return json({ items, total: items.length, counts: { active: 1, needs_attention: 2, history: 3, completed: 3 } });
    }
    if (p === "/businesses/A/first-results") return json({ items: [] });
    return route.fallback();
  });
}

for (const [w, h, label] of SIZES) {
  test(`funding chat asks before changing, says when it is saved, and offers research before claiming it ${label}`, async ({ page }) => {
    test.setTimeout(150000);
    await stubs(page, w, h);
    await page.goto(`/funding/${funding.id}?tab=assistant`);
    await page.waitForSelector("[data-case-assistant]", { timeout: 30000 });
    const say = async (text) => { await page.fill("#case-assistant-input", text); await page.keyboard.press("Enter"); };
    await say("Please change who owns customer acquisition to Hilary");
    await expect(page.locator('[data-card="change"]')).toBeVisible();
    await shot(page, `${label}-change-card`);
    await say("Apply");
    await expect(page.getByText("Saved. Who owns customer acquisition: Hilary.")).toBeVisible();
    await say("any loan or grant that i can apply to at the moment?");
    await expect(page.getByText(/^I'll research/).last()).toBeVisible();
    await page.locator("[aria-live]").first().evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await shot(page, `${label}-saved-and-research-offer`);
    await expect(page.getByText(/I have started the research/)).toHaveCount(0);
  });

  test(`agent centre tasks: research in Active, named rows, chips that fit ${label}`, async ({ page }) => {
    test.setTimeout(150000);
    await stubs(page, w, h);
    await page.goto("/agent?tab=active");
    if (w < 1280) await page.click("[data-tasks-button]");
    const panel = page.locator("[data-task-panel]").last();
    await expect(panel.getByText("Do all for me: Funding readiness")).toBeVisible({ timeout: 30000 });
    const sizes = await panel.locator("[data-task-chips]").evaluate((row) => ({ row: Math.round(row.getBoundingClientRect().width), need: Math.round(row.scrollWidth), chips: [...row.children].map((c) => Math.round(c.getBoundingClientRect().width)) }));
    console.log(label, "chips", JSON.stringify(sizes));
    const fits = await panel.locator("[data-task-chips]").evaluate((row) => [...row.children].every((c) => c.getBoundingClientRect().right <= row.getBoundingClientRect().right + 1));
    expect(fits).toBe(true);
    await shot(page, `${label}-active`);
    await panel.getByRole("button", { name: "Back to all tasks" }).click();
    await panel.getByRole("tab", { name: /^Needs You/ }).click();
    await expect(panel.getByText("Receipt Sending, REC-2201026")).toBeVisible();
    await shot(page, `${label}-needs-you`);
    await panel.getByRole("button", { name: "Back to all tasks" }).click();
    await panel.getByRole("tab", { name: /^History/ }).click();
    await expect(panel.getByText("Business Plan Draft: Drone Cleaning")).toBeVisible();
    await shot(page, `${label}-history`);
    await panel.getByRole("button", { name: "Back to all tasks" }).click();
    await panel.getByRole("tab", { name: /^Results/ }).click();
    await expect(panel.getByText(/No results yet/)).toBeVisible({ timeout: 3000 });      // answered at once, never "Loading" for seconds
  });

  test(`launch checklist and the dashboard's hand-off ${label}`, async ({ page }) => {
    test.setTimeout(150000);
    await stubs(page, w, h);
    await page.goto(`/launch/${launch.id}?tab=overview`);
    await page.waitForSelector("[data-case-areas]", { timeout: 30000 });
    const gap = await page.evaluate(() => {
      const areas = document.querySelector("[data-case-areas]").getBoundingClientRect();
      const next = [...document.querySelectorAll("h2, h3, p")].find((e) => /Your next steps/.test(e.textContent) && e.offsetParent);
      return next ? Math.round(next.getBoundingClientRect().top - areas.bottom) : null;
    });
    console.log(label, "gap between the areas and Your next steps:", gap);
    expect(gap).not.toBeNull();
    expect(gap).toBeLessThan(72);
    await shot(page, `${label}-launch-checklist`);
    await page.goto("/dashboard");
    await page.locator("[data-first-result-panel]").waitFor({ timeout: 30000 });
    const box = page.locator('[data-agent-card] input, [data-agent-card] textarea').first();
    await box.fill("how many business plans do i have");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/agent\?chat=/);
    await shot(page, `${label}-dashboard-handoff`);
  });
}
