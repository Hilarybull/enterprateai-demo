import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RecordModal } from "./BusinessOperationsPage";
afterEach(cleanup);
it("links a staff expense to an employee rather than a vendor", () => {
 const save = vi.fn();
 render(<RecordModal mode="create" type="expense" customers={[]} employees={[{id:"e1",name:"Ada"}]} onSave={save} onClose={()=>{}} />);
 fireEvent.change(screen.getByLabelText("Expense type"), {target:{value:"staff_payments"}});
 fireEvent.change(screen.getByLabelText("Employee"), {target:{value:"e1"}});
 fireEvent.change(screen.getByPlaceholderText("0.00"), {target:{value:"2000"}});
 fireEvent.click(screen.getByRole("button", {name:"Create"}));
 expect(save.mock.calls[0][0]).toMatchObject({employee_id:"e1",employee_name:"Ada",category:"payroll",total_amount:2000,vendor_name:""});
});
it("requires a custom type when Other is chosen", () => {
 const save=vi.fn();
 render(<RecordModal mode="create" type="expense" customers={[]} onSave={save} onClose={()=>{}} />);
 fireEvent.change(screen.getByLabelText("Expense type"), {target:{value:"other"}});
 fireEvent.click(screen.getByRole("button", {name:"Create"}));
 expect(screen.getByText("Enter the type of expense.")).toBeTruthy();
 expect(save).not.toHaveBeenCalled();
});
