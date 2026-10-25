import pytest
import re
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from main import _clean_transcript

def test_clean_transcript_normal_string():
    """Test that normal strings are returned unchanged (except for stripping)."""
    assert _clean_transcript("Hello world") == "Hello world"

def test_clean_transcript_strip_whitespace():
    """Test that leading and trailing whitespaces are removed."""
    assert _clean_transcript("  Hello world  ") == "Hello world"
    assert _clean_transcript("\tHello world\n") == "Hello world"

def test_clean_transcript_remove_ctrl_tags():
    """Test that <ctrlX> tags are completely removed."""
    assert _clean_transcript("Hello <ctrl123>world") == "Hello world"
    assert _clean_transcript("<ctrl1>Hello <ctrl2>world<ctrl3>") == "Hello world"

def test_clean_transcript_remove_ctrl_tags_case_insensitive():
    """Test that <ctrlX> tags are removed case-insensitively."""
    assert _clean_transcript("Hello <CTRL9>world") == "Hello world"
    assert _clean_transcript("Hello <Ctrl0>world") == "Hello world"

def test_clean_transcript_remove_ascii_control_chars():
    """Test that ASCII control characters (except newline \x0a and tab \x09) are removed."""
    # \x00 (NUL), \x07 (BEL), \x1b (ESC) should be removed
    assert _clean_transcript("Hello\x00 world\x07\x1b") == "Hello world"

def test_clean_transcript_preserve_newline_and_tab():
    """Test that newlines (\x0a) and tabs (\x09) inside the string are preserved."""
    assert _clean_transcript("Hello\nworld") == "Hello\nworld"
    assert _clean_transcript("Hello\tworld") == "Hello\tworld"
    # Carriage return (\x0d) is in \x0b-\x1f range so it is stripped.
    assert _clean_transcript("Hello\rworld") == "Helloworld"

def test_clean_transcript_empty_string():
    """Test that empty string returns empty string."""
    assert _clean_transcript("") == ""
    assert _clean_transcript("   ") == ""
    assert _clean_transcript("<ctrl1>") == ""
