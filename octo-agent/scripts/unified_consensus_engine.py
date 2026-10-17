import math

class UnifiedConsensusEngine:
    """
    A quantitative consensus engine that fuses multi-model macro and micro price predictions
    with auction microstructure volume profile parameters.
    """
    def __init__(self, tf_weight=0.4, kr_weight=0.4, vol_weight=0.2):
        self.tf_weight = tf_weight
        self.kr_weight = kr_weight
        self.vol_weight = vol_weight

    def calculate_consensus(
        self,
        symbol: str,
        timesfm_bias: str,
        timesfm_conf: float,
        kronos_direction: str,
        kronos_pct_change: float,
        buy_pressure: float,
        sell_pressure: float,
        current_price: float,
        vah: float,
        val: float,
        poc: float
    ) -> dict:
        # 1. TimesFM Component (-1.0 to 1.0)
        tf_bias_val = 0.0
        if timesfm_bias.upper() in ["BULL", "BULLISH"]:
            tf_bias_val = 1.0
        elif timesfm_bias.upper() in ["BEAR", "BEARISH"]:
            tf_bias_val = -1.0
            
        timesfm_component = tf_bias_val * min(1.0, max(0.0, timesfm_conf))

        # 2. Kronos Component (-1.0 to 1.0)
        kr_dir_val = 0.0
        if kronos_direction.upper() in ["BULL", "BULLISH"]:
            kr_dir_val = 1.0
        elif kronos_direction.upper() in ["BEAR", "BEARISH"]:
            kr_dir_val = -1.0
            
        # Normalize Kronos percentage change (e.g. 0.15% change is considered full 1.0 weight)
        kr_scale = abs(kronos_pct_change) / 0.15
        kronos_component = kr_dir_val * min(1.0, kr_scale)

        # 3. Volume Component (-1.0 to 1.0)
        # Bounded volume pressure delta centered at 50%
        volume_component = (buy_pressure - 50.0) / 50.0
        volume_component = min(1.0, max(-1.0, volume_component))

        # 4. Compute Weighted Score (-1.0 to 1.0)
        consensus_score = (
            timesfm_component * self.tf_weight +
            kronos_component * self.kr_weight +
            volume_component * self.vol_weight
        )

        # Determine precision digits based on symbol
        sym = symbol.upper()
        digits = 5
        if "JPY" in sym or "GOLD" in sym or "XAU" in sym or "OIL" in sym or "CL" in sym:
            digits = 3
        elif "BTC" in sym or "NAS" in sym or "US30" in sym or "AAPL" in sym:
            digits = 2

        # 5. Suggested Action & Levels
        # Action trigger threshold: 0.15 for BULL / -0.15 for BEAR
        suggested_action = "WAIT"
        suggested_sl = "--"
        suggested_tp = "--"
        suggested_rr = "--"
        
        # Grid range for dynamic stop-loss calibration
        grid_range = abs(vah - val)
        if grid_range <= 0.0:
            grid_range = current_price * 0.01  # Fallback 1% grid

        if consensus_score > 0.15:
            # Shield guardrail: Do not buy if current price is already above VAH
            if current_price < vah:
                suggested_action = "BUY"
                # Stop loss placed safely below Value Area Low
                sl_val = val - (grid_range * 0.15)
                # Take profit targeted past Value Area High
                tp_val = vah + (grid_range * 0.20)
                
                suggested_sl = round(sl_val, digits)
                suggested_tp = round(tp_val, digits)
        elif consensus_score < -0.15:
            # Shield guardrail: Do not sell if current price is already below VAL
            if current_price > val:
                suggested_action = "SELL"
                # Stop loss placed safely above Value Area High
                sl_val = vah + (grid_range * 0.15)
                # Take profit targeted past Value Area Low
                tp_val = val - (grid_range * 0.20)
                
                suggested_sl = round(sl_val, digits)
                suggested_tp = round(tp_val, digits)

        # Risk/Reward Formulation
        if suggested_action != "WAIT" and isinstance(suggested_sl, (int, float)) and isinstance(suggested_tp, (int, float)):
            try:
                risk = abs(current_price - suggested_sl)
                reward = abs(suggested_tp - current_price)
                if risk > 0:
                    suggested_rr = f"{reward/risk:.1f}:1"
                else:
                    suggested_rr = "2.0:1"
            except Exception:
                suggested_rr = "2.0:1"

        return {
            "suggested_action": suggested_action,
            "entry": round(current_price, digits),
            "sl": suggested_sl,
            "tp": suggested_tp,
            "rr": suggested_rr,
            "consensus_score": float(consensus_score),
            "metrics": {
                "timesfm_component": float(timesfm_component),
                "kronos_component": float(kronos_component),
                "volume_component": float(volume_component)
            }
        }
