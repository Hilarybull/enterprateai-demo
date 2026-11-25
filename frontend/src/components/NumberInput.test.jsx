import React from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import NumberInput from "./NumberInput";

afterEach(cleanup);

it("preserves the sign and blank value for validated simulation inputs", () => {
  const changed = vi.fn();
  const { getByRole } = render(<NumberInput preserveInput value="" onChange={changed} />);
  fireEvent.change(getByRole("textbox"), { target: { value: "-25" } });
  expect(changed).toHaveBeenLastCalledWith("-25");
  fireEvent.change(getByRole("textbox"), { target: { value: "-" } });
  expect(changed).toHaveBeenLastCalledWith("-");
});
