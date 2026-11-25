"""Validate user supplied scenario inputs before any calculation or persistence."""
import math


def validate_parameters(params, *, timeline=None):
    params = dict(params or {})
    months = params.get("timeline_months", timeline if timeline is not None else 6)

    def number(key, value, low, high=None, integer=False):
        label = key.replace("_", " ")
        allowed = f"{low} to {high}" if high is not None else f"{low} or more"
        try:
            n = float(value) if value is not None and not isinstance(value, bool) and str(value).strip() else float("nan")
        except (ValueError, TypeError):
            n = float("nan")
        if not math.isfinite(n) or n < low or (high is not None and n > high) or (integer and not n.is_integer()):
            raise ValueError(f"{label.capitalize()} must be {'a whole number from ' if integer else ''}{allowed}.")
        return int(n) if integer else n

    months = int(number("timeline_months", months, 3, 24, True))
    if timeline is not None and months != timeline:
        raise ValueError(f"Each combined change must use the overall timeline of {timeline} months.")
    params["timeline_months"] = months
    for key, value in params.items():
        if key == "timeline_months":
            continue
        if key == "steps":
            from app.modules.scenario_intelligence.projection import COMBINABLE
            if not isinstance(value, list) or not 1 <= len(value) <= 5:
                raise ValueError("Combined changes must contain 1 to 5 steps.")
            for step in value:
                if not isinstance(step, dict) or step.get("scenario_type") not in COMBINABLE:
                    raise ValueError("Each combined change must name a supported scenario type.")
                step["params"] = validate_parameters(step.get("params") or {}, timeline=months)
        elif key == "cost_classification":
            if value not in ("operating", "direct"):
                raise ValueError("Cost classification must be operating or direct.")
        elif key == "price_change_pct":
            params[key] = number(key, value, -50, 200)
        elif key.endswith("_pct"):
            params[key] = number(key, value, 0, 100)
        elif key == "employee_count":
            params[key] = number(key, value, 1, 100, True)
        elif key == "loan_term_months":
            params[key] = number(key, value, 1, 360, True)
        elif key.endswith("_month") or key in ("delay_months", "ramp_months"):
            params[key] = number(key, value, 1, months, True)
        elif key.endswith("_months"):
            params[key] = number(key, value, 1, 360, True)
        elif key == "price_sensitivity":
            params[key] = number(key, value, 0)
        elif any(part in key for part in ("amount", "cost", "monthly", "per_hire")) and key not in ("cost_classification",):
            params[key] = number(key, value, 0)
    return params


def validate_settings(state, months):
    # Every dated event must fall within the requested horizon; validate the dictionaries too.
    validate_parameters({"timeline_months": months, **({"tax_payment_month": state.tax_payment_month} if state.tax_payment_month is not None else {})})
    for group in (state.funding_events, state.dividends, state.capital_purchases):
        for event in group:
            validate_parameters({"timeline_months": months, "event_amount": event.get("amount"), "event_month": event.get("month", 1)})
