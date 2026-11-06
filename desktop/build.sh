#!/usr/bin/env bash
# Build the Windows desktop app: embeds ../plo6-hilo-lab.html into a native WebView2 window.
set -euo pipefail
cd "$(dirname "$0")"
python3 ../build.py
cp ../plo6-hilo-lab.html app.html
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H windowsgui -s -w" -o ../dist/PLO6-HiLo-Lab.exe .
echo "built dist/PLO6-HiLo-Lab.exe"
