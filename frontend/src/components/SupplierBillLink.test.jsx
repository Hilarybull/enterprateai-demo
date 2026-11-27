import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SupplierBillLink from "./SupplierBillLink";
afterEach(cleanup);
const vendor = {id:"v1",name:"Training supplier",payment_terms:"14"};
const item = {id:"l1",qty:1,cost_of_sales:300};
it("starts as a link action and creates a due date from supplier payment terms", () => {
  const change = vi.fn();
  render(<SupplierBillLink item={item} index={0} vendors={[vendor]} currency="GBP" issuedAt="2026-11-27" onChange={change} />);
  expect(screen.queryByLabelText("Supplier for line 1")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Link supplier bill"}));
  fireEvent.change(screen.getByLabelText("Supplier for line 1"),{target:{value:"v1"}});
  expect(change).toHaveBeenCalledWith({vendor_id:"v1",supplier_due_date:"2026-12-11",supplier_due_date_manual:false});
});
it("shows the linked badge, outstanding balance, date and scheduled outflow", () => {
  render(<SupplierBillLink item={{...item,vendor_id:"v1",supplier_bill_id:"b1",supplier_due_date:"2026-12-11"}} index={0} vendors={[vendor]}
    bills={[{id:"b1",status:"pending",paid_amount:100}]} currency="GBP" issuedAt="2026-11-27" onChange={vi.fn()} />);
  expect(screen.getByRole("button",{name:"Supplier bill linked"})).toBeTruthy();
  expect(screen.getByText("Part-paid")).toBeTruthy();
  expect(screen.getByText("11 Dec 2026")).toBeTruthy();
  expect(screen.getAllByText(/200/)).toHaveLength(2);
});
