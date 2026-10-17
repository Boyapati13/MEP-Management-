#!/usr/bin/env python3
import sys
import os
import MetaTrader5 as mt5
import numpy as np

sys.path.append(r"c:\Users\Tenders\octo\octo\scripts")
from backtest_whale_engine import calc_poc_and_va
from test_relaxed import RelaxedWhaleBacktester, calculate_dynamic_rsi_local

class HighFrequencyBacktester(RelaxedWhaleBacktester):
    def run_hf_simulation(self, tol_multiplier, rsi_bull, rsi_bear, use_daily_filter=False, use_h1_filter=True):
        n_candles = len(self.m15_candles) # This contains M1 candles in this test
        closes = np.array([c["close"] for c in self.m15_candles])
        highs = np.array([c["high"] for c in self.m15_candles])
        lows = np.array([c["low"] for c in self.m15_candles])
        
        self.trades = []
        self.balance = self.initial_balance
        
        self.dyn_rsi_cache = {}
        for s_idx, p in self.sessions.items():
            # Use smaller M1 adaptive lookbacks to prevent lag
            self.dyn_rsi_cache[s_idx] = calculate_dynamic_rsi_local(closes, highs, lows, 14, 1.2, self.point_size)
            
        active_trade = None
        start_idx = 300
        
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
                    
                globalTrendBull = True
                globalTrendBear = True
                if use_daily_filter:
                    import datetime as dt_mod
                    prev_day = c_time - dt_mod.timedelta(days=1)
                    d1_target = dt_mod.datetime(prev_day.year, prev_day.month, prev_day.day, tzinfo=dt_mod.timezone.utc)
                    d_rsi = self.d1_rsi_cache.get(d1_target, 50.0)
                    globalTrendBull = (d_rsi > 50.0)
                    globalTrendBear = (d_rsi < 50.0)
                
                htfTrendBull = True
                htfTrendBear = True
                if use_h1_filter:
                    import datetime as dt_mod
                    prev_hour = c_time - dt_mod.timedelta(hours=1)
                    h1_target = dt_mod.datetime(prev_hour.year, prev_hour.month, prev_hour.day, prev_hour.hour, tzinfo=dt_mod.timezone.utc)
                    h1_rsi = self.h1_rsi_cache.get(p["htf_pd"], {}).get(h1_target, 50.0)
                    htfTrendBull = (h1_rsi > 50.0)
                    htfTrendBear = (h1_rsi < 50.0)
                
                # Active state alignment
                dyn_rsi = self.dyn_rsi_cache[s_idx]
                g3B = (dyn_rsi[i] >= rsi_bull)
                g3S = (dyn_rsi[i] <= rsi_bear)
                
                # Short lookback for M1 volume profiles (e.g. 60 bars = 1 hour)
                lookback_window = self.m15_candles[i - 60 : i]
                sess_closes = np.array([x["close"] for x in lookback_window])
                min_p = min(sess_closes)
                max_p = max(sess_closes)
                step = max(max_p - min_p, self.point_size * 10) / p["bins"]
                
                bins = np.zeros(p["bins"])
                for sc in lookback_window:
                    bn = int(np.floor((sc["close"] - min_p) / step))
                    bn = max(0, min(p["bins"] - 1, bn))
                    bins[bn] += sc["volume"]
                    
                poc, vah, val, poc_bin = calc_poc_and_va(bins, p["bins"], min_p, step)
                
                tol_price = 50 * self.point_size * tol_multiplier
                c = current_c["close"]
                o = current_c["open"]
                
                near_vah = abs(c - vah) <= tol_price
                near_poc = abs(c - poc) <= tol_price
                near_val = abs(c - val) <= tol_price
                
                g1B = (near_val or near_poc) and (c > o)
                g1S = (near_vah or near_poc) and (c < o)
                
                buy_signal = g1B and htfTrendBull and g3B and globalTrendBull
                sell_signal = g1S and htfTrendBear and g3S and globalTrendBear
                
                if buy_signal:
                    sl = val - (self.point_size * 30)
                    if sl >= c:
                        sl = current_c["low"] - (self.point_size * 15)
                    dist = c - sl
                    if dist > 0:
                        active_trade = {"type": "LONG", "entry_time": c_time, "entry_price": c, "sl": sl, "tp": c + dist * 3.0, "risk": 100.0, "session": p["name"]}
                    break
                elif sell_signal:
                    sl = vah + (self.point_size * 30)
                    if sl <= c:
                        sl = current_c["high"] + (self.point_size * 15)
                    dist = sl - c
                    if dist > 0:
                        active_trade = {"type": "SHORT", "entry_time": c_time, "entry_price": c, "sl": sl, "tp": c - dist * 3.0, "risk": 100.0, "session": p["name"]}
                    break

def main():
    if not mt5.initialize():
        return
        
    print("=" * 60)
    print("      M1 HIGH-FREQUENCY DAY-TRADING OPTIMIZER")
    print("=" * 60)
    
    # We fetch 20,000 M1 candles (covers ~14 calendar days or 10 active trading days)
    bt = HighFrequencyBacktester(symbol="XAUUSD+", candle_count=20000)
    
    print("[Engine] Fetching 20,000 M1 candles...")
    mt5.symbol_select(bt.symbol, True)
    m1_rates = mt5.copy_rates_from_pos(bt.symbol, mt5.TIMEFRAME_M1, 0, 20000 + 500)
    h1_rates = mt5.copy_rates_from_pos(bt.symbol, mt5.TIMEFRAME_H1, 0, 2000 + 100)
    d1_rates = mt5.copy_rates_from_pos(bt.symbol, mt5.TIMEFRAME_D1, 0, 100)
    
    if m1_rates is None or h1_rates is None or d1_rates is None:
        print("[ERROR] Data download failed.")
        mt5.shutdown()
        return
        
    from datetime import datetime, timezone
    from backtest_whale_engine import calculate_rsi
    
    h1_closes = np.array([float(x["close"]) for x in h1_rates])
    h1_times = [datetime.fromtimestamp(int(x["time"]), tz=timezone.utc) for x in h1_rates]
    bt.h1_rsi_cache = {20: {h1_times[j]: calculate_rsi(h1_closes, 20)[j] for j in range(len(h1_times))}}
    
    d1_closes = np.array([float(x["close"]) for x in d1_rates])
    d1_times = [datetime.fromtimestamp(int(x["time"]), tz=timezone.utc) for x in d1_rates]
    bt.d1_rsi_cache = {d1_times[j]: calculate_rsi(d1_closes, 14)[j] for j in range(len(d1_times))}
    
    bt.m15_candles = []
    for r in m1_rates:
        bt.m15_candles.append({
            "time": datetime.fromtimestamp(int(r["time"]), tz=timezone.utc),
            "open": float(r["open"]),
            "high": float(r["high"]),
            "low": float(r["low"]),
            "close": float(r["close"]),
            "volume": int(r["tick_volume"])
        })
        
    bt.point_size = mt5.symbol_info(bt.symbol).point
    
    print("[Engine] Scanning dynamic M1 scalping configurations...")
    
    best_wr = 0.0
    best_params = {}
    
    tol_multipliers = [1.0, 1.5, 2.0]
    rsi_bulls = [45.0, 50.0]
    rsi_bears = [55.0, 50.0]
    h1_filters = [True, False]
    
    for tol in tol_multipliers:
        for rb, rs in zip(rsi_bulls, rsi_bears):
            for h1 in h1_filters:
                bt.run_hf_simulation(tol, rb, rs, use_daily_filter=False, use_h1_filter=h1)
                n_tr = len(bt.trades)
                if n_tr < 15: # We need at least 15 trades over 10 trading days (1.5 trades/day average)
                    continue
                wins = len([t for t in bt.trades if t["result"] == "WIN"])
                wr = (wins / n_tr * 100.0)
                pnl = bt.balance - bt.initial_balance
                
                # Check trades per day (approx 10 trading days in 20k M1 candles)
                t_per_day = n_tr / 10.0
                
                if wr > best_wr and pnl > 0 and 1.0 <= t_per_day <= 3.0:
                    best_wr = wr
                    best_params = {
                        "tol": tol,
                        "rsi_bull": rb,
                        "rsi_bear": rs,
                        "h1_filter": h1,
                        "trades": n_tr,
                        "trades_per_day": t_per_day,
                        "win_rate": wr,
                        "pnl": pnl
                    }
                    
    print("\n" + "=" * 60)
    print("              HIGH-FREQUENCY OPTIMIZATION RESULTS")
    print("=" * 60)
    if best_params:
        print(">>> SUCCESS: 1-3 TRADES PER DAY FORMULA ACHIEVED!")
        print(f"  - Structural Tolerance Mult : {best_params['tol']}x")
        print(f"  - Dynamic RSI Bull Limit    : {best_params['rsi_bull']}")
        print(f"  - Dynamic RSI Bear Limit    : {best_params['rsi_bear']}")
        print(f"  - Use H1 Trend Lock Filter  : {best_params['h1_filter']}")
        print("  ------------------------------------------")
        print(f"  - Total Trades (10 Days)    : {best_params['trades']}")
        print(f"  - Average Trades per Day    : {best_params['trades_per_day']:.2f}")
        print(f"  - Optimized Win Rate        : {best_params['win_rate']:.2f}%")
        print(f"  - Simulated Net Profit      : ${best_params['pnl']:.2f}")
    else:
        print("Could not find a configuration matching 1-3 trades/day with positive yield.")
    print("=" * 60)
    
    mt5.shutdown()

if __name__ == "__main__":
    main()
