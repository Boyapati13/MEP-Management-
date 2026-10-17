import pytest
import threading
from unittest.mock import MagicMock, patch
from agent.executor import AgentExecutor
from agent.error_handler import ErrorDecision

@pytest.fixture
def executor():
    return AgentExecutor()

@patch("agent.executor._call_tool")
def test_execute_single_step_success(mock_call_tool, executor):
    mock_call_tool.return_value = "Success output"
    step = {"step": "1", "tool": "test_tool", "description": "Test"}
    params = {}
    step_results = {}
    completed_steps = []

    step_ok, failed_step, failed_error, abort_msg = executor._execute_single_step(
        step, "1", "test_tool", params, None, None, step_results, completed_steps
    )

    assert step_ok is True
    assert failed_step is None
    assert failed_error == ""
    assert abort_msg is None
    assert step_results["1"] == "Success output"
    assert len(completed_steps) == 1
    mock_call_tool.assert_called_once_with("test_tool", params, None)

@patch("agent.executor._call_tool")
@patch("agent.executor.analyze_error")
def test_execute_single_step_skip(mock_analyze_error, mock_call_tool, executor):
    mock_call_tool.side_effect = Exception("Failed")
    mock_analyze_error.return_value = {
        "decision": ErrorDecision.SKIP,
        "user_message": "Skipping"
    }

    step = {"step": "1", "tool": "test_tool", "description": "Test"}
    params = {}
    step_results = {}
    completed_steps = []

    step_ok, failed_step, failed_error, abort_msg = executor._execute_single_step(
        step, "1", "test_tool", params, None, None, step_results, completed_steps
    )

    assert step_ok is True
    assert failed_step is None
    assert abort_msg is None
    assert len(completed_steps) == 1
    assert "1" not in step_results

@patch("agent.executor._call_tool")
@patch("agent.executor.analyze_error")
def test_execute_single_step_abort(mock_analyze_error, mock_call_tool, executor):
    mock_call_tool.side_effect = Exception("Failed")
    mock_analyze_error.return_value = {
        "decision": ErrorDecision.ABORT,
        "reason": "Dangerous",
        "user_message": "Aborting"
    }

    step = {"step": "1", "tool": "test_tool", "description": "Test"}
    params = {}
    step_results = {}
    completed_steps = []

    step_ok, failed_step, failed_error, abort_msg = executor._execute_single_step(
        step, "1", "test_tool", params, None, None, step_results, completed_steps
    )

    assert step_ok is False
    assert failed_step is None
    assert abort_msg == "Task aborted, sir. Dangerous"

@patch("agent.executor._call_tool")
@patch("agent.executor.analyze_error")
def test_execute_single_step_replan(mock_analyze_error, mock_call_tool, executor):
    mock_call_tool.side_effect = Exception("Failed")
    mock_analyze_error.return_value = {
        "decision": ErrorDecision.REPLAN,
        "fix_suggestion": "",
        "user_message": "Replanning"
    }

    step = {"step": "1", "tool": "test_tool", "description": "Test"}
    params = {}
    step_results = {}
    completed_steps = []

    step_ok, failed_step, failed_error, abort_msg = executor._execute_single_step(
        step, "1", "test_tool", params, None, None, step_results, completed_steps
    )

    assert step_ok is False
    assert failed_step == step
    assert failed_error == "Failed"
    assert abort_msg is None
