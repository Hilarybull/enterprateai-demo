import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import ForecastArchive from './ForecastArchive';
import EmployeeRecords from './EmployeeRecords';
import {planHasModuleAccess,hasPaidAccess,accessLabel} from '../lib/plans';
import {RecordModal} from '../pages/BusinessOperationsPage';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('keeps supplier links optional and defaults a linked bill from vendor terms',()=>{
 const save=vi.fn();render(<RecordModal mode="edit" type="invoice" record={{id:'i',customer_name:'Client',currency:'GBP',issued_at:'2026-11-26',line_items:[{id:'l',description:'Training',qty:1,unit_price:500,cost_of_sales:300}]}} customers={[]} allKnownCustomers={[]} vendors={[{id:'v',name:'Training vendor',payment_terms:'30 days'}]} onSave={save} onClose={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Supplier for line 1'),{target:{value:'v'}});
 fireEvent.click(screen.getByText('Save Changes'));
 expect(save.mock.calls[0][0].line_items[0]).toMatchObject({vendor_id:'v',supplier_due_date:'2026-12-26',cost_of_sales:300});
});
it('opens trial features and locks every module after expiry',()=>{
 expect(planHasModuleAccess('explorer','simulation','trial')).toBe(true);
 expect(hasPaidAccess('explorer','trial')).toBe(true);
 expect(planHasModuleAccess('explorer','financials','expired')).toBe(false);
 expect(accessLabel({access_source:'14-day trial'})).toContain('all features');
});
it('saves employee salary, frequency and benefits with the employee',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);render(<EmployeeRecords onSave={save}/>);
 fireEvent.change(screen.getByLabelText('Full name *'),{target:{value:'Ada'}});
 fireEvent.change(screen.getByLabelText('Gross salary'),{target:{value:'24000'}});
 fireEvent.change(screen.getByLabelText('Pay frequency'),{target:{value:'annual'}});
 fireEvent.change(screen.getByLabelText('Other benefits per month'),{target:{value:'100'}});
 fireEvent.click(screen.getByText('Add employee'));
 await waitFor(()=>expect(save).toHaveBeenCalled());
 expect(save.mock.calls[0][0][0]).toMatchObject({name:'Ada',salary_amount:'24000',salary_frequency:'annual',benefits_monthly:'100'});
});
it('displays incomplete current-month actuals and leaves upcoming actuals blank',async()=>{
 global.fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({items:[{id:'s',label:'Saved November forecast',currency:'GBP',actuals_as_of:'2026-11-26',comparison:[{month:'2026-11',status:'in_progress',forecast:{revenue:900,costs:100},actual:{revenue:700,costs:800},variance:{revenue:-200,costs:700}},{month:'2026-12',status:'upcoming',forecast:{revenue:950,costs:200},actual:null,variance:null}]}]}),{status:200}));
 render(<ForecastArchive businessId="b" tenantId="t" state={{revenue_monthly:100}}/>);
 fireEvent.click(screen.getByText('View saved forecasts'));
 expect(await screen.findByText('Actual to date')).toBeTruthy();
 expect(screen.getByText('Upcoming')).toBeTruthy();
 expect(screen.getAllByText('—').length).toBe(4);
});
