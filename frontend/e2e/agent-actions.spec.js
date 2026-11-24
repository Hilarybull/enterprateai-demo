import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

test("contextual actions fit the composer and failed refreshes retain workspace facts", async ({ page }) => {
  await stubApi(page);
  let failContext = false;
  const context = { business: { name: "Altmosphere Consulting", location: "Leeds, United Kingdom", stage: "Operating" },
    revenue: { all_time: 900, currency: "GBP" } };
  await page.route((url) => url.origin === "http://api.test" && url.pathname.endsWith("/agent/assistant-context"), (route) =>
    route.fulfill({ status: failContext ? 503 : 200, json: failContext ? { detail: "Unavailable" } : context }));
  await page.route("**/agent/requests", (route) => {
    failContext = true;
    return route.fulfill({ json: { kind: "answer", conversational: true, quick: true,
      message: "The funding case is ready to review.",
      actions: [
        { label: "Show me the documents still waiting for my funding approval", kind: "explain", prompt: "Show my funding documents" },
        { label: "Open my funding case", kind: "explain", prompt: "Open my funding case" },
      ] } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/agent");
  const workspace = page.locator('[data-side="workspace"]');
  await expect(workspace.getByText("Leeds, United Kingdom")).toBeVisible();
  await page.getByLabel("Message", { exact: true }).fill("Show my funding case");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const actions = page.getByRole("group", { name: "Suggested actions" });
  await expect(actions.getByRole("button", { name: "Open my funding case" })).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => actions.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await expect(workspace.getByText("Leeds, United Kingdom")).toBeVisible();
  await expect(workspace).toContainText("Altmosphere Consulting");
});
