// Winning more customers in a real browser, from all three entry points (the owner's brief, 25 Oct: "remember, the landing,
// dashboard and agent centre agents"): the question the records can't answer is a button, then [See my customer plan]; the
// chat ends on one line and "View your customer plan"; the full result is on /check/customers, at its top, with "Back" to where
// it was asked, and its buttons go somewhere real. Every API call is answered by stubs here: nothing reaches a server.
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const q = (key, label, options, value = "") => ({ key, label, type: "choice", required: true, noun: key, default: value,
  options: options.map(([v, l]) => ({ value: v, label: l })) });
const base = {
  id: "S1", goal_key: "more_customers", goal_label: "I need more customers", entry_mode: "free_text", authenticated: true, signed_in: true,
  business_id: "A", first_value: true, resolution: { resolution_class: "composite", start_capability: "offer_review" }, proposed: {},
  value_line: "I'll look at who buys from you now, how new customers find you, and the first things to do. This uses your records; it doesn't promise customers.",
};
const asking = { ...base, next: "questions", missing: ["channel"], inputs: { sell: "Monthly car wash", price: "4000", where: "Abuja", customer: "Office managers in Abuja", goal: "10" },
  questions: [q("goal", "How many new customers?", [["10", "10 new customers"]], "10"),
    { ...q("channel", "How do new customers find you today? Pick all that apply.", [["word_of_mouth", "Word of mouth and referrals"], ["social", "Social media"], ["none", "I don't have customers yet"]]), multi: true }],
  summary: [{ key: "price", label: "Price", value: "4000 for Monthly car wash", from_records: true }],
  turns: [{ role: "user", content: "I need more customers" }, { role: "assistant", content: "How do new customers find you today?", next: "channel" }] };
const answered = { ...asking, next: "prepare", missing: [], inputs: { ...asking.inputs, channel: "word_of_mouth,social" },
  questions: asking.questions.map((x) => (x.key === "channel" ? { ...x, default: "word_of_mouth" } : x)),
  turns: [...asking.turns, { role: "user", content: "Word of mouth and referrals" }, { role: "assistant", content: "Thanks, noted." }] };
const handed = { ...answered, state: "handed_off", handoff: { to: "/check/customers", free: true } };
const result = { result: { assessment_type: "customer_growth_foundation", headline: "Customer growth", score: null, currency_sign: "₦",
  focus: { key: "now", text: "Now: 1 paying customer on record, about ₦150 a month." },
  blockers: [{ key: "marketplace", label: "Not listed on the Marketplace", kind: "failed", why: "Customers searching there can't find you yet." },
    { key: "channel", label: "New customers only come by word of mouth", kind: "partial", why: "Add one channel you control." },
    { key: "follow_up", label: "1 quote waiting for an answer", kind: "partial", why: "A follow-up is often the quickest new customer." }],
  not_on_record: [], fine: ["Goal for the next three months: 10 new customers"], free_next_actions: [], strengths: [], metrics: [], premium_next_action: null }, session_id: "S1" };

let posted = {};
async function customersApi(page, seen) {
  posted = {};
  let state = asking;
  await page.route("http://api.test/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    seen.push(`${req.method()} ${path}`);
    let body = null;
    if (path === "/agent/requests") body = { kind: "check", goal_key: "more_customers", said: JSON.parse(req.postData() || "{}").text };
    else if (path === "/task-sessions" && req.method() === "POST") { state = asking; body = state; }
    else if (path === "/task-sessions/S1/inputs") { posted = { ...posted, ...(JSON.parse(req.postData() || "{}").answers || {}) }; state = answered; body = state; }
    else if (/^\/task-sessions\/S1(\/(attach-user|resume))?$/.test(path)) body = state;
    else if (path === "/task-sessions/S1/risk-check") { state = handed; body = { ...result, business_id: "A", session: handed }; }
    else if (path === "/businesses/A/quick-check/more_customers" && req.method() === "GET") body = { goal_key: "more_customers", questions: [], last: { result: result.result, answers: {} } };
    if (body === null) return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function answerAndGo(page, seen) {
  // Several at once (the owner, 25 Oct): each a toggle, then Done
  await page.getByRole("button", { name: "Word of mouth and referrals" }).click();
  await page.getByRole("button", { name: "Social media" }).click();
  await expect(page.locator("[data-multi-done]")).toHaveText("Done (2)");
  await page.locator("[data-multi-done]").click();
  if (seen) await expect.poll(() => posted.channel).toBe("word_of_mouth,social");
  const go = page.locator("[data-check-my-risks]");
  await expect(go).toHaveText("See my customer plan", { timeout: 5000 });
  const started = Date.now();
  await go.click();
  return started;
}

async function lineThenPage(page, from) {
  await expect(page.locator("[data-result-line]")).toContainText("3 things to fix to win more customers.", { timeout: 5000 });
  await page.locator("[data-view-result]").filter({ hasText: "View your customer plan" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/check/customers");
  await expect(page.getByText("Now: 1 paying customer on record").first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("Not listed on the Marketplace").first()).toBeVisible();
  await expect(page.getByText(/\/100/)).toHaveCount(0);      // no made-up score
  const top = await page.evaluate(() => (document.querySelector("[data-tour='content-area']")?.scrollTop || 0) + scrollY);
  expect(top).toBe(0);
  await page.locator("[data-back]").click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(from);
}

test("landing page: a button for what the records can't show, one line, the plan on its own page", async ({ page }) => {
  const seen = [];
  await stubApi(page);
  await customersApi(page, seen);
  await page.goto("/");
  await page.locator("#goal-prompt").fill("I need more customers");
  await page.locator("#goal-prompt").press("Enter");
  await expect(page.getByText("I'll look at who buys from you now")).toBeVisible();
  const started = await answerAndGo(page, seen);
  await expect(page.locator("[data-result-line]")).toBeVisible({ timeout: 5000 });
  expect(Date.now() - started).toBeLessThan(5000);
  expect(seen.filter((x) => /\/(resume|prepare)$/.test(x))).toHaveLength(0);      // one request
  await lineThenPage(page, "/");
});

test("dashboard Agent card: the same chat, the plan on its own page, Back to the dashboard", async ({ page }) => {
  const seen = [];
  await stubApi(page);
  await customersApi(page, seen);
  await page.goto("/dashboard?ask=I%20need%20customers");
  await expect(page.getByText("How do new customers find you today?").first()).toBeVisible({ timeout: 10000 });
  await answerAndGo(page);
  expect(new URL(page.url()).pathname).toBe("/dashboard");
  await lineThenPage(page, "/dashboard");
});

test("Agent Centre: the same chat, the plan on its own page, Back to the Agent Centre", async ({ page }) => {
  const seen = [];
  await stubApi(page);
  await customersApi(page, seen);
  await page.goto("/agent");
  await page.getByLabel("Ask EnterprateAI").fill("help me find customers");
  await page.getByLabel("Ask EnterprateAI").press("Enter");
  await expect(page.getByText("How do new customers find you today?").first()).toBeVisible({ timeout: 10000 });
  await answerAndGo(page);
  expect(new URL(page.url()).pathname).toBe("/agent");
  await lineThenPage(page, "/agent");
});

test("the plan's buttons go somewhere real: List on the Marketplace, Follow up your quotes", async ({ page }) => {
  const seen = [];
  await stubApi(page);
  await customersApi(page, seen);
  await page.goto("/dashboard?ask=I%20need%20customers");
  await expect(page.getByText("How do new customers find you today?").first()).toBeVisible({ timeout: 10000 });
  await answerAndGo(page);
  await page.locator("[data-view-result]").click();
  await page.getByText("Follow up your quotes").first().click();
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe("/operations?tab=Sales&sub=Quotations");
  await page.goBack();
  await page.getByText("List on the Marketplace").first().click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/marketplace/profile");
});

test("Change something in the chat, beside See my customer plan (the owner, 26 Oct)", async ({ page }) => {
  const seen = [];
  await stubApi(page);
  await customersApi(page, seen);
  await page.goto("/dashboard?ask=I%20need%20customers");
  await expect(page.getByText("How do new customers find you today?").first()).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Word of mouth and referrals" }).click();
  await page.locator("[data-multi-done]").click();
  await expect(page.locator("[data-check-my-risks]")).toBeVisible({ timeout: 5000 });
  await page.locator("[data-free-check-change]").click();
  await expect(page.locator("[data-change-pick]")).toBeInViewport();      // brought into view (the owner, 26 Oct)
  await expect(page.locator("[data-change-key='goal']")).toHaveText("Goal: 10 new customers");      // each with what was answered
  await expect(page.locator("[data-change-key='channel']")).toHaveText("Channel: Word of mouth and referrals");
  await page.locator("[data-change-key='channel']").click();
  await expect(page.getByRole("button", { name: "Social media" })).toBeVisible();      // the question again, to change
  // What was answered is ticked, and the box is empty, never the codes ("ads,walk_in": the owner, 26 Oct)
  await expect(page.locator("[data-multi-done]")).toHaveText("Done (1)");
  await expect(page.locator("input[aria-label='How do new customers find you today? Pick all that apply.']")).toHaveValue("");
});
