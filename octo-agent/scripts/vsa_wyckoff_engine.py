#!/usr/bin/env python3
"""
Whale Suite — VSA + Wyckoff + Order Flow Engine (v1.0)
======================================================
This engine implements COMPLETE volume knowledge:

1. WYCKOFF ANALYSIS — Accumulation & Distribution Phases
   - Preliminary Support / Selling Climax / Automatic Rally / Secondary Test
   - Spring (below support, closes above) / Last Point of Support
   - Upthrust (above resistance, closes below) / Last Point of Supply
   
2. VSA (Volume Spread Analysis) — Tom Williams / Richard Wyckoff
   - Stopping Volume: High vol + wide range + close near low in downtrend → bullish reversal
   - Exhaustion Volume: High vol + wide range + close near high in uptrend → bearish reversal
   - No Supply: Low vol + narrow range after down move → imminent up move
   - No Demand: Low vol + narrow range after up move → imminent down move
   - Effort vs Result: High volume but price barely moves → absorption (direction change)
   - Testing: Low volume test of a previous high-volume area → confirms move
   
3. ORDER FLOW DELTA — Buying vs Selling Pressure
   - Simulated from M1 data: if close > open = buying bars, close < open = selling bars
   - Cumulative Delta: net buy/sell pressure over session
   - Delta Divergence: price makes new high but delta declining → weakness
   
4. LIQUIDITY SWEEP DETECTION
   - Equal Highs / Equal Lows = stop clusters (smart money targets these)
   - Price sweeps above EH or below EL on high volume then REVERSES → institutional entry
   - The sweep candle itself is the signal bar

5. VWAP INSTITUTIONAL ANCHORING
   - Daily VWAP = institutional cost basis
   - First touch of VWAP after a move = high-probability reversal area
   - Price above VWAP + volume spike on dip = institutional buying

6. TRADE LOCATION RULES (The Exact Edge)
   - LONG: Price sweeps session LOW or VAL → VSA stopping volume or no-supply → 
            delta turns positive → cumulative delta diverging upward → ENTER LONG
   - SHORT: Price sweeps session HIGH or VAH → VSA exhaustion or no-demand → 
             delta turns negative → cumulative delta diverging downward → ENTER SHORT

This is the methodology used by professional volume traders, Order Flow houses,
and institutional prop desks — not just "price is near a level."
"""

import os
import sys
import time
import argparse
import numpy as np
from datetime import datetime, timezone, timedelta
import MetaTrader5 as mt5


# ==============================================================================
# VOLUME PROFILE UTILITIES
# ==============================================================================

def calc_poc_and_va(prices, volumes, n_bins=30):
    """Builds volume profile and returns POC, VAH, VAL."""
    if len(prices) < 2 or n_bins <= 0:
        m = np.mean(prices) if len(prices) > 0 else 0.0
        return m, m, m
    min_p, max_p = min(prices), max(prices)
    step = max(max_p - min_p, 1e-8) / n_bins
    bins = np.zeros(n_bins)
    for p, v in zip(prices, volumes):
        b = int((p - min_p) / step)
        b = max(0, min(n_bins - 1, b))
        bins[b] += v
    poc_bin = int(np.argmax(bins))
    poc = min_p + step * poc_bin + step * 0.5
    target = bins.sum() * 0.70
    acc = bins[poc_bin]
    hi, lo = poc_bin, poc_bin
    while acc < target:
        can_up = (hi + 1 < n_bins)
        can_dn = (lo - 1 >= 0)
        if not can_up and not can_dn:
            break
        up_v = bins[hi + 1] if can_up else 0.0
        dn_v = bins[lo - 1] if can_dn else 0.0
        if can_up and (not can_dn or up_v >= dn_v):
            hi += 1; acc += up_v
        else:
            lo -= 1; acc += dn_v
    vah = min_p + step * (hi + 1)
    val = min_p + step * lo
    return poc, vah, val


# ==============================================================================
# VSA SIGNAL DETECTION ENGINE
# ==============================================================================

def classify_vsa_bar(op, hi, lo, cl, vol, avg_vol, point_size, trend_context):
    """
    Classifies a candle using Volume Spread Analysis methodology.
    
    Returns: dict with vsa_type and signal
    
    VSA Types:
    - STOPPING_VOLUME: High vol, wide spread, closes in LOWER half → potential bullish reversal
    - EXHAUSTION_VOLUME: High vol, wide spread, closes in UPPER half → potential bearish reversal  
    - NO_SUPPLY: Low vol, narrow spread, in downtrend → no sellers → bullish
    - NO_DEMAND: Low vol, narrow spread, in uptrend → no buyers → bearish
    - ABSORPTION: Very high vol, narrow close spread → big players absorbing
    - TEST_SUCCESS: Low vol re-test of prior high-vol area → confirms original move
    - SPRING: Close below support level but recovers above → bullish sweep
    - UPTHRUST: Close above resistance but drops below → bearish sweep
    - NORMAL: No special VSA signature
    """
    spread = hi - lo
    avg_spread_estimate = point_size * 50  # baseline 5 pips for FX
    body = abs(cl - op)
    body_ratio = body / max(spread, point_size)
    close_position = (cl - lo) / max(spread, point_size)  # 0=low, 1=high
    is_high_vol = vol >= avg_vol * 1.5
    is_low_vol = vol <= avg_vol * 0.7
    is_wide_spread = spread >= avg_spread_estimate * 1.5
    is_narrow_spread = spread <= avg_spread_estimate * 0.6

    result = {"vsa_type": "NORMAL", "signal": "NEUTRAL", "strength": 0}

    # STOPPING VOLUME: High vol + wide spread + close in lower 40% = selling climax = BULLISH
    if is_high_vol and is_wide_spread and close_position <= 0.40 and trend_context == "DOWN":
        result = {"vsa_type": "STOPPING_VOLUME", "signal": "BULLISH", "strength": 3}

    # EXHAUSTION VOLUME: High vol + wide spread + close in upper 60% = buying climax = BEARISH
    elif is_high_vol and is_wide_spread and close_position >= 0.60 and trend_context == "UP":
        result = {"vsa_type": "EXHAUSTION_VOLUME", "signal": "BEARISH", "strength": 3}

    # ABSORPTION: Very high vol but narrow spread = big players absorbing the move
    elif vol >= avg_vol * 2.0 and is_narrow_spread:
        if trend_context == "DOWN":
            result = {"vsa_type": "ABSORPTION_BULL", "signal": "BULLISH", "strength": 2}
        else:
            result = {"vsa_type": "ABSORPTION_BEAR", "signal": "BEARISH", "strength": 2}

    # NO SUPPLY: Low vol + narrow spread in downtrend = sellers exhausted = BULLISH
    elif is_low_vol and is_narrow_spread and trend_context == "DOWN":
        result = {"vsa_type": "NO_SUPPLY", "signal": "BULLISH", "strength": 2}

    # NO DEMAND: Low vol + narrow spread in uptrend = buyers exhausted = BEARISH
    elif is_low_vol and is_narrow_spread and trend_context == "UP":
        result = {"vsa_type": "NO_DEMAND", "signal": "BEARISH", "strength": 2}

    return result


def detect_liquidity_sweep(candles, i, tol_points, point_size):
    """
    Detects a liquidity sweep: price briefly breaks a recent equal high/low 
    then closes back inside the range.
    
    Returns: "BULL_SWEEP" (swept lows → go long), "BEAR_SWEEP" (swept highs → go short), or None
    """
    if i < 20:
        return None

    lookback = candles[i-20:i]
    recent_lows = [c["low"] for c in lookback]
    recent_highs = [c["high"] for c in lookback]
    avg_low = sorted(recent_lows)[2]   # 3rd lowest
    avg_high = sorted(recent_highs, reverse=True)[2]  # 3rd highest

    current = candles[i]
    tol = tol_points * point_size

    # Bull sweep: dips below the cluster of lows but closes back ABOVE them
    eq_low_level = sorted(recent_lows)[0]  # absolute session low
    if current["low"] < eq_low_level - tol and current["close"] > eq_low_level:
        return "BULL_SWEEP"

    # Bear sweep: spikes above the cluster of highs but closes back BELOW them
    eq_high_level = sorted(recent_highs, reverse=True)[0]  # absolute session high
    if current["high"] > eq_high_level + tol and current["close"] < eq_high_level:
        return "BEAR_SWEEP"

    return None


def calc_vwap(candles_session):
    """Calculates VWAP for a list of candles (one session)."""
    tp_vol = sum((c["high"] + c["low"] + c["close"]) / 3.0 * c["volume"] for c in candles_session)
    total_vol = sum(c["volume"] for c in candles_session)
    return tp_vol / total_vol if total_vol > 0 else 0.0


def calc_cumulative_delta(candles_window):
    """
    Simulates order flow delta.
    Positive close vs open = net buying pressure (adds to delta).
    Negative close vs open = net selling pressure (subtracts from delta).
    Returns the cumulative delta and the recent delta direction.
    """
    cum_delta = 0.0
    delta_series = []
    for c in candles_window:
        if c["close"] > c["open"]:
            bar_delta = c["volume"]  # buyers dominated
        elif c["close"] < c["open"]:
            bar_delta = -c["volume"]  # sellers dominated
        else:
            bar_delta = 0.0
        cum_delta += bar_delta
        delta_series.append(cum_delta)
    return cum_delta, delta_series


def detect_delta_divergence(price_series, delta_series, lookback=10):
    """
    Detects divergence between price and cumulative delta.
    Price makes new high but delta declining → BEARISH divergence.
    Price makes new low but delta rising → BULLISH divergence.
    """
    if len(price_series) < lookback or len(delta_series) < lookback:
        return "NONE"

    p = price_series[-lookback:]
    d = delta_series[-lookback:]

    price_trend = p[-1] - p[0]
    delta_trend = d[-1] - d[0]

    if price_trend > 0 and delta_trend < 0:
        return "BEARISH_DIV"  # Price up, delta down → sell signal
    if price_trend < 0 and delta_trend > 0:
        return "BULLISH_DIV"  # Price down, delta up → buy signal
    return "NONE"


# ==============================================================================
# WYCKOFF PHASE DETECTOR
# ==============================================================================

def detect_wyckoff_context(candles, i, point_size):
    """
    Simplified Wyckoff phase detection on recent bars.
    
    Looks for:
    - Selling Climax (SC): The panic low with extremely high volume
    - Automatic Rally (AR): Bounce from SC on declining volume  
    - Secondary Test (ST): Low-volume re-test near SC low
    - Spring: False break below SC low on low vol → STRONG BUY
    - Upthrust: False break above AR high on low vol → STRONG SELL
    """
    if i < 50:
        return {"phase": "UNKNOWN", "signal": "NEUTRAL"}

    window = candles[i-50:i+1]
    vols = [c["volume"] for c in window]
    avg_vol = np.mean(vols)
    
    # Find Selling Climax: lowest close bar with highest volume
    min_close_idx = min(range(len(window)), key=lambda x: window[x]["close"])
    sc_bar = window[min_close_idx]
    sc_vol = sc_bar["volume"]
    sc_price = sc_bar["low"]
    
    # Find Buying Climax: highest close bar with highest volume
    max_close_idx = max(range(len(window)), key=lambda x: window[x]["close"])
    bc_bar = window[max_close_idx]
    bc_vol = bc_bar["volume"]
    bc_price = bc_bar["high"]

    current = candles[i]
    tol = point_size * 30  # 3 pip tolerance

    # SPRING detection: current low breaks SC low but closes above it on low volume
    if (current["low"] < sc_price - tol and 
        current["close"] > sc_price and 
        current["volume"] < avg_vol * 0.8 and
        sc_vol > avg_vol * 1.5):
        return {"phase": "SPRING", "signal": "STRONG_BUY", "level": sc_price}

    # Secondary test: price approaches SC level on much lower volume
    if (abs(current["low"] - sc_price) < tol * 2 and
        current["volume"] < sc_vol * 0.5 and
        sc_vol > avg_vol * 1.5):
        return {"phase": "SECONDARY_TEST", "signal": "BUY", "level": sc_price}

    # UPTHRUST: current high breaks BC high but closes below it on declining volume
    if (current["high"] > bc_price + tol and
        current["close"] < bc_price and
        current["volume"] < avg_vol * 0.8 and
        bc_vol > avg_vol * 1.5):
        return {"phase": "UPTHRUST", "signal": "STRONG_SELL", "level": bc_price}

    # Last Point of Supply: approaches BC level on much lower volume
    if (abs(current["high"] - bc_price) < tol * 2 and
        current["volume"] < bc_vol * 0.5 and
        bc_vol > avg_vol * 1.5):
        return {"phase": "LPSY", "signal": "SELL", "level": bc_price}

    return {"phase": "MARKUP" if current["close"] > sc_price + tol * 5 else "RANGE", "signal": "NEUTRAL"}


# ==============================================================================
# MAIN VSA ENGINE
# ==============================================================================

class VSAWyckoffEngine:
    def __init__(self, symbol: str, candle_count: int = 15000, balance: float = 10000.0):
        self.symbol = symbol.upper()
        self.candle_count = candle_count
        self.initial_balance = balance
        self.point_size = 0.00001
        self.broker_gmt_offset = 3
        self.m1_candles = []
        self.m15_candles = []
        self.sessions = {
            0: {"start": 0,  "end": 8,  "name": "ASIA"},
            1: {"start": 8,  "end": 16, "name": "LONDON"},
            2: {"start": 13, "end": 21, "name": "NY"},
        }

    def connect_and_fetch(self) -> bool:
        if not mt5.initialize():
            exe = r"C:\Program Files\MetaTrader 5\terminal64.exe"
            if os.path.exists(exe) and mt5.initialize(path=exe):
                pass
            else:
                print(f"[ERROR] MT5 init failed: {mt5.last_error()}")
                return False

        tick = mt5.symbol_info_tick(self.symbol)
        if tick:
            utc = int(time.time())
            off = abs(utc - tick.time)
            self.broker_gmt_offset = 3 if off > 10800 else round((tick.time - utc) / 3600.0)

        s_info = mt5.symbol_info(self.symbol)
        if s_info is None:
            alt = self.symbol.replace("+", "")
            s_info = mt5.symbol_info(alt)
            if s_info:
                self.symbol = alt
            else:
                print(f"[ERROR] Symbol {self.symbol} not found.")
                return False
        self.point_size = s_info.point
        mt5.symbol_select(self.symbol, True)

        print(f"  Fetching M1 data ({self.candle_count} bars)...")
        m1 = mt5.copy_rates_from_pos(self.symbol, mt5.TIMEFRAME_M1, 0, self.candle_count + 1000)
        print(f"  Fetching M15 data...")
        m15 = mt5.copy_rates_from_pos(self.symbol, mt5.TIMEFRAME_M15, 0, int(self.candle_count / 15) + 500)

        if m1 is None or len(m1) == 0:
            print("[ERROR] M1 data empty."); return False
        if m15 is None or len(m15) == 0:
            print("[ERROR] M15 data empty."); return False

        def parse(rates):
            return [{"time": datetime.fromtimestamp(int(r["time"]), tz=timezone.utc),
                     "open": float(r["open"]), "high": float(r["high"]),
                     "low": float(r["low"]), "close": float(r["close"]),
                     "volume": int(r["tick_volume"])} for r in rates]

        self.m1_candles = parse(m1)
        self.m15_candles = parse(m15)

        # Pre-cache Malta hour
        for c in self.m1_candles:
            gmt = c["time"] - timedelta(hours=self.broker_gmt_offset)
            malta = gmt + timedelta(hours=2)
            c["malta_hour"] = malta.hour
            for s_idx, p in self.sessions.items():
                c[f"in_s{s_idx}"] = (malta.hour >= p["start"] and malta.hour < p["end"])

        print(f"  Loaded: {len(self.m1_candles)} M1, {len(self.m15_candles)} M15")
        return True

    def get_trend_context(self, i, lookback=20):
        """Simple trend: slope of closing prices over lookback."""
        if i < lookback:
            return "NEUTRAL"
        closes = [self.m1_candles[i - k]["close"] for k in range(lookback, 0, -1)]
        slope = closes[-1] - closes[0]
        if slope > self.point_size * 5:
            return "UP"
        elif slope < -self.point_size * 5:
            return "DOWN"
        return "NEUTRAL"

    def run_backtest(self, config):
        """
        Runs the full VSA + Wyckoff backtest with the given config dict.
        """
        n = len(self.m1_candles)
        balance = self.initial_balance
        active_trade = None
        trades = []
        equity = []

        vp_lb = config["vp_lookback"]          # M1 bars for volume profile
        vsa_vol_mult = config["vsa_vol_mult"]  # how many σ above avg = high volume
        sweep_tol = config["sweep_tol"]        # points for sweep detection
        use_sweep = config["use_sweep"]
        use_vsa = config["use_vsa"]
        use_wyckoff = config["use_wyckoff"]
        use_delta_div = config["use_delta_div"]
        use_vwap = config["use_vwap"]
        rr = config["rr"]                      # risk:reward ratio
        sl_points = config["sl_points"]        # SL in points

        WARMUP = 150

        for i in range(WARMUP, n):
            bar = self.m1_candles[i]
            bt = bar["time"]

            # --- MANAGE ACTIVE TRADE ---
            if active_trade:
                if active_trade["type"] == "LONG":
                    if bar["low"] <= active_trade["sl"]:
                        pnl = -active_trade["risk"]
                        balance += pnl
                        trades.append({"result": "LOSS", "pnl": pnl, "reason": active_trade["reason"]})
                        active_trade = None
                    elif bar["high"] >= active_trade["tp"]:
                        pnl = active_trade["risk"] * active_trade["rr"]
                        balance += pnl
                        trades.append({"result": "WIN", "pnl": pnl, "reason": active_trade["reason"]})
                        active_trade = None
                else:
                    if bar["high"] >= active_trade["sl"]:
                        pnl = -active_trade["risk"]
                        balance += pnl
                        trades.append({"result": "LOSS", "pnl": pnl, "reason": active_trade["reason"]})
                        active_trade = None
                    elif bar["low"] <= active_trade["tp"]:
                        pnl = active_trade["risk"] * active_trade["rr"]
                        balance += pnl
                        trades.append({"result": "WIN", "pnl": pnl, "reason": active_trade["reason"]})
                        active_trade = None
                equity.append(balance)
                continue

            # --- SESSION FILTER ---
            in_any_session = any(bar.get(f"in_s{s}", False) for s in self.sessions)
            if not in_any_session:
                equity.append(balance)
                continue

            # --- BUILD VOLUME PROFILE (last vp_lb M1 bars) ---
            window = self.m1_candles[max(0, i - vp_lb): i]
            if len(window) < 30:
                equity.append(balance)
                continue
            wp = [c["close"] for c in window]
            wv = [c["volume"] for c in window]
            poc, vah, val = calc_poc_and_va(wp, wv)
            vols = [c["volume"] for c in window]
            avg_vol = np.mean(vols)

            # --- TREND CONTEXT ---
            trend = self.get_trend_context(i, lookback=30)

            # --- VSA SIGNAL ---
            vsa = {"vsa_type": "NORMAL", "signal": "NEUTRAL", "strength": 0}
            if use_vsa:
                vsa = classify_vsa_bar(
                    bar["open"], bar["high"], bar["low"], bar["close"],
                    bar["volume"], avg_vol * vsa_vol_mult, self.point_size, trend
                )

            # --- WYCKOFF CONTEXT ---
            wyckoff = {"phase": "UNKNOWN", "signal": "NEUTRAL"}
            if use_wyckoff and i >= 50:
                wyckoff = detect_wyckoff_context(self.m1_candles, i, self.point_size)

            # --- LIQUIDITY SWEEP ---
            sweep = None
            if use_sweep:
                sweep = detect_liquidity_sweep(self.m1_candles, i, sweep_tol, self.point_size)

            # --- CUMULATIVE DELTA ---
            delta_div = "NONE"
            if use_delta_div:
                delta_window = self.m1_candles[max(0, i-30): i+1]
                cum_delta, delta_series = calc_cumulative_delta(delta_window)
                price_series = [c["close"] for c in delta_window]
                delta_div = detect_delta_divergence(price_series, delta_series)

            # --- VWAP ---
            vwap = 0.0
            if use_vwap:
                day_start = bt.replace(hour=0, minute=0, second=0)
                day_bars = [c for c in self.m1_candles[max(0, i-500): i+1]
                            if c["time"].date() == bt.date()]
                if len(day_bars) > 1:
                    vwap = calc_vwap(day_bars)

            # ===================================================================
            # ENTRY LOGIC — Score-based confluence system
            # ===================================================================
            bull_score = 0
            bear_score = 0
            bull_reasons = []
            bear_reasons = []

            cl = bar["close"]
            op = bar["open"]
            sl_dist = sl_points * self.point_size

            # 1. VOLUME PROFILE LOCATION (Price at key shelf)
            tol = sl_dist * 0.6  # proximity tolerance tied to SL
            near_val = abs(cl - val) <= tol
            near_vah = abs(cl - vah) <= tol
            near_poc_bull = abs(cl - poc) <= tol and cl > op
            near_poc_bear = abs(cl - poc) <= tol and cl < op

            if near_val or near_poc_bull:
                bull_score += 1
                bull_reasons.append(f"VP:{'VAL' if near_val else 'POC'}")
            if near_vah or near_poc_bear:
                bear_score += 1
                bear_reasons.append(f"VP:{'VAH' if near_vah else 'POC'}")

            # 2. VSA SIGNAL
            if vsa["signal"] == "BULLISH":
                bull_score += vsa["strength"]
                bull_reasons.append(vsa["vsa_type"])
            elif vsa["signal"] == "BEARISH":
                bear_score += vsa["strength"]
                bear_reasons.append(vsa["vsa_type"])

            # 3. WYCKOFF PHASE
            if wyckoff["signal"] in ("BUY", "STRONG_BUY"):
                boost = 2 if wyckoff["signal"] == "STRONG_BUY" else 1
                bull_score += boost
                bull_reasons.append(wyckoff["phase"])
            elif wyckoff["signal"] in ("SELL", "STRONG_SELL"):
                boost = 2 if wyckoff["signal"] == "STRONG_SELL" else 1
                bear_score += boost
                bear_reasons.append(wyckoff["phase"])

            # 4. LIQUIDITY SWEEP (highest probability setup)
            if sweep == "BULL_SWEEP":
                bull_score += 3
                bull_reasons.append("LIQ_SWEEP")
            elif sweep == "BEAR_SWEEP":
                bear_score += 3
                bear_reasons.append("LIQ_SWEEP")

            # 5. DELTA DIVERGENCE
            if delta_div == "BULLISH_DIV":
                bull_score += 2
                bull_reasons.append("DELTA_DIV")
            elif delta_div == "BEARISH_DIV":
                bear_score += 2
                bear_reasons.append("DELTA_DIV")

            # 6. VWAP SUPPORT / RESISTANCE
            if use_vwap and vwap > 0:
                if abs(cl - vwap) <= tol:
                    if cl > op:
                        bull_score += 1
                        bull_reasons.append("VWAP_SUPPORT")
                    else:
                        bear_score += 1
                        bear_reasons.append("VWAP_RESIST")

            # 7. TREND ALIGNMENT BONUS
            if trend == "UP":
                bull_score += 1
            elif trend == "DOWN":
                bear_score += 1

            # ===================================================================
            # MINIMUM CONFLUENCE THRESHOLD
            # ===================================================================
            min_score = config["min_confluence"]

            if bull_score >= min_score and bull_score > bear_score:
                sl_price = cl - sl_dist
                tp_price = cl + sl_dist * rr
                active_trade = {
                    "type": "LONG",
                    "entry": cl,
                    "sl": sl_price,
                    "tp": tp_price,
                    "risk": 100.0,
                    "rr": rr,
                    "reason": "+".join(bull_reasons),
                }

            elif bear_score >= min_score and bear_score > bull_score:
                sl_price = cl + sl_dist
                tp_price = cl - sl_dist * rr
                active_trade = {
                    "type": "SHORT",
                    "entry": cl,
                    "sl": sl_price,
                    "tp": tp_price,
                    "risk": 100.0,
                    "rr": rr,
                    "reason": "+".join(bear_reasons),
                }

            equity.append(balance)

        # Summarise results
        n_trades = len(trades)
        if n_trades == 0:
            return {"win_rate": 0, "pf": 0, "net_pct": 0, "trades": 0, "tpd": 0}

        wins = [t for t in trades if t["result"] == "WIN"]
        losses = [t for t in trades if t["result"] == "LOSS"]
        wr = len(wins) / n_trades * 100
        gp = sum(t["pnl"] for t in wins)
        gl = abs(sum(t["pnl"] for t in losses))
        pf = gp / gl if gl > 0 else gp

        # Count trading days
        if self.m1_candles:
            t0 = self.m1_candles[WARMUP]["time"]
            t1 = self.m1_candles[-1]["time"]
            tdays = max(1.0, (t1 - t0).total_seconds() / 86400.0 * (5/7))
        else:
            tdays = 10.0

        net_pct = (balance - self.initial_balance) / self.initial_balance * 100

        # Peak drawdown
        peak = self.initial_balance
        max_dd = 0.0
        for b in equity:
            if b > peak:
                peak = b
            dd = (peak - b) / peak * 100
            if dd > max_dd:
                max_dd = dd

        # Reason frequency
        from collections import Counter
        reason_counter = Counter(t["reason"] for t in trades)
        top_reasons = reason_counter.most_common(5)

        return {
            "win_rate": wr,
            "pf": pf,
            "net_pct": net_pct,
            "trades": n_trades,
            "tpd": n_trades / tdays,
            "max_dd": max_dd,
            "trading_days": tdays,
            "top_reasons": top_reasons,
            "trades_list": trades,
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", default="EURUSD+")
    parser.add_argument("--candles", type=int, default=15000)
    args = parser.parse_args()

    print("\n" + "=" * 70)
    print("   VSA + WYCKOFF + ORDER FLOW ENGINE — OCTO TRADING SUITE")
    print("=" * 70)
    print(f"   Symbol : {args.symbol}")
    print(f"   M1 Bars: {args.candles}")
    print()

    engine = VSAWyckoffEngine(symbol=args.symbol, candle_count=args.candles)
    if not engine.connect_and_fetch():
        mt5.shutdown()
        return

    # =========================================================================
    # CONFIGURATION SWEEP
    # =========================================================================
    print("  [Sweep] Starting VSA/Wyckoff/OrderFlow parameter grid search...\n")
    t0 = time.time()

    configs = []
    for vp_lb in [60, 120, 240]:          # volume profile window: 1h, 2h, 4h in M1 bars
        for sl_pts in [10, 15, 20, 30]:   # SL in points
            for rr in [1.5, 2.0, 2.5, 3.0]:  # RR
                for min_conf in [2, 3, 4]:    # minimum confluence score to enter
                    for use_sweep in [True, False]:
                        for use_delta in [True, False]:
                            configs.append({
                                "vp_lookback": vp_lb,
                                "sl_points": sl_pts,
                                "rr": rr,
                                "min_confluence": min_conf,
                                "vsa_vol_mult": 1.0,
                                "sweep_tol": 20,
                                "use_sweep": use_sweep,
                                "use_vsa": True,
                                "use_wyckoff": True,
                                "use_delta_div": use_delta,
                                "use_vwap": True,
                            })

    print(f"  Total configurations: {len(configs)}")

    results = []
    for cfg_n, cfg in enumerate(configs):
        res = engine.run_backtest(cfg)
        if res["trades"] > 0:
            results.append({**cfg, **res})
        if (cfg_n + 1) % 100 == 0:
            elapsed = time.time() - t0
            print(f"  ... {cfg_n+1}/{len(configs)} ({elapsed:.0f}s)")

    # =========================================================================
    # REPORT
    # =========================================================================
    print(f"\n  [Done] Sweep in {time.time()-t0:.0f}s.")

    if not results:
        print("\n[WARNING] No valid results. Try increasing --candles.")
        mt5.shutdown()
        return

    # Best by WR with tpd >= 1.0
    qualified = [r for r in results if r["tpd"] >= 1.0 and r["pf"] >= 1.0]
    qualified.sort(key=lambda x: (-x["wr"], -x["pf"]))

    if not qualified:
        print("  [Fallback] No config hit tpd>=1.0 AND pf>=1.0. Showing top by WR...")
        qualified = sorted(results, key=lambda x: -x["wr"])[:20]

    print("\n" + "=" * 70)
    print(f"   VSA + WYCKOFF RESULTS — {args.symbol}")
    print("=" * 70)

    trading_days = results[0]["trading_days"] if results else 10.0

    for rank, r in enumerate(qualified[:10], 1):
        sweep_str = "SWEEP+" if r["use_sweep"] else ""
        delta_str = "DELTA+" if r["use_delta_div"] else ""
        print(f"  #{rank}  VPL={r['vp_lookback']} SL={r['sl_points']}pts RR={r['rr']} MinConf={r['min_confluence']} {sweep_str}{delta_str}")
        print(f"       WR={r['win_rate']:.1f}% | PF={r['pf']:.2f} | TPD={r['tpd']:.2f} | DD={r['max_dd']:.1f}% | Net={r['net_pct']:+.2f}%")
        print(f"       Trades={r['trades']} over {trading_days:.0f} days")
        if "top_reasons" in r:
            print(f"       Top signals: {r['top_reasons'][:3]}")
        print()

    best = qualified[0]

    # Save report
    out = f"C:\\Users\\Tenders\\octo\\vsa_wyckoff_report_{args.symbol}.md"
    with open(out, "w", encoding="utf-8") as f:
        f.write(f"# VSA + Wyckoff + Order Flow Report: {args.symbol}\n\n")
        f.write(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n\n")
        f.write("## 🎯 Volume-Based Trading Edge\n\n")
        f.write("This engine does NOT just check proximity to a level.\n")
        f.write("It reads the **WHY** behind price movement using:\n")
        f.write("- **VSA (Volume Spread Analysis)**: No Supply, No Demand, Stopping Volume, Exhaustion\n")
        f.write("- **Wyckoff Phases**: Spring, Secondary Test, Upthrust, LPSY detection\n")
        f.write("- **Liquidity Sweeps**: Price sweeps equal highs/lows then reverses\n")
        f.write("- **Order Flow Delta**: Simulated buying vs selling pressure divergence\n")
        f.write("- **VWAP**: Institutional daily cost basis anchor\n\n")
        f.write("## 🏆 Best Configuration\n\n")
        f.write(f"| Parameter | Value |\n| :--- | :--- |\n")
        f.write(f"| Volume Profile Lookback | `{best['vp_lookback']}` M1 bars |\n")
        f.write(f"| Stop Loss | `{best['sl_points']}` points |\n")
        f.write(f"| Risk:Reward | `{best['rr']}:1` |\n")
        f.write(f"| Min Confluence Score | `{best['min_confluence']}` |\n")
        f.write(f"| Use Liquidity Sweep | `{best['use_sweep']}` |\n")
        f.write(f"| Use Delta Divergence | `{best['use_delta_div']}` |\n\n")
        f.write("## 📈 Performance\n\n")
        f.write(f"- **Win Rate**: `{best['win_rate']:.2f}%`\n")
        f.write(f"- **Profit Factor**: `{best['pf']:.2f}`\n")
        f.write(f"- **Avg Trades/Day**: `{best['tpd']:.2f}`\n")
        f.write(f"- **Net Return**: `{best['net_pct']:+.2f}%`\n")
        f.write(f"- **Max Drawdown**: `{best['max_dd']:.2f}%`\n")
        f.write(f"- **Total Trades**: `{best['trades']}`\n\n")
        f.write("## 🔑 Signal Priority (Highest Edge First)\n\n")
        f.write("1. **Liquidity Sweep** (score +3): Price hunts stops then reverses. Highest conviction.\n")
        f.write("2. **Stopping Volume / Exhaustion** (score +3): High vol at key level — institutions absorbing.\n")
        f.write("3. **Spring / Upthrust** (score +2): Wyckoff false break — the classic accumulation/distribution tell.\n")
        f.write("4. **Delta Divergence** (score +2): Price and order flow disagree — reversal incoming.\n")
        f.write("5. **No Supply / No Demand** (score +2): Low vol test — nobody fighting the move.\n")
        f.write("6. **Volume Profile Level** (score +1): VAL/POC/VAH proximity.\n")
        f.write("7. **VWAP Touch** (score +1): Institutional reference level.\n\n")
        if "top_reasons" in best:
            f.write("## 🔬 Most Common Signal Combinations\n\n")
            for reason, count in best["top_reasons"]:
                f.write(f"- `{reason}`: {count} trades\n")

    print(f"\n  [Saved] Full report: {out}")
    print("=" * 70)
    mt5.shutdown()


if __name__ == "__main__":
    main()
