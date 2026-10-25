import pytest
from agent.error_handler import analyze_error, ErrorDecision

def test_analyze_error_max_attempts_reached():
    step = {"step": "test_step"}
    error = "test error"
    attempt = 2
    max_attempts = 2

    result = analyze_error(step, error, attempt, max_attempts)

    assert result["decision"] == ErrorDecision.REPLAN
    assert result["reason"] == "Failed 2 times: test error"
    assert result["fix_suggestion"] == "Try a completely different approach or tool"
    assert result["max_retries"] == 0
    assert result["user_message"] == "Trying a different approach, sir."

def test_analyze_error_max_attempts_exceeded():
    step = {"step": "test_step"}
    error = "test error"
    attempt = 3
    max_attempts = 2

    result = analyze_error(step, error, attempt, max_attempts)

    assert result["decision"] == ErrorDecision.REPLAN
    assert result["reason"] == "Failed 3 times: test error"
    assert result["fix_suggestion"] == "Try a completely different approach or tool"
    assert result["max_retries"] == 0
    assert result["user_message"] == "Trying a different approach, sir."
