import sys
import pytest
from unittest.mock import patch, MagicMock

from actions.web_search import _ddg_search

def test_ddg_search_success():
    """Test successful search with results."""
    mock_ddg = MagicMock()
    mock_instance = MagicMock()
    mock_ddg.DDGS.return_value.__enter__.return_value = mock_instance
    mock_instance.text.return_value = [
        {"title": "Test 1", "body": "Snippet 1", "href": "http://test1.com"},
        {"title": "Test 2", "body": "Snippet 2", "href": "http://test2.com"}
    ]

    with patch.dict('sys.modules', {'ddgs': mock_ddg, 'duckduckgo_search': None}):
        results = _ddg_search("test query", max_results=2)

    assert len(results) == 2
    assert results[0] == {"title": "Test 1", "snippet": "Snippet 1", "url": "http://test1.com"}
    assert results[1] == {"title": "Test 2", "snippet": "Snippet 2", "url": "http://test2.com"}
    mock_instance.text.assert_called_once_with("test query", max_results=2)

def test_ddg_search_fallback_import():
    """Test fallback from 'ddgs' to 'duckduckgo_search' on ImportError."""
    mock_ddg = MagicMock()
    mock_instance = MagicMock()
    mock_ddg.DDGS.return_value.__enter__.return_value = mock_instance
    mock_instance.text.return_value = []

    # 'ddgs' is not found, so it falls back to 'duckduckgo_search'
    with patch.dict('sys.modules', {'ddgs': None, 'duckduckgo_search': mock_ddg}):
        results = _ddg_search("test query")

    assert results == []
    mock_ddg.DDGS.assert_called_once()
    mock_instance.text.assert_called_once_with("test query", max_results=6)

def test_ddg_search_import_error():
    """Test when both 'ddgs' and 'duckduckgo_search' fail to import."""
    with patch.dict('sys.modules', {'ddgs': None, 'duckduckgo_search': None}):
        with pytest.raises(ImportError):
            _ddg_search("test query")

def test_ddg_search_network_error():
    """Test when DDGS text method raises an exception (e.g., timeout)."""
    mock_ddg = MagicMock()
    mock_instance = MagicMock()
    mock_ddg.DDGS.return_value.__enter__.return_value = mock_instance
    mock_instance.text.side_effect = Exception("Network Error")

    with patch.dict('sys.modules', {'ddgs': mock_ddg, 'duckduckgo_search': None}):
        with pytest.raises(Exception, match="Network Error"):
            _ddg_search("test query")

def test_ddg_search_empty_results():
    """Test with empty search results."""
    mock_ddg = MagicMock()
    mock_instance = MagicMock()
    mock_ddg.DDGS.return_value.__enter__.return_value = mock_instance
    mock_instance.text.return_value = []

    with patch.dict('sys.modules', {'ddgs': mock_ddg, 'duckduckgo_search': None}):
        results = _ddg_search("test query")

    assert results == []

def test_ddg_search_partial_fields():
    """Test when results are missing some fields."""
    mock_ddg = MagicMock()
    mock_instance = MagicMock()
    mock_ddg.DDGS.return_value.__enter__.return_value = mock_instance
    mock_instance.text.return_value = [
        {"title": "Test 1", "body": "Snippet 1"}, # Missing href
        {"href": "http://test2.com"} # Missing title and body
    ]

    with patch.dict('sys.modules', {'ddgs': mock_ddg, 'duckduckgo_search': None}):
        results = _ddg_search("test query")

    assert len(results) == 2
    assert results[0] == {"title": "Test 1", "snippet": "Snippet 1", "url": ""}
    assert results[1] == {"title": "", "snippet": "", "url": "http://test2.com"}
