@echo off
setlocal

cd /d "%~dp0"

set /p BATCH_SIZE=Batch size (default 10): 
if "%BATCH_SIZE%"=="" set BATCH_SIZE=10

set /a START=0

:loop
echo.
echo Opening ability pages %START% to %START%+%BATCH_SIZE%-1 ...
call npm run open:abilities -- --batch %BATCH_SIZE% --start %START%
if errorlevel 1 goto done

echo.
set /p NEXT=Save those pages, then press Enter for the next batch or type Q to quit: 
if /I "%NEXT%"=="Q" goto done

set /a START=%START%+%BATCH_SIZE%
goto loop

:done
echo.
echo Finished.
endlocal
