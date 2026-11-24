import { expect, test } from "@playwright/test";

test("Marketplace browsing is public and sourcing requires authentication", async ({ page }) => {
  const sourcingCalls = [];
  await page.route("http://api.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/sourcing/")) sourcingCalls.push(path);
    if (path === "/auth/me") return route.fulfill({ status: 401, json: { detail: "Not signed in" } });
    return route.fulfill({ json: { items: [], categories: [], total: 0, unclaimed_listed: false } });
  });
  await page.goto("/marketplace");
  await expect(page.getByRole("searchbox", { name: "Search the Marketplace" })).toBeVisible();
  await page.getByRole("link", { name: "Find Suppliers with Enterprate AI" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fmarketplace%2Fsourcing/i);
  expect(sourcingCalls).toEqual([]);
});

for (const signup of [false, true]) {
  test(`sourcing resumes after ${signup ? "sign-up" : "login"} with fixture auth`, async ({ page }) => {
    let loggedIn = false;
    let registered = false;
    await page.route("http://api.test/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body = {};
      if (path === "/auth/register") registered = true;
      if (path === "/auth/login") {
        loggedIn = true;
        body = { access_token: "fixture-token" };
      }
      if (path === "/auth/me") {
        if (!loggedIn) return route.fulfill({ status: 401, json: {} });
        body = { id: "buyer", email: "buyer@example.test", email_verified: true };
      }
      if (path === "/validation/me" || path === "/validation/A") body = { id: "A", user_id: "buyer", data: {} };
      if (path === "/validation/list") body = [{ id: "A", user_id: "buyer", data: {} }];
      if (path.endsWith("/grants") || path.endsWith("/restrictions")) body = [];
      return route.fulfill({ json: body });
    });
    await page.goto("/marketplace/sourcing");
    await expect(page).toHaveURL(/\/login\?/);
    if (signup) {
      await page.getByRole("button", { name: "Create account", exact: true }).first().click();
      await page.getByPlaceholder("Your full name").fill("Example Buyer");
    }
    await page.locator('input[type="email"]').fill("buyer@example.test");
    await page.locator('input[type="password"]').fill("Example-test-password-42");
    await page.getByRole("button", { name: signup ? "Create My Free Workspace" : "Sign In", exact: true }).first().click();
    await expect(page).toHaveURL(/\/marketplace\/sourcing$/);
    await expect(page.getByRole("heading", { name: "Find Suppliers with Enterprate AI" })).toBeVisible();
    expect(registered).toBe(signup);
  });
}

test("Marketplace and Operations share the Procurement tool and draft identifier", async ({ page }) => {
  const { stubApi } = await import("./stub.js");
  await stubApi(page);
  const calls = [];
  let saved;
  let rejected = false;
  const draft = { title: "Staff lunches", description: "Supply 40 lunches", questions: [], constraints: [],
    recommendation: "RFQ", rationale: "The quantity is defined", category: "Catering", location: "Leeds", outcome: "Staff lunches",
    budget_range: "100–200", deadline: "2026-12-01", submission_cap: 4, accepted_categories: ["Specialist catering supplies"],
    requirements: [{ text: "Insurance", mandatory: true, weight: 2, format: "document" }] };
  await page.route("**/agent/requests", async (route) => {
    const request = route.request().postDataJSON();
    if (!rejected && request.text === "We need 40 packed lunches in Leeds") {
      rejected = true;
      return route.fulfill({ status: 503, json: { detail: "Backend unavailable" } });
    }
    calls.push(request);
    const result = request.text === "Food selling"
      ? { status: "clarification" }
      : { status: "draft", draft, request_id: request.source_reference };
    await route.fulfill({ json: { kind: "answer", message: result.status === "clarification" ? "What do you need to buy?" : "RFQ suggested.",
      procurement: { specialist: "procurement", ...result } } });
  });
  await page.route("**/proposals/sourcing/drafts/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON();
      saved = { ...payload, id, workspace_id: "A", sourcing_kind: payload.kind, status: "DRAFT" };
      return route.fulfill({ json: saved });
    }
    return route.fulfill({ json: { record: saved, generation: { brief: "Food selling", draft } } });
  });
  await page.route("**/proposals/requests", (route) => route.fulfill({ json: saved ? [saved] : [] }));
  const quoteSearches = [];
  await page.route("**/proposals/sourcing/match-suppliers?*", (route) => {
    quoteSearches.push(route.request().postDataJSON());
    return route.fulfill({ json: { matches: [{
      slug: "leeds-catering", name: "Leeds Catering", location: "Leeds", service_evidence: ["Catering"],
    }] } });
  });
  await page.goto("/marketplace/sourcing");
  await expect(page.getByRole("button", { name: "Find matching suppliers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Draft a request", exact: true }).click();
  await expect(page.getByRole("button", { name: "Find matching suppliers" })).toHaveCount(0);
  await page.getByLabel("What service do you need?").fill("Food selling");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("What do you need to buy?", { exact: false })).toBeVisible();
  await page.getByLabel("Your answer").fill("We need 40 packed lunches in Leeds");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const failedReply = page.getByText("We couldn't generate a draft. Try again with the details you entered.", { exact: false });
  await expect(failedReply).toBeInViewport();
  await expect(page.getByLabel("Your answer")).toHaveValue("We need 40 packed lunches in Leeds");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(failedReply).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Review your RFQ draft" })).toBeFocused();
  await expect(page.getByText("Staff lunches", { exact: true })).toBeVisible();
  const thread = page.getByRole("region", { name: "Procurement conversation" });
  await expect(thread.getByText("What do you need to buy?", { exact: false })).toBeVisible();
  await expect(thread.getByLabel("Request title")).toHaveCount(0);
  await expect(thread.getByLabel("Draft preview")).toBeVisible();
  await page.getByRole("button", { name: "Change something" }).click();
  await expect(thread.getByLabel("What would you like to change?")).toBeFocused();
  await expect(thread.getByLabel("What would you like to change?")).toHaveValue("");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.getByRole("button", { name: "Save RFQ draft" }).click();
  await expect(page.getByRole("button", { name: "Draft saved" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Leeds Catering" })).toBeVisible();
  expect(quoteSearches[0]).toEqual({ service: "Catering", location: "Leeds", rfq_only: true });
  await expect(page.getByRole("button", { name: "Approve and send RFQ" })).toBeDisabled();
  await page.getByRole("button", { name: "Choose supplier" }).click();
  await expect(page.getByRole("button", { name: "Approve and send RFQ" })).toBeEnabled();
  await page.getByRole("link", { name: "Edit in Business Operations" }).click();
  await expect(page.getByRole("heading", { name: "Edit Quote Request" })).toBeVisible();
  await expect(page.getByLabel("Request title")).toHaveValue("Staff lunches");
  await expect(page.getByLabel("Budget range")).toHaveValue("100–200");
  await expect(page.getByLabel("Submission cap")).toHaveValue("4");
  await expect(page.getByText("Insurance", { exact: true })).toBeVisible();
  await page.getByLabel("Budget range").fill("200–300");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect.poll(() => saved.budget_range).toBe("200–300");
  expect(saved.requirements[0]).toEqual({ text: "Insurance", mandatory: true, weight: 2, format: "document" });
  expect(saved.deadline).toBe("2026-12-01");
  expect(saved.accepted_categories).toEqual(["Specialist catering supplies"]);
  expect(calls.map((call) => call.source_reference)).toEqual([saved.id, saved.id]);
  await expect(page.getByText("Find Suppliers with Enterprate AI", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Draft with EnterprateAI" }).click();
  await expect(page.getByRole("button", { name: "Draft a request", exact: true })).toHaveAttribute("aria-pressed", "true");
  const back = page.getByRole("link", { name: "Back to Proposal Requests" });
  await expect(back).toHaveAttribute("href", "/operations?tab=Procurement&sub=Proposal%20Requests");
  await page.reload();
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/operations\?tab=Procurement&sub=Proposal%20Requests/);
});

test("saved RFP publishes only after explicit review and confirmation", async ({ page }) => {
  const { stubApi } = await import("./stub.js");
  await stubApi(page);
  let saved;
  let publishes = 0;
  let saves = 0;
  const draft = { title: "Local catering", description: "Provide local dishes for 10 to 50 guests.", questions: [],
    constraints: [], recommendation: "RFP", rationale: "Compare menus and service approaches." };
  await page.route("**/agent/requests", (route) => route.fulfill({ json: {
    kind: "answer", message: "RFP suggested.", procurement: { status: "draft", draft },
  } }));
  await page.route("**/proposals/sourcing/drafts/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    if (++saves === 1) return route.fulfill({ status: 405, json: { detail: "Method Not Allowed" } });
    const payload = route.request().postDataJSON();
    saved = { id, sourcing_kind: payload.kind, title: payload.title, description: payload.description, status: "DRAFT", requirements: [] };
    return route.fulfill({ json: saved });
  });
  await page.route("**/proposals/requests", (route) => route.fulfill({ json: saved ? [saved] : [] }));
  await page.route("**/proposals/preferences", (route) => route.fulfill({ json: { enabled: true } }));
  await page.route("**/proposals/requests/*/publish?*", (route) => {
    expect(route.request().url()).toContain(saved.id);
    publishes += 1;
    return route.fulfill({ json: { status: "PUBLISHED" } });
  });
  await page.goto("/marketplace/sourcing");
  await page.getByRole("button", { name: "Draft a request", exact: true }).click();
  await page.getByLabel("What service do you need?").fill("Draft an RFP for local dishes for 10 to 50 guests");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const save = page.getByRole("button", { name: "Save RFP draft" });
  await save.click();
  await expect(page.getByRole("alert")).toHaveText("We couldn't save your draft. Your edits are still here. Try saving again.");
  await expect(page.getByText(/405|Method Not Allowed/)).toHaveCount(0);
  await expect(page.getByText("Local catering", { exact: true })).toBeVisible();
  await save.click();
  const marketplaceUrl = page.url();
  await expect(page.getByRole("button", { name: "Draft saved" })).toBeDisabled();
  await page.getByRole("button", { name: "Review and publish RFP" }).click();
  const review = page.getByRole("group", { name: "Confirm RFP publication" });
  expect(publishes).toBe(0);
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(publishes).toBe(0);
  await page.getByRole("button", { name: "Review and publish RFP" }).click();
  await review.getByRole("button", { name: "Approve and publish RFP" }).click();
  await expect.poll(() => publishes).toBe(1);
  await expect(page.getByRole("link", { name: "View published RFP" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review and publish RFP" })).toHaveCount(0);
  await expect(page).toHaveURL(marketplaceUrl);
});

test("no supplier matches offers RFP conversion, publication, copy and email invitations", async ({ page }) => {
  const { stubApi } = await import("./stub.js");
  await stubApi(page);
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async (value) => { window.copiedRfpLink = value; } },
  }));
  const savedIds = [];
  const kinds = [];
  let saved;
  let invitations = 0;
  const draft = { title: "Camping tents", description: "Rent tents for 20 people.", constraints: ["Tents must accommodate 20 people"],
    questions: [], recommendation: "RFQ", rationale: "Defined equipment rental.", supplier_search: "tents" };
  await page.route("**/agent/requests", (route) => route.fulfill({ json: {
    procurement: { status: "draft", draft }, message: "Draft prepared.",
  } }));
  await page.route("**/proposals/sourcing/drafts/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    const fields = route.request().postDataJSON();
    expect(fields.requirements).toEqual([]);
    kinds.push(fields.kind);
    savedIds.push(id);
    saved = { ...fields, id, workspace_id: "A", sourcing_kind: fields.kind, status: "DRAFT" };
    return route.fulfill({ json: saved });
  });
  await page.route("**/proposals/sourcing/match-suppliers?*", (route) => route.fulfill({ json: { matches: [] } }));
  await page.route("**/proposals/requests/*/publish?*", (route) => {
    expect(route.request().url()).toContain(saved.id);
    return route.fulfill({ json: { ...saved, status: "PUBLISHED" } });
  });
  await page.route("**/proposals/requests/*/invite?*", (route) => {
    expect(new URL(route.request().url()).searchParams.get("workspace_id")).toBe("A");
    expect(route.request().postDataJSON().emails).toEqual(["supplier@example.test"]);
    invitations += 1;
    return route.fulfill({ json: { sent: ["supplier@example.test"], failed: [] } });
  });
  await page.goto("/marketplace/sourcing?mode=draft");
  await page.getByLabel("What service do you need?").fill("Rent tents for 20 people");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Save RFQ draft" }).click();
  await expect(page.getByRole("button", {name:"Widen search"})).toHaveCount(0);
  await expect(page.getByRole("button", {name:"Approve and send RFQ"})).toHaveCount(0);
  await page.getByRole("button", { name: "Use an RFP" }).click();
  await expect(page.getByText("Camping tents", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save RFP draft" }).click();
  expect(kinds).toEqual(["RFQ", "RFP"]);
  expect(savedIds[0]).toBe(savedIds[1]);
  expect(invitations).toBe(0);
  await page.getByRole("button", { name: "Review and publish RFP" }).click();
  await page.getByRole("button", { name: "Approve and publish RFP" }).click();
  await page.getByRole("button", { name: "Copy RFP link" }).click();
  expect(await page.evaluate(() => window.copiedRfpLink)).toContain("request=" + saved.id);
  await page.getByRole("button", { name: "Invite suppliers by email" }).click();
  expect(invitations).toBe(0);
  await page.getByPlaceholder("name@company.com, another@co.com").fill("supplier@example.test");
  await page.getByRole("dialog", { name: "Share RFP" }).getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => invitations).toBe(1);
});
