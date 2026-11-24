// The owner, 27 Oct: typing to go ahead with the Agent's buttons.
import { expect, it } from "vitest";
import { offerFor } from "./agent";

const offers = [{ label: "Open “₦5m grant for equipment”", to: "/funding/c1" }, { label: "Start a new launch plan", capability: "launch" }, { label: "Not now", dismiss: true }];

it("yes is the first button, a name is that button, not now closes them", () => {
  expect(offerFor("yes, go ahead", offers)).toBe(offers[0]);
  expect(offerFor("Go ahead", offers)).toBe(offers[0]);
  expect(offerFor("start a new launch plan", offers)).toBe(offers[1]);
  expect(offerFor("open it", offers)).toBe(offers[0]);
  expect(offerFor("not now", offers)).toBe(offers[2]);
});

it("anything else is a new message", () => {
  expect(offerFor("how much funding do I need?", offers)).toBeNull();
  expect(offerFor("yes", [])).toBeNull();
});
