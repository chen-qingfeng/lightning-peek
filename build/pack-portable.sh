#!/usr/bin/env bash
# 生成单文件绿色版 dist/LightningPeek-<版本>-portable.exe（双击即运行，不安装）
# 需要 NSIS 3（makensis），用法同 build/pack-installer.sh：可设置 MAKENSIS、NSISDIR。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(python3 -c "import json;print(json.load(open('$HERE/app/package.json'))['version'])")"
SRC="$HERE/dist/LightningPeek-$VER-win-x64"
OUT="$HERE/dist/LightningPeek-$VER-portable.exe"
MAKENSIS="${MAKENSIS:-makensis}"
[ -d "$SRC" ] || bash "$HERE/build/pack-win.sh"
TMP="$(mktemp -d)"; printf '\xef\xbb\xbf' > "$TMP/portable.nsi"; sed '1s/^\xef\xbb\xbf//' "$HERE/build/portable.nsi" >> "$TMP/portable.nsi"
"$MAKENSIS" -V2 -DVER="$VER" -DSRC="$SRC" -DOUT="$OUT" -DICON="$HERE/app/icon.ico" "$TMP/portable.nsi"
rm -rf "$TMP"
( cd "$HERE/dist" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
echo "OK $OUT"
