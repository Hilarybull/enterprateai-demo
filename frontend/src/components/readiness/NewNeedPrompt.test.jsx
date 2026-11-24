import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import NewNeedPrompt, { purposeFromTitle, titleNamesNewNeed } from "./NewNeedPrompt";

afterEach(cleanup);

it("asks only when the title names something the case isn't for", () => {
  expect(titleNamesNewNeed("Funds for Party", "Marketing")).toBe(true);
  expect(titleNamesNewNeed("Loan for marketing", "Marketing")).toBe(false);
  expect(titleNamesNewNeed("₦10m grant for working capital", "Working capital")).toBe(false);
  expect(titleNamesNewNeed("Funding", "Marketing")).toBe(false);      // nothing said: nothing to disagree with
  expect(titleNamesNewNeed("Funds for Party", "")).toBe(false);
  expect(purposeFromTitle("Funds for Party")).toBe("Party");
  expect(purposeFromTitle("₦2m loan for a second van")).toBe("A second van");
});

it("starts a new need with what the title says, or keeps the title as the same need", async () => {
  const onNewNeed = vi.fn().mockResolvedValue(true);
  const data = { title: "Funds for Party", purpose: "Marketing", target_amount: 10000000, currency: "NGN" };
  render(<NewNeedPrompt subjectId="c1" data={data} onNewNeed={onNewNeed} />);
  expect(document.querySelector("[data-new-need]").textContent).toContain('Your title says "Funds for Party", but this case is for Marketing.');
  expect(document.querySelector("[data-new-need-purpose]").value).toBe("Party");
  fireEvent.click(document.querySelector("[data-new-need-start]"));
  expect(onNewNeed).toHaveBeenCalledWith({ title: "Funds for Party", purpose: "Party", target_amount: 10000000 });
  cleanup();
  render(<NewNeedPrompt subjectId="c2" data={data} onNewNeed={onNewNeed} />);
  fireEvent.click(document.querySelector("[data-new-need-same]"));
  expect(document.querySelector("[data-new-need]")).toBeNull();
});
