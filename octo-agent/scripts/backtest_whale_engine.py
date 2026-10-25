#!/usr/bin/env python3
"""
Whale Suite — Hybrid Isolation Matrix v6.45 Backtesting Engine
==============================================================
Connects to MetaTrader 5, retrieves historical candles, segments sessions into
Malta hour, computes Volatility-Adaptive RSI, calculates POC/VAH/VAL profiles,
runs Volume Vacuum Filters, and executes simulated trades with a 1:3 RR matrix.
"""

import sys
import os
import time
import argparse
import numpy as np
from datetime import datetime, timezone, timedelta
import MetaTrader5 as mt5

def _tf(s: str) -> int:
    """Map string timeframes to MetaTrader 5 TIMEFRAME constants."""
    return {
        "M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15, "M30": mt5.TIMEFRAME_M30,
        "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1,
    }.get(s.upper(), mt5.TIMEFRAME_M15)

def calculate_rsi(prices, period):
    """Calculates standard RSI using Wilder's smoothing."""
    n = len(prices)
    rsi = np.full(n, 50.0)
    if n <= period:
        return rsi
    
    deltas = np.diff(prices)
    seed = deltas[:period]
    up = seed[seed >= 0].sum() / period
    down = -seed[seed < 0].sum() / period
    
    if down == 0:
        rsi[period] = 100.0
    else:
        rs = up / down
        rsi[period] = 100.0 - 100.0 / (1.0 + rs)
        
    for i in range(period + 1, n):
        delta = deltas[i - 1]
        if delta > 0:
            upval = delta
            downval = 0.0
        else:
            upval = 0.0
            downval = -delta
        up = (up * (period - 1) + upval) / period
        down = (down * (period - 1) + downval) / period
        if down == 0:
            rsi[i] = 100.0
        else:
            rsi[i] = 100.0 - 100.0 / (1.0 + up / down)
    return rsi

def calculate_dynamic_rsi(closes, highs, lows, pd, vol_sens, point_size):
    """Calculates Volatility-Adaptive Dynamic RSI matching MQ5 logic exactly."""
    n = len(closes)
    tr = np.zeros(n)
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        
    avg_tr = np.zeros(n)
    for i in range(n):
        start = max(0, i - pd + 1)
        avg_tr[i] = np.mean(tr[start:i+1])
        if avg_tr[i] == 0:
            avg_tr[i] = 1e-8
            
    dyn_gain = np.zeros(n)
    dyn_loss = np.zeros(n)
    rsi_history = np.full(n, 50.0)
    
    # Seed
    sum_gain = 0.0
    sum_loss = 0.0
    seed_len = min(pd, n - 1)
    for k in range(1, seed_len + 1):
        ch = closes[k] - closes[k-1]
        if ch > 0:
            sum_gain += ch
        else:
            sum_loss -= ch
    if seed_len > 0:
        dyn_gain[seed_len] = sum_gain / seed_len
        dyn_loss[seed_len] = sum_loss / seed_len
        if dyn_loss[seed_len] < point_size:
            rsi_history[seed_len] = 100.0
        else:
            rsi_history[seed_len] = 100.0 - (100.0 / (1.0 + dyn_gain[seed_len] / dyn_loss[seed_len]))
            
    for i in range(seed_len + 1, n):
        vr = tr[i] / avg_tr[i]
        alpha = (1.0 / pd) * (vr ** vol_sens)
        alpha = max(0.01, min(0.99, alpha))
        
        ch = closes[i] - closes[i-1]
        if ch > 0:
            dyn_gain[i] = alpha * ch + (1.0 - alpha) * dyn_gain[i-1]
            dyn_loss[i] = (1.0 - alpha) * dyn_loss[i-1]
        else:
            dyn_gain[i] = (1.0 - alpha) * dyn_gain[i-1]
            dyn_loss[i] = alpha * abs(ch) + (1.0 - alpha) * dyn_loss[i-1]
            
        if dyn_loss[i] < point_size:
            rsi_history[i] = 100.0
        else:
            rsi_history[i] = 100.0 - (100.0 / (1.0 + dyn_gain[i] / dyn_loss[i]))
            
    return rsi_history

def calc_poc_and_va(bins, n_bins, min_p, step):
    """Calculates POC, VAH, and VAL from volume bins using 70% Value Area algorithm."""
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
        
    target = total_vol * 0.70
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

class WhaleSuiteBacktester:
    def __init__(self, symbol: str, candle_count: int = 8000, balance: float = 10000.0):
        self.symbol = symbol.upper()
        self.candle_count = candle_count
        self.initial_balance = balance
        self.balance = balance
        
        self.m15_candles = []
        self.trades = []
        self.equity_curve = []
        self.broker_gmt_offset = 2  # Will auto-detect or default to 2 (Malta Summer offset)
        self.point_size = 0.00001
        
        # Session configs: [startHour, endHour, lookback, profileBins, structTolPts, fvgThreshold, htfRsiPd, htfBull, htfBear, m1RsiPd, volSens, m1BullCross, m1BearCross, name]
        self.sessions = {
            0: {"start": 0, "end": 8, "lookback": 250, "bins": 40, "tol": 75, "fvg_pct": 22.5, "htf_pd": 14, "htf_bull": 50.0, "htf_bear": 52.5, "m1_pd": 20, "sens": 1.7, "bull_cross": 40.0, "bear_cross": 54.0, "name": "ASIA"},
            1: {"start": 8, "end": 16, "lookback": 150, "bins": 30, "tol": 300, "fvg_pct": 15.0, "htf_pd": 20, "htf_bull": 55.0, "htf_bear": 52.5, "m1_pd": 12, "sens": 1.8, "bull_cross": 46.0, "bear_cross": 56.0, "name": "LONDON"},
            2: {"start": 13, "end": 21, "lookback": 300, "bins": 45, "tol": 150, "fvg_pct": 15.0, "htf_pd": 20, "htf_bull": 50.0, "htf_bear": 55.0, "m1_pd": 12, "sens": 1.0, "bull_cross": 50.0, "bear_cross": 52.0, "name": "NY"}
        }

    def detect_broker_offset(self) -> int:
        """Autodetects broker GMT offset relative to system time."""
        print("[Engine] [INFO] Requesting last tick to auto-detect broker timezone...")
        tick = mt5.symbol_info_tick(self.symbol)
        if tick:
            server_time = tick.time
            utc_time = int(time.time())
            # If the tick is more than 3 hours old, the market is closed (e.g. weekend).
            # Fall back to GMT+3 (standard Summer offset for EET/EEST brokers).
            if abs(utc_time - server_time) > 3 * 3600:
                print("[Engine] [WARN] Tick is old (market closed). Defaulting broker GMT offset to +3 (Summer EET).")
                return 3
            offset = round((server_time - utc_time) / 3600.0)
            print(f"[Engine] [INFO] Detected broker GMT offset: {offset:+.1f} hours.")
            return offset
        print("[Engine] [WARN] Tick retrieval failed. Defaulting broker GMT offset to +3.")
        return 3

    def connect_and_fetch(self) -> bool:
        """Fetch high-fidelity M15, H1, and D1 data from MetaTrader 5."""
        print("[Engine] [INFO] Initializing MetaTrader 5 connection...")
        if not mt5.initialize():
            import os
            exe_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
            if os.path.exists(exe_path) and mt5.initialize(path=exe_path):
                print("[Engine] [SUCCESS] Self-healed MT5 initialization via executable path.")
            else:
                print(f"[Engine] [ERROR] MetaTrader 5 initialization failed: {mt5.last_error()}")
                return False
            
        self.broker_gmt_offset = self.detect_broker_offset()
        
        # Get point size
        s_info = mt5.symbol_info(self.symbol)
        if s_info is None:
            alt = self.symbol.replace("+", "")
            s_info = mt5.symbol_info(alt)
            if s_info:
                self.symbol = alt
            else:
                print(f"[Engine] [ERROR] Symbol {self.symbol} not found on broker.")
                return False
        self.point_size = s_info.point
        print(f"[Engine] [INFO] Active symbol: {self.symbol} | Point Size: {self.point_size}")
        
        # We need historical M15, H1, and D1 candles
        print(f"[Engine] [INFO] Downloading historical M15, H1, and D1 feeds...")
        mt5.symbol_select(self.symbol, True)
        
        # Ingest extra buffer size for lookbacks
        m15_rates = mt5.copy_rates_from_pos(self.symbol, mt5.TIMEFRAME_M15, 0, self.candle_count + 500)
        h1_rates = mt5.copy_rates_from_pos(self.symbol, mt5.TIMEFRAME_H1, 0, int((self.candle_count + 500) / 4) + 100)
        d1_rates = mt5.copy_rates_from_pos(self.symbol, mt5.TIMEFRAME_D1, 0, int((self.candle_count + 500) / 96) + 50)
        
        if m15_rates is None or len(m15_rates) == 0:
            print("[Engine] [ERROR] M15 data download empty.")
            return False
        if h1_rates is None or len(h1_rates) == 0:
            print("[Engine] [ERROR] H1 data download empty.")
            return False
        if d1_rates is None or len(d1_rates) == 0:
            print("[Engine] [ERROR] D1 data download empty.")
            return False
            
        print(f"[Engine] [SUCCESS] Download complete: {len(m15_rates)} M15, {len(h1_rates)} H1, {len(d1_rates)} D1 candles.")
        
        # Pre-process H1 RSI series
        h1_closes = np.array([float(x["close"]) for x in h1_rates])
        h1_times = [datetime.fromtimestamp(int(x["time"]), tz=timezone.utc) for x in h1_rates]
        
        self.h1_rsi_cache = {}
        for pd_val in [14, 20]:
            rsi_vals = calculate_rsi(h1_closes, pd_val)
            self.h1_rsi_cache[pd_val] = {h1_times[j]: rsi_vals[j] for j in range(len(h1_times))}
            
        # Pre-process D1 RSI series
        d1_closes = np.array([float(x["close"]) for x in d1_rates])
        d1_times = [datetime.fromtimestamp(int(x["time"]), tz=timezone.utc) for x in d1_rates]
        d1_rsi = calculate_rsi(d1_closes, 14)
        self.d1_rsi_cache = {d1_times[j]: d1_rsi[j] for j in range(len(d1_times))}
        
        # Save M15 candles chronological order
        self.m15_candles = []
        for r in m15_rates:
            self.m15_candles.append({
                "time": datetime.fromtimestamp(int(r["time"]), tz=timezone.utc),
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": int(r["tick_volume"])
            })
            
        return True

    def get_malta_hour(self, dt: datetime) -> int:
        """Converts broker time datetime (unix-based UTC representation) to Malta local hour."""
        # Malta Summer time is UTC+2
        # Candle timestamp is shifted by broker GMT offset. We subtract broker GMT offset to get UTC, then add 2.
        gmt_time = dt - timedelta(hours=self.broker_gmt_offset)
        malta_time = gmt_time + timedelta(hours=2)
        return malta_time.hour

    def run_simulation(self):
        """Simulates the Whale Suite v6.45 Hybrid Isolation Matrix."""
        print("[Engine] [INFO] Initializing Hybrid Isolation Matrix loop...")
        
        n_candles = len(self.m15_candles)
        closes = np.array([c["close"] for c in self.m15_candles])
        highs = np.array([c["high"] for c in self.m15_candles])
        lows = np.array([c["low"] for c in self.m15_candles])
        
        # 1. Precalculate Dynamic RSIs for each of the 3 sessions on main M15 chart
        print("[Engine] [INFO] Precalculating dynamic volatility-adaptive RSIs...")
        self.dyn_rsi_cache = {}
        for s_idx, p in self.sessions.items():
            self.dyn_rsi_cache[s_idx] = calculate_dynamic_rsi(closes, highs, lows, p["m1_pd"], p["sens"], self.point_size)
            
        active_trade = None
        self.equity_curve = []
        
        # Start after the maximum required history buffer (e.g. 500 candles) to avoid out-of-bounds
        start_idx = 500
        
        # Loop forward in time
        for i in range(start_idx, n_candles):
            current_c = self.m15_candles[i]
            c_time = current_c["time"]
            malta_hour = self.get_malta_hour(c_time)
            
            # Check Active Trade SL/TP mitigation
            if active_trade:
                trade_closed = False
                high = current_c["high"]
                low = current_c["low"]
                
                if active_trade["type"] == "LONG":
                    if low <= active_trade["sl"]:
                        pnl = -active_trade["risk"]
                        self.balance += pnl
                        self.trades.append({
                            **active_trade,
                            "exit_time": c_time,
                            "exit_price": active_trade["sl"],
                            "result": "LOSS",
                            "pnl": pnl,
                            "balance_after": self.balance
                        })
                        active_trade = None
                        trade_closed = True
                    elif high >= active_trade["tp"]:
                        pnl = active_trade["risk"] * 3.0
                        self.balance += pnl
                        self.trades.append({
                            **active_trade,
                            "exit_time": c_time,
                            "exit_price": active_trade["tp"],
                            "result": "WIN",
                            "pnl": pnl,
                            "balance_after": self.balance
                        })
                        active_trade = None
                        trade_closed = True
                
                elif active_trade["type"] == "SHORT":
                    if high >= active_trade["sl"]:
                        pnl = -active_trade["risk"]
                        self.balance += pnl
                        self.trades.append({
                            **active_trade,
                            "exit_time": c_time,
                            "exit_price": active_trade["sl"],
                            "result": "LOSS",
                            "pnl": pnl,
                            "balance_after": self.balance
                        })
                        active_trade = None
                        trade_closed = True
                    elif low <= active_trade["tp"]:
                        pnl = active_trade["risk"] * 3.0
                        self.balance += pnl
                        self.trades.append({
                            **active_trade,
                            "exit_time": c_time,
                            "exit_price": active_trade["tp"],
                            "result": "WIN",
                            "pnl": pnl,
                            "balance_after": self.balance
                        })
                        active_trade = None
                        trade_closed = True
                        
                if trade_closed:
                    self.equity_curve.append(self.balance)
                    continue
                    
            # Skip new entry scans if already in a trade
            if active_trade:
                self.equity_curve.append(self.balance)
                continue
                
            # Scan sessions
            for s_idx, p in self.sessions.items():
                # Check session hour active window
                # Start <= End
                is_in_sess = False
                if p["start"] <= p["end"]:
                    is_in_sess = (malta_hour >= p["start"] and malta_hour < p["end"])
                else:
                    is_in_sess = (malta_hour >= p["start"] or malta_hour < p["end"])
                    
                if not is_in_sess:
                    continue
                    
                # We are in session 's_idx'. Evaluate inputs:
                # 1. Fetch Daily RSI of previous day to avoid lookahead
                # Find matching D1 date
                prev_day = c_time - timedelta(days=1)
                d1_target = datetime(prev_day.year, prev_day.month, prev_day.day, tzinfo=timezone.utc)
                d_rsi = self.d1_rsi_cache.get(d1_target, 50.0)
                
                globalTrendBull = (d_rsi > 50.0)
                globalTrendBear = (d_rsi < 50.0)
                
                # 2. Fetch H1 RSI of completed previous hour
                prev_hour = c_time - timedelta(hours=1)
                h1_target = datetime(prev_hour.year, prev_hour.month, prev_hour.day, prev_hour.hour, tzinfo=timezone.utc)
                h1_rsi = self.h1_rsi_cache.get(p["htf_pd"], {}).get(h1_target, 50.0)
                
                htfTrendBull = (h1_rsi > p["htf_bull"])
                htfTrendBear = (h1_rsi < p["htf_bear"])
                
                # 3. Dynamic RSI crossover
                dyn_rsi = self.dyn_rsi_cache[s_idx]
                g3B = (dyn_rsi[i] > p["bull_cross"] and dyn_rsi[i-1] <= p["bull_cross"])
                g3S = (dyn_rsi[i] < p["bear_cross"] and dyn_rsi[i-1] >= p["bear_cross"])
                
                # 4. Construct Volume Profile over window
                lookback_window = self.m15_candles[i - p["lookback"] : i]
                # Filter only the ones that fall in session hours
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
                sess_vols = np.array([x["volume"] for x in sess_candles])
                
                min_p = min(sess_closes)
                max_p = max(sess_closes)
                
                step = max(max_p - min_p, self.point_size * 10) / p["bins"]
                
                bins = np.zeros(p["bins"])
                for sc in sess_candles:
                    bn = int(np.floor((sc["close"] - min_p) / step))
                    bn = max(0, min(p["bins"] - 1, bn))
                    bins[bn] += sc["volume"]
                    
                poc, vah, val, poc_bin = calc_poc_and_va(bins, p["bins"], min_p, step)
                
                # Proximity checks
                tol_price = p["tol"] * self.point_size
                c = current_c["close"]
                o = current_c["open"]
                
                near_vah = abs(c - vah) <= tol_price
                near_poc = abs(c - poc) <= tol_price
                near_val = abs(c - val) <= tol_price
                
                g1B = (near_val or near_poc) and (c > o)
                g1S = (near_vah or near_poc) and (c < o)
                
                # Volume Vacuum Filter
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
                min_allowed = mean_sur * (p["fvg_pct"] / 100.0)
                is_vacuum_block = (bins[current_bin] < min_allowed)
                
                # Crossover agreement checks
                crossAgreeBuy = True
                crossAgreeSell = True
                
                # Evaluate London vs Asia
                if s_idx == 1: # London
                    # Fetch Asia VAL/VAH if valid
                    # We can approximate with previous Asia session values
                    pass # Keep default true for simplicity or implement if needed
                    
                buy_signal = g1B and htfTrendBull and g3B and not is_vacuum_block and crossAgreeBuy and globalTrendBull
                sell_signal = g1S and htfTrendBear and g3S and not is_vacuum_block and crossAgreeSell and globalTrendBear
                
                if buy_signal:
                    sl = val - (self.point_size * 50)
                    if sl >= c:
                        sl = current_c["low"] - (self.point_size * 20)
                    dist = c - sl
                    if dist > 0:
                        active_trade = {
                            "type": "LONG",
                            "entry_time": c_time,
                            "entry_price": c,
                            "sl": sl,
                            "tp": c + dist * 3.0,
                            "risk": 100.0,
                            "session": p["name"],
                            "reason": f"VAH/VAL Proximity ({p['name']})"
                        }
                    break # Stop checking other sessions
                    
                elif sell_signal:
                    sl = vah + (self.point_size * 50)
                    if sl <= c:
                        sl = current_c["high"] + (self.point_size * 20)
                    dist = sl - c
                    if dist > 0:
                        active_trade = {
                            "type": "SHORT",
                            "entry_time": c_time,
                            "entry_price": c,
                            "sl": sl,
                            "tp": c - dist * 3.0,
                            "risk": 100.0,
                            "session": p["name"],
                            "reason": f"VAH/VAL Proximity ({p['name']})"
                        }
                    break # Stop checking other sessions
                    
            self.equity_curve.append(self.balance)

    def generate_report(self):
        """Compiles the Whale Suite performance statistics and writes to markdown."""
        n_trades = len(self.trades)
        if n_trades == 0:
            print(f"[Report] [WARN] No trades executed for {self.symbol} under Whale rules.")
            return None
            
        wins = [t for t in self.trades if t["result"] == "WIN"]
        losses = [t for t in self.trades if t["result"] == "LOSS"]
        
        win_rate = (len(wins) / n_trades) * 100.0
        gross_profit = sum(t["pnl"] for t in wins)
        gross_loss = abs(sum(t["pnl"] for t in losses))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else gross_profit
        net_profit = self.balance - self.initial_balance
        
        peak = self.initial_balance
        max_dd = 0.0
        for b in self.equity_curve:
            if b > peak:
                peak = b
            dd = ((peak - b) / peak) * 100.0
            if dd > max_dd:
                max_dd = dd
                
        report_path = f"backtest_report_whale_{self.symbol}.md"
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(f"# WHALE SUITE V6.45 HYBRID MATRIX REPORT: {self.symbol}\n\n")
            f.write(f"Generated on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')} using active MT5 data feed.\n\n")
            
            f.write("## Executive Performance Summary\n")
            f.write("| Metric | Value |\n")
            f.write("| :--- | :--- |\n")
            f.write(f"| **Symbol** | `{self.symbol}` |\n")
            f.write(f"| **Initial Balance** | `${self.initial_balance:,.2f}` |\n")
            f.write(f"| **Final Balance** | `${self.balance:,.2f}` |\n")
            f.write(f"| **Net Profit** | `${net_profit:+,.2f}` ({(net_profit/self.initial_balance)*100:+.2f}%) |\n")
            f.write(f"| **Total Executed Trades** | `{n_trades}` |\n")
            f.write(f"| **Wins / Losses** | `{len(wins)} / {len(losses)}` |\n")
            f.write(f"| **Win Rate** | `{win_rate:.2f}%` |\n")
            f.write(f"| **Profit Factor** | `{profit_factor:.2f}` |\n")
            f.write(f"| **Max Equity Drawdown** | `{max_dd:.2f}%` |\n\n")
            
            f.write("## Trade History Log\n")
            f.write("| Type | Entry Time | Entry | SL | TP | Exit Time | Session | Result | PnL ($) |\n")
            f.write("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n")
            for t in self.trades:
                f.write(f"| `{t['type']}` | {t['entry_time'].strftime('%m-%d %H:%M')} | {t['entry_price']:.5f} | {t['sl']:.5f} | {t['tp']:.5f} | {t['exit_time'].strftime('%m-%d %H:%M')} | {t['session']} | **{t['result']}** | {t['pnl']:+,.2f} |\n")
                
        print(f"[SUCCESS] Report saved to: {os.path.abspath(report_path)}")
        return {
            "symbol": self.symbol,
            "net_profit": net_profit,
            "net_profit_pct": (net_profit / self.initial_balance) * 100.0,
            "trades": n_trades,
            "win_rate": win_rate,
            "profit_factor": profit_factor,
            "max_dd": max_dd
        }

def main():
    parser = argparse.ArgumentParser(description="Whale Suite v6.45 Hybrid Isolation Matrix Backtesting")
    parser.add_argument("--symbol", type=str, default="XAUUSD+", help="MT5 Broker Symbol to backtest")
    parser.add_argument("--candles", type=int, default=8000, help="Number of historical candles")
    args = parser.parse_args()
    
    backtester = WhaleSuiteBacktester(symbol=args.symbol, candle_count=args.candles)
    if backtester.connect_and_fetch():
        backtester.run_simulation()
        backtester.generate_report()
    mt5.shutdown()

if __name__ == "__main__":
    main()
