// One greeting and one briefing for every place the Agent speaks.
import { describe, expect, it } from "vitest";
import { briefingOf, firstNameOf, getGreeting, greetingAt, hourIn, workspaceNameOf } from "./greeting";

const at = (iso) => new Date(iso);

describe("the greeting", () => {
  it("follows the time of day: morning from 05:00, afternoon from 12:00, evening from 17:00 to 04:59", () => {
    expect([4, 5, 11, 12, 16, 17, 23, 0].map(greetingAt)).toEqual(["Good evening", "Good morning", "Good morning", "Good afternoon", "Good afternoon", "Good evening", "Good evening", "Good evening"]);
    expect(hourIn("Africa/Lagos", at("2026-10-08T13:30:00Z"))).toBe(14);      // by the timezone given, not the device
    expect(hourIn("Not/AZone", at("2026-10-08T13:30:00Z"))).toBe(at("2026-10-08T13:30:00Z").getHours());
  });

  it("addresses the subject exactly as given, and uses no comma and no made-up name when there is none", () => {
    const now = at("2026-10-08T13:30:00Z");
    expect(getGreeting({ subject: "QA Onboarding Test Ltd", tz: "Europe/London", now })).toBe("Good afternoon, QA Onboarding Test Ltd");
    expect(getGreeting({ subject: "Munah", tz: "Europe/London", now })).toBe("Good afternoon, Munah");
    expect(getGreeting({ tz: "Europe/London", now })).toBe("Good afternoon");
    expect(getGreeting({ subject: "  ", tz: "Asia/Tokyo", now })).toBe("Good evening");
  });

  it("takes a first name from what is on record, and tells a real workspace name from a placeholder", () => {
    expect(firstNameOf("Munah Okoro")).toBe("Munah");
    expect(firstNameOf("hilary@example.test")).toBe("");                      // an email address is not a name
    expect(firstNameOf("tech.support@enterprateai.com")).toBe("");
    expect(firstNameOf("")).toBe("");
    expect(workspaceNameOf("QA Onboarding Test Ltd")).toBe("QA Onboarding Test Ltd");
    for (const none of ["", "My workspace", "Untitled", "my business", null]) expect(workspaceNameOf(none)).toBe("");
  });
});

describe("the briefing: only what the Agent did or is doing", () => {
  it("says what was done since the last visit, with the right singular and plural", () => {
    expect(briefingOf({ done_since_last_visit: { new_invoice: 1, risk_concentration: 1 } })).toEqual({ kind: "done", text: "While you were away I drafted 1 invoice and checked your risks." });
    expect(briefingOf({ done_since_last_visit: { new_invoice: 2, enquiry_to_quote: 1, record_expense: 3 } }).text).toBe("While you were away I drafted 2 invoices, drafted 1 quotation and finished 3 other tasks.");
    expect(briefingOf({ done_since_last_visit: { record_expense: 1 } }).text).toBe("While you were away I finished 1 task.");
  });

  it("a task in progress comes first; with nothing done it asks what is next; a first visit asks for the first job", () => {
    expect(briefingOf({ working_on: { title: "Your quotation for Mark" }, done_since_last_visit: { new_invoice: 1 } })).toEqual({ kind: "working", text: "I'm working on your quotation for Mark. I'll let you know when it's ready." });
    expect(briefingOf({ done_since_last_visit: {}, needs_approval_count: 3, needs_input_count: 2 })).toEqual({ kind: "next", text: "What should I work on next?" });      // what is waiting is not repeated here
    expect(briefingOf({ done_since_last_visit: {}, first_visit: true })).toEqual({ kind: "first", text: "Tell me the first job and I'll get on it." });
    expect(briefingOf(null)).toEqual({ kind: "none", text: "" });
    for (const b of [{ done_since_last_visit: { new_invoice: 1 } }, { done_since_last_visit: {} }, { first_visit: true }]) expect(briefingOf(b).text).not.toMatch(/waiting|approval|question|[\u2013\u2014]/);
  });
});
