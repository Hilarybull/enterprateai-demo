// A visitor who isn't signed in (the owner, 28 Oct: "hope you still considered unsigned users"): the landing page and its
// start box at 1440 and 390, with no token, and every API call answered empty. What it asks for and any page error are kept.
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const OUT = process.env.SCREENS_OUT || "e2e/out/screens";
mkdirSync(OUT, { recursive: true });

for (const [w, h, label] of [[1440, 900, "1440"], [390, 844, "phone"]]) {
  test(`signed-out visitor on the landing page ${label}`, async ({ page }) => {
    test.setTimeout(120000);
    const asked = [];
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message || e)));
    await page.setViewportSize({ width: w, height: h });
    await page.addInitScript(() => { localStorage.removeItem("ea_token"); localStorage.removeItem("ea_workspace"); });
    await page.route("http://api.test/**", async (route) => {
      const url = new URL(route.request().url());
      asked.push(`${route.request().method()} ${url.pathname}`);
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname === "/auth/me") return json({ detail: "Not signed in" }, 401);
      return json({});
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/signed-out-${label}-landing.png` });
    const box = page.getByRole("textbox").first();
    await box.fill("I need funding");
    await box.press("Enter");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/signed-out-${label}-started.png` });
    console.log(label, "url:", page.url(), "asked:", JSON.stringify([...new Set(asked)]), "errors:", JSON.stringify(errors));
    expect(errors).toEqual([]);
    expect(page.url()).not.toContain("/agent");      // a visitor is never sent into the signed-in Agent Centre
  });
}
