from datetime import date
import pytest
from app.modules.scenario_intelligence.projection import project, run_rate_snapshot
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot as State

TODAY = date(2026, 11, 27)

def state(**overrides):
    values = dict(starting_cash=10000, payment_terms_days=0,
        revenue_by_month={"2026-09":300,"2026-10":600,"2026-11":9999},
        expenses_by_month={"2026-09":30,"2026-10":60,"2026-11":9999},
        cost_of_sales_by_month={"2026-09":90,"2026-10":180,"2026-11":9999},
        current_month_recorded={"basis":"actual","month":"2026-11","revenue":900,"expenses":90,"cost_of_sales":270})
    values.update(overrides)
    return State(**values)

def test_every_month_recalculates_using_its_previous_three_months():
    rows, summary = project(state(), "do_nothing_projection", {}, 6, as_of=TODAY)
    assert [r["revenue"] for r in rows[:4]] == [600,700,733.33,677.78]
    assert [r["cost_of_sales"] for r in rows[:4]] == [180,210,220,203.33]
    assert [r["expenses"] for r in rows[:4]] == [60,70,73.33,67.78]
    january=summary["monthly_detail"][1]["rolling_inputs"]["revenue"]
    assert [(item["month"],item["basis"]) for item in january] == [
        ("2026-10","actual"),("2026-11","actual_to_date"),("2026-12","forecast")]
    march=summary["monthly_detail"][3]["rolling_inputs"]["revenue"]
    assert [item["month"] for item in march] == ["2026-12","2027-01","2027-02"]
    assert all(item["basis"] == "forecast" for item in march)
    assert summary["current_month"]["month_total"]["revenue"] == 900
    assert summary["checks"] == {"cash_reconciles":True,"receivables_reconcile":True,"balance_sheet_balances":True}
    assert "2026-12 forecast 600.00" in summary["how_calculated"]["months"][1]["revenue"]
    assert summary["forecast_method"] == "rolling_three_month"

def test_actuals_replace_previous_forecasts_as_months_arrive():
    old, _ = project(state(),"do_nothing_projection",{},3,as_of=TODAY)
    assert old[1]["revenue"] == 700
    latest=state(revenue_by_month={"2026-10":600,"2026-11":900,"2026-12":600},
                 current_month_recorded={"basis":"actual","month":"2026-12","revenue":1200,"expenses":0,"cost_of_sales":0})
    rows, summary=project(latest,"do_nothing_projection",{},3,as_of=date(2026,12,27))
    assert rows[0]["revenue"] == 900
    assert summary["monthly_detail"][0]["rolling_inputs"]["revenue"][-1]["value"] == 1200

def test_zero_actuals_are_used_instead_of_a_previous_nonzero_value():
    rows,_=project(state(current_month_recorded={"basis":"actual","month":"2026-11","revenue":0,"expenses":0,"cost_of_sales":0}),
                   "do_nothing_projection",{},3,as_of=TODAY)
    assert rows[0]["revenue"] == 300

def test_payroll_overlay_is_added_once_not_compounded_through_previous_forecasts():
    st=state(expenses_by_month={},current_month_recorded={"basis":"actual","month":"2026-11","revenue":900,"expenses":0,"cost_of_sales":270},
             payroll_staff_count=1,payroll_gross_monthly_per_person=300)
    rows,_=project(st,"do_nothing_projection",{},6,as_of=TODAY)
    assert [r["expenses"] for r in rows] == [345]*6  # Gross 300 plus the default 15% employer cost, once each month.

def test_run_rate_snapshot_uses_the_same_rolling_baseline():
    snapshot=run_rate_snapshot(state(),"do_nothing_projection",{},3,as_of=TODAY)
    assert snapshot.revenue_monthly == 733.33
    assert snapshot.cost_of_sales_monthly == 220

def test_missing_months_are_explicit_and_not_replaced_by_older_months():
    rows, summary=project(state(revenue_by_month={"2026-08":5000,"2026-10":600}),"do_nothing_projection",{},3,as_of=TODAY)
    assert rows[0]["revenue"] == 500
    assert summary["monthly_detail"][0]["rolling_inputs"]["revenue"][0] == {"month":"2026-09","basis":"no_records","value":0}

def test_operations_records_feed_the_rolling_projection_end_to_end():
    from app.modules.scenario_intelligence.router import _phase5_from_records
    data={"settings":{"currency":"GBP"},"financials":{"invoices":[
        {"issued_at":"2026-09-01","total_amount":300},
        {"issued_at":"2026-10-01","total_amount":600},
        {"issued_at":"2026-11-01","total_amount":900}]}}
    initial=State(starting_cash=10000)
    populated=initial.model_copy(update=_phase5_from_records(initial,data,{},TODAY))
    rows,summary=project(populated,"do_nothing_projection",{},6,as_of=TODAY)
    assert [row["revenue"] for row in rows[:4]] == [600,700,733.33,677.78]
    assert summary["current_month"]["recorded_so_far"]["revenue"] == 900

def test_backtest_checks_the_same_moving_average_without_future_information():
    from app.modules.scenario_intelligence.baseline import backtest
    result=backtest({"2026-07":300,"2026-08":600,"2026-09":900,"2026-10":1800},TODAY,method="rolling_three_month")
    assert result["months"][0]["month"] == "2026-10"
    assert result["months"][0]["forecast"] == 600
