import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatQuestionThread, emailIn } from "./TaskFlow";

afterEach(cleanup);

describe("an email asked for", () => {
  it("is found inside a sentence", () => {
    expect(emailIn("I am proposing a free Service. email: info@asd.co.uk")).toBe("info@asd.co.uk");
    expect(emailIn("mark@example.test.")).toBe("mark@example.test");
    expect(emailIn("no address here")).toBe("");
  });

  it("is kept from a sentence, one question shown, and the app's own message when there is none", () => {
    const onSubmit = vi.fn();
    render(<ChatQuestionThread question="What should this proposal say?" onSubmit={onSubmit} onCancel={() => {}}
      fields={[{ key: "customer_email", label: "Customer email", type: "email", required: true, default: "" }, { key: "notes", label: "Notes", type: "text", required: false, default: "" }]} />);
    expect(screen.queryByText("What should this proposal say?")).toBeNull();
    const box = screen.getByLabelText("Customer email");
    fireEvent.change(box, { target: { value: "I am proposing a free Service. email: info" } });
    fireEvent.submit(box.closest("form"));
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    fireEvent.change(box, { target: { value: "I am proposing a free Service. email: info@asd.co.uk" } });
    fireEvent.submit(box.closest("form"));
    fireEvent.submit(screen.getByLabelText("Notes").closest("form"));
    expect(onSubmit.mock.calls[0][0].customer_email).toBe("info@asd.co.uk");
  });
});
