// The Agent Centre lists (QA, 15 Oct): compact rows 64 to 88px tall on desktop, no forms in the list, no horizontal
// overflow at 1280, 768 or 390.
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const now = new Date().toISOString();
const runs = [1, 2, 3].map((n) => ({ id: `r${n}`, workflow_key: n === 1 ? "new_invoice" : "enquiry_to_quote", status: "running", bucket: "needs_attention",
  title: `Task ${n}`, question_title: n === 1 ? "Invoice for Mark · $300" : `Quotation for Investors ${n} · Add their email`, created_at: now, updated_at: now,
  pending_question: { question: "What's their email?", fields: [{ key: "customer_email", label: "Email", type: "email", required: true }] } }));

for (const width of [1280, 768, 390]) {
  test(`Agent Centre rows at ${width}px`, async ({ page }) => {
    await stubApi(page, { runs });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/agent?tab=needs-you");
    await page.locator("[data-agent-row]").first().waitFor();
    expect(await page.locator("[data-agent-rows] ul").evaluate((el) => el.querySelectorAll("form, input, select, textarea").length)).toBe(0);
    const heights = await page.locator("[data-agent-row]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    if (width >= 1024) expect(heights.every((h) => h >= 64 && h <= 88), `row heights ${heights}`).toBe(true);
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: innerWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.view);
  });
}
