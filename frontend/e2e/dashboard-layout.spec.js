// The dashboard at five widths, in a real browser, with the API answered by recorded fixtures (e2e/stub.js):
// nothing overflows its parent or the page; stage-card descriptions and the status notice are never cut off with an
// ellipsis; the "···" menu is gone and Dismiss is visible; everything opened from the Agent card is fully on screen and
// on top (elementFromPoint at its centre is inside it). At 390 the order is Agent card, Needs Approval, stage cards.
import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

const WIDTHS = [1440, 1280, 1024, 768, 390];

async function open(page, width, options) {
  await stubApi(page, options);
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await page.goto("/dashboard");
  await page.locator("[data-first-result-panel]").waitFor();
  await page.waitForTimeout(800);      // the entrance animations settle
}

/** Elements under the roots whose right edge passes their parent's (positioned and decorative layers aside). */
const overflowing = (page, roots) => page.evaluate((selector) => {
  const out = [];
  for (const base of document.querySelectorAll(selector)) {
    for (const el of base.querySelectorAll("*")) {
      const parent = el.parentElement;
      const cs = getComputedStyle(el);
      if (!parent || cs.position === "absolute" || cs.position === "fixed" || cs.display === "none" || el.closest("[aria-hidden='true']")) continue;
      const r = el.getBoundingClientRect();
      const p = parent.getBoundingClientRect();
      if (r.width && r.right > p.right + 1) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 70)} by ${Math.round(r.right - p.right)}px`);
    }
  }
  return out.slice(0, 8);
}, roots);

/** A popover is fully inside the viewport and on top: the element at its centre belongs to it. */
const onTop = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return "missing";
  const r = el.getBoundingClientRect();
  if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) return `outside the viewport ${JSON.stringify(r)}`;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return hit && el.contains(hit) ? "ok" : `covered by ${hit?.tagName}.${String(hit?.className).slice(0, 60)}`;
}, selector);

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test("nothing overflows, nothing is cut off, every action is a button", async ({ page }) => {
      await open(page, width);
      const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: innerWidth }));
      expect(size.scroll, "no horizontal scroll").toBeLessThanOrEqual(size.view);
      expect(await overflowing(page, "[data-agent-card], [data-stage-cards], [data-kpi-grid], [data-stage-transition]")).toEqual([]);
      // No ellipsis: the stage-card descriptions show in full (two lines at most, never cut) and the status notice too.
      const cut = await page.evaluate(() => [...document.querySelectorAll("[data-stage-description], [data-stage-transition]")]
        .filter((el) => el.offsetParent !== null)
        .filter((el) => getComputedStyle(el).textOverflow === "ellipsis" || el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)
        .map((el) => el.textContent.slice(0, 50)));
      expect(cut).toEqual([]);
      await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0);
      const dismiss = page.locator("[data-first-result-panel]").getByRole("button", { name: "Dismiss" });
      await dismiss.scrollIntoViewIfNeeded();
      await expect(dismiss).toBeVisible();
      if (width >= 1440) {
        const top = await page.locator("[data-agent-card]").evaluate((el) => el.getBoundingClientRect().top + scrollY);
        expect(top, "the Agent row starts in the first viewport").toBeLessThanOrEqual(360);
      }
      if (width <= 390) {
        const y = (sel) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().top + scrollY);
        const agent = await y("[data-agent-card]");
        const approval = await y("text=Needs Approval");
        const stages = await y("[data-stage-cards]");
        expect(agent).toBeLessThan(approval);
        expect(approval).toBeLessThan(stages);
        const buttons = await page.locator("[data-result-actions] button").evaluateAll((els) => els.map((b) => Math.round(b.getBoundingClientRect().width)));
        const row = await page.locator("[data-result-actions]").evaluate((el) => Math.round(el.getBoundingClientRect().width));
        expect(buttons.every((w) => w >= row - 2), "the result's buttons are full width").toBe(true);
      }
    });

    test("the result is its own card under the Agent row, opens its own page, and the Agent card keeps its height", async ({ page }) => {
      await open(page, width);
      const agent = page.locator("[data-agent-card]");
      const panel = page.locator("[data-first-result-panel]");
      expect(await agent.evaluate((el, p) => !el.contains(document.querySelector(p)), "[data-first-result-panel]")).toBe(true);      // never inside it
      const below = await page.evaluate(() => document.querySelector("[data-first-result-panel]").getBoundingClientRect().top
        >= document.querySelector("[data-agent-card]").getBoundingClientRect().bottom - 1);
      expect(below, "the result card sits under the Agent row").toBe(true);
      await expect(panel.getByRole("button", { name: "View details" })).toHaveCount(0);
      const withResult = await agent.evaluate((el) => Math.round(el.getBoundingClientRect().height));
      // Near the bottom of the screen: Dismiss, its Undo toast on top, and the Agent card's height unchanged without it.
      await panel.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().bottom - innerHeight + 10));
      await panel.getByRole("button", { name: "Dismiss" }).click();
      await page.locator("[data-undo-toast]").waitFor();
      expect(await onTop(page, "[data-undo-toast]")).toBe("ok");
      const without = await agent.evaluate((el) => Math.round(el.getBoundingClientRect().height));
      expect(Math.abs(without - withResult), "the Agent card's height is the same with or without the result").toBeLessThanOrEqual(1);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.locator("[data-first-result-panel]")).toHaveCount(1);
    });

    test("the plan gate opens as a modal, fully on screen", async ({ page }) => {
      await open(page, width, { gate: true });
      await page.locator("[data-result-primary]").click();
      expect(await onTop(page, "[data-premium-gate] [role='dialog']")).toBe("ok");
      await expect(page.getByRole("button", { name: "Continue with free tools" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-premium-gate]")).toHaveCount(0);
    });
  });
}

for (const name of ["Dismiss", "Save for later"]) {
  test(`closing the result with ${name} keeps the page where it is`, async ({ page }) => {
    await open(page, 1280);
    await page.evaluate(() => window.scrollTo(0, 120));
    const before = await page.evaluate(() => scrollY);
    await page.locator("[data-first-result-panel]").getByRole("button", { name, exact: true }).click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => scrollY), `${name} kept the scroll position`).toBe(before);
  });
}
