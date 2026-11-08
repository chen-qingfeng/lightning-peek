# Privacy, network and files

[简体中文](#中文)

This page describes what Lightning Peek 0.1.4 does with your data. It is based on the source code in this repository.

## Network

- The app makes no network requests. The page's Content Security Policy only allows content from the app itself (`app:`, `data:`, `blob:`), so remote resources cannot be loaded.
- There is no update check, telemetry, crash upload or account.
- Spell checking is disabled, so Chromium does not download dictionaries.
- The only exception is a button you click yourself: when **Save as DWG** needs the ODA File Converter, **Open the download page** opens the ODA website in your default browser.

## Files it reads

- Drawings you open (`.dwg`, `.dxf`) through the Open dialog, drag and drop, the command line or the right-click menu.
- `<drawing>.lpeek.json` next to a drawing, if it exists.
- Markup files (`.json`) you choose with **Import markups**.
- External references (`.dwg`, `.dxf`) recorded in an open drawing, from their recorded path or the drawing's folder.

The main process refuses to read other file types from the page.

## Files it writes

| What | Where | When |
| --- | --- | --- |
| Measurements, markups, text edits, scale | `<drawing>.lpeek.json` next to the drawing | After you add or change one |
| Settings, recent files, window size, Chromium cache | `%APPDATA%\闪电看图` (portable exe and installer); `data\` next to `LightningPeek.exe` for a build run from an unpacked folder | When they change / while the app runs |
| Unpacked program of the portable exe | `%LOCALAPPDATA%\LightningPeek\runtime-<version>` | First start of each version; older versions are removed |
| Exports (PNG, PDF, Excel, DXF, DWG) | Where you choose in the Save dialog | When you export |
| Temporary print/PDF page, DWG conversion folder | System temp folder (`%TEMP%\sdkt-*`) | Deleted right after printing, exporting or converting |

The original drawing is never written. Text edits are applied only when you choose **Save as DXF** or **Save as DWG**, which create a new file. **Save as DWG** runs the ODA File Converter that you installed yourself, on a temporary copy.

To remove everything: uninstall (installer) or delete the exe (portable), then delete `%APPDATA%\闪电看图`, `%LOCALAPPDATA%\LightningPeek` and any `.lpeek.json` files next to your drawings.

---

## 中文

本页说明闪电看图 0.1.4 如何处理你的数据，依据是本仓库的源代码。

### 网络

- 程序不发起任何网络请求。页面的内容安全策略只允许加载程序自身的内容（`app:`、`data:`、`blob:`），无法加载远程资源。
- 没有更新检查、使用统计、崩溃上传或账号。
- 拼写检查已关闭，Chromium 不会下载词典。
- 唯一的例外是你自己点的按钮：「另存为 DWG」需要 ODA File Converter 时，点「打开下载页面」会用默认浏览器打开 ODA 官网。

### 读取的文件

- 你通过打开对话框、拖放、命令行或右键菜单打开的图纸（`.dwg`、`.dxf`）。
- 图纸旁的 `图纸名.lpeek.json`（如果存在）。
- 你用「导入标注」选择的标注文件（`.json`）。
- 已打开图纸里记录的外部参照（`.dwg`、`.dxf`），按记录的路径或图纸所在文件夹查找。

主进程拒绝页面读取其他类型的文件。

### 写入的文件

| 内容 | 位置 | 时机 |
| --- | --- | --- |
| 测量、批注、文字修改、比例 | 图纸旁的 `图纸名.lpeek.json` | 添加或修改之后 |
| 设置、最近打开、窗口大小、Chromium 缓存 | `%APPDATA%\闪电看图`（绿色版 exe 和安装版）；直接从解压目录运行时为 `LightningPeek.exe` 旁的 `data\` | 发生变化时 / 程序运行期间 |
| 绿色版 exe 解出的程序 | `%LOCALAPPDATA%\LightningPeek\runtime-<版本>` | 每个版本第一次启动时；旧版本会被删除 |
| 导出文件（PNG、PDF、Excel、DXF、DWG） | 你在保存对话框中选择的位置 | 导出时 |
| 打印 / PDF 临时页面、DWG 转换临时文件夹 | 系统临时文件夹（`%TEMP%\sdkt-*`） | 打印、导出或转换后立即删除 |

程序从不写入原图纸。文字修改只在你选择「另存为 DXF」或「另存为 DWG」时写进新文件。「另存为 DWG」会对临时副本调用你自己安装的 ODA File Converter。

完全清除：卸载（安装版）或删除 exe（绿色版），再删除 `%APPDATA%\闪电看图`、`%LOCALAPPDATA%\LightningPeek` 和图纸旁的 `.lpeek.json` 文件。
