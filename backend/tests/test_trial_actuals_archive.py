import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from app.modules.plans import access
from app.modules.credits import service as credits
from app.modules.scenario_intelligence import records, forecast_archive
from app.modules.scenario_intelligence.projection import current_month_view, project
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot
from app.shared.auth.deps import _enforce_trial_access


def test_trial_boundary_is_signup_plus_fourteen_days():
    start = datetime(2026,11,1,tzinfo=timezone.utc)
    assert access.trial_subscription(start.isoformat(),start+timedelta(days=14,microseconds=-1)).status == 'trial'
    assert access.trial_subscription(start.isoformat(),start+timedelta(days=14)).status == 'expired'


def test_trial_opens_every_tier_without_changing_paid_allocation(monkeypatch):
    monkeypatch.setattr(access,'resolve_subscription',AsyncMock(return_value=access.trial_subscription('2026-11-20T00:00:00Z',datetime(2026,11,21,tzinfo=timezone.utc))))
    monkeypatch.setattr(access,'module_grants',AsyncMock(return_value=set()))
    from app.modules.plans import team
    monkeypatch.setattr(team,'team_of',AsyncMock(return_value=None))
    assert asyncio.run(access.effective_access('u'))['effective_plan'] == access.TOP_PLAN
    monkeypatch.setattr(credits,'_get_subscription',AsyncMock(return_value=None))
    monkeypatch.setattr(credits,'_get_plan_config',AsyncMock(return_value={'credits_per_period':50}))
    assert asyncio.run(credits._initial_credits_for_user('u')) == (200,'explorer')


@pytest.mark.parametrize('balance,controlled,blocked',[(0,True,True),(0,False,False),(1,True,False)])
def test_exhausted_trial_gates_ai_only(monkeypatch,balance,controlled,blocked):
    from app.modules.plans import team
    monkeypatch.setattr(team,'team_of',AsyncMock(return_value=None))
    monkeypatch.setattr(access,'resolve_subscription',AsyncMock(return_value=SimpleNamespace(status='trial')))
    monkeypatch.setattr(access,'effective_access',AsyncMock(return_value={'full_access':False,'team_owner':None}))
    monkeypatch.setattr(credits,'get_balance',AsyncMock(return_value=balance))
    result=asyncio.run(credits._trial_credit_error('u',{'credit_controlled':controlled,'credit_cost':2}))
    assert bool(result) == blocked


def test_expired_trial_blocks_product_but_allows_upgrade_and_paid_team(monkeypatch):
    monkeypatch.setattr(access,'resolve_subscription',AsyncMock(return_value=SimpleNamespace(status='expired',current_period_end='2026-11-15')))
    monkeypatch.setattr(access,'effective_access',AsyncMock(return_value={'effective_plan':'explorer'}))
    req=lambda path:SimpleNamespace(url=SimpleNamespace(path=path))
    with pytest.raises(HTTPException) as error:asyncio.run(_enforce_trial_access(req('/validation/me'),{'id':'u'}))
    assert error.value.detail['error']=='TRIAL_EXPIRED'
    asyncio.run(_enforce_trial_access(req('/plans/checkout'),{'id':'u'}))
    monkeypatch.setattr(access,'effective_access',AsyncMock(return_value={'effective_plan':'decision_engine'}))
    asyncio.run(_enforce_trial_access(req('/validation/me'),{'id':'u'}))


def operations():
    return {'workspace_profile':{'currency':'GBP'},'financials':{'invoices':[{'id':'inv','issued_at':'2026-11-02','status':'pending','total_amount':700,'cost_of_sales':300,
      'line_items':[{'id':'line','qty':1,'cost_of_sales':300,'supplier_bill_id':'bill'}]}],
      'expenses':[{'id':'bill','source_invoice_id':'inv','price':300,'category':'cost_of_sales','status':'pending','incurred_at':'2026-11-03','created_at':'2026-12-01','due_date':'2026-12-10'},
                  {'id':'staff','price':500,'expense_type':'staff_payments','status':'paid','incurred_at':'2026-11-05','created_at':'2026-12-01'}]},
      'catalogue':{'employees':[{'name':'Ada','salary_amount':520,'salary_frequency':'weekly','benefits_monthly':100}]}}


def test_operations_dates_actuals_supplier_due_and_payroll():
    built=records.build(operations(),date(2026,11,26))
    actual=built['current_month']
    assert (actual['revenue'],actual['cost_of_sales'],actual['expenses'],actual['receivables']) == (700,300,500,700)
    assert built['position']['pending_payables_schedule'][1] == 300
    assert built['fills']['payroll_staff_count']==1
    assert built['fills']['payroll_gross_monthly_per_person']==2253.33
    state=BusinessStateSnapshot(current_month_recorded=actual)
    view=current_month_view(state,date(2026,11,26),600,{'days':4,'revenue':99,'costs':77,'closing_cash':9999})
    assert view['month_total']['revenue']==700
    assert view['month_total']['costs']==800
    assert view['cash_at_month_end'] is None
    assert view['rest_of_month']['revenue']==0


def test_archive_remains_frozen_while_actuals_change_and_future_is_blank():
    snap={'forecast':{'2026-11':{'revenue':900,'costs':100},'2026-12':{'revenue':950,'costs':200}}}
    report=forecast_archive.comparison(snap,operations(),date(2026,11,26))
    assert report['comparison'][0]['variance']['revenue']==-200
    assert report['comparison'][0]['status']=='in_progress'
    assert report['comparison'][1]['actual'] is None
    assert snap['forecast']['2026-11']['revenue']==900


def test_actual_month_never_adds_a_remaining_days_forecast_to_future_cash():
    state=BusinessStateSnapshot(revenue_monthly=300,payment_terms_days=0,starting_cash=100,
                               current_month_recorded={'basis':'actual','month':'2026-11','revenue':50,'expenses':20,'cost_of_sales':0})
    rows,summary=project(state,'do_nothing_projection',{},3,as_of=date(2026,11,26))
    assert rows[0]['revenue']==16.67  # September 0 + October 0 + November actual 50, divided by three.
    assert rows[0]['cash_balance']==110  # 100 actual cash + December sales 16.67 - expenses 6.67.
    assert summary['current_month']['month_total']['revenue']==50


def test_current_month_receivables_exclude_older_invoices_and_cash_includes_partial_receipts():
    data=operations()
    data['financials']['invoices'].append({'id':'old','issued_at':'2026-10-01','status':'pending','total_amount':1000})
    data['financials']['invoices'][0]['payments']=[{'amount':200,'paid_at':'2026-11-20'}]
    actual=records.build(data,date(2026,11,26))['current_month']
    assert actual['receivables']==500
    assert actual['cash']==-300  # 200 received less 500 staff payment. Linked supplier bill is not paid yet.


def test_archive_does_not_report_success_when_storage_fails(monkeypatch):
    monkeypatch.setattr(forecast_archive,'sb_insert',AsyncMock(side_effect=RuntimeError('offline')))
    state=BusinessStateSnapshot(revenue_monthly=100,costs_monthly=20)
    with pytest.raises(RuntimeError):asyncio.run(forecast_archive.save_snapshot('u','b',state,6,operations(),date(2026,11,26)))


def test_supplier_link_is_validated_and_updates_the_existing_bill_atomically():
    from copy import deepcopy
    from app.shared.master_records import prepare_employee_expenses
    data={'catalogue':{'vendors':[{'id':'v','name':'Delivery vendor','payment_terms':30}]},'financials':{'expenses':[]}}
    patch={'financials':{'invoices':[{'id':'i','issued_at':'2026-11-26','currency':'GBP','line_items':[{'id':'l','vendor_id':'v','qty':1,'cost_of_sales':300}]}]}}
    prepare_employee_expenses(patch,data)
    assert patch['financials']['expenses'][0]['due_date']=='2026-12-26'
    data['financials']=deepcopy(patch['financials'])
    update=deepcopy(patch)
    update['financials']['expenses'][0].update(status='paid')
    prepare_employee_expenses(update,data)
    assert len(update['financials']['expenses'])==1 and update['financials']['expenses'][0]['status']=='paid'
    data['financials']=deepcopy(update['financials'])
    update['financials']['invoices'][0]['line_items'][0]['cost_of_sales']=400
    with pytest.raises(ValueError,match='paid supplier bill'):prepare_employee_expenses(update,data)


def test_supplier_bill_edits_keep_the_invoice_cost_in_sync():
    from copy import deepcopy
    from app.shared.master_records import prepare_employee_expenses
    data={'catalogue':{'vendors':[{'id':'v','name':'Vendor','payment_terms':30}]},'financials':{'invoices':[{'id':'i','issued_at':'2026-11-26','line_items':[{'id':'l','vendor_id':'v','qty':1,'cost_of_sales':300,'supplier_bill_id':'b','supplier_due_date':'2026-12-26'}]}],
       'expenses':[{'id':'b','source_invoice_id':'i','source_line_id':'l','price':300,'vendor_id':'v','due_date':'2026-12-26','status':'pending'}]}}
    patch={'financials':deepcopy(data['financials'])}
    patch['financials']['expenses'][0].update(price=350,due_date='2027-01-05')
    prepare_employee_expenses(patch,data)
    assert patch['financials']['invoices'][0]['cost_of_sales']==350
    assert patch['financials']['invoices'][0]['line_items'][0]['supplier_due_date']=='2027-01-05'


@pytest.mark.parametrize('value',[-1,'NaN','Infinity','invalid'])
def test_invalid_employee_pay_is_rejected_on_the_server(value):
    from app.shared.master_records import prepare_employee_expenses
    with pytest.raises(ValueError):prepare_employee_expenses({'catalogue':{'employees':[{'salary_amount':value}]}},{})


def test_actuals_convert_document_currencies_and_exclude_missing_rates():
    data={'workspace_profile':{'currency':'GBP'},'fx_rates':{'base':'GBP','rates':{'USD':0.8}},'financials':{
      'invoices':[{'issued_at':'2026-11-20','currency':'USD','amount':100,'status':'pending'},{'issued_at':'2026-11-21','currency':'NGN','amount':100000,'status':'pending'}],
      'expenses':[{'incurred_at':'2026-11-20','currency':'USD','amount':20,'status':'paid'}]}}
    built=records.build(data,date(2026,11,26))
    assert built['current_month']['revenue']==80
    assert built['current_month']['expenses']==16
    assert built['current_month']['receivables']==80
    assert 'NGN' in built['figure_notes'][0]
