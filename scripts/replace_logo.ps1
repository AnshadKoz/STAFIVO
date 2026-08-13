param(
    [Parameter(Mandatory=$true)]
    [string]$SourcePath
)

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$webDest = Join-Path $workspace "stafivo_web\public\brand\stafivo-logo.png"
$mobileDest = Join-Path $workspace "stafivo_mobile\assets\stafivo_logo.png"

if (-not (Test-Path $SourcePath)) {
    Write-Error "Source file not found: $SourcePath"
    exit 1
}

# Backup existing files
foreach ($dest in @($webDest, $mobileDest)) {
    if (Test-Path $dest) {
        Copy-Item $dest ($dest + ".bak") -Force
        Write-Host "Backed up $dest -> $($dest + '.bak')"
    }
}

# Copy source to destinations
Copy-Item $SourcePath $webDest -Force
Write-Host "Copied to web: $webDest"

Copy-Item $SourcePath $mobileDest -Force
Write-Host "Copied to mobile: $mobileDest"

Write-Host "Done. You can now run the dev servers to verify the new logo."