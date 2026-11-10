#!/usr/bin/env bash
# 生成 Windows 安装程序 dist/LightningPeek-<版本>-setup-x64.exe
# 需要 NSIS 3（makensis）。Windows 上装 NSIS 即可；Linux / macOS 可用 electron-builder-binaries 里的 nsis 包，
# 设置 MAKENSIS=<makensis 路径>、NSISDIR=<nsis 解压目录>。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(node -p "require('$HERE/app/package.json').version")"
SRC="$HERE/dist/LightningPeek-$VER-win-x64"
OUT="$HERE/dist/LightningPeek-$VER-setup-x64.exe"
MAKENSIS="${MAKENSIS:-makensis}"
[ -d "$SRC" ] || bash "$HERE/build/pack-win.sh"
# NSIS 的 Unicode 脚本需要带 BOM 的 UTF-8
TMP="$(mktemp -d)"; printf '\xef\xbb\xbf' > "$TMP/installer.nsi"; sed '1s/^\xef\xbb\xbf//' "$HERE/build/installer.nsi" >> "$TMP/installer.nsi"
"$MAKENSIS" -V2 -DVER="$VER" -DSRC="$SRC" -DOUT="$OUT" -DICON="$HERE/app/icon.ico" "$TMP/installer.nsi"
rm -rf "$TMP"
( cd "$HERE/dist" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
echo "OK $OUT"
