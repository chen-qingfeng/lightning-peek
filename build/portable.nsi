; 闪电看图 单文件绿色版（NSIS 3，Unicode）
; 双击即运行，不安装、不写注册表、不建快捷方式。
; 第一次运行把程序解到 %LOCALAPPDATA%\LightningPeek\runtime-<版本>，之后直接启动；换新版本时清掉旧版本的缓存。
; 设置和批注保存在 %APPDATA%\闪电看图（与安装版相同）。
; 由 build/pack-portable.sh 调用：makensis -DVER=x.y.z -DSRC=<程序目录> -DOUT=<输出 exe> -DICON=<图标> portable.nsi

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user
SilentInstall silent
ManifestDPIAware true

!define EXE "LightningPeek.exe"
Name "闪电看图 Lightning Peek ${VER}"
OutFile "${OUT}"
Icon "${ICON}"
BrandingText "Lightning Peek ${VER}"

VIProductVersion "${VER}.0"
VIAddVersionKey /LANG=0 "ProductName" "Lightning Peek"
VIAddVersionKey /LANG=0 "FileDescription" "Lightning Peek (portable)"
VIAddVersionKey /LANG=0 "FileVersion" "${VER}"
VIAddVersionKey /LANG=0 "ProductVersion" "${VER}"
VIAddVersionKey /LANG=0 "CompanyName" "chen-qingfeng"
VIAddVersionKey /LANG=0 "LegalCopyright" "GPL-3.0-or-later"

!include "FileFunc.nsh"
!include "LogicLib.nsh"

Var RT

Section
  StrCpy $RT "$LOCALAPPDATA\LightningPeek\runtime-${VER}"
  ${IfNot} ${FileExists} "$RT\ready.flag"
    Banner::show /set 76 "闪电看图 Lightning Peek ${VER}" "第一次启动，正在准备程序，请稍候（约半分钟）…  Preparing, please wait…"
    RMDir /r "$RT"
    SetOutPath "$RT"
    File /r /x "data" /x "README.txt" /x "add-context-menu.bat" /x "remove-context-menu.bat" /x "scripts" "${SRC}\*.*"
    ; 数据放到 %APPDATA%\闪电看图（程序看到 installed.flag 就这样做）
    FileOpen $0 "$RT\installed.flag" w
    FileWrite $0 "portable launcher ${VER}"
    FileClose $0
    FileOpen $0 "$RT\ready.flag" w
    FileWrite $0 "${VER}"
    FileClose $0
    ; 清掉其他版本留下的缓存（正在运行的旧版本删不掉会被跳过）
    FindFirst $1 $2 "$LOCALAPPDATA\LightningPeek\runtime-*"
    ${DoWhile} $2 != ""
      ${If} $2 != "runtime-${VER}"
        RMDir /r "$LOCALAPPDATA\LightningPeek\$2"
      ${EndIf}
      FindNext $1 $2
    ${Loop}
    FindClose $1
    Banner::destroy
  ${EndIf}
  ; 把双击图纸或拖到 exe 上的文件原样传给程序
  ${GetParameters} $0
  SetOutPath "$RT"
  Exec '"$RT\${EXE}" $0'
SectionEnd
