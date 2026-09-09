@echo off
rem munni local helper, started at logon by the wizard's "Run the helper at
rem logon" task: no browser tab, minimized window. With automatic updates on
rem it keeps the local family current by itself (the PC's counterpart of
rem the NAS deploy poller).
cd /d "%~dp0"
set SETUP_NO_OPEN=1
node serve.mjs
