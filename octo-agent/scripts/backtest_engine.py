#!/usr/bin/env python3
"""
SMC & Liquidity Sweep Backtesting Engine
========================================
Connects to MetaTrader 5, retrieves historical candles, programmatically detects
Liquidity Sweeps (wick-grabs of swing points) and Fair Value Gaps (FVG), runs
a simulated trading loop, and generates institutional backtest reports.
"""

import sys
import os
import argparse
from datetime import datetime, timezone
import MetaTrader5 as mt5

def _tf(s: str) -> int:
    """Map string timeframes to MetaTrader 5 TIMEFRAME constants."""
    return {
        "M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15, "M30": mt5.TIMEFRAME_M30,
        "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1, "W1": mt5.TIMEFRAME_W1,
        "MN1": mt5.TIMEFRAME_MN1,
    }.get(s.upper(), mt5.TIMEFRAME_H1)

class SMCBacktester:
    def __init__(self, symbol: str, timeframe: str, count: int, rr: float, lookback: int):
        self.symbol = symbol.upper()
        self.timeframe_str = timeframe.upper()
        self.timeframe = _tf(timeframe)
        self.candle_count = count
        self.risk_reward = rr
        self.lookback = lookback
        
        self.candles = []
        self.trades = []
        self.equity_curve = []
        self.initial_balance = 10000.0
        self.balance = self.initial_balance

    def connect_and_fetch(self) -> bool:
        """Connects to MT5 and retrieves historical rates."""
        print(f"[Engine] [INFO] Connecting to MT5 terminal...")
        if not mt5.initialize():
            print(f"[Engine] [ERROR] Connection failed: {mt5.last_error()}")
            return False
            
        print(f"[Engine] [INFO] Fetching {self.candle_count} candles of {self.symbol} ({self.timeframe_str})...")
        mt5.symbol_select(self.symbol, True)
        rates = mt5.copy_rates_from_pos(self.symbol, self.timeframe, 0, self.candle_count)
        
        if rates is None or len(rates) == 0:
            print(f"[Engine] [ERROR] Failed to fetch candles for {self.symbol}. Check connection/symbol name.")
            return False
            
        # Parse into usable dictionaries
        self.candles = []
        for r in rates:
            self.candles.append({
                "time": datetime.fromtimestamp(int(r["time"]), tz=timezone.utc),
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": int(r["tick_volume"])
            })
            
        print(f"[Engine] [SUCCESS] Successfully loaded {len(self.candles)} candles.")
        return True

    def run_simulation(self):
        """Main backtesting loop using organic SMC rules."""
        print("[Engine] [INFO] Processing structural algorithms...")
        
        active_trade = None
        n_candles = len(self.candles)
        
        for i in range(self.lookback + 2, n_candles - 1):
            current_candle = self.candles[i]
            
            # 1. Manage Active Trade (check SL/TP)
            if active_trade:
                trade_closed = False
                high = current_candle["high"]
                low = current_candle["low"]
                
                if active_trade["type"] == "LONG":
                    if low <= active_trade["sl"]:
                        # Hit Stop Loss
                        pnl = -active_trade["risk_amount"]
                        self.balance += pnl
                        self.trades.append({
                            **active_trade,
                            "exit_time": current_candle["time"],
                            "exit_price": active_trade["sl"],
                            "result": "LOSS",
                            "pnl": pnl,
                            "balance_after": self.balance
                        })
                        active_trade = None
                        trade_closed = True
                    elif high >= active_trade["tp"]:
                        # Hit Take Profit
                        pnl = active_trade["risk_amount"] * self.risk_reward
                        self.balance += pnl
                        self.trades.append({
                            **active_trade,
                            "exit_time": current_candle["time"],
                            "exit_price": active_trade["tp"],
                            "result": "WIN",
                            "pnl": pnl,
                            "balance_after": self.balance
                        })
                        active_trade = None
                        trade_closed = True
                
                elif active_trade["type"] == "SHORT":
                    if high >= active_trade["sl"]:
                        # Hit Stop Loss
                        pnl = -active_trade["risk_amount"]
                        self.balance += pnl
                        self.trades.append({
                            **active_trade,
                            "exit_time": current_candle["time"],
                            "exit_price": active_trade["sl"],
                            "result": "LOSS",
                            "pnl": pnl,
                            "balance_after": self.balance
                        })
                        active_trade = None
                        trade_closed = True
                    elif low <= active_trade["tp"]:
                        # Hit Take Profit
                        pnl = active_trade["risk_amount"] * self.risk_reward
                        self.balance += pnl
                        self.trades.append({
                            **active_trade,
                            "exit_time": current_candle["time"],
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

            # 2. Skip scanning if already inside a trade (SMC concentration lock)
            if active_trade:
                self.equity_curve.append(self.balance)
                continue

            # 3. Detect Swing extremes over lookback window
            window = self.candles[i - self.lookback : i]
            highs = [c["high"] for c in window]
            lows = [c["low"] for c in window]
            
            swing_high = max(highs)
            swing_low = min(lows)
            
            # 4. Check for Liquidity Wick Sweeps
            c_high = current_candle["high"]
            c_low = current_candle["low"]
            c_close = current_candle["close"]
            c_open = current_candle["open"]
            
            is_bullish_sweep = (c_low < swing_low) and (c_close > swing_low)
            is_bearish_sweep = (c_high > swing_high) and (c_close < swing_high)
            
            # 5. Check for 3-Candle Fair Value Gaps (FVG)
            # Bullish FVG: High[i-2] < Low[i] (imbalance on candle i-1)
            # Bearish FVG: Low[i-2] > High[i] (imbalance on candle i-1)
            fvg_bullish = self.candles[i-2]["high"] < self.candles[i]["low"]
            fvg_bearish = self.candles[i-2]["low"] > self.candles[i]["high"]
            
            # 6. Execute Simulated Trades on Confluence
            if is_bullish_sweep:
                # Open Long position (fade the retail breakdown)
                sl = c_low - (c_high - c_low) * 0.05 # Add dynamic buffer to wick low
                risk = 100.0 # Strict $100 risk per trade
                dist = c_close - sl
                if dist > 0:
                    active_trade = {
                        "type": "LONG",
                        "entry_time": current_candle["time"],
                        "entry_price": c_close,
                        "sl": sl,
                        "tp": c_close + dist * self.risk_reward,
                        "risk_amount": risk,
                        "reason": "Bullish SSL Sweep" + (" + FVG Confluence" if fvg_bullish else "")
                    }
                    
            elif is_bearish_sweep:
                # Open Short position (fade the retail breakout)
                sl = c_high + (c_high - c_low) * 0.05 # Add dynamic buffer to wick high
                risk = 100.0 # Strict $100 risk per trade
                dist = sl - c_close
                if dist > 0:
                    active_trade = {
                        "type": "SHORT",
                        "entry_time": current_candle["time"],
                        "entry_price": c_close,
                        "sl": sl,
                        "tp": c_close - dist * self.risk_reward,
                        "risk_amount": risk,
                        "reason": "Bearish BSL Sweep" + (" + FVG Confluence" if fvg_bearish else "")
                    }
                    
            self.equity_curve.append(self.balance)

    def print_report(self):
        """Displays beautiful statistical report of simulation."""
        n_trades = len(self.trades)
        if n_trades == 0:
            print("\n[Report] [WARN] No trades were executed in this timeframe/lookback configuration.")
            return

        wins = [t for t in self.trades if t["result"] == "WIN"]
        losses = [t for t in self.trades if t["result"] == "LOSS"]
        
        win_rate = (len(wins) / n_trades) * 100.0
        
        gross_profit = sum(t["pnl"] for t in wins)
        gross_loss = abs(sum(t["pnl"] for t in losses))
        
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else gross_profit
        net_profit = self.balance - self.initial_balance
        
        # Calculate Peak-to-Trough Drawdown
        peak = self.initial_balance
        max_dd = 0.0
        for b in self.equity_curve:
            if b > peak:
                peak = b
            dd = ((peak - b) / peak) * 100.0
            if dd > max_dd:
                max_dd = dd

        report_path = f"backtest_report_{self.symbol}.md"
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(f"# OCTO MATRIX BACKTEST REPORT: {self.symbol} ({self.timeframe_str})\n\n")
            f.write(f"Generated on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')} using active MT5 data feed.\n\n")
            
            f.write("## Executive Performance Summary\n")
            f.write("| Metric | Value |\n")
            f.write("| :--- | :--- |\n")
            f.write(f"| **Symbol** | `{self.symbol}` |\n")
            f.write(f"| **Timeframe** | `{self.timeframe_str}` |\n")
            f.write(f"| **Initial Balance** | `${self.initial_balance:,.2f}` |\n")
            f.write(f"| **Final Balance** | `${self.balance:,.2f}` |\n")
            f.write(f"| **Net Profit** | `${net_profit:+,.2f}` ({(net_profit/self.initial_balance)*100:+.2f}%) |\n")
            f.write(f"| **Total Executed Trades** | `{n_trades}` |\n")
            f.write(f"| **Wins / Losses** | `{len(wins)} / {len(losses)}` |\n")
            f.write(f"| **Win Rate** | `{win_rate:.2f}%` |\n")
            f.write(f"| **Profit Factor** | `{profit_factor:.2f}` |\n")
            f.write(f"| **Max Equity Drawdown** | `{max_dd:.2f}%` |\n\n")
            
            f.write("## Playbook Trade History\n")
            f.write("| Ticket | Type | Entry Time | Entry | SL | TP | Exit Time | Result | PnL ($) | Balance ($) |\n")
            f.write("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n")
            for idx, t in enumerate(self.trades):
                f.write(f"| #{idx+1} | `{t['type']}` | {t['entry_time'].strftime('%m-%d %H:%M')} | {t['entry_price']:.5f} | {t['sl']:.5f} | {t['tp']:.5f} | {t['exit_time'].strftime('%m-%d %H:%M')} | **{t['result']}** | {t['pnl']:+,.2f} | {t['balance_after']:,.2f} |\n")

        print("\n" + "="*60)
        print(f"       OCTO MATRIX BACKTEST REPORT: {self.symbol} ({self.timeframe_str})")
        print("="*60)
        print(f"  Net Profit      : ${net_profit:+,.2f} ({(net_profit/self.initial_balance)*100:+.2f}%)")
        print(f"  Total Trades    : {n_trades}")
        print(f"  Win Rate        : {win_rate:.2f}%")
        print(f"  Profit Factor   : {profit_factor:.2f}")
        print(f"  Max Drawdown    : {max_dd:.2f}%")
        print("="*60)
        print(f"[SUCCESS] Full report saved to: {os.path.abspath(report_path)}")
        print("="*60)

def main():
    parser = argparse.ArgumentParser(description="OCTO-Pro SMC & Liquidity Sweep Backtester")
    parser.add_argument("--symbol", type=str, default="XAUUSD", help="Symbol to backtest (e.g. XAUUSD, EURUSD)")
    parser.add_argument("--timeframe", type=str, default="H1", help="Timeframe (e.g. M15, H1, D1)")
    parser.add_argument("--candles", type=int, default=1000, help="Number of historical candles")
    parser.add_argument("--rr", type=float, default=3.0, help="Risk-to-Reward Ratio (e.g. 3.0)")
    parser.add_argument("--lookback", type=int, default=20, help="Swing extreme lookback window")
    
    args = parser.parse_args()
    
    backtester = SMCBacktester(
        symbol=args.symbol,
        timeframe=args.timeframe,
        count=args.candles,
        rr=args.rr,
        lookback=args.lookback
    )
    
    if backtester.connect_and_fetch():
        backtester.run_simulation()
        backtester.print_report()
    
    # Shutdown MT5 connection clean
    mt5.shutdown()

if __name__ == "__main__":
    main()
