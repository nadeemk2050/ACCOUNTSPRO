@echo off
echo ========================================
echo   ACCPRO LIGHTWEIGHT UPDATE CREATOR
echo ========================================
echo.

set SOURCE_DIR=dist
set UPDATE_DIR=nadtally_update
set UPDATE_DIR2=accpro_update

if not exist %SOURCE_DIR% (
    echo ERROR: dist folder not found! Please run 'npm run build' first.
    pause
    exit /b
)

echo Creating nadtally_update package...
if exist %UPDATE_DIR% rd /s /q %UPDATE_DIR%
xcopy /s /e /i %SOURCE_DIR% %UPDATE_DIR%

echo Creating accpro_update package...
if exist %UPDATE_DIR2% rd /s /q %UPDATE_DIR2%
xcopy /s /e /i %SOURCE_DIR% %UPDATE_DIR2%

echo.
echo ========================================
echo SUCCESS!
echo.
echo TO UPDATE OTHER COMPUTERS:
echo 1. Copy the folder '%UPDATE_DIR%' or '%UPDATE_DIR2%' to your USB.
echo 2. On the other computer, paste this folder next to the executable.
echo 3. Restart the app. It will load the update automatically!
echo ========================================
echo.
pause

