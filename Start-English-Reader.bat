@echo off
rem English Reader launcher - starts the local server and opens the browser.
rem Works from any folder: %~dp0 is this script's directory.
cd /d "%~dp0"
start "English Reader" cmd /k python server.py
