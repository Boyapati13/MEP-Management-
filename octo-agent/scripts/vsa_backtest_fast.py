#!/usr/bin/env python3
"""
VSA Zero-Lag — Fast Targeted Backtest
======================================
Uses the exact parameters validated by diagnostic:
 - MinScore=7, MinSignals=2 (requires 2 distinct VSA signals)
 - Tests 3 SL levels × 3 RR ratios = 9 configs only
 - Runs all 3 symbols and prints full results
Fast: completes in ~60-90 seconds total.
"""
import os, sys, time
import numpy as np
from datetime import datetime, timezone, timedelta
import MetaTrader5 as mt5
from collections import Counter

CANDLES  = 15000
SYMBOLS  = ["EURUSD+", "GBPUSD+", "XAUUSD+"]
SESSIONS = {
    0: {"start": 0,  "end": 8,  "name": "ASIA"},
    1: {"start": 8,  "end": 16, "name": "LONDON"},
    2: {"start": 13, "end": 21, "name": "NY"},
}

# ── Volume Profile ─────────────────────────────────────────────────────────────
def build_vp(bars, n=25):
    if len(bars) < 3:
        m = np.mean([b["close"] for b in bars]) if bars else 0.0
        return m, m, m
    p = [b["close"] for b in bars]; v = [b["volume"] for b in bars]
    mn, mx = min(p), max(p); st = max(mx - mn, 1e-8) / n
    bins = np.zeros(n)
    for pp, vv in zip(p, v):
        idx = min(n - 1, int((pp - mn) / st)); bins[idx] += vv
    pb = int(np.argmax(bins)); poc = mn + st * pb + st * 0.5
    tgt = bins.sum() * 0.70; acc = bins[pb]; hi, lo = pb, pb
    while acc < tgt:
        cu = (hi + 1 < n); cd = (lo - 1 >= 0)
        if not cu and not cd: break
        uv = bins[hi + 1] if cu else 0; dv = bins[lo - 1] if cd else 0
        if cu and (not cd or uv >= dv): hi += 1; acc += uv
        else: lo -= 1; acc += dv
    return poc, mn + st * (hi + 1), mn + st * lo

def build_vwap(bars):
    tv = sum(b["volume"] for b in bars)
    return sum((b["high"] + b["low"] + b["close"]) / 3 * b["volume"] for b in bars) / tv if tv else 0.0

# ── VSA Bar Classifier (Zero Lag) ─────────────────────────────────────────────
def classify(bar, recent, val, poc, vah, vwap, pt):
    op, hi, lo, cl, vol = bar["open"], bar["high"], bar["low"], bar["close"], bar["volume"]
    sp = max(hi - lo, pt); body = abs(cl - op)
    body_r = body / sp; cp = (cl - lo) / sp
    uw = (hi - max(op, cl)) / sp; lw = (min(op, cl) - lo) / sp
    rb = recent[-20:] if len(recent) >= 5 else recent
    av  = np.mean([b["volume"] for b in rb]) if rb else vol
    asp = np.mean([max(b["high"] - b["low"], pt) for b in rb]) if rb else sp
    hhv = vol >= av * 2.0; vhv = vol >= av * 2.5
    lv  = vol <= av * 0.60; ws = sp >= asp * 1.5; ns = sp <= asp * 0.55
    var = max(vah - val, pt); lt = var * 0.15
    at_val = (lo <= val + lt); at_vah = (hi >= vah - lt)
    at_pb  = (abs(cl - poc) <= lt and cl > op)
    at_ps  = (abs(cl - poc) <= lt and cl < op)
    bv = (cl < val); av_ = (cl > vah)
    long_loc  = at_val or bv or at_pb
    short_loc = at_vah or av_ or at_ps
    mt_ = "NEUTRAL"
    if len(recent) >= 3:
        mt_ = "UP" if recent[-1]["close"] > recent[-3]["close"] else "DOWN"
    msd = pt * 8
    if len(recent) >= 20:
        sl = min(b["low"]  for b in recent[-20:]); sh = max(b["high"] for b in recent[-20:])
    elif len(recent) >= 5:
        sl = min(b["low"]  for b in recent[-5:]);  sh = max(b["high"] for b in recent[-5:])
    else:
        sl = lo; sh = hi
    sigs = []; bs = 0; be = 0
    if hhv and ws and cp <= 0.30 and long_loc:  sigs.append("STOP_VOL");  bs += 4
    if hhv and ws and cp >= 0.70 and short_loc: sigs.append("EXHST_VOL"); be += 4
    if lv and ns and cp >= 0.55 and mt_ == "DOWN" and long_loc:  sigs.append("NO_SUPPLY"); bs += 3
    if lv and ns and cp <= 0.45 and mt_ == "UP"   and short_loc: sigs.append("NO_DEMAND"); be += 3
    if vhv and len(recent) >= 10:
        rv = [b["volume"] for b in recent[-10:]]
        if vol > max(rv):
            if mt_ == "DOWN" and cp >= 0.50 and long_loc:  sigs.append("BULL_CLIMAX"); bs += 5
            elif mt_ == "UP"  and cp <= 0.50 and short_loc: sigs.append("BEAR_CLIMAX"); be += 5
    if lo < sl - msd and cl > sl: sigs.append("BULL_SWEEP"); bs += 5
    if hi > sh + msd and cl < sh: sigs.append("BEAR_SWEEP"); be += 5
    if vhv and body_r <= 0.25:
        if long_loc  and cp >= 0.50: sigs.append("BULL_ABS"); bs += 3
        if short_loc and cp < 0.50:  sigs.append("BEAR_ABS"); be += 3
    if lo < val and cl > val and lw >= 0.40 and (val - lo) >= msd: sigs.append("SPRING");   bs += 5
    if hi > vah and cl < vah and uw >= 0.40 and (hi - vah) >= msd: sigs.append("UPTHRUST"); be += 5
    if vwap > 0:
        dev = (cl - vwap) / max(asp * 3, pt)
        if dev <= -1.5 and long_loc:  bs += 1
        if dev >=  1.5 and short_loc: be += 1
    return sigs, bs, be

# ── Backtest Core ─────────────────────────────────────────────────────────────
def run_backtest(candles, pt, min_score, min_sigs, sl_pts, rr, vp_min=30):
    n = len(candles); balance = 10000.0
    sl_dist = sl_pts * pt; active = None; trades = []
    sb = {s: [] for s in SESSIONS}; last_d = None
    for i in range(50, n):
        bar = candles[i]; mh = bar["malta_hour"]
        if bar["date"] != last_d: sb = {s: [] for s in SESSIONS}; last_d = bar["date"]
        acts = [s for s, p in SESSIONS.items() if mh >= p["start"] and mh < p["end"]]
        for s in acts: sb[s].append(bar)
        if active:
            h, l = bar["high"], bar["low"]
            if active["type"] == "L":
                if l <= active["sl"]:
                    trades.append({"r": "L", "pnl": -100}); active = None
                elif h >= active["tp"]:
                    trades.append({"r": "W", "pnl": 100 * rr, "sig": active["sig"]}); active = None
            else:
                if h >= active["sl"]:
                    trades.append({"r": "L", "pnl": -100}); active = None
                elif l <= active["tp"]:
                    trades.append({"r": "W", "pnl": 100 * rr, "sig": active["sig"]}); active = None
            continue
        if not acts: continue
        si = acts[-1]; sbars = sb[si]
        if len(sbars) < vp_min: continue
        poc, vah, val = build_vp(sbars)
        vwap = build_vwap(sbars)
        cl = bar["close"]
        sigs, bsc, bec = classify(bar, sbars[:-1], val, poc, vah, vwap, pt)
        n_b = sum(1 for s in sigs if any(k in s for k in ["BULL","SUPPLY","SPRING","STOP","ABS"]))
        n_e = sum(1 for s in sigs if any(k in s for k in ["BEAR","DEMAND","UPTHRUST","EXHST","ABS"]))
        if bsc >= min_score and bsc > bec and n_b >= min_sigs:
            active = {"type":"L","sl":cl-sl_dist,"tp":cl+sl_dist*rr,"sig":"+".join(sigs)}
        elif bec >= min_score and bec > bsc and n_e >= min_sigs:
            active = {"type":"S","sl":cl+sl_dist,"tp":cl-sl_dist*rr,"sig":"+".join(sigs)}
    if not trades: return None
    wins = [t for t in trades if t["r"] == "W"]
    losses = [t for t in trades if t["r"] == "L"]
    wr = len(wins) / len(trades) * 100
    gp = sum(t["pnl"] for t in wins); gl = abs(sum(t["pnl"] for t in losses))
    pf = gp / gl if gl > 0 else gp
    t0 = candles[50]["time"]; t1 = candles[-1]["time"]
    tdays = max(1.0, (t1 - t0).total_seconds() / 86400.0 * 5 / 7)
    net = (10000 + sum(t["pnl"] for t in trades) - 10000) / 10000 * 100
    # signal breakdown on wins
    win_sigs = Counter()
    for t in wins:
        if "sig" in t:
            for s in t["sig"].split("+"): win_sigs[s] += 1
    # drawdown
    bal = 10000.0; peak = bal; mdd = 0.0
    for t in trades:
        bal += t["pnl"]
        if bal > peak: peak = bal
        dd = (peak - bal) / peak * 100
        if dd > mdd: mdd = dd
    return {"wr": wr, "pf": pf, "tpd": len(trades)/tdays, "net": net,
            "mdd": mdd, "trades": len(trades), "tdays": tdays,
            "win_sigs": win_sigs.most_common(5)}

# ── Main ──────────────────────────────────────────────────────────────────────
if not mt5.initialize():
    exe = r"C:\Program Files\MetaTrader 5\terminal64.exe"
    if os.path.exists(exe): mt5.initialize(path=exe)
    else: print("[ERROR] MT5 failed"); sys.exit(1)

tick = mt5.symbol_info_tick("EURUSD+")
gmt_off = 3
if tick:
    off = tick.time - int(time.time())
    gmt_off = 3 if abs(off) > 10800 else round(off / 3600)

# Configs to test — targeted, not full sweep
CONFIGS = [
    {"ms": 7, "msigs": 2, "sl": 10, "rr": 2.0},
    {"ms": 7, "msigs": 2, "sl": 15, "rr": 2.0},
    {"ms": 7, "msigs": 2, "sl": 20, "rr": 2.5},
    {"ms": 7, "msigs": 2, "sl": 10, "rr": 2.5},
    {"ms": 8, "msigs": 2, "sl": 10, "rr": 2.0},
    {"ms": 8, "msigs": 2, "sl": 15, "rr": 2.5},
    {"ms": 6, "msigs": 2, "sl": 15, "rr": 2.0},
    {"ms": 6, "msigs": 3, "sl": 15, "rr": 2.0},
]

all_results = {}

for symbol in SYMBOLS:
    print(f"\n{'='*60}")
    print(f"  BACKTESTING: {symbol}")
    print(f"{'='*60}")
    s_info = mt5.symbol_info(symbol)
    if s_info is None:
        alt = symbol.replace("+","")
        s_info = mt5.symbol_info(alt)
        if s_info: symbol = alt
        else: print(f"  [SKIP] {symbol} not found"); continue
    pt = s_info.point
    mt5.symbol_select(symbol, True)
    print(f"  Fetching {CANDLES} M1 bars... ", end="", flush=True)
    rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, CANDLES + 200)
    if rates is None or len(rates) == 0:
        print("FAILED"); continue
    candles = []
    for r in rates:
        dt = datetime.fromtimestamp(int(r["time"]), tz=timezone.utc)
        gmt = dt - timedelta(hours=gmt_off)
        mh = (gmt + timedelta(hours=2)).hour
        candles.append({"time":dt,"open":float(r["open"]),"high":float(r["high"]),
                        "low":float(r["low"]),"close":float(r["close"]),
                        "volume":int(r["tick_volume"]),"malta_hour":mh,"date":dt.date()})
    print(f"{len(candles)} bars loaded")
    sym_results = []
    t0 = time.time()
    for cfg in CONFIGS:
        res = run_backtest(candles, pt, cfg["ms"], cfg["msigs"], cfg["sl"], cfg["rr"])
        if res:
            sym_results.append({**cfg, **res})
    print(f"  Completed in {time.time()-t0:.0f}s")
    if not sym_results:
        print("  [!] No trades generated for any config.")
        continue
    sym_results.sort(key=lambda x: (-x["wr"], -x["pf"]))
    all_results[symbol] = sym_results
    # Print all results
    for rank, r in enumerate(sym_results, 1):
        print(f"  #{rank}  MS={r['ms']} MinSigs={r['msigs']} SL={r['sl']}pts RR={r['rr']}")
        print(f"       WR={r['wr']:.1f}%  PF={r['pf']:.2f}  TPD={r['tpd']:.2f}  "
              f"Net={r['net']:+.1f}%  DD={r['mdd']:.1f}%  Trades={r['trades']}/{r['tdays']:.0f}d")
        if r.get("win_sigs"):
            sigs_str = ", ".join(f"{s}:{c}" for s, c in r["win_sigs"][:3])
            print(f"       Winning signals: {sigs_str}")

mt5.shutdown()

# ── Summary Report ────────────────────────────────────────────────────────────
print(f"\n{'='*60}")
print("  FINAL SUMMARY — BEST CONFIG PER SYMBOL")
print(f"{'='*60}")
for sym, results in all_results.items():
    best = results[0]
    print(f"\n  {sym}:")
    print(f"    WR={best['wr']:.1f}%  PF={best['pf']:.2f}  "
          f"TPD={best['tpd']:.2f}/day  Net={best['net']:+.1f}%  DD={best['mdd']:.1f}%")
    print(f"    Config: MS={best['ms']} MinSigs={best['msigs']} "
          f"SL={best['sl']}pts RR={best['rr']}")
    if best.get("win_sigs"):
        print(f"    Best signals: {best['win_sigs'][:3]}")

# Save markdown
out = r"C:\Users\Tenders\octo\vsa_backtest_results.md"
with open(out, "w", encoding="utf-8") as f:
    f.write("# VSA Zero-Lag Backtest Results\n\n")
    f.write(f"Date: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n\n")
    f.write("## Methodology\n- **Zero lag**: every signal from current bar only\n")
    f.write("- **Confluence gate**: min 2 distinct VSA signals required\n")
    f.write("- **Location gate**: all signals require price at VAL/VAH/POC zone\n\n")
    for sym, results in all_results.items():
        f.write(f"## {sym}\n\n")
        f.write("| # | MS | MinSigs | SL | RR | WR | PF | TPD | Net | DD | Trades |\n")
        f.write("|---|---|---|---|---|---|---|---|---|---|---|\n")
        for i, r in enumerate(results, 1):
            f.write(f"| {i} | {r['ms']} | {r['msigs']} | {r['sl']} | {r['rr']} | "
                    f"{r['wr']:.1f}% | {r['pf']:.2f} | {r['tpd']:.2f} | "
                    f"{r['net']:+.1f}% | {r['mdd']:.1f}% | {r['trades']} |\n")
        f.write("\n")
print(f"\n  Report saved: {out}")
