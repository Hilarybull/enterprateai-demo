from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class ProofLevel(str, Enum):
    NONE = "none"
    INFORMAL_INTEREST = "informal_interest"
    PILOTS = "pilots"
    PAID_PILOT = "paid_pilot"
    SIGNED_CONTRACT = "signed_contract"


# ---------------------------------------------------------------------------
# Input dataclasses
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class FinancialInputs:
    price_per_unit: float
    units_per_month: float
    fixed_costs_monthly: float
    variable_cost_per_unit: float
    starting_cash: float


@dataclass(frozen=True)
class CapacityInputs:
    demand_units_per_month: float
    team_size: int
    capacity_units_per_person_per_month: float


@dataclass(frozen=True)
class ProofInputs:
    """
    Market validation evidence collected in Screen 10.
    proof_level   : structured enum of evidence quality
    proof_count   : number of signals (e.g. 3 signed contracts, 10 informal interests)
    """
    proof_level: ProofLevel = ProofLevel.NONE
    proof_count: int = 0


@dataclass(frozen=True)
class SalesCycleInputs:
    """
    Sales cycle and payment terms collected in Screen 5.
    sales_cycle_days  : how long from lead to closed sale
    payment_terms_days: how long after sale until cash received
    """
    sales_cycle_days: int = 30
    payment_terms_days: int = 14


@dataclass(frozen=True)
class ConcentrationInputs:
    """
    Client concentration data collected in Screen 2C / baseline.
    top_client_share_pct : % of revenue from single largest client (0–100)
    client_count         : total number of active clients (0 = unknown)
    """
    top_client_share_pct: float = 0.0
    client_count: int = 0


@dataclass(frozen=True)
class MarketContextInputs:
    """
    External market context from the market-context-service (Screen 11).
    All fields are optional — if not provided, no adjustment is applied.

    wage_benchmark_low / high : typical labour cost range for sector
    sector_survival_indicator : 0.0 (very risky sector) – 1.0 (stable sector)
    demand_trend_index        : -1.0 (declining) – +1.0 (growing)
    """
    wage_benchmark_low: float | None = None
    wage_benchmark_high: float | None = None
    sector_survival_indicator: float | None = None   # 0.0–1.0
    demand_trend_index: float | None = None           # -1.0 to +1.0


# ---------------------------------------------------------------------------
# Reason codes (machine-readable)
# Maps to plain English in REASON_CODE_MESSAGES below.
# ---------------------------------------------------------------------------

class ReasonCode(str, Enum):
    # Unit economics
    MISSING_PRICE_OR_UNITS       = "MISSING_PRICE_OR_UNITS"
    PRICE_BELOW_VARIABLE_COST    = "PRICE_BELOW_VARIABLE_COST"
    LOW_CONTRIBUTION_MARGIN      = "LOW_CONTRIBUTION_MARGIN"

    # Break-even
    BREAK_EVEN_UNITS_ZERO        = "BREAK_EVEN_UNITS_ZERO"
    BREAK_EVEN_TOO_LONG          = "BREAK_EVEN_TOO_LONG"

    # Runway
    LOW_RUNWAY                   = "LOW_RUNWAY"

    # Capacity
    CAPACITY_MISMATCH            = "CAPACITY_MISMATCH"

    # Cash timing
    PAYMENT_TERMS_RISK           = "PAYMENT_TERMS_RISK"

    # Net surplus
    HIGH_FIXED_COST_DRAG         = "HIGH_FIXED_COST_DRAG"

    # Proof / market validation
    NO_MARKET_PROOF              = "NO_MARKET_PROOF"
    WEAK_MARKET_PROOF            = "WEAK_MARKET_PROOF"

    # Sales cycle
    SALES_CYCLE_RUNWAY_MISMATCH  = "SALES_CYCLE_RUNWAY_MISMATCH"
    LONG_SALES_CYCLE             = "LONG_SALES_CYCLE"

    # Client concentration
    HIGH_CLIENT_CONCENTRATION    = "HIGH_CLIENT_CONCENTRATION"
    SINGLE_CLIENT_DEPENDENCY     = "SINGLE_CLIENT_DEPENDENCY"

    # Market context advisory flags
    WAGE_ASSUMPTION_LOW          = "WAGE_ASSUMPTION_LOW"
    SECTOR_HIGH_VOLATILITY       = "SECTOR_HIGH_VOLATILITY"
    DEMAND_TREND_DECLINING       = "DEMAND_TREND_DECLINING"


# Plain English messages for each reason code (used by the UI).
# The engine also generates specific messages with numbers embedded,
# but these serve as fallback/tooltip text.
REASON_CODE_MESSAGES: dict[ReasonCode, str] = {
    ReasonCode.MISSING_PRICE_OR_UNITS:
        "Price per unit or units per month is not set — revenue cannot be calculated.",
    ReasonCode.PRICE_BELOW_VARIABLE_COST:
        "Price does not exceed variable cost — every unit sold makes a loss.",
    ReasonCode.LOW_CONTRIBUTION_MARGIN:
        "Contribution margin is below the 20% minimum viable threshold.",
    ReasonCode.BREAK_EVEN_UNITS_ZERO:
        "Break-even cannot be calculated because monthly units sold is zero.",
    ReasonCode.BREAK_EVEN_TOO_LONG:
        "Break-even takes longer than 12 months at current sales velocity.",
    ReasonCode.LOW_RUNWAY:
        "Cash runway is critically low — the business may run out of cash before break-even.",
    ReasonCode.CAPACITY_MISMATCH:
        "Team capacity cannot meet expected demand at current assumptions.",
    ReasonCode.PAYMENT_TERMS_RISK:
        "Long payment terms combined with low starting cash creates a cash flow gap.",
    ReasonCode.HIGH_FIXED_COST_DRAG:
        "Monthly net is negative despite positive margin — fixed costs are too high for current volume.",
    ReasonCode.NO_MARKET_PROOF:
        "No market validation evidence has been provided.",
    ReasonCode.WEAK_MARKET_PROOF:
        "Market validation evidence is informal only — no paying customers yet.",
    ReasonCode.SALES_CYCLE_RUNWAY_MISMATCH:
        "Sales cycle is longer than available runway — cash may run out before first sale closes.",
    ReasonCode.LONG_SALES_CYCLE:
        "Sales cycle exceeds 45 days, increasing early-stage cash flow risk.",
    ReasonCode.HIGH_CLIENT_CONCENTRATION:
        "Over 35% of revenue from a single client — losing them would be destabilising.",
    ReasonCode.SINGLE_CLIENT_DEPENDENCY:
        "Business depends on a single client for all revenue.",
    ReasonCode.WAGE_ASSUMPTION_LOW:
        "Variable cost assumption appears below typical market wage range for this sector.",
    ReasonCode.SECTOR_HIGH_VOLATILITY:
        "Sector survival indicators suggest above-average market volatility.",
    ReasonCode.DEMAND_TREND_DECLINING:
        "Market demand trend index is negative — sector demand may be contracting.",
}


# ---------------------------------------------------------------------------
# Core financial calculations
# ---------------------------------------------------------------------------

def calculate_revenue(inputs: FinancialInputs) -> float:
    return max(0.0, inputs.price_per_unit) * max(0.0, inputs.units_per_month)


def calculate_costs(inputs: FinancialInputs) -> float:
    variable = max(0.0, inputs.variable_cost_per_unit) * max(0.0, inputs.units_per_month)
    fixed = max(0.0, inputs.fixed_costs_monthly)
    return fixed + variable


def calculate_margin(inputs: FinancialInputs) -> float:
    revenue = calculate_revenue(inputs)
    costs = calculate_costs(inputs)
    if revenue <= 0:
        return 0.0
    return (revenue - costs) / revenue


def calculate_break_even_units(inputs: FinancialInputs) -> float | None:
    contribution = max(0.0, inputs.price_per_unit) - max(0.0, inputs.variable_cost_per_unit)
    if contribution <= 0:
        return None
    return max(0.0, inputs.fixed_costs_monthly) / contribution


def calculate_break_even_months(inputs: FinancialInputs) -> float | None:
    units_be = calculate_break_even_units(inputs)
    if units_be is None:
        return None
    units = max(0.0, inputs.units_per_month)
    if units <= 0:
        return None
    return units_be / units


def calculate_runway_months(inputs: FinancialInputs) -> float | None:
    revenue = calculate_revenue(inputs)
    costs = calculate_costs(inputs)
    burn = costs - revenue
    if burn <= 0:
        return None  # cashflow-positive = infinite runway
    cash = max(0.0, inputs.starting_cash)
    return cash / burn


def calculate_net_surplus(revenue_monthly: float, costs_monthly: float) -> float:
    return float(revenue_monthly) - float(costs_monthly)


def calculate_capacity(inputs: CapacityInputs) -> dict:
    demand = max(0.0, inputs.demand_units_per_month)
    team = max(1, int(inputs.team_size))
    per_person = max(0.0, inputs.capacity_units_per_person_per_month)
    capacity = per_person * team
    if capacity <= 0:
        return {
            "capacity_units_per_month": capacity,
            "demand_units_per_month": demand,
            "utilization": None,
            "feasible": None,
            "shortfall_units": None,
        }
    utilization = demand / capacity
    feasible = demand <= capacity
    shortfall = max(0.0, demand - capacity)
    return {
        "capacity_units_per_month": capacity,
        "demand_units_per_month": demand,
        "utilization": utilization,
        "feasible": feasible,
        "shortfall_units": shortfall,
    }


# ---------------------------------------------------------------------------
# Dimension scoring
# ---------------------------------------------------------------------------

def clamp_score(n: float) -> int:
    return int(max(0.0, min(100.0, n)))


def score_margin(margin: float) -> int:
    m = max(0.0, min(1.0, margin))
    if m >= 0.6:
        return 100
    if m >= 0.4:
        return 85
    if m >= 0.2:
        return 65
    if m >= 0.1:
        return 45
    return 25


def score_break_even(break_even_months: float | None) -> int:
    if break_even_months is None:
        return 20
    m = max(0.0, break_even_months)
    if m <= 3:
        return 100
    if m <= 6:
        return 85
    if m <= 12:
        return 65
    if m <= 18:
        return 45
    return 30


def score_runway(runway_months: float | None) -> int:
    if runway_months is None:
        return 100  # cashflow-positive
    r = max(0.0, runway_months)
    if r >= 12:
        return 90
    if r >= 6:
        return 70
    if r >= 3:
        return 50
    return 30


def score_capacity(capacity_result: dict | None) -> int:
    if not capacity_result or capacity_result.get("feasible") is None:
        return 60
    if capacity_result.get("feasible") is True:
        util = capacity_result.get("utilization")
        if isinstance(util, (int, float)) and util <= 0.7:
            return 100
        return 85
    util = capacity_result.get("utilization")
    if isinstance(util, (int, float)):
        if util >= 1.5:
            return 30
        return 45
    return 40


def score_cash_timing(
    *,
    payment_terms_days: int,
    starting_cash: float,
    costs_monthly: float,
) -> int:
    terms = max(0, int(payment_terms_days))
    cash = max(0.0, float(starting_cash))
    costs = max(0.0, float(costs_monthly))

    if terms <= 7:
        base = 95
    elif terms <= 14:
        base = 85
    elif terms <= 30:
        base = 70
    elif terms <= 60:
        base = 55
    else:
        base = 45

    if terms > 30 and costs > 0 and cash < costs:
        base = max(30, base - 20)

    return clamp_score(base)


def score_proof(proof: ProofInputs) -> int:
    """
    D7: Market validation evidence score.
    Scored on quality of proof level, boosted by proof count.

    none              → 10  (essentially unvalidated)
    informal_interest → 35  (people said they're interested, not paying)
    pilots            → 60  (non-paying pilots underway)
    paid_pilot        → 80  (someone has paid, even informally)
    signed_contract   → 100 (formal commitment)

    proof_count provides a small boost (capped at +10) to reward volume of signals.
    """
    base_scores = {
        ProofLevel.NONE: 10,
        ProofLevel.INFORMAL_INTEREST: 35,
        ProofLevel.PILOTS: 60,
        ProofLevel.PAID_PILOT: 80,
        ProofLevel.SIGNED_CONTRACT: 100,
    }
    base = base_scores.get(proof.proof_level, 10)
    count = max(0, int(proof.proof_count))
    # Small boost for volume: +2 per signal, capped at +10
    boost = min(10, count * 2)
    return clamp_score(base + boost)


def score_sales_cycle(
    *,
    sales_cycle_days: int,
    runway_months: float | None,
) -> int:
    """
    Sales cycle risk: how long until first revenue closes vs available runway.

    If runway is infinite (cashflow-positive), sales cycle is irrelevant to survival.
    If runway is finite, a long sales cycle relative to runway is dangerous.

    Standalone sales cycle penalty (regardless of runway):
      <= 14 days  → 100
      <= 30 days  → 85
      <= 45 days  → 70
      <= 90 days  → 50
      > 90 days   → 35

    Additional runway mismatch penalty if sales_cycle >= runway in days.
    """
    days = max(0, int(sales_cycle_days))

    if days <= 14:
        base = 100
    elif days <= 30:
        base = 85
    elif days <= 45:
        base = 70
    elif days <= 90:
        base = 50
    else:
        base = 35

    # Runway mismatch penalty
    if runway_months is not None:
        runway_days = runway_months * 30.0
        if days >= runway_days:
            # Sales cycle is longer than runway — severe penalty
            base = max(10, base - 40)
        elif days >= runway_days * 0.7:
            # Sales cycle consumes >70% of runway — moderate penalty
            base = max(20, base - 20)

    return clamp_score(base)


def score_concentration(concentration: ConcentrationInputs) -> int:
    """
    Client concentration risk.
    Based on HHI-inspired logic and the 35% single-client threshold from the spec.

      top_client_share == 0 or unknown  → 75 (neutral, no data)
      < 25%  → 100 (well diversified)
      25–35% → 80  (acceptable)
      35–50% → 60  (elevated risk)
      50–75% → 35  (high risk)
      > 75%  → 15  (critical dependency)

    client_count bonus: more clients = lower concentration risk.
    """
    share = max(0.0, min(100.0, float(concentration.top_client_share_pct)))
    count = max(0, int(concentration.client_count))

    if share <= 0:
        return 75  # unknown — neutral

    if share < 25:
        base = 100
    elif share < 35:
        base = 80
    elif share < 50:
        base = 60
    elif share < 75:
        base = 35
    else:
        base = 15

    # Slight boost if many clients (diversified book)
    if count >= 10:
        base = min(100, base + 10)
    elif count >= 5:
        base = min(100, base + 5)

    return clamp_score(base)


# ---------------------------------------------------------------------------
# Market context adjustment (±10% cap per spec)
# ---------------------------------------------------------------------------

def apply_market_context_adjustment(
    base_score: int,
    context: MarketContextInputs | None,
    variable_cost_per_unit: float,
) -> tuple[int, list[ReasonCode]]:
    """
    Apply capped ±10% adjustment from external market context signals.
    Returns (adjusted_score, advisory_flags).

    Per spec: context generates advisory flags and applies capped influence (±10%).
    It NEVER overwrites the founder's model — only nudges the final score.
    """
    if context is None:
        return base_score, []

    adjustment = 0.0
    advisory_flags: list[ReasonCode] = []

    # --- Wage benchmark check ---
    low = context.wage_benchmark_low
    high = context.wage_benchmark_high
    if low is not None and high is not None and variable_cost_per_unit > 0:
        if variable_cost_per_unit < low * 0.85:
            # Variable cost is suspiciously below market wage floor
            adjustment -= 3.0
            advisory_flags.append(ReasonCode.WAGE_ASSUMPTION_LOW)

    # --- Sector survival indicator ---
    survival = context.sector_survival_indicator
    if survival is not None:
        if survival < 0.3:
            adjustment -= 5.0
            advisory_flags.append(ReasonCode.SECTOR_HIGH_VOLATILITY)
        elif survival >= 0.7:
            adjustment += 3.0

    # --- Demand trend index ---
    trend = context.demand_trend_index
    if trend is not None:
        if trend < -0.3:
            adjustment -= 4.0
            advisory_flags.append(ReasonCode.DEMAND_TREND_DECLINING)
        elif trend > 0.3:
            adjustment += 3.0

    # Cap adjustment at ±10 points (per spec)
    adjustment = max(-10.0, min(10.0, adjustment))
    adjusted = clamp_score(base_score + adjustment)

    return adjusted, advisory_flags


# ---------------------------------------------------------------------------
# Dimension explanations (tooltip / sidebar text)
# ---------------------------------------------------------------------------

def explain_unit_economics(*, margin: float) -> str:
    m_pct = round(float(margin or 0.0) * 100.0, 1)
    if margin >= 0.6:
        band = ">= 60% (excellent)"
    elif margin >= 0.4:
        band = "40–59% (strong)"
    elif margin >= 0.2:
        band = "20–39% (minimum viable)"
    elif margin >= 0.1:
        band = "10–19% (weak)"
    else:
        band = "< 10% (very weak)"
    return f"Contribution margin is {m_pct}%, which falls in {band}."


def explain_break_even(*, break_even_months: float | None) -> str:
    if break_even_months is None:
        return (
            "Break-even is not reachable with current unit economics "
            "(typically price <= variable cost, or units/month is 0)."
        )
    m = round(float(break_even_months), 1)
    if m <= 3:
        band = "<= 3 months (excellent)"
    elif m <= 6:
        band = "4–6 months (strong)"
    elif m <= 12:
        band = "7–12 months (okay)"
    elif m <= 18:
        band = "13–18 months (weak)"
    else:
        band = "> 18 months (very weak)"
    return f"Break-even is {m} months, which falls in {band}."


def explain_runway(*, runway_months: float | None) -> str:
    if runway_months is None:
        return "Revenue >= costs (cashflow-positive). Runway is infinite — scores 100/100."
    r = round(float(runway_months), 1)
    if r >= 12:
        band = ">= 12 months (strong)"
    elif r >= 6:
        band = "6–11 months (okay)"
    elif r >= 3:
        band = "3–5 months (weak)"
    else:
        band = "< 3 months (very weak)"
    return f"Cash runway at current burn is {r} months, which falls in {band}."


def explain_capacity(*, capacity_result: dict | None) -> str:
    if not capacity_result or capacity_result.get("feasible") is None:
        return "Capacity inputs are missing. Defaulting to 60/100 (neutral)."
    feasible = capacity_result.get("feasible")
    util = capacity_result.get("utilization")
    util_pct = round(float(util) * 100.0, 1) if isinstance(util, (int, float)) else None
    if feasible is True:
        return f"Team utilisation is {util_pct}% — demand is within capacity." if util_pct else "Capacity is feasible."
    return (
        f"Team is overloaded at {util_pct}% utilisation — demand exceeds capacity."
        if util_pct
        else "Demand exceeds delivery capacity."
    )


def explain_cash_timing(*, payment_terms_days: int, starting_cash: float, costs_monthly: float) -> str:
    terms = int(payment_terms_days or 0)
    cash = float(starting_cash or 0.0)
    costs = float(costs_monthly or 0.0)
    if terms <= 7:
        band = "<= 7 days (excellent)"
    elif terms <= 14:
        band = "8–14 days (strong)"
    elif terms <= 30:
        band = "15–30 days (okay)"
    elif terms <= 60:
        band = "31–60 days (weak)"
    else:
        band = "> 60 days (very weak)"
    extra = ""
    if terms > 30 and costs > 0 and cash < costs:
        extra = " Starting cash is below one month of costs — a cash gap is likely."
    return f"Payment terms are {terms} days ({band}).{extra}"


def explain_proof(*, proof: ProofInputs) -> str:
    labels = {
        ProofLevel.NONE: "no evidence (scores very low)",
        ProofLevel.INFORMAL_INTEREST: "informal interest only — no paying customers",
        ProofLevel.PILOTS: "non-paying pilots underway",
        ProofLevel.PAID_PILOT: "at least one paying pilot — strong signal",
        ProofLevel.SIGNED_CONTRACT: "signed contract(s) — highest confidence",
    }
    label = labels.get(proof.proof_level, "unknown")
    count_note = f" ({proof.proof_count} signal(s) recorded)" if proof.proof_count > 0 else ""
    return f"Market validation is {label}{count_note}."


def explain_sales_cycle(*, sales_cycle_days: int, runway_months: float | None) -> str:
    days = int(sales_cycle_days)
    runway_note = ""
    if runway_months is not None:
        runway_days = round(runway_months * 30)
        if days >= runway_days:
            runway_note = f" This exceeds your {runway_days}-day runway — cash may run out before first sale."
        elif days >= runway_days * 0.7:
            runway_note = f" This consumes over 70% of your {runway_days}-day runway."
    return f"Sales cycle is {days} days.{runway_note}"


def explain_concentration(*, concentration: ConcentrationInputs) -> str:
    share = float(concentration.top_client_share_pct)
    count = int(concentration.client_count)
    if share <= 0:
        return "No client concentration data provided. Defaulting to neutral (75/100)."
    count_note = f" across {count} clients" if count > 0 else ""
    if share < 35:
        risk = "acceptable"
    elif share < 50:
        risk = "elevated — above the 35% safe threshold"
    else:
        risk = "high — single client dependency risk"
    return f"Top client represents {share}% of revenue{count_note} — concentration risk is {risk}."


# ---------------------------------------------------------------------------
# Insight generator — single source of truth, no duplicates
# ---------------------------------------------------------------------------

def _detect_root_cause(
    inputs: FinancialInputs,
    metrics: dict,
    ds: dict,
    capacity_result: dict | None,
    proof: ProofInputs,
    sales_cycle: SalesCycleInputs,
    concentration: ConcentrationInputs,
    advisory_flags: list[ReasonCode],
) -> tuple[list[str], list[str], list[ReasonCode]]:
    """
    Build non-overlapping reasons, recommendations, and reason_codes.

    Priority order:
      1. Unit economics (root cause first — suppresses downstream symptoms)
      2. Break-even
      3. Runway
      4. Capacity
      5. Cash timing
      6. Sales cycle risk
      7. Client concentration
      8. Market proof
      9. Net surplus (only if not already explained)
      10. Market context advisory flags (appended last, advisory only)
    """
    reasons: list[str] = []
    recs: list[str] = []
    codes: list[ReasonCode] = []

    revenue = metrics.get("revenue_monthly", 0.0)
    margin = metrics.get("margin", 0.0)
    runway = metrics.get("runway_months")
    breakeven = metrics.get("break_even_months")
    net = metrics.get("net_monthly", 0.0)

    price = max(0.0, inputs.price_per_unit)
    units = max(0.0, inputs.units_per_month)
    variable = max(0.0, inputs.variable_cost_per_unit)

    # ------------------------------------------------------------------
    # 1. Unit economics — detect root cause first
    # ------------------------------------------------------------------
    if price <= 0 or units <= 0:
        reasons.append(
            "Price per unit or units per month is not set — revenue cannot be calculated."
        )
        recs.append(
            "Enter a realistic price and expected monthly sales volume. "
            "All other scores depend on this."
        )
        codes.append(ReasonCode.MISSING_PRICE_OR_UNITS)
        # Everything else is downstream — return early
        _append_proof_insight(reasons, recs, codes, proof)
        _append_advisory_flags(reasons, recs, codes, advisory_flags)
        return reasons, recs, codes

    if price <= variable:
        reasons.append(
            f"Price (£{price:,.2f}) does not exceed variable cost per unit "
            f"(£{variable:,.2f}). Every unit sold makes a loss."
        )
        recs.append(
            f"Raise your price above variable cost. "
            f"Minimum viable price for a 20% margin is £{variable / 0.8:,.2f}."
        )
        codes.append(ReasonCode.PRICE_BELOW_VARIABLE_COST)
        # Break-even is a symptom — skip it

    elif ds["unit_economics"] < 65:
        m_pct = round(margin * 100, 1)
        reasons.append(
            f"Contribution margin is {m_pct}% — below the 20% minimum viable threshold."
        )
        recs.append(
            "Raise price, reduce variable costs, or both. "
            "Target at least 20% margin before scaling volume."
        )
        codes.append(ReasonCode.LOW_CONTRIBUTION_MARGIN)

    # ------------------------------------------------------------------
    # 2. Break-even — only fire if unit economics are structurally sound
    # ------------------------------------------------------------------
    if price > variable and breakeven is None:
        reasons.append(
            "Break-even cannot be calculated because monthly units sold is zero."
        )
        recs.append(
            "Set a realistic monthly units figure to compute your break-even timeline."
        )
        codes.append(ReasonCode.BREAK_EVEN_UNITS_ZERO)

    elif breakeven is not None and ds["break_even"] < 65:
        months = round(breakeven, 1)
        reasons.append(
            f"Break-even takes {months} months at current sales velocity — "
            "longer than the 12-month target."
        )
        recs.append(
            "Increase monthly sales volume, reduce fixed costs, or improve margin "
            "to reach break-even faster."
        )
        codes.append(ReasonCode.BREAK_EVEN_TOO_LONG)

    # ------------------------------------------------------------------
    # 3. Runway — only meaningful if actually burning cash
    # ------------------------------------------------------------------
    if runway is not None and ds["runway"] < 70:
        months = round(runway, 1)
        burn = round(metrics.get("costs_monthly", 0.0) - revenue, 2)
        reasons.append(
            f"Cash runway is {months} months at a monthly burn of £{burn:,.2f}."
        )
        recs.append(
            "Reduce fixed costs, increase starting cash, or accelerate revenue. "
            "Minimum safe runway before launch is 6 months."
        )
        codes.append(ReasonCode.LOW_RUNWAY)

    # ------------------------------------------------------------------
    # 4. Capacity
    # ------------------------------------------------------------------
    if capacity_result and capacity_result.get("feasible") is False:
        util = capacity_result.get("utilization", 0.0)
        util_pct = round(float(util) * 100, 1)
        shortfall = capacity_result.get("shortfall_units", 0.0)
        reasons.append(
            f"Team is overloaded at {util_pct}% utilisation — "
            f"{shortfall:,.0f} units/month cannot be delivered."
        )
        recs.append(
            "Add contractors, reduce your initial demand target, or raise price "
            "to lower the volume required to break even."
        )
        codes.append(ReasonCode.CAPACITY_MISMATCH)

    # ------------------------------------------------------------------
    # 5. Cash timing
    # ------------------------------------------------------------------
    if ds["cash_timing"] < 55:
        terms = sales_cycle.payment_terms_days
        reasons.append(
            f"Payment terms of {terms} days create a cash gap that starting cash cannot cover."
        )
        recs.append(
            "Require a deposit upfront, shorten terms to 14 days, "
            "or offer a small discount for immediate payment."
        )
        codes.append(ReasonCode.PAYMENT_TERMS_RISK)

    # ------------------------------------------------------------------
    # 6. Sales cycle risk
    # ------------------------------------------------------------------
    sc_days = sales_cycle.sales_cycle_days
    runway_days = (runway * 30.0) if runway is not None else None

    if runway is not None and runway_days is not None and sc_days >= runway_days:
        reasons.append(
            f"Sales cycle ({sc_days} days) is longer than your cash runway "
            f"({round(runway_days)} days) — you may run out of cash before closing your first sale."
        )
        recs.append(
            "Pursue faster-converting leads (referrals, warm introductions), "
            "reduce sales cycle length, or extend runway before launching."
        )
        codes.append(ReasonCode.SALES_CYCLE_RUNWAY_MISMATCH)

    elif sc_days > 45 and ReasonCode.SALES_CYCLE_RUNWAY_MISMATCH not in codes:
        reasons.append(
            f"Sales cycle of {sc_days} days increases early-stage cash flow risk."
        )
        recs.append(
            "Target faster-converting acquisition channels to shorten the sales cycle "
            "during the critical early months."
        )
        codes.append(ReasonCode.LONG_SALES_CYCLE)

    # ------------------------------------------------------------------
    # 7. Client concentration
    # ------------------------------------------------------------------
    share = float(concentration.top_client_share_pct)
    if share >= 75:
        reasons.append(
            f"Top client represents {share}% of projected revenue — "
            "the business cannot survive losing them."
        )
        recs.append(
            "Aggressively diversify: no single client should exceed 35% of revenue. "
            "Acquire at least 2–3 additional anchor clients before scaling."
        )
        codes.append(ReasonCode.SINGLE_CLIENT_DEPENDENCY)
    elif share >= 35:
        reasons.append(
            f"Top client represents {share}% of revenue — above the 35% safe threshold."
        )
        recs.append(
            "Reduce concentration by acquiring additional clients before over-investing "
            "in capacity or fixed costs tied to this client."
        )
        codes.append(ReasonCode.HIGH_CLIENT_CONCENTRATION)

    # ------------------------------------------------------------------
    # 8. Market proof
    # ------------------------------------------------------------------
    _append_proof_insight(reasons, recs, codes, proof)

    # ------------------------------------------------------------------
    # 9. Net surplus — only if not already explained by unit economics
    # ------------------------------------------------------------------
    if (
        net < 0
        and revenue > 0
        and price > variable
        and ds["unit_economics"] >= 65
        and ReasonCode.LOW_RUNWAY not in codes
    ):
        fixed = metrics.get("costs_monthly", 0.0) - (variable * units)
        reasons.append(
            f"Monthly net is £{net:,.2f} — positive margin but fixed costs "
            f"(£{fixed:,.2f}/mo) are too high relative to current volume."
        )
        recs.append(
            "Audit fixed costs for deferrable items, or increase sales volume "
            "to spread fixed costs across more units."
        )
        codes.append(ReasonCode.HIGH_FIXED_COST_DRAG)

    # ------------------------------------------------------------------
    # 10. Market context advisory flags (appended last — advisory only)
    # ------------------------------------------------------------------
    _append_advisory_flags(reasons, recs, codes, advisory_flags)

    return reasons, recs, codes


def _append_proof_insight(
    reasons: list[str],
    recs: list[str],
    codes: list[ReasonCode],
    proof: ProofInputs,
) -> None:
    if proof.proof_level == ProofLevel.NONE:
        reasons.append(
            "No market validation evidence provided — demand is entirely assumed."
        )
        recs.append(
            "Gather at least informal signals before launch: "
            "offer a paid pilot, collect letters of intent, or run 5 discovery calls."
        )
        codes.append(ReasonCode.NO_MARKET_PROOF)
    elif proof.proof_level == ProofLevel.INFORMAL_INTEREST:
        reasons.append(
            "Market validation is based on informal interest only — no paying customers yet."
        )
        recs.append(
            "Convert informal interest into a paid pilot or letter of intent "
            "to de-risk the demand assumption."
        )
        codes.append(ReasonCode.WEAK_MARKET_PROOF)


def _append_advisory_flags(
    reasons: list[str],
    recs: list[str],
    codes: list[ReasonCode],
    advisory_flags: list[ReasonCode],
) -> None:
    """Append market context advisories as clearly labelled advisory notes."""
    for flag in advisory_flags:
        if flag == ReasonCode.WAGE_ASSUMPTION_LOW:
            reasons.append(
                "[Market context advisory] Variable cost appears below typical market "
                "wage range for this sector — your labour cost assumption may be unrealistic."
            )
            recs.append(
                "Review labour cost assumptions against sector benchmarks "
                "to ensure your margin projection is realistic."
            )
            codes.append(ReasonCode.WAGE_ASSUMPTION_LOW)

        elif flag == ReasonCode.SECTOR_HIGH_VOLATILITY:
            reasons.append(
                "[Market context advisory] Sector survival indicators suggest "
                "above-average market volatility for this industry."
            )
            recs.append(
                "Maintain a higher cash buffer than the minimum 6-month target "
                "to absorb sector-level volatility."
            )
            codes.append(ReasonCode.SECTOR_HIGH_VOLATILITY)

        elif flag == ReasonCode.DEMAND_TREND_DECLINING:
            reasons.append(
                "[Market context advisory] Market demand trend index is negative — "
                "sector demand may be contracting."
            )
            recs.append(
                "Validate demand assumptions against recent market data "
                "before committing to fixed costs or hiring."
            )
            codes.append(ReasonCode.DEMAND_TREND_DECLINING)


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

def classify(score: int) -> str:
    if score >= 80:
        return "STRONG"
    if score >= 60:
        return "PROMISING"
    if score >= 40:
        return "RISKY"
    return "WEAK"


# ---------------------------------------------------------------------------
# Main evaluation function
# ---------------------------------------------------------------------------

def evaluate_viability_v3(
    inputs: FinancialInputs,
    *,
    payment_terms_days: int = 14,
    sales_cycle_days: int = 30,
    capacity: CapacityInputs | None = None,
    proof: ProofInputs | None = None,
    sales_cycle: SalesCycleInputs | None = None,
    concentration: ConcentrationInputs | None = None,
    market_context: MarketContextInputs | None = None,
    market_fit_score: int | None = None,
) -> dict:
    """
    Evaluate business viability from deterministic financial inputs.

    Parameters
    ----------
    inputs            : core financial inputs (price, units, costs, cash)
    payment_terms_days: days until cash received after sale (default 14)
    sales_cycle_days  : days from lead to closed sale (default 30)
    capacity          : optional capacity inputs (team size, capacity per person)
    proof             : optional market validation evidence
    sales_cycle       : optional sales cycle + payment terms (overrides bare params)
    concentration     : optional client concentration data
    market_context    : optional external market context (wage benchmarks, sector signals)
    market_fit_score  : optional Market Fit score (0–100) from market_fit_service. When supplied,
                        it is included as a weighted dimension (10%) and other weights scale down.

    Returns
    -------
    dict with:
        metrics                — computed financial figures
        score                  — weighted 0-100 validation score (after market context)
        score_pre_context      — score before market context adjustment
        classification         — STRONG / PROMISING / RISKY / WEAK
        reasons                — non-overlapping plain English problem statements
        recommendations        — specific actions (1-to-1 with reasons)
        reason_codes           — machine-readable ReasonCode list (for frontend routing)
        advisory_flags         — market context advisory ReasonCodes
        flags                  — broader machine-readable risk identifiers
        dimension_scores       — per-dimension 0-100 scores
        dimension_explanations — human-readable tooltip text per dimension
        validation_explanation — description of the scoring formula
        rubric_version         — engine version string
    """
    # Normalise optional inputs
    proof = proof or ProofInputs()
    concentration = concentration or ConcentrationInputs()
    if sales_cycle is not None:
        sc = sales_cycle
    else:
        sc = SalesCycleInputs(
            sales_cycle_days=sales_cycle_days,
            payment_terms_days=payment_terms_days,
        )

    # ------------------------------------------------------------------
    # Compute core metrics
    # ------------------------------------------------------------------
    revenue = calculate_revenue(inputs)
    costs = calculate_costs(inputs)
    margin = calculate_margin(inputs)
    break_even_months = calculate_break_even_months(inputs)
    runway_months = calculate_runway_months(inputs)
    net = calculate_net_surplus(revenue, costs)

    capacity_result = calculate_capacity(capacity) if capacity else None

    metrics: dict = {
        "revenue_monthly": revenue,
        "costs_monthly": costs,
        "margin": margin,
        "break_even_months": break_even_months,
        "runway_months": runway_months,
        "net_monthly": net,
        "payment_terms_days": sc.payment_terms_days,
        "sales_cycle_days": sc.sales_cycle_days,
    }
    if capacity_result:
        metrics["capacity"] = capacity_result

    # ------------------------------------------------------------------
    # Dimension scores
    # ------------------------------------------------------------------
    ds = {
        "unit_economics": score_margin(margin),
        "break_even": score_break_even(break_even_months),
        "runway": score_runway(runway_months),
        "capacity": score_capacity(capacity_result),
        "cash_timing": score_cash_timing(
            payment_terms_days=sc.payment_terms_days,
            starting_cash=float(inputs.starting_cash),
            costs_monthly=costs,
        ),
        "proof": score_proof(proof),
        "sales_cycle": score_sales_cycle(
            sales_cycle_days=sc.sales_cycle_days,
            runway_months=runway_months,
        ),
        "concentration": score_concentration(concentration),
    }

    # ------------------------------------------------------------------
    # Weighted total (rubric v0.2)
    #
    # Weights deliberately sum to 1.0.
    # Proof is weighted meaningfully — an unvalidated idea with great
    # unit economics is still fundamentally riskier than one with
    # signed contracts.
    # ------------------------------------------------------------------
    if market_fit_score is not None:
        ds["market_fit"] = clamp_score(float(market_fit_score))

    if "market_fit" in ds:
        base_weights = {
            "unit_economics": 0.25,
            "break_even":     0.15,
            "runway":         0.15,
            "capacity":       0.15,
            "cash_timing":    0.08,
            "proof":          0.12,
            "sales_cycle":    0.05,
            "concentration":  0.05,
        }
        weights = {k: v * 0.90 for k, v in base_weights.items()}
        weights["market_fit"] = 0.10
    else:
        weights = {
            "unit_economics": 0.25,
            "break_even":     0.15,
            "runway":         0.15,
            "capacity":       0.15,
            "cash_timing":    0.08,
            "proof":          0.12,
            "sales_cycle":    0.05,
            "concentration":  0.05,
        }

    score_pre_context = clamp_score(sum(weights[k] * ds[k] for k in weights))

    # ------------------------------------------------------------------
    # Apply market context adjustment (±10 cap)
    # ------------------------------------------------------------------
    score, advisory_flags = apply_market_context_adjustment(
        score_pre_context,
        market_context,
        float(inputs.variable_cost_per_unit),
    )

    # ------------------------------------------------------------------
    # Dimension explanations
    # ------------------------------------------------------------------
    dimension_explanations = {
        "unit_economics": explain_unit_economics(margin=margin),
        "break_even": explain_break_even(break_even_months=break_even_months),
        "runway": explain_runway(runway_months=runway_months),
        "capacity": explain_capacity(capacity_result=capacity_result),
        "cash_timing": explain_cash_timing(
            payment_terms_days=sc.payment_terms_days,
            starting_cash=float(inputs.starting_cash),
            costs_monthly=costs,
        ),
        "proof": explain_proof(proof=proof),
        "sales_cycle": explain_sales_cycle(
            sales_cycle_days=sc.sales_cycle_days,
            runway_months=runway_months,
        ),
        "concentration": explain_concentration(concentration=concentration),
    }

    validation_explanation = (
        "Validation score is a weighted average of 8 dimensions (0–100): "
        "25% Unit economics + 15% Break-even + 15% Runway + 15% Capacity + "
        "12% Market proof + 8% Cash timing + 5% Sales cycle + 5% Client concentration. "
        "An optional ±10% market context adjustment is applied based on sector benchmarks."
    )

    # Override explanation when market-fit is present (rubric v0.3)
    if "market_fit" in ds:
        dimension_explanations["market_fit"] = "Deterministic composite of demand trend, sector survival, and local competition."
        validation_explanation = (
            "Validation score is a weighted average of 9 dimensions (0–100): "
            "22.5% Unit economics + 13.5% Break-even + 13.5% Runway + 13.5% Capacity + "
            "10.8% Market proof + 10% Market fit + 7.2% Cash timing + 4.5% Sales cycle + 4.5% Concentration. "
            "An optional ±10% market context adjustment is applied based on sector benchmarks."
        )

    # ------------------------------------------------------------------
    # Flags (machine-readable, for UI badges / conditional rendering)
    # ------------------------------------------------------------------
    flags: list[str] = []
    if ds["unit_economics"] < 50:
        flags.append("unit_economics_risk")
    if ds["break_even"] < 50:
        flags.append("break_even_risk")
    if ds["runway"] < 50:
        flags.append("low_runway")
    if ds["capacity"] < 60:
        flags.append("capacity_risk")
    if ds["cash_timing"] < 55:
        flags.append("payment_terms_risk")
    if ds["proof"] < 40:
        flags.append("unvalidated_demand")
    if ds["sales_cycle"] < 50:
        flags.append("sales_cycle_risk")
    if ds["concentration"] < 60:
        flags.append("concentration_risk")
    if "market_fit" in ds and ds["market_fit"] < 40:
        flags.append("weak_market_fit")
    if net < 0:
        flags.append("negative_net")

    # ------------------------------------------------------------------
    # Insights — single source of truth
    # ------------------------------------------------------------------
    reasons, recs, reason_codes = _detect_root_cause(
        inputs, metrics, ds, capacity_result,
        proof, sc, concentration, advisory_flags,
    )

    return {
        "metrics": metrics,
        "score": score,
        "score_pre_context": score_pre_context,
        "classification": classify(score),
        "reasons": reasons,
        "recommendations": recs,
        "reason_codes": [c.value for c in reason_codes],
        "advisory_flags": [c.value for c in advisory_flags],
        "flags": sorted(set(flags)),
        "dimension_scores": ds,
        "dimension_explanations": dimension_explanations,
        "validation_explanation": validation_explanation,
        "rubric_version": "v0.3",
    }
