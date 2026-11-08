# Privacy, network and files

[简体中文](#中文)

This page describes what Lightning Peek 0.1.2 does with your data. It is based on the source code in this repository.

## Network

- The app makes no network requests. The page's Content Security Policy only allows content from the app itself (`app:`, `data:`, `blob:`), so remote resources cannot be loaded.
- There is no update check, telemetry, crash upload or account.
- Spell checking is disabled, so Chromium does not download dictionaries.

## Files it reads

- Drawings you open (`.dwg`, `.dxf`) through the Open dialog, drag and drop, the command line or the right-click menu.
- `<drawing>.lpeek.json` next to a drawing, if it exists.
- Markup files (`.json`) you choose with **Import markups**.

The main process refuses to read other file types from the page.

## Files it writes

| What | Where | When |
| --- | --- | --- |
| Measurements, markups, text edits, scale | `<drawing>.lpeek.json` next to the drawing | After you add or change one |
| Settings, recent files, window size | `data\settings.json` next to `LightningPeek.exe` | When they change |
| Chromium cache and local storage | `data\session\` next to `LightningPeek.exe` | While the app runs |
| Exports (PNG, PDF, Excel, DXF) | Where you choose in the Save dialog | When you export |
| Temporary print/PDF page | System temp folder (`%TEMP%\sdkt-*`) | Deleted right after printing or exporting |

If the program folder is not writable, settings fall back to `%APPDATA%\闪电看图`.

The original drawing is never written. Text edits are applied only when you choose **Export → Save as DXF**, which creates a new file.

To remove everything: delete the program folder and any `.lpeek.json` files next to your drawings. The optional right-click menu entry is removed with `remove-context-menu.bat`.

---

## 中文

本页说明闪电看图 0.1.2 如何处理你的数据，依据是本仓库的源代码。

### 网络

- 程序不发起任何网络请求。页面的内容安全策略只允许加载程序自身的内容（`app:`、`data:`、`blob:`），无法加载远程资源。
- 没有更新检查、使用统计、崩溃上传或账号。
- 拼写检查已关闭，Chromium 不会下载词典。

### 读取的文件

- 你通过打开对话框、拖放、命令行或右键菜单打开的图纸（`.dwg`、`.dxf`）。
- 图纸旁的 `图纸名.lpeek.json`（如果存在）。
- 你用「导入标注」选择的标注文件（`.json`）。

主进程拒绝页面读取其他类型的文件。

### 写入的文件

| 内容 | 位置 | 时机 |
| --- | --- | --- |
| 测量、批注、文字修改、比例 | 图纸旁的 `图纸名.lpeek.json` | 添加或修改之后 |
| 设置、最近打开、窗口大小 | `LightningPeek.exe` 旁的 `data\settings.json` | 发生变化时 |
| Chromium 缓存与本地存储 | `LightningPeek.exe` 旁的 `data\session\` | 程序运行期间 |
| 导出文件（PNG、PDF、Excel、DXF） | 你在保存对话框中选择的位置 | 导出时 |
| 打印 / PDF 临时页面 | 系统临时文件夹（`%TEMP%\sdkt-*`） | 打印或导出后立即删除 |

如果程序文件夹不可写，设置会改存到 `%APPDATA%\闪电看图`。

程序从不写入原图纸。文字修改只在你选择「导出 → 另存为 DXF」时写进新文件。

完全清除：删除程序文件夹和图纸旁的 `.lpeek.json` 文件即可。可选的右键菜单用 `remove-context-menu.bat` 移除。
