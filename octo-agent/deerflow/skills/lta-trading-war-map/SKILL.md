---
name: lta-trading-war-map
description: LTA/LTW Trading War Map strategy utilizing Auction Market Theory, Volume Profile key zones (VAH, VAL, POC), CME liquidity traps, and Sunday Open biases.
origin: User Request
---

# 🗺️ LTA/LTW Trading War Map Playbook

This skill outlines the professional trading strategy playbook based on **Auction Market Theory (AMT)** and the **LTA Concepts Trading War Map**. Use this guide to programmatically align your multi-agent trading desks (Sovereign Risk, Portfolio Router, and Specialists) to execute high-probability institutional volume trades.

---

## 🏛️ 1. Auction Market Theory (AMT) Core Biases

The financial market is a continuous auction searching for "fair value." Price operates in two distinct phases:
1. **Balanced Phase (Consolidation)**: Price remains inside the Value Area (VAH to VAL) where buyers and sellers agree on value. 70% of volume is traded here.
2. **Imbalanced Phase (Expansion/Trend)**: Price breaks out of the Value Area and moves rapidly in search of a new balance zone.

### Key Key Levels & Battlegrounds
*   **POC (Point of Control)**: The price level with the single highest concentration of traded volume in the session. Act as a powerful magnet; price is attracted to the POC.
*   **VAH (Value Area High)**: The upper boundary containing 70% of the session volume. Represents the threshold where price is considered **expensive** (Premium).
*   **VAL (Value Area Low)**: The lower boundary containing 70% of the session volume. Represents the threshold where price is considered **cheap** (Discount).
*   **HVN (High Volume Node)**: Heavy consolidation zones. Support/resistance blocks where price spends significant time.
*   **LVN (Low Volume Node)**: Thin volume voids. Price sweeps through these zones extremely fast.

---

## ⚔️ 2. The CME Play (Consolidation, Manipulation, Expansion)

The primary entry model of the LTW War Map is the **CME Play**, designed to target retail stop-losses and ride institutional order flow.

```text
       [Manipulation]
       Sweep above VAH
          /\/\
_________/    \________  <-- VAH
|                     |
|    Consolidation    |  [Value Area / Balance]
|_____________________|
         \    /          <-- VAL
          \/\/
       [Manipulation]
       Sweep below VAL
            |
            | ===> [Expansion Phase]
            |      Massive impulse trend
            v
```

1. **Consolidation**: Price builds a tight range inside the session Value Area. Contract accumulation occurs.
2. **Manipulation (The Stop-Hunt/Liquidity Sweep)**: Market makers push price violently outside the Value Area extremes (breaking past VAH or VAL, or sweeping the **Sunday Open**) to trigger retail stop-losses and capture counterparty liquidity.
3. **Expansion (The Real Trend Move)**: Following the sweep, price reverses sharply back inside the range, breaks through the POC, and expands aggressively in the opposite direction.

---

## 🎯 3. Multi-Agent Swarm Operational Directives

### 🛡️ Sovereign Risk Desk
*   **Rule**: Never enter trades directly before high-impact news (NFP, FOMC, CPI) unless price has already finished the Manipulation sweep and is entering the Expansion phase with verified tick-pressure backing.
*   **Sunday Open Filter**: Track the **Sunday Open** price. Below Sunday Open favors short/sell manipulation traps; above Sunday Open favors long/buy sweeps.

### 🧭 Portfolio Execution Router
*   **Rule**: Do not buy at the top (VAH boundary) or sell at the bottom (VAL boundary) of a balanced range. 
*   **Execution Rule**:
    *   **LONG entries**: Triggered *only* when price sweeps below VAL (Manipulation), recovers back above VAL, and volume tick pressure verifies a shift back towards the POC. Target the VAH.
    *   **SHORT entries**: Triggered *only* when price sweeps above VAH (Manipulation), recovers back below VAH, and volume tick pressure verifies a shift back towards the POC. Target the VAL.

### 🦁 Specialized Asset Specialists
*   **Alpha Euro, Crude Titan, Crypto Centurion**: Track High Volume Nodes (HVNs) for profit-taking targets (Take Profit) and Low Volume Nodes (LVNs) for fast momentum entries.
