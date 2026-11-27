import {expect,it} from "vitest";
import {monthlyEmployeePay} from "./payroll";
it("converts monthly salary plus benefits into the expense currency",()=>{
  const employee={salary_amount:2400000,salary_frequency:"annual",benefits_monthly:10000,currency:"NGN"};
  expect(monthlyEmployeePay(employee,"GBP",{NGN:.001})).toBe(210);
  expect(monthlyEmployeePay(employee,"GBP",{})).toBeNull();
  expect(monthlyEmployeePay(employee,"NGN",{})).toBe(210000);
});
