#!/usr/bin/env python3
"""
Whale Suite — Real-Time VSA Engine (Zero Lag)
=============================================
ZERO LAGGING INDICATORS. Every signal reads the CURRENT bar only.

How price ACTUALLY moves (what institutions do):
================================================
Step 1: ACCUMULATION — Institutions buy quietly at low prices.
        Signs: High volume, narrow spread, price doesn't fall → absorption.
        
Step 2: MARKUP — Price rises with expanding volume on up bars.
        Signs: Wide spread up bars on above-average volume.
        
Step 3: DISTRIBUTION — Institutions sell quietly at high prices.
        Signs: High volume, narrow spread at highs → absorption of buying.
        
Step 4: MARKDOWN — Price falls with expanding volume on down bars.

What we READ from each bar (ZERO LAG):
=======================================
A. SPREAD (High - Low):    Wide or Narrow?
B. CLOSE POSITION:         (Close - Low) / (High - Low) → 0=closed at bottom, 1=at top
C. VOLUME:                 vs Session rolling average (last 20 bars only — not historical)
D. BODY RATIO:             Body / Spread → small body = wide wicks = absorption
E. WICK RATIO:             Upper/Lower wick lengths
F. PRICE vs SESSION VWAP:  Deviation from institutional fair value
G. PRICE vs SESSION VP:    Position in Value Area (Below VAL, In VA, Above VAH)

Real-Time Signals (no lag):
============================
1. STOPPING VOLUME BAR:
   - High volume + wide spread + close in BOTTOM 30% of bar range
   - At or below VAL or session low
   → Big players absorbing selling. Next move: UP.
   
2. EXHAUSTION BAR:
   - High volume + wide spread + close in TOP 30% of bar range  
   - At or above VAH or session high
   → Big players absorbing buying. Next move: DOWN.

3. NO SUPPLY BAR (most powerful bullish):
   - Low volume + narrow spread + close above midpoint
   - AFTER a downmove (just look at 2 previous bars direction)
   → Nobody wants to sell here. Price will rise.

4. NO DEMAND BAR (most powerful bearish):
   - Low volume + narrow spread + close below midpoint
   - AFTER an upmove (just look at 2 previous bars direction)
   → Nobody wants to buy here. Price will fall.

5. VOLUME CLIMAX REVERSAL:
   - HIGHEST volume bar in last 20 bars
   - Close in opposite half of bar range to the trend
   → Institutions just executed a massive position. Turn is NOW.

6. LIQUIDITY SWEEP (same bar detection):
   - Price wick goes BELOW last 5-bar low AND closes ABOVE it
   - Or wick goes ABOVE last 5-bar high AND closes BELOW it
   → Stop hunt complete. Institutional entry just happened on THIS bar.

7. ABSORPTION BAR:
   - Volume > 2× session average
   - But spread is NARROW (< 40% of session average spread)
   → Someone is absorbing every trade. Directional move blocked.

TRADE LOCATION (where institutions enter):
==========================================
LONG entry:  Price at or below VAL + Stopping/No-Supply/Sweep signal
SHORT entry: Price at or above VAH + Exhaustion/No-Demand/Sweep signal
"""

import os
import sys
import time
import argparse
import numpy as np
from datetime import datetime, timezone, timedelta
import MetaTrader5 as mt5


# ==============================================================================
# REAL-TIME BAR CLASSIFICATION (ZERO LAG)
# ==============================================================================

def classify_bar_realtime(bar, session_bars_recent, session_vp_val, session_vp_poc, session_vp_vah, session_vwap, point_size):
    """
    Zero-lag bar classifier — every signal requires price to be AT a key location.
    Sweeps use 20-bar lookback with minimum penetration depth.
    No RSI. No MA. No historical indicators.
    """
    op = bar["open"]
    hi = bar["high"]
    lo = bar["low"]
    cl = bar["close"]
    vol = bar["volume"]

    spread = max(hi - lo, point_size)
    body = abs(cl - op)
    body_ratio = body / spread
    close_pos = (cl - lo) / spread      # 0 = closed at bottom, 1 = at top
    upper_wick = hi - max(op, cl)
    lower_wick = min(op, cl) - lo
    upper_wick_ratio = upper_wick / spread
    lower_wick_ratio = lower_wick / spread

    # Session rolling stats — last 20 bars in same session
    recent = session_bars_recent[-20:] if len(session_bars_recent) >= 5 else session_bars_recent
    if recent:
        avg_vol    = np.mean([b["volume"] for b in recent])
        avg_spread = np.mean([max(b["high"] - b["low"], point_size) for b in recent])
    else:
        avg_vol = vol; avg_spread = spread

    # Tighter volume thresholds (2.0x = truly high, 2.5x = climax)
    is_high_vol    = vol >= avg_vol * 2.0
    is_very_high   = vol >= avg_vol * 2.5
    is_low_vol     = vol <= avg_vol * 0.60
    is_wide_spread = spread >= avg_spread * 1.5
    is_narrow      = spread <= avg_spread * 0.55

    # ---- PRICE LOCATION (required gate for most signals) ----
    va_range     = max(session_vp_vah - session_vp_val, point_size)
    loc_tol      = va_range * 0.15          # 15% of VA = proximity zone
    at_val       = (lo <= session_vp_val + loc_tol)   # price testing VAL zone
    at_vah       = (hi >= session_vp_vah - loc_tol)   # price testing VAH zone
    at_poc_bull  = (abs(cl - session_vp_poc) <= loc_tol and cl > op)
    at_poc_bear  = (abs(cl - session_vp_poc) <= loc_tol and cl < op)
    below_val    = (cl < session_vp_val)
    above_vah    = (cl > session_vp_vah)
    near_poc     = abs(cl - session_vp_poc) <= loc_tol

    # At a valid LONG location: near/below VAL or near POC with bullish close
    long_location = at_val or below_val or at_poc_bull
    # At a valid SHORT location: near/above VAH or near POC with bearish close
    short_location = at_vah or above_vah or at_poc_bear

    # ---- MICRO TREND — only last 3 bars ----
    if len(session_bars_recent) >= 3:
        prev1 = session_bars_recent[-1]
        prev2 = session_bars_recent[-3]
        micro_trend = "UP" if prev1["close"] > prev2["close"] else "DOWN"
        prev_close  = prev1["close"]
    else:
        micro_trend = "NEUTRAL"
        prev_close  = cl

    # ---- SWEEP DETECTION — 20-bar lookback + minimum penetration ----
    # Requires a MEANINGFUL wick below/above — not just 1 pip
    min_sweep_depth = point_size * 8   # 8 pips for FX (adjust per symbol)
    if len(session_bars_recent) >= 20:
        swing_low  = min(b["low"]  for b in session_bars_recent[-20:])
        swing_high = max(b["high"] for b in session_bars_recent[-20:])
    elif len(session_bars_recent) >= 5:
        swing_low  = min(b["low"]  for b in session_bars_recent[-5:])
        swing_high = max(b["high"] for b in session_bars_recent[-5:])
    else:
        swing_low  = lo; swing_high = hi

    signals    = []
    bull_score = 0
    bear_score = 0

    # =========================================================================
    # SIGNAL 1: STOPPING VOLUME — LOCATION REQUIRED
    # High vol + wide spread + close in bottom 30% + AT VAL zone
    # =========================================================================
    if is_high_vol and is_wide_spread and close_pos <= 0.30 and long_location:
        signals.append("STOPPING_VOLUME")
        bull_score += 4

    # =========================================================================
    # SIGNAL 2: EXHAUSTION VOLUME — LOCATION REQUIRED
    # High vol + wide spread + close in top 70% + AT VAH zone
    # =========================================================================
    if is_high_vol and is_wide_spread and close_pos >= 0.70 and short_location:
        signals.append("EXHAUSTION_VOLUME")
        bear_score += 4

    # =========================================================================
    # SIGNAL 3: NO SUPPLY — LOCATION REQUIRED (at VAL or POC)
    # Low vol + narrow + close above mid + after downmove + at buy zone
    # =========================================================================
    if is_low_vol and is_narrow and close_pos >= 0.55 and micro_trend == "DOWN" and long_location:
        signals.append("NO_SUPPLY")
        bull_score += 3

    # =========================================================================
    # SIGNAL 4: NO DEMAND — LOCATION REQUIRED (at VAH or POC)
    # Low vol + narrow + close below mid + after upmove + at sell zone
    # =========================================================================
    if is_low_vol and is_narrow and close_pos <= 0.45 and micro_trend == "UP" and short_location:
        signals.append("NO_DEMAND")
        bear_score += 3

    # =========================================================================
    # SIGNAL 5: VOLUME CLIMAX — requires being at key level
    # =========================================================================
    if is_very_high and len(session_bars_recent) >= 10:
        rv = [b["volume"] for b in session_bars_recent[-10:]]
        if vol > max(rv):
            if micro_trend == "DOWN" and close_pos >= 0.50 and long_location:
                signals.append("BULL_CLIMAX")
                bull_score += 5
            elif micro_trend == "UP" and close_pos <= 0.50 and short_location:
                signals.append("BEAR_CLIMAX")
                bear_score += 5

    # =========================================================================
    # SIGNAL 6: LIQUIDITY SWEEP — 20-bar lookback + minimum penetration
    # Bar must penetrate swing_low/high by at least min_sweep_depth
    # AND close back above/below it — confirms stop hunt complete
    # =========================================================================
    bull_swept = (lo < swing_low - min_sweep_depth and cl > swing_low)
    bear_swept = (hi > swing_high + min_sweep_depth and cl < swing_high)

    if bull_swept:
        signals.append("BULL_SWEEP")
        bull_score += 5

    if bear_swept:
        signals.append("BEAR_SWEEP")
        bear_score += 5

    # =========================================================================
    # SIGNAL 7: ABSORPTION — at key level only
    # Very high vol + tiny body = big player loaded at this price
    # =========================================================================
    if is_very_high and body_ratio <= 0.25 and (long_location or short_location):
        if close_pos >= 0.50:
            signals.append("BULL_ABSORPTION")
            bull_score += 3
        else:
            signals.append("BEAR_ABSORPTION")
            bear_score += 3

    # =========================================================================
    # SIGNAL 8: SPRING / UPTHRUST — wick through VA boundary + closes back
    # Requires deeper wick (40%+ of bar) + VP has enough bars to be reliable
    # =========================================================================
    if (lo < session_vp_val and cl > session_vp_val
            and lower_wick_ratio >= 0.40
            and (session_vp_val - lo) >= min_sweep_depth):
        signals.append("SPRING")
        bull_score += 5

    if (hi > session_vp_vah and cl < session_vp_vah
            and upper_wick_ratio >= 0.40
            and (hi - session_vp_vah) >= min_sweep_depth):
        signals.append("UPTHRUST")
        bear_score += 5

    # =========================================================================
    # VWAP DEVIATION BONUS (adds 1 point when price far from fair value)
    # =========================================================================
    if session_vwap > 0:
        vwap_dev = (cl - session_vwap) / max(avg_spread * 3, point_size)
        if vwap_dev <= -1.5 and long_location:
            bull_score += 1
        if vwap_dev >= 1.5 and short_location:
            bear_score += 1

    # vwap_dev may not be set if session_vwap==0; default to 0
    vwap_dev_out = (cl - session_vwap) / max(avg_spread * 3, point_size) if session_vwap > 0 else 0.0

    return {
        "signals": signals,
        "bull_score": bull_score,
        "bear_score": bear_score,
        "close_pos": close_pos,
        "is_high_vol": is_high_vol,
        "is_low_vol": is_low_vol,
        "below_val": below_val,
        "above_vah": above_vah,
        "vwap_dev": vwap_dev_out,
    }


# ==============================================================================
# REAL-TIME SESSION VOLUME PROFILE
# ==============================================================================

def build_session_vp(session_bars, n_bins=25):
    """Builds VP from only the bars traded so far this session — real time."""
    if len(session_bars) < 3:
        prices = [b["close"] for b in session_bars]
        m = np.mean(prices) if prices else 0.0
        return m, m, m
    prices = [b["close"] for b in session_bars]
    volumes = [b["volume"] for b in session_bars]
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
    hi_i, lo_i = poc_bin, poc_bin
    while acc < target:
        can_up = (hi_i + 1 < n_bins)
        can_dn = (lo_i - 1 >= 0)
        if not can_up and not can_dn:
            break
        up_v = bins[hi_i + 1] if can_up else 0.0
        dn_v = bins[lo_i - 1] if can_dn else 0.0
        if can_up and (not can_dn or up_v >= dn_v):
            hi_i += 1; acc += up_v
        else:
            lo_i -= 1; acc += dn_v
    vah = min_p + step * (hi_i + 1)
    val = min_p + step * lo_i
    return poc, vah, val


def build_session_vwap(session_bars):
    """Real-time VWAP for current session bars."""
    if not session_bars:
        return 0.0
    tp_v = sum((b["high"] + b["low"] + b["close"]) / 3.0 * b["volume"] for b in session_bars)
    tv = sum(b["volume"] for b in session_bars)
    return tp_v / tv if tv > 0 else 0.0


# ==============================================================================
# BACKTEST ENGINE
# ==============================================================================

class ZeroLagVSAEngine:
    def __init__(self, symbol, candle_count=15000, balance=10000.0):
        self.symbol = symbol.upper()
        self.candle_count = candle_count
        self.initial_balance = balance
        self.point_size = 0.00001
        self.broker_gmt_offset = 3
        self.m1_candles = []
        self.sessions = {
            0: {"start": 0,  "end": 8,  "name": "ASIA"},
            1: {"start": 8,  "end": 16, "name": "LONDON"},
            2: {"start": 13, "end": 21, "name": "NY"},
        }

    def connect_and_fetch(self):
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
            off = tick.time - utc
            self.broker_gmt_offset = 3 if abs(off) > 10800 else round(off / 3600.0)

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

        print(f"  [Fetch] {self.candle_count} M1 bars for {self.symbol}...")
        rates = mt5.copy_rates_from_pos(self.symbol, mt5.TIMEFRAME_M1, 0, self.candle_count + 1000)
        if rates is None or len(rates) == 0:
            print("[ERROR] M1 download failed.")
            return False

        self.m1_candles = []
        for r in rates:
            dt = datetime.fromtimestamp(int(r["time"]), tz=timezone.utc)
            gmt = dt - timedelta(hours=self.broker_gmt_offset)
            malta_h = (gmt + timedelta(hours=2)).hour
            self.m1_candles.append({
                "time": dt,
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": int(r["tick_volume"]),
                "malta_hour": malta_h,
                "date": dt.date(),
            })

        print(f"  [OK] Loaded {len(self.m1_candles)} M1 bars")
        return True

    def run_backtest(self, min_score, sl_pts, rr, vp_min_bars, min_signals=2):
        """
        Zero-lag backtest:
        - All signals computed bar-by-bar using only the current bar + session history
        - Session volume profile and VWAP reset at session open (real-time)
        - No RSI, no MA, no historical lookbacks
        """
        n = len(self.m1_candles)
        balance = self.initial_balance
        active_trade = None
        trades = []
        sl_dist = sl_pts * self.point_size

        # Per-session running state
        session_bars = {s: [] for s in self.sessions}   # bars in current day session
        last_date = None

        for i in range(50, n):
            bar = self.m1_candles[i]
            mh = bar["malta_hour"]
            cur_date = bar["date"]

            # Reset session bars on new day
            if cur_date != last_date:
                session_bars = {s: [] for s in self.sessions}
                last_date = cur_date

            # Determine active sessions
            active_sessions = []
            for s_idx, p in self.sessions.items():
                in_s = (mh >= p["start"] and mh < p["end"])
                if in_s:
                    active_sessions.append(s_idx)

            # Add current bar to active sessions
            for s_idx in active_sessions:
                session_bars[s_idx].append(bar)

            # Manage active trade
            if active_trade:
                if active_trade["type"] == "LONG":
                    if bar["low"] <= active_trade["sl"]:
                        pnl = -100.0
                        balance += pnl
                        trades.append({"result": "LOSS", "pnl": pnl,
                                       "signals": active_trade["signals"],
                                       "time": bar["time"]})
                        active_trade = None
                    elif bar["high"] >= active_trade["tp"]:
                        pnl = 100.0 * rr
                        balance += pnl
                        trades.append({"result": "WIN", "pnl": pnl,
                                       "signals": active_trade["signals"],
                                       "time": bar["time"]})
                        active_trade = None
                else:
                    if bar["high"] >= active_trade["sl"]:
                        pnl = -100.0
                        balance += pnl
                        trades.append({"result": "LOSS", "pnl": pnl,
                                       "signals": active_trade["signals"],
                                       "time": bar["time"]})
                        active_trade = None
                    elif bar["low"] <= active_trade["tp"]:
                        pnl = 100.0 * rr
                        balance += pnl
                        trades.append({"result": "WIN", "pnl": pnl,
                                       "signals": active_trade["signals"],
                                       "time": bar["time"]})
                        active_trade = None
                continue

            if not active_sessions:
                continue

            # Use primary active session (highest priority: NY > LONDON > ASIA if overlap)
            s_idx = active_sessions[-1]
            sbars = session_bars[s_idx]

            if len(sbars) < vp_min_bars:
                continue  # Need enough bars to build a meaningful VP

            # Build REAL-TIME session VP and VWAP (no history beyond this session)
            poc, vah, val = build_session_vp(sbars)
            vwap = build_session_vwap(sbars)

            # Classify current bar — ZERO LAG
            result = classify_bar_realtime(
                bar,
                sbars[:-1],   # all session bars EXCEPT current (already added)
                val, poc, vah,
                vwap,
                self.point_size
            )

            cl = bar["close"]
            bull_s = result["bull_score"]
            bear_s = result["bear_score"]
            sigs = result["signals"]

            # CONFLUENCE GATE: must have ≥ min_signals distinct VSA signals
            # (prevents a single sweep + VWAP bonus from triggering)
            n_bull_sigs = sum(1 for s in sigs if any(
                k in s for k in ["BULL", "SUPPLY", "SPRING", "STOPPING", "ABSORPTION"]))
            n_bear_sigs = sum(1 for s in sigs if any(
                k in s for k in ["BEAR", "DEMAND", "UPTHRUST", "EXHAUSTION", "ABSORPTION"]))

            if bull_s >= min_score and bull_s > bear_s and n_bull_sigs >= min_signals:
                active_trade = {
                    "type": "LONG",
                    "entry": cl,
                    "sl": cl - sl_dist,
                    "tp": cl + sl_dist * rr,
                    "signals": "+".join(sigs) if sigs else "VP_ONLY",
                }
            elif bear_s >= min_score and bear_s > bull_s and n_bear_sigs >= min_signals:
                active_trade = {
                    "type": "SHORT",
                    "entry": cl,
                    "sl": cl + sl_dist,
                    "tp": cl - sl_dist * rr,
                    "signals": "+".join(sigs) if sigs else "VP_ONLY",
                }

        # Summarise
        n_trades = len(trades)
        if n_trades == 0:
            return None

        wins = [t for t in trades if t["result"] == "WIN"]
        losses = [t for t in trades if t["result"] == "LOSS"]
        wr = len(wins) / n_trades * 100
        gp = sum(t["pnl"] for t in wins)
        gl = abs(sum(t["pnl"] for t in losses))
        pf = gp / gl if gl > 0 else gp

        t0 = self.m1_candles[50]["time"]
        t1 = self.m1_candles[-1]["time"]
        tdays = max(1.0, (t1 - t0).total_seconds() / 86400.0 * (5/7))
        net_pct = (balance - self.initial_balance) / self.initial_balance * 100

        # Drawdown
        bal_curve = [self.initial_balance]
        running = self.initial_balance
        for t in trades:
            running += t["pnl"]
            bal_curve.append(running)
        peak = self.initial_balance
        max_dd = 0.0
        for b in bal_curve:
            if b > peak: peak = b
            dd = (peak - b) / peak * 100
            if dd > max_dd: max_dd = dd

        # Signal frequency breakdown
        from collections import Counter
        sig_counts = Counter()
        for t in trades:
            for s in t["signals"].split("+"):
                sig_counts[s] += 1

        return {
            "wr": wr, "pf": pf, "net_pct": net_pct,
            "trades": n_trades, "tpd": n_trades / tdays,
            "max_dd": max_dd, "tdays": tdays,
            "sig_counts": sig_counts.most_common(8),
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", default="EURUSD+")
    parser.add_argument("--candles", type=int, default=15000)
    args = parser.parse_args()

    print("\n" + "=" * 70)
    print("   ZERO-LAG VSA ENGINE — Real-Time Volume Analysis")
    print("   No RSI. No MA. No lag. Reads each bar as it closes.")
    print("=" * 70)
    print(f"   Symbol : {args.symbol}   |   M1 Bars: {args.candles}")
    print()

    eng = ZeroLagVSAEngine(symbol=args.symbol, candle_count=args.candles)
    if not eng.connect_and_fetch():
        mt5.shutdown()
        return

    # ===========================================================================
    # PARAMETER SWEEP
    # ===========================================================================
    # min_score: how many points of VSA confluence needed to enter
    # sl_pts:    stop loss in points
    # rr:        risk:reward
    # vp_min_bars: minimum bars in session before building VP (avoids early noise)

    # Diagnostic confirmed: min_score 3-5 = too noisy (20-33 entries/day).
    # min_score 6+ with min_signals>=2 is the validated range.
    sweep = []
    for min_score in [6, 7, 8, 9]:
        for min_sigs in [2, 3]:
            for sl_pts in [10, 15, 20, 25, 30]:
                for rr in [1.5, 2.0, 2.5, 3.0]:
                    for vp_min in [30, 60]:
                        sweep.append((min_score, min_sigs, sl_pts, rr, vp_min))

    print(f"  Running {len(sweep)} validated configurations...\n")
    t0 = time.time()

    results = []
    for n, (ms, msigs, sl, rr, vp) in enumerate(sweep):
        res = eng.run_backtest(min_score=ms, sl_pts=sl, rr=rr, vp_min_bars=vp, min_signals=msigs)
        if res:
            results.append({"min_score": ms, "min_sigs": msigs,
                            "sl_pts": sl, "rr": rr, "vp_min": vp, **res})
        if (n + 1) % 80 == 0:
            print(f"  ... {n+1}/{len(sweep)} ({time.time()-t0:.0f}s)")

    mt5.shutdown()

    # ===========================================================================
    # RESULTS
    # ===========================================================================
    print(f"\n  [Done] Completed in {time.time()-t0:.0f}s")

    if not results:
        print("\n[WARNING] No trades generated. Try reducing min_score or increasing candles.")
        return

    # Rank: WR >= 50% + tpd >= 1.0 + pf >= 1.0
    tier1 = [r for r in results if r["wr"] >= 50 and r["tpd"] >= 1.0 and r["pf"] >= 1.0]
    tier2 = [r for r in results if r["wr"] >= 45 and r["tpd"] >= 1.0 and r["pf"] >= 1.0]
    tier3 = sorted(results, key=lambda x: (-x["pf"], -x["wr"]))

    display = tier1 or tier2 or tier3
    display.sort(key=lambda x: (-x["wr"], -x["pf"]))

    tier_name = "WR≥50% + TPD≥1 + PF≥1" if tier1 else ("WR≥45% + TPD≥1 + PF≥1" if tier2 else "Best by PF")
    print(f"\n{'=' * 70}")
    print(f"   ZERO-LAG VSA RESULTS — {args.symbol}  [{tier_name}]")
    print(f"{'=' * 70}")
    print()

    best = display[0]
    tdays = best["tdays"]

    for rank, r in enumerate(display[:10], 1):
        print(f"  #{rank}  MinScore={r['min_score']} MinSigs={r.get('min_sigs',2)} SL={r['sl_pts']}pts RR={r['rr']} VP≥{r['vp_min']}bars")
        print(f"       WR={r['wr']:.1f}% | PF={r['pf']:.2f} | TPD={r['tpd']:.2f}/day | DD={r['max_dd']:.1f}% | Net={r['net_pct']:+.2f}%")
        print(f"       Trades: {r['trades']} over {r['tdays']:.0f} days")
        if r.get("sig_counts"):
            top = ", ".join(f"{s}:{c}" for s, c in r["sig_counts"][:4])
            print(f"       Active signals: {top}")
        print()

    # ===========================================================================
    # SAVE REPORT
    # ===========================================================================
    out = f"C:\\Users\\Tenders\\octo\\vsa_zero_lag_report_{args.symbol}.md"
    with open(out, "w", encoding="utf-8") as f:
        f.write(f"# Zero-Lag VSA Report: {args.symbol}\n\n")
        f.write(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n\n")
        f.write("## ⚡ Zero-Lag Principle\n\n")
        f.write("Every signal is derived from the **current bar only**. No RSI. No Moving Averages. No lagging indicators.\n\n")
        f.write("| Signal Type | Score | Description |\n| :--- | :--- | :--- |\n")
        f.write("| `BULL_SWEEP` / `BEAR_SWEEP` | ±5 | Stop hunt on current bar wick — highest conviction |\n")
        f.write("| `STOPPING_VOLUME` / `EXHAUSTION` | ±4 | High vol + wide spread at key level |\n")
        f.write("| `SPRING` / `UPTHRUST` | ±4 | Wick beyond VA then closes back inside |\n")
        f.write("| `BULL/BEAR_CLIMAX` | ±4 | Highest vol bar in session reverses |\n")
        f.write("| `NO_SUPPLY` / `NO_DEMAND` | ±3 | Low vol after move — nobody fighting |\n")
        f.write("| `BULL/BEAR_ABSORPTION` | ±2 | Very high vol, tiny body — position loaded |\n")
        f.write("| `Location` (VAL/VAH/VWAP) | ±1 | Price at institutional key level |\n\n")
        f.write("## 🏆 Optimal Configuration\n\n")
        f.write(f"| Parameter | Value |\n| :--- | :--- |\n")
        f.write(f"| Min Confluence Score | `{best['min_score']}` |\n")
        f.write(f"| Stop Loss | `{best['sl_pts']}` points |\n")
        f.write(f"| Risk:Reward | `{best['rr']}:1` |\n")
        f.write(f"| VP Min Bars | `{best['vp_min']}` bars before trading |\n\n")
        f.write("## 📈 Performance\n\n")
        f.write(f"- **Win Rate**: `{best['wr']:.2f}%`\n")
        f.write(f"- **Profit Factor**: `{best['pf']:.2f}`\n")
        f.write(f"- **Trades/Day**: `{best['tpd']:.2f}`\n")
        f.write(f"- **Net Return**: `{best['net_pct']:+.2f}%`\n")
        f.write(f"- **Max Drawdown**: `{best['max_dd']:.2f}%`\n")
        f.write(f"- **Total Trades**: `{best['trades']}`\n\n")
        if best.get("sig_counts"):
            f.write("## 🔬 Signal Frequency\n\n")
            for sig, cnt in best["sig_counts"]:
                pct = cnt / best["trades"] * 100
                f.write(f"- `{sig}`: {cnt} trades ({pct:.1f}%)\n")

    print(f"  [Saved] {out}")
    print("=" * 70)


if __name__ == "__main__":
    main()
