import pytest
from actions.timesfm_forecaster import timesfm_action

def test_timesfm_action_missing_symbol():
    result = timesfm_action({"horizon": 10})
    assert "portfolio ai forecast" in result.lower()

def test_timesfm_action_valid_symbol():
    result = timesfm_action({"symbol": "XAUUSD", "horizon": 20})
    assert "timesfm forecast for xauusd+" in result.lower()
    assert "the model is" in result.lower()
