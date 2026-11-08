; 闪电看图 Windows 安装程序（NSIS 3，Unicode）
; 由 build/pack-installer.sh 调用：makensis -DVER=x.y.z -DSRC=<绿色版目录> -DOUT=<输出 exe> -DICON=<图标> installer.nsi
; 按当前用户安装，不需要管理员权限；数据保存在 %APPDATA%\闪电看图，卸载时保留。

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user
ManifestDPIAware true

!define APPNAME "闪电看图"
!define APPNAME_EN "Lightning Peek"
!define EXE "LightningPeek.exe"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightningPeek"
!define PROGID "LightningPeek.Drawing"
!define URL "https://github.com/chen-qingfeng/lightning-peek"

Name "${APPNAME} ${APPNAME_EN} ${VER}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\LightningPeek"
InstallDirRegKey HKCU "${REGKEY}" "InstallLocation"
BrandingText "${APPNAME_EN} ${VER}"

VIProductVersion "${VER}.0"
VIAddVersionKey /LANG=0 "ProductName" "${APPNAME_EN}"
VIAddVersionKey /LANG=0 "FileDescription" "${APPNAME_EN} Setup"
VIAddVersionKey /LANG=0 "FileVersion" "${VER}"
VIAddVersionKey /LANG=0 "ProductVersion" "${VER}"
VIAddVersionKey /LANG=0 "CompanyName" "chen-qingfeng"
VIAddVersionKey /LANG=0 "LegalCopyright" "GPL-3.0-or-later"

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_LANGDLL_ALLLANGUAGES
!define MUI_COMPONENTSPAGE_SMALLDESC
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${SRC}\LICENSE.txt"
!insertmacro MUI_PAGE_COMPONENTS
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

LangString SecMain ${LANG_SIMPCHINESE} "闪电看图（必需）"
LangString SecMain ${LANG_ENGLISH} "Lightning Peek (required)"
LangString SecDesk ${LANG_SIMPCHINESE} "桌面快捷方式"
LangString SecDesk ${LANG_ENGLISH} "Desktop shortcut"
LangString SecMenu ${LANG_SIMPCHINESE} "开始菜单快捷方式"
LangString SecMenu ${LANG_ENGLISH} "Start menu shortcut"
LangString SecOpen ${LANG_SIMPCHINESE} "加入 DWG / DXF 的「打开方式」"
LangString SecOpen ${LANG_ENGLISH} "Add to “Open with” for DWG / DXF"
LangString DescMain ${LANG_SIMPCHINESE} "程序文件。"
LangString DescMain ${LANG_ENGLISH} "Program files."
LangString DescDesk ${LANG_SIMPCHINESE} "在桌面放一个闪电看图图标。"
LangString DescDesk ${LANG_ENGLISH} "Put a Lightning Peek icon on the desktop."
LangString DescMenu ${LANG_SIMPCHINESE} "在开始菜单里添加闪电看图和卸载。"
LangString DescMenu ${LANG_ENGLISH} "Add Lightning Peek and its uninstaller to the Start menu."
LangString DescOpen ${LANG_SIMPCHINESE} "右键图纸 → 打开方式 里可以选闪电看图。不会改变 DWG 默认用什么软件打开。"
LangString DescOpen ${LANG_ENGLISH} "Lets you pick Lightning Peek under right-click → Open with. Does not change the default program for DWG files."
LangString Running ${LANG_SIMPCHINESE} "闪电看图正在运行，请先关闭它，再点「重试」。"
LangString Running ${LANG_ENGLISH} "Lightning Peek is running. Close it, then click Retry."
LangString UninstLink ${LANG_SIMPCHINESE} "卸载闪电看图"
LangString UninstLink ${LANG_ENGLISH} "Uninstall Lightning Peek"

; 程序在运行时不能覆盖文件：提示关闭
!macro CheckRunning un
Function ${un}CheckRunning
  retry:
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq ${EXE}" /NH | find /I "${EXE}"'
  Pop $0
  ${If} $0 == 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(Running)" IDRETRY retry
    Abort
  ${EndIf}
FunctionEnd
!macroend
!insertmacro CheckRunning ""
!insertmacro CheckRunning "un."

; 安装目录总是以 LightningPeek 结尾，卸载时整个删除才安全
Function DirLeave
  ${GetFileName} "$INSTDIR" $0
  ${If} $0 != "LightningPeek"
    StrCpy $INSTDIR "$INSTDIR\LightningPeek"
  ${EndIf}
FunctionEnd

Function .onInit
  !insertmacro MUI_LANGDLL_DISPLAY
FunctionEnd
Function un.onInit
  !insertmacro MUI_UNGETLANGUAGE
FunctionEnd

Section "$(SecMain)" SEC_MAIN
  SectionIn RO
  Call CheckRunning
  SetOutPath "$INSTDIR"
  ; 旧版本的 resources 先清掉，避免残留文件
  RMDir /r "$INSTDIR\resources"
  File /r /x "data" /x "README.txt" /x "add-context-menu.bat" /x "remove-context-menu.bat" /x "scripts" "${SRC}\*.*"
  ; 标记为安装版：程序会把数据放到 %APPDATA%\闪电看图
  FileOpen $0 "$INSTDIR\installed.flag" w
  FileWrite $0 "installed by setup ${VER}"
  FileClose $0
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${APPNAME} ${APPNAME_EN}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "chen-qingfeng"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${REGKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKCU "${REGKEY}" "URLInfoAbout" "${URL}"
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${REGKEY}" "EstimatedSize" "$0"
SectionEnd

Section "$(SecDesk)" SEC_DESK
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
SectionEnd

Section "$(SecMenu)" SEC_MENU
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\$(UninstLink).lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "$(SecOpen)" SEC_OPEN
  WriteRegStr HKCU "Software\Classes\${PROGID}" "" "${APPNAME_EN} drawing"
  WriteRegStr HKCU "Software\Classes\${PROGID}\DefaultIcon" "" '"$INSTDIR\${EXE}",0'
  WriteRegStr HKCU "Software\Classes\${PROGID}\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'
  WriteRegStr HKCU "Software\Classes\.dwg\OpenWithProgids" "${PROGID}" ""
  WriteRegStr HKCU "Software\Classes\.dxf\OpenWithProgids" "${PROGID}" ""
  WriteRegStr HKCU "Software\Classes\Applications\${EXE}\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\${EXE}\SupportedTypes" ".dwg" ""
  WriteRegStr HKCU "Software\Classes\Applications\${EXE}\SupportedTypes" ".dxf" ""
  WriteRegStr HKCU "Software\Classes\Applications\${EXE}" "FriendlyAppName" "${APPNAME}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_MAIN} "$(DescMain)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESK} "$(DescDesk)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_MENU} "$(DescMenu)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_OPEN} "$(DescOpen)"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  Call un.CheckRunning
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  DeleteRegValue HKCU "Software\Classes\.dwg\OpenWithProgids" "${PROGID}"
  DeleteRegValue HKCU "Software\Classes\.dxf\OpenWithProgids" "${PROGID}"
  DeleteRegKey HKCU "Software\Classes\${PROGID}"
  DeleteRegKey HKCU "Software\Classes\Applications\${EXE}"
  DeleteRegKey HKCU "${REGKEY}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; 安装目录名固定以 LightningPeek 结尾（见 DirLeave），可以整体删除；用户数据在 %APPDATA%\闪电看图，保留
  ${GetFileName} "$INSTDIR" $0
  ${If} $0 == "LightningPeek"
    RMDir /r "$INSTDIR"
  ${Else}
    Delete "$INSTDIR\Uninstall.exe"
    Delete "$INSTDIR\installed.flag"
  ${EndIf}
SectionEnd
