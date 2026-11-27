"""Agent access to the shared dated currency converter; never supplies a guessed rate."""
import math
import re

def display_money(amount, currency):
    from app.modules.agent.research import SIGNS
    text = f"{float(amount):,.2f}"
    if text.endswith(".00"):
        text = text[:-3]
    return f"{SIGNS.get(currency, str(currency) + ' ')}{text}"

async def quote(amount, from_currency, to_currency):
    from app.shared.currency import get_rate_dated, convert
    source, target = str(from_currency or "").upper(), str(to_currency or "").upper()
    if not re.fullmatch(r"[A-Z]{3}", source) or not re.fullmatch(r"[A-Z]{3}", target):
        return {"available":False,"error":"Identify the source and destination currencies first."}
    try:
        value = float(amount)
    except (ValueError, TypeError):
        value = float("nan")
    if not math.isfinite(value) or value < 0:
        return {"available":False,"error":"Give a valid non-negative amount to convert."}
    try:
        dated = await get_rate_dated(source, target)
        rate = float((dated or {}).get("rate") or 0)
    except Exception:
        dated, rate = None, 0
    if not math.isfinite(rate) or rate <= 0 or not (dated or {}).get("date"):
        return {"available":False,"error":"The exchange-rate service is unavailable. Offer to retry or use a rate supplied by the owner; do not guess."}
    return {"available":True,"original_amount":value,"from_currency":source,"to_currency":target,
            "converted_amount":convert(value,rate),"rate":rate,"date":dated["date"],"source":dated.get("source"),"saved":False}
