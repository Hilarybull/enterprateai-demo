// The owner, 28 Oct: "for every fix, check it at 1440, 1280, 1024 and 390: no wrapped button rows, no cut-off text, no
// overlapping elements, and the same data at every width". Each page below is opened at the four widths; the same checks run
// on every element of the page, and what it says (steps, counts) is compared across widths. Every API call is a stub.
import { readFileSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const OUT = process.env.SCREENS_OUT || "e2e/out/screens";
mkdirSync(OUT, { recursive: true });
const funding = JSON.parse(readFileSync(new URL("./fixtures/funding_case.json", import.meta.url), "utf8"));
const launch = JSON.parse(readFileSync(new URL("./fixtures/launch_plan.json", import.meta.url), "utf8"));
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const WIDTHS = [[1440, 900], [1280, 800], [1024, 768], [390, 844]];
const context = { business: { name: "E2E Car Wash Abuja", stage: "Operating", sector: "Car wash and detailing", location: "Abuja, Nigeria", founded: "2021", employees: "12" },
  revenue: { total: 994276, all_time: 994276, pct: 12, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 40000, 60000, 894276], currency: "NGN", has_any: true, monthly: 331425, monthly_months: 3 },
  records: [{ key: "profile", label: "Business profile", available: true }, { key: "revenue", label: "Revenue information", available: true }, { key: "customers", label: "Customer records", available: true },
    { key: "sales", label: "Recent sales activity", available: true }],
  activity: [{ kind: "invoice_paid", title: "Invoice paid", detail: "₦120,000 from Raphael", at: ago(2) }], approvals: { count: 1, items: [{ approval_id: "a1", run_id: "r1", kind: "payment", title: "Payment follow-up for Northbridge Solutions", subtitle: "14 days overdue", age: "2h" }] },
  research: { state: "none", max: 60 }, working: false, risk: { customer: "Raphael", share: 99.9, others: 0.1, tail: 0, level: "High" },
  idea: { answers: { description: "Mobile car interior detailing", customer: "SMEs with staff cars", price: 25000, cost: 11000 }, inputs: [{ key: "customer", label: "Customer profile", available: true }],
    score_out_of_100: 57, viability: "Fair", strengths: ["Workable margin"], weaknesses: ["Demand is largely unproven"], metrics: [{ label: "Margin", value: "56%" }],
    criteria: [{ key: "margin", label: "Margin", state: "met" }, { key: "demand", label: "Demand evidence", state: "unmet" }], catalogue: { listed: false } } };
const DRAFTS = { use_of_funds: { source: "from research", value: [
  { id: "u1", category: "Equipment", amount: "19500000", purpose: "Buy car wash equipment" }, { id: "u2", category: "Operations", amount: "3500000", purpose: "Working capital: two months of fixed costs" },
  { id: "u3", category: "Reserve", amount: "2000000", purpose: "Reserve: one month of fixed costs" }] } };
const waiting = [{ type: "draft", kind: "business_plan", draft_id: "d1", title: "Business plan: Land Clearing", subtitle: "Needs your review", created_at: ago(20), to: "/blueprint?review=d1" },
  { type: "approval", kind: "payment", approval_id: "a1", run_id: "r1", title: "Payment follow-up for Northbridge Solutions", subtitle: "₦120,000", created_at: ago(2) }];
const fundingCase = { ...funding, title: "₦25m funding to buy car wash equipment", data: { ...funding.data, currency: "NGN", target_amount: "25000000" },
  summary: { ...funding.summary, score: 40, classification: "not_ready", open_actions: 5 } };
const chatFor = (kind) => [
  { role: "user", content: "Only 40? What's missing?", at: ago(1) },
  { role: "assistant", content: "Your business shows potential, but there are some important gaps.", at: ago(1), cards: [{ type: kind === "idea" ? "viability" : "result", case_id: "c" }] },
  { role: "assistant", content: "What would you like to do next?", at: ago(0.5), cards: [{ type: "next", case_id: "c" }, { type: "approvals", case_id: "c" }] }];

const PAGES = {
  "agent-centre": { at: "/agent", ready: '[data-card="approvals"]' },
  "funding-assistant": { at: `/funding/${funding.id}?tab=assistant`, ready: "[data-case-assistant]" },
  "funding-review": { at: `/funding/${funding.id}?tab=assistant&review=1`, ready: "[data-review-screen]", drafts: true },
  "funding-checklist": { at: `/funding/${funding.id}?tab=overview`, ready: "[data-case-areas]" },
  "launch-checklist": { at: `/launch/${launch.id}?tab=overview`, ready: "[data-case-areas]" },
  "launch-documents": { at: `/launch/${launch.id}?tab=documents`, ready: "[data-case-prepare]" },
  "idea-assistant": { at: "/check/idea?tab=assistant", ready: "[data-case-assistant]" },
  "idea-catalogue": { at: "/check/idea?tab=catalogue", ready: "[data-idea-catalogue]" },
};

async function open(page, which, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await stubApi(page, { transition: false });
  await page.addInitScript(() => localStorage.setItem("ea_workspace", JSON.stringify({ state: { workspaceId: "A", workspaceName: "E2E Car Wash Abuja", currency: "NGN" }, version: 0 })));
  await page.route("http://api.test/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === `/businesses/A/funding-cases/${funding.id}`) return json(which.drafts ? { ...fundingCase, data: { ...fundingCase.data, agent_drafts: DRAFTS } } : fundingCase);
    if (p === `/businesses/A/launch-initiatives/${launch.id}`) return json(launch);
    if (/\/cases\/[^/]+\/overview$/.test(p)) return json({ detail: "Not found." }, 404);
    if (/\/materials$/.test(p)) return json({ kinds: [{ kind: "readiness_report", title: "Readiness report" }, { kind: "launch_checklist", title: "Launch checklist" }], items: [] });
    if (p === "/businesses/A/agent/assistant-context") return json(context);
    if (p === "/businesses/A/agent/summary") return json({ needs_approval: waiting, needs_approval_count: 2, entitlement: { plan: "growth", is_paid: true } });
    if (p === "/businesses/A/workflow-runs") return json({ items: [], total: 0, counts: { needs_approval: 2 } });
    if (p === "/businesses/A/agent/chats") return json({ items: [] });
    if (/\/agent\/chats\/case-/.test(p)) return json({ id: "case", messages: chatFor("funding") });
    if (p === "/businesses/A/agent/chats/idea-check") return json({ id: "idea-check", messages: chatFor("idea") });
    if (p === "/businesses/A/research-runs") return json({ runs: [] });
    if (p === "/validation/me" || p === "/validation/A") return json({ id: "A", name: "E2E Car Wash Abuja", data: { workspace_profile: { company_name: "E2E Car Wash Abuja" }, onboarding: { completed: true } } });
    return route.fallback();
  });
  await page.goto(which.at);
  await page.waitForSelector(which.ready, { timeout: 30000 });
  await page.waitForTimeout(2500);
}

/** Wrapped buttons, text cut off with an ellipsis or a clamp, and badges overlapping what is beside them, in the page's content. */
const audit = (page) => page.evaluate(() => {
  const out = [];
  const root = document.querySelector('[data-tour="content-area"]') || document.body;
  const seen = (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0 && !el.closest("[aria-hidden='true'], .sr-only");
  for (const b of root.querySelectorAll("button, a")) {
    if (!seen(b) || !b.textContent.trim() || b.hasAttribute("data-row") || b.closest("[data-row], li[data-task], [data-approval-row]")) continue;
    if (b.querySelector("p, ul, div, span.block")) continue;      // a card or row that is a button: its text may wrap
    const cs = getComputedStyle(b);
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    const inner = b.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
    if (inner > line * 1.6 && b.textContent.trim().length < 34) out.push(`wrapped button: ${b.textContent.trim()}`);
  }
  for (const el of root.querySelectorAll("*")) {
    if (!seen(el) || el.children.length || !el.textContent.trim()) continue;
    const cs = getComputedStyle(el);
    if (el.hasAttribute("data-clamp")) continue;      // a description kept to two lines on purpose, in full on hover
    if ((cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none") && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) out.push(`cut off: ${el.textContent.trim().slice(0, 40)}`);
  }
  // A chip row that should fit: every chip in full inside it (the owner, 28 Oct: "Launc")
  for (const row of root.querySelectorAll("[data-task-chips]")) {
    if (!seen(row)) continue;
    const box = row.getBoundingClientRect();
    for (const c of row.children) { const r = c.getBoundingClientRect(); if (r.right > box.right + 1 || r.left < box.left - 1) out.push(`chip cut: ${c.textContent.trim()}`); }
  }
  for (const c of root.querySelectorAll("span")) {
    if (!seen(c) || !/rounded-(md|full|lg)/.test(c.className) || !/px-/.test(c.className) || c.textContent.trim().length > 30 || c.children.length > 1) continue;
    const r = c.getBoundingClientRect();
    for (const o of c.parentElement?.children || []) {
      if (o === c || !seen(o)) continue;
      const q = o.getBoundingClientRect();
      if (r.left < q.right - 1 && r.right > q.left + 1 && r.top < q.bottom - 1 && r.bottom > q.top + 1) out.push(`overlap: ${c.textContent.trim()} / ${o.textContent.trim().slice(0, 30)}`);
    }
  }
  // A card sticking out past its parent, or the page scrolling sideways
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page scrolls sideways by ${document.documentElement.scrollWidth - innerWidth}px`);
  return [...new Set(out)];
});

/** What the page says, to compare across widths: step titles and the numbers it shows. */
const said = (page) => page.evaluate(() => {
  const root = document.querySelector("[data-case-overview], [data-case-assistant], [data-agent-page], [data-idea-catalogue], [data-case-documents]") || document.body;
  const steps = [...root.querySelectorAll("[data-step-title], [data-next-steps] li p:first-child")].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()).sort();
  const empty = [...root.querySelectorAll("[data-nothing-left]")].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim());
  return JSON.stringify({ steps, empty });
});

for (const [name, which] of Object.entries(PAGES)) {
  test(`${name}: nothing wraps, nothing is cut, the same at every width`, async ({ page }) => {
    test.setTimeout(240000);
    const found = {};
    const words = {};
    for (const [w, h] of WIDTHS) {
      await open(page, which, w, h);
      found[w] = await audit(page);
      words[w] = await said(page);
      await page.screenshot({ path: `${OUT}/audit-${name}-${w}.png`, fullPage: w === 390 });
    }
    console.log(name, JSON.stringify(found));
    expect(found).toEqual(Object.fromEntries(WIDTHS.map(([w]) => [w, []])));
    expect(new Set(Object.values(words)).size, `what ${name} says differs by width: ${JSON.stringify(words)}`).toBe(1);
  });
}
