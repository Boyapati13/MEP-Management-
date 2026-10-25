# OCTO-Pro Super Model — Technical & Quantitative Architecture

This document outlines the detailed system topologies, high-fidelity asynchronous data flows, localized technical indicator mathematics, quantitative news sentiment grading rules, and resilient connection state machines powering the **OCTO-Pro** ecosystem.

---

## 1. Unified System Topology

The OCTO-Pro architecture maps a closed sensory, learning, and execution stack designed for 24/7 autonomous operations:

```
                  ┌──────────────────────────────────────────────────┐
                  │              OCTO-Pro Desktop Monolith           │
                  │              (PyQt6 Dashboard & HUD)             │
                  └────────┬────────────────────────────────┬────────┘
                           │                                │
                           ▼                                ▼
       ┌────────────────────────────────────────┐ ┌────────────────────┐
       │             Sensory System             │ │   Hermes Engine    │
       │   (Real-time Voice & Vision Edge)      │ │   (Memory Loop)    │
       └───────────────────┬────────────────────┘ └─────────┬──────────┘
                           │                                │
                           ▼                                ▼
       ┌───────────────────────────────────────────────────────────────┐
       │             LangGraph Orchestration & Sandboxing              │
       │                       (DeerFlow 2.0)                          │
       └───────────────────────────────┬───────────────────────────────┘
                                       │
                                       ▼
       ┌───────────────────────────────────────────────────────────────┐
       │            Free-Claude-Code Model Routing Proxy               │
       │                 (FastAPI Intercept Engine)                    │
       └───────────────────────────────┬───────────────────────────────┘
                                       │
                                       ▼
       ┌───────────────────────────────────────────────────────────────┐
       │                NVIDIA NIM / DeepSeek / Ollama                 │
       │                     (Optimal LLM Backends)                    │
       └───────────────────────────────────────────────────────────────┘
```

| Layer | Component | Responsibility |
| :--- | :--- | :--- |
| **Edge Interface** | Mark-XXXIX | Real-time screen perception, voice streaming (Riva/Whisper), and atomic OS execution. |
| **Orchestrator** | DeerFlow 2.0 | Complex goal decomposition, parallel sub-agent tasks, and dockerized sandboxing. |
| **Memory** | Hermes Agent | Closed-loop skill extraction (agentskills.io), Honcho user modeling, and SQLite FTS5 session search. |
| **Model Routing** | Free-Claude-Code | FastAPI API interceptor, protocol translation (OpenAI to Anthropic SSE), and thinking blocks routing. |

---

## 2. High-Expectancy AI Quant & Algorithmic Trading Architecture

OCTO integrates an advanced, multi-threaded quantitative engine that executes trading strategies, performs live macro-geopolitical news analysis, and runs walk-forward optimization loops.

```
       ┌───────────────────────────────┐
       │   MetaTrader 5 Server (MT5)   │
       └───────────────┬───────────────┘
                       │ Live Tick-level OHLCV Streams
                       ▼
       ┌───────────────────────────────┐
       │      run_live_bot.py Loop     │
       │  (ADX / MACD / VWAP / Swing)  │
       └──────┬─────────────────┬──────┘
              │                 │ Evaluates
              │                 ▼ Proposed Trade
              │        ┌─────────────────┐
              │        │  G4 Risk Gate   │
              │        │ (trading_risk_  │◀─── [timesfm_signal.json]
              │        │   manager.py)   │     (TimesFM Zero-Shot Forecast)
              │        └────────┬────────┘
              │                 │
              │                 ▼ Decisions (BLOCK | SOFT | WARN)
              │        ┌─────────────────┐
              │        │   Macro Gate    │◀─── [macro_sentiment.json]
              │        │(macro_sentiment_│     (Geopolitical RSS crawler)
              │        │   analyst.py)   │
              │        └────────┬────────┘
              │                 │
              ▼                 ▼ Applies lot multiplier (1.0 / 0.5 / 0.0)
       ┌─────────────────────────────────┐
       │     Live Order Execution        │
       │ (1% Risk, Breakeven Trailing)   │
       └─────────────────────────────────┘
```

### 2.1 Multi-Asset Strategic Execution

The live execution engine ([run_live_bot.py](file:///c:/Users/Tenders/octo/octo/scripts/run_live_bot.py)) partitions the portfolio into two distinct execution frameworks:

*   **Forex Majors (EURUSD+, GBPUSD+):** Evaluated on the H1 timeframe using a **Robust RSI & EMA Plateau** model. Trend confirmations require alignment of localized ADX strength and MACD momentum crossovers.
*   **Indices & Safe Havens (NAS100, XAUUSD+):** Evaluated on the M15 timeframe using a **Pure Volume Breakout** model. Wicks are parsed for absorption zones, requiring entry confirmations relative to Volume-Weighted Average Price (VWAP) discount boundaries.

---

## 3. High-Fidelity Local Technical Indicators

To guarantee offline resiliency and remove third-party dependencies, the bot computes technical indicators locally using optimized `NumPy` formulations:

### 3.1 Exponential Moving Average (EMA)
Computes trend direction using a smoothing factor $\alpha$:
$$EMA_t = \alpha \cdot Price_t + (1 - \alpha) \cdot EMA_{t-1}$$
$$\alpha = \frac{2}{Period + 1}$$

### 3.2 Relative Strength Index (RSI)
Measures the velocity and magnitude of directional price movements over a specified lookback period $N$ (default = 14):
$$RS = \frac{\text{Smoothed Gain}}{\text{Smoothed Loss}}$$
$$RSI = 100 - \frac{100}{1 + RS}$$

### 3.3 Average Directional Index (ADX)
Used as an absolute trend strength blocker. If $ADX_t < 25$, the market is classified as ranging, and trend-following signals are automatically bypassed.
*   Directional Movement is defined as:
    $$+DM = \text{High}_t - \text{High}_{t-1} \quad (\text{if } +DM > -DM \text{ and } +DM > 0, \text{ else } 0)$$
    $$-DM = \text{Low}_{t-1} - \text{Low}_t \quad (\text{if } -DM > +DM \text{ and } -DM > 0, \text{ else } 0)$$
*   Indicator values are smoothed over $N$ periods via Wilder's techniques to derive $+DI$, $-DI$, and the final $ADX$.

### 3.4 Volume-Weighted Average Price (VWAP)
Used as a value filter for breakout trades. Purchases are gated to prevent buying at premium valuations or selling at discount valuations:
$$VWAP_t = \frac{\sum_{i=1}^t (Price_i \cdot Volume_i)}{\sum_{i=1}^t Volume_i}$$
*   **Gating Rule:** Buy orders are blocked if $Price > VWAP_t$ (Premium); Sell orders are blocked if $Price < VWAP_t$ (Discount).

### 3.5 Swing Level TP Boundaries
Rather than setting arbitrary static targets, Take Profit (TP) bounds are calculated dynamically using recent swing pivots over a designated lookback window $L$:
$$\text{Swing High (Resistance)} = \max(\text{High}_{t-L} \dots \text{High}_t)$$
$$\text{Swing Low (Support)} = \min(\text{Low}_{t-L} \dots \text{Low}_t)$$

---

## 4. Senior Quantitative Macro Sentiment Crawler & Gating

The risk system processes qualitative macroeconomic events and central bank policies through a dual-layered gating system:

```
[Google News RSS Feeds]
          │
          ▼  Crawled every 15 mins
┌────────────────────────────────────────────────────────┐
│             macro_sentiment_analyst.py                 │
├────────────────────────────────────────────────────────┤
│ Lexicon Matching & Score Scaling:                      │
│ - Geopolitical Escalation:   +1.5 Bull / -1.2 Bear      │
│ - Hawkish Central Bank:      +1.5 Bull / -1.2 Bear      │
│ - Energy Supply Disruptions: +1.5 Bull                  │
└─────────────────────────┬──────────────────────────────┘
                          │ Writes macro_sentiment.json
                          ▼
┌────────────────────────────────────────────────────────┐
│               trading_risk_manager.py                  │
├────────────────────────────────────────────────────────┤
│ G4 Gate Decisions:                                     │
│ - BLOCK : Contrary trades hard-blocked                 │
│ - SOFT  : Lot size multiplied by 0.5                   │
│ - WARN  : Telegram alert generated; full trade executes │
│ - OFF   : G4 disabled                                  │
├────────────────────────────────────────────────────────┤
│ Macro-Overlay Bypass:                                  │
│ - If Geopolitical Risk is "CRITICAL" or "HIGH",        │
│   contrary trades are HALVED even if G4 is OFF.        │
└────────────────────────────────────────────────────────┘
```

### 4.1 Linguistic Sentiment Lexicon & Scoring
The [macro_sentiment_analyst.py](file:///c:/Users/Tenders/octo/octo/scripts/macro_sentiment_analyst.py) script crawler extracts real-time headlines across three query spaces:
1.  **Geopolitics:** Tracks word matrices such as `escalation`, `military conflict`, `sanctions`, and `ceasefire`.
2.  **Central Banks:** Evaluates interest rate directions using `hawkish`, `rate hike`, `dovish`, and `rate cut` lexicons.
3.  **Energy Shocks:** Monitors energy disruptions using `crude price`, `supply shock`, and `output cuts` terminology.

Scores are aggregated using linguistic scaling multipliers:
*   **Geopolitical Escalation Words:** $+1.5$ safe-haven score; **De-escalation Words:** $-1.2$ score.
*   **Hawkish Monetary Words:** $+1.5$ yield score; **Dovish Monetary Words:** $-1.2$ score.
*   **Energy Shock Words:** $+1.5$ supply risk score.

### 4.2 Threat Level & Asset Bias Calibration
The aggregated scores are translated into unified threat indexes and asset-specific biases:
*   **CRITICAL Threat:** Triggered if Geopolitics $\ge 8.0$ or Energy $\ge 6.0$.
*   **HIGH Threat:** Triggered if Geopolitics $\ge 4.5$ or Energy $\ge 3.5$.
*   *Asset Biases:* Critical threat indices assign $XAUUSD+$ as `BULLISH` (Safe Haven flight) and $NAS100$ as `BEARISH` (Risk-Off capital outflow).

### 4.3 G4 Risk Gate Matrix
The risk manager ([trading_risk_manager.py](file:///c:/Users/Tenders/octo/octo/scripts/trading_risk_manager.py)) maps proposed trade directions against active TimesFM signals and macro sentiment profiles:

| Mode | Conditions | G4 Gate Action | Telegram Output |
| :--- | :--- | :--- | :--- |
| **`BLOCK`** | TimesFM conflicts with signal AND confidence $\ge 65\%$ | Trade hard blocked | `🚫 G4 TRADE BLOCKED` |
| **`SOFT`** | TimesFM conflicts with signal AND confidence $\ge 65\%$ | Lot size halved (multiplier = 0.5) | `⚠️ G4 lot halved (SOFT)` |
| **`WARN`** | TimesFM conflicts with signal AND confidence $\ge 65\%$ | Trade allowed; warning generated | `⚠️ G4 AI WARNING (WARN)` |
| **`OFF`** | G4 is disabled | Trade allowed with original lot sizing | None |

> [!NOTE]
> **Macro Gating Priority Override:**
> Regardless of the configured G4 mode (even if set to `OFF`), a **`CRITICAL` or `HIGH`** geopolitical threat overlay instantly triggers a **`MACRO_SOFT`** response. This automatically halves the position size of any trade running contrary to safe-haven flows.

---

## 5. Resilient Connection State Machine

To ensure persistent 24/7 runtime execution on remote terminals, the main bot implements an robust reconnection loop. The process intercepts all MT5 system and network connection drops cleanly to prevent crashes:

```
                  ┌──────────────────────────────┐
                  │      MT5 API Connection      │
                  └──────────────┬───────────────┘
                                 │
                         ┌───────▼───────┐
                         │   Connected   │◀─────────────────────────┐
                         └───────┬───────┘                          │
                                 │ Connection check                 │
                                 ▼ (every cycle)                    │
                     [Connection Dropped?]                          │
                         │               │                          │
                      No │           Yes │                          │
                         ▼               ▼                          │
                  ┌──────────────┐┌──────────────┐                  │
                  │   Continue   ││ Block Loop   │                  │
                  │  Execution   ││   Execution  │                  │
                  └──────────────┘└──────┬───────┘                  │
                                         │                          │
                                         ▼                          │
                                  ┌──────────────┐                  │
                                  │   Sleep 10   │                  │
                                  │   Seconds    │                  │
                                  └──────┬───────┘                  │
                                         │                          │
                                         ▼                          │
                                  ┌──────────────┐                  │
                                  │  Initialize  │                  │
                                  │  mt5.init()  │                  │
                                  └──────┬───────┘                  │
                                         │                          │
                                         ▼                          │
                                  [Re-select all]                   │
                                  [  watchlists ]                   │
                                         │                          │
                                         ▼                          │
                                  [Reconnection  ]                  │
                                  [ Successful?  ] ─────────────────┘
```

1.  **Exception Interception:** All loops, data fetching, and order execution events are enclosed in global `try-except` blocks.
2.  **Connection Monitor:** If any API call returns `None` or raises a communications exception, the loop is temporarily blocked.
3.  **Active Back-off & Re-init:** The bot sleeps for 10 seconds, then initiates `mt5.initialize()`.
4.  **Watchlist Re-Selection:** Upon successful initialization, the bot re-requests and selects all symbols from the active watchlist to rebuild cache arrays.
5.  **State Recovery:** Relies on local file tracking (`live_bot_state.json`) to recover tickets, partial take-profits, and trailing stop-losses without missing historical checkpoints.

---

## 6. Walk-Forward Parameter Self-Tuning Loop

The bot maintains high expectancy over time by executing a 24-hour self-optimizing walk-forward parameter sweep. This updates the local models dynamically as market conditions shift:

```
[24-Hour Timer Expires]
           │
           ▼
[Fetch Historical Rates] ──► Copies 5,000 candles of M5 & M1 price data
           │
           ▼
[Precalculate Breakouts] ──► Runs Pure Volume wick-absorption filters
           │
           ▼
┌────────────────────────────────────────────────────────┐
│             Walk-Forward Simulation Sweep              │
├────────────────────────────────────────────────────────┤
│ Iterates parameter grids:                              │
│ - Markov lookback windows : [10, 15, 20, 25] bars      │
│ - Markov thresholds       : [0.0005 to 0.003] points   │
│ - Markov hedge levels     : [10%, 15%, 20%]            │
└─────────────────────────┬──────────────────────────────┘
                          │ Evaluates simulations
                          ▼
┌────────────────────────────────────────────────────────┐
│               Tuning Selection Matrix                  │
├────────────────────────────────────────────────────────┤
│ Selection Priority:                                    │
│ 1. Minimum trading volume: ≥ 0.5 trades/day            │
│ 2. Primary sorting metric: Maximize Win Rate           │
│ 3. Tie-breaker metric    : Maximize Profit Factor      │
└─────────────────────────┬──────────────────────────────┘
                          │ Saves configurations
                          ▼
┌────────────────────────────────────────────────────────┐
│             Parameter Reload & Telemetry               │
├────────────────────────────────────────────────────────┤
│ - Generates config/optimal_parameters_{symbol}.json  │
│   (runtime-created by bot — does not pre-exist)      │
│ - Writes profile to MT5 Terminal Common Files          │
│ - Fires real-time parameters alert to Telegram         │
│ - Live bot hot-reloads parameters on the next cycle     │
└────────────────────────────────────────────────────────┘
```
