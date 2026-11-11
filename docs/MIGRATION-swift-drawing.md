# swift-drawing → 闪电看图：图元对照（阶段 A）

swift-drawing（产品名「快看图」）是闪电看图（Lightning Peek，产品名「闪电看图」）的私有前身，用 React + TypeScript，图纸模型是 `CadEntity`。所有者已同意把其中有用的算法和测试迁入本仓库，并按本仓库的 **GPL-3.0-or-later** 发布。

本文件只做对照，方便后续阶段接算法。实现以 `app/renderer/core/engine.js` 为准。闪电看图是普通 JavaScript，没有 TypeScript 构建，也不要为了迁代码去改实体的存储方式。

阶段 A 迁入的是文字编码修复（`app/renderer/core/textRepair.js`）和这份对照。五段对比、图框/图签识别、批量 PDF 不在本阶段。

## 两边各存什么

swift-drawing 把每个图元收成一条 `CadEntity`：有 `id`、`kind`、原始 DXF 类型 `type`、图层、颜色、包围盒，以及按类型挂上的 `poly` / `circle` / `arc` / `text` / `hatch` / `point`。块参照在展开时写进 `blockPath`。

闪电看图不保留「一个图元一条记录」。`buildScene` 的结果是按空间（模型、各布局）分的场景：

| 场景字段 | 含义 |
| --- | --- |
| `spaces[].batches` | 按图层、颜色、线型、线宽合批的笔画。`ops` 为 `Float64Array`，指令见 `OP`：`M` 移动、`L` 直线、`A` 圆弧、`E` 椭圆、`Z` 闭合 |
| `spaces[].fills` | 实心填充与退化为淡色的图案填充 |
| `spaces[].texts` | 单行文字、多行文字、属性文字，一条可视行一个对象 |
| `spaces[].inserts` | 展开后的图块实例：`{ n, d, b, l }` 名字、嵌套深度、包围盒、图层序号 |
| `spaces[].regions` | 可点选的闭合区域（多段线环或 `circ` 圆） |
| `spaces[].curves` | 每 6 个数一组：长度、包围盒四值、图层序号。类型在平行的 `cinfo` 里（`CURVE_KIND`） |
| `spaces[].bbox` / `view` | `[minX, minY, maxX, maxY]`，模型空间是局部坐标 |
| `spaces[].origin` | 模型空间局部坐标相对世界坐标的原点；图纸空间为 `[0, 0]` |
| `layers` | `{ name, color, on }` |
| `stats` | `{ entities, skipped, brokenText }` |

模型空间的坐标是世界坐标减去 `origin`（以及场景顶层的 `origin`）。换回世界坐标：`x + origin[0]`，`y + origin[1]`。swift-drawing 的包围盒和插入点都是世界坐标。

颜色：swift-drawing 一律是 `0xRRGGBB`。闪电看图真彩色同样是 `0xRRGGBB`；随图层的白/黑（ACI 7）记为 `FG = -7`，绘制时再按背景取色。

## 对照表

| 内容 | swift-drawing `CadEntity` | 闪电看图 `engine.js` | 缺口与注意 |
| --- | --- | --- | --- |
| 点 | `kind: 'point'`，`point: {x, y}`，包围盒是插入点外扩一小段 | `POINT` 画成极短的 `M`+`L`，捕捉类型 5（`snap` 数组里每 4 个数的第 3 个）。没有单独的点对象 | 后续算法不要找 `kind === 'point'`。用捕捉类型 5，或批次里长度近 0 的线段 |
| 直线 | `kind: 'line'`，`poly` 两个点，`length` | `LINE` → 一批 `M`/`L`。长度在 `curves`（`CURVE_KIND.line`）。端点、中点在 `snaps` | 合批后没有「这一条直线」的 id。对比用的 `SigSink` 才会按路径拆开 |
| 多段线（含凸度、闭合） | `kind: 'polyline'`，`poly` 已按凸度折线化，`closed`，闭合时有 `area`，另有 `length`。原始凸度不保留 | `LWPOLYLINE` / `POLYLINE`。顶点在解析时是 `[x, y, bulge]`（组码 42）。`polyOps` 展开凸度：逆时针且变换为相似变换时保留 `OP.A` 弧，顺时针离散成折线。闭合看组码 70 的位 0，指令以 `OP.Z` 结束，闭合且至少 3 点时写入 `regions`。线长用 `polyLength`（凸度按弧长，不是弦长） | 场景里没有 bulge 数组。后一阶段若要比较「同一条带弧多段线」，应认 `OP.A` 或离散点，不要假设两边折线点数相同。网格/多面网格只连顶点 |
| 圆 | `kind: 'circle'`，`circle: {c, r}`，另有折线 `poly`、面积、周长 | `CIRCLE` 用一条整圆 `OP.A`（`a0` 到 `a0+2π`）。圆心半径在 `circles`（`cx, cy, r`）和 `regions[].circ`。周长在 `curves`（`CURVE_KIND.circle`） | 不存 72 边近似多边形。点选面积用 `circ`。半径已乘插入缩放 |
| 圆弧 | `kind: 'arc'`，`arc: {c, r, a0, a1}`，角度为弧度 | `ARC` 的组码 50/51 是**度**，写入 `OP.A` 前换成弧度。`OP.A` 的布局是 `cx, cy, r, a0, a1, ccw`。捕捉有圆心、两端、中点 | `circles[]` 只存圆心半径，不存起止角。要起止角得读 `OP.A`。镜像后 `ccw` 会反过来 |
| 椭圆、样条 | `kind: 'ellipse'` / `'spline'`，几何折进 `poly` | `ELLIPSE`、`SPLINE` 离散成 `M`/`L`。样条优先用控制点做 NURBS，否则用拟合点的 Catmull-Rom。`OP.E` 已定义，当前椭圆路径没有走它 | 没有圆心、长短轴、控制点可回读。对比只能比离散折线 |
| 单行文字 / 多行文字 | `kind: 'text'` 或 `'mtext'`，`text: { p, text, h, rot, align }`。`align` 为 `left` / `center` / `right`。内容已去掉 MTEXT 格式码并做过编码修复 | `texts[]` 的一条：`s` 显示与搜索用的字符串，`x, y` 对齐后的锚点（局部坐标），`h` 字高，`ux, uy` 基线方向，`vx, vy` 字高方向，`ha` 水平对齐（0 左、1 中、2 右），`va` 垂直对齐（0 基线、1 底、2 中、3 顶），`layer`、`color`。多行文字 `mt = 1`，按行拆开，`li` / `ln` 是行号，第一行带 `para`（整段）。旋转角是 `atan2(uy, ux)`，不是单独的 `rot`。插入缩放体现在向量长度上，世界字高约 `h * hypot(vx, vy)` | 没有 `text` 子对象，也没有单独的 mtext 种类，看 `mt`。锚点经过对齐（居中、右齐、布满），不一定等于组码 10。`sr` 留给 SHX 的原始码，`sg` 是钢筋符号的绘制形，搜索和界面都看 `s`。阶段 A 的编码修复写在 `cleanText` → `texts[].s` |
| 图层 | `CadLayer`：`name`、`color`、`visible`、`frozen`、`count` | `layers[]`：`name`、`color`、`on`。关闭（组码 62 为负）和冻结（组码 70 位 0）合成一个 `on`。没有个数 | 要统计个数得自己扫 `texts`、`batches`、`inserts`。块内图层 0 会换成插入所在图层（`resolveStyle`） |
| 块 / 插入 | `INSERT` 展开成子实体，`blockPath` 为 `块/嵌套块`。阵列、缩放、旋转写进变换。深度上限 12 | 同样展开（深度上限 16，阵列最多 4096 个）。实例记在 `inserts`：`n` 块名，`d` 深度，`b` 为 `[minX, minY, maxX, maxY]`，`l` 是图层序号（名字在 `curveLayers[l]`）。`*U` 匿名块按内容归成 `*ANON<序号>`。外部参照不展开，在 `xrefs[]`（`name`、`path`、`M`、`layer`）。属性文字走 `texts`，并带 `blk = 1`。`ATTDEF` 不显示。标注展开其匿名块，不单列 | **子实体没有 `blockPath`**。只知道「这个字来自某个块」（`blk`）以及插入点上的块名和包围盒。动态块不能靠块名区分，要看 `*ANON` |
| 包围盒 | `bbox: { minX, minY, maxX, maxY }`，世界坐标，每个图元都有 | 数组 `[minX, minY, maxX, maxY]`，局部坐标。场景有 `bbox`，每个笔画批次有 `bb`，每个图块实例有 `b`。文字没有预存包围盒，拾取时用锚点、字高和行宽现算 | 换算世界坐标要加 `origin`。文字框不要照搬 swift-drawing 的 `rotatedTextBox`，闪电看图的锚点和宽度因子已经含在 `texts[]` 里 |

填充（`HATCH`）、二维填充（`SOLID` / `TRACE`）在闪电看图里进 `fills` 和 `regions`（`hatch: 1`），没有 swift-drawing 的 `hatch.loops` 可回读。图案过密时改成淡色填充，边界仍在。

## 阶段 A：文字修复接在哪里

显示、搜索、悬停、导出用的字符串都来自 `texts[].s`。产生它的地方是 `cleanText`（`TEXT` / `ATTRIB` 直接调用，`MTEXT` 经 `mtextLines` 去掉格式码后再用）：

1. `unescapeDxfText`：`\U+XXXX`、`\u+XXXX`、`\M+nXXXX`。
2. `repairMojibake`：仅当**这份文件不是按声明的旧代码页解码**时，才把 Latin-1/CP1252 形态的 GBK 字节用 GB18030（其次 GBK、Big5）重解。
3. 原有的 `%%c` / `%%d` / `%%p`、钢筋符号和 `^M^J` 仍留在 `cleanText` 里，顺序在重解之后，避免把 `%%132` 变成的控制字节再拿去当 GBK。

代码页守卫：

- `decodeDxf` 只有在文件头写了非 UTF 的 `$DWGCODEPAGE`、并且字节确实按那个代码页解开时，才返回 `codepageDeclared: true`。
- `worker.js` 把这个标志传给每一次 `buildScene`。这样「文件是合法 UTF-8，但文件头仍写着 ANSI_936、正文却是 ÖÐÎÄ」的图会修复；「文件头 ANSI_936、字节按 GBK 解开已经是『泵房』」的图不会再被改一次。
- 直接对 DXF 文本调用 `buildScene(parseDxf(...))` 且没有传标志时，退回看文件头：有非 UTF 的 `$DWGCODEPAGE` 就不重解。

丢字不改内容。`looksBrokenText` 认出连续两个及以上的 `◇`（U+25C7）或 U+FFFD，累加到 `scene.stats.brokenText`。状态栏追加「文字可能损坏」，查找面板顶部有一句说明，不打断打开。

重解必须「明显更好」才替换：原文已有汉字则不动；高位字符少于两个，或只是词中间的单个重音（`café`、`München`）则不动；重解结果要出现汉字、长度不增加、得分高于原文，并且汉字大多落在 GB2312 一级字里。因此 `résumé`、`Ångström`、一串 `àáâã…` 保持原样。

## 后续阶段怎么接

### 五段对比

现在的对比在 `worker.js`：`SigSink` 给每条路径、填充、文字做一个签名，对齐用只出现一次的文字投票平移，文字修改靠位置接近配对。它不认识 `CadEntity`。

后续若做五段（例如对齐、完全相同、文字相同、几何容差、剩余增删），应直接读场景，不要先仿造一套 `CadEntity`：

- 坐标先换成同一原点。模型空间用 `origin`，现有 `autoAlign` 的平移要继续加在原点上。
- 线条比 `batches[].ops` 或 `SigSink.items`（`k: 'line'`）。带凸度的段可能是一条 `OP.A`，也可能是一串 `OP.L`，容差段不能要求顶点个数一致。
- 文字比 `texts[].s`（已经修过编码）、锚点、`h` 和 `atan2(uy, ux)`。多行文字一行一条，整段在 `para`；不要把每一行当成 swift-drawing 的一条 `mtext`。
- 填充比 `fills` / `regions`。图案填充退化为淡色时，边界还在，图案线可能没有。
- 没有稳定 `id`，也没有 `blockPath`。块内图元只能通过 `inserts` 的名字、深度和包围盒，加上文字上的 `blk === 1` 来归组，归不全。`*ANON` 才是动态块的「同一种」。

### 图框 / 图签

swift-drawing 可以沿 `blockPath` 找出图签块。这里块已经拆开：

- 图框优先用 `regions` 里的大矩形环，或闭合多段线的 `curves`（`CURVE_KIND.pline`）。
- 图签文字在 `texts[]` 里搜「图号」「图名」「比例」等，定位用 `x, y` 加 `origin`。
- 若图签是具名图块，`inserts` 里还有块名和包围盒 `b`，子文字没有块名。图层 0 上的字会显示成插入图层。
- 不要依赖 `CadLayer.count` 或 `frozen` 单独字段；可见性看 `layers[].on` 和界面里的 `layerOn`。

### 批量 PDF

按 `spaces` 逐个布局出图，范围用 `view`（已去掉离群坐标）或 `bbox`。图纸空间还有 `viewports`（中心、宽高、扭转、裁剪）。文字用 `texts[].s`，此时乱码修复已经做过，PDF 里应是修好的中文，而不是再解一遍。`stats.brokenText > 0` 时可以在导出说明里带一句丢字提示，不要挡住导出。本仓库现有的单张导出在界面里，批量任务应复用场景，不要假设 `CadDocument.warnings`。

## 本阶段故意不动的部分

`engine.js` 的合批、对比签名、测量都不改结构。`fixMojibake`（布局名「甯冨眬」这种 UTF-8 被当成 GBK）仍只用于布局名，与本次的 Latin-1/GBK 方向相反，不要合并成一个函数。
