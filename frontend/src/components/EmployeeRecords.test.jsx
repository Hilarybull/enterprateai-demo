import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EmployeeRecords from "./EmployeeRecords";
afterEach(cleanup);
it("saves a named employee with their role, then allows an existing record to be archived", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const { rerender } = render(<EmployeeRecords onSave={onSave} />);
  fireEvent.change(screen.getByLabelText("Full name *"), { target: { value: "Ada Okafor" } });
  fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Operations lead" } });
  fireEvent.click(screen.getByText("Add employee"));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  const saved = onSave.mock.calls[0][0];
  expect(saved[0]).toMatchObject({ name: "Ada Okafor", job_title: "Operations lead" });
  rerender(<EmployeeRecords employees={saved} onSave={onSave} />);
  await waitFor(() => expect(screen.getByLabelText("Full name *").value).toBe(""));
  fireEvent.click(screen.getByLabelText("Actions for Ada Okafor"));
  fireEvent.click(screen.getByText("Archive"));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onSave.mock.calls[1][0][0]).toMatchObject({ id: saved[0].id, archived: true });
});
it("keeps typed answers when saving fails", async () => {
  render(<EmployeeRecords onSave={vi.fn().mockRejectedValue(new Error("Please retry"))} />);
  fireEvent.change(screen.getByLabelText("Full name *"), { target: { value: "Ada" } });
  fireEvent.click(screen.getByText("Add employee"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Please retry"));
  expect(screen.getByLabelText("Full name *").value).toBe("Ada");
});
