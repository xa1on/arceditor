# ArcEditor Developer Mode & Symbolic Link Setup Script
# Run this script as Administrator to configure your Windows environment to run this unsigned extension.

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   ARCEDITOR DEVELOPER MODE CONFIGURATOR     " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check for Admin privileges (strictly required to write to C:\Program Files)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "To install the panel globally so After Effects can detect it, this script MUST be run as Administrator."
    Write-Warning "Please close this window, right-click PowerShell, select 'Run as Administrator', and execute this script again."
    Write-Host ""
    Read-Host "Press Enter to exit..."
    Exit
}

# 2. Enable Adobe PlayerDebugMode in Windows Registry (For all CSXS versions 5 to 16)
Write-Host "[Step 1] Enabling PlayerDebugMode in Windows Registry..." -ForegroundColor Yellow

$csxsVersions = 5..16
foreach ($ver in $csxsVersions) {
    $path = "HKCU:\Software\Adobe\CSXS.$ver"
    try {
        if (-not (Test-Path $path)) {
            New-Item -Path $path -Force | Out-Null
        }
        New-ItemProperty -Path $path -Name "PlayerDebugMode" -Value "1" -PropertyType "String" -Force | Out-Null
        Write-Host "  [OK] PlayerDebugMode activated for CSXS $ver" -ForegroundColor Green
    }
    catch {
        Write-Host "  [Skip] Failed or skipped CSXS $ver" -ForegroundColor Gray
    }
}

Write-Host ""

# 3. Create a Directory Junction to Adobe's global Common Files extensions folder
Write-Host "[Step 2] Setting up Junction link in global Adobe CEP extensions folder..." -ForegroundColor Yellow

$adobeCepDir = "C:\Program Files\Common Files\Adobe\CEP\extensions"
$targetLink = [System.IO.Path]::Combine($adobeCepDir, "com.arceditor")
$workspaceDir = Get-Location

# Verify that the global folder exists
if (-not (Test-Path $adobeCepDir)) {
    # Fallback to AppData if the global Common Files folder is missing (though we verified it exists)
    $adobeCepDir = [System.IO.Path]::Combine($env:APPDATA, "Adobe", "CEP", "extensions")
    $targetLink = [System.IO.Path]::Combine($adobeCepDir, "com.arceditor")
    
    if (-not (Test-Path $adobeCepDir)) {
        New-Item -ItemType Directory -Path $adobeCepDir -Force | Out-Null
        Write-Host "  [OK] Created local Adobe CEP directory at $adobeCepDir" -ForegroundColor Green
    }
}

# Remove existing link if it exists
if (Test-Path $targetLink) {
    Write-Host "  [INFO] Found existing directory/symlink at $targetLink. Removing..." -ForegroundColor Gray
    Remove-Item -Path $targetLink -Recurse -Force | Out-Null
}

try {
    # Create Directory Junction (equivalent to mklink /j)
    New-Item -ItemType Junction -Path $targetLink -Target $workspaceDir -Force | Out-Null
    Write-Host "  [OK] Directory Junction created successfully in global folder!" -ForegroundColor Green
    Write-Host "  [OK] Link Location: $targetLink" -ForegroundColor Gray
    Write-Host "  [OK] Points to workspace: $workspaceDir" -ForegroundColor Gray
}
catch {
    Write-Error "  [ERROR] Failed to create Directory Junction: $_"
    Write-Warning "  Please manually copy this project folder into: $adobeCepDir"
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   SETUP COMPLETE! READY TO LAUNCH           " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "1. Restart After Effects completely."
Write-Host "2. Create or open any project."
Write-Host "3. Go to Window > Extensions > ArcEditor."
Write-Host ""
Read-Host "Press Enter to exit..."
