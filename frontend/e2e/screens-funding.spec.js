// The Funding Readiness Assistant, screen by screen as the owner's mockups show it (WeSendit/Funding Readiness, 27 Oct),
// at desktop and phone width. Every API call is answered by stubs: the business is the tests' synthetic one, shaped like the
// owner's (a car wash in Abuja, in naira); nothing reaches a server or a database. Run: npx playwright test screens-funding
import { readFileSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const OUT = process.env.SCREENS_OUT || "e2e/out/screens";
mkdirSync(OUT, { recursive: true });
const fixture = JSON.parse(readFileSync(new URL("./fixtures/funding_case.json", import.meta.url), "utf8"));
const ID = fixture.id;
const at = (min) => new Date(Date.UTC(2026, 9, 27, 9, min)).toISOString();
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

const caseAt = (score, extra = {}) => ({ ...fixture, title: "₦25m funding to buy car wash equipment",
  data: { ...fixture.data, currency: "NGN", target_amount: "25000000", purpose: "buy car wash equipment", ...(extra.data || {}) },
  summary: { ...fixture.summary, score, classification: score >= 80 ? "ready" : "not_ready", score_partial: false, open_actions: score >= 80 ? 0 : 5, confidence: score >= 80 ? "high" : "medium" },
  sections: extra.sections || fixture.sections });
const context = (extra = {}) => ({
  business: { name: "E2E Car Wash Abuja", stage: "Operating", sector: "Car wash and detailing", location: "Abuja, Nigeria", founded: "2021", employees: "12" },
  revenue: { total: 994276, pct: 12, months: [40, 55, 48, 62, 70, 66, 74, 80, 77, 85, 90, 99].map((n) => n * 1000), currency: "NGN", has_any: true },
  records: [{ key: "profile", label: "Business profile", available: true }, { key: "revenue", label: "Revenue information", available: true },
    { key: "customers", label: "Customer records", available: true }, { key: "pricing", label: "Pricing", available: true },
    { key: "costs", label: "Operating costs", available: true }, { key: "sales", label: "Recent sales activity", available: true }],
  activity: [{ kind: "invoice_paid", title: "Invoice paid", detail: "₦120,000 from BrightTech Ltd", at: ago(0.09) },
    { kind: "customer_added", title: "New customer added", detail: "Northbridge Solutions", at: ago(0.2) },
    { kind: "research", title: "Research ready to review", detail: "Funding readiness", at: ago(1) },
    { kind: "quote_sent", title: "Quotation sent", detail: "₦185,000 to Metro Systems", at: ago(2) }],
  approvals: { count: 0, items: [] }, research: { state: "none", max: 60 }, working: false, risk: null, ...extra });

const SCREENS = {
  "funding-01": { score: 40, chat: [
    { role: "user", content: "Hey EnterprateAI, I need funding for my business.", at: at(24) },
    { role: "assistant", content: "Of course. Let me first check what I already know about your business.", at: at(24), cards: [{ type: "records", case_id: ID }] }] },
  "funding-03": { score: 40, chat: [
    { role: "assistant", content: "Based on the information currently available, your business is approximately 40/100 funding ready.", at: at(25) },
    { role: "user", content: "Only 40? What's missing?", at: at(26) },
    { role: "assistant", content: "Your business shows potential, but there are some important gaps.", at: at(26), cards: [{ type: "result", case_id: ID }] }] },
  "funding-04": { score: 40, chat: [
    { role: "assistant", content: "Your business shows potential, but there are some important gaps. I need stronger information around your funding requirement, use of funds, financial forecast, traction and supporting market evidence.", at: at(25) },
    { role: "assistant", content: "I can help research and prepare the missing information, then present everything to you for review before it becomes part of your business data. Or, if you prefer, you can enter the missing information yourself.", at: at(25) },
    { role: "user", content: "Go ahead. Help me complete it.", at: at(26) },
    { role: "assistant", content: "I'll research the market and draft what I can. Up to 60 credits. Shall I start?", at: at(26), cards: [{ type: "choose", case_id: ID, price: 60 }] }] },
  "funding-05": { score: 40, ctx: { working: true }, chat: [
    { role: "user", content: "Help me complete it.", at: at(26) },
    { role: "assistant", content: "Understood. I'll prepare the missing information and supporting evidence.", at: at(26), cards: [{ type: "progress", case_id: ID }] }] },
  "funding-06": { score: 40, review: true, chat: [
    { role: "assistant", content: "I've completed the enrichment. Please review the information before I use it.", at: at(27) },
    { role: "user", content: "The use of funds allocation looks ok, but let me edit the supporting market evidence.", at: at(28) }] },
  "funding-02": { score: 88, chat: [
    { role: "user", content: "Yes. That looks right. Adopt it.", at: at(28) },
    { role: "assistant", content: "Done. Updating your business data.", at: at(28) },
    { role: "assistant", content: "Running your Funding Readiness assessment again…", at: at(28), cards: [{ type: "score_change", case_id: ID, before: 40, after: 88 }] }] },
  "funding-07": { score: 92, ctx: { approvals: { count: 1, items: [{ approval_id: "q1", run_id: "rq", kind: "quotation", title: "Quotation for SAT Limited", subtitle: "Ready to send", age: "1d" }] } }, chat: [
    { role: "user", content: "What should I do next?", at: at(26) },
    { role: "assistant", content: "What would you like to do next? I can prepare your Business Plan, help you find suitable funding opportunities, or continue with the quotation you were preparing.", at: at(26), cards: [{ type: "next", case_id: ID }] }] },
  "funding-08": { score: 92, ctx: { approvals: { count: 2, items: [
    { approval_id: "a1", run_id: "r1", kind: "payment", title: "Payment follow-up draft", subtitle: "For Northbridge Solutions", age: "14 days overdue" },
    { approval_id: "a2", run_id: "r2", kind: "payment", title: "Payment follow-up draft", subtitle: "For Metro Systems", age: "21 days overdue" }] } }, chat: [
    { role: "assistant", content: "And one more thing… I am currently chasing two overdue customer invoices. I need your approval to send them.", at: at(24) },
    { role: "user", content: "You already knew that?", at: at(25) },
    { role: "assistant", content: "It's your business. I'm here to help you understand it, and act on it.", at: at(25), cards: [{ type: "approvals", case_id: ID }] }] },
};
const DRAFTS = { use_of_funds: { source: "from research", value: [
  { id: "u1", category: "Equipment", amount: "19500000", purpose: "Buy car wash equipment" },
  { id: "u2", category: "Operations", amount: "3500000", purpose: "Working capital: two months of fixed costs" },
  { id: "u3", category: "Reserve", amount: "2000000", purpose: "Reserve: one month of fixed costs" }] },
  "market.size": { source: "from market research", value: "Abuja's car wash and detailing market is growing as car ownership rises among office workers." } };

for (const [name, s] of Object.entries(SCREENS)) {
  for (const [width, height, label] of [[1448, 1086, "desktop"], [390, 844, "phone"]]) {
    test(`${name} ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await stubApi(page, { transition: false });
      const subject = caseAt(s.score, s.review ? { data: { agent_drafts: DRAFTS } } : {});
      await page.route("http://api.test/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (path === `/businesses/A/funding-cases/${ID}`) return json(subject);
        if (path.endsWith(`/cases/${ID}/overview`)) return json({ detail: "Not found." }, 404);
        if (path === "/businesses/A/agent/assistant-context") return json(context(s.ctx || {}));
        if (path === `/businesses/A/agent/chats/case-${ID}`) return json({ id: `case-${ID}`, messages: s.chat });
        if (path === "/validation/me" || path === "/validation/A") return json({ id: "A", name: "E2E Car Wash Abuja", data: { workspace_profile: { company_name: "E2E Car Wash Abuja", country: "Nigeria", city: "Abuja" }, onboarding: { completed: true } } });
        return route.fallback();
      });
      await page.addInitScript(() => localStorage.setItem("ea_workspace", JSON.stringify({ state: { workspaceId: "A", workspaceName: "E2E Car Wash Abuja", currency: "NGN" }, version: 0 })));
      await page.goto(`/funding/${ID}?tab=assistant${s.review ? "&review=1" : ""}`);
      await page.waitForSelector("[data-case-assistant]", { timeout: 30000 });
      await page.waitForTimeout(3500);      // the records card's ticks and the rings settle
      await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: label === "phone" });
    });
  }
}

// The owner, 28 Oct: "check every card for wrapped buttons, cut-off labels or overlapping badges, and fix them all in one pass"
const audit = (page) => page.evaluate(() => {
  const out = [];
  const root = document.querySelector("[data-case-assistant]");
  const seen = (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0;
  for (const b of root.querySelectorAll("button, a")) {
    if (!seen(b) || !b.textContent.trim() || b.hasAttribute("data-row")) continue;      // a whole row as a button: its label may wrap
    const cs = getComputedStyle(b);
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    const inner = b.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
    const block = b.closest("li, [data-card]")?.querySelector("p, span") === b;
    if (inner > line * 1.6 && b.textContent.trim().length < 40 && !b.querySelector("p, ul") && !block) out.push(`wrapped button: ${b.textContent.trim()}`);
  }
  for (const el of root.querySelectorAll("*")) {
    if (!seen(el) || el.children.length) continue;
    const cs = getComputedStyle(el);
    if ((cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none") && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) out.push(`cut off: ${el.textContent.trim().slice(0, 40)}`);
  }
  const chips = [...root.querySelectorAll("span")].filter((s) => seen(s) && /rounded-(md|full|lg)/.test(s.className) && /px-/.test(s.className) && s.textContent.trim().length < 30);
  for (const c of chips) {
    const r = c.getBoundingClientRect();
    for (const o of c.parentElement?.children || []) {
      if (o === c || !seen(o)) continue;
      const q = o.getBoundingClientRect();
      if (r.left < q.right - 1 && r.right > q.left + 1 && r.top < q.bottom - 1 && r.bottom > q.top + 1) out.push(`overlap: ${c.textContent.trim()} / ${o.textContent.trim().slice(0, 30)}`);
    }
  }
  return [...new Set(out)];
});

for (const [name, s] of Object.entries(SCREENS)) {
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768], [390, 844]]) {
    test(`${name} nothing wraps or is cut at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await stubApi(page, { transition: false });
      const subject = caseAt(s.score, s.review ? { data: { agent_drafts: DRAFTS } } : {});
      await page.route("http://api.test/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (path === `/businesses/A/funding-cases/${ID}`) return json(subject);
        if (path.endsWith(`/cases/${ID}/overview`)) return json({ detail: "Not found." }, 404);
        if (path === "/businesses/A/agent/assistant-context") return json(context(s.ctx || {}));
        if (path === `/businesses/A/agent/chats/case-${ID}`) return json({ id: `case-${ID}`, messages: s.chat });
        if (path === "/validation/me" || path === "/validation/A") return json({ id: "A", name: "E2E Car Wash Abuja", data: { workspace_profile: { company_name: "E2E Car Wash Abuja", country: "Nigeria", city: "Abuja" }, onboarding: { completed: true } } });
        return route.fallback();
      });
      await page.addInitScript(() => localStorage.setItem("ea_workspace", JSON.stringify({ state: { workspaceId: "A", workspaceName: "E2E Car Wash Abuja", currency: "NGN" }, version: 0 })));
      await page.goto(`/funding/${ID}?tab=assistant${s.review ? "&review=1" : ""}`);
      await page.waitForSelector("[data-case-assistant]", { timeout: 30000 });
      await page.waitForTimeout(2500);
      const found = await audit(page);
      console.log(`${name} @${width}:`, JSON.stringify(found));
      await page.screenshot({ path: `${OUT}/audit-${name}-${width}.png`, fullPage: width === 390 });
      expect(found).toEqual([]);
    });
  }
}
