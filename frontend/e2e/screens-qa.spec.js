// The owner's QA list of 27 Oct, items 9 to 23, seen in a browser at 1440×900 and 390×844: the Funding and Launch tabs
// keep one header and the side column, the Checklist shows each area at its top, Documents are cards, the idea's Research
// and Catalogue tabs say where they stand, and the dashboard's approvals use the Agent Centre's words. Every API call is a
// stub: nothing reaches a server or a database.
import { readFileSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const OUT = process.env.SCREENS_OUT || "e2e/out/screens";
mkdirSync(OUT, { recursive: true });
const funding = JSON.parse(readFileSync(new URL("./fixtures/funding_case.json", import.meta.url), "utf8"));
const launch = JSON.parse(readFileSync(new URL("./fixtures/launch_plan.json", import.meta.url), "utf8"));
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const context = { business: { name: "E2E Car Wash Abuja", stage: "Operating", sector: "Car wash and detailing", location: "Abuja, Nigeria" },
  revenue: { total: 994276, pct: null, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 994276], currency: "NGN", has_any: true, monthly: 994276, monthly_months: 1 },
  records: [], activity: [{ kind: "invoice_paid", title: "Invoice paid", detail: "₦120,000 from Raphael", at: ago(2) }], approvals: { count: 0, items: [] }, research: { state: "none" }, working: false,
  idea: { answers: { description: "Mobile car interior detailing", price: 25000, cost: 11000 }, inputs: [], score_out_of_100: 57, criteria: [], catalogue: { listed: false } } };
const materials = { kinds: [{ kind: "readiness_report", title: "Readiness report" }, { kind: "executive_summary", title: "Executive summary" }, { kind: "pitch_outline", title: "Pitch outline" }],
  items: [{ id: "m1", kind: "readiness_report", title: "Readiness report", version: 2, as_of: "2026-10-26", status: "draft" }] };

async function open(page, at, size, extra = async () => false) {
  await page.setViewportSize({ width: size[0], height: size[1] });
  await stubApi(page, { transition: false });
  await page.addInitScript(() => localStorage.setItem("ea_workspace", JSON.stringify({ state: { workspaceId: "A", workspaceName: "E2E Car Wash Abuja", currency: "NGN" }, version: 0 })));
  await page.route("http://api.test/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (await extra(p, json, route)) return undefined;
    if (p === `/businesses/A/funding-cases/${funding.id}`) return json({ ...funding, data: { ...funding.data, currency: "NGN" }, summary: { ...funding.summary, score: 40, classification: "not_ready", open_actions: 5 } });
    if (p === `/businesses/A/launch-initiatives/${launch.id}`) return json(launch);
    if (/\/cases\/[^/]+\/overview$/.test(p)) return json({ detail: "Not found." }, 404);
    if (/\/materials$/.test(p)) return json(materials);
    if (p === "/businesses/A/agent/assistant-context") return json(context);
    if (p === "/businesses/A/agent/chats" || /\/agent\/chats\//.test(p)) return json({ items: [], messages: [] });
    if (p === "/businesses/A/research-runs") return json({ runs: [] });
    return route.fallback();
  });
  await page.goto(at);
}

for (const [w, h, label] of [[1440, 900, "1440"], [390, 844, "phone"]]) {
  test(`case tabs keep one header and the side column ${label}`, async ({ page }) => {
    test.setTimeout(150000);
    await open(page, `/funding/${funding.id}?tab=overview`, [w, h]);
    await page.waitForSelector("[data-assistant-header]", { timeout: 30000 });
    await expect(page.locator("[data-case-areas]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit inputs" })).toHaveCount(0);      // only in the ⋯ menu
    if (label === "1440") await expect(page.locator('[data-case-side] [data-side="score"]')).toBeVisible();
    await page.screenshot({ path: `${OUT}/qa-${label}-funding-checklist.png` });
    await open(page, `/launch/${launch.id}?tab=overview`, [w, h]);
    await page.waitForSelector("[data-case-areas]", { timeout: 30000 });
    await expect(page.locator("[data-assistant-header] h1")).toHaveText("Launch Readiness: Mobile car detailing");
    await page.screenshot({ path: `${OUT}/qa-${label}-launch-checklist.png` });
    await page.getByRole("tab", { name: "Documents" }).click();
    await expect(page.locator("[data-case-doc]")).toHaveCount(1);
    await expect(page.locator("[data-case-prepare] li")).toHaveCount(3);
    await page.screenshot({ path: `${OUT}/qa-${label}-launch-documents.png`, fullPage: label === "phone" });
  });

  test(`idea research and catalogue tabs ${label}`, async ({ page }) => {
    test.setTimeout(120000);
    let added = false;
    await open(page, "/check/idea?tab=research", [w, h], async (p, json) => {
      if (p === "/businesses/A/catalogue/from-check") { added = true; return json({ saved: true, created: true, message: "Added in your catalogue: Mobile car interior detailing." }), true; }
      if (p === "/businesses/A/agent/assistant-context" && added) return json({ ...context, idea: { ...context.idea, catalogue: { listed: true, name: "Mobile car interior detailing", price: 25000 } } }), true;
      return false;
    });
    await expect(page.locator("[data-research-empty]")).toContainText("No research on this idea yet");
    await expect(page.getByRole("button", { name: "Research it for me" })).toBeVisible();
    await page.screenshot({ path: `${OUT}/qa-${label}-idea-research.png` });
    await page.getByRole("tab", { name: "Catalogue" }).click();
    await expect(page.locator("[data-catalogue-missing]")).toBeVisible();
    await page.screenshot({ path: `${OUT}/qa-${label}-idea-catalogue.png` });
    await page.getByRole("button", { name: "Add to catalogue" }).click();
    await expect(page.locator("[data-catalogue-listed]")).toBeVisible();
    await page.screenshot({ path: `${OUT}/qa-${label}-idea-catalogue-added.png` });
  });

  test(`dashboard approvals and the floating button ${label}`, async ({ page }) => {
    test.setTimeout(120000);
    await stubApi(page, { transition: false });
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/dashboard");
    await page.locator("[data-first-result-panel]").waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    const bars = page.locator("[data-draft-actions]");
    if (await bars.count()) await expect(bars.first()).toContainText("ReviewApproveEditPostpone");
    await page.screenshot({ path: `${OUT}/qa-${label}-dashboard.png` });
    if (label === "phone") {
      // Nothing to press sits under the floating button, wherever the page is scrolled
      const covered = await page.evaluate(async () => {
        const fab = [...document.querySelectorAll("button")].find((b) => getComputedStyle(b).position === "fixed" && b.getBoundingClientRect().bottom > innerHeight - 120);
        if (!fab) return "no button";
        const area = document.querySelector('[data-tour="content-area"]') || document.scrollingElement;
        const hits = new Set();
        for (let y = 0; y < area.scrollHeight; y += 200) {
          area.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 30));
          const r = fab.getBoundingClientRect();
          fab.style.pointerEvents = "none";
          const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest("button, a");
          fab.style.pointerEvents = "";
          if (under && under !== fab) hits.add(under.textContent.trim().slice(0, 40) || under.getAttribute("aria-label"));
        }
        return [...hits];
      });
      console.log("under the floating button while scrolling:", JSON.stringify(covered));
      // Scrolled down it steps aside; back at the top it returns
      await page.evaluate(() => (document.querySelector('[data-tour="content-area"]') || document.scrollingElement).scrollTo(0, 0));
      await page.waitForTimeout(200);
      await page.evaluate(() => (document.querySelector('[data-tour="content-area"]') || document.scrollingElement).scrollBy(0, 400));
      await page.waitForTimeout(400);
      await expect(page.locator("[data-agent-launcher]")).toHaveAttribute("aria-hidden", "true");
      await page.screenshot({ path: `${OUT}/qa-phone-dashboard-scrolling.png` });
      await page.evaluate(() => (document.querySelector('[data-tour="content-area"]') || document.scrollingElement).scrollTo(0, 99999));
      await page.screenshot({ path: `${OUT}/qa-phone-dashboard-bottom.png` });
    }
  });
}

// The owner, 28 Oct: "why didn't it scroll to the latest chat, on coming here from the landing page"
test("a long conversation opens at its newest message", async ({ page }) => {
  test.setTimeout(90000);
  const long = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: i === 13 ? "This is the newest reply." : `Message ${i + 1} about the funding case.`, at: ago(14 - i),
    ...(i === 13 ? { cards: [{ type: "next", case_id: funding.id }] } : {}) }));
  await open(page, `/funding/${funding.id}?tab=assistant`, [1440, 900], async (p, json) => (/\/agent\/chats\/case-/.test(p) ? (json({ id: `case-${funding.id}`, messages: long }), true) : false));
  await page.waitForSelector("[data-case-assistant]", { timeout: 30000 });
  await page.waitForTimeout(1500);
  const seen = await page.getByText("This is the newest reply.").evaluate((el) => {
    const box = el.closest("[aria-live]").getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
  });
  expect(seen).toBe(true);
  await page.screenshot({ path: `${OUT}/qa-1440-opens-at-latest.png` });
});
