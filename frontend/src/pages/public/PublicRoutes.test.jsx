// QA F: every top-nav, menu and footer link opens a real page: never "Page not found", never an empty body.
// The menus open on click, hover and focus, close on Escape and an outside click, and the arrow keys move inside.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../../App";
import PublicHeader from "../../components/public/PublicHeader";
import { FEATURE_GROUPS, FEATURE_PAGES, FOOTER, TOP_NAV, featureBySlug } from "../../lib/publicSite";

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollTo = Element.prototype.scrollTo || function scrollTo() {};
  window.scrollTo = () => {};
  globalThis.fetch = vi.fn(async (url) => {
    const path = String(url);
    const body = /blog\/categories/.test(path) ? [{ id: "c1", slug: "cash-flow", name: "Cash flow" }, { id: "c2", slug: "empty-topic", name: "Empty topic" }]
      : /blog\/articles/.test(path) ? [{ id: "a1", slug: "late-payments", title: "Getting paid on time", category_id: "c1" }] : /\/blog/.test(path) ? [] : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const LINKS = [...new Set([
  ...TOP_NAV.map((n) => n.to),
  ...FEATURE_PAGES.map((f) => `/features/${f.slug}`),
  ...FEATURE_GROUPS.map((g) => `/features/${g.slug}`),
  ...FOOTER.flatMap((c) => c.links).filter((l) => l.to).map((l) => l.to.split("#")[0]),
  "/articles/cash-flow",
])];

describe("every public link opens a page", () => {
  it.each(LINKS)("%s", async (path) => {
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    await waitFor(() => expect(document.body.textContent.trim().length).toBeGreaterThan(80), { timeout: 4000 });
    expect(document.body.textContent).not.toMatch(/Page not found/);
  });

  it("an unknown address is a 404 with the way back", async () => {
    render(<MemoryRouter initialEntries={["/no-such-page"]}><App /></MemoryRouter>);
    const nav = await screen.findByRole("navigation", { name: "Where to go instead" });
    expect(within(nav).getByRole("link", { name: "Back to the homepage" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Page not found");
  });

  it("each content page has one h1, its own title and a description", async () => {
    for (const path of ["/features", "/how-it-works", "/use-cases", "/testimonials", "/features/agent"]) {
      const { unmount } = render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
      await waitFor(() => expect(document.querySelectorAll("h1").length).toBe(1));
      expect(document.title).toMatch(/· EnterprateAI$/);
      expect(document.head.querySelector('meta[name="description"]').getAttribute("content").length).toBeGreaterThan(20);
      unmount();
    }
  });

  it("the testimonials page shows the two consented testimonials, is indexable, and shows no placeholder", async () => {
    render(<MemoryRouter initialEntries={["/testimonials"]}><App /></MemoryRouter>);
    await waitFor(() => expect(document.querySelectorAll("[data-testimonial]").length).toBe(2));
    const irene = document.querySelector("[data-testimonial='sombeauty-irene']");
    expect(irene.textContent).toContain("Irene A.");
    expect(irene.textContent).toContain("SOMBEAUTY LONDON LTD · London");
    const gilbert = document.querySelector("[data-testimonial='oic3-gilbert']");
    expect(gilbert.textContent).toContain("OIC3 AUTO SERVICES LTD");
    expect(gilbert.querySelector("[data-location]")).toBeNull();               // no location was supplied: none is shown
    expect(document.body.textContent).not.toMatch(/Placeholder|real content needed/i);
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();      // real content: indexable
    expect(document.querySelectorAll("img").length).toBe([...document.querySelectorAll("img")].filter((i) => /logo/i.test(i.getAttribute("alt") || "") || /EnterprateAI/.test(i.getAttribute("alt") || "")).length);      // no customer photos or logos
  });
});

describe("the navigation menus", () => {
  const mount = () => render(<MemoryRouter><PublicHeader /></MemoryRouter>);
  const button = (name) => screen.getByRole("button", { name: `${name} menu` });

  it("opens on click, closes on Escape and on a click outside", async () => {
    mount();
    fireEvent.click(button("Features"));
    expect(button("Features").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu", { name: "Features" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Features" })).toBeNull();
    fireEvent.click(button("Articles"));
    await waitFor(() => expect(within(screen.getByRole("menu", { name: "Articles" })).getByRole("menuitem", { name: "Cash flow" })).toBeTruthy());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "Articles" })).toBeNull();
  });

  it("opens on hover and on keyboard focus, and the arrow keys move between its links", async () => {
    mount();
    fireEvent.pointerEnter(button("Features").closest("li"));
    expect(screen.getByRole("menu", { name: "Features" })).toBeTruthy();
    fireEvent.pointerLeave(button("Features").closest("li"));
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });      // a person tabs back later than the same instant
    fireEvent.focus(button("Features"));
    const menu = screen.getByRole("menu", { name: "Features" });
    const links = within(menu).getAllByRole("menuitem");
    links[0].focus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(links[1]);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(links[0]);
  });

  // QA U5: what a mouse does, in order: over the item, then down, focus, up and click on its trigger.
  async function hoverThenClick(name) {
    const li = button(name).closest("li");
    fireEvent.pointerEnter(li);
    fireEvent.pointerDown(button(name));
    fireEvent.mouseDown(button(name));
    fireEvent.focus(button(name));
    fireEvent.pointerUp(button(name));
    fireEvent.mouseUp(button(name));
    fireEvent.click(button(name));
  }

  it("a click on a menu that hovering opened keeps it open, and pinned it stays when the mouse leaves; a second click closes it", async () => {
    vi.useFakeTimers();
    try {
      mount();
      await hoverThenClick("Features");
      expect(button("Features").getAttribute("aria-expanded")).toBe("true");
      expect(button("Features").closest("li").getAttribute("data-menu-mode")).toBe("pinned");
      fireEvent.pointerLeave(button("Features").closest("li"));
      await act(async () => { vi.advanceTimersByTime(400); });
      expect(screen.getByRole("menu", { name: "Features" })).toBeTruthy();
      fireEvent.click(button("Features"));
      expect(screen.queryByRole("menu", { name: "Features" })).toBeNull();
      // Only hovered, it closes when the mouse leaves.
      fireEvent.pointerEnter(button("Articles").closest("li"));
      expect(screen.getByRole("menu", { name: "Articles" })).toBeTruthy();
      fireEvent.pointerLeave(button("Articles").closest("li"));
      await act(async () => { vi.advanceTimersByTime(400); });
      expect(screen.queryByRole("menu", { name: "Articles" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the Articles menu lists the latest articles and only the topics with something in them", async () => {
    mount();
    await hoverThenClick("Articles");
    const menu = screen.getByRole("menu", { name: "Articles" });
    await waitFor(() => expect(within(menu).getByRole("menuitem", { name: "Getting paid on time" }).getAttribute("href")).toBe("/blog/late-payments"));
    expect(within(menu).getByRole("menuitem", { name: "Cash flow" })).toBeTruthy();
    expect(within(menu).queryByText("Empty topic")).toBeNull();
    expect(menu.textContent).not.toMatch(/No categories yet/);
  });

  it("with nothing published, the Articles menu is the Articles Hub alone, never \"No categories yet\"", async () => {
    globalThis.fetch = vi.fn(async (url) => new Response(JSON.stringify(/blog\/categories/.test(String(url)) ? [{ id: "c1", slug: "cash-flow", name: "Cash flow" }] : []),
      { status: 200, headers: { "Content-Type": "application/json" } }));
    mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    await hoverThenClick("Articles");
    const menu = screen.getByRole("menu", { name: "Articles" });
    expect(within(menu).getAllByRole("menuitem").map((a) => a.getAttribute("href"))).toEqual(["/articles"]);
    expect(menu.textContent).not.toMatch(/No categories yet/);
  });

  it("every item is a page link, and Features and Articles are in the phone menu too", () => {
    mount();
    const pages = [...document.querySelectorAll("nav ul a")].map((a) => a.getAttribute("href"));
    for (const n of TOP_NAV) expect(pages).toContain(n.to);
    expect(pages.some((h) => h.startsWith("#"))).toBe(false);              // nav items are pages, not in-page anchors
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const phone = document.querySelector("[data-mobile-menu]");
    expect(within(phone).getByRole("link", { name: "Features" }).getAttribute("href")).toBe("/features");
    expect(within(phone).getByRole("link", { name: "Idea Validation" }).getAttribute("href")).toBe("/features/idea-validation");
  });
});


describe("testimonials come only from consent", () => {
  it("hides an inactive or unconsented entry, and the nav and footer link only while one can be shown", async () => {
    const { default: TestimonialCards } = await import("../../components/public/TestimonialCards");
    const list = [
      { id: "a", quote: "Real words.", name: "A.", company: "A LTD", consent_recorded: true, active: true },
      { id: "b", quote: "Withdrawn.", name: "B.", company: "B LTD", consent_recorded: true, active: false },
      { id: "c", quote: "No consent.", name: "C.", company: "C LTD", consent_recorded: false, active: true }];
    render(<TestimonialCards list={list} />);
    expect([...document.querySelectorAll("[data-testimonial]")].map((x) => x.getAttribute("data-testimonial"))).toEqual(["a"]);
    cleanup();
    render(<TestimonialCards list={[list[1], list[2]]} />);
    expect(document.querySelector("[data-testimonials]")).toBeNull();
    cleanup();
    render(<MemoryRouter><PublicHeader /></MemoryRouter>);
    expect([...document.querySelectorAll("nav ul a")].map((a) => a.getAttribute("href"))).toContain("/testimonials");
  });
});

describe("every feature page is a whole page (QA U6)", () => {
  it.each(FEATURE_PAGES.map((f) => f.slug))("/features/%s: what it does, who it's for, three steps, free and paid, a picture and the way in", async (slug) => {
    render(<MemoryRouter initialEntries={[`/features/${slug}`]}><App /></MemoryRouter>);
    const page = await screen.findByRole("heading", { level: 1 }, { timeout: 4000 });
    const root = page.closest("[data-public-page]");
    expect(root.querySelector("[data-feature-what] li")).toBeTruthy();
    expect(root.querySelector("[data-feature-who] p").textContent.length).toBeGreaterThan(20);
    expect(root.querySelectorAll("[data-feature-how] li").length).toBe(3);
    expect(root.querySelectorAll("[data-feature-access] dt").length).toBeGreaterThan(0);
    expect(root.querySelector("[data-feature-picture]")).toBeTruthy();
    expect(within(root.querySelector("[data-feature-cta]")).getByRole("link", { name: "See pricing" }).getAttribute("href")).toBe("/pricing");
    expect(root.querySelector("[data-placeholder]")).toBeNull();
    expect(root.textContent).not.toMatch(/placeholder|lorem|TODO/i);
  });

  it("free and paid are read from the registry, never written by hand", async () => {
    const { featureAccess, minPlanFor } = await import("../../content/featureDetails");
    const registry = (await import("../../content/entitlements.json")).default;
    expect(minPlanFor("new_proposal")).toBe("starter_insight");      // as the registry has it
    expect(registry.adds.starter_insight).toContain("new_proposal");
    const said = (slug) => featureAccess(slug).rows.map((r) => `${r.plan}: ${r.text}`);
    expect(said("business-proposal")).toEqual(["Starter: Included from Starter."]);
    expect(said("invoice-generator")).toEqual(["Explorer: Free on every plan when you do it yourself.", "Explorer: The Agent can prepare it for you on the free plan too."]);
    expect(said("scenario-simulation")).toEqual(["Starter: Included from Starter.", "Explorer: Not included", "Starter: 4 a month", "Decision Engine: No limit"]);
    expect(said("marketplace")).toContain("Explorer: 1 listing");
    expect(said("rfq-to-quotation").at(-1)).toMatch(/from Starter/);
  });
});


describe("every feature page's words are its own (QA P5-2)", () => {
  it("no two features share a 'Who it's for' or a step, and fragility describes fragility", async () => {
    const { FEATURE_DETAILS, featureDetail } = await import("../../content/featureDetails");
    const whos = FEATURE_PAGES.map((f) => featureDetail(f).who);
    expect(whos.every((w) => typeof w === "string" && w.length > 20)).toBe(true);
    expect(new Set(whos).size).toBe(whos.length);
    const steps = Object.values(FEATURE_DETAILS).flatMap((d) => d.steps.map((st) => st.body));
    expect(new Set(steps).size).toBe(steps.length);
    const titles = Object.entries(FEATURE_DETAILS).flatMap(([slug, d]) => d.steps.map((st) => `${st.title}`)).filter((t, i, all) => all.indexOf(t) !== i);
    expect(titles).toEqual([]);
    const fragility = featureDetail(featureBySlug("fragility-index"));
    expect(fragility.who).toMatch(/exposed/);
    expect(fragility.who).toMatch(/one customer/);
    expect(fragility.who).toMatch(/cash/);
    expect(fragility.who).not.toBe(featureDetail(featureBySlug("scenario-simulation")).who);
  });
});
