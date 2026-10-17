#!/usr/bin/env python3
"""Quick diagnostic with fixed VSA thresholds."""
import os, sys, time
import numpy as np
from datetime import datetime, timezone, timedelta
import MetaTrader5 as mt5
from collections import Counter

SYMBOL = 'EURUSD+'
CANDLES = 3000
SESSIONS = {0:{'start':0,'end':8,'name':'ASIA'}, 1:{'start':8,'end':16,'name':'LONDON'}, 2:{'start':13,'end':21,'name':'NY'}}

def build_vp(bars, n=25):
    if len(bars)<3:
        m=np.mean([b['close'] for b in bars]) if bars else 0
        return m, m, m
    p=[b['close'] for b in bars]; v=[b['volume'] for b in bars]
    mn,mx=min(p),max(p); st=max(mx-mn,1e-8)/n; bins=np.zeros(n)
    for pp,vv in zip(p,v):
        b=int((pp-mn)/st); bins[max(0,min(n-1,b))]+=vv
    pb=int(np.argmax(bins)); poc=mn+st*pb+st*0.5
    tgt=bins.sum()*0.70; acc=bins[pb]; hi,lo=pb,pb
    while acc<tgt:
        cu=(hi+1<n); cd=(lo-1>=0)
        if not cu and not cd: break
        uv=bins[hi+1] if cu else 0; dv=bins[lo-1] if cd else 0
        if cu and (not cd or uv>=dv): hi+=1; acc+=uv
        else: lo-=1; acc+=dv
    return poc, mn+st*(hi+1), mn+st*lo

def build_vwap(bars):
    if not bars: return 0
    tv=sum(b['volume'] for b in bars)
    return sum((b['high']+b['low']+b['close'])/3*b['volume'] for b in bars)/tv if tv else 0

def classify(bar, recent, val, poc, vah, vwap, pt):
    op,hi,lo,cl,vol = bar['open'],bar['high'],bar['low'],bar['close'],bar['volume']
    sp=max(hi-lo,pt); body=abs(cl-op); body_r=body/sp; cp=(cl-lo)/sp
    uw=(hi-max(op,cl))/sp; lw=(min(op,cl)-lo)/sp
    rb=recent[-20:] if len(recent)>=5 else recent
    av=np.mean([b['volume'] for b in rb]) if rb else vol
    asp=np.mean([max(b['high']-b['low'],pt) for b in rb]) if rb else sp
    hhv=vol>=av*2.0; vhv=vol>=av*2.5; lv=vol<=av*0.60
    ws=sp>=asp*1.5; ns=sp<=asp*0.55
    var=max(vah-val,pt); lt=var*0.15
    at_val=(lo<=val+lt); at_vah=(hi>=vah-lt)
    at_pb=(abs(cl-poc)<=lt and cl>op); at_ps=(abs(cl-poc)<=lt and cl<op)
    bv=(cl<val); av_=(cl>vah)
    long_loc=at_val or bv or at_pb
    short_loc=at_vah or av_ or at_ps
    mt_='NEUTRAL'
    if len(recent)>=3:
        mt_='UP' if recent[-1]['close']>recent[-3]['close'] else 'DOWN'
    msd=pt*8
    if len(recent)>=20:
        sl=min(b['low'] for b in recent[-20:])
        sh=max(b['high'] for b in recent[-20:])
    elif len(recent)>=5:
        sl=min(b['low'] for b in recent[-5:])
        sh=max(b['high'] for b in recent[-5:])
    else:
        sl=lo; sh=hi
    sigs=[]; bs=0; be=0
    if hhv and ws and cp<=0.30 and long_loc: sigs.append('STOPPING_VOL'); bs+=4
    if hhv and ws and cp>=0.70 and short_loc: sigs.append('EXHAUSTION_VOL'); be+=4
    if lv and ns and cp>=0.55 and mt_=='DOWN' and long_loc: sigs.append('NO_SUPPLY'); bs+=3
    if lv and ns and cp<=0.45 and mt_=='UP' and short_loc: sigs.append('NO_DEMAND'); be+=3
    if vhv and len(recent)>=10:
        rv=[b['volume'] for b in recent[-10:]]
        if vol>max(rv):
            if mt_=='DOWN' and cp>=0.50 and long_loc: sigs.append('BULL_CLIMAX'); bs+=5
            elif mt_=='UP' and cp<=0.50 and short_loc: sigs.append('BEAR_CLIMAX'); be+=5
    if lo<sl-msd and cl>sl: sigs.append('BULL_SWEEP'); bs+=5
    if hi>sh+msd and cl<sh: sigs.append('BEAR_SWEEP'); be+=5
    if vhv and body_r<=0.25 and (long_loc or short_loc):
        if cp>=0.50: sigs.append('BULL_ABS'); bs+=3
        else: sigs.append('BEAR_ABS'); be+=3
    if lo<val and cl>val and lw>=0.40 and (val-lo)>=msd: sigs.append('SPRING'); bs+=5
    if hi>vah and cl<vah and uw>=0.40 and (hi-vah)>=msd: sigs.append('UPTHRUST'); be+=5
    if vwap>0:
        dev=(cl-vwap)/max(asp*3,pt)
        if dev<=-1.5 and long_loc: bs+=1
        if dev>=1.5 and short_loc: be+=1
    return sigs, bs, be

# Connect
if not mt5.initialize():
    exe = r'C:\Program Files\MetaTrader 5\terminal64.exe'
    if os.path.exists(exe): mt5.initialize(path=exe)
tick=mt5.symbol_info_tick(SYMBOL)
gmt_off=3
if tick:
    off=tick.time-int(time.time())
    gmt_off=3 if abs(off)>10800 else round(off/3600)
s_info=mt5.symbol_info(SYMBOL)
if s_info is None: SYMBOL=SYMBOL.replace('+',''); s_info=mt5.symbol_info(SYMBOL)
pt=s_info.point if s_info else 0.00001
mt5.symbol_select(SYMBOL,True)
rates=mt5.copy_rates_from_pos(SYMBOL,mt5.TIMEFRAME_M1,0,CANDLES+100)
mt5.shutdown()

candles=[]
for r in rates:
    dt=datetime.fromtimestamp(int(r['time']),tz=timezone.utc)
    gmt=dt-timedelta(hours=gmt_off); mh=(gmt+timedelta(hours=2)).hour
    candles.append({'time':dt,'open':float(r['open']),'high':float(r['high']),
                    'low':float(r['low']),'close':float(r['close']),
                    'volume':int(r['tick_volume']),'malta_hour':mh,'date':dt.date()})

print(f"\nLoaded {len(candles)} bars for {SYMBOL}")
print("="*60)
print("PASS 1: RAW SIGNAL SCAN (fixed thresholds)")
print("="*60)

sig_cnt=Counter()
sess_bars={s:[] for s in SESSIONS}; last_d=None; total=0; with_sig=0
for i in range(50,len(candles)):
    bar=candles[i]; mh=bar['malta_hour']
    if bar['date']!=last_d: sess_bars={s:[] for s in SESSIONS}; last_d=bar['date']
    active=[s for s,p in SESSIONS.items() if mh>=p['start'] and mh<p['end']]
    for s in active: sess_bars[s].append(bar)
    if not active: continue
    si=active[-1]; sb=sess_bars[si]
    if len(sb)<30: continue
    poc,vah,val=build_vp(sb); vwap=build_vwap(sb)
    sigs,bs,be=classify(bar,sb[:-1],val,poc,vah,vwap,pt)
    total+=1
    if sigs: with_sig+=1
    for s in sigs: sig_cnt[s]+=1

tdays=max(1.0,(candles[-1]['time']-candles[50]['time']).total_seconds()/86400*(5/7))
print(f"Bars scanned: {total}")
print(f"With signals: {with_sig} ({with_sig/total*100:.1f}%)")
print(f"Trading days: {tdays:.1f}")
print("\nSIGNAL FREQUENCY:")
for s,c in sig_cnt.most_common():
    print(f"  {s:<20}: {c:4d}  ({c/tdays:.1f}/day)")

print("\n" + "="*60)
print("PASS 2: ENTRIES BY MIN SCORE")
print("="*60)
for ms in [3,4,5,6,7]:
    sb2={s:[] for s in SESSIONS}; ld2=None; ents=[]
    for i in range(50,len(candles)):
        bar=candles[i]; mh=bar['malta_hour']
        if bar['date']!=ld2: sb2={s:[] for s in SESSIONS}; ld2=bar['date']
        ac=[s for s,p in SESSIONS.items() if mh>=p['start'] and mh<p['end']]
        for s in ac: sb2[s].append(bar)
        if not ac: continue
        si=ac[-1]; sb=sb2[si]
        if len(sb)<30: continue
        poc,vah,val=build_vp(sb); vwap=build_vwap(sb)
        sigs,bsc,bec=classify(bar,sb[:-1],val,poc,vah,vwap,pt)
        if bsc>=ms and bsc>bec: ents.append(('BUY', bar['time'], '+'.join(sigs)))
        elif bec>=ms and bec>bsc: ents.append(('SELL', bar['time'], '+'.join(sigs)))
    tpd=len(ents)/tdays
    print(f"  MinScore={ms}: {len(ents):4d} entries ({tpd:.2f}/day)")
    for direction,t,s in ents[:3]:
        print(f"    {direction} @ {t.strftime('%m/%d %H:%M')}  [{s}]")
print("\nDiagnostic complete.")
