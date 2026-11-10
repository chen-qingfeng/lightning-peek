# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org/); 0.x releases are previews.

## [0.2.2] – Preview – 2026-11-10

### Fixed
- The default English layout name `Layout1` is shown as 布局1 (and `Layout2` as 布局2). A layout with its own name is left as written in the drawing.

## [0.2.1] – Preview – 2026-11-10

### Fixed
- The Model and Layout tabs at the bottom left stay visible. An empty layout was being dropped, and the tab bar itself was hidden whenever only Model remained. Layouts named in the drawing are listed again. A layout with no entities opens as a blank sheet; model-space geometry is unchanged.
- A coordinate label split on `^J` now uses one character size for the whole label. The height grows so the longest line meets the two endpoints, and the characters keep the font's own spacing. Single-line text is left as it was.

## [0.2.0] – Preview – 2026-11-10

### Fixed
- Coordinate labels that break on `^J` keep the character size of the whole label. Each line is no longer stretched across the full width on its own, which made the glyphs look small and the gaps too wide. The next line sits one text height below, instead of the looser multiline spacing. Aligned text (between two points) scales its height with its width so the letters stay in proportion.

## [0.1.10] – Preview – 2026-11-10

### Fixed
- Coordinate and pipe labels that store a line break as `^M^J` (管立得 and similar CAD) no longer show those caret codes between the X and the Y. The label breaks onto two lines, and each line keeps the fitted width so the characters spread out instead of piling up.
- An imported SHX font is drawn with a hairline. The old stroke grew with the text height and used round corners, so Chinese characters turned into a thick blur.
- A bigfont character built from several subshapes advances the pen after each part, so the parts are no longer drawn on top of each other.
- MTEXT character spacing (`\T`) is applied. A width factor of 0 is treated as 1, which is the DXF default, so the text does not collapse onto one point.

## [0.1.9] – Preview – 2026-11-10

### Fixed
- Opening one drawing no longer makes the next one fail with “memory access out of bounds”. Converting some files (the AutoCAD 2000 TArch drawing among them) leaves the LibreDWG converter’s memory unusable. The plain drawing is copied out first, then the converter is discarded and loaded fresh for the next file.

## [0.1.8] – Preview – 2026-11-10

### Fixed
- TArch annotation objects now show (AutoCAD 2000–2004 DWG). LibreDWG does not know these classes and dropped them, and many TArch files (for example `_t7` exports) store empty proxy graphics, so exploding did not help either. They are now read from the object data and drawn as ordinary text and lines:
  - single-line and multi-line text (`TCH_TEXT`, `TCH_MTEXT`), with alignment, box width and line spacing;
  - elevations (`TCH_ELEVATION`), including mirrored and flipped symbols, and `±0.000`;
  - axis labels (`TCH_AXIS_LABEL`), drawing names (`TCH_DRAWINGNAME`), door/window numbers (`TCH_OPENING`);
  - leaders (`TCH_MULTILEADER`), index symbols (`TCH_INDEXPOINTER`), arrow notes (`TCH_ARROW`);
  - tables (`TCH_SHEET`) with merged cells;
  - dimension chains (`TCH_DIMENSION2`).
  TArch markup `^U2^U`, `^U3^U` and `^C1^C` shows as ², ³ and ①. Walls, columns, stairs, handrails and slabs are still not shown.
- Structural drawings (探索者 `tssdeng.shx`, 盈建科 `yjkeng.shx` fonts): steel-bar symbols `%%130`–`%%133` were blank when those SHX fonts are not installed. They are now drawn as grade marks — HPB300 a circle with one stem, HRB335 the same plus a base bar, HRB400 two stems, and the fourth grade three stems. The stems stop at the centre of the base bar. `%%140…%%141` / `%%142…%%143` show as superscript / subscript (`kN/m²`). With the SHX fonts in the font folder the original glyphs are drawn. Search, hover and table export use the grade letters (`C8@200`). Edited text is drawn as ordinary letters; undo restores the marks.
- Long Chinese MTEXT in pre-2007 DWG no longer turns into garbage halfway through. LibreDWG splits MTEXT into 250-byte pieces and could cut a double-byte character in two.

### Changed
- TArch objects that still cannot be shown (walls, columns, stairs…) are listed by name in the "not shown" note when a drawing opens, instead of disappearing silently.

## [0.1.7] – Preview – 2026-11-10

### Added
- A Chinese font is bundled (Noto Sans SC), so drawings stay readable on computers that do not have `hztxt.shx`, `gbcbig.shx` or a system CJK font.
- Help can point at a local SHX / TrueType folder. Those fonts are used when present, and can be copied into the app's own font folder. They are not included in the installer.

## [0.1.6] – Preview – 2026-11-10

### Added
- Phone layout for Android and iOS browsers: one finger pans, two fingers zoom, and a drawing can be chosen from the phone's files. Add the page to the home screen from the browser. `npm run phone` serves it on the local network.

## [0.1.5] – Preview – 2026-11-10

### Changed
- Moving the mouse, hovering and the compare marching ants no longer redraw the whole drawing.
- Area, block, text, circle and box-length picks use a spatial index. Count ignores non-countable nested blocks.
- Circles are stored as a center and radius, so area is πr² instead of a 720-point outline.
- The parser keeps the DXF bytes only. Closing a drawing releases its external references.
- Exported images are capped at about 16 million pixels. Batches outside the view are skipped; construction lines still draw.

## [0.1.4] – Preview – 2026-11-08

### Added
- Single-file portable build (`LightningPeek-<version>-portable.exe`): double-click to run, nothing is installed. The first start unpacks the program to `%LOCALAPPDATA%\LightningPeek` (about half a minute); later starts are immediate.
- Save as DWG (AutoCAD 2000–2018), including text edits, through the free ODA File Converter if it is installed. The app finds it automatically or lets you choose it, and offers the download page or Save as DXF otherwise.
- User guide in Chinese (`docs/user-guide.zh-CN.md`, also as a PDF), opened from Help.
- Block Counts panel: clicking Count lists every block in the current space with its count; Mark boxes all instances; export to Excel.

### Changed
- Anonymous blocks (such as each state of a dynamic block) with identical content are counted as one kind instead of one each.
- Clicking something that is not a block with the Count tool now counts identical shapes instead of showing an error.
- Releases ship as two single files (portable exe and installer) plus the user guide; the zip is no longer attached.

## [0.1.3] – Preview – 2026-11-08

### Added
- Measurements are drawn like CAD dimensions: aligned and linear dimensions with extension lines and ticks (or arrows), and leaders for areas, radii, coordinates and counts. Labels can be dragged; dragging a dimension label moves the dimension line.
- New measuring tools: linear (horizontal/vertical), point-to-line distance, arc/curve length, per-segment lengths of a polyline, batch lengths of picked lines, stationing at a fixed interval (K0+020 style), rectangle area, area with arc segments (press A), side area (length × height) and circle (radius, diameter, circumference, area).
- Find Shapes: box-select a sample and count identical shapes even when they are not blocks (moved copies; rotated or mirrored copies are not counted).
- Markup Style: text size, colour, dimension ends and decimals; Hide Markups; Redo (Ctrl+Y).
- Rotate View in 90° steps and Mirror View. Export and print always use the drawing's own orientation.
- External references: loaded automatically from the recorded path or the drawing's folder, listed under Tools → Xrefs, and a missing file can be chosen by hand.
- Windows installer (`LightningPeek-<version>-setup-x64.exe`): per-user install without administrator rights, desktop and Start menu shortcuts, optional Open with entry for DWG/DXF, uninstaller. Installed copies keep their data in `%APPDATA%\闪电看图`.
- Layout → Model: export the current layout, including clipped viewport contents, as a flat model-space DXF.

### Changed
- No CLA any more: contributions are accepted under GPL-3.0-or-later, the project's license. Added a code of conduct and a security policy.
- The drawing unit is detected automatically: from "L=" pipe length labels next to lines, then the file header, then survey coordinates. Drawings in metres are no longer measured as millimetres. The reason is shown in the status bar; click it to change.
- Scale settings from older markup files are only reused when they were set by hand.

## [0.1.2] – Preview – 2026-11-08

### Added
- Embedded OLE objects (OLE2FRAME) are shown, for example Excel quantity tables pasted into the drawing. They are drawn from the preview Windows stored in the drawing (WMF), on a white background as in AutoCAD.
- Tools → Embedded: lists the OLE objects of all layouts with their titles, jumps to each one, and saves the embedded Excel workbook as an .xlsx file.
- Raster images (IMAGE) are drawn as their outline. The picture itself lives in an external file and is still not shown.

### Fixed
- Layout viewports now show the right part of model space. The view target, twist angle, non-rectangular clipping boundary and per-viewport frozen layers are applied. Before, viewports with a view target were blank.
- The overall paper viewport of a layout is no longer drawn as a model viewport. Layouts that contain nothing else get no tab.
- Damaged OLE data in a drawing can no longer stall or crash opening; the object is drawn as an outline instead.

## [0.1.1] – Preview – 2026-11-07

First public preview. Windows 10/11 x64 portable package only.

### Added
- Layer isolation: show only one layer, then restore the previous visibility.
- Measurement disclaimer in the Measurements panel and in exported Excel files.
- Chinese and English interface, chosen from the system language and switchable under Help.
- Actionable error messages when a drawing cannot be opened.

### Fixed
- Legacy DXF files with a declared code page (for example GBK) are decoded with that code page even when they contain few non-ASCII characters.
- DXF copies of pre-2007 drawings are written back in their original code page.
- Crop export to DXF keeps hatches inside the area.
- Comparison no longer treats arcs with clearly different angles as identical.
- Markups of several drawings are saved independently, and pending changes are saved when the window closes.
- Snapping, picking and block counts ignore hidden layers.
- Picked hatch areas exclude islands; circle and polyline-arc lengths are exact.
- Spline-fit polylines no longer include their frame vertices.
- Undo covers moved markups and edited notes or measurement properties.
- The main process only reads drawings and markup files, and only writes `.lpeek.json` files.

## [0.1.0] – internal build, not published

Feature set of the first preview:

### Viewing
- Open DWG (through LibreDWG) and ASCII DXF files by dialog, drag and drop, command line or right-click menu.
- Layers panel, model space and layouts with viewports, black or white background, recent files, several drawings in tabs.
- Text in UTF-8 and legacy code pages (GBK, Big5, Shift_JIS, EUC-KR, Windows-125x).

### Measuring
- Length, polyline, area, pick area (closed shapes and hatches, islands excluded), angle, radius, coordinates.
- Box length (total length of lines inside a window) and block count.
- Object snap (endpoint, midpoint, center, quadrant, insertion point) and ortho.
- Scale setting and calibration from a known length; categories, notes, unfolded area (length × height) and area offset.
- Export to Excel.

### Markup
- Text, revision cloud, arrow, rectangle, line, numbering; move by dragging, copy with Ctrl; undo.
- Stored next to the drawing in `<drawing>.lpeek.json`; export and import to share.

### Tools
- Find text in the whole drawing or inside an area; export results.
- Extract a drawn table to Excel.
- Edit drawing text and save a copy as DXF (the original is not changed).
- Crop export of an area to PNG, PDF or DXF.
- Compare two drawings: added, removed and changed entities, text changes shown old → new, automatic alignment, tolerance, overlay / side by side / swipe views, difference list, Excel report, revision clouds in the new drawing.
- Export PNG and A3 PDF; print.

### Interface
- Chinese and English interface, chosen from the system language and switchable under Help.
- Customizable tool shortcuts.

### Known issues
- See “Known limitations” in the README. The preview is not code-signed, so Windows SmartScreen may warn on first start.
