# launch_tradingview.ps1
# Kills existing TradingView processes and relaunches with CDP port 9222
# Handles Windows Store (MSIX) installation

param(
    [int]$Port = 9222
)

Write-Host "Killing existing TradingView processes..."
Get-Process -Name "TradingView" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 1500

# Try to find the exe directly (MSIX path)
$MsixBase = "C:\Program Files\WindowsApps"
$tvExe = $null

# 1. Known exact path from AppxPackage scan
$knownPath = "C:\Program Files\WindowsApps\TradingView.Desktop_3.1.0.7818_x64__n534cwy3pjxzj\TradingView.exe"
if (Test-Path $knownPath) {
    $tvExe = $knownPath
}

# 2. Scan WindowsApps for any TradingView version (needs admin or special access)
if (-not $tvExe) {
    try {
        $dirs = Get-ChildItem $MsixBase -Filter "TradingView.Desktop_*" -Directory -ErrorAction Stop
        foreach ($d in $dirs) {
            $candidate = Join-Path $d.FullName "TradingView.exe"
            if (Test-Path $candidate) { $tvExe = $candidate; break }
        }
    } catch { }
}

# 3. Standard install paths
if (-not $tvExe) {
    $standardPaths = @(
        "$env:LOCALAPPDATA\TradingView\TradingView.exe",
        "$env:PROGRAMFILES\TradingView\TradingView.exe",
        "${env:ProgramFiles(x86)}\TradingView\TradingView.exe"
    )
    foreach ($p in $standardPaths) {
        if (Test-Path $p) { $tvExe = $p; break }
    }
}

if ($tvExe) {
    Write-Host "Found TradingView at: $tvExe"
    Write-Host "Launching with --remote-debugging-port=$Port ..."
    Start-Process -FilePath $tvExe -ArgumentList "--remote-debugging-port=$Port" -WindowStyle Normal
    
    # Wait up to 15s for CDP to come online
    $ready = $false
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep 1
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:$Port/json/version" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($resp.StatusCode -eq 200) {
                Write-Host "CDP READY on port $Port"
                $ready = $true
                break
            }
        } catch { }
        Write-Host "Waiting... ($($i+1)s)"
    }
    
    if ($ready) {
        Write-Output "SUCCESS:$tvExe"
    } else {
        Write-Output "LAUNCHED_NO_CDP:$tvExe"
    }
} else {
    # Fallback: use Windows Store AppID protocol launch
    Write-Host "Direct path not accessible, trying AppX protocol launch..."
    try {
        $AppID = "TradingView.Desktop_n534cwy3pjxzj!TradingView.Desktop"
        # MSIX apps don't support --remote-debugging-port via shell launch
        # Instead we write a registry key for Electron to pick up
        $regPath = "HKCU:\Software\Policies\Google\Chrome"
        # Use explorer.exe shell:AppsFolder launch as last resort
        Start-Process "explorer.exe" "shell:AppsFolder\$AppID"
        Write-Output "APPX_LAUNCHED_NO_CDP:CDP not available for MSIX builds without registry workaround"
    } catch {
        Write-Output "ERROR:$_"
    }
}
