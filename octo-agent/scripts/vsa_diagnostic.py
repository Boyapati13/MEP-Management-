#!/usr/bin/env python3
"""
VSA Engine Diagnostic Test
===========================
Tests BEFORE the full sweep:
1. Connects to MT5 and fetches a small M1 sample
2. Runs through the VSA bar classifier and prints EVERY signal found
3. Shows how many signals per session, per type
4. Shows a sample trade walkthrough so you can verify the logic visually
5. Reports the raw signal frequency BEFORE any backtest
Run this FIRST before running vsa_zero_lag_engine.py
"""

import os, sys, time
import numpy as np
from datetime import datetime, timezone, timedelta
import MetaTrader5 as mt5

# --- copy the same classify function ---
def build_session_vp(session_bars, n_bins=25):
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
        if not can_up and not can_dn: break
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
    if not session_bars: return 0.0
    tp_v = sum((b["high"]+b["low"]+b["close"])/3.0*b["volume"] for b in session_bars)
    tv = sum(b["volume"] for b in session_bars)
    return tp_v / tv if tv > 0 else 0.0

def classify_bar(bar, recent_bars, val, poc, vah, vwap, point_size):
    op, hi, lo, cl, vol = bar["open"], bar["high"], bar["low"], bar["close"], bar["volume"]
    spread = max(hi - lo, point_size)
    body = abs(cl - op)
    body_ratio = body / spread
    close_pos = (cl - lo) / spread
    upper_wick = hi - max(op, cl)
    lower_wick = min(op, cl) - lo
    upper_wick_ratio = upper_wick / spread
    lower_wick_ratio = lower_wick / spread

    if len(recent_bars) >= 5:
        avg_vol = np.mean([b["volume"] for b in recent_bars[-20:]])
        avg_spread = np.mean([max(b["high"]-b["low"], point_size) for b in recent_bars[-20:]])
    else:
        avg_vol = vol; avg_spread = spread

    is_high_vol    = vol >= avg_vol * 1.5
    is_very_high   = vol >= avg_vol * 2.0
    is_low_vol     = vol <= avg_vol * 0.65
    is_wide_spread = spread >= avg_spread * 1.4
    is_narrow      = spread <= avg_spread * 0.6

    below_val = cl <= val
    above_vah = cl >= vah
    near_poc  = abs(cl - poc) <= avg_spread

    if len(recent_bars) >= 2:
        micro_trend = "UP" if recent_bars[-1]["close"] > recent_bars[-2]["close"] else "DOWN"
        prev_high = max(b["high"] for b in recent_bars[-5:]) if len(recent_bars) >= 5 else hi
        prev_low  = min(b["low"]  for b in recent_bars[-5:]) if len(recent_bars) >= 5 else lo
    else:
        micro_trend = "NEUTRAL"; prev_high = hi; prev_low = lo

    signals = []
    bull = 0; bear = 0

    if is_high_vol and is_wide_spread and close_pos <= 0.35 and (below_val or lo <= prev_low):
        signals.append("STOPPING_VOLUME"); bull += 4
    if is_high_vol and is_wide_spread and close_pos >= 0.65 and (above_vah or hi >= prev_high):
        signals.append("EXHAUSTION_VOLUME"); bear += 4
    if is_low_vol and is_narrow and close_pos >= 0.55 and micro_trend == "DOWN":
        signals.append("NO_SUPPLY"); bull += 3
    if is_low_vol and is_narrow and close_pos <= 0.45 and micro_trend == "UP":
        signals.append("NO_DEMAND"); bear += 3
    if is_very_high and len(recent_bars) >= 10:
        rv = [b["volume"] for b in recent_bars[-10:]]
        if vol > max(rv):
            if micro_trend == "DOWN" and close_pos >= 0.50:
                signals.append("BULL_CLIMAX"); bull += 4
            elif micro_trend == "UP" and close_pos <= 0.50:
                signals.append("BEAR_CLIMAX"); bear += 4
    if lo < prev_low and cl > prev_low:
        signals.append("BULL_SWEEP"); bull += 5
    if hi > prev_high and cl < prev_high:
        signals.append("BEAR_SWEEP"); bear += 5
    if is_very_high and body_ratio <= 0.30:
        if cl > recent_bars[-1]["close"] if recent_bars else True:
            signals.append("BULL_ABSORPTION"); bull += 2
        else:
            signals.append("BEAR_ABSORPTION"); bear += 2
    if lo < val and cl > val and lower_wick_ratio >= 0.35:
        signals.append("SPRING"); bull += 4
    if hi > vah and cl < vah and upper_wick_ratio >= 0.35:
        signals.append("UPTHRUST"); bear += 4
    if below_val or near_poc: bull += 1
    if above_vah or near_poc: bear += 1
    if vwap > 0:
        dev = (cl - vwap) / max(avg_spread, point_size)
        if dev <= -1.5: bull += 1
        if dev >= 1.5: bear += 1

    return signals, bull, bear, {
        "close_pos": round(close_pos, 2),
        "vol_ratio": round(vol / avg_vol, 2) if avg_vol > 0 else 0,
        "spread_ratio": round(spread / avg_spread, 2) if avg_spread > 0 else 0,
        "body_ratio": round(body_ratio, 2),
        "micro_trend": micro_trend,
        "below_val": below_val, "above_vah": above_vah, "near_poc": near_poc,
    }

# ============================================================
SYMBOL = "EURUSD+"
CANDLES = 3000   # small test — ~3 days M1
SESSIONS = {
    0: {"start": 0,  "end": 8,  "name": "ASIA"},
    1: {"start": 8,  "end": 16, "name": "LONDON"},
    2: {"start": 13, "end": 21, "name": "NY"},
}

print("\n" + "="*65)
print("   VSA ENGINE DIAGNOSTIC — TESTING BEFORE FULL SWEEP")
print("="*65)

# Connect
if not mt5.initialize():
    exe = r"C:\Program Files\MetaTrader 5\terminal64.exe"
    if os.path.exists(exe):
        mt5.initialize(path=exe)

tick = mt5.symbol_info_tick(SYMBOL)
if tick:
    off = tick.time - int(time.time())
    gmt_offset = 3 if abs(off) > 10800 else round(off / 3600.0)
else:
    gmt_offset = 3

s_info = mt5.symbol_info(SYMBOL)
if s_info is None:
    SYMBOL = SYMBOL.replace("+","")
    s_info = mt5.symbol_info(SYMBOL)

point_size = s_info.point if s_info else 0.00001
mt5.symbol_select(SYMBOL, True)

print(f"\n  Symbol: {SYMBOL}  |  Point: {point_size}  |  GMT offset: {gmt_offset}")
print(f"  Fetching {CANDLES} M1 bars...\n")

rates = mt5.copy_rates_from_pos(SYMBOL, mt5.TIMEFRAME_M1, 0, CANDLES + 100)
mt5.shutdown()

if rates is None or len(rates) == 0:
    print("[ERROR] No data returned from MT5. Is the terminal running and logged in?")
    sys.exit(1)

candles = []
for r in rates:
    dt = datetime.fromtimestamp(int(r["time"]), tz=timezone.utc)
    gmt = dt - timedelta(hours=gmt_offset)
    mh = (gmt + timedelta(hours=2)).hour
    candles.append({
        "time": dt, "open": float(r["open"]), "high": float(r["high"]),
        "low": float(r["low"]), "close": float(r["close"]),
        "volume": int(r["tick_volume"]), "malta_hour": mh, "date": dt.date()
    })

print(f"  Loaded: {len(candles)} bars")
print(f"  Range: {candles[0]['time']} → {candles[-1]['time']}")

# ============================================================
# PASS 1: RAW SIGNAL SCAN
# ============================================================
print("\n" + "-"*65)
print("  PASS 1: RAW SIGNAL SCAN (no scoring threshold)")
print("-"*65)

from collections import Counter, defaultdict
signal_counter = Counter()
session_counter = defaultdict(int)
signal_samples = {}  # first occurrence of each signal type

session_bars = {s: [] for s in SESSIONS}
last_date = None
total_bars_scanned = 0
bars_with_signals = 0

for i in range(50, len(candles)):
    bar = candles[i]
    mh = bar["malta_hour"]
    if bar["date"] != last_date:
        session_bars = {s: [] for s in SESSIONS}
        last_date = bar["date"]

    active = []
    for s_idx, p in SESSIONS.items():
        if mh >= p["start"] and mh < p["end"]:
            active.append(s_idx)
            session_bars[s_idx].append(bar)

    if not active:
        continue

    s_idx = active[-1]
    sbars = session_bars[s_idx]
    if len(sbars) < 15:
        continue

    poc, vah, val = build_session_vp(sbars)
    vwap = build_session_vwap(sbars)
    sigs, bull, bear, meta = classify_bar(bar, sbars[:-1], val, poc, vah, vwap, point_size)

    total_bars_scanned += 1
    if sigs:
        bars_with_signals += 1
        for sig in sigs:
            signal_counter[sig] += 1
            session_counter[SESSIONS[s_idx]["name"]] += 1
            if sig not in signal_samples:
                signal_samples[sig] = {
                    "time": bar["time"],
                    "bar": bar,
                    "meta": meta,
                    "val": round(val, 5),
                    "poc": round(poc, 5),
                    "vah": round(vah, 5),
                    "vwap": round(vwap, 5),
                    "bull": bull, "bear": bear,
                }

# Report
tdays = max(1.0, (candles[-1]["time"] - candles[50]["time"]).total_seconds() / 86400.0 * 5/7)
print(f"\n  Bars scanned in sessions: {total_bars_scanned}")
print(f"  Bars with ≥1 signal:      {bars_with_signals} ({bars_with_signals/total_bars_scanned*100:.1f}%)")
print(f"  Trading days in window:   {tdays:.1f}")
print(f"\n  SIGNAL FREQUENCY:")
for sig, cnt in signal_counter.most_common():
    per_day = cnt / tdays
    print(f"    {sig:<22} : {cnt:4d} total  ({per_day:.1f}/day)")

print(f"\n  BY SESSION:")
for sess, cnt in session_counter.items():
    print(f"    {sess:<10}: {cnt} signals")

# ============================================================
# PASS 2: SHOW SAMPLE SIGNALS (verify logic visually)
# ============================================================
print("\n" + "-"*65)
print("  PASS 2: SAMPLE SIGNAL WALKTHROUGHS (verify logic)")
print("-"*65)

for sig_name, sample in signal_samples.items():
    b = sample["bar"]
    m = sample["meta"]
    print(f"\n  ▶ {sig_name}")
    print(f"    Time:       {sample['time'].strftime('%Y-%m-%d %H:%M')} UTC")
    print(f"    O={b['open']:.5f}  H={b['high']:.5f}  L={b['low']:.5f}  C={b['close']:.5f}  V={b['volume']}")
    print(f"    Close pos:  {m['close_pos']} (0=bottom, 1=top)")
    print(f"    Vol ratio:  {m['vol_ratio']}× session avg")
    print(f"    Spread:     {m['spread_ratio']}× session avg spread")
    print(f"    Body ratio: {m['body_ratio']} (0=all wick, 1=all body)")
    print(f"    Micro:      {m['micro_trend']}")
    print(f"    VAL={sample['val']}  POC={sample['poc']}  VAH={sample['vah']}  VWAP={sample['vwap']}")
    print(f"    Below VAL={m['below_val']}  Above VAH={m['above_vah']}  Near POC={m['near_poc']}")
    print(f"    Bull score={sample['bull']}  Bear score={sample['bear']}")

# ============================================================
# PASS 3: SCORING THRESHOLD TEST
# ============================================================
print("\n" + "-"*65)
print("  PASS 3: TRADE ENTRY COUNT BY MIN SCORE THRESHOLD")
print("-"*65)

for min_score in [3, 4, 5, 6, 7]:
    session_bars_t = {s: [] for s in SESSIONS}
    last_date_t = None
    entries = []

    for i in range(50, len(candles)):
        bar = candles[i]
        mh = bar["malta_hour"]
        if bar["date"] != last_date_t:
            session_bars_t = {s: [] for s in SESSIONS}
            last_date_t = bar["date"]
        active = [s for s, p in SESSIONS.items() if mh >= p["start"] and mh < p["end"]]
        for s in active:
            session_bars_t[s].append(bar)
        if not active: continue
        s_idx = active[-1]
        sbars = session_bars_t[s_idx]
        if len(sbars) < 15: continue
        poc, vah, val = build_session_vp(sbars)
        vwap = build_session_vwap(sbars)
        sigs, bull, bear, _ = classify_bar(bar, sbars[:-1], val, poc, vah, vwap, point_size)
        if bull >= min_score and bull > bear:
            entries.append(("BUY", bar["time"], "+".join(sigs)))
        elif bear >= min_score and bear > bull:
            entries.append(("SELL", bar["time"], "+".join(sigs)))

    tpd = len(entries) / tdays
    print(f"  MinScore={min_score}: {len(entries):4d} total entries  ({tpd:.2f}/day)")
    # Show first 3 for this threshold
    for direction, t, sigs in entries[:3]:
        print(f"          {direction}  @{t.strftime('%m/%d %H:%M')}  signals=[{sigs}]")

print("\n" + "="*65)
print("  DIAGNOSTIC COMPLETE.")
print("  ✓ If signal counts are reasonable (10-50/day raw, 2-8/day gated)")
print("    → Run the full sweep:  py octo/scripts/vsa_zero_lag_engine.py --symbol EURUSD+")
print("  ✗ If 0 signals or 0 entries → check MT5 connection / symbol name")
print("="*65)
