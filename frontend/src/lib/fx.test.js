// One conversion service (the owner's QA, 21 Oct): each rate asked once and shared, into the workspace's own currency.
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { _resetFxCache, foreignOf, isoOf, rateFor } from "./fx";

afterEach(() => { vi.restoreAllMocks(); _resetFxCache(); });

it("reads a currency code however it is written", () => {
  expect([isoOf("NGN"), isoOf("ngn"), isoOf("Nigerian Naira (NGN)"), isoOf(""), isoOf(null)]).toEqual(["NGN", "NGN", "NGN", "", ""]);
});

it("lists only the documents' other currencies, never the workspace's", () => {
  expect(foreignOf([{ currency: "NGN" }, { currency: "GBP" }, { currency: "" }, {}], "NGN")).toEqual(["GBP"]);
});

it("asks each rate once, into the workspace currency, and shares it", async () => {
  const spy = vi.spyOn(client, "apiRequest").mockResolvedValue({ rate: 1775, date: "2026-10-21" });
  const [a, b] = await Promise.all([rateFor("GBP", "NGN"), rateFor("GBP", "NGN")]);
  expect(a).toEqual({ rate: 1775, date: "2026-10-21" });
  expect(b).toEqual(a);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0][0]).toBe("/integrations/currency-rate?from_currency=GBP&to_currency=NGN");
});

it("asks again after a failed lookup", async () => {
  const spy = vi.spyOn(client, "apiRequest").mockRejectedValueOnce(new Error("down")).mockResolvedValue({ rate: 1775, date: "2026-10-21" });
  expect((await rateFor("GBP", "NGN")).rate).toBeNull();
  expect((await rateFor("GBP", "NGN")).rate).toBe(1775);
  expect(spy).toHaveBeenCalledTimes(2);
});
