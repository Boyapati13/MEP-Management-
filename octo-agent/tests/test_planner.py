import json
import pytest
from unittest.mock import patch
from agent import planner

def test_create_plan_invalid_structure_no_steps():
    """Test that a plan missing the 'steps' key falls back correctly."""
    invalid_plan_json = json.dumps({"goal": "Test goal"})

    with patch('core.text_llm.ask', return_value=invalid_plan_json):
        result = planner.create_plan("Test goal")

        # It should fall back to the fallback plan
        assert result["goal"] == "Test goal"
        assert len(result["steps"]) == 1
        assert result["steps"][0]["tool"] == "web_search"
        assert result["steps"][0]["description"] == "Search for: Test goal"
        assert result["steps"][0]["parameters"]["query"] == "Test goal"

def test_create_plan_invalid_structure_steps_not_list():
    """Test that a plan where 'steps' is not a list falls back correctly."""
    invalid_plan_json = json.dumps({"goal": "Test goal", "steps": "Not a list"})

    with patch('core.text_llm.ask', return_value=invalid_plan_json):
        result = planner.create_plan("Test goal")

        # It should fall back to the fallback plan
        assert result["goal"] == "Test goal"
        assert len(result["steps"]) == 1
        assert result["steps"][0]["tool"] == "web_search"
        assert result["steps"][0]["description"] == "Search for: Test goal"
        assert result["steps"][0]["parameters"]["query"] == "Test goal"

def test_create_plan_json_decode_error():
    """Test that invalid JSON falls back correctly."""
    invalid_plan_json = "This is not valid JSON"

    with patch('core.text_llm.ask', return_value=invalid_plan_json):
        result = planner.create_plan("Test goal")

        # It should fall back to the fallback plan
        assert result["goal"] == "Test goal"
        assert len(result["steps"]) == 1
        assert result["steps"][0]["tool"] == "web_search"
        assert result["steps"][0]["description"] == "Search for: Test goal"
        assert result["steps"][0]["parameters"]["query"] == "Test goal"
