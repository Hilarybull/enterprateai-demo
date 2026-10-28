// The owner, 27 Oct: the Agent Centre is the one general chat; the floating button and the dashboard's Agent box open it
// (the docked drawer is gone). Every API call is answered by stubs here: nothing reaches a server.
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120000);

test("the floating button opens the Agent Centre's chat, and is not shown there", async ({ page }) => {
  await stubApi(page);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Ask about your business" }).click();
  await expect(page).toHaveURL(/\/agent$/);
  await expect(page.locator("[data-agent-chat]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask about your business" })).toHaveCount(0);
});
