# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org/); 0.x releases are previews.

## [0.1.1] – Preview – unreleased

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
