#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "========================================================"
echo "  AUTO PUBLISH ENVIRONMENT KE FIREBASE HOSTING GRATIS"
echo "  Project: gen-lang-client-0280945316"
echo "========================================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js belum terpasang. Instal dari https://nodejs.org"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[1/4] Menginstal dependensi..."
  npm install --legacy-peer-deps --no-audit --no-fund
else
  echo "[1/4] Dependensi sudah siap."
fi

echo "[2/4] Membangun aplikasi produksi..."
npm run build

echo "[3/4] Memeriksa login Firebase..."
if ! npx --yes firebase-tools login:list 2>/dev/null | grep -q "@"; then
  npx --yes firebase-tools login
fi

echo "[4/4] Mengunggah aplikasi & aturan Firestore ke Firebase Gratis..."
npx --yes firebase-tools deploy --only hosting,firestore:rules --project gen-lang-client-0280945316

echo ""
echo "========================================================"
echo "  BERHASIL! APLIKASI AKTIF DI:"
echo "  https://gen-lang-client-0280945316.web.app"
echo "========================================================"
