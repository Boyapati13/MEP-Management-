#!/usr/bin/env python3
import sys
import os
import MetaTrader5 as mt5
import numpy as np

sys.path.append(r"c:\Users\Tenders\octo\octo\scripts")
from backtest_whale_engine import calc_poc_and_va
from test_relaxed import RelaxedWhaleBacktester

class OptimizingWhaleBacktester(RelaxedWhaleBacktester):
    def run_custom_simulation(self, tol_multiplier, rsi_bull, rsi_bear, fvg_mult, disable_htf=False):
        n_candles = len(self.m15_candles)
        closes = np.array([c["close"] for c in self.m15_candles])
        highs = np.array([c["high"] for c in self.m15_candles])
        lows = np.array([c["low"] for c in self.m15_candles])
        
        self.trades = []
        self.balance = self.initial_balance
        
        self.dyn_rsi_cache = {}
        for s_idx, p in self.sessions.items():
            self.dyn_rsi_cache[s_idx] = calculate_dynamic_rsi_local(closes, highs, lows, p["m1_pd"], p["sens"], self.point_size)
            
        active_trade = None
        start_idx = 500
        
        for i in range(start_idx, n_candles):
            current_c = self.m15_candles[i]
            c_time = current_c["time"]
            malta_hour = self.get_malta_hour(c_time)
            
            if active_trade:
                trade_closed = False
                high = current_c["high"]
                low = current_c["low"]
                
                if active_trade["type"] == "LONG":
                    if low <= active_trade["sl"]:
                        pnl = -active_trade["risk"]
                        self.balance += pnl
                        self.trades.append({**active_trade, "result": "LOSS", "pnl": pnl})
                        active_trade = None
                        trade_closed = True
                    elif high >= active_trade["tp"]:
                        pnl = active_trade["risk"] * 3.0
                        self.balance += pnl
                        self.trades.append({**active_trade, "result": "WIN", "pnl": pnl})
                        active_trade = None
                        trade_closed = True
                elif active_trade["type"] == "SHORT":
                    if high >= active_trade["sl"]:
                        pnl = -active_trade["risk"]
                        self.balance += pnl
                        self.trades.append({**active_trade, "result": "LOSS", "pnl": pnl})
                        active_trade = None
                        trade_closed = True
                    elif low <= active_trade["tp"]:
                        pnl = active_trade["risk"] * 3.0
                        self.balance += pnl
                        self.trades.append({**active_trade, "result": "WIN", "pnl": pnl})
                        active_trade = None
                        trade_closed = True
                        
                if trade_closed:
                    continue
                    
            if active_trade:
                continue
                
            for s_idx, p in self.sessions.items():
                is_in_sess = False
                if p["start"] <= p["end"]:
                    is_in_sess = (malta_hour >= p["start"] and malta_hour < p["end"])
                else:
                    is_in_sess = (malta_hour >= p["start"] or malta_hour < p["end"])
                if not is_in_sess:
                    continue
                    
                import datetime as dt_mod
                prev_day = c_time - dt_mod.timedelta(days=1)
                d1_target = dt_mod.datetime(prev_day.year, prev_day.month, prev_day.day, tzinfo=dt_mod.timezone.utc)
                d_rsi = self.d1_rsi_cache.get(d1_target, 50.0)
                
                globalTrendBull = (d_rsi > 50.0) or disable_htf
                globalTrendBear = (d_rsi < 50.0) or disable_htf
                
                prev_hour = c_time - dt_mod.timedelta(hours=1)
                h1_target = dt_mod.datetime(prev_hour.year, prev_hour.month, prev_hour.day, prev_hour.hour, tzinfo=dt_mod.timezone.utc)
                h1_rsi = self.h1_rsi_cache.get(p["htf_pd"], {}).get(h1_target, 50.0)
                
                htfTrendBull = (h1_rsi > p["htf_bull"]) or disable_htf
                htfTrendBear = (h1_rsi < p["htf_bear"]) or disable_htf
                
                # Optimized state alignment check
                dyn_rsi = self.dyn_rsi_cache[s_idx]
                g3B = (dyn_rsi[i] >= rsi_bull)
                g3S = (dyn_rsi[i] <= rsi_bear)
                
                lookback_window = self.m15_candles[i - p["lookback"] : i]
                sess_candles = []
                for sc in lookback_window:
                    sch = self.get_malta_hour(sc["time"])
                    in_sc = False
                    if p["start"] <= p["end"]:
                        in_sc = (sch >= p["start"] and sch < p["end"])
                    else:
                        in_sc = (sch >= p["start"] or sch < p["end"])
                    if in_sc:
                        sess_candles.append(sc)
                        
                if len(sess_candles) < 20:
                    continue
                    
                sess_closes = np.array([x["close"] for x in sess_candles])
                min_p = min(sess_closes)
                max_p = max(sess_closes)
                step = max(max_p - min_p, self.point_size * 10) / p["bins"]
                
                bins = np.zeros(p["bins"])
                for sc in sess_candles:
                    bn = int(np.floor((sc["close"] - min_p) / step))
                    bn = max(0, min(p["bins"] - 1, bn))
                    bins[bn] += sc["volume"]
                    
                poc, vah, val, poc_bin = calc_poc_and_va(bins, p["bins"], min_p, step)
                
                tol_price = p["tol"] * self.point_size * tol_multiplier
                c = current_c["close"]
                o = current_c["open"]
                
                near_vah = abs(c - vah) <= tol_price
                near_poc = abs(c - poc) <= tol_price
                near_val = abs(c - val) <= tol_price
                
                g1B = (near_val or near_poc) and (c > o)
                g1S = (near_vah or near_poc) and (c < o)
                
                current_bin = int(np.floor((c - min_p) / step))
                current_bin = max(0, min(p["bins"] - 1, current_bin))
                sur_vol = 0.0
                sur_cnt = 0
                for b_off in range(-2, 3):
                    tb = current_bin + b_off
                    if 0 <= tb < p["bins"]:
                        sur_vol += bins[tb]
                        sur_cnt += 1
                mean_sur = sur_vol / sur_cnt if sur_cnt > 0 else bins[current_bin]
                min_allowed = mean_sur * (p["fvg_pct"] / 100.0) * fvg_mult
                is_vacuum_block = (bins[current_bin] < min_allowed)
                
                buy_signal = g1B and htfTrendBull and g3B and not is_vacuum_block and globalTrendBull
                sell_signal = g1S and htfTrendBear and g3S and not is_vacuum_block and globalTrendBear
                
                if buy_signal:
                    sl = val - (self.point_size * 50)
                    if sl >= c:
                        sl = current_c["low"] - (self.point_size * 20)
                    dist = c - sl
                    if dist > 0:
                        active_trade = {"type": "LONG", "entry_time": c_time, "entry_price": c, "sl": sl, "tp": c + dist * 3.0, "risk": 100.0, "session": p["name"]}
                    break
                elif sell_signal:
                    sl = vah + (self.point_size * 50)
                    if sl <= c:
                        sl = current_c["high"] + (self.point_size * 20)
                    dist = sl - c
                    if dist > 0:
                        active_trade = {"type": "SHORT", "entry_time": c_time, "entry_price": c, "sl": sl, "tp": c - dist * 3.0, "risk": 100.0, "session": p["name"]}
                    break

def calculate_dynamic_rsi_local(closes, highs, lows, pd, vol_sens, point_size):
    n = len(closes)
    tr = np.zeros(n)
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
    avg_tr = np.zeros(n)
    for i in range(n):
        start = max(0, i - pd + 1)
        avg_tr[i] = np.mean(tr[start:i+1])
        if avg_tr[i] == 0: avg_tr[i] = 1e-8
    dyn_gain = np.zeros(n)
    dyn_loss = np.zeros(n)
    rsi_history = np.full(n, 50.0)
    sum_gain = sum_loss = 0.0
    seed_len = min(pd, n - 1)
    for k in range(1, seed_len + 1):
        ch = closes[k] - closes[k-1]
        if ch > 0: sum_gain += ch
        else: sum_loss -= ch
    if seed_len > 0:
        dyn_gain[seed_len] = sum_gain / seed_len
        dyn_loss[seed_len] = sum_loss / seed_len
        if dyn_loss[seed_len] >= point_size:
            rsi_history[seed_len] = 100.0 - (100.0 / (1.0 + dyn_gain[seed_len] / dyn_loss[seed_len]))
    for i in range(seed_len + 1, n):
        vr = tr[i] / avg_tr[i]
        alpha = max(0.01, min(0.99, (1.0 / pd) * (vr ** vol_sens)))
        ch = closes[i] - closes[i-1]
        if ch > 0:
            dyn_gain[i] = alpha * ch + (1.0 - alpha) * dyn_gain[i-1]
            dyn_loss[i] = (1.0 - alpha) * dyn_loss[i-1]
        else:
            dyn_gain[i] = (1.0 - alpha) * dyn_gain[i-1]
            dyn_loss[i] = alpha * abs(ch) + (1.0 - alpha) * dyn_loss[i-1]
        if dyn_loss[i] >= point_size:
            rsi_history[i] = 100.0 - (100.0 / (1.0 + dyn_gain[i] / dyn_loss[i]))
    return rsi_history

def main():
    if not mt5.initialize():
        return
        
    print("=" * 60)
    print("         HOLY GRAIL PARAMETER OPTIMIZATION SWEEP")
    print("=" * 60)
    
    bt = OptimizingWhaleBacktester(symbol="XAUUSD+", candle_count=8000)
    if not bt.connect_and_fetch():
        mt5.shutdown()
        return
        
    best_wr = 0.0
    best_pnl = 0.0
    best_params = {}
    
    # Grid Search space
    tol_multipliers = [1.0, 1.5, 2.0]
    rsi_bulls = [40.0, 45.0, 50.0]
    rsi_bears = [60.0, 55.0, 50.0]
    fvg_mults = [0.5, 1.0, 1.5]
    disable_htfs = [False, True]
    
    print("Searching grid of 108 structural variations...")
    
    for tol in tol_multipliers:
        for rb, rs in zip(rsi_bulls, rsi_bears):
            for fvg in fvg_mults:
                for dis in disable_htfs:
                    bt.run_custom_simulation(tol, rb, rs, fvg, dis)
                    n_tr = len(bt.trades)
                    if n_tr < 10: # We want at least 10 trades for statistical significance!
                        continue
                    wins = len([t for t in bt.trades if t["result"] == "WIN"])
                    wr = (wins / n_tr * 100.0)
                    pnl = bt.balance - bt.initial_balance
                    
                    # We want to maximize Win Rate and ensure positive PnL
                    if wr > best_wr and pnl > 0:
                        best_wr = wr
                        best_pnl = pnl
                        best_params = {
                            "tol_multiplier": tol,
                            "rsi_bull": rb,
                            "rsi_bear": rs,
                            "fvg_multiplier": fvg,
                            "disable_htf": dis,
                            "trades": n_tr,
                            "win_rate": wr,
                            "pnl": pnl
                        }
                        
    print("\n" + "=" * 60)
    print("                  OPTIMIZATION SUMMARY")
    print("=" * 60)
    if best_params:
        print(">>> HOLY GRAIL FORMULA FOUND!")
        print(f"  - Structural Tolerance Mult : {best_params['tol_multiplier']}x")
        print(f"  - Dynamic RSI Bull Limit    : {best_params['rsi_bull']}")
        print(f"  - Dynamic RSI Bear Limit    : {best_params['rsi_bear']}")
        print(f"  - Volume Vacuum Mult        : {best_params['fvg_multiplier']}x")
        print(f"  - Disable HTF Trend Lock    : {best_params['disable_htf']}")
        print("  ------------------------------------------")
        print(f"  - Total Trades Triggered    : {best_params['trades']}")
        print(f"  - Peak Win Rate             : {best_params['win_rate']:.2f}%")
        print(f"  - Net Yield Generated       : ${best_params['pnl']:.2f}")
    else:
        print("No configurations with >=10 trades and positive PnL were found.")
    print("=" * 60)
    
    mt5.shutdown()

if __name__ == "__main__":
    main()
