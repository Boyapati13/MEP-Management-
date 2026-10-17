import pytest
from datetime import datetime, timedelta
from actions.flight_finder import _parse_exact_date, _parse_relative_date, _parse_month_date, _extract_and_validate_params

def test_parse_exact_date():
    assert _parse_exact_date("2024-12-25") == "2024-12-25"
    assert _parse_exact_date("25/12/2024") == "2024-12-25"
    assert _parse_exact_date("12/25/2024") == "2024-12-25"
    assert _parse_exact_date("25.12.2024") == "2024-12-25"
    assert _parse_exact_date("25-12-2024") == "2024-12-25"
    assert _parse_exact_date("invalid date") is None

def test_parse_relative_date():
    today = datetime(2024, 1, 1)
    tomorrow = today + timedelta(days=1)

    assert _parse_relative_date("today", today) == "2024-01-01"
    assert _parse_relative_date("bugün", today) == "2024-01-01"
    assert _parse_relative_date("tomorrow", today) == "2024-01-02"
    assert _parse_relative_date("yarın", today) == "2024-01-02"
    assert _parse_relative_date("next week", today) is None

def test_parse_month_date():
    today = datetime(2024, 5, 1) # May 1st, 2024

    # Same year
    assert _parse_month_date("june 15", "june 15", today) == "2024-06-15"

    # Next year
    assert _parse_month_date("march 10", "march 10", today) == "2025-03-10"

    # Invalid
    assert _parse_month_date("invalid 10", "invalid 10", today) is None

def test_extract_and_validate_params():
    # Valid params
    valid_params = {
        "origin": "NYC",
        "destination": "LHR",
        "date": "2024-12-25",
        "passengers": "2",
        "cabin": "business"
    }
    parsed, is_valid = _extract_and_validate_params(valid_params)
    assert is_valid is True
    assert parsed["origin"] == "NYC"
    assert parsed["destination"] == "LHR"
    assert parsed["date"] == "2024-12-25"
    assert parsed["passengers"] == 2
    assert parsed["cabin"] == "business"

    # Invalid params (missing origin)
    invalid_params = {
        "destination": "LHR",
        "date": "2024-12-25"
    }
    parsed, is_valid = _extract_and_validate_params(invalid_params)
    assert is_valid is False
    assert parsed == "Please provide both origin and destination, sir."

    # Invalid params (missing date)
    invalid_params_date = {
        "origin": "NYC",
        "destination": "LHR"
    }
    parsed, is_valid = _extract_and_validate_params(invalid_params_date)
    assert is_valid is False
    assert parsed == "Please provide a departure date, sir."
