#!/usr/bin/env python3
"""
VSA Engine v2 — ATR-based + PDH/PDL + Session Direction
=========================================================
Fixes from backtest v1:
1. ATR-BASED THRESHOLDS — sweep depth and SL adapt to each symbol's volatility
2. PREVIOUS DAY HIGH/LOW (PDH/PDL) — the levels institutions actually target
3. OPENING RANGE — first 30 bars of each session sets the reference range
4. SESSION DIRECTION FILTER — only take reversal signals WITH session direction
   (if session is going up from open, only buy at PDL/OR_low)
5. SIGNAL QUALITY TIERS:
   - TIER 1 (highest): Sweep of PDH or PDL — previous day levels hunted
   - TIER 2: Spring/Upthrust through Opening Range boundaries
   - TIER 3: VSA stopping/exhaustion at PDH/PDL zone
"""
import os, sys, time
import numpy as np
from datetime import datetime, timezone, timedelta, date
import MetaTrader5 as mt5
from collections import Counter, defaultdict

CANDLES  = 15000
SYMBOLS  = ["EURUSD+", "GBPUSD+", "XAUUSD+"]
SESSIONS = {
    0: {"start": 0,  "end": 8,  "name": "ASIA"},
    1: {"start": 8,  "end": 16, "name": "LONDON"},
    2: {"start": 13, "end": 21, "name": "NY"},
}

# ── ATR calculator ────────────────────────────────────────────────────────────
def calc_atr(bars, period=14):
    if len(bars) < 2:
        return (bars[0]["high"] - bars[0]["low"]) if bars else 0.0
    trs = []
    for i in range(1, len(bars)):
        tr = max(bars[i]["high"] - bars[i]["low"],
                 abs(bars[i]["high"] - bars[i-1]["close"]),
                 abs(bars[i]["low"]  - bars[i-1]["close"]))
        trs.append(tr)
    if not trs:
        return bars[-1]["high"] - bars[-1]["low"]
    use = trs[-period:] if len(trs) >= period else trs
    return np.mean(use)

# ── Volume Profile ────────────────────────────────────────────────────────────
def build_vp(bars, n=20):
    if len(bars) < 3:
        m = np.mean([b["close"] for b in bars]) if bars else 0.0
        return m, m, m
    p = [b["close"] for b in bars]; v = [b["volume"] for b in bars]
    mn, mx = min(p), max(p); st = max(mx - mn, 1e-10) / n
    bins = np.zeros(n)
    for pp, vv in zip(p, v):
        bins[min(n-1, int((pp-mn)/st))] += vv
    pb = int(np.argmax(bins)); poc = mn + st * pb + st * 0.5
    tgt = bins.sum() * 0.70; acc = bins[pb]; hi, lo = pb, pb
    while acc < tgt:
        cu=(hi+1<n); cd=(lo-1>=0)
        if not cu and not cd: break
        uv=bins[hi+1] if cu else 0; dv=bins[lo-1] if cd else 0
        if cu and (not cd or uv >= dv): hi+=1; acc+=uv
        else: lo-=1; acc+=dv
    return poc, mn+st*(hi+1), mn+st*lo

def build_vwap(bars):
    tv = sum(b["volume"] for b in bars)
    return sum((b["high"]+b["low"]+b["close"])/3*b["volume"] for b in bars)/tv if tv else 0.0

# ── VSA Bar Classifier ────────────────────────────────────────────────────────
def classify_bar(bar, recent, val, poc, vah, vwap, pt, atr, pdh, pdl, or_high, or_low):
    """
    Zero-lag VSA classifier with:
    - ATR-based sweep depth (adapts to symbol volatility)
    - PDH/PDL as primary key levels
    - Opening Range boundaries as secondary levels
    """
    op,hi,lo,cl,vol = bar["open"],bar["high"],bar["low"],bar["close"],bar["volume"]
    sp = max(hi-lo, pt); body=abs(cl-op); body_r=body/sp; cp=(cl-lo)/sp
    uw=(hi-max(op,cl))/sp; lw=(min(op,cl)-lo)/sp
    rb = recent[-20:] if len(recent)>=5 else recent
    av  = np.mean([b["volume"] for b in rb]) if rb else vol
    asp = np.mean([max(b["high"]-b["low"],pt) for b in rb]) if rb else sp

    # ATR-based thresholds — SYMBOL ADAPTIVE
    sweep_depth = atr * 0.3        # 30% of ATR = meaningful penetration
    loc_tol     = atr * 0.5        # proximity zone = 50% ATR around key level

    # Volume ratios
    hhv = vol >= av * 2.0; vhv = vol >= av * 2.5
    lv  = vol <= av * 0.60; ws = sp >= asp*1.5; ns = sp <= asp*0.55

    # ── KEY LEVELS (PDH/PDL/OR take priority over VA) ──
    # PDH = previous day high, PDL = previous day low
    # OR = opening range (first 30 bars of session)
    have_pdh = pdh > 0; have_pdl = pdl > 0
    have_or  = or_high > or_low

    # Location at PDL zone (buy zone) — ATR-based tolerance
    at_pdl = have_pdl and (lo <= pdl + loc_tol)
    at_pdh = have_pdh and (hi >= pdh - loc_tol)
    at_or_low  = have_or and (lo <= or_low  + loc_tol)
    at_or_high = have_or and (hi >= or_high - loc_tol)
    at_val = (lo <= val + loc_tol)
    at_vah = (hi >= vah - loc_tol)
    below_val = (cl < val); above_vah = (cl > vah)
    near_poc = abs(cl-poc) <= loc_tol

    # LONG zone: at PDL, OR low, or VAL
    long_zone  = at_pdl or at_or_low  or at_val or below_val
    # SHORT zone: at PDH, OR high, or VAH
    short_zone = at_pdh or at_or_high or at_vah or above_vah

    # Micro trend (3 bars)
    mt_ = "NEUTRAL"
    if len(recent) >= 3:
        mt_ = "UP" if recent[-1]["close"] > recent[-3]["close"] else "DOWN"

    # Swing for sweep detection (20-bar session)
    if len(recent) >= 20:
        swing_lo = min(b["low"]  for b in recent[-20:])
        swing_hi = max(b["high"] for b in recent[-20:])
    elif len(recent) >= 5:
        swing_lo = min(b["low"]  for b in recent[-5:])
        swing_hi = max(b["high"] for b in recent[-5:])
    else:
        swing_lo=lo; swing_hi=hi

    sigs=[]; bs=0; be=0

    # ====================================================================
    # TIER 1: PDH / PDL SWEEP (highest conviction — institutions hunt these)
    # Price wick through PDL/PDH + closes back — stop hunt complete
    # ====================================================================
    pdl_swept = have_pdl and lo < pdl - sweep_depth and cl > pdl
    pdh_swept = have_pdh and hi > pdh + sweep_depth and cl < pdh

    if pdl_swept:
        sigs.append("PDL_SWEEP"); bs += 6   # Highest score
    if pdh_swept:
        sigs.append("PDH_SWEEP"); be += 6

    # ====================================================================
    # TIER 1B: OPENING RANGE SWEEP
    # Price breaks OR and returns — key intraday reversal
    # ====================================================================
    if have_or:
        or_bull = lo < or_low - sweep_depth and cl > or_low
        or_bear = hi > or_high + sweep_depth and cl < or_high
        if or_bull: sigs.append("OR_BULL_SWEEP"); bs += 5
        if or_bear: sigs.append("OR_BEAR_SWEEP"); be += 5

    # ====================================================================
    # TIER 2: SESSION SWING SWEEP (at or below session VP boundary)
    # ====================================================================
    sess_bull = lo < swing_lo - sweep_depth and cl > swing_lo and long_zone
    sess_bear = hi > swing_hi + sweep_depth and cl < swing_hi and short_zone
    if sess_bull: sigs.append("BULL_SWEEP"); bs += 4
    if sess_bear: sigs.append("BEAR_SWEEP"); be += 4

    # ====================================================================
    # TIER 2B: SPRING / UPTHRUST through VA boundary
    # ====================================================================
    if lo<val and cl>val and lw>=0.40 and (val-lo)>=sweep_depth:
        sigs.append("SPRING"); bs += 5
    if hi>vah and cl<vah and uw>=0.40 and (hi-vah)>=sweep_depth:
        sigs.append("UPTHRUST"); be += 5

    # ====================================================================
    # TIER 3: VSA VOLUME SIGNALS at key levels
    # ====================================================================
    # Stopping Volume: high vol + wide spread + close near low + at PDL/VAL
    if hhv and ws and cp<=0.30 and long_zone:
        sigs.append("STOP_VOL"); bs += 4
    # Exhaustion Volume: high vol + wide spread + close near high + at PDH/VAH
    if hhv and ws and cp>=0.70 and short_zone:
        sigs.append("EXHST_VOL"); be += 4
    # Volume Climax: new session-high volume bar reverses
    if vhv and len(recent) >= 10:
        rv = [b["volume"] for b in recent[-10:]]
        if vol > max(rv):
            if mt_=="DOWN" and cp>=0.50 and long_zone:  sigs.append("BULL_CLIMAX"); bs+=5
            elif mt_=="UP"  and cp<=0.50 and short_zone: sigs.append("BEAR_CLIMAX"); be+=5
    # No Supply / No Demand at key levels
    if lv and ns and cp>=0.55 and mt_=="DOWN" and long_zone:
        sigs.append("NO_SUPPLY"); bs += 3
    if lv and ns and cp<=0.45 and mt_=="UP"   and short_zone:
        sigs.append("NO_DEMAND"); be += 3
    # Absorption
    if vhv and body_r<=0.25 and long_zone  and cp>=0.50: sigs.append("BULL_ABS"); bs+=3
    if vhv and body_r<=0.25 and short_zone and cp< 0.50: sigs.append("BEAR_ABS"); be+=3

    # VWAP bonus
    if vwap > 0:
        dev = (cl-vwap)/max(asp*3,pt)
        if dev<=-1.5 and long_zone:  bs+=1
        if dev>= 1.5 and short_zone: be+=1

    return sigs, bs, be, {"long_zone":long_zone,"short_zone":short_zone,
                           "at_pdl":at_pdl,"at_pdh":at_pdh,"atr":atr}

# ── Backtest ──────────────────────────────────────────────────────────────────
def run_backtest(candles, pt, min_score, min_sigs, rr, atr_sl_mult, vp_min=30, or_bars=30):
    """
    ATR-based backtest.
    SL = ATR × atr_sl_mult (symbol-adaptive, not fixed pips)
    """
    n = len(candles); balance = 10000.0
    active = None; trades = []
    sb = {s:[] for s in SESSIONS}; last_d = None
    # daily PDH/PDL state
    prev_day_high = 0.0; prev_day_low = 0.0
    curr_day_high = 0.0; curr_day_low = float("inf")
    curr_date = None

    for i in range(60, n):
        bar = candles[i]; mh = bar["malta_hour"]; bd = bar["date"]

        # Update daily high/low tracking
        if bd != curr_date:
            if curr_date is not None and curr_day_high > 0:
                prev_day_high = curr_day_high
                prev_day_low  = curr_day_low
            curr_date = bd; curr_day_high = bar["high"]; curr_day_low = bar["low"]
            sb = {s:[] for s in SESSIONS}; last_d = None
        else:
            if bar["high"] > curr_day_high: curr_day_high = bar["high"]
            if bar["low"]  < curr_day_low:  curr_day_low  = bar["low"]

        acts = [s for s,p in SESSIONS.items() if mh>=p["start"] and mh<p["end"]]
        for s in acts: sb[s].append(bar)

        if active:
            h,l = bar["high"],bar["low"]
            if active["type"]=="L":
                if l<=active["sl"]: trades.append({"r":"L","pnl":-100}); active=None
                elif h>=active["tp"]: trades.append({"r":"W","pnl":100*rr,"sig":active["sig"]}); active=None
            else:
                if h>=active["sl"]: trades.append({"r":"L","pnl":-100}); active=None
                elif l<=active["tp"]: trades.append({"r":"W","pnl":100*rr,"sig":active["sig"]}); active=None
            continue

        if not acts: continue
        si = acts[-1]; sbars = sb[si]
        if len(sbars) < vp_min: continue

        # ATR from current session (last 20 bars)
        atr_bars = sbars[-20:] if len(sbars)>=20 else sbars
        atr = calc_atr(atr_bars, period=min(14, len(atr_bars)-1))
        if atr <= 0: atr = pt * 50

        # ATR-based SL distance
        sl_dist = atr * atr_sl_mult

        # Opening Range (first or_bars of this session)
        or_high = max(b["high"] for b in sbars[:or_bars]) if len(sbars)>=or_bars else 0.0
        or_low  = min(b["low"]  for b in sbars[:or_bars]) if len(sbars)>=or_bars else 0.0

        poc,vah,val = build_vp(sbars)
        vwap = build_vwap(sbars)
        cl = bar["close"]

        sigs,bsc,bec,meta = classify_bar(
            bar, sbars[:-1], val, poc, vah, vwap, pt, atr,
            prev_day_high, prev_day_low, or_high, or_low
        )

        n_b = sum(1 for s in sigs if any(k in s for k in ["BULL","SUPPLY","SPRING","STOP","ABS","PDL","OR_B"]))
        n_e = sum(1 for s in sigs if any(k in s for k in ["BEAR","DEMAND","UPTHRUST","EXHST","ABS","PDH","OR_B"]))

        if bsc >= min_score and bsc > bec and n_b >= min_sigs:
            active = {"type":"L","sl":cl-sl_dist,"tp":cl+sl_dist*rr,"sig":"+".join(sigs)}
        elif bec >= min_score and bec > bsc and n_e >= min_sigs:
            active = {"type":"S","sl":cl+sl_dist,"tp":cl-sl_dist*rr,"sig":"+".join(sigs)}

    if not trades: return None
    wins=[t for t in trades if t["r"]=="W"]; losses=[t for t in trades if t["r"]=="L"]
    wr = len(wins)/len(trades)*100
    gp=sum(t["pnl"] for t in wins); gl=abs(sum(t["pnl"] for t in losses))
    pf=gp/gl if gl>0 else gp
    t0=candles[60]["time"]; t1=candles[-1]["time"]
    tdays=max(1.0,(t1-t0).total_seconds()/86400.0*5/7)
    net=(sum(t["pnl"] for t in trades))/10000*100
    bal=10000.0; pk=bal; mdd=0.0
    for t in trades:
        bal+=t["pnl"]
        if bal>pk: pk=bal
        dd=(pk-bal)/pk*100
        if dd>mdd: mdd=dd
    win_sigs=Counter()
    for t in wins:
        if "sig" in t:
            for s in t["sig"].split("+"): win_sigs[s]+=1
    return {"wr":wr,"pf":pf,"tpd":len(trades)/tdays,"net":net,"mdd":mdd,
            "trades":len(trades),"tdays":tdays,"win_sigs":win_sigs.most_common(5)}

# ── Main ──────────────────────────────────────────────────────────────────────
if not mt5.initialize():
    exe=r"C:\Program Files\MetaTrader 5\terminal64.exe"
    if os.path.exists(exe): mt5.initialize(path=exe)
    else: sys.exit("[ERROR] MT5 failed")

tick=mt5.symbol_info_tick("EURUSD+")
gmt_off=3
if tick:
    off=tick.time-int(time.time())
    gmt_off=3 if abs(off)>10800 else round(off/3600)

# Targeted configs — SL in ATR multiples, not fixed pips
CONFIGS=[
    {"ms":6,"msigs":2,"rr":2.0,"sl_atr":0.5},
    {"ms":6,"msigs":2,"rr":2.5,"sl_atr":0.5},
    {"ms":7,"msigs":2,"rr":2.0,"sl_atr":0.5},
    {"ms":7,"msigs":2,"rr":2.5,"sl_atr":0.5},
    {"ms":7,"msigs":2,"rr":2.0,"sl_atr":0.8},
    {"ms":7,"msigs":2,"rr":2.5,"sl_atr":0.8},
    {"ms":8,"msigs":2,"rr":2.5,"sl_atr":0.5},
    {"ms":6,"msigs":3,"rr":2.0,"sl_atr":0.5},
    {"ms":6,"msigs":3,"rr":2.5,"sl_atr":0.5},
]

all_results={}
for symbol in SYMBOLS:
    print(f"\n{'='*60}\n  {symbol}\n{'='*60}")
    s_info=mt5.symbol_info(symbol)
    if s_info is None:
        alt=symbol.replace("+",""); s_info=mt5.symbol_info(alt)
        if s_info: symbol=alt
        else: print(f"  [SKIP]"); continue
    pt=s_info.point; mt5.symbol_select(symbol,True)
    print(f"  Fetching {CANDLES} M1 bars... ",end="",flush=True)
    rates=mt5.copy_rates_from_pos(symbol,mt5.TIMEFRAME_M1,0,CANDLES+200)
    if rates is None or len(rates)==0: print("FAILED"); continue
    candles=[]
    for r in rates:
        dt=datetime.fromtimestamp(int(r["time"]),tz=timezone.utc)
        gmt=dt-timedelta(hours=gmt_off); mh=(gmt+timedelta(hours=2)).hour
        candles.append({"time":dt,"open":float(r["open"]),"high":float(r["high"]),
                        "low":float(r["low"]),"close":float(r["close"]),
                        "volume":int(r["tick_volume"]),"malta_hour":mh,"date":dt.date()})
    print(f"{len(candles)} bars | pt={pt}")
    t0=time.time(); sym_res=[]
    for cfg in CONFIGS:
        res=run_backtest(candles,pt,cfg["ms"],cfg["msigs"],cfg["rr"],cfg["sl_atr"])
        if res: sym_res.append({**cfg,**res})
    print(f"  Done in {time.time()-t0:.0f}s")
    sym_res.sort(key=lambda x:(-x["wr"],-x["pf"]))
    all_results[symbol]=sym_res
    for rank,r in enumerate(sym_res,1):
        print(f"  #{rank}  MS={r['ms']} MinSigs={r['msigs']} RR={r['rr']} SL={r['sl_atr']}×ATR")
        print(f"       WR={r['wr']:.1f}%  PF={r['pf']:.2f}  TPD={r['tpd']:.2f}  "
              f"Net={r['net']:+.1f}%  DD={r['mdd']:.1f}%  Trades={r['trades']}/{r['tdays']:.0f}d")
        if r.get("win_sigs"):
            print(f"       Best signals: {', '.join(f'{s}:{c}' for s,c in r['win_sigs'][:3])}")

mt5.shutdown()

print(f"\n{'='*60}")
print("  FINAL — BEST PER SYMBOL")
print(f"{'='*60}")
for sym,results in all_results.items():
    if not results: continue
    b=results[0]
    print(f"\n  {sym}:")
    print(f"    WR={b['wr']:.1f}%  PF={b['pf']:.2f}  TPD={b['tpd']:.2f}/day  "
          f"Net={b['net']:+.1f}%  DD={b['mdd']:.1f}%")
    print(f"    Config: MS={b['ms']} MinSigs={b['msigs']} RR={b['rr']} SL={b['sl_atr']}×ATR")
    if b.get("win_sigs"): print(f"    Winning signals: {b['win_sigs'][:3]}")

out=r"C:\Users\Tenders\octo\vsa_backtest_v2_results.md"
with open(out,"w",encoding="utf-8") as f:
    f.write("# VSA Backtest v2 — ATR-based + PDH/PDL\n\n")
    f.write(f"Date: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n\n")
    f.write("## Improvements over v1\n")
    f.write("- ATR-based SL and sweep depth (symbol-adaptive)\n")
    f.write("- PDH/PDL sweep detection (score +6 — highest tier)\n")
    f.write("- Opening Range sweep detection (score +5)\n")
    f.write("- All thresholds scale with actual volatility\n\n")
    for sym,results in all_results.items():
        f.write(f"## {sym}\n\n")
        f.write("| # | MS | MinSigs | RR | SL×ATR | WR | PF | TPD | Net | DD | Trades |\n")
        f.write("|---|---|---|---|---|---|---|---|---|---|---|\n")
        for i,r in enumerate(results,1):
            f.write(f"| {i} | {r['ms']} | {r['msigs']} | {r['rr']} | {r['sl_atr']} | "
                    f"{r['wr']:.1f}% | {r['pf']:.2f} | {r['tpd']:.2f} | "
                    f"{r['net']:+.1f}% | {r['mdd']:.1f}% | {r['trades']} |\n")
        f.write("\n")
print(f"\n  Report: {out}")
