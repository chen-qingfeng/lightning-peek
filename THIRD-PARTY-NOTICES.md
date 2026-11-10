# Third-party notices

Lightning Peek includes or depends on the following software. Full license texts are included in the release package.

| Component | Version | License | Where |
| --- | --- | --- | --- |
| [LibreDWG](https://www.gnu.org/software/libredwg/) | as built into libredwg-web 0.8.6 | GPL-3.0-or-later | `app/renderer/lib/libredwg-web.wasm` |
| [libredwg-web](https://github.com/mlightcad/libredwg-web) (WebAssembly build of LibreDWG, by mlightcad) | 0.8.6 | GPL-3.0 | `app/renderer/lib/libredwg-web.js`, `.wasm`; license text in `app/renderer/lib/LibreDWG-COPYING.txt` |
| [Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC) (Simplified Chinese subset) | regular, woff2 | SIL Open Font License 1.1 | `app/renderer/fonts/NotoSansSC-Regular.woff2`; license in `app/renderer/fonts/NotoSansSC-OFL.txt`. Copyright 2014-2021 Adobe, with Reserved Font Name “Source”. | 
| [Electron](https://www.electronjs.org/) | 33.2.1 | MIT | Windows package runtime; license in `LICENSE.electron.txt` |
| Chromium and its dependencies (bundled with Electron) | as shipped with Electron 33.2.1 | Various open-source licenses | Windows package; see `LICENSES.chromium.html` |

Not bundled:

- **Fonts.** Noto Sans SC is included so Chinese text remains readable on computers that do not have CAD shape fonts. Other SHX and TrueType files are read only from a folder you choose (or from the copy you make inside the app) and are not distributed with Lightning Peek. When a requested SHX file is missing, text is drawn with Noto Sans SC, then with fonts already installed on the computer (for example FangSong, SimSun, Microsoft YaHei, Arial).
- **Icons and artwork.** The app icon, toolbar icons and sample drawings were created for this project and are covered by the project license.

The source code of LibreDWG is available at <https://git.savannah.gnu.org/cgit/libredwg.git>, and the WebAssembly build at <https://github.com/mlightcad/libredwg-web>.
