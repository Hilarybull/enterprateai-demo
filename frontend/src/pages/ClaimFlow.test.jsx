// Marketplace business directory and claim journey: trust states in words, the claim kept
// through sign-in, matching, verification, review, and the screens a claimed business uses.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import ClaimFlowPage from "./ClaimFlowPage";
import DirectoryProfilePage from "./DirectoryProfilePage";
import { confirmDialog } from "../lib/dialog";
import MarketplaceProfilePage from "./MarketplaceProfilePage";
import MarketplaceModerationPage from "./MarketplaceModerationPage";
import MarketplacePage from "./MarketplacePage";
import MarketplaceHeader from "../components/marketplace/MarketplaceHeader";
import AdminClaims from "../components/marketplace/AdminClaims";
import AdminPage from "./AdminPage";
import OnboardingPage from "./OnboardingPage";
import AddBusinesses, { AddBusinessForm, ImportCsv, parseCsv } from "../components/marketplace/AddBusiness";
import { SavedBusinessMatch } from "../components/marketplace/MatchPrompt";
import { AdminTable, KpiTile, weeklySeries } from "../components/admin/AdminUI";
import { DirectoryResults, FindToClaim, OpportunityPreferences, ProfileSettings } from "../components/marketplace/Directory";
import { claimContext } from "../lib/directory";
import { useAuthStore } from "../store/auth";
import { useWorkspaceStore } from "../store/workspace";

vi.mock("../lib/dialog", async (original) => ({ ...(await original()), confirmDialog: vi.fn(async () => true) }));

const UNCLAIMED = { state: "unclaimed", label: "Business profile not yet claimed", meaning: "This profile is built from public sources. The business has not yet confirmed it on EnterprateAI." };
const VERIFIED = { state: "verified", label: "Owner-verified", meaning: "Someone with authority to manage this business has confirmed this profile. It is not a rating of quality or financial health." };
const base = { id: "p1", slug: "northwind-advisory-ltd-leeds", canonical_slug: "northwind-advisory-ltd-leeds", name: "Northwind Advisory Ltd", category: "Consulting", location: "Leeds", country: "United Kingdom",
  description: "Independent advisers helping small firms set prices.", website: "https://northwind-advisory.co.uk", service_tags: ["Strategy", "Pricing"], offerings: [], noindex: false };
const unclaimed = { ...base, trust: UNCLAIMED, claimed: false, opportunities: { enquiries: false, rfqs: false, proposals: false, partnerships: false, subcontracting: false },
  opportunity_note: "Claim to set opportunity preferences", claim: { eligible: true, cta: "Claim this Business for Free" }, legal_identifier: "12345678",
  source_basis: "This profile is based on public sources and has not been confirmed by the business.", sources: ["Companies House"], owner_controls: false };
const claimed = { ...base, trust: VERIFIED, claimed: true, activated: true, listing_id: "ws9", claim: { eligible: false }, owner_controls: false,
  offerings: [{ id: "o1", name: "Pricing review", description: "A two-week review." }], opportunities: { enquiries: true, rfqs: false, proposals: true, partnerships: false, subcontracting: false } };
const claimOf = (over = {}) => ({ id: "c1", status: "claim_started", next_step: "match", revision: 1, challenge: false, target: null, business_id: null, reason: null,
  profile: { ...unclaimed, has_website: true, domain: "northwind-advisory.co.uk" }, verification: null, opportunity: null, candidates: [],
  methods: [{ method: "email_domain", label: "Email a code to an address at northwind-advisory.co.uk", help: "Use an email address at northwind-advisory.co.uk." },
    { method: "manual", label: "Send evidence for review", help: "A person reviews it." }],
  can: { cancel: true, verify: false, edit_profile: false }, ...over });
const settings = (over = {}) => ({ business_id: "ws9", is_published: false, can_edit: true, directory: { id: "p1", slug: base.slug, trust: VERIFIED, legal_identifier: "12345678", sourced: { name: base.name }, sourced_tags: ["Strategy", "Pricing"], frozen: false },
  profile: { name: base.name, description: "", website: "", service_area: "", contact_preference: "enquiry_form", service_tags: [], revision: 0 },
  offerings: [{ id: "o1", name: "Pricing review", description: "", published: true }, { id: "o2", name: "Board pack", description: "", published: false }],
  preferences: { enquiries: { enabled: false }, rfqs: { enabled: false, categories: [], service_areas: [] }, proposals: { enabled: false, accepted_modes: ["general"] },
    partnerships: { enabled: false, notes: "" }, subcontracting: { enabled: false, notes: "" }, notifications: { email: true }, version: 0 },
  proposal_modes: [{ key: "general", label: "Unsolicited" }, { key: "solicited_general", label: "Solicited: general" }],
  activation: { ready: false, items: [{ key: "description", label: "A public description", done: false }] }, ...over });

let calls;
let routes;
function mockApi() {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "").replace(/^.*?(\/admin\/marketplace|\/marketplace|\/business-claims|\/businesses|\/workspace)/, "$1");
    const method = init.method || "GET";
    const call = { method, path, body: typeof init.body === "string" ? JSON.parse(init.body) : null };
    calls.push(call);
    const hit = routes.find((r) => r.method === method && (r.match.test(path) || r.match.test(path.split("?")[0])));
    const out = await (hit ? hit.reply(call) : { status: 404, body: { detail: "Not found." } });
    return new Response(JSON.stringify(out.body), { status: out.status || 200, headers: { "Content-Type": "application/json" } });
  });
}
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.search}</p>; }
const mount = (path, element, pattern) => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route path={pattern} element={element} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
const sent = (method, re) => calls.filter((c) => c.method === method && (re.test(c.path) || re.test(c.path.split("?")[0])));

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); useAuthStore.setState({ token: null, email: null, hydrated: true }); routes = []; mockApi(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove()); });

describe("business directory (W01)", () => {
  it("shows each business with its trust state in words, and treats unclaimed as neutral", async () => {
    routes = [{ method: "GET", match: /^\/marketplace\/businesses\?/, reply: () => ({ body: { enabled: true, total: 2, categories: ["Consulting"], items: [claimed, { ...unclaimed, id: "p2", slug: "harbour", name: "Harbour Legal LLP" }] } }) }];
    mount("/", <DirectoryResults query="" />, "/");
    const first = (await screen.findByText("Northwind Advisory Ltd")).closest("li");
    expect(within(first).getByText("Owner-verified")).toBeTruthy();
    expect(within(first).getByLabelText("Open for enquiries, proposals").textContent).toBe("EnquiriesProposals");      // only what is switched on, as chips
    expect(within(first).getByText("View profile →")).toBeTruthy();
    expect(within(first).queryByRole("button")).toBeNull();               // the card itself is the link
    const second = screen.getByText("Harbour Legal LLP").closest("li");
    expect(within(second).getByText("Business profile not yet claimed")).toBeTruthy();
    expect(second.textContent).not.toMatch(/unverified|low quality|warning/i);
    fireEvent.change(screen.getByLabelText("Profile status"), { target: { value: "claimed" } });
    await waitFor(() => expect(sent("GET", /trust=claimed/).length).toBe(1));
    const again = (await screen.findByText("Harbour Legal LLP")).closest("li");      // the list is redrawn after a filter change
    expect(within(again).queryByLabelText(/^Open for/)).toBeNull();          // nothing switched on: no chips, not greyed-out ones
    fireEvent.click(within(again).getByRole("link", { name: "Harbour Legal LLP: view profile" }));
    expect(screen.getByTestId("where").textContent).toBe("/marketplace/business/harbour");
  });

  it("an empty directory says nothing is listed yet, and only blames the search when there is one", async () => {
    routes = [{ method: "GET", match: /^\/marketplace\/businesses\?/, reply: () => ({ body: { enabled: true, total: 0, categories: [], items: [] } }) }];
    mount("/", <DirectoryResults query="" />, "/");
    await screen.findByText("No businesses listed yet.");
    fireEvent.change(screen.getByLabelText("Profile status"), { target: { value: "created" } });
    await screen.findByText("No businesses match that search.");
    expect(sent("GET", /trust=created/).length).toBe(1);
  });

  it("says so when the directory is switched off", async () => {
    routes = [{ method: "GET", match: /^\/marketplace\/businesses\?/, reply: () => ({ body: { enabled: false, items: [], total: 0, categories: [] } }) }];
    mount("/", <DirectoryResults query="" />, "/");
    await screen.findByText("The business directory isn't available yet.");
  });
});

describe("public profile (W02 and W12)", () => {
  it("an unclaimed profile says where it came from and offers a clear claim", async () => {
    routes = [{ method: "GET", match: /businesses\/northwind-advisory-ltd-leeds$/, reply: () => ({ body: { ...unclaimed, noindex: true } }) },
      { method: "POST", match: /\/view$/, reply: () => ({ status: 202, body: { ok: true } }) }];
    mount(`/marketplace/business/${base.slug}?invite=tok123`, <DirectoryProfilePage />, "/marketplace/business/:slug");
    await screen.findByRole("heading", { name: "Northwind Advisory Ltd" });
    expect(screen.getByRole("heading", { name: "Northwind Advisory Ltd" }).closest("section").textContent).toContain("NA");      // the initials mark
    // One badge, in the header; what it means is beside it on request, and in the trust card.
    expect(screen.getAllByText("Business profile not yet claimed").length).toBe(1);
    expect(screen.getByRole("heading", { name: "About this badge" }).closest("section").textContent).toContain("This profile is based on public sources");
    const info = screen.getByRole("button", { name: /Based on public sources · Companies House/ });
    expect(info.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(info);
    const note = screen.getByRole("note");
    expect(note.textContent).toContain("This profile is based on public sources and has not been confirmed by the business. Sources: Companies House.");
    expect(note.textContent).toContain("Registered number 12345678, from the public register.");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByText("Claim to set opportunity preferences")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Enquire|Request a quote|Apply/ })).toBeNull();      // no actions before a claim
    expect(screen.getAllByRole("button", { name: "Claim this Business for Free" }).length).toBe(1);      // one primary action, in the hero
    expect(document.head.querySelector('meta[name="robots"]').content).toBe("noindex");
    expect(sent("POST", /\/view$/).length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Claim this Business for Free" }));
    expect(screen.getByTestId("where").textContent).toBe(`/marketplace/claim/${base.slug}?invite=tok123`);      // the invitation travels with the claim
  });

  it("a claimed profile shows what the owner confirmed and only the actions they switched on", async () => {
    routes = [{ method: "GET", match: /businesses\/northwind-advisory-ltd-leeds$/, reply: () => ({ body: claimed }) }, { method: "POST", match: /\/view$/, reply: () => ({ status: 202, body: {} }) }];
    mount(`/marketplace/business/${base.slug}`, <DirectoryProfilePage />, "/marketplace/business/:slug");
    await screen.findByText("Owner-verified");
    expect(screen.getAllByText("Owner-verified").length).toBe(1);          // one badge
    fireEvent.click(screen.getByRole("button", { name: /Owner-verified · what this means/ }));
    expect(screen.getByRole("note").textContent).toContain("It is not a rating of quality or financial health");
    const header = screen.getByRole("heading", { name: "Northwind Advisory Ltd" }).closest("section");
    expect(header.getAttribute("aria-label")).toBe("Business");
    expect(header.querySelector("[data-meta]").textContent).toBe("Consulting·Leeds, United Kingdom·northwind-advisory.co.uk");
    // Quotes are off here, so the one main button is "Contact"; "Share" sits beside it.
    expect(within(header).getAllByRole("button").map((x) => x.textContent).filter((t) => t !== "i")).toEqual(["Contact", "Share"]);
    expect(screen.queryByRole("button", { name: /^Request a quote/ })).toBeNull();
    // Offerings are cards; with quotes off each one offers a question instead.
    const card = screen.getByText("Pricing review").closest("li");
    expect(card.textContent).toContain("A two-week review.");
    expect(card.textContent).toContain("Price on request");
    expect(within(card).getByRole("button", { name: "Ask about this: Pricing review" })).toBeTruthy();
    // The ways to work with the business, in plain words: only the ones switched on.
    const ways = screen.getByRole("heading", { name: "How to work with us" }).closest("section");
    expect([...ways.querySelectorAll("[data-ways] > li")].map((li) => within(li).getByRole("button").textContent)).toEqual(["Ask a question", "Send a proposal"]);
    expect(ways.textContent).toContain("Send a message and get a reply from the business.");
    expect(screen.queryByText(/RFQs|Subcontracting|^Apply$/)).toBeNull();      // no jargon pills, no vague "Apply"
    expect(screen.getByRole("heading", { name: "Contact Northwind Advisory Ltd" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Claim this Business/ })).toBeNull();
    expect(document.querySelector("[data-owner-bar]")).toBeNull();          // owner controls only for the owner
    expect(document.querySelector("[data-sticky-action]").className).toContain("md:hidden");      // on a phone the main button stays in reach
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
    fireEvent.click(within(header).getByRole("button", { name: "Contact" }));
    expect(screen.getByTestId("where").textContent).toBe("/marketplace?tab=products&business=ws9");
  });

  it("with quotes on, the main button and each offering ask for a quote, with that offering already filled in", async () => {
    routes = [{ method: "GET", match: /businesses\/northwind-advisory-ltd-leeds$/, reply: () => ({ body: { ...claimed, since: "2026-10-02T09:00:00+00:00", opportunities: { ...claimed.opportunities, rfqs: true } } }) },
      { method: "POST", match: /\/view$/, reply: () => ({ status: 202, body: {} }) }];
    mount(`/marketplace/business/${base.slug}`, <DirectoryProfilePage />, "/marketplace/business/:slug");
    const header = (await screen.findByRole("heading", { name: "Northwind Advisory Ltd" })).closest("section");
    expect(header.querySelector("[data-meta]").textContent).toContain("On EnterprateAI since Oct 2026");
    expect(within(header).getByRole("button", { name: "Request a quote" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Get a quote from Northwind Advisory Ltd" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Request a quote: Pricing review" }));
    expect(screen.getByTestId("where").textContent).toBe("/marketplace?tab=products&business=ws9&quote=1&offering=Pricing%20review");
  });

  it("the owner gets a slim bar above the page, can see it as a visitor, and unlists only after confirming", async () => {
    confirmDialog.mockClear();
    const mine = { ...claimed, trust: { state: "created", label: "Created on EnterprateAI · not verified", meaning: "Nobody has checked who is behind it yet." }, owner_controls: true, business_id: "ws9",
      quality_hold: ["Write a real description: a sentence or two on what you do and who for, not repeated characters."] };
    routes = [{ method: "GET", match: /businesses\/northwind-advisory-ltd-leeds$/, reply: () => ({ body: mine }) }, { method: "POST", match: /\/view$/, reply: () => ({ status: 202, body: {} }) },
      { method: "POST", match: /businesses\/ws9\/marketplace-profile\/activate$/, reply: () => ({ body: {} }) }];
    mount(`/marketplace/business/${base.slug}`, <DirectoryProfilePage />, "/marketplace/business/:slug");
    const bar = await screen.findByRole("region", { name: "Your profile" });
    expect(bar.textContent).toContain("You're viewing your public profile");
    expect(within(bar).getAllByRole("button").map((x) => x.textContent)).toEqual(["Edit profile", "Opportunity settings", "Verify", "Unlist", "View as visitor", "Manage"]);
    expect(within(bar).getByRole("button", { name: "Manage" }).parentElement.className).toContain("md:hidden");      // one menu on a phone
    expect(screen.queryByText("You manage this profile")).toBeNull();        // no longer a card in the public sidebar
    // What is keeping it off the Marketplace, said to the owner only.
    expect(screen.getByText(/Only you can see this page/).closest("[role=alert]").textContent).toContain("Write a real description");
    fireEvent.click(within(bar).getByRole("button", { name: "View as visitor" }));
    expect(screen.queryByText(/Only you can see this page/)).toBeNull();
    expect(screen.getByText("This is what a visitor sees")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to your view" }));
    // Unlist asks first.
    confirmDialog.mockResolvedValueOnce(false);
    fireEvent.click(within(screen.getByRole("region", { name: "Your profile" })).getByRole("button", { name: "Unlist" }));
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    expect(confirmDialog.mock.calls[0][1]).toMatchObject({ title: "Unlist your business?", confirmLabel: "Unlist", danger: true });
    expect(sent("POST", /activate$/).length).toBe(0);
    fireEvent.click(within(screen.getByRole("region", { name: "Your profile" })).getByRole("button", { name: "Unlist" }));
    await waitFor(() => expect(sent("POST", /activate$/)[0].body).toEqual({ publish: false }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/marketplace/profile?business=ws9"));
  });

  it("a correction can be sent without an account, and a missing profile says so", async () => {
    routes = [{ method: "GET", match: /businesses\/northwind-advisory-ltd-leeds$/, reply: () => ({ body: unclaimed }) }, { method: "POST", match: /\/view$/, reply: () => ({ status: 202, body: {} }) },
      { method: "POST", match: /\/reports$/, reply: () => ({ status: 201, body: { id: "r1", status: "open", message: "Thank you. We'll review this; you don't need an account for us to act on it." } }) }];
    mount(`/marketplace/business/${base.slug}`, <DirectoryProfilePage />, "/marketplace/business/:slug");
    fireEvent.click(await screen.findByRole("button", { name: /Report incorrect information/ }));
    fireEvent.change(screen.getByLabelText("Details"), { target: { value: "The website address is out of date." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/you don't need an account/);
    expect(sent("POST", /\/reports$/)[0].body).toMatchObject({ kind: "correction", message: "The website address is out of date." });
    cleanup();
    routes = [];
    mount("/marketplace/business/gone", <DirectoryProfilePage />, "/marketplace/business/:slug");
    await screen.findByText("This business profile isn't available.");
  });
});

describe("claim journey (W03 to W11)", () => {
  const profileRoute = { method: "GET", match: /marketplace\/businesses\/northwind-advisory-ltd-leeds$/, reply: () => ({ body: unclaimed }) };

  it("explains the claim, then keeps it through sign-in", async () => {
    routes = [profileRoute, { method: "POST", match: /claim-intents$/, reply: () => ({ status: 201, body: { intent: "INT-1", profile: unclaimed, opportunity: null } }) }];
    mount(`/marketplace/claim/${base.slug}?source=search`, <ClaimFlowPage />, "/marketplace/claim/:slug");
    await screen.findByRole("heading", { name: "Claim Northwind Advisory Ltd" });
    expect(screen.getByText("You are claiming: Northwind Advisory Ltd")).toBeTruthy();
    expect(screen.getByText(/It does not verify the quality of the business or its financial health/)).toBeTruthy();
    expect(sent("POST", /\/claims$/).length).toBe(0);                     // nothing is started before sign-in
    fireEvent.click(screen.getByRole("button", { name: "Create a free account to claim" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`/login?signup=1&next=${encodeURIComponent(`/marketplace/claim/${base.slug}?intent=INT-1`)}`));
    expect(sent("POST", /claim-intents$/)[0].body).toMatchObject({ source: "search" });      // kept on the server
    expect(claimContext()).toMatchObject({ slug: base.slug, name: "Northwind Advisory Ltd", intent: "INT-1" });
  });

  it("shows a real opportunity as a teaser from an invitation, and never more than that", async () => {
    routes = [profileRoute, { method: "POST", match: /claim-intents$/, reply: () => ({ status: 201, body: { intent: "INT-2", profile: unclaimed,
      opportunity: { reference: "req-1", available: true, text: "A current Marketplace request may match your services.", note: "Claim and verify your profile to see the request and respond. This is not a promise of work." } } }) }];
    mount(`/marketplace/claim/${base.slug}?invite=tok`, <ClaimFlowPage />, "/marketplace/claim/:slug");
    await screen.findByText("A current Marketplace request may match your services.");
    expect(screen.getByText(/This is not a promise of work/)).toBeTruthy();
    expect(sent("POST", /claim-intents$/)[0].body).toMatchObject({ invitation: "tok" });
  });

  it("resumes after sign-in at the matching step, then verifies with an emailed code", async () => {
    useAuthStore.setState({ token: "t", email: "owner@northwind-advisory.co.uk", hydrated: true });
    let claim = claimOf({ candidates: [{ business_id: "ws1", name: "Northwind (existing)", location: "Leeds", likely_match: true, already_linked: false },
      { business_id: "ws2", name: "Other Co", location: "", likely_match: false, already_linked: true }] });
    routes = [profileRoute,
      { method: "POST", match: /directory-profiles\/.+\/claims$/, reply: () => ({ status: 201, body: claim }) },
      { method: "POST", match: /business-claims\/c1\/match$/, reply: ({ body }) => { claim = claimOf({ target: body.business_id, next_step: "verification", can: { cancel: true, verify: true } }); return { body: claim }; } },
      { method: "POST", match: /business-claims\/c1\/verification$/, reply: ({ body }) => {
        if (body.email.endsWith("@gmail.com")) return { status: 422, body: { detail: { code: "invalid", message: "x", errors: { email: "Use an email address at northwind-advisory.co.uk. A personal address can't show that you manage this business." } } } };
        claim = claimOf({ target: "ws1", status: "verification_pending", next_step: "verification", verification: { id: "v1", method: "email_domain", status: "sent", destination: "o•••@northwind-advisory.co.uk", attempts_left: 5 } });
        return { status: 201, body: claim };
      } },
      { method: "POST", match: /verification\/v1\/complete$/, reply: ({ body }) => (body.code === "123456"
        ? { body: claimOf({ status: "verified", next_step: "profile_review", business_id: "ws1", target: "ws1", can: { cancel: false, edit_profile: true } }) }
        : { status: 422, body: { detail: { code: "invalid", message: "x", errors: { code: "That code isn't right." } } } }) },
      { method: "GET", match: /businesses\/ws1\/marketplace-profile$/, reply: () => ({ body: settings({ business_id: "ws1" }) }) }];
    mount(`/marketplace/claim/${base.slug}?intent=INT-1`, <ClaimFlowPage />, "/marketplace/claim/:slug");
    await screen.findByText("Which EnterprateAI business should this profile belong to?");      // no introduction again: straight to where they were
    expect(sent("POST", /\/claims$/)[0].body).toMatchObject({ intent: "INT-1" });
    expect(screen.getByLabelText(/Northwind \(existing\) · likely the same business/).checked).toBe(true);
    expect(screen.getByLabelText(/Other Co/).disabled).toBe(true);        // already has a profile: can't be given a second
    fireEvent.click(screen.getByRole("button", { name: "Confirm Business" }));
    await screen.findByText("Verify that you manage Northwind Advisory Ltd");
    expect(sent("POST", /\/match$/)[0].body).toEqual({ business_id: "ws1" });
    fireEvent.change(screen.getByLabelText("Your email address at northwind-advisory.co.uk"), { target: { value: "me@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    expect((await screen.findByText(/A personal address can't show that you manage this business/)).getAttribute("role")).toBe("alert");
    fireEvent.change(screen.getByLabelText("Your email address at northwind-advisory.co.uk"), { target: { value: "owner@northwind-advisory.co.uk" } });
    fireEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    await screen.findByText(/We sent a 6-digit code to o•••@northwind-advisory.co.uk/);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and Continue" }));
    await screen.findByText("That code isn't right.");
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and Continue" }));
    await screen.findByText("You now manage Northwind Advisory Ltd on EnterprateAI");
    expect(screen.getByRole("button", { name: "Save & Set Opportunity Preferences" })).toBeTruthy();
  });

  it("a claim under review says what can and can't be done, and a rejected one can start again", async () => {
    useAuthStore.setState({ token: "t", email: "a@b.test", hydrated: true });
    let claim = claimOf({ status: "verification_pending", next_step: "pending_review", target: "new", verification: { id: "v2", method: "manual", status: "submitted", submitted_at: "2026-10-05T09:00:00Z" } });
    routes = [profileRoute, { method: "POST", match: /directory-profiles\/.+\/claims$/, reply: () => ({ status: 201, body: claim }) }];
    mount(`/marketplace/claim/${base.slug}?intent=INT-1`, <ClaimFlowPage />, "/marketplace/claim/:slug");
    await screen.findByText("Claim under review");
    expect(screen.getByText("Editing the public profile")).toBeTruthy();
    expect(screen.getByText("Evidence for review · 5 Oct 2026")).toBeTruthy();
    expect(screen.queryByLabelText("Public description")).toBeNull();     // no owner controls before approval
    fireEvent.click(screen.getByRole("button", { name: "Return to Marketplace" }));
    expect(screen.getByTestId("where").textContent).toBe("/marketplace?tab=businesses");
    cleanup();
    claim = claimOf({ status: "rejected", next_step: "closed", reason: "We couldn't confirm that you manage this business from what was provided. You can start again with different evidence.", can: { cancel: false } });
    mount(`/marketplace/claim/${base.slug}?intent=INT-1`, <ClaimFlowPage />, "/marketplace/claim/:slug");
    await screen.findByText("We couldn't confirm this claim");
    expect(screen.getByText(/You can start again with different evidence/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(screen.getByRole("heading", { name: "Claim Northwind Advisory Ltd" })).toBeTruthy();
  });

  it("finishes by confirming context with the dashboard's own settings and opening the ordinary dashboard", async () => {
    useAuthStore.setState({ token: "t", email: "a@b.test", hydrated: true });
    const claim = claimOf({ status: "verified", next_step: "context", business_id: "ws9", target: "new", can: { cancel: false, edit_profile: true } });
    routes = [profileRoute, { method: "POST", match: /directory-profiles\/.+\/claims$/, reply: () => ({ status: 201, body: claim }) },
      { method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: settings({ is_published: true }) }) },
      { method: "GET", match: /businesses\/ws9\/dashboard/, reply: () => ({ body: { enabled: true, context: { business_stage: "idea", detected_stage: "idea", current_goal: null,
        stages: [{ key: "idea", label: "Idea" }, { key: "pre_launch", label: "Pre-launch" }, { key: "operating", label: "Operating" }, { key: "growth", label: "Growth" }],
        goals: [{ key: "launch", label: "Launch" }, { key: "funding", label: "Prepare for funding" }] } } }) },
      { method: "PUT", match: /dashboard\/stage$/, reply: () => ({ body: {} }) }, { method: "PUT", match: /dashboard\/preferences$/, reply: () => ({ body: {} }) },
      { method: "POST", match: /business-claims\/c1\/handoff$/, reply: () => ({ body: { business_id: "ws9", to: "/dashboard" } }) }];
    mount(`/marketplace/claim/${base.slug}?intent=INT-1`, <ClaimFlowPage />, "/marketplace/claim/:slug");
    const stage = await screen.findByLabelText("Where is the business now?");
    await waitFor(() => expect(stage.value).toBe("idea"));
    expect(within(stage).getByText("Idea (from your records)")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Do you currently have customers or revenue?"), { target: { value: "yes" } });
    expect(screen.getByText(/“Operating” may describe you better/)).toBeTruthy();      // a suggestion; the person decides
    fireEvent.change(stage, { target: { value: "operating" } });
    fireEvent.change(screen.getByLabelText(/What matters most right now/), { target: { value: "funding" } });
    fireEvent.click(screen.getByRole("button", { name: "Go to My Dashboard" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/dashboard"));
    expect(sent("PUT", /dashboard\/stage$/)[0].body).toEqual({ stage: "operating" });
    expect(sent("PUT", /dashboard\/preferences$/)[0].body).toMatchObject({ current_goal: "funding" });
    expect(sent("POST", /handoff$/).length).toBe(1);
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws9");         // the claimed business is the one in view
  });
});

describe("profile and opportunity settings (W08 and W09)", () => {
  it("saves the public profile with the Catalogue offerings to show", async () => {
    const onSaved = vi.fn();
    routes = [{ method: "PATCH", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: settings({ profile: { ...settings().profile, revision: 1 } }) }) }];
    mount("/", <ProfileSettings profile={settings()} claimId="c1" onSaved={onSaved} />, "/");
    expect(screen.getByLabelText("Services (separate with commas)").value).toBe("Strategy, Pricing");      // sourced tags offered for confirmation, not retyped
    fireEvent.change(screen.getByLabelText(/Public description/), { target: { value: "We help small firms set prices that hold." } });
    fireEvent.change(screen.getByLabelText("Location or service area"), { target: { value: "Leeds and remote" } });
    fireEvent.click(screen.getByLabelText("Board pack"));
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent("PATCH", /marketplace-profile$/)[0].body).toEqual({ revision: 0, claim_id: "c1", changes: { description: "We help small firms set prices that hold.", website: "", service_area: "Leeds and remote",
      contact_preference: "enquiry_form", public_email: "", public_phone: "", service_tags: ["Strategy", "Pricing"], published_offering_ids: ["o1", "o2"] } });
  });

  it("pauses editing while ownership is under review, and for roles that can't edit", () => {
    mount("/", <ProfileSettings profile={settings({ directory: { ...settings().directory, frozen: true } })} onSaved={() => {}} />, "/");
    expect(screen.getByText(/changes are paused until that is settled/)).toBeTruthy();
    expect(screen.getByLabelText(/Public description/).disabled).toBe(true);
    cleanup();
    mount("/", <ProfileSettings profile={settings({ can_edit: false })} onSaved={() => {}} />, "/");
    expect(screen.getByRole("button", { name: "Save profile" }).disabled).toBe(true);
  });

  it("saves opportunity choices, sends proposal modes as Proposal Intelligence names them, and keeps the settings when publishing has to wait", async () => {
    const onSaved = vi.fn();
    routes = [{ method: "PATCH", match: /marketplace-opportunity-preferences$/, reply: () => ({ body: settings() }) },
      { method: "POST", match: /marketplace-profile\/activate$/, reply: () => ({ status: 409, body: { detail: { code: "entitlement", message: "The Explorer plan includes 1 Marketplace listing. Unlist your other business or upgrade for more. Your profile and settings are saved." } } }) }];
    mount("/", <OpportunityPreferences profile={settings()} claimId="c1" onSaved={onSaved} saveLabel="Activate Marketplace Profile" activateOnSave />, "/");
    fireEvent.click(screen.getByLabelText(/^Enquiries/));
    fireEvent.click(screen.getByLabelText(/^Proposals/));
    fireEvent.click(screen.getByLabelText("Solicited: general"));
    fireEvent.click(screen.getByRole("button", { name: "Activate Marketplace Profile" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = sent("PATCH", /preferences$/)[0].body;
    expect(body.claim_id).toBe("c1");
    expect(body.changes.enquiries).toEqual({ enabled: true });
    expect(body.changes.proposals).toEqual({ enabled: true, accepted_modes: ["general", "solicited_general"] });
    expect(screen.getByText(/Saved\. The Explorer plan includes 1 Marketplace listing/)).toBeTruthy();      // nothing lost; the reason is given
  });
});

describe("a business's Marketplace profile page", () => {
  const CREATED = { state: "created", label: "Created on EnterprateAI", meaning: "This profile was set up by the business from its own EnterprateAI account." };
  const own = (over = {}) => settings({ is_published: true, activation: { ready: true, items: [] },
    directory: { id: "p9", slug: "apex-consulting", trust: CREATED, origin: "created", public: true, legal_identifier: null, sourced: { name: "Apex Consulting" }, sourced_tags: [], frozen: false }, ...over });
  const page = () => mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
  beforeEach(() => { useAuthStore.setState({ token: "t", email: "a@b.test", hydrated: true }); useWorkspaceStore.setState({ workspaceId: "ws9" }); });

  it("confirms publishing and unpublishing in words, with the button held while the request runs", async () => {
    let release;
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: own() }) }, { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) },
      { method: "POST", match: /marketplace-profile\/activate$/, reply: ({ body }) => new Promise((ok) => { release = () => ok({ body: own({ is_published: body.publish, directory: { ...own().directory, public: body.publish } }) }); }) }];
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Preview public profile" }));
    expect(opened).toHaveBeenCalledWith("/marketplace/business/apex-consulting", "_blank", "noopener");
    expect(screen.getByText("Not verified")).toBeTruthy();
    expect(screen.queryByText(/These come from public sources/)).toBeNull();      // nothing here was sourced
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    const held = await screen.findByRole("button", { name: "Unpublishing…" });
    expect(held.disabled).toBe(true);
    fireEvent.click(held);
    await waitFor(() => expect(sent("POST", /activate$/).length).toBe(1));      // one click, one request
    release();
    await screen.findByText(/Unpublished\. Your profile is no longer shown on the Marketplace/);
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Preview public profile" })).toBeNull();      // no page to preview once unpublished
    fireEvent.click(screen.getByRole("button", { name: "Activate Marketplace Profile" }));
    await screen.findByRole("button", { name: "Publishing…" });
    await waitFor(() => expect(sent("POST", /activate$/).length).toBe(2));
    release();
    await screen.findByText("Published. Your profile is now on the Marketplace.");
    expect(sent("POST", /activate$/).map((c) => c.body.publish)).toEqual([false, true]);
  });

  it("confirms each save, shows a public email field only when that route is chosen, and says why publishing failed", async () => {
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: own({ is_published: false }) }) }, { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) },
      { method: "PATCH", match: /businesses\/ws9\/marketplace-profile$/, reply: ({ body }) => (body.changes.contact_preference === "email" && !body.changes.public_email
        ? { status: 422, body: { detail: { code: "invalid", message: "x", errors: { public_email: "Enter the business email address to show publicly." } } } }
        : { body: own({ is_published: false, profile: { ...own().profile, ...body.changes, service_tags: [], revision: 1 } }) }) },
      { method: "PATCH", match: /marketplace-opportunity-preferences$/, reply: () => ({ body: own({ is_published: false, preferences: { ...own().preferences, version: 1 } }) }) },
      { method: "POST", match: /activate$/, reply: () => ({ status: 409, body: { detail: { code: "entitlement", message: "The Explorer plan includes 1 Marketplace listing. Unlist your other business or upgrade for more. Your profile and settings are saved." } } }) }];
    page();
    await screen.findByLabelText(/Public description/);
    expect(screen.queryByLabelText("Business email to show publicly")).toBeNull();
    fireEvent.change(screen.getByLabelText("How should people contact you?"), { target: { value: "email" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect((await screen.findByText("Enter the business email address to show publicly.")).getAttribute("role")).toBe("alert");
    expect(screen.getByText(/Your sign-in email is never shown/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Business email to show publicly"), { target: { value: "hello@apex.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText("Saved. Your profile is up to date.");
    expect(sent("PATCH", /marketplace-profile$/)[1].body.changes).toMatchObject({ contact_preference: "email", public_email: "hello@apex.test" });
    fireEvent.click(screen.getByRole("tab", { name: "Opportunities" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save opportunity settings" }));
    await screen.findByText("Saved. Your opportunity settings are up to date.");
    fireEvent.click(screen.getByRole("button", { name: "Activate Marketplace Profile" }));
    expect((await screen.findByText(/The Explorer plan includes 1 Marketplace listing/)).closest("[role=alert]")).toBeTruthy();
    expect(screen.queryByText("Saved. Your opportunity settings are up to date.")).toBeNull();      // the error replaces the earlier confirmation
  });

  it("the old moderation address forwards to the admin area's Marketplace section", () => {
    mount("/marketplace-moderation", <MarketplaceModerationPage />, "/marketplace-moderation");
    expect(screen.getByTestId("where").textContent).toBe("/ent-admin?section=marketplace");
  });
});

describe("QA round 2", () => {
  const profileRoute = (body) => ({ method: "GET", match: /marketplace\/businesses\/northwind-advisory-ltd-leeds$/, reply: () => ({ body }) });
  const claimPage = () => mount(`/marketplace/claim/${base.slug}`, <ClaimFlowPage />, "/marketplace/claim/:slug");
  beforeEach(() => { useAuthStore.setState({ token: "t", email: "a@b.test", hydrated: true }); });

  it("Q-5: a profile this person already claimed opens as theirs, not as a new claim", async () => {
    routes = [profileRoute({ ...claimed, owner_controls: true, business_id: "ws9" }),
      { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [claimOf({ id: "c9", status: "verified", next_step: "done", business_id: "ws9", profile: { ...claimed, id: "p1" }, can: { cancel: false } })] } }) },
      { method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: settings({ is_published: true }) }) }];
    claimPage();
    await screen.findByText("You manage this business");
    expect(screen.queryByRole("heading", { name: /^Claim / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue to Claim" })).toBeNull();
    expect(screen.queryByText(/You are claiming/)).toBeNull();
    expect(sent("POST", /\/claims$/).length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Open Marketplace profile" }));
    expect(screen.getByTestId("where").textContent).toBe("/marketplace/profile?business=ws9");
  });

  it("Q-5: an unfinished claim opened directly carries on at its next step", async () => {
    routes = [profileRoute(unclaimed), { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [claimOf({ target: "new", next_step: "verification", can: { cancel: true, verify: true }, profile: { ...unclaimed, has_website: true, domain: "northwind-advisory.co.uk" } })] } }) }];
    claimPage();
    await screen.findByText("Verify that you manage Northwind Advisory Ltd");
    expect(screen.queryByRole("button", { name: "Continue to Claim" })).toBeNull();
  });

  it("Q-5: a profile another business holds says it is already claimed and offers a review", async () => {
    routes = [profileRoute(claimed), { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) },
      { method: "POST", match: /directory-profiles\/.+\/claims$/, reply: () => ({ status: 201, body: claimOf({ challenge: true }) }) }];
    claimPage();
    await screen.findByText("Already claimed");
    expect(screen.getByText(/a person decides/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue to Claim" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ask for a review" }));
    await screen.findByText("Which EnterprateAI business should this profile belong to?");
    cleanup();
    useAuthStore.setState({ token: null, email: null, hydrated: true });
    routes = [profileRoute(claimed)];
    claimPage();
    await screen.findByRole("button", { name: "Sign in to ask for a review" });
    expect(screen.queryByRole("button", { name: "Create a free account to claim" })).toBeNull();
  });

  it("Q-4: a claimed profile that isn't published yet shows the sourced details and says so", async () => {
    routes = [profileRoute({ ...claimed, activated: false, listing_id: null, offerings: [], opportunities: { enquiries: false, rfqs: false, proposals: false },
      source_basis: "These details come from public sources. The business manages this profile and hasn't published its own details yet.", sources: ["Companies House"] }),
      { method: "POST", match: /\/view$/, reply: () => ({ status: 202, body: {} }) }];
    mount(`/marketplace/business/${base.slug}`, <DirectoryProfilePage />, "/marketplace/business/:slug");
    await screen.findByText("Owner-verified");
    fireEvent.click(screen.getByRole("button", { name: /Based on public sources · Companies House/ }));
    expect(screen.getByRole("note").textContent).toContain("hasn't published its own details yet. Sources: Companies House.");
    expect(screen.getAllByText("This business hasn't published its Marketplace profile yet.").length).toBeGreaterThan(0);
    expect(screen.getByText("Services")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Enquire|Apply|Claim this Business/ })).toBeNull();
  });

  it("Q-3: an older profile address moves to the current one", async () => {
    routes = [{ method: "GET", match: /marketplace\/businesses\/northwind-advisory-ltd-(14-acacia-avenue-)?leeds$/, reply: () => ({ body: unclaimed }) }, { method: "POST", match: /\/view$/, reply: () => ({ status: 202, body: {} }) }];
    const shown = [];
    function Spy() { const l = useLocation(); shown.push(l.pathname + l.search); return <DirectoryProfilePage />; }
    mount("/marketplace/business/northwind-advisory-ltd-14-acacia-avenue-leeds?invite=tok", <Spy />, "/marketplace/business/:slug");
    await waitFor(() => expect(shown.at(-1)).toBe(`/marketplace/business/${base.slug}?invite=tok`));
    await screen.findByRole("heading", { name: "Northwind Advisory Ltd" });
  });

  it("Q-1: a reviewer who is a party is told someone else must decide, with no evidence or buttons", async () => {
    const row = (over) => ({ id: "c1", status: "verification_pending", created_at: "2026-10-05T09:00:00Z", claimant_email: "x@y.test", challenge: false, target: "new", needs_another_reviewer: false,
      profile: { id: "p1", slug: base.slug, name: "Northwind Advisory Ltd", company_number: "12345678", domain: "northwind-advisory.co.uk" },
      evidence: [{ id: "v1", method: "manual", status: "submitted", note: "I am a director.", files: [] }], history: [], ...over });
    routes = [{ method: "GET", match: /admin\/marketplace\/claims/, reply: () => ({ body: { claims: [row({ id: "c1", needs_another_reviewer: true, evidence: [] }), row({ id: "c2", profile: { ...row().profile, name: "Harbour Legal LLP" } })],
      reports: [{ id: "r1", kind: "unlist", message: "Please remove.", created_at: "2026-10-05T09:00:00Z", needs_another_reviewer: true }] } }) },
      { method: "GET", match: /admin\/marketplace\/funnel$/, reply: () => ({ body: { events: { BusinessClaimStarted: 2 }, reports_open: 1, profiles: { total: 2, published: 2, claimed: 0, suppressed: 0 } } }) },
      { method: "POST", match: /normalise-locations$/, reply: () => ({ body: { count: 1, changed: [] } }) }];
    mount("/", <AdminClaims />, "/");
    const mine = (await screen.findByText("Northwind Advisory Ltd")).closest("tr");
    expect(within(mine).getByText("Needs another reviewer")).toBeTruthy();
    expect(within(mine).queryByRole("button", { name: "Review" })).toBeNull();
    expect(screen.getByText(/you can't see its evidence or decide it/)).toBeTruthy();
    const other = screen.getByText("Harbour Legal LLP").closest("tr");
    expect(screen.queryByText("I am a director.")).toBeNull();            // evidence opens with the review, not before
    fireEvent.click(within(other).getByRole("button", { name: "Review" }));
    expect(screen.getByText("I am a director.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" }).disabled).toBe(true);      // a decision needs a reason
    expect(screen.getAllByRole("button", { name: "Approve" }).length).toBe(1);
    fireEvent.click(screen.getByRole("tab", { name: /^Reports/ }));
    expect(screen.getByText("This is about a profile your own business manages.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unlist the profile" })).toBeNull();      // the report is about their own business's profile
    // The directory at a glance, as tiles.
    const tiles = screen.getByRole("region", { name: "Directory at a glance" });
    expect(["Indexed", "Claims started", "Verified", "Published", "Suppressed", "Reports open"].every((label) => within(tiles).getByText(label))).toBe(true);
    expect(within(tiles).getByText("Reports open").parentElement.textContent).toBe("Reports open1");
    fireEvent.click(screen.getByRole("tab", { name: "Index & invites" }));
    fireEvent.click(screen.getByRole("button", { name: "Tidy stored locations" }));
    await screen.findByText("Tidied 1 profile. Their old addresses still open.");
  });

  it("R-2: asks whether an existing profile is theirs before publishing, and keeps the answer on the server", async () => {
    useWorkspaceStore.setState({ workspaceId: "ws9" });
    const match = { ...unclaimed, matched_on: "website" };
    let answered = false;
    const mine = (over = {}) => settings({ directory: null, activation: { ready: true, items: [{ key: "description", label: "A public description", done: true }] }, possible_duplicates: answered ? [] : [match], ...over });
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: mine() }) }, { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) },
      { method: "POST", match: /duplicate-answers$/, reply: () => { answered = true; return { body: mine() }; } },
      { method: "POST", match: /activate$/, reply: () => (answered ? { body: mine({ is_published: true }) }
        : { status: 409, body: { detail: { code: "possible_duplicate", message: "x", profile: match } } }) }];
    mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
    await screen.findByText(/We found an existing Marketplace profile/);
    expect(sent("GET", /claimable-businesses/).length).toBe(0);          // the server works out the matches; the page doesn't guess
    fireEvent.click(screen.getByRole("button", { name: "Activate Marketplace Profile" }));
    await screen.findByText("Before you publish: is this your business?");
    expect(sent("POST", /activate$/).length).toBe(0);                     // nothing is published until they answer
    fireEvent.click(screen.getByRole("button", { name: "Claim and link it" }));
    expect(screen.getByTestId("where").textContent).toBe(`/marketplace/claim/${base.slug}?source=signup_match`);
    cleanup();
    mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
    await screen.findByText(/We found an existing Marketplace profile/);
    fireEvent.click(screen.getByRole("button", { name: "Activate Marketplace Profile" }));
    fireEvent.click(await screen.findByRole("button", { name: "This isn't my business" }));
    await screen.findByText("Published. Your profile is now on the Marketplace.");
    expect(sent("POST", /duplicate-answers$/)[0].body).toEqual({ profile_id: "p1", answer: "not_mine" });
    expect(sent("POST", /activate$/).length).toBe(1);
    expect(screen.queryByText(/We found an existing Marketplace profile/)).toBeNull();
    expect(Object.keys(localStorage).some((k) => /not-mine/.test(k))).toBe(false);      // nothing kept in the browser
  });

  it("R-2: a match the page didn't know about is still asked about when the server refuses", async () => {
    useWorkspaceStore.setState({ workspaceId: "ws9" });
    const mine = settings({ directory: null, activation: { ready: true, items: [] }, possible_duplicates: [] });
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: mine }) }, { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) },
      { method: "POST", match: /activate$/, reply: () => ({ status: 409, body: { detail: { code: "possible_duplicate", message: "x", profile: { ...unclaimed, matched_on: "registered number" } } } }) }];
    mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
    fireEvent.click(await screen.findByRole("button", { name: "Activate Marketplace Profile" }));
    await screen.findByText("Before you publish: is this your business?");
    expect(screen.getByText(/matched on its registered number/)).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
  });

  it("R-1 and item 6: the Marketplace opens on the Business Directory, keeps the tab in the address, and never publishes from a banner", async () => {
    routes = [{ method: "GET", match: /^\/marketplace\/businesses\?/, reply: () => ({ body: { enabled: true, total: 1, categories: [], items: [unclaimed] } }) }];
    function Tabs() { const l = useLocation(); return <><p data-testid="at">{l.search}</p><MarketplacePage /></>; }
    mount("/marketplace", <Tabs />, "/marketplace");
    expect(screen.getByRole("tab", { name: "Business Directory" }).getAttribute("aria-selected")).toBe("true");
    await screen.findByText("Northwind Advisory Ltd");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Business Directory", "Products & Services", "Proposal Requests"]);
    expect(screen.queryByRole("button", { name: /Publish Now/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search the Marketplace"), { target: { value: "north" } });
    await waitFor(() => expect(sent("GET", /q=north/).length).toBe(1));
    fireEvent.click(screen.getByRole("tab", { name: "Proposal Requests" }));
    expect(screen.getByTestId("at").textContent).toBe("?tab=requests");
    expect(screen.getByRole("tab", { name: "Proposal Requests" }).getAttribute("aria-selected")).toBe("true");
    expect(sent("POST", /\/marketplace\/publish$/).length).toBe(0);
  });

  it("item 1: one Marketplace header, with a menu on small screens", () => {
    mount("/", <MarketplaceHeader />, "/");
    expect(screen.getByRole("link", { name: "EnterprateAI Marketplace" }).getAttribute("href")).toBe("/marketplace");
    expect(within(screen.getByRole("navigation", { name: "Marketplace" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["List My Business", "Dashboard →"]);
    const menu = screen.getByRole("button", { name: "Menu" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(menu);
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "List My Business" }));
    expect(screen.getByTestId("where").textContent).toBe("/marketplace/profile");      // listing goes through the profile page and its checks
    cleanup();
    useAuthStore.setState({ token: null, email: null, hydrated: true });
    mount("/", <MarketplaceHeader />, "/");
    expect(within(screen.getByRole("navigation", { name: "Marketplace" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Sign in"]);
  });

  it("item 7: the claim journey shows numbered progress and keeps Cancel beside the main button", async () => {
    routes = [profileRoute(unclaimed), { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [claimOf({ target: "new", next_step: "verification", can: { cancel: true, verify: true }, profile: { ...unclaimed, has_website: true, domain: "northwind-advisory.co.uk" } })] } }) }];
    claimPage();
    await screen.findByText("Verify that you manage Northwind Advisory Ltd");
    expect(screen.getByText("Step 2 of 5 · Verify")).toBeTruthy();
    const steps = within(screen.getByRole("navigation", { name: "Claim progress" })).getAllByRole("listitem");
    expect(steps.map((li) => li.textContent)).toEqual(["✓Your business (done)", "2Verify", "3Profile", "4Opportunities", "5Finish"]);
    expect(steps[1].getAttribute("aria-current")).toBe("step");
    const cancel = screen.getByRole("button", { name: "Cancel this claim" });
    expect(cancel.closest("div").contains(screen.getByRole("button", { name: "Send me a code" }))).toBe(true);      // one footer row
    expect(screen.getAllByRole("button", { name: "Cancel this claim" }).length).toBe(1);
  });

  it("item 8: the profile page leads with status, a progress line and a slim bar for an unfinished claim", async () => {
    useWorkspaceStore.setState({ workspaceId: "ws9" });
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: settings({ activation: { ready: false, items: [
      { key: "claim", label: "Profile claimed and verified", done: true, optional: true }, { key: "description", label: "A public description", done: true },
      { key: "service_area", label: "A location or service area", done: true }, { key: "offering", label: "An offering", done: false }, { key: "opportunity", label: "An opportunity", done: false }] } }) }) },
      { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [claimOf({ next_step: "verification" })] } }) }];
    mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
    const line = await screen.findByRole("link", { name: "3 of 5 ready" });      // the same five rows the checklist shows
    expect(within(document.getElementById("marketplace-checklist")).getAllByRole("listitem").length).toBe(5);
    expect(line.getAttribute("href")).toBe("#marketplace-checklist");
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Activate Marketplace Profile" }).disabled).toBe(true);
    fireEvent.click(within((await screen.findByText(/isn't finished: Verify/)).closest("div")).getByRole("button", { name: "Continue" }));
    expect(screen.getByTestId("where").textContent).toBe(`/marketplace/claim/${base.slug}`);
  });

  it("round 4: counts match the checklist when the claim step doesn't apply, and a verified claim reads as setup left to do", async () => {
    useWorkspaceStore.setState({ workspaceId: "ws9" });
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: settings({ activation: { ready: true, items: [
      { key: "claim", label: "Profile claimed and verified", done: false, optional: true }, { key: "description", label: "A public description", done: true },
      { key: "service_area", label: "A location or service area", done: true }, { key: "offering", label: "An offering", done: true }, { key: "opportunity", label: "An opportunity", done: true }] } }) }) },
      { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [claimOf({ status: "verified", next_step: "profile_review", business_id: "ws9" })] } }) }];
    mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
    await screen.findByRole("link", { name: "4 of 4 ready" });
    const rows = within(document.getElementById("marketplace-checklist")).getAllByRole("listitem");
    expect(rows.length).toBe(4);                                          // the optional step isn't shown as a fifth, uncounted row
    expect(rows.some((li) => /claimed and verified/.test(li.textContent))).toBe(false);
    const bar = (await screen.findByText(/Finish setting up/)).closest("div");
    expect(bar.textContent).toContain("Finish setting up Northwind Advisory Ltd: review your profile.");
    expect(screen.queryByText(/isn't finished/)).toBeNull();
  });

  it("round 4: directory cards line up, with the badge on its own line and the initials beside the name", async () => {
    routes = [{ method: "GET", match: /^\/marketplace\/businesses\?/, reply: () => ({ body: { enabled: true, total: 2, categories: [], items: [claimed, { ...unclaimed, id: "p2", slug: "harbour", name: "Harbour Legal LLP" }] } }) }];
    mount("/", <DirectoryResults query="" />, "/");
    const cards = (await screen.findAllByRole("link", { name: /view profile$/ }));
    for (const card of cards) {
      expect(card.firstElementChild.textContent).toMatch(/^(✓Owner-verified|Business profile not yet claimed)$/);      // the top line is the badge alone
      expect(card.children[1].querySelector("h3")).toBeTruthy();
    }
    expect(cards[0].children[1].textContent.startsWith("NA")).toBe(true);
    expect(cards[1].children[1].textContent.startsWith("HL")).toBe(true);
    expect(within(screen.getByLabelText("Profile status")).getByText("Any status")).toBeTruthy();
  });

  it("Q-7: says what is happening while the profile saves and while it publishes", async () => {
    let release;
    const hold = () => new Promise((ok) => { release = () => ok({ body: settings() }); });
    routes = [{ method: "PATCH", match: /marketplace-profile$/, reply: hold }, { method: "PATCH", match: /preferences$/, reply: () => ({ body: settings() }) }, { method: "POST", match: /activate$/, reply: hold }];
    mount("/", <ProfileSettings profile={settings()} claimId="c1" onSaved={() => {}} />, "/");
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText("Saving your profile…");
    expect(screen.getByRole("button", { name: "Saving…" }).disabled).toBe(true);
    release();
    await screen.findByText("Saved.");
    cleanup();
    mount("/", <OpportunityPreferences profile={settings()} claimId="c1" onSaved={() => {}} saveLabel="Activate Marketplace Profile" activateOnSave />, "/");
    fireEvent.click(screen.getByRole("button", { name: "Activate Marketplace Profile" }));
    await screen.findByText("Publishing your profile…");
    expect(screen.getByRole("button", { name: "Publishing…" }).disabled).toBe(true);
    release();
    await screen.findByText("Saved.");
  });
});

describe("QA round 5", () => {
  beforeEach(() => { useAuthStore.setState({ token: "t", email: "a@b.test", hydrated: true }); useWorkspaceStore.setState({ workspaceId: "ws9" }); });

  it("D-3: the owner is told a review is open, and the buttons that would change the public page are held", async () => {
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: settings({ is_published: true, activation: { ready: true, items: [] },
      directory: { ...settings().directory, frozen: true, public: true, origin: "indexed", trust: { state: "disputed", label: "Ownership under review", meaning: "x" } } }) }) },
      { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) }];
    mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
    const bar = await screen.findByText("Someone has asked to review who manages this profile.");
    expect(bar.closest("div").textContent).toContain("Public edits are paused while we check.");
    expect(screen.getByRole("button", { name: "Unpublish" }).disabled).toBe(true);
    expect(screen.getByLabelText(/Public description/).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Save profile" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Preview public profile" }).disabled).toBe(false);      // looking is still fine
  });

  it("D-2: after control is removed the owner is told why their profile was unpublished", async () => {
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: settings({ directory: null, is_published: false,
      control_removed: { at: "2026-10-05T09:00:00Z", profile_name: "Northwind Advisory Ltd", category: "verified_in_error" } }) }) },
      { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) }];
    mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
    const note = (await screen.findByText(/Control of the Northwind Advisory Ltd profile was removed after a review,/)).closest("[role=alert]");
    expect(note.textContent).toContain("so your Marketplace profile was unpublished");
    expect(note.textContent).toContain("Your business and its records are unchanged.");
    expect(screen.getByText("Draft")).toBeTruthy();
  });

  it("D-5: a challenger sees the profile's real trust state and that the request will be reviewed", async () => {
    const held = { ...claimed, trust: VERIFIED, claimed: true };
    routes = [{ method: "GET", match: /marketplace\/businesses\/northwind-advisory-ltd-leeds$/, reply: () => ({ body: held }) },
      { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [claimOf({ challenge: true, held_by_another: true, status: "disputed", next_step: "pending_review", target: "new",
        notice: "This profile is managed by another business. Your request will be reviewed.", profile: { ...held, has_website: true, domain: "northwind-advisory.co.uk" },
        verification: { id: "v1", method: "manual", status: "submitted", submitted_at: "2026-10-05T09:00:00Z" } })] } }) }];
    mount(`/marketplace/claim/${base.slug}`, <ClaimFlowPage />, "/marketplace/claim/:slug");
    await screen.findByText("This profile is managed by another business. Your request will be reviewed.");
    expect(screen.getByText("Your claim is being reviewed against the current holder")).toBeTruthy();
    expect(screen.queryByText("Business profile not yet claimed")).toBeNull();
  });

  it("D-1: a revocation waits for a second reviewer, who confirms it or keeps the claim", async () => {
    const waiting = (over) => ({ id: "c7", profile: { name: "Northwind Advisory Ltd", slug: base.slug }, claimant_email: "owner@northwind.test", category: "verified_in_error",
      category_label: "The claim was verified in error", reason: "Verified against a lapsed domain.", requested_at: "2026-10-05T09:00:00Z", requested_by_you: false, needs_another_reviewer: false, ...over });
    let rows = [waiting({ requested_by_you: true, needs_another_reviewer: true })];
    routes = [{ method: "GET", match: /admin\/marketplace\/claims/, reply: () => ({ body: { claims: [], reports: [], revocations: rows } }) },
      { method: "GET", match: /admin\/marketplace\/funnel$/, reply: () => ({ body: { events: {}, reports_open: 0, profiles: { total: 1, published: 1, claimed: 1, suppressed: 0 } } }) },
      { method: "POST", match: /business-claims\/c7\/review-decision$/, reply: () => { rows = []; return { body: { id: "c7", status: "revoked", revocation: "done" } }; } }];
    mount("/", <AdminClaims />, "/");
    await screen.findByRole("heading", { name: "Revocations waiting for a second reviewer" });
    expect(screen.getByText("You asked for this, so someone else has to confirm it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm revocation" })).toBeNull();
    cleanup();
    rows = [waiting()];
    mount("/", <AdminClaims />, "/");
    const confirm = await screen.findByRole("button", { name: "Confirm revocation" });
    expect(screen.getByText("The claim was verified in error")).toBeTruthy();
    expect(confirm.disabled).toBe(true);                                  // a decision needs a reason
    fireEvent.change(screen.getByLabelText("Reason for your decision on Northwind Advisory Ltd"), { target: { value: "Confirmed with the registrar." } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Revocations waiting for a second reviewer" })).toBeNull());
    expect(sent("POST", /review-decision$/)[0].body).toEqual({ decision: "revoke", reason: "Confirmed with the registrar." });
  });
});

describe("unclaimed profile visibility", () => {
  const listing = (over) => ({ method: "GET", match: /^\/marketplace\/businesses\?/, reply: () => ({ body: { enabled: true, total: 1, categories: [], items: [claimed], ...over } }) });

  it("offers the 'Not yet claimed' filter only when unclaimed profiles are listed", async () => {
    routes = [listing({ unclaimed_listed: false })];
    mount("/", <DirectoryResults query="" />, "/");
    await screen.findByText("Northwind Advisory Ltd");
    const options = () => within(screen.getByLabelText("Profile status")).getAllByRole("option").map((o) => o.textContent);
    expect(options()).toEqual(["Any status", "Verified only", "Created on EnterprateAI, not verified"]);
    cleanup();
    routes = [listing({ unclaimed_listed: true })];
    mount("/", <DirectoryResults query="" />, "/");
    await screen.findByText("Northwind Advisory Ltd");
    expect(options()).toEqual(["Any status", "Verified only", "Created on EnterprateAI, not verified", "Not yet claimed"]);
  });

  it("an invitation or lookup grant travels with every request for the profile, and on into the claim", async () => {
    routes = [{ method: "GET", match: /marketplace\/businesses\/northwind-advisory-ltd-leeds$/, reply: ({ path }) => (/access=grant-1/.test(path) ? { body: unclaimed } : { status: 404, body: { detail: "Not found." } }) },
      { method: "POST", match: /\/view$/, reply: () => ({ status: 202, body: {} }) }, { method: "POST", match: /\/reports$/, reply: () => ({ status: 201, body: { message: "Thank you." } }) }];
    mount(`/marketplace/business/${base.slug}?access=grant-1`, <DirectoryProfilePage />, "/marketplace/business/:slug");
    await screen.findByRole("heading", { name: "Northwind Advisory Ltd" });
    expect(sent("POST", /\/view$/)[0].path).toContain("access=grant-1");
    fireEvent.click(screen.getByRole("button", { name: /Report incorrect information/ }));
    fireEvent.change(screen.getByLabelText("Details"), { target: { value: "The website is out of date." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Thank you.");
    expect(sent("POST", /\/reports$/)[0].path).toContain("access=grant-1");
    fireEvent.click(screen.getByRole("button", { name: "Claim this Business for Free" }));
    expect(screen.getByTestId("where").textContent).toBe(`/marketplace/claim/${base.slug}?access=grant-1`);
    cleanup();
    // Without it, the profile is simply not there.
    sessionStorage.clear();
    mount(`/marketplace/business/${base.slug}`, <DirectoryProfilePage />, "/marketplace/business/:slug");
    await screen.findByText("This business profile isn't available.");
  });

  it("the claim page uses the grant to open the profile and to start the claim", async () => {
    useAuthStore.setState({ token: "t", email: "a@b.test", hydrated: true });
    routes = [{ method: "GET", match: /marketplace\/businesses\/northwind-advisory-ltd-leeds$/, reply: ({ path }) => (/access=grant-1/.test(path) ? { body: unclaimed } : { status: 404, body: { detail: "Not found." } }) },
      { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) },
      { method: "POST", match: /directory-profiles\/.+\/claims$/, reply: () => ({ status: 201, body: claimOf() }) }];
    mount(`/marketplace/claim/${base.slug}?access=grant-1`, <ClaimFlowPage />, "/marketplace/claim/:slug");
    fireEvent.click(await screen.findByRole("button", { name: "Continue to Claim" }));
    await screen.findByText("Which EnterprateAI business should this profile belong to?");
    expect(sent("POST", /\/claims$/)[0].body).toMatchObject({ access: "grant-1" });
  });

  it("find and claim: an exact match goes to the claim, a miss offers to create a profile", async () => {
    routes = [{ method: "POST", match: /marketplace\/claim-lookup$/, reply: ({ body }) => (body.company_number === "12345678"
      ? { body: { found: true, slug: base.slug, name: "Northwind Advisory Ltd", claimed: false, access: "grant-9" } } : { body: { found: false } }) }];
    mount("/", <FindToClaim />, "/");
    fireEvent.click(screen.getByRole("button", { name: "Find and claim your business" }));
    const go = screen.getByRole("button", { name: "Find my business" });
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Northwind Advisory Ltd" } });
    expect(go.disabled).toBe(true);                                       // a name alone isn't enough
    fireEvent.change(screen.getByLabelText("Company number"), { target: { value: "00000000" } });
    fireEvent.click(go);
    await screen.findByText(/We couldn't find it\./);
    expect(sent("POST", /claim-lookup$/)[0].body).toEqual({ name: "Northwind Advisory Ltd", company_number: "00000000", website: null });
    fireEvent.click(screen.getByRole("button", { name: "Create your Marketplace profile" }));
    expect(screen.getByTestId("where").textContent).toBe(`/login?signup=1&next=${encodeURIComponent("/marketplace/profile")}`);
    cleanup();
    mount("/", <FindToClaim />, "/");
    fireEvent.click(screen.getByRole("button", { name: "Find and claim your business" }));
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Northwind Advisory Ltd" } });
    fireEvent.change(screen.getByLabelText("Company number"), { target: { value: "12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Find my business" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`/marketplace/claim/${base.slug}?access=grant-9`));
  });

  it("find and claim says so when there have been too many tries", async () => {
    routes = [{ method: "POST", match: /claim-lookup$/, reply: () => ({ status: 429, body: { detail: { code: "rate_limited", message: "That's been tried too many times. Please wait a while and try again." } } }) }];
    mount("/", <FindToClaim />, "/");
    fireEvent.click(screen.getByRole("button", { name: "Find and claim your business" }));
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Guess Ltd" } });
    fireEvent.change(screen.getByLabelText("or website"), { target: { value: "guess.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Find my business" }));
    expect((await screen.findByText(/tried too many times/)).getAttribute("role")).toBe("alert");
  });

  it("moderators choose the level, see who set it, and keep the full list of unclaimed profiles", async () => {
    const levels = [{ key: "admin_only", label: "Moderators only", explanation: "Hidden; moderators and invitation links only." },
      { key: "invite_only", label: "Invitation or exact match", explanation: "Hidden; opens by invitation or an exact match." }, { key: "public", label: "Public", explanation: "Listed for anyone." }];
    let current = { unclaimed_visibility: "invite_only", source: "default", changed_by: null, changed_at: null, levels };
    routes = [{ method: "GET", match: /admin\/marketplace\/claims/, reply: () => ({ body: { claims: [], reports: [], revocations: [] } }) },
      { method: "GET", match: /admin\/marketplace\/funnel$/, reply: () => ({ body: { events: {}, reports_open: 0, profiles: { total: 1, published: 1, claimed: 0, suppressed: 0 } } }) },
      { method: "GET", match: /admin\/marketplace\/settings$/, reply: () => ({ body: current }) },
      { method: "PUT", match: /admin\/marketplace\/settings$/, reply: ({ body }) => { current = { ...current, unclaimed_visibility: body.unclaimed_visibility, source: "moderator", changed_by: "tech.support@enterprateai.com", changed_at: "2026-10-05T09:00:00Z" }; return { body: current }; } },
      { method: "GET", match: /directory\/unclaimed$/, reply: () => ({ body: { total: 1, items: [{ id: "p1", slug: base.slug, name: "Northwind Advisory Ltd", category: "Consulting", location: "Leeds", publication: "published", has_contact: true,
        public_state: "Ready · hidden (invite only)", state_tone: "amber" }] } }) }];
    mount("/", <AdminClaims section="visibility" />, "/");
    await screen.findByText("Who can see unclaimed profiles");
    expect(screen.getByLabelText(/Invitation or exact match/).checked).toBe(true);
    expect(screen.getByText("This is the default. Nobody has changed it.")).toBeTruthy();
    expect(screen.getByText("Hidden; moderators and invitation links only.")).toBeTruthy();      // each level is explained
    fireEvent.click(screen.getByLabelText(/Moderators only/));
    await screen.findByText(/Set by tech\.support@enterprateai\.com on 5 Oct 2026\. Saved\./);
    expect(sent("PUT", /settings$/)[0].body).toEqual({ unclaimed_visibility: "admin_only" });
    expect(screen.getByLabelText(/Moderators only/).checked).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Unclaimed profiles" }));
    expect(await screen.findByText("Ready · hidden (invite only)")).toBeTruthy();      // what the public can see, given the level
  });
});

describe("admin area", () => {
  const funnel = { method: "GET", match: /admin\/marketplace\/funnel$/, reply: () => ({ body: { events: { BusinessClaimStarted: 3 }, reports_open: 0, profiles: { total: 4, published: 3, claimed: 1, suppressed: 1 } } }) };
  const queue = { method: "GET", match: /admin\/marketplace\/claims/, reply: () => ({ body: { claims: [], reports: [], revocations: [] } }) };
  const row = (over) => ({ id: "p1", slug: base.slug, name: "Northwind Advisory Ltd", category: "Consulting", location: "Leeds", publication: "published", has_contact: true, public_state: "Ready · hidden (invite only)", state_tone: "amber", ...over });

  it("A-3 and A-4: unclaimed rows show their effective state and act through a row menu", async () => {
    let rows = [row(), row({ id: "p2", slug: "harbour", name: "Harbour Legal LLP", publication: "suppressed", public_state: "Suppressed", state_tone: "rose" }),
      row({ id: "p3", slug: "thin", name: "Thin Record Ltd", publication: "unpublished", public_state: "Unpublished (quality)", state_tone: "slate" })];
    routes = [funnel, queue, { method: "GET", match: /directory\/unclaimed$/, reply: () => ({ body: { total: rows.length, items: rows, unclaimed_visibility: "invite_only" } }) },
      { method: "POST", match: /directory-profiles\/northwind-advisory-ltd-leeds\/invitations$/, reply: () => ({ status: 201, body: { id: "i1", status: "created", link: `/marketplace/claim/${base.slug}?invite=tok-7` } }) },
      { method: "GET", match: /directory-profiles\/northwind-advisory-ltd-leeds\/sources$/, reply: () => ({ body: { name: "Northwind Advisory Ltd", quality: 10, fit_band: "high", reasons: [],
        fields: [{ field: "company_number", provider: "Companies House", record_id: "12345678", retrieved_at: "2026-09-28T10:00:00Z" }], imports: [] } }) },
      { method: "POST", match: /directory-profiles\/.+\/moderation$/, reply: ({ body, path }) => {
        const slug = path.split("/").at(-2);
        rows = rows.map((r) => (r.slug === slug ? { ...r, publication: body.action === "suppress" ? "suppressed" : "published", public_state: body.action === "suppress" ? "Suppressed" : "Ready · hidden (invite only)" } : r));
        return { body: { slug, public_state: body.action === "suppress" ? "Suppressed" : "Ready · hidden (invite only)" } };
      } }];
    const copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { copied.push(t); } } });
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    mount("/", <AdminClaims section="unclaimed" />, "/");
    await screen.findByText("Ready · hidden (invite only)");
    const table = screen.getByRole("table", { name: "Unclaimed profiles" });
    expect(within(table).getByText("Suppressed")).toBeTruthy();
    expect(within(table).getByText("Unpublished (quality)")).toBeTruthy();
    const menu = (name) => { fireEvent.click(screen.getByRole("button", { name: `Actions for ${name}` })); return screen.getByRole("menu"); };
    expect(within(menu("Northwind Advisory Ltd")).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Copy invitation link", "Open profile (moderator view)", "Change visibility", "Edit", "Archive", "Suppress", "View sources"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy invitation link" }));
    await screen.findByText("Invitation link for Northwind Advisory Ltd copied.");
    expect(copied[0]).toMatch(/\/marketplace\/claim\/northwind-advisory-ltd-leeds\?invite=tok-7$/);
    expect(sent("POST", /invitations$/)[0].body).toMatchObject({ by_hand: true });      // a link to pass on personally: nothing is emailed
    fireEvent.click(within(menu("Northwind Advisory Ltd")).getByRole("menuitem", { name: "Open profile (moderator view)" }));
    expect(opened).toHaveBeenCalledWith(`/marketplace/business/${base.slug}`, "_blank", "noopener");
    fireEvent.click(within(menu("Northwind Advisory Ltd")).getByRole("menuitem", { name: "View sources" }));
    const sources = await screen.findByRole("region", { name: "Sources for Northwind Advisory Ltd" });
    expect(within(sources).getByText("company number")).toBeTruthy();
    expect(within(sources).getByText("Companies House")).toBeTruthy();
    // Suppressing asks for a reason first.
    fireEvent.click(within(menu("Northwind Advisory Ltd")).getByRole("menuitem", { name: "Suppress" }));
    const form = screen.getByRole("form", { name: "Suppress Northwind Advisory Ltd" });
    expect(within(form).getByRole("button", { name: "Suppress profile" }).disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText(/Reason/), { target: { value: "Duplicate of another record." } });
    fireEvent.click(within(form).getByRole("button", { name: "Suppress profile" }));
    await screen.findByText("Northwind Advisory Ltd: Suppressed.");
    expect(sent("POST", /moderation$/)[0].body).toEqual({ action: "suppress", reason: "Duplicate of another record." });
    // A suppressed row offers Restore, and can't be opened or invited.
    const items = within(menu("Harbour Legal LLP")).getAllByRole("menuitem");
    expect(items.map((m) => m.textContent)).toEqual(["Copy invitation link", "Open profile (moderator view)", "Change visibility", "Edit", "Restore", "View sources"]);
    expect(items[0].disabled && items[1].disabled).toBe(true);
  });

  it("design 6: the Marketplace section has its own tabs, driven by the sidebar or by itself", async () => {
    routes = [funnel, queue];
    const onSection = vi.fn();
    mount("/", <AdminClaims section="queue" onSection={onSection} />, "/");
    await screen.findByText("Nothing is waiting.");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Queue", "Unclaimed profiles", "Reports", "Visibility", "Index & invites"]);
    expect(screen.getByRole("tab", { name: "Queue" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Index & invites" }));
    expect(onSection).toHaveBeenCalledWith("index");
    const tiles = screen.getByRole("region", { name: "Directory at a glance" });
    expect(within(tiles).getByText("Claims started").parentElement.textContent).toBe("Claims started3");
    expect(tiles.children.length).toBe(6);                                // its own six tiles, and no others
  });

  it("A-5: a moderator who isn't an administrator sees only the Marketplace section", async () => {
    useAuthStore.setState({ token: "t", email: "moderator@example.test", hydrated: true });
    routes = [funnel, queue, { method: "GET", match: /admin\/marketplace\/access$/, reply: () => ({ body: { moderator: true } }) }];
    mount("/ent-admin?section=marketplace", <AdminPage />, "/ent-admin");
    await screen.findByRole("heading", { level: 1, name: "Marketplace Claims" });
    const nav = screen.getAllByRole("navigation", { name: "Admin sections" })[0];
    expect(within(nav).getAllByRole("button").map((b) => b.textContent.replace(/Decisions.*|Indexed,.*|Who sees.*|Add records.*/, ""))).toEqual(["Claims & reports", "Unclaimed profiles", "Visibility", "Index & invites"]);
    expect(screen.queryByText("Platform health")).toBeNull();
    expect(screen.getByText("ADMIN", { exact: false, selector: "p" })).toBeTruthy();
    expect(sent("GET", /\/admin\/stats$/).length).toBe(0);                // never asks for what it may not see
    fireEvent.click(within(nav).getByRole("button", { name: /Index & invites/ }));
    expect(screen.getByRole("tab", { name: "Index & invites" }).getAttribute("aria-selected")).toBe("true");
    expect(within(nav).getByRole("button", { name: /Index & invites/ }).getAttribute("aria-current")).toBe("page");
    cleanup();
    routes = [{ method: "GET", match: /admin\/marketplace\/access$/, reply: () => ({ body: { moderator: false } }) }];
    mount("/ent-admin", <AdminPage />, "/ent-admin");
    await screen.findByText("Access restricted");
  });

  it("design 5 and A-1: one table with an empty state and pages, and tiles with sentence-case labels and a trend line", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: i, name: `Row ${i + 1}` }));
    const { container } = mount("/", <><AdminTable columns={[{ key: "name", label: "Name" }]} rows={rows} pageSize={25} rowActions={(r) => [{ label: "Open", onClick: () => {} }]} />
      <AdminTable columns={[{ key: "name", label: "Name" }]} rows={[]} emptyText="No workspaces yet." />
      <KpiTile label="Total users" value={42} series={[0, 1, 3, 2, 5, 4, 6, 8]} /><KpiTile label="Simulations" value={7} series={null} /></>, "/");
    expect(screen.getByText("1–25 of 30")).toBeTruthy();
    expect(screen.getAllByRole("row").length).toBe(26);                   // the header and one page
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("26–30 of 30")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Actions for Row 26" })).toBeTruthy();
    expect(screen.getByText("No workspaces yet.")).toBeTruthy();
    const label = screen.getByText("Total users");
    expect(label.className).not.toMatch(/uppercase|truncate/);            // sentence case, never cut off
    expect(label.parentElement.firstElementChild).toBe(label);            // the label sits above the number
    expect(container.querySelectorAll("svg polyline").length).toBe(1);    // a trend line only where there is a history
    const now = Date.now();
    expect(weeklySeries([{ created_at: new Date(now - 86400000).toISOString() }, { created_at: new Date(now - 9 * 86400000).toISOString() }, { created_at: "not a date" }], 4)).toEqual([0, 0, 1, 1]);
  });
});

describe("businesses that sign up directly (G-1 to G-4)", () => {
  const match = { ...unclaimed, matched_on: "registered number" };
  const CREATED = { state: "created", label: "Created on EnterprateAI · not verified", meaning: "Nobody has checked who is behind it yet." };
  const made = (over = {}) => settings({ is_published: true, activation: { ready: true, items: [] }, possible_duplicates: [], review_state: null, listing_suppressed: null,
    directory: { id: "p9", slug: "apex-consulting", trust: CREATED, origin: "created", public: true, legal_identifier: null, sourced: { name: "Apex Consulting" }, sourced_tags: [], frozen: false }, ...over });
  beforeEach(() => { useAuthStore.setState({ token: "t", email: "a@b.test", hydrated: true }); useWorkspaceStore.setState({ workspaceId: "ws9" }); });

  async function onboardTo(choice) {
    calls.length = 0;      // each run counts its own requests
    routes = [{ method: "GET", match: /claimable-businesses/, reply: ({ path }) => ({ body: { items: /company_number=12345678/.test(path) ? [match] : [] } }) },
      { method: "POST", match: /workspace\/profile\/onboarding$/, reply: () => ({ body: { workspace_id: "ws-new", workspace_name: "Northwind", company_name: "Northwind Advisory" } }) },
      { method: "POST", match: /businesses\/ws-new\/marketplace-profile\/duplicate-answers$/, reply: () => ({ body: {} }) }];
    mount("/onboarding", <OnboardingPage />, "/onboarding");
    fireEvent.change(screen.getByPlaceholderText("e.g. Apex Consulting Ltd"), { target: { value: "Northwind Advisory" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Helps customers find you and stops your business appearing twice.")).toBeTruthy();
    expect(screen.queryByText(/may be your business/)).toBeNull();        // nothing to say until there is a number or a website
    const number = screen.getByText("Company number").closest("label")?.querySelector("input") || screen.getByText("Company number").parentElement.parentElement.querySelector("input");
    fireEvent.change(number, { target: { value: "12345678" } });
    await waitFor(() => expect(screen.getByText(/We found a Marketplace profile that may be your business:/).textContent).toContain("Northwind Advisory Ltd, Leeds"), { timeout: 3000 });
    expect(sent("GET", /claimable-businesses/).at(-1).path).toContain("name=Northwind+Advisory");
    if (choice) fireEvent.click(screen.getByLabelText(choice));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(sent("POST", /onboarding$/).length).toBe(1));
    expect(sent("POST", /onboarding$/)[0].body.answers).toMatchObject({ company_name: "Northwind Advisory", registration_number: "12345678" });
  }

  it("G-1: 'Claim and link it' creates the business, then goes on to the claim with that business chosen", async () => {
    await onboardTo("Claim and link it (recommended)");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`/marketplace/claim/${base.slug}?source=signup_match&business=ws-new`));
    expect(sent("POST", /duplicate-answers$/).length).toBe(0);
  });

  it("G-1: 'This isn't my business' is kept on the server for the new business, and sign-up carries on", async () => {
    await onboardTo("This isn't my business");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/dashboard"));
    expect(sent("POST", /duplicate-answers$/)[0].body).toEqual({ profile_id: "p1", answer: "not_mine" });
  });

  it("G-1: 'Decide later', or no answer at all, never holds up sign-up", async () => {
    await onboardTo("Decide later");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/dashboard"));
    expect(sent("POST", /duplicate-answers$/).length).toBe(0);
    cleanup();
    await onboardTo(null);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/dashboard"));
  });

  it("G-1: the same question is asked in workspace settings when the number or website changes", async () => {
    let dup = [match];
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: settings({ possible_duplicates: dup }) }) },
      { method: "POST", match: /duplicate-answers$/, reply: () => { dup = []; return { body: settings({ possible_duplicates: [] }) }; } }];
    const { rerender } = mount("/", <SavedBusinessMatch businessId="ws9" companyNumber="" website="" />, "/");
    expect(screen.queryByText(/may be your business/)).toBeNull();
    expect(sent("GET", /marketplace-profile$/).length).toBe(0);           // nothing to check without a number or website
    rerender(<MemoryRouter><Routes><Route path="*" element={<SavedBusinessMatch businessId="ws9" companyNumber="12345678" website="" />} /></Routes></MemoryRouter>);
    await screen.findByText(/We found a Marketplace profile that may be your business:/);
    fireEvent.click(screen.getByLabelText("This isn't my business"));
    await waitFor(() => expect(screen.queryByText(/may be your business/)).toBeNull());
    expect(sent("POST", /duplicate-answers$/)[0].body).toEqual({ profile_id: "p1", answer: "not_mine" });
  });

  it("G-1: arriving from sign-up, the claim links the new business without asking which one", async () => {
    routes = [{ method: "GET", match: /marketplace\/businesses\/northwind-advisory-ltd-leeds$/, reply: () => ({ body: unclaimed }) }, { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) },
      { method: "POST", match: /directory-profiles\/.+\/claims$/, reply: () => ({ status: 201, body: claimOf({ candidates: [{ business_id: "ws-new", name: "Northwind Advisory", location: "", likely_match: true, already_linked: false }] }) }) },
      { method: "POST", match: /business-claims\/c1\/match$/, reply: ({ body }) => ({ body: claimOf({ target: body.business_id, next_step: "verification", can: { cancel: true, verify: true } }) }) }];
    mount(`/marketplace/claim/${base.slug}?source=signup_match&business=ws-new`, <ClaimFlowPage />, "/marketplace/claim/:slug");
    fireEvent.click(await screen.findByRole("button", { name: "Continue to Claim" }));
    await screen.findByText("Verify that you manage Northwind Advisory Ltd");
    expect(sent("POST", /\/match$/)[0].body).toEqual({ business_id: "ws-new" });
    expect(screen.queryByText("Which EnterprateAI business should this profile belong to?")).toBeNull();
  });

  it("G-2: a name another profile already uses can't be published until the owner claims it or verifies", async () => {
    const clash = { id: "p1", slug: base.slug, name: "Northwind Advisory Ltd", location: "Leeds", claimed: false };
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: made({ is_published: false, directory: null }) }) }, { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) },
      { method: "POST", match: /activate$/, reply: () => ({ status: 409, body: { detail: { code: "verification_required", message: "x", profile: clash } } }) },
      { method: "POST", match: /marketplace-profile\/verification$/, reply: () => ({ status: 201, body: claimOf({ self_verify: true, profile: { ...unclaimed, slug: "apex-consulting" } }) }) }];
    mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
    fireEvent.click(await screen.findByRole("button", { name: "Activate Marketplace Profile" }));
    await screen.findByText("Another Marketplace profile already uses this name.");
    expect(screen.getByText(/can't be published under the same name until it is verified/)).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByRole("button", { name: "That's my business: claim it" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Verify my business" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/marketplace/claim/apex-consulting"));
    expect(sent("POST", /marketplace-profile\/verification$/).length).toBe(1);
  });

  it("G-3: a self-made profile says it isn't verified and offers to verify; a verified one doesn't", async () => {
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: made() }) }, { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) }];
    mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
    await screen.findByText("Not verified");
    expect(screen.getByText("Verify your business to earn the Owner-verified badge")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verify your business" })).toBeTruthy();
    cleanup();
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: made({ directory: { ...made().directory, trust: VERIFIED } }) }) }, { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) }];
    mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
    await screen.findByText("Owner-verified");
    expect(screen.queryByText(/Verify your business/)).toBeNull();
  });

  it("G-3: the verification steps say 'verifying', and the public badge explains itself", async () => {
    routes = [{ method: "GET", match: /marketplace\/businesses\/apex-consulting$/, reply: () => ({ body: { ...claimed, slug: "apex-consulting", canonical_slug: "apex-consulting", name: "Apex Consulting", trust: CREATED, owner_controls: true, business_id: "ws9" } }) },
      { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [claimOf({ self_verify: true, target: "ws9", next_step: "verification", can: { cancel: true, verify: true }, profile: { ...unclaimed, id: "p1", name: "Apex Consulting", has_website: true, domain: "apex.test" } })] } }) },
      { method: "POST", match: /\/view$/, reply: () => ({ status: 202, body: {} }) }];
    mount("/marketplace/claim/apex-consulting", <ClaimFlowPage />, "/marketplace/claim/:slug");
    await screen.findByText("You are verifying: Apex Consulting");
    expect(screen.queryByText(/You are claiming/)).toBeNull();
    cleanup();
    mount("/marketplace/business/apex-consulting", <DirectoryProfilePage />, "/marketplace/business/:slug");
    fireEvent.click(await screen.findByRole("button", { name: /Created on EnterprateAI · not verified · what this means/ }));
    expect(screen.getByRole("note").textContent).toContain("Nobody has checked who is behind it yet.");
  });

  it("G-4: the owner sees a wait for review, and a clear notice with the reason when a listing is taken down", async () => {
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: made({ is_published: false, review_state: "pending_review", directory: { ...made().directory, public: false } }) }) },
      { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) }];
    mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
    await screen.findByText("Waiting for review");
    expect(screen.getByText(/waiting for a quick review before it goes public/)).toBeTruthy();
    cleanup();
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: made({ is_published: false, listing_suppressed: { at: "2026-10-05T09:00:00Z", reason: "The description advertises a regulated service without a licence number." } }) }) },
      { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) }];
    mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
    const note = (await screen.findByText("Your Marketplace profile was taken down after a review.")).closest("[role=alert]");
    expect(note.textContent).toContain("Reason: The description advertises a regulated service without a licence number.");
    expect(note.textContent).toContain("It will be checked before it goes back on the Marketplace.");
  });

  it("G-4: the New listings queue approves, or suppresses with a reason, and marks what is overdue", async () => {
    const row = (over) => ({ id: "p9", slug: "apex-consulting", name: "Apex Consulting", category: "Consulting", location: "Leeds", description: "We help small firms set prices.", mode: "post_publish", live: true,
      requested_at: "2026-10-04T09:00:00Z", due_at: "2026-10-05T09:00:00Z", overdue: false, needs_another_reviewer: false, ...over });
    let rows = [row({ overdue: true }), row({ id: "p8", slug: "mine", name: "My Own Co", needs_another_reviewer: true }), row({ id: "p7", slug: "held", name: "Held Co", live: false, mode: "pre_publish" })];
    routes = [{ method: "GET", match: /admin\/marketplace\/claims/, reply: () => ({ body: { claims: [], reports: [], revocations: [], new_listings: rows, self_created_review: "post_publish" } }) },
      { method: "GET", match: /admin\/marketplace\/funnel$/, reply: () => ({ body: { events: {}, reports_open: 0, profiles: { total: 3, published: 2, claimed: 0, suppressed: 0 } } }) },
      { method: "POST", match: /listings\/.+\/review$/, reply: ({ path }) => { rows = rows.filter((r) => !path.includes(r.slug)); return { body: {} }; } }];
    mount("/", <AdminClaims />, "/");
    const table = await screen.findByRole("table", { name: "New listings" });
    expect(screen.getByRole("tab", { name: /^Queue/ }).textContent).toBe("Queue3");
    const first = within(table).getByText("Apex Consulting").closest("tr");
    expect(within(first).getByText("Over 24 hours")).toBeTruthy();
    expect(within(first).getByText("Live")).toBeTruthy();
    expect(within(within(table).getByText("Held Co").closest("tr")).getByText("Waiting, not public")).toBeTruthy();
    const own = within(table).getByText("My Own Co").closest("tr");
    expect(within(own).getByText("Needs another reviewer")).toBeTruthy();
    expect(within(own).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(within(first).getByRole("button", { name: "Suppress" }).disabled).toBe(true);      // a reason comes first
    fireEvent.change(within(first).getByLabelText("Reason for Apex Consulting"), { target: { value: "Advertises a regulated service." } });
    fireEvent.click(within(first).getByRole("button", { name: "Suppress" }));
    await waitFor(() => expect(within(screen.getByRole("table", { name: "New listings" })).queryByText("Apex Consulting")).toBeNull());
    expect(sent("POST", /listings\/apex-consulting\/review$/)[0].body).toEqual({ decision: "suppress", reason: "Advertises a regulated service." });
    fireEvent.click(within(screen.getByText("Held Co").closest("tr")).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(sent("POST", /listings\/held\/review$/).length).toBe(1));
    expect(sent("POST", /listings\/held\/review$/)[0].body).toEqual({ decision: "approve", reason: "" });
  });
});

describe("marketplace admin: per-business visibility and adding businesses", () => {
  const funnel = { method: "GET", match: /admin\/marketplace\/funnel$/, reply: () => ({ body: { events: {}, reports_open: 0, profiles: { total: 2, published: 2, claimed: 0, suppressed: 0 } } }) };
  const queue = { method: "GET", match: /admin\/marketplace\/claims/, reply: () => ({ body: { claims: [], reports: [], revocations: [], new_listings: [] } }) };
  const options = { categories: ["Consulting", "Accounting", "Legal"], providers: ["Companies House", "Company website", "Manual research", "Other"], visibility: ["inherit", "hidden", "invite_only", "public"] };
  const row = (over) => ({ id: "p1", slug: base.slug, name: "Northwind Advisory Ltd", category: "Consulting", location: "Leeds", publication: "published", has_contact: true, public_state: "Ready · hidden (invite only)",
    state_tone: "amber", visibility: "inherit", visibility_label: "Invite only (default)", website: "northwind-advisory.co.uk", service_tags: ["Pricing"], business_status: "active", ...over });
  const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  beforeEach(() => { useAuthStore.setState({ token: "t", email: "tech.support@enterprateai.com", hydrated: true }); });

  it("shows each row's visibility, changes one from its menu, and many at once", async () => {
    let rows = [row(), row({ id: "p2", slug: "harbour", name: "Harbour Legal LLP", visibility: "public", visibility_label: "Public (override)", public_state: "Ready · public", state_tone: "emerald" })];
    routes = [funnel, queue, { method: "GET", match: /directory\/unclaimed$/, reply: () => ({ body: { items: rows, total: 2, unclaimed_visibility: "invite_only", invites_enabled: true, options } }) },
      { method: "POST", match: /directory\/visibility$/, reply: ({ body }) => ({ body: { changed: body.profiles, count: body.profiles.length, skipped: [] } }) },
      { method: "POST", match: /invitations$/, reply: () => ({ status: 201, body: { status: "sent", link: "/x" } }) }];
    mount("/", <AdminClaims section="unclaimed" />, "/");
    const table = await screen.findByRole("table", { name: "Unclaimed profiles" });
    expect(within(table).getByText("Invite only (default)")).toBeTruthy();
    expect(within(table).getByText("Public (override)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Northwind Advisory Ltd" }));
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(
      ["Copy invitation link", "Send invitation", "Open profile (moderator view)", "Change visibility", "Edit", "Archive", "Suppress", "View sources"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Change visibility" }));
    let form = screen.getByRole("form", { name: "Set visibility" });
    expect(within(form).getByText("Set visibility for Northwind Advisory Ltd")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Visibility"), { target: { value: "public" } });
    fireEvent.change(within(form).getByLabelText(/Reason/), { target: { value: "Pilot partner." } });
    fireEvent.click(within(form).getByRole("button", { name: "Apply" }));
    await screen.findByText(/Visibility set to "Public \(listed and searchable\)" for 1 profile\./);
    expect(sent("POST", /directory\/visibility$/)[0].body).toEqual({ profiles: [base.slug], visibility: "public", reason: "Pilot partner." });
    // Many at once.
    fireEvent.click(screen.getByLabelText("Select all on this page"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Set visibility" }));
    form = screen.getByRole("form", { name: "Set visibility" });
    expect(within(form).getByText("Set visibility for 2 profiles")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Visibility"), { target: { value: "hidden" } });
    fireEvent.click(within(form).getByRole("button", { name: "Apply" }));
    await screen.findByText(/for 2 profiles\./);
    expect(sent("POST", /directory\/visibility$/)[1].body).toEqual({ profiles: [base.slug, "harbour"], visibility: "hidden", reason: "" });
    expect(screen.queryByText("2 selected")).toBeNull();
    // "Send invitation" appears because emails are switched on, and emails the contact on record.
    fireEvent.click(screen.getByRole("button", { name: "Actions for Northwind Advisory Ltd" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Send invitation" }));
    await screen.findByText("Invitation sent to the contact on record for Northwind Advisory Ltd.");
    expect(sent("POST", /invitations$/)[0].body).toMatchObject({ send: true });
  });

  it("edits a row keeping its history, and archives with a reason", async () => {
    routes = [funnel, queue, { method: "GET", match: /directory\/unclaimed$/, reply: () => ({ body: { items: [row()], total: 1, unclaimed_visibility: "invite_only", invites_enabled: false, options } }) },
      { method: "PATCH", match: /directory-profiles\/northwind-advisory-ltd-leeds$/, reply: ({ body }) => (body.changes.location?.includes("Avenue")
        ? { status: 422, body: { detail: { code: "invalid", message: "x", errors: { location: "Enter the town or region only, not a street address or full postcode (for example: Leeds)." } } } }
        : { body: { slug: base.slug, public_state: "Ready · hidden (invite only)" } }) },
      { method: "POST", match: /moderation$/, reply: () => ({ body: { public_state: "Archived" } }) }];
    mount("/", <AdminClaims section="unclaimed" />, "/");
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Northwind Advisory Ltd" }));
    expect(screen.queryByRole("menuitem", { name: "Send invitation" })).toBeNull();      // emails are off
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    const form = screen.getByRole("form", { name: "Edit Northwind Advisory Ltd" });
    expect(within(form).getByText(/kept in the profile's history/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/Town or region/), { target: { value: "14 Acacia Avenue, Leeds" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    expect((await within(form).findByText(/Enter the town or region only/)).getAttribute("role")).toBe("alert");
    fireEvent.change(within(form).getByLabelText(/Town or region/), { target: { value: "York" } });
    fireEvent.change(within(form).getByLabelText("Reason for the change"), { target: { value: "Moved." } });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    await screen.findByText("Northwind Advisory Ltd saved: Ready · hidden (invite only).");
    expect(sent("PATCH", /directory-profiles/)[1].body).toEqual({ changes: { location: "York" }, reason: "Moved." });      // only what changed
    fireEvent.click(screen.getByRole("button", { name: "Actions for Northwind Advisory Ltd" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    const ask = screen.getByRole("form", { name: "Archive Northwind Advisory Ltd" });
    fireEvent.change(within(ask).getByLabelText(/Reason/), { target: { value: "Ceased trading." } });
    fireEvent.click(within(ask).getByRole("button", { name: "Archive profile" }));
    await screen.findByText("Northwind Advisory Ltd: Archived.");
    expect(sent("POST", /moderation$/)[0].body).toEqual({ action: "archive", reason: "Ceased trading." });
  });

  it("the Add business form checks before saving: problems, then duplicates with the existing record to open", async () => {
    let existing = [];
    routes = [{ method: "POST", match: /directory\/check$/, reply: ({ body }) => ({ body: {
      errors: /Avenue/.test(body.record.location) ? { location: "Enter the town or region only, not a street address or full postcode (for example: Leeds)." } : body.record.source.record_id ? {} : { "source.record_id": "Give the source link or reference." },
      duplicates: existing, verdict: null } }) },
      { method: "POST", match: /directory\/businesses$/, reply: () => ({ status: 201, body: { result: "created", slug: "bright-ledger-limited-leeds", publication: "published", reasons: [], visibility: "inherit", suggested_visibility: "public",
        link: "/marketplace/business/bright-ledger-limited-leeds" } }) }];
    const onAdded = vi.fn();
    mount("/", <AddBusinessForm options={options} onAdded={onAdded} />, "/");
    fill(/^Legal name/, "Bright Ledger Limited");
    fill(/^Category/, "Accounting");
    fill(/^Town or region/, "14 Acacia Avenue, Leeds LS1 2AB");
    fill(/^Source \*?$/, "Company website");
    fireEvent.click(screen.getByRole("button", { name: "Save business" }));
    expect((await screen.findByText(/Enter the town or region only/)).getAttribute("role")).toBe("alert");
    expect(document.activeElement).toBe(screen.getByLabelText(/^Town or region/));      // N-3: taken to the field that needs fixing
    expect(sent("POST", /directory\/businesses$/).length).toBe(0);
    fill(/^Town or region/, "Leeds");
    fireEvent.click(screen.getByRole("button", { name: "Save business" }));
    await screen.findByText("Give the source link or reference.");       // a source is required
    expect(document.activeElement).toBe(screen.getByLabelText(/^Source link or reference/));
    fill(/^Source link or reference/, "https://brightledger.example/about");
    existing = [{ kind: "profile", id: "p5", slug: "bright-ledger-ltd-leeds", name: "Bright Ledger Ltd", location: "Leeds", matched_on: "name" }];
    fireEvent.click(screen.getByRole("button", { name: "Save business" }));
    await screen.findByText("This business may already exist.");
    expect(screen.getByRole("link", { name: "Open existing" }).getAttribute("href")).toBe("/marketplace/business/bright-ledger-ltd-leeds");
    expect(sent("POST", /directory\/businesses$/).length).toBe(0);        // nothing is created while the question stands
    fireEvent.click(screen.getByRole("button", { name: "It's a different business: add it anyway" }));
    await screen.findByText("Added.");
    expect(sent("POST", /directory\/businesses$/)[0].body).toMatchObject({ allow_duplicate: true, record: { name: "Bright Ledger Limited", category: "Accounting", location: "Leeds", country: "United Kingdom",
      visibility: "inherit", business_status: "active", source: { provider: "Company website", record_id: "https://brightledger.example/about" } } });
    expect(screen.getByText("Ready to be shown")).toBeTruthy();           // the same quality result as an import
    expect(screen.getByText(/Good enough to be public if you choose/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the profile" }).getAttribute("href")).toBe("/marketplace/business/bright-ledger-limited-leeds");
    expect(onAdded).toHaveBeenCalled();
  });

  it("the same number or website can't be added again, only opened", async () => {
    routes = [{ method: "POST", match: /directory\/check$/, reply: () => ({ body: { errors: {}, verdict: null, duplicates: [{ kind: "profile", id: "p1", slug: base.slug, name: "Northwind Advisory Ltd", location: "Leeds", matched_on: "company number" }] } }) }];
    mount("/", <AddBusinessForm options={options} />, "/");
    fill(/^Legal name/, "Northwind Advisory (Leeds)");
    fireEvent.click(screen.getByRole("button", { name: "Save business" }));
    await screen.findByText(/The same company number or website is the same record/);
    expect(screen.queryByRole("button", { name: /add it anyway/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Open existing" })).toBeTruthy();
  });

  it("CSV: reads quoted fields, previews every row with its problems and duplicates, then imports the clean ones", async () => {
    const text = 'name,category,location,service_tags,source_provider,source_reference,retrieved_at,description\n"Cobalt Studio, Ltd",Design,Bristol,Branding; Web design,Company website,https://cobalt.example,2026-10-01,"Says ""hello""\nacross two lines"\n\nAddress Ltd,Design,"9 Mill Lane, Bath",,Other,ref,2026-10-01,\n';
    const parsed = parseCsv(text);
    expect(parsed.length).toBe(2);
    expect(parsed[0]).toMatchObject({ name: "Cobalt Studio, Ltd", location: "Bristol", service_tags: ["Branding", "Web design"], description: 'Says "hello"\nacross two lines',
      country: "United Kingdom", visibility: "inherit", source: { provider: "Company website", record_id: "https://cobalt.example", retrieved_at: "2026-10-01" } });
    expect(parseCsv("name\n")).toEqual([]);
    const result = (committed) => ({ committed, summary: { total: 2, ready: 1, with_problems: 1, duplicates: 0, added: committed ? 1 : 0 }, rows: [
      { row: 1, name: "Cobalt Studio, Ltd", errors: {}, duplicates: [], verdict: { publication: "published" }, ok: true, ...(committed ? { result: { result: "created" } } : {}) },
      { row: 2, name: "Address Ltd", errors: { location: "Enter the town or region only." }, duplicates: [], verdict: null, ok: false }] });
    routes = [{ method: "POST", match: /directory\/import$/, reply: ({ body }) => ({ body: result(body.commit) }) }];
    const onImported = vi.fn();
    mount("/", <ImportCsv onImported={onImported} />, "/");
    expect(screen.getByRole("button", { name: "Download the template" })).toBeTruthy();
    const file = new File([text], "businesses.csv", { type: "text/csv" });
    if (!file.text) file.text = async () => text;
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    await screen.findByText("2 rows: 1 ready to add, 1 with problems, 0 that may already exist.");
    const table = screen.getByRole("table", { name: "CSV preview" });
    expect(within(table).getByText("Ready")).toBeTruthy();
    expect(within(table).getByText("Needs fixing")).toBeTruthy();
    expect(within(table).getByText("Enter the town or region only.")).toBeTruthy();
    expect(sent("POST", /import$/)[0].body.commit).toBe(false);           // a preview adds nothing
    fireEvent.click(screen.getByRole("button", { name: "Import 1 ready row" }));
    await screen.findByText("Added 1 of 2. 1 had problems and 0 may already exist; those were left out.");
    expect(sent("POST", /import$/)[1].body.commit).toBe(true);
    expect(onImported).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Import \d/ })).toBeNull();
  });

  it("Index & invites leads with the form and CSV, with the JSON box behind Advanced", async () => {
    routes = [funnel, queue, { method: "GET", match: /directory\/unclaimed$/, reply: () => ({ body: { items: [], total: 0, options } }) }];
    mount("/", <AdminClaims section="index" />, "/");
    fireEvent.click(await screen.findByRole("button", { name: "Add business" }));
    const form = screen.getByRole("form", { name: "Add business" });
    await waitFor(() => expect(within(within(form).getByLabelText(/^Category/)).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose…", "Consulting", "Accounting", "Legal"]));
    expect(within(form).getByLabelText("Country").value).toBe("United Kingdom");
    expect(within(form).getByLabelText(/^Visibility/).value).toBe("inherit");
    expect(within(form).getByText("No street address or full postcode.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeTruthy();
    expect(screen.getByText("Advanced: paste records as JSON").closest("details").open).toBe(false);
    expect(screen.getByLabelText("Records as JSON").closest("details")).toBeTruthy();
  });

  it("'Already listed? Claim your business' opens the Marketplace with the finder ready", async () => {
    useAuthStore.setState({ token: null, email: null, hydrated: true });
    routes = [{ method: "GET", match: /^\/marketplace\/businesses\?/, reply: () => ({ body: { enabled: true, total: 0, categories: [], items: [], unclaimed_listed: false } }) }];
    mount("/marketplace?find=1", <MarketplacePage />, "/marketplace");
    expect(screen.getByRole("form", { name: "Find and claim your business" })).toBeTruthy();      // open, above the results
    expect(screen.getByLabelText("Business name")).toBeTruthy();
    cleanup();
    mount("/marketplace", <MarketplacePage />, "/marketplace");
    expect(screen.queryByRole("form", { name: "Find and claim your business" })).toBeNull();
    expect(screen.getByRole("button", { name: "Find and claim your business" })).toBeTruthy();
  });
});

describe("round N", () => {
  it("N-2: a public profile held back by quality says so, with what is missing on the chip", async () => {
    useAuthStore.setState({ token: "t", email: "tech.support@enterprateai.com", hydrated: true });
    routes = [{ method: "GET", match: /admin\/marketplace\/funnel$/, reply: () => ({ body: { events: {}, reports_open: 0, profiles: { total: 1, published: 0, claimed: 0, suppressed: 0 } } }) },
      { method: "GET", match: /admin\/marketplace\/claims/, reply: () => ({ body: { claims: [], reports: [], revocations: [], new_listings: [] } }) },
      { method: "GET", match: /directory\/unclaimed$/, reply: () => ({ body: { total: 1, unclaimed_visibility: "invite_only", items: [{ id: "p4", slug: "thin", name: "Thin Advisory Ltd", category: "Consulting", location: "Leeds",
        publication: "noindex", has_contact: false, visibility: "public", visibility_label: "Public (override)", public_state: "Public · not listed until quality passes", state_tone: "amber",
        state_detail: ["No description.", "No service tags."] }] } }) }];
    mount("/", <AdminClaims section="unclaimed" />, "/");
    const chip = (await screen.findByText("Public · not listed until quality passes")).closest("[title]");
    expect(chip.getAttribute("title")).toBe("Missing: No description. No service tags.");
    expect(chip.getAttribute("tabindex")).toBe("0");                      // reachable without a mouse
    expect(chip.textContent).toContain("Missing: No description. No service tags.");
    expect(screen.getByText("Public (override)")).toBeTruthy();
  });

  it("N-1: a missing business name is on the checklist and stops activation", async () => {
    useAuthStore.setState({ token: "t", email: "a@b.test", hydrated: true });
    useWorkspaceStore.setState({ workspaceId: "ws9" });
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: settings({ profile: { ...settings().profile, name: "" }, activation: { ready: false, items: [
      { key: "name", label: "A business name", done: false }, { key: "description", label: "A public description", done: true }] } }) }) },
      { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) }];
    mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
    await screen.findByRole("link", { name: "1 of 2 ready" });
    expect(within(document.getElementById("marketplace-checklist")).getByText("A business name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Activate Marketplace Profile" }).disabled).toBe(true);
  });

  it("a save that leaves the profile unable to go live says what is still needed, by the fields too", async () => {
    useAuthStore.setState({ token: "t", email: "a@b.test", hydrated: true });
    useWorkspaceStore.setState({ workspaceId: "ws9" });
    const items = (description) => [{ key: "name", label: "A business name", done: true }, { key: "description", label: "A public description (at least 20 characters)", done: description },
      { key: "service_area", label: "A location or service area", done: false }, { key: "offering", label: "At least one public offering or service", done: true },
      { key: "opportunity", label: "At least one kind of opportunity switched on", done: false }];
    const mine = (over = {}) => settings({ directory: null, activation: { ready: false, items: items(false) }, ...over });
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => ({ body: mine() }) }, { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) },
      { method: "PATCH", match: /businesses\/ws9\/marketplace-profile$/, reply: ({ body }) => ({ body: mine({ profile: { ...mine().profile, ...body.changes, service_tags: [], revision: 1 } }) }) }];
    mount("/marketplace-profile", <MarketplaceProfilePage />, "/marketplace-profile");
    const button = await screen.findByRole("button", { name: "Activate Marketplace Profile" });
    expect(button.getAttribute("title")).toMatch(/^Still needed: A public description \(at least 20 characters\); A location or service area; At least one kind of opportunity/);
    expect(document.querySelector("[data-needed]")).toBeNull();                 // nothing is flagged before they have tried
    fireEvent.change(screen.getByLabelText(/Public description/), { target: { value: "Website Des" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    const notice = (await screen.findByText(/Saved, but your profile can't go live yet\. 3 things are still needed:/)).closest("[role=alert]");
    expect(within(notice).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["A public description (at least 20 characters)", "A location or service area", "At least one kind of opportunity switched onOpen Opportunities"]);
    expect(screen.queryByText("Saved. Your profile is up to date.")).toBeNull();
    expect(document.querySelector("[data-needed=description]").textContent).toBe("11 of 20 characters. Add 9 more to publish.");
    expect(document.querySelector("[data-needed=service_area]").textContent).toBe("Needed to publish.");
    expect(document.querySelector("[data-needed=offering]")).toBeNull();        // one is already ticked
    fireEvent.change(screen.getByLabelText(/Public description/), { target: { value: "Website design for small firms" } });
    expect(document.querySelector("[data-needed=description]")).toBeNull();     // clears as they type
    fireEvent.click(within(notice).getByRole("button", { name: "Open Opportunities" }));
    expect(screen.getByRole("tab", { name: "Opportunities" }).getAttribute("aria-selected")).toBe("true");
  });

  it("the owner's page: a breadcrumb, one status row, a checklist that jumps to the field, and a skeleton shaped like the page", async () => {
    useAuthStore.setState({ token: "t", email: "a@b.test", hydrated: true });
    useWorkspaceStore.setState({ workspaceId: "ws9" });
    let release;
    const items = [{ key: "name", label: "A business name", done: true }, { key: "description", label: "A public description (at least 20 characters)", done: false, fix: "Write a real description." },
      { key: "service_area", label: "A location or service area", done: true }, { key: "offering", label: "At least one public offering or service", done: true },
      { key: "opportunity", label: "At least one kind of opportunity switched on", done: false }];
    routes = [{ method: "GET", match: /businesses\/ws9\/marketplace-profile$/, reply: () => new Promise((ok) => { release = () => ok({ body: settings({ directory: null, activation: { ready: false, items } }) }); }) },
      { method: "GET", match: /business-claims$/, reply: () => ({ body: { items: [] } }) }];
    mount("/marketplace/profile", <MarketplaceProfilePage />, "/marketplace/profile");
    // Loading: the page's own shape, with five checklist rows, and no "Loading" text in the middle of the screen.
    const loading = await screen.findByRole("status", { name: "Loading your Marketplace profile" });
    expect([...loading.querySelectorAll("[data-skeleton-part]")].map((x) => x.getAttribute("data-skeleton-part"))).toEqual(["status", "verify", "tabs", "grid"]);
    expect(loading.querySelector("[data-skeleton-part=grid]").className).toContain("lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]");
    expect(loading.querySelectorAll("[data-skeleton-row]").length).toBe(5);
    await act(async () => { release(); });
    const crumb = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(crumb.textContent).toBe("Marketplace/Your profile");
    expect(within(crumb).getByRole("link", { name: "Marketplace" }).getAttribute("href")).toBe("/marketplace");
    // One row: status, verification, progress on the left; the actions on the right. The groups stack below 768px.
    const status = document.querySelector("[data-status-card]");
    expect(status.className).toMatch(/\bflex-col\b.*\bmd:flex-row\b/);
    expect(status.querySelector("[data-status-chip]").textContent).toBe("Draft");
    expect(status.querySelector("[data-verification-chip]").textContent).toBe("Not verified");
    expect(status.textContent).toContain("3 of 5 ready, finish the checklist to publish");
    // The checklist: progress, then rows of icon, label and status.
    const list = document.getElementById("marketplace-checklist");
    expect(within(list).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("3");
    expect(list.querySelector("[data-checklist-progress]").textContent).toBe("3 of 5 ready");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.every((r) => r.className.includes("grid-cols-[20px_minmax(0,1fr)_auto]"))).toBe(true);
    expect(rows.map((r) => r.lastElementChild.textContent)).toEqual(["Done", "To do", "Done", "Done", "To do"]);
    expect(rows[0].lastElementChild.tagName).toBe("SPAN");
    expect(rows[1].lastElementChild.tagName).toBe("BUTTON");
    expect(rows[1].textContent).toContain("Write a real description.");       // what to fix, under the label
    expect(within(list).getByRole("button", { name: /^Activation 3\/5/ }).className).toContain("lg:hidden");      // folded away above the form below 1024px
    expect(list.parentElement.parentElement.className).toContain("order-first");
    // "To do" goes to the field.
    fireEvent.click(within(list).getByRole("button", { name: "To do: A public description (at least 20 characters)" }));
    await waitFor(() => expect(document.activeElement.id).toBe("mp-field-description"));
    fireEvent.click(within(list).getByRole("button", { name: "To do: At least one kind of opportunity switched on" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Opportunities" }).getAttribute("aria-selected")).toBe("true"));
    expect(document.body.textContent).not.toMatch(/[\u2013\u2014]/);          // no en or em dashes in the page's words
  });

  it("AI fill writes the description and the services into the form, says so, and can be undone; nothing is saved by it", async () => {
    routes = [{ method: "POST", match: /marketplace-profile\/suggest-description$/, reply: () => ({ body: { suggestion: "We run pricing reviews for small firms across Leeds." } }) },
      { method: "POST", match: /marketplace-profile\/suggest-services$/, reply: () => ({ status: 422, body: { detail: { code: "invalid", message: "x", errors: { service_tags: "Services couldn't be suggested just now. Please try again, or type them in." } } } }) }];
    mount("/", <ProfileSettings profile={settings({ profile: { ...settings().profile, description: "MMMMMMMMMM" } })} onSaved={() => {}} />, "/");
    const box = screen.getByLabelText(/Public description/);
    fireEvent.click(screen.getByRole("button", { name: "AI fill: write the public description for me" }));
    await waitFor(() => expect(box.value).toBe("We run pricing reviews for small firms across Leeds."));
    expect(sent("POST", /suggest-description$/)[0].body).toMatchObject({ description: "MMMMMMMMMM", service_tags: ["Strategy", "Pricing"] });
    expect(screen.getByText(/Written for you from your business details/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(box.value).toBe("MMMMMMMMMM");
    fireEvent.click(screen.getByRole("button", { name: "AI fill: suggest my services" }));
    expect((await screen.findByText(/Services couldn't be suggested just now/)).getAttribute("role")).toBe("alert");
    expect(sent("PATCH", /marketplace-profile$/).length).toBe(0);            // nothing was saved
  });
});

