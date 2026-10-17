---
name: TimesFM Forecasting
description: Performs 200M parameter zero-shot time series forecasting up to 1000 steps using Google's TimesFM 2.5 foundation model for algorithmic trading.
---

# TimesFM Forecasting Skill

This skill allows the agent to utilize Google's TimesFM 2.5 model via the `timesfm_forecaster.py` action.

## Instructions
1. Call the `timesfm_action` with a target trading symbol (e.g., `XAUUSD` or `BTCUSD`).
2. Optional: provide a `horizon` step count for how far ahead to forecast.
3. The action returns the latest probabilistic quantile forecast to aid in algorithmic trading decisions based on the new MadEvolve evolutionary framework.
