@echo off
REM ============================================================================
REM  Estudiantes HUB - Publicar version nueva (un clic)
REM  Sube automaticamente el numero de version del Service Worker y despliega
REM  a Firebase Hosting. Tambien sube los cambios a GitHub.
REM ============================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo === Estudiantes HUB · Publicar version nueva ===
echo.

REM --- 1) Subir automaticamente CACHE_VERSION en sw.js (vX.Y.Z -> vX.Y.(Z+1)) ---
echo Subiendo numero de version del Service Worker...
powershell -NoProfile -Command ^
  "$f='sw.js';" ^
  "$c=Get-Content $f -Raw;" ^
  "$m=[regex]::Match($c,'CACHE_VERSION = \"v(\d+)\.(\d+)\.(\d+)[^\"]*\"');" ^
  "if(-not $m.Success){Write-Host 'No encontre CACHE_VERSION en sw.js'; exit 1};" ^
  "$nv='v'+$m.Groups[1].Value+'.'+$m.Groups[2].Value+'.'+([int]$m.Groups[3].Value+1);" ^
  "$c=[regex]::Replace($c,'CACHE_VERSION = \"v\d+\.\d+\.\d+[^\"]*\"','CACHE_VERSION = \"'+$nv+'\"',1);" ^
  "Set-Content $f $c -NoNewline -Encoding utf8;" ^
  "Write-Host ('Nueva version: '+$nv)"

if errorlevel 1 (
  echo.
  echo ERROR subiendo la version. Cancelo.
  pause
  exit /b 1
)

REM --- 2) Desplegar solamente Firebase Hosting ---
REM Las reglas compartidas viven en Bitácoras de clase/firebase rules.
REM Nunca se publican desde este HUB para no reemplazar la política canónica.
echo.
echo Desplegando a Firebase Hosting...
call firebase deploy --only hosting:estudianteshub --project bitacoras-de-clase
if errorlevel 1 (
  echo.
  echo ERROR en el deploy de Firebase. Revisa el mensaje de arriba.
  pause
  exit /b 1
)

REM --- 3) Guardar y subir a GitHub ---
echo.
echo Guardando cambios en GitHub...
call git add -A
call git commit -m "Publica nueva version (deploy.bat)"
call git push origin main

echo.
echo === LISTO ===
echo La nueva version ya esta en: https://musicala-estudianteshub.web.app
echo Los usuarios la recibiran automaticamente al abrir o recargar la app.
echo.
pause
