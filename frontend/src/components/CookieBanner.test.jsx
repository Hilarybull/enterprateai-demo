import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CookieBanner from "./CookieBanner";
import { COOKIE_CONSENT_KEY } from "../lib/cookieConsent";

beforeEach(() => {
  localStorage.clear();
  window.clarity = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.clarity;
});

const mount = () => render(<MemoryRouter><CookieBanner /></MemoryRouter>);

it("sends denied before a choice, then grants both signals on Accept all", () => {
  mount();
  expect(window.clarity).toHaveBeenLastCalledWith("consentv2", { analytics_Storage: "denied", ad_Storage: "denied" });
  fireEvent.click(screen.getByRole("button", { name: "Accept all cookies" }));
  expect(window.clarity).toHaveBeenLastCalledWith("consentv2", { analytics_Storage: "granted", ad_Storage: "granted" });
  expect(screen.queryByRole("button", { name: "Accept all cookies" })).toBeNull();
  expect(JSON.parse(localStorage.getItem(COOKIE_CONSENT_KEY)).analytics).toBe(true);
});

it("sends the unchecked preference when it is saved, and waits for Save before applying it", () => {
  mount();
  window.clarity.mockClear();
  fireEvent.click(screen.getAllByRole("checkbox").find((input) => !input.disabled));
  expect(window.clarity).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  expect(window.clarity).toHaveBeenLastCalledWith("consentv2", { analytics_Storage: "denied", ad_Storage: "denied" });
  expect(JSON.parse(localStorage.getItem(COOKIE_CONSENT_KEY)).analytics).toBe(false);
});

it.each([true, false])("restores existing consent without asking again (%s)", (analytics) => {
  localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({ operational: true, analytics }));
  mount();
  expect(screen.queryByRole("button", { name: "Save preferences" })).toBeNull();
  const permission = analytics ? "granted" : "denied";
  expect(window.clarity).toHaveBeenLastCalledWith("consentv2", { analytics_Storage: permission, ad_Storage: permission });
});

it("applies a changed preference from another tab and reopens the banner after reset", () => {
  localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({ operational: true, analytics: true }));
  mount();
  act(() => {
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({ operational: true, analytics: false }));
    window.dispatchEvent(new StorageEvent("storage", { key: COOKIE_CONSENT_KEY }));
  });
  expect(window.clarity).toHaveBeenLastCalledWith("consentv2", { analytics_Storage: "denied", ad_Storage: "denied" });
  act(() => {
    localStorage.removeItem(COOKIE_CONSENT_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: COOKIE_CONSENT_KEY }));
  });
  expect(screen.getByRole("button", { name: "Save preferences" })).toBeTruthy();
});
