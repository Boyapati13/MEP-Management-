$ErrorActionPreference = "Stop"

Write-Host "=========================================="
Write-Host "  OCTO-Pro Auto-Installer & Launcher"
Write-Host "=========================================="
Write-Host ""

Write-Host "[1/3] Running setup.py..."
python setup.py

Write-Host "[2/3] Setting up DeerFlow (auto-confirm)..."
Write-Output "y`nn" | python setup_deerflow.py

Write-Host "[3/3] Starting OCTO-Pro environment..."
cmd.exe /c "start_octo_pro.bat"
