#!/usr/bin/env python3
"""
SMC Session-Adaptive Risk-to-Reward Backtesting Engine
======================================================
Adapts the target Risk-to-Reward ratio (R:R) dynamically per active session:
- Asia Session (hours 0-8): 1:1.5 R:R (range-bound mean reversion).
- London Session (hours 8-16): 1:3.5 R:R (aggressive trend expansions).
- New York Session (hours 13-21): 1:2.5 R:R (balanced overlap expansions).
"""

import sys
import os
import time
import numpy as np
from datetime import datetime, timezone, timedelta
import MetaTrader5 as mt5

sys.path.append(r"c:\Users\Tenders\octo\octo\scripts")
from backtest_mss_fvg_engine import SMCMasterBacktester
from backtest_whale_engine import calc_poc_and_va

class SessionAdaptiveBacktester(SMCMasterBacktester):
    def get_session_rr(self, hour: int) -> float:
        """Dynamically adapts the Risk-to-Reward ratio based on active session hour."""
        # Convert hour to session-specific R:R
        if 0 <= hour < 8:
            return 1.5  # Asia Session: Tighter target for narrow consolidation ranges
        elif 8 <= hour < 16:
            return 3.5  # London Session: Wide target to capture full trend breakout expansions
        else:
            return 2.5  # New York Session: Balanced target for overlap reversals

    def get_malta_hour(self, dt: datetime) -> int:
        """Converts naive candle timestamp to Malta Hour (UTC+2 standard Summer EET)."""
        # Auto-detect or default to +3 GMT offset for retail Summer broker feeds
        # subtract 3 hours to get UTC, then add 2 hours for Malta EET
        gmt_time = dt - timedelta(hours=3)
        malta_time = gmt_time + timedelta(hours=2)
        return malta_time.hour

    def run_simulation(self):
        n_candles = len(self.m5_candles)
        active_trade = None
        pending_limit = None
        self.equity_curve = []
        
        for i in range(self.swing_lookback + 5, n_candles - 1):
            current_c = self.m5_candles[i]
            c_time = current_c["time"]
            malta_hour = self.get_malta_hour(c_time)
            
            # Manage Active Trade
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
                        pnl = active_trade["risk"] * active_trade["rr"]
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
                        pnl = active_trade["risk"] * active_trade["rr"]
                        self.balance += pnl
                        self.trades.append({**active_trade, "exit_time": c_time, "exit_price": active_trade["tp"], "result": "WIN", "pnl": pnl})
                        active_trade = None
                        
                self.equity_curve.append(self.balance)
                continue
                
            # Manage Pending Limit Order Retests
            if pending_limit:
                high = current_c["high"]
                low = current_c["low"]
                
                if i - pending_limit["set_idx"] > 8:
                    pending_limit = None
                else:
                    if pending_limit["type"] == "LONG":
                        if low <= pending_limit["limit_price"] <= high:
                            active_trade = {
                                "type": "LONG",
                                "entry_time": c_time,
                                "entry_price": pending_limit["limit_price"],
                                "sl": pending_limit["sl"],
                                "tp": pending_limit["tp"],
                                "risk": 100.0,
                                "rr": pending_limit["rr"],
                                "session": pending_limit["session"],
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
                                "rr": pending_limit["rr"],
                                "session": pending_limit["session"],
                                "reason": "MSS + Bearish FVG Retest"
                            }
                            pending_limit = None
                            
                self.equity_curve.append(self.balance)
                continue
                
            # Detect Sweeps of Swing extremes
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
            
            # Determine dynamic RR for active hour
            target_rr = self.get_session_rr(malta_hour)
            session_name = "ASIA" if malta_hour < 8 else ("LONDON" if malta_hour < 16 else "NY")
            
            if is_ssl_sweep:
                for k in range(1, 5):
                    if i + k >= n_candles: break
                    future_c = self.m5_candles[i + k]
                    minor_high = max([x["high"] for x in self.m5_candles[i-5:i]])
                    
                    if future_c["close"] > minor_high:
                        fvg_candle = self.m5_candles[i + k - 1]
                        prev_candle = self.m5_candles[i + k - 2]
                        if future_c["low"] > prev_candle["high"]:
                            limit_p = future_c["low"]
                            sl = c_low - (50 * self.point_size)
                            dist = limit_p - sl
                            if dist > 0:
                                pending_limit = {
                                    "type": "LONG",
                                    "set_idx": i + k,
                                    "limit_price": limit_p,
                                    "sl": sl,
                                    "tp": limit_p + dist * target_rr,
                                    "rr": target_rr,
                                    "session": session_name
                                }
                                break
                                
            elif is_bsl_sweep:
                for k in range(1, 5):
                    if i + k >= n_candles: break
                    future_c = self.m5_candles[i + k]
                    minor_low = min([x["low"] for x in self.m5_candles[i-5:i]])
                    
                    if future_c["close"] < minor_low:
                        fvg_candle = self.m5_candles[i + k - 1]
                        prev_candle = self.m5_candles[i + k - 2]
                        if future_c["high"] < prev_candle["low"]:
                            limit_p = future_c["high"]
                            sl = c_high + (50 * self.point_size)
                            dist = sl - limit_p
                            if dist > 0:
                                pending_limit = {
                                    "type": "SHORT",
                                    "set_idx": i + k,
                                    "limit_price": limit_p,
                                    "sl": sl,
                                    "tp": limit_p - dist * target_rr,
                                    "rr": target_rr,
                                    "session": session_name
                                }
                                break
                                
            self.equity_curve.append(self.balance)

    def print_final_report(self):
        """Displays beautiful ASCII report of session-adaptive SMC results."""
        n_trades = len(self.trades)
        if n_trades == 0:
            print(f"\n[Report] No trades executed for {self.symbol}.")
            return
            
        wins = [t for t in self.trades if t["result"] == "WIN"]
        losses = [t for t in self.trades if t["result"] == "LOSS"]
        
        win_rate = (len(wins) / n_trades) * 100.0
        
        # Calculate PnL based on dynamic RR wins
        gross_profit = 0.0
        gross_loss = 0.0
        for t in self.trades:
            if t["result"] == "WIN":
                gross_profit += t["risk"] * t["rr"]
            else:
                gross_loss += t["risk"]
                
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else gross_profit
        net_profit = self.balance - self.initial_balance
        
        peak = self.initial_balance
        max_dd = 0.0
        for b in self.equity_curve:
            if b > peak: peak = b
            dd = ((peak - b) / peak) * 100.0
            if dd > max_dd: max_dd = dd
            
        print("\n" + "="*60)
        print(f"    SESSION-ADAPTIVE MSS + FVG SMC REPORT: {self.symbol}")
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
    for symbol in symbols:
        tester = SessionAdaptiveBacktester(symbol=symbol, candle_count=15000)
        if tester.connect_and_fetch():
            tester.run_simulation()
            tester.print_final_report()
    mt5.shutdown()

if __name__ == "__main__":
    main()
