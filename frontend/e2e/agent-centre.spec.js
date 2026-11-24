// The Agent Centre lists: cards in the Tasks panel, no forms in the list, no horizontal overflow at 1280, 768 or 390.
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const now = new Date().toISOString();
const runs = [1, 2, 3].map((n) => ({ id: `r${n}`, workflow_key: n === 1 ? "new_invoice" : "enquiry_to_quote", status: "running", bucket: "needs_attention",
  title: `Task ${n}`, question_title: n === 1 ? "Invoice for Mark · $300" : `Quotation for Investors ${n} · Add their email`, created_at: now, updated_at: now,
  pending_question: { question: "What's their email?", fields: [{ key: "customer_email", label: "Email", type: "email", required: true }] } }));

// The owner's QA, 27 Oct: a tab opens its own list in the panel ("← Needs You · 3"), cards with their full title, no forms
for (const width of [1280, 768, 390]) {
  test(`Agent Centre task cards at ${width}px`, async ({ page }) => {
    await stubApi(page, { runs });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/agent?tab=needs-you");
    if (width < 1280) await page.click("[data-tasks-button]");
    const list = page.locator("[data-task-list]").last();
    await list.locator("[data-task-cards] > li").first().waitFor();
    expect(await list.evaluate((el) => el.querySelectorAll("form, input:not([type=search]), select, textarea").length)).toBe(0);
    expect(await list.locator("[data-task-cards] > li").count()).toBeGreaterThan(0);
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: innerWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.view);
  });
}
