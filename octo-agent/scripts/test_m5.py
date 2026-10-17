#!/usr/bin/env python3
import sys
import os
import MetaTrader5 as mt5
import numpy as np

sys.path.append(r"c:\Users\Tenders\octo\octo\scripts")
from backtest_whale_engine import calc_poc_and_va
from test_relaxed import RelaxedWhaleBacktester, calculate_dynamic_rsi_local

def main():
    if not mt5.initialize():
        return
    
    print("=" * 60)
    print("        M5 TIMEFRAME HIGH-FIDELITY SIMULATOR")
    print("=" * 60)
    
    # We run on XAUUSD+ with M5 timeframe candles
    bt = RelaxedWhaleBacktester(symbol="XAUUSD+", candle_count=12000) # Fetch 12,000 candles to get deep M5 coverage
    bt.m15_candles = [] # We will load M5 candles here instead
    
    print("[Engine] Ingesting high-fidelity M5 candles...")
    mt5.symbol_select(bt.symbol, True)
    m5_rates = mt5.copy_rates_from_pos(bt.symbol, mt5.TIMEFRAME_M5, 0, 12000 + 500)
    h1_rates = mt5.copy_rates_from_pos(bt.symbol, mt5.TIMEFRAME_H1, 0, int(12000 / 12) + 100)
    d1_rates = mt5.copy_rates_from_pos(bt.symbol, mt5.TIMEFRAME_D1, 0, int(12000 / 288) + 50)
    
    if m5_rates is None or h1_rates is None or d1_rates is None:
        print("[ERROR] Data fetch failed.")
        mt5.shutdown()
        return
        
    from datetime import datetime, timezone
    
    # Process RSI caches
    from backtest_whale_engine import calculate_rsi
    h1_closes = np.array([float(x["close"]) for x in h1_rates])
    h1_times = [datetime.fromtimestamp(int(x["time"]), tz=timezone.utc) for x in h1_rates]
    bt.h1_rsi_cache = {}
    for pd_val in [14, 20]:
        rsi_vals = calculate_rsi(h1_closes, pd_val)
        bt.h1_rsi_cache[pd_val] = {h1_times[j]: rsi_vals[j] for j in range(len(h1_times))}
        
    d1_closes = np.array([float(x["close"]) for x in d1_rates])
    d1_times = [datetime.fromtimestamp(int(x["time"]), tz=timezone.utc) for x in d1_rates]
    d1_rsi = calculate_rsi(d1_closes, 14)
    bt.d1_rsi_cache = {d1_times[j]: d1_rsi[j] for j in range(len(d1_times))}
    
    bt.m15_candles = []
    for r in m5_rates:
        bt.m15_candles.append({
            "time": datetime.fromtimestamp(int(r["time"]), tz=timezone.utc),
            "open": float(r["open"]),
            "high": float(r["high"]),
            "low": float(r["low"]),
            "close": float(r["close"]),
            "volume": int(r["tick_volume"])
        })
        
    bt.point_size = mt5.symbol_info(bt.symbol).point
    
    # Adjust lookback for M5 candles (3x larger since 3 M5 candles = 1 M15)
    for s_idx in bt.sessions:
        bt.sessions[s_idx]["lookback"] = bt.sessions[s_idx]["lookback"] * 3
        
    print("[Engine] Simulating relaxed Whale Suite on M5 timeframe...")
    bt.run_simulation()
    
    n_tr = len(bt.trades)
    wins = len([t for t in bt.trades if t["result"] == "WIN"])
    wr = (wins / n_tr * 100.0) if n_tr > 0 else 0
    pnl = bt.balance - bt.initial_balance
    print(f"[RESULT] XAUUSD+ M5: Trades = {n_tr} | Win Rate = {wr:.2f}% | PnL = ${pnl:+.2f}")
    print("=" * 60)
    
    mt5.shutdown()

if __name__ == "__main__":
    main()
