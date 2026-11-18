import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

test("tender sync controls fit on phones, tablets and desktop", async ({ page }) => {
  await stubApi(page);
  await page.addInitScript(() => localStorage.setItem("ea_email", "tech.support@enterprateai.com"));
  await page.route("**/auth/me", (route) => route.fulfill({ json: {
    id: "admin", email: "tech.support@enterprateai.com", email_verified: true,
  } }));
  let dismissed = false;
  const attempt = "2026-11-18T13:00:00Z";
  await page.route("**/public-tenders/admin/history", (route) => route.fulfill({ json: { items: [
    { attempted_at: attempt, status: "failed", error: "Could not save a Find a Tender release page" },
  ] } }));
  await page.route("**/public-tenders/admin/dismiss-error", (route) => {
    expect(route.request().postDataJSON()).toEqual({ attempt });
    dismissed = true;
    return route.fulfill({ json: { dismissed: true } });
  });
  await page.route("**/public-tenders/admin/health", (route) => route.fulfill({ json: {
    stale: true, running: false, scheduled: false, schedule_configurable: true,
    history_available: true, error_dismissed: dismissed,
    error: "Could not save a Find a Tender release page",
    retry_at: "2099-11-18T14:00:00Z", last_attempt: "2026-11-18T13:00:00Z",
    last_sync: null, checkpoint: "2026-11-11T13:00:00Z",
  } }));
  await page.goto("/ent-admin?tab=tender-sync");
  const panel = page.getByRole("region", { name: "Find a Tender sync" });
  await expect(panel.getByRole("switch", { name: "Automatic sync" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Sync now" })).toBeDisabled();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => panel.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return element.scrollWidth <= element.clientWidth + 1 && bounds.left >= 0 && bounds.right <= innerWidth + 1;
    })).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await panel.getByRole("button", { name: "Dismiss error" }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByRole("region", { name: "Sync history" }).getByText("Could not save a Find a Tender release page")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Sync now" })).toBeDisabled();
});

test("Marketplace tenders and sourcing fit on phones, tablets and desktop", async ({ page }) => {
  await stubApi(page);
  await page.route((url) => url.origin === "http://api.test" && url.pathname.startsWith("/public-tenders"), (route) =>
    route.fulfill({ json: { items: [], last_sync: null, stale: true } }));
  await page.goto("/marketplace?tab=tenders");
  await expect(page.getByRole("heading", { name: "Public tenders haven't synced yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Find Suppliers with Enterprate AI" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Business Directory" }).click();
  await expect(page).toHaveURL(/tab=businesses/);
  await page.getByRole("link", { name: "Find Suppliers with Enterprate AI" }).click();
  await expect(page).toHaveURL(/marketplace\/sourcing/);
  const draft = page.getByRole("button", { name: "Send", exact: true });
  const match = page.getByRole("button", { name: "Find matching suppliers" });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(match).toBeVisible();
    await expect(draft).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Draft a request", exact: true }).click();
    await expect(draft).toBeVisible();
    await expect(match).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Search for suppliers", exact: true }).click();
  }
  await page.getByRole("link", { name: "Back to Marketplace" }).click();
  await expect(page).toHaveURL(/tab=businesses/);
});
