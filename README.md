<p align="center">
  <img src="app/icon.png" width="96" height="96" alt="Lightning Peek icon">
</p>

<h1 align="center">Lightning Peek · 闪电看图</h1>

<p align="center">
  A lightweight DWG/DXF viewer for looking things up, measuring and checking drawings.<br>
  <b>English</b> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center"><b>Current version: v0.1.2 preview</b> (Windows 10 / 11, 64-bit)</p>

Built for people on construction, civil, steel and heritage projects — site engineers, quantity surveyors, document controllers, clients and crews — who open drawings to **look, search, count and check**, not to draft. Lightning Peek opens the drawing without a CAD installation and helps you find, measure and compare what is in it.

![Lightning Peek showing a pump room plan with the Layers panel](docs/images/overview.png)

## Download

👉 [Download the Windows portable build from Releases](https://github.com/chen-qingfeng/lightning-peek/releases)

This is a preview. It has been checked on a limited set of drawings (see [Supported formats](#supported-formats-and-known-limitations)). Please [report](https://github.com/chen-qingfeng/lightning-peek/issues/new/choose) drawings that do not open or display incorrectly. macOS and Linux builds are not available yet.

## What it does

- **Open drawings.** Drag a DWG or DXF file into the window. Layers, layouts, blocks, hatches, dimensions and Chinese/English text are shown. Drawings are parsed in the background, so the window stays responsive.
- **Find things.** Turn layers on and off, search them, or isolate one. Search all text, including dimension text, in the whole drawing or inside an area, and jump to each result.
- **Rough quantities.** Lengths, polylines and the total length of all lines inside a box; click inside a closed shape or hatch to get its area (islands excluded); count blocks by name and see where they are. Results are grouped by category and export to Excel.
- **Compare revisions.** Every entity is matched and classified as added, removed or changed text. Unchanged and changed areas are counted, and you can view them overlaid, side by side or with a swipe, then export the list.
- **Mark up without touching the drawing.** Text notes, revision clouds, arrows and numbers are saved in a small file next to the drawing that you can share.

![Measuring a length, a picked area and a block count](docs/images/measure.png)

![Comparing two revisions: removed, added and changed entities](docs/images/compare.png)

## What it is not

| Not included | Why |
| --- | --- |
| PDF and images (JPG, PNG, …) | Optimized for DWG/DXF only, to stay small |
| Drafting and editing | It is a viewer, not a CAD editor |
| BIM and 3D modelling | It stays 2D and lightweight |
| Precise quantity take-off | It is for quick rough checks, not a replacement for professional estimating software |
| Changing the original drawing | Read-only; text edits can only be saved as a new DXF |

> Measurements are for quick checks and rough quantities. They depend on how accurately the drawing was drawn and on the scale setting, and do not replace formal quantity take-off.

## Problems it addresses

| Problem | What v0.1.2 does |
| --- | --- |
| Starting a large CAD package just to look at a drawing | Portable app, no installation |
| Messy layers | Layer on/off, search and isolate |
| Piles of text that are hard to read or find | Full-text search with location, optionally inside an area |
| Dense pipes, manholes and footings | Count blocks by name and highlight them; search by text |
| Manual counting and measuring that misses or double-counts | Box length, picked areas and block counts, summarized in Excel |
| Comparing revisions by eye | Drawing comparison with a list of every difference |

The full plan — layer classification, drawing checks, natural-language queries and more — is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Install and first use

1. Download `LightningPeek-0.1.2-win-x64.zip` from [Releases](https://github.com/chen-qingfeng/lightning-peek/releases) and unzip it anywhere, for example `D:\Tools\LightningPeek`.
2. Double-click `LightningPeek.exe`. Nothing is installed and no administrator rights are needed.
   Windows SmartScreen may warn that the app is from an unknown publisher, because the preview is not code-signed. Choose **More info → Run anyway** only if you downloaded it from this repository's Releases page.
3. Click **Open** or drag a `.dwg` / `.dxf` file into the window.
4. Optional: run `add-context-menu.bat` to get **Open with Lightning Peek** when you right-click a drawing. `remove-context-menu.bat` removes it.

The interface follows the Windows display language (Chinese or English). You can switch it under **Help → Interface language**.

## Everyday controls

| Action | How |
| --- | --- |
| Zoom | Mouse wheel (zooms at the cursor) |
| Pan | Drag with the left or middle mouse button |
| Whole drawing | `Home`, or double-click the middle button |
| Zoom to a window | `W`, then drag a rectangle |
| Finish a polyline or area | Right-click or `Enter` |
| Leave a tool | `Esc` |
| Object snap / ortho | `F3` / `F8` |
| Undo | `Ctrl+Z` |
| Open · Find · Print | `Ctrl+O` · `Ctrl+F` · `Ctrl+P` |
| Move / copy a markup | Drag it with no tool selected; hold `Ctrl` to copy |

Tool shortcuts (default): `1` Length · `2` Polyline · `3` Area · `4` Pick area · `5` Angle · `6` Radius · `7` Coordinate · `8` Box length · `9` Block count · `T` Text note · `Y` Cloud · `A` Arrow · `R` Rectangle · `L` Line · `N` Number · `E` Erase · `B` Extract table · `X` Edit text · `C` Crop export · `S` Measurements · `G` Layers. All of them can be changed under **Help**.

## Supported formats and known limitations

| Format | Status |
| --- | --- |
| DWG | Read through [LibreDWG](https://www.gnu.org/software/libredwg/). Tested with AutoCAD 2007 format (AC1021) drawings. Other versions depend on LibreDWG and may fail or show missing entities. |
| DXF (ASCII) | Read directly. Tested with R12 and 2007 DXF, UTF-8 and GBK code pages. |
| DXF (binary) | Not supported. |
| Export | PNG, PDF (A3), Excel (measurements, find results, tables, comparison report), DXF (copy with your text edits). DWG cannot be written. |

Known limitations in v0.1.2:

- SHX fonts are drawn with system fonts (FangSong, SimSun and similar), so text width can differ slightly from AutoCAD.
- Custom objects from vertical software (for example TArch walls and doors) are not shown unless the drawing was exported to plain entities (“T3” format).
- External references (xrefs), wipeouts, 3D solids, regions and multileaders are not shown. Raster images are shown as an outline only.
- OLE objects are shown from the preview stored in the drawing. If the drawing has no preview for an object, only its frame is drawn.
- Line weights are not displayed; complex line types are drawn as simple dashes.
- Opening speed has only been measured on one 380 KB drawing (see [docs/FORMATS.md](docs/FORMATS.md)); there are no systematic performance tests on Windows hardware yet.

The full list of supported entities is in [docs/FORMATS.md](docs/FORMATS.md).

## Privacy and your files

- Lightning Peek does not connect to the internet and collects no data.
- The original drawing is never modified. Text edits are written only to a new DXF file that you save yourself.
- Measurements and markups are stored next to the drawing as `<drawing>.lpeek.json` once you add one.
- Settings, the recent-files list and the browser cache are stored in the `data` folder next to `LightningPeek.exe`.
- PDF export and printing create a temporary page in the system temp folder and delete it afterwards.

Details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Build from source

Requirements: Node.js 20+, Python 3 with Pillow, `curl`, `unzip`, `zip`, `bash` (Linux or WSL; macOS needs GNU coreutils).

```sh
git clone https://github.com/chen-qingfeng/lightning-peek.git
cd lightning-peek
npm install          # installs Electron for local development
npm start            # runs the app from source
npm test             # unit tests (no extra dependencies)
npm run pack:win     # builds dist/LightningPeek-<version>-win-x64.zip
```

See [docs/BUILDING.md](docs/BUILDING.md) for how the package is assembled and how the project is laid out.

## Roadmap

Next: external references, an installer and code signing, performance tests on Windows hardware, lineweight display and broader DWG version testing.
Later: layer classification, drawing checks (conflicting or missing dimensions, elevation conflicts) and optional AI assistance (natural-language queries, component recognition; off by default).

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full plan and [CHANGELOG.md](CHANGELOG.md) for changes.

## Feedback and contributing

- Bugs and drawings that fail to open: [open an issue](https://github.com/chen-qingfeng/lightning-peek/issues/new/choose). Please do not attach drawings that contain confidential information.
- Pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.
- **Contributor License Agreement:** before a pull request is merged, you agree to the [CLA](CLA.md) by ticking a box in the pull request. You keep the copyright in your contribution; the CLA lets the maintainer also offer Lightning Peek under other terms, such as a future commercial edition. Everything released here stays under GPL-3.0-or-later.

## License and credits

Lightning Peek is free software under the [GNU General Public License v3.0 or later](LICENSE).

It builds on:

- [LibreDWG](https://www.gnu.org/software/libredwg/) (GPL-3.0-or-later) and its WebAssembly build [libredwg-web](https://github.com/mlightcad/libredwg-web) by mlightcad (GPL-3.0) for reading DWG files.
- [Electron](https://www.electronjs.org/) (MIT) and Chromium (various open-source licenses, shipped as `LICENSES.chromium.html`).

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The sample drawings in `docs/samples` were made for this project.
