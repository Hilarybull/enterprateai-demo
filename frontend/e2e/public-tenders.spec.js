import { expect, test } from "@playwright/test";
import { stubApi } from "./stub.js";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ea_cookie_consent", JSON.stringify({ operational: true, analytics: false })));
});

const id = "ocds-h6vhtk-001abc:lot:1";
const notice = { id, lot_id: "1", title: "School catering", buyer: "Example Council", status: "open", notice_id: "000101-2026",
  deadline: "2026-12-01T12:00:00Z", amount: null, published_at: "2026-11-17T10:00:00Z",
  sme_suitable:true, description: "Provide school lunches.", submission_instructions: "Submit through https://portal.example.test/bid", submission_url: "https://portal.example.test/bid", documents: [{title:"Specification",url:"https://portal.example.test/spec.pdf"}], url: "https://www.find-tender.service.gov.uk/Notice/000101-2026" };

test("visitors can search, filter, and open an official public tender", async ({ page }, testInfo) => {
  const searches = [];
  await page.route("http://api.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/me") return route.fulfill({ status: 401, json: {} });
    if (url.pathname === "/public-tenders") {
      searches.push({ stage: url.searchParams.get("stage"), q: url.searchParams.get("q"), sme:url.searchParams.get("sme"), industry:url.searchParams.get("industry"), location:url.searchParams.get("location") });
      return route.fulfill({ json: { items: [notice], total: 125, last_sync: "2026-11-18T12:00:00Z", stale: true } });
    }
    if (url.pathname.startsWith("/public-tenders/")) {
      return route.fulfill({ json: { ...notice, last_sync: "2026-11-18T12:00:00Z", stale: true } });
    }
    return route.fulfill({ json: { items: [], categories: [], total: 0 } });
  });
  await page.goto("/marketplace", {waitUntil:"domcontentloaded"});
  await page.getByRole("tab", { name: "Public Tenders" }).click();
  await expect(page.getByRole("combobox", { name: "Notice status" })).toHaveValue("open");
  await expect(page.getByRole("combobox",{name:"SME suitability"})).toHaveValue("suitable");
  await expect(page.getByText("Last successful sync:", { exact: false })).toBeVisible();
  const card = page.getByRole("article").filter({ hasText: "School catering" });
  await expect(card.getByText("Lot 1", { exact: true })).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.getByRole("combobox",{name:"SME suitability"}).scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath("filters-"+width+".png")});
  }
  await page.getByRole("searchbox", { name: "Search the Marketplace" }).fill("catering");
  await page.getByRole("combobox", { name: "Notice status" }).selectOption("planning");
  await expect.poll(() => searches.at(-1)).toMatchObject({ stage: "planning", q: "catering" });
  await expect(page.getByText("125 tenders · Suitable for SMEs", {exact:true})).toBeVisible();
  await page.getByRole("combobox", {name:"Industry (CPV)"}).selectOption("55");
  await page.getByRole("textbox", {name:"Location",exact:true}).fill("London");
  await expect(page).toHaveURL(/industry=55/);
  await expect.poll(()=>searches.at(-1)).toMatchObject({industry:"55",location:"London"});
  await page.getByRole("button", { name: "View Official Tender",exact:true }).click();
  await expect(page.getByText("Provide school lunches.")).toBeVisible();
  await expect(page.getByText("Not disclosed", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", {name:"How to submit"})).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to submission site",exact:false })).toHaveAttribute("href", notice.submission_url);
  await expect(page.getByRole("link",{name:"Specification",exact:false})).toHaveAttribute("href",notice.documents[0].url);
  for (const width of [390,768,1440]) { await page.setViewportSize({width,height:900}); await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true); await page.screenshot({path:testInfo.outputPath("tender-"+width+".png"),fullPage:true}); }
  await expect(page.getByRole("link", { name: "Sign in to save" })).toBeVisible();
});

test("signed-in buyer can save and remove a tender in the selected workspace", async ({ page }) => {
  await stubApi(page);
  let saved = false;
  let initialWatchlist;
  let reads = 0;
  const mutations = [];
  await page.route((url) => url.origin === "http://api.test" && url.pathname.startsWith("/public-tenders"), async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/public-tenders/watchlist") {
      if (++reads === 1) { initialWatchlist = route; return; }
      await route.fulfill({ json: { items: saved ? [notice] : [] } });
      if (initialWatchlist) { const stale = initialWatchlist; initialWatchlist = null; await stale.fulfill({json:{items:[]}}); }
      return;
    }
    if (url.pathname.endsWith("/watchlist")) {
      mutations.push([method, url.searchParams.get("workspace_id")]);
      saved = method === "PUT";
      return route.fulfill({ json: { saved } });
    }
    return route.fulfill({ json: { items: [notice], last_sync: null, stale: false } });
  });
  await page.goto("/marketplace?tab=tenders", {waitUntil:"domcontentloaded"});
  await expect.poll(()=>reads).toBe(1);
  await page.getByRole("button", { name: "Save to watchlist" }).click();
  await expect(page.getByRole("button", { name: "Remove from watchlist" })).toBeVisible();
  await page.getByRole("button", { name: "My watchlist" }).click();
  await expect(page.getByRole("heading", { name: "My watchlist" })).toBeVisible();
  await page.getByRole("button", { name: "Remove from watchlist" }).first().click();
  await expect(page.getByText("No notices saved in this workspace.")).toBeVisible();
  expect(mutations).toEqual([["PUT", "A"], ["DELETE", "A"]]);
});


test("tender filter errors stop loading counts and support retry", async ({page})=>{
  let fail=true;
  await page.route("http://api.test/**", async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==="/auth/me")return route.fulfill({status:401,json:{}});
    if(url.pathname==="/public-tenders") {
      expect(url.searchParams.get("sme")).toBe("suitable");
      if(fail)return route.fulfill({status:503,json:{detail:"Unavailable"}});
      return route.fulfill({json:{items:[],total:0,last_sync:"2026-11-18T12:00:00Z"}});
    }
    return route.fulfill({json:{items:[],total:0}});
  });
  await page.goto("/marketplace?tab=tenders", {waitUntil:"domcontentloaded"});
  await expect(page.getByText("Tender count unavailable · Suitable for SMEs",{exact:true})).toBeVisible();
  await expect(page.getByText(/Loading tender count|Loading tenders/)).toHaveCount(0);
  fail=false;
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await expect(page.getByText("0 tenders · Suitable for SMEs",{exact:true})).toBeVisible();
});


test("tender evaluation compares the active business and gives actionable steps", async ({page})=>{
  await stubApi(page);
  await page.route("**/public-tenders/**",route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith("/watchlist") ? {items:[]} : {...notice,last_sync:"2026-11-18T12:00:00Z"}}));
  await page.route("**/agent/requests",async route=>{
    const body=route.request().postDataJSON();
    expect(body.business_id).toBe("A");
    expect(body.params).toEqual({action:"tender_evaluation",tender_id:id});
    return route.fulfill({json:{kind:"answer",procurement:{status:"tender_evaluation",tender_evaluation:{
      notice_id:id,workspace_id:"A",business_name:"Altmosphere Consulting",verdict:"More information needed",overview:[{heading:"What the buyer needs",explanation:"A supplier to provide school lunches.",evidence:[{source:"description",quote:"Provide school lunches."}]}],findings:[{
        requirement:"Provide school lunches",alignment:"unknown",explanation:"Catering capability is not recorded in your business profile.",
        tender_evidence:[{source:"description",quote:"Provide school lunches."}],business_evidence:[],
        next_step:"Confirm catering capacity and add relevant experience to your business profile."
      }],limitations:["Linked documents have not been read."]}}}});
  });
  await page.goto("/marketplace?tab=tenders&tender="+encodeURIComponent(id),{waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:"Evaluate This Tender for Me",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Tender explained",exact:true})).toBeVisible();
  await expect(page.getByText("A supplier to provide school lunches.",{exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"What to do next",exact:true})).toBeVisible();
  await expect(page.getByText("Confirm catering capacity and add relevant experience to your business profile.",{exact:true})).toBeVisible();
  await expect(page.getByText("Information needed",{exact:true})).toBeVisible();
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
});


test("empty industry search stays in Marketplace without exposing sync internals", async ({page})=>{
  await page.route("http://api.test/**", async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==="/auth/me")return route.fulfill({status:401,json:{}});
    return route.fulfill({json:{items:[],total:0,last_sync:null,stale:true}});
  });
  await page.goto("/marketplace?tab=tenders&industry=32",{waitUntil:"domcontentloaded"});
  await expect(page.getByRole("heading",{name:"No tenders match your filters"})).toBeVisible();
  await expect(page.getByText(/haven't synced|first successful|pending import|browse the official service/i)).toHaveCount(0);
  await expect(page.locator('a[href*="find-tender.service.gov.uk"]')).toHaveCount(0);
  await page.getByRole("button",{name:"Clear search filters",exact:true}).click();
  await expect(page).not.toHaveURL(/industry=32/);
});
