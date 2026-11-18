import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const id = "ocds-h6vhtk-001abc:lot:1";
const notice = { id, lot_id: "1", title: "School catering", buyer: "Example Council", status: "open", notice_id: "000101-2026",
  deadline: "2026-12-01T12:00:00Z", amount: null, published_at: "2026-11-17T10:00:00Z",
  description: "Provide school lunches.", url: "https://www.find-tender.service.gov.uk/Notice/000101-2026" };

test("visitors can search, filter, and open an official public tender", async ({ page }) => {
  const searches = [];
  await page.route("http://api.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/me") return route.fulfill({ status: 401, json: {} });
    if (url.pathname === "/public-tenders") {
      searches.push({ stage: url.searchParams.get("stage"), q: url.searchParams.get("q") });
      return route.fulfill({ json: { items: [notice], last_sync: "2026-11-18T12:00:00Z", stale: true } });
    }
    if (url.pathname.startsWith("/public-tenders/")) {
      return route.fulfill({ json: { ...notice, last_sync: "2026-11-18T12:00:00Z", stale: true } });
    }
    return route.fulfill({ json: { items: [], categories: [], total: 0 } });
  });
  await page.goto("/marketplace");
  await page.getByRole("tab", { name: "Public Tenders" }).click();
  await expect(page.getByRole("combobox", { name: "Notice status" })).toHaveValue("open");
  await expect(page.getByText("Last successful sync:", { exact: false })).toBeVisible();
  const card = page.getByRole("article").filter({ hasText: "School catering" });
  await expect(card.getByText("Lot 1", { exact: true })).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await page.getByRole("searchbox", { name: "Search the Marketplace" }).fill("catering");
  await page.getByRole("combobox", { name: "Notice status" }).selectOption("planning");
  await expect.poll(() => searches.at(-1)).toEqual({ stage: "planning", q: "catering" });
  await page.getByRole("button", { name: "School catering" }).click();
  await expect(page.getByText("Provide school lunches.")).toBeVisible();
  await expect(page.getByText("Not disclosed", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View Official Tender" })).toHaveAttribute("href", notice.url);
  await expect(page.getByRole("link", { name: "Sign in to save" })).toBeVisible();
});

test("signed-in buyer can save and remove a tender in the selected workspace", async ({ page }) => {
  await stubApi(page);
  let saved = false;
  const mutations = [];
  await page.route((url) => url.origin === "http://api.test" && url.pathname.startsWith("/public-tenders"), async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/public-tenders/watchlist") return route.fulfill({ json: { items: saved ? [notice] : [] } });
    if (url.pathname.endsWith("/watchlist")) {
      mutations.push([method, url.searchParams.get("workspace_id")]);
      saved = method === "PUT";
      return route.fulfill({ json: { saved } });
    }
    return route.fulfill({ json: { items: [notice], last_sync: null, stale: false } });
  });
  await page.goto("/marketplace?tab=tenders");
  await page.getByRole("button", { name: "Save to watchlist" }).click();
  await expect(page.getByRole("button", { name: "Remove from watchlist" })).toBeVisible();
  await page.getByRole("button", { name: "My watchlist" }).click();
  await expect(page.getByRole("heading", { name: "My watchlist" })).toBeVisible();
  await page.getByRole("button", { name: "Remove from watchlist" }).first().click();
  await expect(page.getByText("No notices saved in this workspace.")).toBeVisible();
  expect(mutations).toEqual([["PUT", "A"], ["DELETE", "A"]]);
});
