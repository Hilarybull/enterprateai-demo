import { useMemo, useState } from "react";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import Spinner from "../components/Spinner";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import { formatCurrency, formatNumber, formatPercent } from "../lib/format";
import NumberInput, { parseNumber } from "../components/NumberInput";

export default function SimulationPage() {
  const storedInputs = useWorkspaceStore((s) => s.inputs);
  const currency = useWorkspaceStore((s) => s.currency);

  const [base, setBase] = useState(
    storedInputs
      ? {
          price_per_unit: String(storedInputs.price_per_unit ?? ""),
          units_per_month: String(storedInputs.units_per_month ?? ""),
          fixed_costs_monthly: String(storedInputs.fixed_costs_monthly ?? ""),
          variable_cost_per_unit: String(storedInputs.variable_cost_per_unit ?? ""),
          starting_cash: String(storedInputs.starting_cash ?? "")
        }
      : {
          price_per_unit: "",
          units_per_month: "",
          fixed_costs_monthly: "",
          variable_cost_per_unit: "",
          starting_cash: ""
        }
  );

  const [scenario, setScenario] = useState("revenue_drop");
  const [percent, setPercent] = useState("20");
  const [newPrice, setNewPrice] = useState("60");
  const [employeeCost, setEmployeeCost] = useState("1500");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const payload = useMemo(() => {
    const basePayload = {
      base: {
        price_per_unit: parseNumber(base.price_per_unit, 0),
        units_per_month: parseNumber(base.units_per_month, 0),
        fixed_costs_monthly: parseNumber(base.fixed_costs_monthly, 0),
        variable_cost_per_unit: parseNumber(base.variable_cost_per_unit, 0),
        starting_cash: parseNumber(base.starting_cash, 0)
      },
      scenario
    };
    if (scenario === "revenue_drop" || scenario === "cost_increase") basePayload.percent = parseNumber(percent, 0);
    if (scenario === "price_change") basePayload.new_price_per_unit = parseNumber(newPrice, 0);
    if (scenario === "hire_employee") basePayload.employee_monthly_cost = parseNumber(employeeCost, 0);
    return basePayload;
  }, [base, scenario, percent, newPrice, employeeCost]);

  async function run() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiRequest("/simulation/run", "POST", payload);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Simulation"
        description="Test what-if scenarios on your assumptions."
        badge={{ text: "What-if", tone: "slate" }}
      />

      {storedInputs ? null : (
        <div className="mt-4">
          <InlineAlert message="No stored validation inputs found. Fill base inputs below or run Validation first." />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <SectionCard title="Base inputs" subtitle="These are your baseline assumptions.">
          <div className="grid grid-cols-1 gap-2">
            {[
              ["price_per_unit", "Price per unit"],
              ["units_per_month", "Units per month"],
              ["fixed_costs_monthly", "Fixed costs (monthly)"],
              ["variable_cost_per_unit", "Variable cost per unit"],
              ["starting_cash", "Starting cash"]
            ].map(([key, label]) => (
              <div key={key}>
                <div className="ea-label">{label}</div>
                <NumberInput value={base[key]} onChange={(v) => setBase((p) => ({ ...p, [key]: v }))} placeholder="0" />
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="md:col-span-2 space-y-4">
          <SectionCard title="Scenario" subtitle="Apply a scenario and compare results.">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="ea-label">Scenario type</div>
                <select
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                  className="ea-input"
                >
                  <option value="revenue_drop">Revenue drop</option>
                  <option value="cost_increase">Cost increase</option>
                  <option value="price_change">Price change</option>
                  <option value="hire_employee">Hire employee</option>
                </select>
              </div>

              {scenario === "revenue_drop" || scenario === "cost_increase" ? (
                <div>
                  <div className="ea-label">Percent</div>
                  <NumberInput value={percent} onChange={setPercent} placeholder="20" />
                </div>
              ) : null}

              {scenario === "price_change" ? (
                <div>
                  <div className="ea-label">New price per unit</div>
                  <NumberInput value={newPrice} onChange={setNewPrice} placeholder="0" />
                </div>
              ) : null}

              {scenario === "hire_employee" ? (
                <div>
                  <div className="ea-label">Employee monthly cost</div>
                  <NumberInput value={employeeCost} onChange={setEmployeeCost} placeholder="0" />
                </div>
              ) : null}
            </div>

            {error ? <div className="mt-4"><InlineAlert kind="error" message={error} /></div> : null}

            <div className="mt-4 flex justify-end">
              <Button disabled={isLoading} onClick={run}>
                {isLoading ? <Spinner size={16} /> : null}
                {isLoading ? "Running..." : "Run simulation"}
              </Button>
            </div>
          </SectionCard>

          {result ? (
            <SectionCard title="Comparison" subtitle="Base vs scenario vs change.">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold text-slate-500">Base</div>
                  <div className="mt-3 space-y-2">
                    <Row label="Revenue" value={formatCurrency(result.base_case.metrics.revenue_monthly, currency)} />
                    <Row label="Costs" value={formatCurrency(result.base_case.metrics.costs_monthly, currency)} />
                    <Row label="Margin" value={formatPercent(result.base_case.metrics.margin)} />
                    <Row label="Break-even" value={formatNumber(result.base_case.metrics.break_even_months)} />
                    <Row label="Runway" value={result.base_case.metrics.runway_months == null ? "Infinity" : formatNumber(result.base_case.metrics.runway_months)} />
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold text-slate-500">Scenario</div>
                  <div className="mt-3 space-y-2">
                    <Row label="Revenue" value={formatCurrency(result.scenario_result.metrics.revenue_monthly, currency)} />
                    <Row label="Costs" value={formatCurrency(result.scenario_result.metrics.costs_monthly, currency)} />
                    <Row label="Margin" value={formatPercent(result.scenario_result.metrics.margin)} />
                    <Row label="Break-even" value={formatNumber(result.scenario_result.metrics.break_even_months)} />
                    <Row label="Runway" value={result.scenario_result.metrics.runway_months == null ? "Infinity" : formatNumber(result.scenario_result.metrics.runway_months)} />
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold text-slate-500">Delta</div>
                  <div className="mt-3 space-y-2 text-sm">
                    <DeltaRow label="Revenue" value={result.delta.revenue_monthly} />
                    <DeltaRow label="Costs" value={result.delta.costs_monthly} />
                    <DeltaRow label="Margin" value={result.delta.margin} />
                    <DeltaRow label="Break-even" value={result.delta.break_even_months} />
                    <DeltaRow label="Runway" value={result.delta.runway_months} />
                  </div>
                </div>
              </div>
            </SectionCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function DeltaRow({ label, value }) {
  const n = typeof value === "number" ? value : null;
  const isPos = n !== null && n > 0;
  const isNeg = n !== null && n < 0;
  const cls = isPos ? "text-emerald-700" : isNeg ? "text-rose-700" : "text-slate-700";
  const show = n === null ? "—" : n.toFixed(2);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={"text-sm font-semibold " + cls}>{show}</div>
    </div>
  );
}
