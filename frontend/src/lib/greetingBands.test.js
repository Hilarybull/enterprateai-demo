// QA E10: the greeting follows the person's timezone with four bands, never "Good evening" at 01:53.
import { describe, expect, it } from "vitest";
import { getGreeting, greetingAt, hourIn } from "./greeting";

describe("greeting bands", () => {
  it("has a night band", () => {
    expect(greetingAt(1)).toBe("Hello");
    expect([4, 5, 12, 17, 22].map(greetingAt)).toEqual(["Hello", "Good morning", "Good afternoon", "Good evening", "Hello"]);
  });
  it("uses the person's timezone, not the server's or a fixed one", () => {
    const at = new Date("2026-10-12T00:53:00Z");      // 01:53 in London (BST), 01:53 in Lagos, 20:53 in New York
    expect(hourIn("Europe/London", at)).toBe(1);
    expect(getGreeting({ subject: "Sparkle", tz: "Europe/London", now: at })).toBe("Hello, Sparkle");
    expect(getGreeting({ subject: "Sparkle", tz: "America/New_York", now: at })).toBe("Good evening, Sparkle");
  });
});
