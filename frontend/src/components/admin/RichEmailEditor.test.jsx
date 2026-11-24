import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RichEmailEditor from "./RichEmailEditor";

beforeEach(() => {
  document.execCommand = vi.fn((command, _showUI, html) => {
    if (command === "insertHTML") screen.getByRole("textbox", { name: "Message" }).innerHTML += html;
    return true;
  });
});

afterEach(() => {
  cleanup();
  delete document.execCommand;
});

it("inserts variables at the button label cursor and preserves them in the saved button", async () => {
  const changed = vi.fn();
  render(<RichEmailEditor initialHtml="<p>Original message</p>" onChange={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "Insert button" }));
  const label = screen.getByRole("textbox", { name: "Button text" });
  fireEvent.change(label, { target: { value: "Claim company now" } });
  label.focus();
  label.setSelectionRange(6, 13);
  fireEvent.click(screen.getByRole("button", { name: /Variables/ }));
  fireEvent.click(within(screen.getByRole("menu", { name: "Variables" })).getByRole("menuitem", { name: /Business name/ }));
  expect(label.value).toBe("Claim {business} now");
  await waitFor(() => expect(label.selectionStart).toBe(16));
  expect(screen.getByRole("textbox", { name: "Message" }).textContent).toBe("Original message");
  expect(document.execCommand).not.toHaveBeenCalled();

  const link = screen.getByRole("textbox", { name: "Button link" });
  link.focus();
  fireEvent.click(screen.getByRole("button", { name: /Variables/ }));
  fireEvent.click(within(screen.getByRole("menu", { name: "Variables" })).getByRole("menuitem", { name: /Claim link/ }));
  expect(link.value).toBe("{claim_link}");
  fireEvent.click(screen.getByRole("button", { name: "Add button" }));
  const saved = changed.mock.calls.at(-1)[0];
  expect(saved.html).toContain('href="{claim_link}"');
  expect(saved.html).toContain("Claim {business} now");
});
