@echo off
setlocal
title Publish Environment - Firebase Hosting Gratis (Spark Plan)
cd /d "%~dp0"

echo ========================================================
echo   AUTO PUBLISH ENVIRONMENT KE FIREBASE HOSTING GRATIS
echo   Project: gen-lang-client-0280945316
echo ========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js belum terpasang di komputer Anda.
  echo     Silakan unduh dan instal Node.js LTS di: https://nodejs.org
  echo     Setelah instal, tutup lalu buka ulang file ini.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/4] Mengunduh paket aplikasi pertama kali...
  call npm install --legacy-peer-deps --no-audit --no-fund
  if errorlevel 1 (
    echo [X] Gagal menjalankan npm install. Pastikan koneksi internet aktif.
    pause
    exit /b 1
  )
) else (
  echo [1/4] Paket aplikasi sudah siap.
)

echo.
echo [2/4] Membangun aplikasi versi produksi...
call npm run build
if errorlevel 1 (
  echo [X] Gagal membangun aplikasi ^(npm run build^).
  pause
  exit /b 1
)

echo.
echo [3/4] Memeriksa login akun Google Firebase...
call npx --yes firebase-tools login:list | findstr /C:"@" >nul 2>nul
if errorlevel 1 (
  echo     Silakan login di browser dengan akun Google pemilik Firebase ^(misal indrprmn9@gmail.com^)...
  call npx --yes firebase-tools login
  if errorlevel 1 (
    echo [X] Login Firebase dibatalkan atau gagal.
    pause
    exit /b 1
  )
) else (
  echo     Akun Firebase sudah terhubung.
)

echo.
echo [4/4] Mengunggah aplikasi ^& aturan Firestore ke Firebase Gratis...
call npx --yes firebase-tools deploy --only hosting,firestore:rules --project gen-lang-client-0280945316
if errorlevel 1 (
  echo.
  echo [X] Deploy gagal. Jika akun yang login berbeda, jalankan:
  echo     npx firebase-tools logout  lalu jalankan ulang file ini.
  pause
  exit /b 1
)

echo.
echo ========================================================
echo   BERHASIL! APLIKASI SUDAH AKTIF GRATIS:
echo   https://gen-lang-client-0280945316.web.app
echo ========================================================
echo.
echo Catatan penting pertama kali:
echo 1. Tambahkan domain gen-lang-client-0280945316.web.app di Firebase Authentication ^> Authorized domains
echo 2. Tambahkan https://gen-lang-client-0280945316.web.app di Google Cloud OAuth ^> Authorized JavaScript origins
echo.
pause
