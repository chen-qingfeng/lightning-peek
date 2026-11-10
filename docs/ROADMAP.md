# 功能规划与版本路线 · Roadmap

[English summary](#english-summary)

状态标记：`✅` 已实现（在当前版本中可用）· `🚧` 部分实现 · `📋` 规划中

状态依据已发布的 v0.2.8 预览版（GitHub prerelease，安装包 LightningPeek-0.2.8-setup-x64.exe）。仓库 package.json 为 0.2.9，尚未发布。v0.1.4 当时已勾选的项这里保持原样；新勾选的只记发布说明和 CHANGELOG 里写明的内容。规划项的顺序不代表承诺的发布时间。

## 产品边界

闪电看图只做两件事：**把 DWG/DXF 打开得快，把图纸里的东西查得清楚**。打开图纸的人，大多不是为了画图，而是为了看、查、统计、核对。

| 不做 | 原因 |
| --- | --- |
| PDF、图片（JPG / PNG 等） | 只为 DWG/DXF 优化，不为兼容更多格式增加体积 |
| CAD 绘图与编辑 | 定位是查看器，不与 AutoCAD 竞争 |
| 重型 BIM / 三维建模 | 坚持二维轻量路线 |
| 精确算量 / 替代专业造价软件 | 定位是快速粗核量，不替代广联达、斯维尔等专业软件 |
| 修改原始图纸文件 | 全程只读；改文字只另存为新的 DXF |

与同系列项目「迅速看图」的分工：闪电看图负责轻量打开、粗提量、图纸核查和（规划中的）自然语言查询；迅速看图负责精细建模、精确算量、对接 CASS 与土方等专业提量方向。

## 要解决的问题

| 痛点 | 现状 | 闪电看图 v0.2.8 |
| --- | --- | --- |
| CAD 打开慢、卡顿 | 大图纸、外部参照多、垃圾块多，低配电脑卡死 | ✅ 不需要安装 CAD；图纸在后台线程解析，界面不卡死。外部参照自动加载显示 |
| 图层混乱 | 命名不规范、中文乱码，构件归属分不清 | ✅ 图层开关、搜索、隔离；🚧 按代码页解码中文；📋 图层语义归类 |
| 文字炸碎 | 单行文字成堆、注释重叠 | ✅ 全文查找与定位；📋 炸碎文字聚合 |
| 构件找不到 | 管线、检查井、基础、预埋件密集 | ✅ 文字查找、图块数量统计并框出位置；📋 按规格编号检索 |
| 手动提量低效易错 | 长度、面积、个数靠框选 | ✅ 长度、框选总长、点选面积、图块计数，导出 Excel |
| 版本混乱 | 新旧图对比靠肉眼 | ✅ 图纸对比：新增 / 删除 / 文字修改，叠加、并排、卷帘查看，导出清单 |
| 信息缺失 | 块无属性、标高缺失、管径漏标 | 📋 图纸校核 |
| 非专业人员看不懂 | 资料员、甲方、班组只想看结果 | ✅ 当前发布的是 Windows 安装版（LightningPeek-0.2.8-setup-x64.exe），测量结果汇总为 Excel |

## 一、查看与检索

- ✅ DWG / DXF 打开，平移缩放（Canvas 2D 渲染，图纸在后台线程解析）
- 📋 WebGL 渲染，用于超大图纸
- ✅ 图层列表：显示 / 隐藏 / 隔离 / 按名称搜索
- ✅ 图块识别与按名称计数；属性文字随图块显示
- 📋 图块属性值提取为表格
- ✅ 文字（含标注文字）全文检索，结果定位跳转，可限定框选范围，可导出
- 📋 按标注类型（尺寸、标高、管径）分类提取
- 🚧 构件检索定位：已支持按文字和图块名；📋 按规格、编号结构化检索
- 📋 桩号、坐标检索定位
- 📋 按图框 / 图号分区浏览与统计
- 🚧 中文编码：已按 `$DWGCODEPAGE` 解码 GBK / Big5 / Shift_JIS / EUC-KR / Windows-125x；📋 无声明时的编码嗅探与乱码修复
- ✅ 本机字体查找与替代（v0.2.3–v0.2.8）：自动找 SHX 并互相替代，含 MONOTXT、IDQSTYLE；多行文字按图纸栏宽排开。细则见版本路线
- 📋 炸碎文字聚合（相邻同高文字合并为整句）

## 二、工程量提取

- ✅ 线性长度：单段、连续、框选范围内线条总长（圆弧按解析长度）
- ✅ 闭合面积：点选封闭图形或填充（扣除孤岛）、手动多边形、面积偏移
- ✅ 构件计数：按图块名统计
- ✅ 导出 Excel（测量明细、分类汇总、图块清单）
- ✅ 测量结果按自定义分类汇总；长度 × 高度计算展开面积
- 📋 图层语义归类后按类别汇总（如管线分档 DN300 / DN400）
- 📋 自动剔除辅助线、构造线
- 📋 统计口径可编辑：手动调整图层归属与构件类别
- 📋 批量目录解析：整个文件夹批量解析并汇总

## 三、图纸校核

- ✅ 新旧两版图纸对比：新增 / 删除 / 文字修改，相同之处与不同之处计数，导出变更清单
- 📋 对比中单独识别尺寸修改与移位（目前表现为一处删除加一处新增）
- 📋 标注冲突：同一位置出现两个不一致的尺寸
- 📋 缺失标注：画了构件却没有规格 / 标高
- 📋 标高矛盾：相邻标高对不上
- 📋 文字重叠与乱码提示

## 四、AI 辅助（全部为规划）

> 很多所谓「AI 功能」在实现上是确定性的几何算法与规则引擎，可以纯本地运行、不联网。只有自然语言问答与语义推理才需要调用模型，并且不会阻塞打开图纸。调用模型前会明确告知用户数据去向，默认关闭。

- 📋 图层语义归类：把 `0`、`DEFPOINTS`、拼音乱名等图层自动分组为墙体、轴线、给排水、电气、标注、文字、块、杂线，一键「只看管线」「只看结构构件」
- 📋 构件语义识别：纯线条画出的检查井、雨水口、基础、路灯按图形特征判定
- 📋 自然语言图纸问答：「统计所有 DN200 污水管总长」「找出所有标高低于 980 的井」，返回结果并定位
- 📋 构件属性推理补全（未标坡度、埋深时给出参考值，标明「AI 推测值」）
- 📋 管线交叉点清单（只列位置，不判定碰撞）

## 版本路线

### v0.1.x — MVP：开得快、提得出

| 目标 | 状态 |
| --- | --- |
| DWG / DXF 打开 | ✅ |
| 图层显隐 / 隔离 / 搜索 | ✅（隔离在 0.1.1 加入） |
| 块计数、线性长度、闭合面积 | ✅ |
| 文字与标注检索定位 | ✅ |
| 导出表格 | ✅ Excel（规划中的 CSV 由 Excel 导出覆盖） |
| 免责提示 | ✅（0.1.1 加入：测量面板与导出的 Excel） |
| Windows 安装程序 | ✅ v0.1.4 的预发布里已有 LightningPeek-0.1.4-setup-x64.exe（同页还有绿色版）。自 v0.1.5 起，已发布附件是 LightningPeek-x.y.z-setup-x64.exe。CHANGELOG 把安装程序记在 0.1.3 |
| 首帧性能达标 | 📋 需要先定义指标并在 Windows 真机上测量 |

**技术难点**：原规划文档的这一节内容缺失，待补。

### v0.1.5 – v0.2.2 — 已发布的预览版

这些版本都是 GitHub prerelease，附件为 LightningPeek-x.y.z-setup-x64.exe。GitHub 上没有 v0.1.6 这个预发布；手机查看写在 v0.1.7 的发布说明里。

| 版本 | 已发布的内容 |
| --- | --- |
| v0.1.5 | 鼠标移动不再整图重画；点选走空间索引；圆按圆心和半径存储；关闭图纸时释放外部参照；导出图片有像素上限 |
| v0.1.7 | 安装包自带中文字体（Noto Sans SC）。帮助里可以选本机 SHX / TrueType 文件夹。发布说明写明保留手机浏览器查看（同一 Wi-Fi，单指移动、双指缩放） |
| v0.1.8 | AutoCAD 2000–2004 的天正标注类对象按对象数据显示（文字、标高、轴号、图名、门窗编号、引出、索引、箭头、表格、尺寸）。墙、柱、楼梯、扶手、楼板仍不显示。钢筋符号 %%130–%%133 在没有专用 SHX 时按等级画出。2007 以前的长中文多行文字不再从中间变成乱码 |
| v0.1.9 | 每打开一张图就重新加载 DWG 转换器，避免下一张报 memory access out of bounds。发布说明仍写明：2007 及更新的天正原图只计数、不解码 |
| v0.1.10 | ^M^J 坐标标注分成两行，不再把 ^M 画出来；选了字体文件夹时单线字改用细线 |
| v0.2.0 – v0.2.2 | 坐标标注两行共用字号，行距按一个字高。底部重新显示「模型」和「布局」。默认的 Layout1、Layout2 显示成布局1、布局2，图纸里自定的布局名保持原样 |

### v0.2.3 – v0.2.8 — 已发布的预览版：字体与栏宽

当前已发布版本是 v0.2.8 预览版，安装包 LightningPeek-0.2.8-setup-x64.exe。v0.2.3、v0.2.4、v0.2.5、v0.2.7、v0.2.8 都是 GitHub prerelease。没有 v0.2.6 的预发布；多行说明的栏宽写在 CHANGELOG 的 0.2.6，并包含在 v0.2.7 的发布说明里。

| 目标 | 状态 |
| --- | --- |
| 打开时在本机查找字体，不必先选文件夹 | ✅ v0.2.3。顺序：图纸里写的字体名，选过的文件夹，复制进来的字体，AutoCAD、中望、浩辰的 Fonts 目录，Windows 字体目录。hztxt.shx 与 gbcbig.shx 互相替代；simplex.shx、txt.shx、complex.shx 互相替代；simsun.ttf 可改用 simsun.ttc。钢筋字体 tssdeng、yjkeng 不用普通大字体顶替。都找不到时用软件自带的中文。SHX 不打进安装包，帮助里选字体文件夹仍可用 |
| MONOTXT、IDQSTYLE | ✅ v0.2.4、v0.2.5。gbenor.shx、monotxt.shx 找不到时用 simplex.shx、txt.shx 或 complex.shx；hzfs.shx 用 hztxt.shx 或 gbcbig.shx。其它叫不上名字的 SHX 也按这套找。一行里还有汉字画不出时，整行改用自带中文。单线字笔画比字高小很多时，整行同样改用自带中文，格子里不再只剩一个点 |
| 多行文字按图纸栏宽排开 | ✅ v0.2.7。多行说明和表格格子停在文字框里，不压到旁边一栏。原来的单线字改用自带字体时，单行标注也按原来的行宽画 |
| 天正、国标字体按名字替代 | ✅ v0.2.8。gbhzfs.shx 按汉字大字体找（hztxt.shx、gbcbig.shx），gbxwxt.shx、superos.shx 按西文找。有 simplex.shx 时不再拿它去顶汉字大字体。缺的字仍用自带中文 |
| AutoCAD 2007 说明文字从两段中间切开 | ✅ v0.2.8 把汉字接回去 |
| AutoCAD 2007 天正自定义对象（坐标、引出、图名） | v0.2.8 的发布说明写明这一版仍然读不出来。仓库里的 0.2.9 尚未发布；CHANGELOG 有对应记录，不能当作已发布功能 |

### 之后

Windows 安装程序已随预览版发布（LightningPeek-x.y.z-setup-x64.exe）。仍在其后：代码签名、macOS / Linux 安装包、线宽显示、更多 DWG 版本的兼容性测试，以及上面的「图纸校核」和「AI 辅助」。

---

## English summary

Lightning Peek does two things: open DWG/DXF drawings quickly and make what is in them easy to find and check. It is not a CAD editor, a BIM or 3D tool, a replacement for professional quantity take-off software, and it never modifies the original drawing.

The current published prerelease is v0.2.8. Its installer is LightningPeek-0.2.8-setup-x64.exe. package.json in the repository is 0.2.9, and that version has no GitHub release. There is no v0.2.6 prerelease.

Available since v0.1.4 and still in v0.2.8: opening DWG/DXF, layer on/off/search/isolate, block counts, lengths, areas (including picked areas with islands), text search with location, Excel export, a measurement disclaimer, and two-drawing comparison.

Shipped after v0.1.4 and in the v0.2.8 prerelease: the Windows setup installer LightningPeek-x.y.z-setup-x64.exe; automatic SHX and font lookup and substitution, including MONOTXT and IDQSTYLE; multiline text kept inside the column width set on the drawing. The v0.1.5–v0.2.2 prereleases also shipped a bundled Chinese font (Noto Sans SC), an optional local font folder, phone viewing in a browser, TArch annotations on AutoCAD 2000–2004 drawings, steel-bar grade marks, coordinate labels split on ^M^J and ^J, and model/layout tabs (Layout1 shown as 布局1). v0.2.8 still does not read Tianzheng's own coordinate, leader and drawing-name objects in AutoCAD 2007 files. CHANGELOG records that under 0.2.9, which is not released.

Planned: WebGL rendering for very large drawings, attribute extraction, structured search by specification, text re-assembly, layer classification, drawing checks (conflicting or missing dimensions, elevation conflicts), and optional AI assistance (natural-language questions, component recognition). AI features will be off by default and will state clearly where data goes.
