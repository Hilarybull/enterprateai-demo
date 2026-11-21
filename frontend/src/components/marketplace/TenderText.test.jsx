import React from "react";
import { expect, test } from "vitest";
import { render } from "@testing-library/react";
import TenderText from "./TenderText";

test("formats bold markers without rendering uploaded HTML", () => {
  const { container } = render(<TenderText>{'**Mandatory requirements** and ***Deadline*** <script>alert(1)</script>'}</TenderText>);
  expect(container.querySelectorAll("strong").length).toBe(2);
  expect(container.textContent).not.toContain("**");
  expect(container.querySelector("script")).toBeNull();
});
