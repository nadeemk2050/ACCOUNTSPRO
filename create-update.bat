@echo off
echo ========================================
echo   NADTALLY LIGHTWEIGHT UPDATE CREATOR
echo ========================================
echo.

set SOURCE_DIR=dist
set UPDATE_DIR=nadtally_update

if not exist %SOURCE_DIR% (
    echo ERROR: dist folder not found! Please run 'npm run build' first.
    pause
    exit /b
)

echo Creating update package...
if exist %UPDATE_DIR% rd /s /q %UPDATE_DIR%
xcopy /s /e /i %SOURCE_DIR% %UPDATE_DIR%

echo.
echo ========================================
echo SUCCESS!
echo.
echo TO UPDATE OTHER COMPUTERS:
echo 1. Copy the folder '%UPDATE_DIR%' to your USB.
echo 2. On the other computer, paste this folder next to 'NADTALLY Offline.exe'.
echo 3. Restart the app. It will load the update automatically!
echo ========================================
echo.
pause
