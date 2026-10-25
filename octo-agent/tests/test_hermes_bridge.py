import pytest
from pathlib import Path
from unittest.mock import MagicMock

from agent.hermes_bridge import (
    create_scheduled,
    list_scheduled,
    delete_scheduled,
    write_gateway_config,
)
import datetime as _dt








def test_create_scheduled(mocker):
    result = create_scheduled("test prompt", "0 12 * * *", "test label")
    assert result is not None
    assert result["prompt"] == "test prompt"
    assert result["schedule"] == "0 12 * * *"
    assert result["label"] == "test label"
    assert result["enabled"] is True
    assert "id" in result


def test_create_scheduled_invalid_cron():
    result = create_scheduled("test prompt", "invalid cron")
    assert result is None


def test_list_scheduled(mocker):
    from agent.hermes_bridge import create_scheduled
    if hasattr(create_scheduled, "_jobs"):
        create_scheduled._jobs = []

    create_scheduled("test prompt", "0 12 * * *", "test label")
    results = list_scheduled()
    assert hasattr(create_scheduled, "_jobs")
    assert len(create_scheduled._jobs) >= 1

    found = False
    for r in create_scheduled._jobs:
        if r.get("prompt") == "test prompt":
            found = True
            break
    assert found


def test_delete_scheduled(mocker):
    result = create_scheduled("test prompt to delete", "0 12 * * *", "test label")
    job_id = result["id"]
    assert delete_scheduled(job_id) is True
    results = list_scheduled()
    for r in results:
        assert r.get("prompt") != "test prompt to delete"


def test_write_gateway_config(mocker):
    import os
    test_data = {"telegram": {"bot_token": "test_value"}}
    write_gateway_config(test_data)
    assert os.environ.get("TELEGRAM_BOT_TOKEN") == "test_value"



