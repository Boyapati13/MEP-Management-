import pytest
import subprocess
from pathlib import Path
from unittest.mock import patch
from actions.dev_agent import _open_vscode

def test_open_vscode_shell_is_false():
    project_dir = Path("/mock/project")

    with patch("subprocess.Popen") as mock_popen, \
         patch("time.sleep"):
        _open_vscode(project_dir)

        # Verify that Popen was called at least once
        mock_popen.assert_called()

        # Verify that for every call, shell=False was used
        for call_args in mock_popen.call_args_list:
            args, kwargs = call_args
            assert kwargs.get("shell") is False, "shell should be False to prevent command injection"
