// The Funding, Launch and Idea Validation Assistants fitted to the window (the owner, 27 Oct), at 1440×900, 1024×700 and
// phone width. Every API call is answered by stubs: nothing reaches a server or a database. Run: npx playwright test screens-modules
import { readFileSync, mkdirSync } from "node:fs";
import { test } from "@playwright/test";
import { stubApi } from "./stub.js";

const OUT = process.env.SCREENS_OUT || "e2e/out/screens";
mkdirSync(OUT, { recursive: true });
const fixture = JSON.parse(readFileSync(new URL("./fixtures/funding_case.json", import.meta.url), "utf8"));
const ID = fixture.id;
const at = (min) => new Date(Date.UTC(2026, 9, 27, 9, min)).toISOString();
const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const context = {
  business: { name: "E2E Car Wash Abuja", stage: "Operating", sector: "Car wash and detailing", location: "Abuja, Nigeria", founded: "2021", employees: "12" },
  revenue: { total: 994276, pct: 12, months: [40, 55, 48, 62, 70, 66, 74, 80, 77, 85, 90, 99].map((n) => n * 1000), currency: "NGN", has_any: true },
  records: [{ key: "profile", label: "Business profile", available: true }, { key: "revenue", label: "Revenue information", available: true },
    { key: "customers", label: "Customer records", available: true }, { key: "pricing", label: "Pricing", available: true }],
  activity: [{ kind: "invoice_paid", title: "Invoice paid", detail: "₦120,000 from BrightTech Ltd", at: ago(0.1) }, { kind: "customer_added", title: "New customer added", detail: "Northbridge Solutions", at: ago(0.3) }],
  approvals: { count: 0, items: [] }, research: { state: "none", max: 60 }, working: false, risk: null,
  idea: { answers: { description: "Mobile car interior detailing", customer: "SMEs with staff cars in Abuja", price: 25000, monthly_sales: 40, cost: 11000, capacity: 60, demand: "research" },
    inputs: [{ key: "customer", label: "Customer profile", available: true }, { key: "costs", label: "Costs", available: true }, { key: "capacity", label: "Capacity", available: true },
      { key: "price", label: "Proposed price", available: true }, { key: "demand", label: "Current demand evidence", available: false }],
    score_out_of_100: 57, viability: "Fair", strengths: ["Workable margin", "Delivery capacity appears feasible"], weaknesses: ["Demand is largely unproven", "Competitor pricing is unknown"],
    metrics: [{ label: "Margin", value: "56%" }, { label: "Break-even", value: "12 sales a month" }],
    criteria: [{ key: "idea", label: "The idea", state: "met" }, { key: "customer", label: "Who it is for", state: "met" }, { key: "margin", label: "Margin", state: "met" },
      { key: "break_even", label: "Break-even", state: "met" }, { key: "capacity", label: "Capacity", state: "met" }, { key: "demand", label: "Demand evidence", state: "unmet" },
      { key: "competitors", label: "Competitor pricing", state: "unknown" }] },
};
const chat = (kind) => [
  { role: "user", content: kind === "idea" ? "I have a new service idea. How do I know if it's worth launching?" : kind === "launch" ? "How ready is my launch?" : "Hey EnterprateAI, I need funding for my business.", at: at(24) },
  { role: "assistant", content: "Let me first check what I already know about your business.", at: at(24), cards: [{ type: kind === "idea" ? "idea_inputs" : "records", case_id: kind === "idea" ? "idea" : ID }] },
  { role: "user", content: "What's missing?", at: at(25) },
  { role: "assistant", content: "Here's where you stand.", at: at(25), cards: [{ type: kind === "idea" ? "viability" : "result", case_id: kind === "idea" ? "idea" : ID }] },
];
const PAGES = { funding: `/funding/${ID}?tab=assistant`, launch: `/launch/${ID}?tab=assistant`, idea: "/check/idea?tab=assistant" };

for (const [name, path] of Object.entries(PAGES)) {
  for (const [width, height, label] of [[1440, 900, "1440x900"], [1024, 700, "1024x700"], [390, 844, "phone"]]) {
    test(`${name} ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await stubApi(page, { transition: false });
      const subject = { ...fixture, type: name === "launch" ? "launch_initiative" : "funding_case", title: name === "launch" ? "Mobile detailing, Abuja, January 2027" : "₦25m funding to buy car wash equipment",
        data: { ...fixture.data, currency: "NGN" }, summary: { ...fixture.summary, score: 40, classification: "not_ready", score_partial: false, open_actions: 5 } };
      await page.route("http://api.test/**", async (route) => {
        const p = new URL(route.request().url()).pathname;
        const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (p === `/businesses/A/funding-cases/${ID}` || p === `/businesses/A/launch-initiatives/${ID}`) return json(subject);
        if (p.endsWith(`/cases/${ID}/overview`)) return json({ detail: "Not found." }, 404);
        if (p === "/businesses/A/agent/assistant-context") return json(context);
        if (p === `/businesses/A/agent/chats/case-${ID}`) return json({ id: `case-${ID}`, messages: chat(name) });
        if (p === "/businesses/A/agent/chats/idea-check") return json({ id: "idea-check", messages: chat("idea") });
        return route.fallback();
      });
      await page.addInitScript(() => localStorage.setItem("ea_workspace", JSON.stringify({ state: { workspaceId: "A", workspaceName: "E2E Car Wash Abuja", currency: "NGN" }, version: 0 })));
      await page.goto(path);
      await page.waitForSelector("[data-case-assistant]", { timeout: 30000 });
      await page.waitForTimeout(3000);
      const fit = await page.evaluate(() => {
        const area = document.querySelector('[data-tour="content-area"]');
        const box = document.querySelector("#case-assistant-input").getBoundingClientRect();
        return { page: document.documentElement.scrollHeight - window.innerHeight, area: area.scrollHeight - area.clientHeight, inputBottom: Math.round(box.bottom), height: window.innerHeight };
      });
      console.log(name, label, JSON.stringify(fit));
      await page.screenshot({ path: `${OUT}/${name}-${label}.png` });
      if (label !== "1440x900") {
        await page.click("[data-details-button]");
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/${name}-${label}-details.png` });
      }
    });
  }
}
