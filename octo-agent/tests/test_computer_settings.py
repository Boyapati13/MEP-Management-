import pytest
from unittest.mock import patch, MagicMock
import subprocess

import actions.computer_settings as cs

@patch('actions.computer_settings.subprocess.run')
@patch('actions.computer_settings.subprocess.check_output')
def test_change_linux_brightness_xrandr(mock_check_output, mock_run):
    # Mock output of "xrandr"
    mock_check_output.side_effect = [
        b"Screen 0: minimum 8 x 8, current 1920 x 1080, maximum 32767 x 32767\n"
        b"eDP-1 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 344mm x 193mm\n"
        b"DP-1 disconnected (normal left inverted right x axis y axis)\n",

        b"Screen 0: minimum 8 x 8, current 1920 x 1080, maximum 32767 x 32767\n"
        b"eDP-1 connected primary 1920x1080+0+0\n"
        b"\tBrightness: 0.5\n"
    ]

    cs._adjust_linux_brightness_xrandr(0.1)

    # Assert check_output was called twice correctly
    assert mock_check_output.call_count == 2
    mock_check_output.assert_any_call(["xrandr"])
    mock_check_output.assert_any_call(["xrandr", "--verbose"])

    # Assert subprocess.run was called to set new brightness
    # Expected: 0.5 + 0.1 = 0.6 -> Note floating point arithmetic might be 0.6000000000000001, so we just check display and string casting
    mock_run.assert_called_once()
    args, kwargs = mock_run.call_args
    assert args[0][0] == "xrandr"
    assert args[0][1] == "--output"
    assert args[0][2] == "eDP-1"
    assert args[0][3] == "--brightness"
    assert float(args[0][4]) == pytest.approx(0.6)
    assert kwargs.get("capture_output") is True

@patch('actions.computer_settings.subprocess.run')
@patch('actions.computer_settings.subprocess.check_output')
def test_change_linux_brightness_xrandr_bounds(mock_check_output, mock_run):
    # Test setting brightness below 0.1 bounds it to 0.1
    mock_check_output.side_effect = [
        b"eDP-1 connected\n",
        b"Brightness: 0.1\n"
    ]
    cs._adjust_linux_brightness_xrandr(-0.2)
    mock_run.assert_called_once()
    assert mock_run.call_args[0][0] == ["xrandr", "--output", "eDP-1", "--brightness", "0.1"]

@patch('actions.computer_settings.subprocess.run')
@patch('actions.computer_settings.subprocess.check_output')
def test_change_linux_brightness_xrandr_upper_bound(mock_check_output, mock_run):
    # Test setting brightness above 1.0 bounds it to 1.0
    mock_check_output.side_effect = [
        b"eDP-1 connected\n",
        b"Brightness: 0.95\n"
    ]
    cs._adjust_linux_brightness_xrandr(0.2)
    mock_run.assert_called_once()
    assert mock_run.call_args[0][0] == ["xrandr", "--output", "eDP-1", "--brightness", "1.0"]

@patch('actions.computer_settings._OS', 'Linux')
@patch('actions.computer_settings.subprocess.run')
@patch('actions.computer_settings._adjust_linux_brightness_xrandr')
def test_brightness_up_linux_fallback(mock_helper, mock_run):
    # Mock `which brightnessctl` returning failure
    mock_run.return_value.returncode = 1

    cs.brightness_up()

    mock_run.assert_called_once_with(["which", "brightnessctl"], capture_output=True)
    mock_helper.assert_called_once_with(0.1)

@patch('actions.computer_settings._OS', 'Linux')
@patch('actions.computer_settings.subprocess.run')
@patch('actions.computer_settings._adjust_linux_brightness_xrandr')
def test_brightness_down_linux_fallback(mock_helper, mock_run):
    # Mock `which brightnessctl` returning failure
    mock_run.return_value.returncode = 1

    cs.brightness_down()

    mock_run.assert_called_once_with(["which", "brightnessctl"], capture_output=True)
    mock_helper.assert_called_once_with(-0.1)

