#!/usr/bin/env python3
"""
Candlestick Sequence Permutation Analyzer (v1.0)
================================================
Inspired by Daniel Opoku's MQL5 Article Series:
"Encoding Candlestick Patterns: Modeling Price Action as an Ordered Sequence"

Transforms historical MT5 candlestick feeds into standardized alphabetical sequences,
calculates strict and repetitive permutations, scans sequences for matching patterns,
and computes their statistical probability matrices and transition edges.
"""

import os
import sys
import time
import argparse
import itertools
import numpy as np
from datetime import datetime, timezone, timedelta
import MetaTrader5 as mt5

def _tf(s: str) -> int:
    return {
        "M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15, "M30": mt5.TIMEFRAME_M30,
        "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1,
    }.get(s.upper(), mt5.TIMEFRAME_M15)

def get_candle_type(o, h, l, c, point_size=1e-5):
    """
    Classifies a candlestick into Daniel Opoku's alphabetical system:
    - A/a: Long / Marubozu
    - G/g: Spinning Top
    - H/h: Pin bar (Hammer)
    - E/e: Inverted pin bar (Shooting Star)
    - D: Doji (Neutral)
    - X/x: Standard Bullish/Bearish Candle (Fallback to maintain sequence continuity)
    """
    body = abs(c - o)
    if body < point_size * 0.1 or c == o:
        return "D"
        
    if c > o: # Bullish
        upper_wick = h - c
        lower_wick = o - l
        
        # A: Marubozu / Long body
        if body > 1.5 * upper_wick and body > 1.5 * lower_wick:
            return "A"
        # G: Spinning Top
        if 2.0 * body < upper_wick and 2.0 * body < lower_wick:
            return "G"
        # H: Pinbar
        if lower_wick > 2.5 * body and lower_wick > 2.0 * upper_wick:
            return "H"
        # E: Inverted Pinbar
        if upper_wick > 2.5 * body and upper_wick > 2.0 * lower_wick:
            return "E"
        return "X" # Standard Bullish Fallback
    else: # Bearish
        upper_wick = h - o
        lower_wick = c - l
        
        # a: Marubozu / Long body
        if body > 1.5 * upper_wick and body > 1.5 * lower_wick:
            return "a"
        # g: Spinning Top
        if 2.0 * body < upper_wick and 2.0 * body < lower_wick:
            return "g"
        # h: Pinbar
        if lower_wick > 2.5 * body and lower_wick > 2.0 * upper_wick:
            return "h"
        # e: Inverted Pinbar
        if upper_wick > 2.5 * body and upper_wick > 2.0 * lower_wick:
            return "e"
        return "x" # Standard Bearish Fallback

class CandlestickPermutationAnalyzer:
    def __init__(self, symbol: str, timeframe: str = "M15", candle_count: int = 2000):
        self.symbol = symbol.upper()
        self.timeframe_str = timeframe.upper()
        self.timeframe = _tf(timeframe)
        self.candle_count = candle_count
        self.point_size = 1e-5
        self.candles = []
        self.encoded_sequence = ""
        self.broker_gmt_offset = 3

    def connect_and_fetch(self) -> bool:
        """Connects to MT5 with path-based self-healing and retrieves candles."""
        if not mt5.initialize():
            exe_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
            if os.path.exists(exe_path) and mt5.initialize(path=exe_path):
                pass
            else:
                return False
                
        # Detect broker offset
        tick = mt5.symbol_info_tick(self.symbol)
        if tick:
            server_time = tick.time
            utc_time = int(time.time())
            if abs(utc_time - server_time) > 3 * 3600:
                self.broker_gmt_offset = 3
            else:
                self.broker_gmt_offset = round((server_time - utc_time) / 3600.0)
        else:
            self.broker_gmt_offset = 3

        s_info = mt5.symbol_info(self.symbol)
        if s_info is None:
            alt = self.symbol.replace("+", "")
            s_info = mt5.symbol_info(alt)
            if s_info:
                self.symbol = alt
            else:
                return False
        self.point_size = s_info.point

        mt5.symbol_select(self.symbol, True)
        rates = mt5.copy_rates_from_pos(self.symbol, self.timeframe, 1, self.candle_count)
        
        if rates is None or len(rates) == 0:
            return False
            
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
        return True

    def encode_all_candles(self):
        """Encodes all fetched candles into an ordered string sequence."""
        seq_list = []
        for c in self.candles:
            code = get_candle_type(c["open"], c["high"], c["low"], c["close"], self.point_size)
            seq_list.append(code)
        self.encoded_sequence = "".join(seq_list)

    def analyze_patterns(self, pattern_len: int = 3, repetition: bool = True):
        """
        Generates theoretical permutations, matches against historical sequences,
        and solves transition outcomes (next candle bullish vs bearish).
        """
        alphabet = "AHEGDX" if repetition else "AHEGDX" # Focus on standard bullish/bearish sets
        # Combine both sets
        full_alphabet = "AHEGDXahegdx"
        
        print(f"\n[Permutations] Generating combinatorial patterns of length {pattern_len}...")
        if repetition:
            perms = ["".join(p) for p in itertools.product(full_alphabet, repeat=pattern_len)]
        else:
            perms = ["".join(p) for p in itertools.permutations(full_alphabet, pattern_len)]
            
        print(f"[Permutations] Completed. Total theoretical permutations: {len(perms)}")
        
        # Scan encoded sequence
        n_seq = len(self.encoded_sequence)
        match_counts = {}
        outcomes = {} # tracks next candle state: 'bullish' (upper case or X) vs 'bearish' (lower case or x)
        
        for i in range(n_seq - pattern_len):
            sub = self.encoded_sequence[i : i + pattern_len]
            next_char = self.encoded_sequence[i + pattern_len]
            
            # Outcome calculation: is the next candle bullish or bearish?
            is_next_bullish = next_char in "AHEGDX"
            
            match_counts[sub] = match_counts.get(sub, 0) + 1
            if sub not in outcomes:
                outcomes[sub] = {"bullish": 0, "bearish": 0}
            if is_next_bullish:
                outcomes[sub]["bullish"] += 1
            else:
                outcomes[sub]["bearish"] += 1
                
        # Filter and rank actual matches
        ranked_matches = []
        for pat, cnt in match_counts.items():
            out = outcomes.get(pat, {"bullish": 0, "bearish": 0})
            total_out = out["bullish"] + out["bearish"]
            bull_pct = (out["bullish"] / total_out * 100.0) if total_out > 0 else 50.0
            bear_pct = (out["bearish"] / total_out * 100.0) if total_out > 0 else 50.0
            
            ranked_matches.append({
                "pattern": pat,
                "occurrences": cnt,
                "bull_pct": bull_pct,
                "bear_pct": bear_pct,
                "total_transitions": total_out
            })
            
        ranked_matches.sort(key=lambda x: x["occurrences"], reverse=True)
        return ranked_matches, perms

def main():
    parser = argparse.ArgumentParser(description="Candlestick Sequence Permutation Analyzer")
    parser.add_argument("--symbol", type=str, default="EURUSD+", help="MT5 Symbol")
    parser.add_argument("--timeframe", type=str, default="M15", help="Timeframe (M5, M15, H1, etc.)")
    parser.add_argument("--candles", type=int, default=2000, help="Number of candles to scan")
    parser.add_argument("--length", type=int, default=3, help=" candlestick sequence pattern length (r)")
    parser.add_argument("--no-repeat", action="store_true", help="Generate permutations without repetition")
    args = parser.parse_args()

    print("=" * 70)
    print("      CANDLESTICK SEQUENCE COMBINATORIAL PERMUTATION ANALYZER")
    print("=" * 70)
    print(f" Symbol      : {args.symbol}")
    print(f" Timeframe   : {args.timeframe}")
    print(f" Lookback    : {args.candles} bars")
    print(f" Pattern Len : {args.length} bars")
    print(f" Mode        : {'Permutation WITHOUT Repetition' if args.no_repeat else 'Permutation WITH Repetition'}")
    print("=" * 70)

    analyzer = CandlestickPermutationAnalyzer(args.symbol, args.timeframe, args.candles)
    print("[Analyzer] Fetching historical candle feed from MetaTrader 5...")
    if not analyzer.connect_and_fetch():
        print("[ERROR] Failed to fetch rates or connect to MT5.")
        mt5.shutdown()
        return

    print(f"[Analyzer] Successfully loaded {len(analyzer.candles)} candles.")
    print("[Analyzer] Mapping price wicks & body ratios into alphabetical symbols...")
    analyzer.encode_all_candles()
    print(f"[Analyzer] Encoded Sequence Preview: {analyzer.encoded_sequence[:120]}...")
    
    # Run analysis
    matches, theoretical_perms = analyzer.analyze_patterns(args.length, not args.no_repeat)
    mt5.shutdown()

    # Generate Markdown report
    report_path = f"C:\\Users\\Tenders\\octo\\backtest_report_candlestick_permutations_{args.symbol}.md"
    
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(f"# CANDLESTICK PERMUTATION SEQUENCE ANALYSIS: {args.symbol}\n\n")
        f.write(f"Generated on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')} using active MT5 data feed.\n")
        f.write(f"Scan Window: **{args.candles} candles** on timeframe **{args.timeframe}**.\n\n")
        
        f.write("## Executive Combined Summary\n")
        f.write(f"- **Total Alphabetical Symbols:** 12 (`AHEGDX` for bullish, `ahegdx` for bearish)\n")
        f.write(f"- **Theoretical Permutations possible:** `{len(theoretical_perms):,}`\n")
        f.write(f"- **Unique Sequence Combinations found:** `{len(matches)}` matches\n\n")
        
        f.write("> [!NOTE]\n")
        f.write("> **Daniel Opoku's Pattern Mapping Key:**\n")
        f.write("> * **`A` / `a`**: Bullish / Bearish Marubozu (Aggressive buying/selling, no wicks)\n")
        f.write("> * **`H` / `h`**: Bullish / Bearish Hammer (Lower wick rejection)\n")
        f.write("> * **`E` / `e`**: Bullish / Bearish Shooting Star (Upper wick rejection)\n")
        f.write("> * **`G` / `g`**: Bullish / Bearish Spinning Top (Indecision, short body with both wicks)\n")
        f.write("> * **`D`**: Neutral Doji (Absolute equilibrium, Open == Close)\n")
        f.write("> * **`X` / `x`**: Standard Bullish / Bearish Candle (Sequence continuation fallback)\n\n")

        f.write("## Top 15 Highly Frequent Sequences & Edge Outcomes\n")
        f.write("Tracks what happened *immediately after* the sequence completed (Bullish/Bearish edge):\n\n")
        f.write("| Rank | Pattern | Occurrences | Bullish Outcome % | Bearish Outcome % | Transitions Count |\n")
        f.write("| :--- | :--- | :--- | :--- | :--- | :--- |\n")
        
        for rank, m in enumerate(matches[:15], 1):
            edge_icon = "🟢" if m["bull_pct"] > 55.0 else ("🔴" if m["bear_pct"] > 55.0 else "⚪")
            f.write(f"| {rank} | {edge_icon} **`{m['pattern']}`** | `{m['occurrences']}` | `{m['bull_pct']:.2f}%` | `{m['bear_pct']:.2f}%` | `{m['total_transitions']}` |\n")
            
        f.write("\n## 🔍 Quantitative Price-Action Insights\n")
        f.write("1. **Sequence Predictability:** Patterns showing an asymmetrical outcome (e.g., Bullish Outcome > 58% or Bearish Outcome > 58%) represent statistically high-probability directional bias edges.\n")
        f.write("2. **Regime Transition Verification:** These sequences can be directly used as micro-regime state inputs to filter SMC breakout zones, preventing entry during chop (often characterized by repetitive `G` or `D` patterns).\n")
        
    print(f"\n[SUCCESS] Completed sequence permutation sweep.")
    print(f"Top 5 frequent matches:")
    for rank, m in enumerate(matches[:5], 1):
        print(f"  #{rank}: Pattern `{m['pattern']}` | Count: {m['occurrences']} | Bullish {m['bull_pct']:.1f}% | Bearish {m['bear_pct']:.1f}%")
        
    print(f"\nFull detailed Markdown report generated and saved at:\n  {report_path}\n")

if __name__ == "__main__":
    main()
