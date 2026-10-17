#!/usr/bin/env python3
"""
Institutional MSS + FVG Retest Trading Engine (SMC Masterclass)
==============================================================
Simulates high-fidelity Smart Money Concepts (SMC) execution on 5-Minute charts:
1. Detects Swing High/Low Liquidity Sweeps (BSL/SSL Grab).
2. Confirms reversal with Market Structure Shift (MSS) displacement.
3. Enters on the retest of the newly created Fair Value Gap (FVG).
4. Employs 1:3 Risk-to-Reward ratio with Stop Loss at the sweep extreme.
"""

import sys
import os
import time
import numpy as np
from datetime import datetime, timezone, timedelta
import MetaTrader5 as mt5

class SMCMasterBacktester:
    def __init__(self, symbol: str, candle_count: int = 15000, swing_lookback: int = 30):
        self.symbol = symbol.upper()
        self.candle_count = candle_count
        self.swing_lookback = swing_lookback
        self.initial_balance = 10000.0
        self.balance = self.initial_balance
        
        self.m5_candles = []
        self.trades = []
        self.equity_curve = []
        self.point_size = 0.01

    def connect_and_fetch(self) -> bool:
        """Fetch high-fidelity 5-Minute (M5) candles directly from MT5."""
        if not mt5.initialize():
            print(f"[Engine] [ERROR] MT5 initialization failed: {mt5.last_error()}")
            return False
            
        s_info = mt5.symbol_info(self.symbol)
        if s_info is None:
            print(f"[Engine] [ERROR] Symbol {self.symbol} not found.")
            return False
        self.point_size = s_info.point
        
        print(f"[Engine] [INFO] Fetching {self.candle_count} M5 candles for {self.symbol}...")
        mt5.symbol_select(self.symbol, True)
        rates = mt5.copy_rates_from_pos(self.symbol, mt5.TIMEFRAME_M5, 0, self.candle_count)
        
        if rates is None or len(rates) == 0:
            print(f"[Engine] [ERROR] Data download empty.")
            return False
            
        self.m5_candles = []
        for r in rates:
            self.m5_candles.append({
                "time": datetime.fromtimestamp(int(r["time"]), tz=timezone.utc),
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": int(r["tick_volume"])
            })
            
        print(f"[Engine] [SUCCESS] Loaded {len(self.m5_candles)} M5 candles.")
        return True

    def run_simulation(self):
        """Simulates the premium MSS + FVG institutional entry model."""
        n_candles = len(self.m5_candles)
        active_trade = None
        pending_limit = None
        self.equity_curve = []
        
        # Grid loop
        for i in range(self.swing_lookback + 5, n_candles - 1):
            current_c = self.m5_candles[i]
            c_time = current_c["time"]
            
            # 1. Manage Active Trade
            if active_trade:
                high = current_c["high"]
                low = current_c["low"]
                
                if active_trade["type"] == "LONG":
                    if low <= active_trade["sl"]:
                        pnl = -active_trade["risk"]
                        self.balance += pnl
                        self.trades.append({**active_trade, "exit_time": c_time, "exit_price": active_trade["sl"], "result": "LOSS", "pnl": pnl})
                        active_trade = None
                    elif high >= active_trade["tp"]:
                        pnl = active_trade["risk"] * 3.0
                        self.balance += pnl
                        self.trades.append({**active_trade, "exit_time": c_time, "exit_price": active_trade["tp"], "result": "WIN", "pnl": pnl})
                        active_trade = None
                elif active_trade["type"] == "SHORT":
                    if high >= active_trade["sl"]:
                        pnl = -active_trade["risk"]
                        self.balance += pnl
                        self.trades.append({**active_trade, "exit_time": c_time, "exit_price": active_trade["sl"], "result": "LOSS", "pnl": pnl})
                        active_trade = None
                    elif low <= active_trade["tp"]:
                        pnl = active_trade["risk"] * 3.0
                        self.balance += pnl
                        self.trades.append({**active_trade, "exit_time": c_time, "exit_price": active_trade["tp"], "result": "WIN", "pnl": pnl})
                        active_trade = None
                        
                self.equity_curve.append(self.balance)
                continue
                
            # 2. Manage Pending Limit Order Retests
            if pending_limit:
                high = current_c["high"]
                low = current_c["low"]
                
                # Check expiration (limit orders expire if not retested within 8 candles / 40 mins)
                if i - pending_limit["set_idx"] > 8:
                    pending_limit = None
                else:
                    if pending_limit["type"] == "LONG":
                        # If price touches the FVG limit range
                        if low <= pending_limit["limit_price"] <= high:
                            active_trade = {
                                "type": "LONG",
                                "entry_time": c_time,
                                "entry_price": pending_limit["limit_price"],
                                "sl": pending_limit["sl"],
                                "tp": pending_limit["tp"],
                                "risk": 100.0,
                                "reason": "MSS + Bullish FVG Retest"
                            }
                            pending_limit = None
                    elif pending_limit["type"] == "SHORT":
                        if low <= pending_limit["limit_price"] <= high:
                            active_trade = {
                                "type": "SHORT",
                                "entry_time": c_time,
                                "entry_price": pending_limit["limit_price"],
                                "sl": pending_limit["sl"],
                                "tp": pending_limit["tp"],
                                "risk": 100.0,
                                "reason": "MSS + Bearish FVG Retest"
                            }
                            pending_limit = None
                            
                self.equity_curve.append(self.balance)
                continue
                
            # 3. Detect Sweeps of Swing extremes (Lookback window)
            window = self.m5_candles[i - self.swing_lookback : i]
            highs = [x["high"] for x in window]
            lows = [x["low"] for x in window]
            
            swing_high = max(highs)
            swing_low = min(lows)
            
            c_high = current_c["high"]
            c_low = current_c["low"]
            c_close = current_c["close"]
            
            is_ssl_sweep = (c_low < swing_low) and (c_close > swing_low)
            is_bsl_sweep = (c_high > swing_high) and (c_close < swing_high)
            
            if is_ssl_sweep:
                # SSL swept! Now search forward for Market Structure Shift (MSS)
                # Look at the next few candles to confirm displacement break of minor swing high
                for k in range(1, 5):
                    if i + k >= n_candles:
                        break
                    future_c = self.m5_candles[i + k]
                    # Minor swing high in window
                    minor_high = max([x["high"] for x in self.m5_candles[i-5:i]])
                    
                    # If high momentum candle closes above minor high -> MSS confirmed!
                    if future_c["close"] > minor_high:
                        # Confirm FVG exists in displacement candle
                        fvg_candle = self.m5_candles[i + k - 1]
                        prev_candle = self.m5_candles[i + k - 2]
                        if future_c["low"] > prev_candle["high"]:
                            # Bullish FVG confirmed! Place limit buy at top of FVG (low of future_c)
                            limit_p = future_c["low"]
                            sl = c_low - (50 * self.point_size)
                            dist = limit_p - sl
                            if dist > 0:
                                pending_limit = {
                                    "type": "LONG",
                                    "set_idx": i + k,
                                    "limit_price": limit_p,
                                    "sl": sl,
                                    "tp": limit_p + dist * 3.0
                                }
                                break
                                
            elif is_bsl_sweep:
                # BSL swept! Search forward for Bearish MSS
                for k in range(1, 5):
                    if i + k >= n_candles:
                        break
                    future_c = self.m5_candles[i + k]
                    minor_low = min([x["low"] for x in self.m5_candles[i-5:i]])
                    
                    if future_c["close"] < minor_low:
                        fvg_candle = self.m5_candles[i + k - 1]
                        prev_candle = self.m5_candles[i + k - 2]
                        if future_c["high"] < prev_candle["low"]:
                            # Bearish FVG confirmed! Limit short at bottom of FVG (high of future_c)
                            limit_p = future_c["high"]
                            sl = c_high + (50 * self.point_size)
                            dist = sl - limit_p
                            if dist > 0:
                                pending_limit = {
                                    "type": "SHORT",
                                    "set_idx": i + k,
                                    "limit_price": limit_p,
                                    "sl": sl,
                                    "tp": limit_p - dist * 3.0
                                }
                                break
                                
            self.equity_curve.append(self.balance)

    def print_final_report(self):
        """Displays beautiful ASCII report of pure institutional SMC results."""
        n_trades = len(self.trades)
        if n_trades == 0:
            print(f"\n[Report] No trades executed for {self.symbol} under pure SMC rules.")
            return
            
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
            if b > peak: peak = b
            dd = ((peak - b) / peak) * 100.0
            if dd > max_dd: max_dd = dd
            
        # Standard ASCII print (safe for Windows CP1252 terminal)
        print("\n" + "="*60)
        print(f"      INSTITUTIONAL MSS + FVG SMC REPORT: {self.symbol}")
        print("="*60)
        print(f"  Net Profit      : ${net_profit:+,.2f} ({(net_profit/self.initial_balance)*100:+.2f}%)")
        print(f"  Total Trades    : {n_trades} (~{n_trades / 15:.2f} trades per day)")
        print(f"  Win / Loss      : {len(wins)} wins / {len(losses)} losses")
        print(f"  Win Rate        : {win_rate:.2f}%")
        print(f"  Profit Factor   : {profit_factor:.2f}")
        print(f"  Max Drawdown    : {max_dd:.2f}%")
        print("="*60)

def main():
    symbols = ["XAUUSD+", "NAS100"]
    # 15,000 5M candles covers approximately 75 calendar days or 52 active trading days
    for symbol in symbols:
        tester = SMCMasterBacktester(symbol=symbol, candle_count=15000)
        if tester.connect_and_fetch():
            tester.run_simulation()
            tester.print_final_report()
            
    # Shutdown MT5
    mt5.shutdown()

if __name__ == "__main__":
    main()
