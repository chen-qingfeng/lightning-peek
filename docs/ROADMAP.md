# 功能规划与版本路线 · Roadmap

[English summary](#english-summary)

状态标记：`✅` 已实现（在当前版本中可用）· `🚧` 部分实现 · `📋` 规划中

状态依据 v0.1.3 的源代码核定。规划项的顺序不代表承诺的发布时间。

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

| 痛点 | 现状 | 闪电看图 v0.1.3 |
| --- | --- | --- |
| CAD 打开慢、卡顿 | 大图纸、外部参照多、垃圾块多，低配电脑卡死 | ✅ 不需要安装 CAD；图纸在后台线程解析，界面不卡死。外部参照自动加载显示 |
| 图层混乱 | 命名不规范、中文乱码，构件归属分不清 | ✅ 图层开关、搜索、隔离；🚧 按代码页解码中文；📋 图层语义归类 |
| 文字炸碎 | 单行文字成堆、注释重叠 | ✅ 全文查找与定位；📋 炸碎文字聚合 |
| 构件找不到 | 管线、检查井、基础、预埋件密集 | ✅ 文字查找、图块数量统计并框出位置；📋 按规格编号检索 |
| 手动提量低效易错 | 长度、面积、个数靠框选 | ✅ 长度、框选总长、点选面积、图块计数，导出 Excel |
| 版本混乱 | 新旧图对比靠肉眼 | ✅ 图纸对比：新增 / 删除 / 文字修改，叠加、并排、卷帘查看，导出清单 |
| 信息缺失 | 块无属性、标高缺失、管径漏标 | 📋 图纸校核 |
| 非专业人员看不懂 | 资料员、甲方、班组只想看结果 | ✅ 免安装绿色版，测量结果汇总为 Excel |

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
| 首帧性能达标 | 📋 需要先定义指标并在 Windows 真机上测量 |

**技术难点**：原规划文档的这一节内容缺失，待补。

### 之后

安装程序与代码签名、macOS / Linux 安装包、线宽显示、更多 DWG 版本的兼容性测试，以及上面的「图纸校核」和「AI 辅助」。

---

## English summary

Lightning Peek does two things: open DWG/DXF drawings quickly and make what is in them easy to find and check. It is not a CAD editor, a BIM or 3D tool, a replacement for professional quantity take-off software, and it never modifies the original drawing.

Available in v0.1.3: opening DWG/DXF, layer on/off/search/isolate, block counts, lengths, areas (including picked areas with islands), text search with location, Excel export, a measurement disclaimer, and two-drawing comparison.

Planned: WebGL rendering for very large drawings, attribute extraction, structured search by specification, text re-assembly, layer classification, drawing checks (conflicting or missing dimensions, elevation conflicts), and optional AI assistance (natural-language questions, component recognition). AI features will be off by default and will state clearly where data goes.
