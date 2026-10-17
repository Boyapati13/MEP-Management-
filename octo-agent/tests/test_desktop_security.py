import pytest
from actions.desktop import _execute_generated_code

def test_safe_code_execution():
    code = "print('Hello, secure world!')"
    result = _execute_generated_code(code)
    assert result == "Hello, secure world!"

def test_prevent_imports():
    code = "import os\nos.system('echo exploited')"
    result = _execute_generated_code(code)
    assert "Security error" in result
    assert "Import statements are not allowed" in result

def test_prevent_from_imports():
    code = "from subprocess import run\nrun(['echo', 'exploited'])"
    result = _execute_generated_code(code)
    assert "Security error" in result
    assert "Import statements are not allowed" in result

def test_prevent_dunder_attributes():
    code = "().__class__.__bases__[0].__subclasses__()"
    result = _execute_generated_code(code)
    assert "Security error" in result
    assert "restricted" in result

def test_prevent_dunder_names():
    code = "print(__file__)"
    result = _execute_generated_code(code)
    assert "Security error" in result
    assert "restricted" in result

def test_prevent_restricted_functions():
    code = "getattr(os, 'system')"
    result = _execute_generated_code(code)
    assert "Security error" in result
    assert "restricted function" in result

def test_allow_safe_constructs():
    code = """
x = 10
y = 20
if x < y:
    for i in range(2):
        print(x + i)
"""
    result = _execute_generated_code(code)
    assert result == "10\n11"

def test_syntax_error():
    code = "print('hello"
    result = _execute_generated_code(code)
    assert "Security error: Code execution blocked. Reason: Syntax error" in result
