// Credits are never money (the owner's rule, 16 Oct): no currency sign in any credit line.
import { describe, expect, it } from "vitest";
import { creditCopy } from "./creditCopy";

describe("credit copy", () => {
  it("never shows a currency sign", () => {
    const lines = [creditCopy.confirmFixed({ action: "Research", cost: 60, balance: 600 }), creditCopy.done({ used: 27, balance: 573 }),
      creditCopy.insufficient({ cost: 60, balance: 10 }), creditCopy.agentAuto({ did: "checked your launch", cost: 2 })];
    for (const l of lines) expect(l).not.toMatch(/[£$€₦]|NGN|GBP|USD/);
    expect(lines[0]).toContain("60 credits");
  });
});
