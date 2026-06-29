@echo off
REM Momentum demo launcher (Option B): opens the app in Chrome or Edge with
REM autoplay-with-sound allowed, so the background music starts on open with no click.
REM Make sure the app is running first:  npm run dev   (http://localhost:3000)

set "URL=http://localhost:3000"
set "FLAGS=--autoplay-policy=no-user-gesture-required --user-data-dir=%TEMP%\momentum-demo-profile --new-window"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROMEX86=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE64=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "%CHROME%" (
  start "" "%CHROME%" %FLAGS% "%URL%"
) else if exist "%CHROMEX86%" (
  start "" "%CHROMEX86%" %FLAGS% "%URL%"
) else if exist "%EDGE64%" (
  start "" "%EDGE64%" %FLAGS% "%URL%"
) else if exist "%EDGE%" (
  start "" "%EDGE%" %FLAGS% "%URL%"
) else (
  echo Could not find Chrome or Edge. Set the autoplay flag manually via chrome://flags/#autoplay-policy
)
