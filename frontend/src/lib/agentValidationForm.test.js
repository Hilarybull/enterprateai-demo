import { describe, expect, it } from "vitest";
import { fillEmpty } from "./agentValidationForm";

describe("the Idea Validation form filled by the Agent", () => {
  it("fills the empty fields from the chat and never replaces what the owner typed", () => {
    const current = { step1: { idea_name: "My own name", idea_description: "" }, step3: { channels: "Instagram" } };
    const drafted = {
      step1: { idea_name: "Cookery classes", idea_description: "Weekend cookery classes for children" },
      step2: { problem_description: "Parents want screen free weekends", who_affected: "Parents of 8 to 12 year olds" },
      step3: { primary_segment: "Parents of 8 to 12 year olds" },
      steps_completed: [1, 2, 3],
    };
    const { form, filled } = fillEmpty(current, drafted);
    expect(form.step1).toEqual({ idea_name: "My own name", idea_description: "Weekend cookery classes for children" });
    expect(form.step2.who_affected).toBe("Parents of 8 to 12 year olds");
    expect(form.step3).toEqual({ channels: "Instagram", primary_segment: "Parents of 8 to 12 year olds" });
    expect(form.steps_completed).toBeUndefined();
    expect(filled).toBe(4);
  });

  it("fills nothing when every field is already answered", () => {
    expect(fillEmpty({ step1: { idea_name: "A" } }, { step1: { idea_name: "B" } }).filled).toBe(0);
  });
});
