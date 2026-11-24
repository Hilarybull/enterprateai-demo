import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { COOKIE_CONSENT_KEY, initializeClarity, readCookieConsent, resetCookieConsent, saveCookieConsent } from "./cookieConsent";

beforeEach(() => {
  localStorage.clear();
  delete window.clarity;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll("script[data-clarity-project]").forEach((script) => script.remove());
  delete window.clarity;
});

it.each([true, false])("restores saved consent before loading the tracker (analytics %s)", (analytics) => {
  localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({ operational: true, analytics }));
  const append = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, "appendChild").mockImplementation((script) => {
    const permission = analytics ? "granted" : "denied";
    expect(window.clarity.q[0]).toEqual(["consentv2", { analytics_Storage: permission, ad_Storage: permission }]);
    return append(script);
  });
  initializeClarity("zesi3sn43m");
  const script = document.querySelector("script[data-clarity-project]");
  expect(script.src).toBe("https://www.clarity.ms/tag/zesi3sn43m");
  expect(script.async).toBe(true);
});

it("queues rejection, acceptance and withdrawal while the tracker is loading, with one script", () => {
  initializeClarity("zesi3sn43m");
  saveCookieConsent(true);
  resetCookieConsent();
  expect(window.clarity.q.map((call) => call[1].analytics_Storage)).toEqual(["denied", "granted", "denied"]);
  expect(window.clarity.q.map((call) => call[1].ad_Storage)).toEqual(["denied", "granted", "denied"]);
  expect(localStorage.getItem(COOKIE_CONSENT_KEY)).toBeNull();
  initializeClarity("zesi3sn43m");
  expect(document.querySelectorAll("script[data-clarity-project]").length).toBe(1);
});

it("updates a loaded tracker and stores the existing preference format", () => {
  window.clarity = vi.fn();
  saveCookieConsent(false);
  expect(JSON.parse(localStorage.getItem(COOKIE_CONSENT_KEY))).toEqual({ operational: true, analytics: false });
  expect(window.clarity).toHaveBeenLastCalledWith("consentv2", { analytics_Storage: "denied", ad_Storage: "denied" });
  saveCookieConsent(true);
  expect(window.clarity).toHaveBeenLastCalledWith("consentv2", { analytics_Storage: "granted", ad_Storage: "granted" });
});

it.each(["broken", "accepted", "null", '{"analytics":"true"}'])("requires a fresh choice for invalid saved preferences (%s)", (saved) => {
  localStorage.setItem(COOKIE_CONSENT_KEY, saved);
  expect(readCookieConsent()).toBeNull();
  initializeClarity("zesi3sn43m");
  expect(window.clarity.q[0][1].analytics_Storage).toBe("denied");
});

it("sends the current choice when storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
  expect(readCookieConsent()).toBeNull();
  window.clarity = vi.fn();
  saveCookieConsent(true);
  expect(window.clarity).toHaveBeenCalledWith("consentv2", { analytics_Storage: "granted", ad_Storage: "granted" });
});

it("keeps local and demo pages independent of Clarity when no tracker is installed", () => {
  saveCookieConsent(true);
  expect(window.clarity).toBeUndefined();
  expect(document.querySelector("script[data-clarity-project]")).toBeNull();
});
