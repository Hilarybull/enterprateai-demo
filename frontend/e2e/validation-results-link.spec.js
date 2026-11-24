// "See details" on an idea validation opens its results and stays there (the owner, 26 Oct: it came back to the start page).
// Every API call is answered by stubs here: nothing reaches a server.
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

test("the validation results link lands on the results page and stays", async ({ page }) => {
  await stubApi(page);
  const entry = { id: "agent-1", type: "v4_validation", title: "Bush Clearing", status: "pending", journey: "comprehensive", created_at: "2026-10-26T12:00:00Z",
    payload: { step1: { idea_name: "Bush Clearing" }, validation_mode: "comprehensive" },
    result: { scores: { potential_score: 8, evidence_confidence_score: 30 }, verdict: { category: "Risky" }, risk_flags: [], experiments: [] } };
  await page.route("http://api.test/validation/A", async (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "A", name: "E2E Car Wash Abuja", data: { workspace_profile: { company_name: "E2E Car Wash Abuja" }, onboarding: { completed: true }, validation_history: [entry] } }) });
  });
  await page.goto("/validation?history_id=agent-1&history_type=v4_validation&view=results");
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15000 }).toBe("/results");
  await page.waitForTimeout(1500);
  expect(new URL(page.url()).pathname).toBe("/results");      // never brought back to /validation
});
