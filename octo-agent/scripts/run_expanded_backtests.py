#!/usr/bin/env python3
"""
Whale Suite Expanded Asset Backtester
====================================
Runs the Whale Suite backtester for GBPUSD+, USDJPY+, AUDUSD+, NAS100, and AAPL.
"""

import sys
import os
import MetaTrader5 as mt5

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from backtest_whale_engine import WhaleSuiteBacktester

def main():
    symbols = ["GBPUSD+", "USDJPY+", "AUDUSD+", "NAS100", "AAPL", "BTCUSD+"]
    candle_count = 8000
    results = []
    
    print("=" * 60)
    print("      WHALE SUITE EXPANDED FOREX & STOCK SIMULATOR")
    print("=" * 60)
    
    if not mt5.initialize():
        import os
        exe_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
        if os.path.exists(exe_path) and mt5.initialize(path=exe_path):
            pass
        else:
            print(f"[ERROR] Failed to initialize MT5: {mt5.last_error()}")
            return
        
    for symbol in symbols:
        print(f"\nRunning simulation for {symbol}...")
        backtester = WhaleSuiteBacktester(symbol=symbol, candle_count=candle_count)
        
        try:
            if backtester.connect_and_fetch():
                backtester.run_simulation()
                res = backtester.generate_report()
                if res:
                    results.append(res)
                    print(f"Completed {symbol}: Win Rate {res['win_rate']:.2f}% | PnL {res['net_profit_pct']:+.2f}%")
                else:
                    print(f"[WARN] No trades for {symbol}.")
            else:
                print(f"[ERROR] Connection/Fetch failed for {symbol}.")
        except Exception as e:
            print(f"[ERROR] Exception occurred during {symbol}: {e}")
            
    mt5.shutdown()
    
    if not results:
        print("\n[ERROR] No results generated.")
        return
        
    results.sort(key=lambda x: x["net_profit_pct"], reverse=True)
    
    print("\n" + "=" * 60)
    print("              EXPANDED ASSET LEADERBOARD")
    print("=" * 60)
    for rank, r in enumerate(results):
        print(f"Rank {rank+1}: {r['symbol']} | PnL: {r['net_profit_pct']:+.2f}% | Trades: {r['trades']} | Win Rate: {r['win_rate']:.2f}% | PF: {r['profit_factor']:.2f} | MaxDD: {r['max_dd']:.2f}%")
    print("=" * 60)

if __name__ == "__main__":
    main()
