import { describe, it, expect } from "vitest";
import { replyMarkup } from "./replyMarkup";
describe("reply presentation metadata", () => {
  it("shows answers to the current question instead of unrelated tasks", () => {
    const result = replyMarkup('No revenue, or no funding yet?<quick_actions>Restart my loan</quick_actions><reply_options>No revenue yet\nNo funding yet</reply_options>');
    expect(result.text).toBe("No revenue, or no funding yet?");
    expect(result.prompts.map(x => x.prompt)).toEqual(["No revenue yet", "No funding yet"]);
  });
  it("hides legacy task suggestions attached to a clarification question", () => {
    expect(replyMarkup('What stage are you at?<invoke name="quick_actions"><parameter name="actions">["Search lenders"]</parameter></invoke>').prompts).toEqual([]);
  });
  it("turns provider action markup into ordinary optional reply buttons", () => {
    const result = replyMarkup('Your request is ready.\n<invoke name="quick_actions"><parameter name="actions">["Show my loan", "Search grants"]</parameter></invoke>');
    expect(result.text).toBe("Your request is ready.");
    expect(result.prompts.map(x => x.prompt)).toEqual(["Show my loan", "Search grants"]);
  });
  it("hides malformed metadata without dropping the actual answer", () => {
    expect(replyMarkup('Your answer.<invoke name="quick_actions"><parameter name="actions">broken').text).toBe("Your answer.");
  });
  it("keeps ordinary comparisons and user-facing text", () => {
    expect(replyMarkup("Income < costs; choose what to do.").text).toBe("Income < costs; choose what to do.");
  });
});
