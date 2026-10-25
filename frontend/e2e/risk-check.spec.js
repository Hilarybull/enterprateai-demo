// The Business Risk Check in a real browser, from all three entry points (the owner's brief, 24 Oct, R-2, R-7, R-8): the
// landing page, the dashboard Agent card and the Agent Centre. The question asked is answered with a button, then [Check my
// risks], and the result shows within 5 seconds with no error state; in the Agent card it stays on the dashboard; the
// Agent Centre's question is never dropped. Every API call is answered by stubs here: nothing reaches a server.
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const q = (key, label, options, value = "") => ({ key, label, type: "choice", required: true, noun: key, default: value,
  options: options.map(([v, l]) => ({ value: v, label: l })) });
const base = {
  id: "S1", goal_key: "business_risks", goal_label: "Help me understand my business risks", entry_mode: "free_text", authenticated: true, signed_in: true,
  business_id: "A", first_value: true, resolution: { resolution_class: "direct_supported", start_capability: "risk_concentration" }, proposed: {},
  value_line: "I'll check your biggest customer, cash, late payments and how much the business depends on you. This uses your records; it isn't financial advice.",
};
const asking = { ...base, next: "questions", missing: ["key_person"], inputs: { top_share: "over_50", paid_on_time: "on_time" },
  questions: [q("top_share", "Biggest customer?", [["over_50", "More than half"]], "over_50"), q("paid_on_time", "On time?", [["on_time", "Almost always"]], "on_time"),
    q("key_person", "If you were away for a month, what would happen to the business?", [["runs", "It would carry on"], ["slows", "It would slow down"], ["stops", "It would stop"]])],
  summary: [{ key: "top_share", label: "Biggest customer", value: "Most of your income comes from one customer", from_records: true }],
  turns: [{ role: "user", content: "business risk" }, { role: "assistant", content: "If you were away for a month, what would happen to the business?", next: "key_person" }] };
const answered = { ...asking, next: "prepare", missing: [], inputs: { ...asking.inputs, key_person: "slows" },
  questions: asking.questions.map((x) => (x.key === "key_person" ? { ...x, default: "slows" } : x)),
  turns: [...asking.turns, { role: "user", content: "It would slow down" }, { role: "assistant", content: "Thanks, noted: the business slows without you." }] };
const handed = { ...answered, state: "handed_off", handoff: { to: "/check/risks", free: true } };
const result = { result: { assessment_type: "business_risk_initial", headline: "Business Risk Check", score: null, currency_sign: "£",
  blockers: [{ key: "concentration", label: "Delta Offices Ltd is 100% of your paid income", kind: "failed", customer: "Delta Offices Ltd" },
    { key: "key_person", label: "The business slows down without you", kind: "partial", why: "A month away would slow the work and the income." }],
  not_on_record: [], fine: ["No invoices overdue"], free_next_actions: [], strengths: [], metrics: [], premium_next_action: null }, session_id: "S1" };

async function riskApi(page, seen) {
  let state = asking;
  await page.route("http://api.test/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    seen.push(`${req.method()} ${path}`);
    let body = null;
    if (path === "/agent/requests") body = { kind: "check", capability: "risk_concentration", goal_key: "business_risks", said: JSON.parse(req.postData() || "{}").text };
    else if (path === "/task-sessions" && req.method() === "POST") { state = asking; body = state; }
    else if (path === "/task-sessions/S1/inputs") { state = answered; body = state; }
    else if (path === "/task-sessions/S1/prepare") { state = handed; body = state; }
    else if (/^\/task-sessions\/S1(\/(attach-user|resume))?$/.test(path)) body = state;
    else if (path === "/task-sessions/S1/first-value") body = result;
    else if (path === "/task-sessions/S1/risk-check") { state = handed; body = { ...result, business_id: "A", session: handed }; }      // one request (25 Oct)
    else if (path === "/businesses/A/quick-check/business_risks" && req.method() === "GET") body = { goal_key: "business_risks", questions: [], last: { result: result.result, answers: {} } };
    // Simulation (R-4): its templates, and the one set of figures the risk check read
    else if (path === "/v1/scenario-intelligence/scenario-templates") body = { templates: [{ scenario_template_id: "tmpl_client_loss", scenario_type: "client_loss",
      title: "Loss of Largest Client", description: "Simulate losing your largest client.", mode: "adaptive_or_manual", required_inputs: ["client_loss_pct"] }] };
    else if (path === "/v1/scenario-intelligence/history") body = { history: [] };
    else if (path === "/businesses/A/figures") body = { revenue_monthly: 150, cash: 381.5, costs_monthly: 22.83, top_share: 100, clients: 1,
      customers: [{ name: "Delta Offices Ltd", share: 100 }], sources: {} };
    if (body === null) return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function answerAndCheck(page) {
  await page.getByRole("button", { name: "It would slow down" }).click();
  const go = page.locator("[data-check-my-risks]");
  await go.waitFor({ timeout: 5000 });
  const started = Date.now();
  await go.click();
  return started;
}

/** The chat ends on one line and "View your risk check"; the full result opens on /check/risks at its top, with "Back" to
 *  where the question was asked (the owner's brief, 25 Oct). Never "?task=" in the address on an app page. */
async function lineThenPage(page, from) {
  await expect(page.locator("[data-result-line]")).toContainText("2 risks to act on.", { timeout: 5000 });
  await expect(page.locator("[data-agent-goal-chat] [data-step-title], [data-risk-result-inline]")).toHaveCount(0);      // never the full result in the chat
  if (from !== "/") expect(new URL(page.url()).search).not.toContain("task=");
  await page.locator("[data-view-result]").click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/check/risks");
  await expect(page.getByText("Delta Offices Ltd is 100% of your paid income").first()).toBeVisible({ timeout: 5000 });
  const top = await page.evaluate(() => (document.querySelector("[data-tour='content-area']")?.scrollTop || 0) + scrollY);
  expect(top).toBe(0);      // at its top
  await page.locator("[data-back]").click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(from);
}

test("landing page: answer, Check my risks, the result in under 5 s, never an error", async ({ page }) => {
  const seen = [];
  await stubApi(page);
  await riskApi(page, seen);
  await page.goto("/");
  await page.locator("#goal-prompt").fill("business risk");
  await page.locator("#goal-prompt").press("Enter");
  await expect(page.getByText("I'll check your biggest customer, cash, late payments")).toBeVisible();
  const started = await answerAndCheck(page);
  await expect(page.locator("[data-result-line]")).toBeVisible({ timeout: 5000 });
  expect(Date.now() - started).toBeLessThan(5000);
  expect(new URL(page.url()).pathname).toBe("/");      // nothing moves by itself
  expect(seen.filter((x) => /\/(resume|prepare)$/.test(x))).toHaveLength(0);      // one request, not a chain
  await lineThenPage(page, "/");
  await expect(page.getByText("We couldn't load your task")).toHaveCount(0);
});

test("dashboard Agent card: one line in the card, the result on its own page, Back to the dashboard", async ({ page }) => {
  const seen = [];
  await stubApi(page);
  await riskApi(page, seen);
  await page.goto("/dashboard?ask=business%20risk");
  await expect(page.getByText("If you were away for a month, what would happen to the business?").first()).toBeVisible({ timeout: 10000 });
  const started = await answerAndCheck(page);
  await expect(page.locator("[data-result-line]")).toBeVisible({ timeout: 5000 });
  expect(Date.now() - started).toBeLessThan(5000);
  expect(new URL(page.url()).pathname).toBe("/dashboard");
  expect(seen.filter((x) => x.endsWith("/agent/requests"))).toHaveLength(1);      // asked once
  await lineThenPage(page, "/dashboard");
  await expect(page.getByText("This item no longer exists")).toHaveCount(0);
});

test("Agent Centre: answered in the Agent Centre, the result on its own page, Back to the Agent Centre", async ({ page }) => {
  const seen = [];
  await stubApi(page);
  await riskApi(page, seen);
  await page.goto("/agent");
  await page.getByLabel("Ask EnterprateAI").fill("what could put my business at risk?");
  await page.getByLabel("Ask EnterprateAI").press("Enter");
  await expect(page.getByText("If you were away for a month, what would happen to the business?").first()).toBeVisible({ timeout: 10000 });
  const started = await answerAndCheck(page);
  await expect(page.locator("[data-result-line]")).toBeVisible({ timeout: 5000 });
  expect(Date.now() - started).toBeLessThan(5000);
  expect(new URL(page.url()).pathname).toBe("/agent");      // where it was asked
  expect(seen.filter((x) => x.endsWith("/agent/requests"))).toHaveLength(1);
  await lineThenPage(page, "/agent");
});

test("the result's \"Run a what-if: lose them\" opens Simulation with Delta Offices Ltd filled in (R-4)", async ({ page }) => {
  const seen = [];
  await stubApi(page);
  await riskApi(page, seen);
  await page.goto("/dashboard?ask=business%20risk");
  await expect(page.getByText("If you were away for a month, what would happen to the business?").first()).toBeVisible({ timeout: 10000 });
  await answerAndCheck(page);
  await page.locator("[data-view-result]").click();
  await page.getByText("Run a what-if: lose them").first().click();
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe("/simulation?template=tmpl_client_loss&customer=Delta%20Offices%20Ltd");
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value)), { timeout: 10000 }).toContain("Loss of Delta Offices Ltd");
  expect(seen).toContain("GET /businesses/A/figures");      // the same figures, never worked out again
});
