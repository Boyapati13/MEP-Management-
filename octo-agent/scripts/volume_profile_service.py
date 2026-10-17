#!/usr/bin/env python3
"""
Whale Suite — Live Volume Profile Background Service
=====================================================
Runs as a background daemon thread (or standalone process).

Every REFRESH_INTERVAL_SECS it:
  1. Connects to MetaTrader 5 (or reuses existing connection)
  2. Fetches M15 candles for every tracked symbol
  3. Computes full Volume Profile: POC, VAH, VAL, HVN list, LVN list
  4. Computes Whale Dynamic Alpha (volatility-adaptive RSI smoothing factor)
  5. Determines price bias relative to POC / Value Area
  6. Detects FVG (Fair Value Gap) proximity and PDH/PDL sweep status
  7. Writes all results to SIGNAL_PATH (volume_profile_live.json)

This JSON is then read by:
  - ChatWidget.update_live_context() to inject into OCTO's system prompt
  - Mt5Page dashboard to display live VP levels in the AI suggestions panel
"""

import os
import sys
import json
import time
import threading
import numpy as np
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
REFRESH_INTERVAL_SECS = 30          # How often to recalculate (seconds)
M15_LOOKBACK_BARS     = 200         # How many M15 bars to use for VP calculation
D1_LOOKBACK_BARS      = 10          # Daily bars for PDH/PDL
VP_BINS               = 50          # Number of price bins for the histogram
VALUE_AREA_PCT        = 0.70        # Standard 70% Value Area
HVN_THRESHOLD_PCT     = 0.80        # Bins above this % of POC volume = HVN
LVN_THRESHOLD_PCT     = 0.20        # Bins below this % of POC volume = LVN
WHALE_ATR_PERIOD      = 14          # ATR period for dynamic alpha
WHALE_SENSITIVITY     = 2.0         # Dynamic alpha sensitivity exponent (S)
FVG_MIN_GAP_MULT      = 1.5         # FVG must be >= this x ATR to be significant

# Where to write the live signal
SIGNAL_PATH = Path(__file__).resolve().parent / "volume_profile_live.json"

# Portfolio symbols (with broker suffix variants handled automatically)
SYMBOLS = [
    "NAS100",
    "XAUUSD+",
    "XAUEUR+",
    "EURUSD+",
    "GBPUSD+",
    "USDJPY+",
    "AUDUSD+",
    "BTCUSD",
    "CL-OIL",
]

# ── Volume Profile Core ───────────────────────────────────────────────────────
def calc_poc_and_va(bins, n_bins, min_p, step):
    """Calculates POC, VAH, VAL from volume bins using standard 70% Value Area algorithm."""
    if n_bins <= 0 or step <= 0:
        return 0.0, 0.0, 0.0, 0

    max_vol = -1.0
    poc_bin = 0
    for i in range(n_bins):
        if bins[i] > max_vol:
            max_vol = bins[i]
            poc_bin = i

    poc = min_p + step * poc_bin + step * 0.5
    total_vol = sum(bins)
    if max_vol <= 0.0 or total_vol <= 0.0:
        return poc, poc, poc, poc_bin

    target = total_vol * VALUE_AREA_PCT
    accumulated = bins[poc_bin]
    hi_idx = poc_bin
    lo_idx = poc_bin

    while accumulated < target:
        can_up = (hi_idx + 1 < n_bins)
        can_dn = (lo_idx - 1 >= 0)
        if not can_up and not can_dn:
            break
        up_vol = bins[hi_idx + 1] if can_up else 0.0
        dn_vol = bins[lo_idx - 1] if can_dn else 0.0
        if can_up and (not can_dn or up_vol >= dn_vol):
            hi_idx += 1
            accumulated += up_vol
        else:
            lo_idx -= 1
            accumulated += dn_vol

    vah = min_p + step * (hi_idx + 1)
    val = min_p + step * lo_idx
    return poc, vah, val, poc_bin


def calc_hvn_lvn(bins, n_bins, min_p, step, poc_vol):
    """Returns lists of HVN and LVN price levels relative to POC volume."""
    hvns = []
    lvns = []
    for i in range(n_bins):
        price = min_p + step * i + step * 0.5
        ratio = bins[i] / poc_vol if poc_vol > 0 else 0
        if ratio >= HVN_THRESHOLD_PCT:
            hvns.append(round(price, 5))
        elif ratio <= LVN_THRESHOLD_PCT and bins[i] > 0:
            lvns.append(round(price, 5))
    return hvns, lvns


def calc_whale_dynamic_alpha(highs, lows, closes, atr_period=WHALE_ATR_PERIOD, sensitivity=WHALE_SENSITIVITY):
    """
    Computes the Whale dynamic alpha for the most recent bar.
    alpha_t = Max(0.01, Min(0.99, (1/P) * (VR_t ^ S)))
    where VR_t = TR_t / ATR_t (True Range to Average True Range)
    """
    n = len(closes)
    if n < atr_period + 2:
        return 0.5, 1.0  # fallback

    tr = np.zeros(n)
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i],
                    abs(highs[i] - closes[i-1]),
                    abs(lows[i] - closes[i-1]))

    # Wilder's smoothed ATR
    atr = np.zeros(n)
    atr[atr_period - 1] = np.mean(tr[:atr_period])
    for i in range(atr_period, n):
        atr[i] = (atr[i-1] * (atr_period - 1) + tr[i]) / atr_period

    last_tr  = tr[-1]
    last_atr = atr[-1] if atr[-1] > 0 else 1e-9
    vr = last_tr / last_atr
    alpha = max(0.01, min(0.99, (1.0 / atr_period) * (vr ** sensitivity)))
    return round(alpha, 4), round(vr, 3)


def detect_fvg(candles):
    """
    Detects the most recent Fair Value Gap (FVG / imbalance) in the last N bars.
    FVG: gap between candle[i-2].high and candle[i].low  (bullish)
      or gap between candle[i-2].low and candle[i].high  (bearish)
    """
    fvgs = []
    for i in range(2, len(candles)):
        c0 = candles[i-2]
        c2 = candles[i]
        # Bullish FVG: c0.high < c2.low  (gap up)
        if c0["high"] < c2["low"]:
            fvgs.append({
                "type": "BULLISH",
                "top": round(c2["low"], 5),
                "bottom": round(c0["high"], 5),
                "midpoint": round((c2["low"] + c0["high"]) / 2, 5),
                "time": c2["time"].isoformat()
            })
        # Bearish FVG: c0.low > c2.high  (gap down)
        elif c0["low"] > c2["high"]:
            fvgs.append({
                "type": "BEARISH",
                "top": round(c0["low"], 5),
                "bottom": round(c2["high"], 5),
                "midpoint": round((c0["low"] + c2["high"]) / 2, 5),
                "time": c2["time"].isoformat()
            })

    # Return only the 3 most recent
    return fvgs[-3:] if len(fvgs) >= 3 else fvgs


def compute_volume_profile(symbol_data: dict) -> dict:
    """Full VP computation on a symbol's candle dict."""
    candles = symbol_data["candles"]
    if len(candles) < 50:
        return {"error": "Insufficient candles"}

    closes  = np.array([c["close"] for c in candles])
    highs   = np.array([c["high"]  for c in candles])
    lows    = np.array([c["low"]   for c in candles])
    volumes = np.array([c["volume"] for c in candles])

    min_p = float(lows.min())
    max_p = float(highs.max())
    step  = max(max_p - min_p, 1e-6) / VP_BINS

    # Build bins: accumulate tick_volume at each price level
    bins = np.zeros(VP_BINS)
    for c in candles:
        lo, hi, vol = c["low"], c["high"], c["volume"]
        b_lo = int((lo - min_p) / step)
        b_hi = int((hi - min_p) / step)
        b_lo = max(0, min(VP_BINS - 1, b_lo))
        b_hi = max(0, min(VP_BINS - 1, b_hi))
        span = max(1, b_hi - b_lo + 1)
        per_bin = vol / span
        for b in range(b_lo, b_hi + 1):
            bins[b] += per_bin

    poc, vah, val, poc_bin = calc_poc_and_va(bins.tolist(), VP_BINS, min_p, step)
    poc_vol = bins[poc_bin]
    hvns, lvns = calc_hvn_lvn(bins.tolist(), VP_BINS, min_p, step, poc_vol)

    # Current price & bias
    current_price = candles[-1]["close"]
    current_high  = candles[-1]["high"]
    current_low   = candles[-1]["low"]
    spread_pos    = (current_price - val) / (vah - val) * 100 if (vah - val) > 0 else 50.0

    if current_price > vah:
        bias = "ABOVE_VAH (bullish auction — price seeking higher value)"
    elif current_price < val:
        bias = "BELOW_VAL (bearish auction — price seeking lower value)"
    elif current_price > poc:
        bias = "INSIDE_VA_ABOVE_POC (buyers in control within accepted value)"
    else:
        bias = "INSIDE_VA_BELOW_POC (sellers in control within accepted value)"

    poc_distance_pts = abs(current_price - poc)

    # Whale dynamic alpha
    alpha, vr = calc_whale_dynamic_alpha(highs, lows, closes)
    if alpha > 0.70:
        alpha_state = "CLIMAX/SPIKE — institutional absorption active"
    elif alpha > 0.40:
        alpha_state = "ELEVATED — trending momentum"
    else:
        alpha_state = "LOW — consolidation / noise filtering"

    # FVGs
    fvgs = detect_fvg(candles[-30:])  # check last 30 bars

    # PDH / PDL
    pdh = symbol_data.get("pdh", current_high)
    pdl = symbol_data.get("pdl", current_low)
    near_pdh = abs(current_high - pdh) <= step * 3
    near_pdl = abs(current_low - pdl) <= step * 3

    # Volume trend (last bar vs. 10-bar avg)
    avg_vol_10 = float(np.mean(volumes[-11:-1])) if len(volumes) > 10 else float(volumes.mean())
    last_vol   = float(volumes[-1])
    vol_ratio  = last_vol / avg_vol_10 if avg_vol_10 > 0 else 1.0

    return {
        "symbol": symbol_data["symbol"],
        "timeframe": "M15",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "bars_used": len(candles),
        "current_price": round(current_price, 5),
        "poc": round(poc, 5),
        "vah": round(vah, 5),
        "val": round(val, 5),
        "poc_distance_pts": round(poc_distance_pts, 5),
        "value_area_position_pct": round(spread_pos, 1),
        "bias": bias,
        "hvn_levels": hvns[-5:],   # top 5 closest HVN
        "lvn_levels": lvns[-5:],   # top 5 closest LVN
        "fvg_recent": fvgs,
        "pdh": round(pdh, 5),
        "pdl": round(pdl, 5),
        "near_pdh": near_pdh,
        "near_pdl": near_pdl,
        "whale": {
            "dynamic_alpha": alpha,
            "volatility_ratio_vr": vr,
            "state": alpha_state,
        },
        "volume": {
            "last_bar": round(last_vol, 0),
            "avg_10bar": round(avg_vol_10, 0),
            "ratio_vs_avg": round(vol_ratio, 2),
            "high_volume_spike": vol_ratio >= 1.5,
        }
    }


# ── MT5 Data Fetcher ──────────────────────────────────────────────────────────
def _resolve_symbol(sym: str):
    """Try symbol as-is, then without + suffix, then with + suffix."""
    import MetaTrader5 as mt5
    for candidate in [sym, sym.replace("+", ""), sym + "+"]:
        if mt5.symbol_info(candidate) is not None:
            mt5.symbol_select(candidate, True)
            return candidate
    return None


def fetch_all_symbols():
    """Initialize MT5 (if needed) and fetch candles for all symbols."""
    try:
        import MetaTrader5 as mt5
    except ImportError:
        return None, "MetaTrader5 package not installed"

    if not mt5.initialize():
        import os
        exe_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
        if os.path.exists(exe_path) and mt5.initialize(path=exe_path):
            pass
        else:
            return None, f"MT5 init failed: {mt5.last_error()}"

    results = {}
    errors  = []

    for sym in SYMBOLS:
        try:
            real_sym = _resolve_symbol(sym)
            if real_sym is None:
                errors.append(f"{sym}: not found")
                continue

            # M15 candles
            m15 = mt5.copy_rates_from_pos(real_sym, mt5.TIMEFRAME_M15, 0, M15_LOOKBACK_BARS + 10)
            if m15 is None or len(m15) < 50:
                errors.append(f"{sym}: M15 empty")
                continue

            candles = []
            for r in m15[-M15_LOOKBACK_BARS:]:
                candles.append({
                    "time":   datetime.fromtimestamp(int(r["time"]), tz=timezone.utc),
                    "open":   float(r["open"]),
                    "high":   float(r["high"]),
                    "low":    float(r["low"]),
                    "close":  float(r["close"]),
                    "volume": int(r["tick_volume"]),
                })

            # D1 for PDH/PDL
            d1 = mt5.copy_rates_from_pos(real_sym, mt5.TIMEFRAME_D1, 0, D1_LOOKBACK_BARS)
            pdh = float(d1[-2]["high"]) if d1 is not None and len(d1) >= 2 else candles[-1]["high"]
            pdl = float(d1[-2]["low"])  if d1 is not None and len(d1) >= 2 else candles[-1]["low"]

            results[sym] = {
                "symbol":  real_sym,
                "candles": candles,
                "pdh":     pdh,
                "pdl":     pdl,
            }

        except Exception as e:
            errors.append(f"{sym}: {e}")

    return results, errors


# ── Main Service Loop ─────────────────────────────────────────────────────────
_service_running = False
_service_thread  = None

def run_once():
    """Run a single VP refresh cycle. Returns the JSON dict written."""
    symbol_data, errors = fetch_all_symbols()
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "refresh_interval_secs": REFRESH_INTERVAL_SECS,
        "symbols": {},
        "errors": errors if errors else []
    }

    if symbol_data:
        for sym_key, sd in symbol_data.items():
            try:
                vp = compute_volume_profile(sd)
                output["symbols"][sym_key] = vp
            except Exception as e:
                output["symbols"][sym_key] = {"error": str(e)}

    # Atomic write
    tmp = SIGNAL_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, default=str)
    tmp.replace(SIGNAL_PATH)

    return output


def _service_loop():
    global _service_running
    print(f"[VP Service] Started. Refresh every {REFRESH_INTERVAL_SECS}s → {SIGNAL_PATH}")
    while _service_running:
        try:
            t0 = time.time()
            out = run_once()
            n_ok = sum(1 for v in out["symbols"].values() if "error" not in v)
            print(f"[VP Service] Refreshed {n_ok}/{len(SYMBOLS)} symbols @ {out['generated_at']}")
        except Exception as e:
            print(f"[VP Service] ERROR: {e}")
        elapsed = time.time() - t0
        sleep_s = max(1.0, REFRESH_INTERVAL_SECS - elapsed)
        time.sleep(sleep_s)
    print("[VP Service] Stopped.")


def start_background():
    """Start the VP service in a background daemon thread. Safe to call multiple times."""
    global _service_running, _service_thread
    if _service_running and _service_thread and _service_thread.is_alive():
        return  # Already running

    _service_running = True
    _service_thread = threading.Thread(target=_service_loop, daemon=True, name="VolumeProfileService")
    _service_thread.start()


def stop_background():
    global _service_running
    _service_running = False


def read_latest() -> dict:
    """Read the latest VP snapshot from disk. Returns {} if not available."""
    try:
        if SIGNAL_PATH.exists():
            with open(SIGNAL_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


# ── CLI Entry Point ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Whale Suite Live Volume Profile Service")
    parser.add_argument("--once",     action="store_true", help="Run one refresh cycle and exit")
    parser.add_argument("--loop",     action="store_true", help="Run continuous loop (default)")
    parser.add_argument("--interval", type=int, default=REFRESH_INTERVAL_SECS, help="Refresh interval in seconds")
    args = parser.parse_args()

    REFRESH_INTERVAL_SECS = args.interval

    if args.once:
        print("[VP Service] Running single refresh...")
        out = run_once()
        print(json.dumps(out, indent=2, default=str))
    else:
        _service_running = True
        try:
            _service_loop()
        except KeyboardInterrupt:
            print("\n[VP Service] Interrupted by user.")
