#!/usr/bin/env python3
"""随包附件：中英双语说明、右键菜单脚本。
右键菜单用「ASCII 批处理 + UTF-8(BOM) PowerShell」，中文和英文 Windows 都不会乱码。"""
import sys, os
out, ver = sys.argv[1], sys.argv[2]
crlf = lambda s: s.replace('\n', '\r\n')
os.makedirs(os.path.join(out, 'scripts'), exist_ok=True)
ps1 = r'''# Lightning Peek / 闪电看图 —— 为 .dwg / .dxf 添加或移除右键菜单（仅当前用户，无需管理员）
param([switch]$Remove)
$exe = Join-Path (Split-Path $PSScriptRoot -Parent) 'LightningPeek.exe'
$zh = (Get-UICulture).Name -like 'zh*'
$label = if ($zh) { '用闪电看图打开' } else { 'Open with Lightning Peek' }
foreach ($ext in '.dwg', '.dxf') {
  $key = "HKCU:\Software\Classes\SystemFileAssociations\$ext\shell\LightningPeek"
  if ($Remove) { if (Test-Path $key) { Remove-Item $key -Recurse -Force }; continue }
  New-Item -Path "$key\command" -Force | Out-Null
  Set-ItemProperty -Path $key -Name '(default)' -Value $label
  Set-ItemProperty -Path $key -Name 'Icon' -Value "`"$exe`""
  Set-ItemProperty -Path "$key\command" -Name '(default)' -Value "`"$exe`" `"%1`""
}
if ($Remove) { if ($zh) { '已移除右键菜单。' } else { 'Context menu entry removed.' } }
else { if ($zh) { '已添加：在 DWG / DXF 文件上点右键即可「用闪电看图打开」。程序文件夹挪动后请重新运行。' } else { 'Added "Open with Lightning Peek" to the right-click menu of DWG / DXF files. Run this again if you move the program folder.' } }
'''
open(os.path.join(out, 'scripts', 'context-menu.ps1'), 'wb').write(b'\xef\xbb\xbf' + crlf(ps1).encode('utf-8'))
bat_add = '@echo off\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\context-menu.ps1"\npause\n'
bat_rm = '@echo off\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\context-menu.ps1" -Remove\npause\n'
open(os.path.join(out, 'add-context-menu.bat'), 'wb').write(crlf(bat_add).encode('ascii'))
open(os.path.join(out, 'remove-context-menu.bat'), 'wb').write(crlf(bat_rm).encode('ascii'))
readme = f'''Lightning Peek {ver} (preview) — Windows x64 portable
闪电看图 {ver}（预览版）— Windows x64 绿色版
==========================================================

[English]
Start: double-click LightningPeek.exe. No installation.
Open a drawing: click Open, or drag a DWG / DXF file into the window.
Optional right-click menu: run add-context-menu.bat (remove-context-menu.bat removes it).
Settings and the recent-files list are stored in the data folder next to the program.
Measurements and markups are stored next to each drawing as "<drawing>.lpeek.json".
Drawings are never modified. The program does not connect to the internet.
Requires Windows 10 or 11, 64-bit.
License: GPL-3.0-or-later (LICENSE.txt). Third-party notices: THIRD-PARTY-NOTICES.txt.
Source and issues: https://github.com/chen-qingfeng/lightning-peek

[中文]
启动：双击 LightningPeek.exe，免安装。
打开图纸：点「打开」，或把 DWG / DXF 文件拖进窗口。
右键菜单（可选）：运行 add-context-menu.bat；remove-context-menu.bat 可移除。
设置和最近打开记录保存在程序旁的 data 文件夹。
测量和批注保存在每张图纸旁的「图纸名.lpeek.json」。
不会修改原图纸，程序不联网。
系统要求：Windows 10 / 11，64 位。
许可证：GPL-3.0-or-later（LICENSE.txt），第三方声明见 THIRD-PARTY-NOTICES.txt。
源码与问题反馈：https://github.com/chen-qingfeng/lightning-peek
'''
open(os.path.join(out, 'README.txt'), 'wb').write(b'\xef\xbb\xbf' + crlf(readme).encode('utf-8'))
print('extras ok')
