import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const tender = index => ({ id: `notice-${index}`, title: `Grounds maintenance opportunity ${index}`, status: "open", buyer: "Example Council", notice_id: "107347-2026", description: "Maintain council grounds and recreational areas.", reasons: ["Matches your saved capability: Landscaping"], sme_suitable: true });
const evaluation = { notice_id: "notice-1", workspace_id: "A", business_name: "Example", verdict: "Tender summary", overview: [{ heading: "What the buyer needs", explanation: "Maintain council grounds.", evidence: [{ source: "description", quote: "Maintain council grounds" }] }], findings: [], next_steps: ["Read the schedule of works and prepare an itemised price."], limitations: [] };

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    console.log("Tender fixture contents:", await page.locator("body").innerText().catch(() => "unavailable"));
  }
});

for (const width of [390, 768, 1440]) {
  test(`tender popups and filters at ${width}px`, async ({ page }) => {
    page.on("pageerror", error => console.log("Tender fixture browser error:", error.message));
    page.on("console", message => { if (message.type() === "error") console.log("Tender fixture console:", message.text()); });
    await page.route("**/*", route => ["http://localhost:5199", "http://api.test"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await stubApi(page);
    await page.setViewportSize({ width, height: 844 });
    let generated = 0;
    await page.route("http://api.test/public-tenders**", async route => {
      const url = new URL(route.request().url());
      let body;
      if (url.pathname === "/public-tenders/recommendations") {
        const current = Number(url.searchParams.get("page") || 1);
        body = url.searchParams.has("stage")
          ? { workspace_id: "A", total: 12, page: current, page_size: 10, more: current === 1, items: current === 1 ? Array.from({ length: 10 }, (_, index) => tender(index + 1)) : [tender(11), tender(12)] }
          : { workspace_id: "A", open_count: 12, award_count: 0, open: [tender(1), tender(2)], awards: [] };
      } else if (url.pathname.endsWith("/evaluation")) body = { evaluation, stale: false };
      else if (url.pathname === "/public-tenders/notice-1") body = tender(1);
      else body = { items: [tender(1)], total: 42, more: false };
      await route.fulfill({ json: body });
    });
    await page.route("http://api.test/agent/requests", async route => { generated += 1; await route.fulfill({ json: {} }); });
    await page.goto("/e2e/tender-popups.html", { waitUntil: "domcontentloaded" });
    const recommendations = page.getByRole("region", { name: "Tender recommendations" });
    await recommendations.getByRole("button", { name: /See more/ }).click();
    const dialog = page.getByRole("dialog", { name: "Tenders for your business" });
    await expect(dialog.getByText("Grounds maintenance opportunity 10", { exact: true })).toBeVisible();
    const fits = async () => {
      const rect = await page.getByRole("dialog").boundingBox();
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1);
      expect(rect.y + rect.height).toBeLessThanOrEqual(845);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    };
    await fits();
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await expect(dialog.getByText("Grounds maintenance opportunity 12", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(dialog.getByText("Grounds maintenance opportunity 10", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(recommendations.getByRole("button", { name: /See more/ })).toBeFocused();

    await page.goto("/e2e/tender-popups.html?screen=marketplace", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("42 tenders · Suitable for SMEs", { exact: true })).toBeVisible();
    await expect(page.getByText("SME suitable", { exact: true })).toHaveCount(0);
    const count = await page.getByText("42 tenders · Suitable for SMEs", { exact: true }).boundingBox();
    const more = await page.getByText("More filters", { exact: true }).boundingBox();
    expect(count.y).toBeGreaterThan(more.y);
    await page.getByRole("button", { name: "View Official Tender", exact: true }).click();
    await page.getByRole("button", { name: "View saved evaluation" }).click();
    await expect(page.getByRole("dialog", { name: "Your tender evaluation" })).toBeVisible();
    await expect(page.getByText("Read the schedule of works and prepare an itemised price.")).toBeVisible();
    await fits();
    await page.getByRole("button", { name: "Close popup" }).click();
    await page.getByRole("button", { name: "View saved evaluation" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(generated).toBe(0);
  });
}
