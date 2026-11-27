import {expect,it} from 'vitest';
import {linkSupplierCosts,vendorDueDate} from './supplierCosts';
import {monthlyEmployeePay} from './payroll';
it('normalises employee salary frequency and benefits without assuming missing pay',()=>{
 expect(monthlyEmployeePay({salary_amount:24000,salary_frequency:'annual',benefits_monthly:100})).toBe(2100);
 expect(monthlyEmployeePay({salary_amount:520,salary_frequency:'weekly',benefits_monthly:100})).toBe(2353.33);
 expect(monthlyEmployeePay({})).toBeNull();
 expect(monthlyEmployeePay({salary_amount:-20})).toBeNull();
});
it('defaults due dates from vendor terms across month boundaries and keeps an override',()=>{
 const vendor={id:'v',name:'Training supplier',payment_terms:'Net 30 days'};
 expect(vendorDueDate(vendor,'2026-11-26')).toBe('2026-12-26');
 const invoice={id:'i',currency:'GBP',issued_at:'2026-11-26',line_items:[{id:'l',qty:2,cost_of_sales:150,vendor_id:'v',supplier_due_date:'2027-01-05'}]};
 const first=linkSupplierCosts(invoice,[],[vendor]);
 expect(first.expenses[0]).toMatchObject({price:300,due_date:'2027-01-05',vendor_id:'v',source_invoice_id:'i',category:'cost_of_sales'});
 expect(linkSupplierCosts(first.invoice,first.expenses,[vendor]).expenses).toHaveLength(1);
 expect(linkSupplierCosts({...invoice,line_items:[{id:'l',cost_of_sales:150}]},[],[vendor]).expenses).toHaveLength(0);
});
it('protects a paid supplier bill from being silently rewritten',()=>{
 const invoice={id:'i',line_items:[{id:'l',vendor_id:'v',cost_of_sales:200,supplier_bill_id:'b',supplier_due_date:'2026-12-01'}]};
 expect(()=>linkSupplierCosts(invoice,[{id:'b',price:100,status:'paid'}],[{id:'v'}])).toThrow(/paid/);
});
