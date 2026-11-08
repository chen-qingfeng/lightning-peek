# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org/); 0.x releases are previews.

## [0.1.3] – Preview – unreleased

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
