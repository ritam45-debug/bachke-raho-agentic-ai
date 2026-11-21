"""Deterministic inventory calculations. These are formulas, not AI output, and are unit-tested."""
from __future__ import annotations

import math


def days_of_cover(on_hand: float, avg_daily_demand: float) -> float | None:
    """Days the current stock lasts at average demand. None when there is no demand (infinite cover)."""
    if avg_daily_demand <= 0:
        return None
    return on_hand / avg_daily_demand


def reorder_point(avg_daily_demand: float, lead_time_days: float, safety_stock: float) -> float:
    """ROP = demand during lead time + safety stock."""
    return avg_daily_demand * lead_time_days + safety_stock


def safety_stock(z: float, demand_std_daily: float, lead_time_days: float) -> float:
    """Classic SS = z · σ_d · √L (demand variability only; lead-time variability added in Phase 3)."""
    return z * demand_std_daily * math.sqrt(max(lead_time_days, 0))


def stock_status(on_hand: float, rop: float, ss: float, avg_daily_demand: float, lead_time_days: float) -> str:
    """Rule-based status band. This is a classification rule, not a probability of stockout."""
    if on_hand <= 0:
        return "stockout"
    cover = days_of_cover(on_hand, avg_daily_demand)
    if on_hand <= ss or (cover is not None and cover < lead_time_days):
        return "critical"
    if on_hand <= rop:
        return "reorder"
    if cover is not None and cover > 4 * max(lead_time_days, 1) and cover > 120:
        return "excess"
    return "healthy"
