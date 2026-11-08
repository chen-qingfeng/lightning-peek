# Building Lightning Peek

[简体中文](#中文)

## Project layout

```
app/                      Electron app (shipped as-is, no bundler)
  main.js                 Main process: window, app:// protocol, file dialogs, PDF/print
  preload.js              Whitelisted bridge between page and main process
  renderer/
    index.html, style.css, app.js   User interface
    core/engine.js        DXF parser and scene builder (geometry, blocks, hatches, text)
    core/render.js        Canvas renderer
    core/worker.js        Background worker: DWG→DXF (LibreDWG), parsing, comparison, DXF export
    core/xlsx.js          Minimal .xlsx writer
    core/i18n.js          Chinese/English strings
    lib/libredwg-web.*    LibreDWG WebAssembly build (from mlightcad/libredwg-web 0.8.6)
build/
  pack-win.sh             Builds the Windows portable package
  pe_patch.py             Sets the exe icon and version information
  win_extras.py           Adds README.txt and the right-click menu scripts
docs/                     Documentation, screenshots, sample drawings
test/                     Unit tests (node --test)
tools/make-sample.py      Regenerates the sample drawings
```

There are no runtime npm dependencies. Electron is the only development dependency.

## Run from source

```sh
npm install
npm start
```

In development, settings are stored in `data-dev/` at the repository root.

## Tests

```sh
npm test
```

The tests parse the sample drawings and check entity counts, areas, lengths, code-page handling and the Excel writer.

## Windows package

```sh
npm run pack:win
```

Requirements: `bash`, `curl`, `unzip`, `zip`, `sha256sum` and Python 3 with Pillow. Linux and WSL work out of the box; on macOS install GNU coreutils for `sha256sum`.

The script:

1. Downloads `electron-v33.2.1-win32-x64.zip` from the Electron GitHub releases (cached in `build/cache/`) and verifies its SHA-256.
2. Renames `electron.exe` to `LightningPeek.exe`, removes the default Electron app and keeps only the `en-US`, `zh-CN` and `zh-TW` locale files.
3. Replaces the exe icon and version information with `build/pe_patch.py`. This edits resources in place; the result is not code-signed.
4. Copies `app/` to `resources/app/`, adds licenses, notices, `README.txt` and the right-click menu scripts.

## Single-file portable exe

```sh
npm run pack:portable
```

Builds `dist/LightningPeek-<version>-portable.exe` with NSIS 3 (`build/portable.nsi`). It is a silent launcher: on the first start of a version it unpacks the program to `%LOCALAPPDATA%\LightningPeek\runtime-<version>` (showing a "preparing" notice), removes older runtimes, and then starts `LightningPeek.exe` with the same command-line arguments. Later starts skip the unpacking.

## User guide PDF

`docs/user-guide.zh-CN.md` is the source. `python3 tools/guide2pdf.py docs/user-guide.zh-CN.md guide.html` turns it into HTML; print that page to A4 PDF with Chromium (for example Playwright's `page.pdf`) and copy the result to `app/guide.pdf`, which **Help → Open the user guide** opens.

## Windows installer

```sh
npm run pack:setup
```

Builds `dist/LightningPeek-<version>-setup-x64.exe` from the portable folder with NSIS 3 (`build/installer.nsi`). On Windows install NSIS; on Linux or macOS you can use the NSIS bundle from `electron-builder-binaries` and set `MAKENSIS` and `NSISDIR`. The installer installs per user into `%LOCALAPPDATA%\Programs\LightningPeek` without administrator rights, creates desktop and Start menu shortcuts, optionally adds an **Open with** entry for `.dwg`/`.dxf`, and registers an uninstaller. It writes `installed.flag` next to the exe, which makes the app keep its data in `%APPDATA%\闪电看图` instead of a `data` folder.
5. Writes `dist/LightningPeek-<version>-win-x64.zip` and its `.sha256` file.

## Regenerate sample drawings

```sh
python3 tools/make-sample.py
```

---

## 中文

### 目录结构

见上方英文部分的目录树。要点：

- `app/` 是 Electron 程序本体，不经过打包工具，原样发布。
- `app/renderer/core/engine.js` 是 DXF 解析和场景构建；`worker.js` 在后台线程里调用 LibreDWG 把 DWG 转成 DXF，也负责对比和另存 DXF。
- 运行时没有任何 npm 依赖，开发时只依赖 Electron。

### 从源码运行

```sh
npm install
npm start
```

开发模式下，设置保存在仓库根目录的 `data-dev/`。

### 测试

```sh
npm test
```

### 打安装程序

`npm run pack:setup` 用 NSIS 3（`build/installer.nsi`）把绿色版目录打成 `dist/LightningPeek-<版本>-setup-x64.exe`。按当前用户安装到 `%LOCALAPPDATA%\Programs\LightningPeek`，不需要管理员权限；创建桌面和开始菜单图标，可选加入「打开方式」，注册卸载程序。安装后会在 exe 旁边放 `installed.flag`，程序据此把数据存到 `%APPDATA%\闪电看图`。

### 打 Windows 包

```sh
npm run pack:win
```

需要 `bash`、`curl`、`unzip`、`zip`、`sha256sum` 和带 Pillow 的 Python 3。Linux 和 WSL 可直接使用，macOS 需另装 GNU coreutils。

脚本会：

1. 从 Electron 官方 GitHub Releases 下载 `electron-v33.2.1-win32-x64.zip`（缓存在 `build/cache/`），并校验 SHA-256。
2. 把 `electron.exe` 改名为 `LightningPeek.exe`，去掉 Electron 默认程序，只保留英文、简体中文、繁体中文语言包。
3. 用 `build/pe_patch.py` 原位替换 exe 的图标和版本信息。生成的程序没有代码签名。
4. 把 `app/` 复制到 `resources/app/`，加入许可证、第三方声明、`README.txt` 和右键菜单脚本。
5. 生成 `dist/LightningPeek-<版本>-win-x64.zip` 及其 `.sha256` 校验文件。

### 重新生成示例图纸

```sh
python3 tools/make-sample.py
```
