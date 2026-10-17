import pytest
from pathlib import Path
from actions import file_controller

def test_list_files(tmp_path):
    # Setup safe roots for testing so our tmp_path is considered safe
    file_controller._SAFE_ROOTS.append(tmp_path)
    try:
        # Test 1: missing path
        missing_path = tmp_path / "missing"
        result = file_controller.list_files(str(missing_path))
        assert "Path not found" in result

        # Test 2: not a directory
        file_path = tmp_path / "file.txt"
        file_path.write_text("hello")
        result = file_controller.list_files(str(file_path))
        assert "Not a directory" in result

        # Test 3: empty directory
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        result = file_controller.list_files(str(empty_dir))
        assert "Directory is empty" in result

        # Test 4: directory with files and hidden files
        content_dir = tmp_path / "content"
        content_dir.mkdir()
        (content_dir / "file1.txt").write_text("12345")
        (content_dir / ".hidden").write_text("hidden content")
        (content_dir / "subdir").mkdir()

        # Without show_hidden
        result = file_controller.list_files(str(content_dir), show_hidden=False)
        assert "Contents of content/" in result
        assert "file1.txt (5.0 B)" in result
        assert "subdir/" in result
        assert ".hidden" not in result

        # With show_hidden
        result = file_controller.list_files(str(content_dir), show_hidden=True)
        assert ".hidden" in result

        # Test 5: Unsafe path
        unsafe_path = Path("/etc")
        result = file_controller.list_files(str(unsafe_path))
        assert "Access denied" in result

    finally:
        file_controller._SAFE_ROOTS.remove(tmp_path)

def test_list_files_permission_error(tmp_path, monkeypatch):
    file_controller._SAFE_ROOTS.append(tmp_path)
    try:
        # Create a real directory
        perm_dir = tmp_path / "perm_dir"
        perm_dir.mkdir()

        def raise_permission_error(*args, **kwargs):
            raise PermissionError("Access Denied")

        monkeypatch.setattr(Path, "iterdir", raise_permission_error)
        result = file_controller.list_files(str(perm_dir))
        assert "Permission denied" in result
    finally:
        file_controller._SAFE_ROOTS.remove(tmp_path)

def test_list_files_generic_error(tmp_path, monkeypatch):
    file_controller._SAFE_ROOTS.append(tmp_path)
    try:
        # Create a real directory
        err_dir = tmp_path / "err_dir"
        err_dir.mkdir()

        def raise_generic_error(*args, **kwargs):
            raise RuntimeError("Something went wrong")

        monkeypatch.setattr(Path, "iterdir", raise_generic_error)
        result = file_controller.list_files(str(err_dir))
        assert "Error listing files" in result
    finally:
        file_controller._SAFE_ROOTS.remove(tmp_path)
