import pytest
from unittest.mock import MagicMock, patch
import sys
import subprocess

from channels.whatsapp_channel import WhatsAppChannel

@pytest.fixture
def mock_bus():
    return MagicMock()

@pytest.fixture
def whatsapp_channel(mock_bus):
    config = {"port": 3005, "allowed_users": "*"}
    return WhatsAppChannel(bus=mock_bus, config=config)

@patch("channels.whatsapp_channel.Path")
@patch("subprocess.run")
def test_ensure_dependencies_missing_node_modules(mock_sub_run, mock_path, whatsapp_channel):
    mock_file = MagicMock()
    mock_path.return_value = mock_file

    mock_parent1 = MagicMock()
    mock_file.parent = mock_parent1
    mock_parent2 = MagicMock()
    mock_parent1.parent = mock_parent2

    # Path(__file__).parent.parent / "scripts" / "whatsapp-bridge"
    mock_bridge_dir = MagicMock()
    mock_bridge_dir.__str__.return_value = "/fake/bridge/dir"

    # Let's override the __truediv__ to return what we want
    def side_effect_div(arg):
        if arg == "scripts":
            m = MagicMock()
            m.__truediv__.return_value = mock_bridge_dir
            return m
        return MagicMock()

    mock_parent2.__truediv__.side_effect = side_effect_div

    mock_node_modules = MagicMock()
    mock_node_modules.exists.return_value = False

    def bridge_div(arg):
        if arg == "node_modules":
            return mock_node_modules
        return MagicMock()

    mock_bridge_dir.__truediv__.side_effect = bridge_div

    whatsapp_channel._ensure_dependencies()

    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    mock_sub_run.assert_called_once_with(
        [npm_cmd, "install"],
        cwd=str(mock_bridge_dir),
        shell=False,
        check=True,
        timeout=180,
        creationflags=0x08000000 if sys.platform == "win32" else 0
    )

@patch("channels.whatsapp_channel.Path")
@patch("subprocess.Popen")
@patch("threading.Thread")
@patch.object(WhatsAppChannel, '_ensure_dependencies', return_value=True)
@pytest.mark.asyncio
async def test_start_channel(mock_ensure_deps, mock_thread, mock_sub_popen, mock_path, whatsapp_channel):
    # Setup mock paths
    mock_bridge_script = MagicMock()
    mock_bridge_script.exists.return_value = True

    mock_file_path = MagicMock()
    mock_path.return_value = mock_file_path

    # Let's not make it too complex, just let all divs return something and we patch exists
    # Path(...) / ... / "bridge.js"
    mock_path.return_value.parent.parent.__truediv__.return_value.__truediv__.return_value.__truediv__.return_value = mock_bridge_script

    whatsapp_channel._mep_mode = True
    await whatsapp_channel.start()

    mock_thread.assert_not_called()
    mock_sub_popen.assert_called_once()
    args, kwargs = mock_sub_popen.call_args
    assert kwargs.get('shell') is False

@patch("channels.whatsapp_channel.Path")
@patch("subprocess.run")
@patch.object(WhatsAppChannel, '_ensure_dependencies', return_value=True)
def test_pair_qr(mock_ensure_deps, mock_sub_run, mock_path, whatsapp_channel):
    # Setup mock paths
    mock_bridge_script = MagicMock()

    mock_file_path = MagicMock()
    mock_path.return_value = mock_file_path

    whatsapp_channel.pair_qr()

    mock_sub_run.assert_called_once()
    args, kwargs = mock_sub_run.call_args
    assert kwargs.get('shell') is False

@pytest.mark.asyncio
async def test_unconfigured_channel_does_not_start_agent_bridge(whatsapp_channel):
    whatsapp_channel._mep_mode = False
    with patch("subprocess.Popen") as spawn:
        await whatsapp_channel.start()
        spawn.assert_not_called()

@pytest.mark.asyncio
async def test_mep_collector_cannot_send_replies(whatsapp_channel):
    whatsapp_channel._mep_mode = True
    with patch("channels.whatsapp_channel.requests.post") as post:
        await whatsapp_channel.send(MagicMock())
        post.assert_not_called()
