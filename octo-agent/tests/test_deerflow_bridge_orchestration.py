import pytest
from unittest.mock import MagicMock
import deerflow_bridge

def test_deerflow_client_generation_orchestration(mocker):
    """
    Test that the DeerFlow bridge correctly passes the `subagents=True` flag
    down to the embedded DeerFlowClient, which enables progressive skill loading
    and sub-agent file offloading for complex document generation.
    """
    mock_client_instance = MagicMock()
    mock_client_instance.chat.return_value = "Generated a slide deck: /sandbox/out/slides.pptx"

    mocker.patch('deerflow_bridge._get_embedded_client', return_value=mock_client_instance)

    result = deerflow_bridge.chat("Create a slide deck about AI", subagents=True)

    # Validate the embedded client was correctly instructed to use subagents
    mock_client_instance.chat.assert_called_once_with(
        "Create a slide deck about AI", model=None, thinking=False, subagents=True
    )
    assert "slides.pptx" in result

def test_deep_research_subagent_enabled(mocker):
    """
    Test that deep_research natively invokes subagent_enabled=True on the
    underlying stream, proving it orchestrates built-in skills to generate files.
    """
    mock_client_instance = MagicMock()

    class MockEvent:
        def __init__(self, event_type, data):
            self.type = event_type
            self.data = data

    mock_client_instance.stream.return_value = [
        MockEvent("messages-tuple", {"type": "ai", "id": "msg1", "content": "Progressively loading report skill... "}),
        MockEvent("messages-tuple", {"type": "ai", "id": "msg1", "content": "Generating report.pdf in sandbox..."})
    ]

    mocker.patch('deerflow_bridge._get_embedded_client', return_value=mock_client_instance)
    mocker.patch('deerflow_bridge.get_or_create_thread', return_value="thread_id_123")

    result = deerflow_bridge.deep_research("Generate a PDF report about quantum computing")

    # Assert stream is called with subagent_enabled=True allowing it to
    # spawn sub-agents to handle the file offloading work
    mock_client_instance.stream.assert_called_once_with(
        "Generate a PDF report about quantum computing",
        thread_id="thread_id_123",
        subagent_enabled=True
    )

    assert result == "Progressively loading report skill... Generating report.pdf in sandbox..."
