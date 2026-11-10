#!/usr/bin/env bash
# Build the Windows x64 portable package: Electron runtime + app/ -> dist/LightningPeek-<ver>-win-x64(.zip)
# 打 Windows x64 绿色版。需要：bash、curl、unzip、zip、Python 3（含 Pillow）。在 Linux / macOS / Git Bash 上都可运行。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_VERSION=33.2.1
ELECTRON_SHA256=c325a6d905c67107e166267813ea2151ae7fd316c0a88de0081db0b9851a9946
ELECTRON_ZIP="${ELECTRON_ZIP:-$HERE/build/cache/electron-v$ELECTRON_VERSION-win32-x64.zip}"
if [ ! -f "$ELECTRON_ZIP" ]; then
  mkdir -p "$(dirname "$ELECTRON_ZIP")"
  curl -fL -o "$ELECTRON_ZIP" "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-win32-x64.zip"
fi
echo "$ELECTRON_SHA256  $ELECTRON_ZIP" | sha256sum -c -
VER="$(node -p "require('$HERE/app/package.json').version")"
PY=""
for c in python3 python py; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "找不到 Python。Git Bash 里没有 python3 命令。" >&2
  echo "请安装 Python 3，安装时勾选 Add python.exe to PATH，关掉这个窗口重新打开，再执行 npm run pack:setup。" >&2
  exit 1
fi
NAME="LightningPeek-$VER-win-x64"
OUT="$HERE/dist/$NAME"
rm -rf "$OUT" && mkdir -p "$OUT"
unzip -q "$ELECTRON_ZIP" -d "$OUT"
mv "$OUT/electron.exe" "$OUT/LightningPeek.exe"
rm -f "$OUT/resources/default_app.asar"
mv "$OUT/LICENSE" "$OUT/LICENSE.electron.txt"
find "$OUT/locales" -name '*.pak' ! -name 'zh-CN.pak' ! -name 'zh-TW.pak' ! -name 'en-US.pak' -delete
"$PY" "$HERE/build/pe_patch.py" "$OUT/LightningPeek.exe" "$HERE/app/icon.png" "$VER"
mkdir -p "$OUT/resources/app"
( cd "$HERE/app" && tar --exclude='data-dev' --exclude='*.map' --exclude='__files' -cf - . ) | ( cd "$OUT/resources/app" && tar -xf - )
cp "$HERE/LICENSE" "$OUT/LICENSE.txt"
cp "$HERE/THIRD-PARTY-NOTICES.md" "$OUT/THIRD-PARTY-NOTICES.txt"
"$PY" "$HERE/build/win_extras.py" "$OUT" "$VER"
( cd "$HERE/dist" && rm -f "$NAME.zip" && zip -qr -9 "$NAME.zip" "$NAME" && sha256sum "$NAME.zip" > "$NAME.zip.sha256" )
echo "OK $OUT"
