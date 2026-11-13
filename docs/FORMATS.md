# Supported formats and entities

[简体中文](#中文)

## How files are read

- **DWG** files are converted to DXF in memory by LibreDWG (WebAssembly build from [libredwg-web](https://github.com/mlightcad/libredwg-web), version 0.8.6) and then parsed by Lightning Peek's own DXF reader (`app/renderer/core/engine.js`). When LibreDWG’s DXF export omits VERTEX bulge (group 42), the viewer reads the bulge from the DWG object by handle and restores it before drawing.
- **DXF** files (ASCII) are parsed directly. Text encoding: UTF-8 for AutoCAD 2007 and later; for older files the code page declared in `$DWGCODEPAGE` is used (GBK, Big5, Shift_JIS, EUC-KR and Windows-125x are mapped).
- Binary DXF is not supported.

## Entities

| Entity | Shown | Notes |
| --- | --- | --- |
| LINE, XLINE, RAY | Yes | Construction lines are clipped to a large length |
| CIRCLE, ARC, ELLIPSE | Yes | Arcs stay smooth at any zoom |
| LWPOLYLINE, POLYLINE (2D/3D) | Yes | Bulges and constant width supported; mesh/polyface drawn as vertex chains |
| SPLINE | Yes | NURBS from control points, or a smooth curve through fit points |
| TEXT, ATTRIB | Yes | Alignment, width factor, oblique angle, mirroring. SHX fonts (shapes, bigfont, unifont) are stroked from a local `.shx` folder when one is chosen; otherwise the bundled Noto Sans SC is used |
| MTEXT | Yes | Paragraphs, wrapping and stacked fractions; inline font/colour changes are ignored |
| INSERT (blocks, arrays) | Yes | Nested blocks up to 16 levels |
| DIMENSION | Yes | Drawn from the dimension's own block |
| HATCH | Yes | Solid and pattern fills, islands; very dense patterns fall back to a light fill |
| SOLID, TRACE, 3DFACE, POINT, LEADER | Yes | |
| VIEWPORT (in layouts) | Yes | View target, twist, scale, non-rectangular clipping and per-viewport frozen layers |
| ACAD_TABLE | Yes | Through its anonymous block |
| OLE2FRAME (embedded Excel and other objects) | Yes | Drawn from the stored WMF preview; the embedded workbook can be saved as .xlsx |
| IMAGE | Outline only | The picture is an external file |
| WIPEOUT | No | |
| REGION, 3DSOLID, BODY, MESH | No | |
| MLEADER | No | |
| Proxy / custom objects (e.g. TArch) | No | Export to plain entities ("T3") first |
| TArch annotations (text, multi-line text, elevations, axis labels, drawing names, door/window numbers, leaders, index symbols, arrow notes, tables, dimensions) | Yes (DWG 2000–2004) | Read from the object data; not written to exported DXF/DWG yet. Walls, columns, stairs, slabs: no |
| External references | Yes | Loaded from the recorded path or the drawing's folder; view only, no snapping |

## Tested drawings (0.1.4)

| Drawing | Format | Result |
| --- | --- | --- |
| `docs/samples/pump-room.dxf`, `pump-room-rev-b.dxf` | DXF R12, UTF-8 | All 142 entities shown; unit tests in `test/` |
| A municipal utility detail drawing (not published, contains client data) | DWG, AutoCAD 2007 (AC1021), 380 KB, 15,586 entities | Opened, all entity types shown; measuring, comparison and export checked by hand |
| Generated GBK DXF snippet | DXF 2000, ANSI_936 | Text decoded correctly (unit test) |
| Three municipal drainage drawings (not published, contain client data) | DWG, AutoCAD 2004 and 2007; 3.0 MB / 38,204 entities, 4.0 MB / 167,007 entities, 22.7 MB / 428,512 entities | Layouts with 10–20 rotated, clipped viewports match AutoCAD; 7 and 13 embedded Excel tables shown and saved as .xlsx |

Opening the 380 KB DWG above took about 1 second in headless Chromium inside a Linux cloud container (DWG → DXF conversion plus scene building, measured with `performance.now()`). In the same setup (2 CPU cores), the three drainage drawings took 3.7 s, 5.5 s and 19.6 s. Speed on your computer will differ.

---

## 中文

### 读取方式

- **DWG**：先由 LibreDWG（[libredwg-web](https://github.com/mlightcad/libredwg-web) 0.8.6 的 WebAssembly 版本）在内存中转换为 DXF，再由闪电看图自带的 DXF 解析器（`app/renderer/core/engine.js`）处理。若 LibreDWG 写出的 DXF 丢掉了 VERTEX 凸度（组码 42），会按句柄从 DWG 对象读回后再绘制。
- **DXF（文本格式）**：直接解析。AutoCAD 2007 及以后按 UTF-8 解码；更早的版本按文件头 `$DWGCODEPAGE` 声明的代码页解码（支持 GBK、Big5、Shift_JIS、EUC-KR、Windows-125x）。
- 不支持二进制 DXF。

### 图元支持

| 图元 | 显示 | 说明 |
| --- | --- | --- |
| 直线、构造线、射线 | 是 | 构造线截取为很长的线段 |
| 圆、圆弧、椭圆 | 是 | 任意缩放下保持平滑 |
| 多段线（二维/三维） | 是 | 支持凸度和全局宽度；网格按顶点连线显示 |
| 样条曲线 | 是 | 按控制点计算 NURBS，或按拟合点生成平滑曲线 |
| 单行文字、属性 | 是 | 对齐方式、宽度因子、倾斜角、镜像。本机有 SHX 时按单线字绘制；没有时用软件自带的 Noto Sans SC |
| 多行文字 | 是 | 段落、自动换行、堆叠分数；行内字体/颜色变化忽略 |
| 图块（含阵列） | 是 | 最多 16 层嵌套 |
| 标注 | 是 | 按标注自带的图块绘制 |
| 填充 | 是 | 实心、图案、孤岛；过密的图案用淡色填充代替 |
| 二维填充、宽线、三维面、点、引线 | 是 | |
| 布局视口 | 是 | 支持视图目标点、扭转角、比例、非矩形裁剪和视口冻结图层 |
| 表格 | 是 | 按其匿名图块绘制 |
| OLE 对象（嵌入的 Excel 等） | 是 | 按图纸里保存的 WMF 预览显示；嵌入的工作簿可另存为 .xlsx |
| 光栅图片 | 只画外框 | 图片本身是外部文件 |
| 遮罩 | 否 | |
| 面域、三维实体 | 否 | |
| 多重引线 | 否 | |
| 代理/自定义对象（如天正） | 否 | 请先导出为普通图元（T3） |
| 天正标注类对象（单行/多行文字、标高、轴号、图名、门窗编号、引出标注、索引符号、箭头引注、表格、尺寸） | 是（DWG 2000–2004） | 从对象数据里读出；暂不写入导出的 DXF/DWG。墙、柱、楼梯、楼板：否 |
| 外部参照 | 是 | 按记录的路径或与图纸同目录查找；只显示，不能捕捉 |

### 测试过的图纸（0.1.4）

| 图纸 | 格式 | 结果 |
| --- | --- | --- |
| `docs/samples/pump-room.dxf`、`pump-room-rev-b.dxf` | DXF R12，UTF-8 | 142 个图元全部显示；`test/` 中有单元测试 |
| 一张市政管线大样图（含委托方信息，不公开） | DWG，AutoCAD 2007（AC1021），380 KB，15,586 个图元 | 正常打开，所有图元类型均显示；测量、对比、导出人工核对 |
| 生成的 GBK 编码 DXF 片段 | DXF 2000，ANSI_936 | 文字解码正确（单元测试） |
| 三张市政排水图纸（含委托方信息，不公开） | DWG，AutoCAD 2004 与 2007；3.0 MB / 38,204 个图元、4.0 MB / 167,007 个图元、22.7 MB / 428,512 个图元 | 含 10–20 个旋转、异形裁剪视口的布局与 AutoCAD 一致；7 张和 13 张嵌入 Excel 表格正常显示并可另存 .xlsx |

上面那张 380 KB 的 DWG，在 Linux 云端容器的无界面 Chromium 中打开约需 1 秒（DWG 转 DXF 加场景构建，用 `performance.now()` 计时）。同样环境（2 个 CPU 核）下，三张排水图纸分别用了 3.7 秒、5.5 秒和 19.6 秒。你电脑上的速度会不同。
