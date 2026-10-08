// The Catalogue's customer table: invoices, revenue earned and outstanding per customer.
// From the demo call: Altmosphere Consulting Ltd had invoices sent and £700 received, and the
// table showed 0 invoices, £0.00 earned and £0.00 outstanding.
import { describe, expect, it } from "vitest";
import { customerFigures } from "./CataloguePage";

const customers = [{ id: "c1", name: "Altmosphere Consulting LTd", payment_terms: 14 }, { id: "c2", name: "ABD Ltd", payment_terms: 14 }, { id: "c3", name: "Nobody Yet" }];
const row = (rows, name) => rows.find((r) => r.name === name);

describe("customer figures in the Catalogue", () => {
  it("counts invoices that are out, money received (part payments too) and what is still owed", () => {
    const invoices = [
      // Sent, part-paid: £700 received of £1,200.
      { id: "i1", customer_id: "c1", customer_name: "Altmosphere Consulting LTd", status: "sent", total_amount: 1200, payments: [{ id: "p1", amount: 700 }] },
      // Still a draft waiting for approval: not out with the customer yet, so not counted or owed.
      { id: "i2", customer_id: "c1", customer_name: "Altmosphere Consulting LTd", status: "draft", total_amount: 2400, payments: [] },
      // Sent to ABD Ltd, nothing paid.
      { id: "i3", customer_name: "abd ltd ", status: "sent", total_amount: 342, payments: [] },
    ];
    const rows = customerFigures(invoices, customers);
    expect(row(rows, "Altmosphere Consulting LTd")).toMatchObject({ invoices: 1, revenue: 700, outstanding: 500, payment_terms: 14 });
    expect(row(rows, "ABD Ltd")).toMatchObject({ invoices: 1, revenue: 0, outstanding: 342 });      // matched by name, whatever the capitals or spacing
    expect(row(rows, "Nobody Yet")).toMatchObject({ invoices: 0, revenue: 0, outstanding: 0 });     // in the catalogue, never invoiced
  });

  it("a fully paid invoice is all revenue and nothing owed; voided, cancelled and archived ones are left out", () => {
    const rows = customerFigures([
      { id: "i1", customer_id: "c2", status: "paid", total_amount: 342 },                           // marked paid by hand, with no payment lines
      { id: "i2", customer_id: "c2", status: "paid", total_amount: 100, payments: [{ amount: 60 }, { amount: 40 }] },
      { id: "i3", customer_id: "c2", status: "voided", total_amount: 999 },
      { id: "i4", customer_id: "c2", status: "cancelled", total_amount: 999 },
      { id: "i5", customer_id: "c2", status: "sent", total_amount: 999, archived: true },
      { id: "i6", customer_id: "c2", status: "credited", total_amount: 80, payments: [] },          // credited: counted as an invoice, nothing owed
      { id: "i7", customer_id: "c2", status: "sent", total_amount: 200, payment_type: "partial", paid_amount: 50 },      // the older way of recording a part payment
    ], customers);
    expect(row(rows, "ABD Ltd")).toMatchObject({ invoices: 4, revenue: 492, outstanding: 150 });
  });

  it("someone invoiced who is not in the catalogue still gets a row, and an invoice with no name is ignored", () => {
    const rows = customerFigures([{ id: "i1", customer_name: "Walk-in Client", status: "sent", total_amount: 75 }, { id: "i2", status: "sent", total_amount: 10 }], customers);
    expect(row(rows, "Walk-in Client")).toMatchObject({ invoices: 1, revenue: 0, outstanding: 75 });
    expect(rows.length).toBe(4);
  });
});
