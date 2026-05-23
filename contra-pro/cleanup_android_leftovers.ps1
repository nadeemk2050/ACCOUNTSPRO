$ErrorActionPreference = "SilentlyContinue"

Write-Host "[1/8] Closing related processes..."
Get-Process | Where-Object {
    $_.ProcessName -match "studio64|studio|emulator|adb|gradle|java|kotlin"
} | Stop-Process -Force

Write-Host "[2/8] Removing Android Studio packages (if installed)..."
winget uninstall --id Google.AndroidStudio --silent --accept-source-agreements --disable-interactivity
winget uninstall --name "Android Studio" --silent --accept-source-agreements --disable-interactivity

Write-Host "[3/8] Removing Android/Gradle folders..."
$pathsToRemove = @(
    "$env:LOCALAPPDATA\Android",
    "$env:PROGRAMDATA\Microsoft\Windows\Start Menu\Programs\Android Studio",
    "$env:APPDATA\Google\AndroidStudio*",
    "$env:LOCALAPPDATA\Google\AndroidStudio*",
    "$env:USERPROFILE\.android",
    "$env:USERPROFILE\.gradle\caches",
    "$env:USERPROFILE\.gradle\daemon",
    "$env:USERPROFILE\.gradle\wrapper",
    "$env:USERPROFILE\.gradle\native",
    "$env:USERPROFILE\.gradle\notifications",
    "$env:USERPROFILE\.gradle\kotlin-profile"
)

foreach ($pattern in $pathsToRemove) {
    Get-Item -Path $pattern -Force | ForEach-Object {
        if ($_.FullName -notmatch "accountspro|antigravity") {
            Remove-Item -LiteralPath $_.FullName -Recurse -Force
            Write-Host "Removed: $($_.FullName)"
        }
    }
}

Write-Host "[4/8] Cleaning Temp files (preserving accountspro and antigravity)..."
$tempPath = "$env:LOCALAPPDATA\Temp"
Get-ChildItem -LiteralPath $tempPath -Force | Where-Object {
    $_.Name -notmatch "accountspro|antigravity"
} | ForEach-Object {
    try {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
    } catch {}
}

Write-Host "[5/8] Removing Android environment variables..."
$envNames = @("ANDROID_HOME", "ANDROID_SDK_ROOT", "ANDROID_NDK_HOME", "JAVA_HOME")
foreach ($name in $envNames) {
    [Environment]::SetEnvironmentVariable($name, $null, "User")
}

Write-Host "[6/8] Cleaning User PATH entries for Android and Gradle..."
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath) {
    $parts = $userPath -split ";" | Where-Object {
        $_ -and ($_ -notmatch "Android|platform-tools|emulator|gradle")
    }
    $newUserPath = ($parts -join ";")
    [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
}

Write-Host "[7/8] Removing common Android Studio registry leftovers..."
$regPaths = @(
    "HKCU:\Software\Google\AndroidStudio",
    "HKCU:\Software\AndroidStudio",
    "HKCU:\Software\JetBrains\AndroidStudio",
    "HKCU:\Software\Classes\AndroidStudio",
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Android Studio"
)
foreach ($reg in $regPaths) {
    if (Test-Path $reg) {
        Remove-Item -Path $reg -Recurse -Force
        Write-Host "Removed registry: $reg"
    }
}

Write-Host "[8/8] Final note"
Write-Host "Cleanup complete. Restart Windows now to fully apply PATH/env changes."
