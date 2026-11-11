// 闪电看图 · 主界面
import { Renderer, mapply, mmul, minv, css } from './core/render.js';
import { makeXlsx } from './core/xlsx.js';
import { encodeLegacy } from './core/engine.js';
import { installFont } from './core/shx.js';
import { t as tr, LANG, setLang } from './core/i18n.js';
import { guessUnit, chainage, arc3, flattenArcs, footOn, linOrient, polyArea, offsetPoly, alongPts } from './core/measure.js';

// ---------------- 桥接（Electron / 浏览器兜底） ----------------
const B = window.sdkt || browserBridge();
// 安卓验证壳在 app.js 之前设置 window.__peek。桌面版没有这个对象，调用是空的。
function peek(ev, data) {
  const h = window.__peek;
  if (h && h.on) { try { h.on(ev, data); } catch (e) { /* 验证面板不影响开图 */ } }
}
function browserBridge() {
  const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  return {
    browser: true,
    getSettings: async () => ls('sdkt.settings', {}),
    setSettings: async (s) => { try { localStorage.setItem('sdkt.settings', JSON.stringify(s)); } catch (e) { /* ignore */ } },
    readText: async (p) => ls('sdkt.side.' + p, null),
    writeText: async (p, t) => { try { localStorage.setItem('sdkt.side.' + p, JSON.stringify(t)); } catch (e) { /* ignore */ } },
    saveBytes: async (name, bytes) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes])); a.download = name; a.click(); return name; },
    exportPdf: async () => null, printImage: async (o) => { const w = window.open(''); w.document.write(`<img src="${o.dataUrl}" style="width:100%">`); w.print(); },
    onOpenFile: () => { }, version: 'web',
  };
}

// ---------------- 状态 ----------------
const $ = (s) => document.querySelector(s);
const sCv = $('#cv'), oCv = $('#ov');
let cv = sCv;
let sctx = sCv.getContext('2d', { alpha: false });
let octx = oCv.getContext('2d');
let ctx = sctx;
let painted = null;
let chromeTimer = 0;
const R = new Renderer();
R.ttf = new Map();
const state = { docs: [], cur: null, tool: null, snap: true, ortho: false, settings: { recent: [] }, side: null, mouse: null, hover: null, tmp: [], tmpArc: new Set(), batchSel: [], dirty: false, flash: null, hideMarks: false };
let worker = null, rpcId = 1; const pending = new Map();
let DPR = window.devicePixelRatio || 1;

function startWorker() {
  const url = new URL('./core/worker.js', import.meta.url);
  if (window.__peek && window.__peek.dedicatedWasm) url.searchParams.set('dedicated', '1');
  worker = new Worker(url, { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data; const p = pending.get(m.id);
    if (!p) return;
    if (m.progress) { busy(tr(m.progress)); return; }
    pending.delete(m.id);
    m.ok ? p.res(m) : p.rej(new Error(tr(m.error)));
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.rej(new Error(tr('解析线程出错：') + (e.message || ''))); pending.clear(); worker = null; };
}
function resetWorker() {
  if (worker) { try { worker.terminate(); } catch (e) { /* 忽略 */ } worker = null; }
  for (const p of pending.values()) p.rej(new Error('解析线程已重置'));
  pending.clear();
}
window.__peekResetWorker = resetWorker;
function rpc(msg, transfer) {
  if (!worker) startWorker();
  const id = msg.id || rpcId++; msg.id = id;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage(msg, transfer || []); });
}

// ---------------- 图标与工具栏 ----------------
const IC = {
  open: '<path d="M3 7.5V18a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-8l-2-2.5H4a1 1 0 0 0-1 1z"/><path class="acc" d="M13 11l-2 3h2.5l-1.5 3"/>',
  recent: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  extents: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect class="acc" x="8.5" y="8.5" width="7" height="7" rx="1"/>',
  zoomwin: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/><rect class="acc" x="7.8" y="8.3" width="5.4" height="4.4"/>',
  layers: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5"/><path class="acc" d="M3.5 16.2L12 20.7l8.5-4.5"/>',
  bg: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="#1f2733"/>',
  dist: '<path d="M3.5 16.5l13-13 4 4-13 13z"/><path class="acc" d="M7 13l1.6 1.6M9.5 10.5l1.6 1.6M12 8l1.6 1.6M14.5 5.5l1.6 1.6"/>',
  poly: '<path d="M3.5 18.5l5-8 5 4.5 7-10"/><circle class="acc" cx="8.5" cy="10.5" r="1.3"/><circle class="acc" cx="13.5" cy="15" r="1.3"/>',
  area: '<path d="M4 18l2-12 9-2 5 9-6 7z"/><path class="acc" d="M7 15l6-6M9 17l6-6M6.5 11.5l3.5-3.5"/>',
  areapick: '<path d="M3.5 17.5V6.5h10v11z"/><path class="acc" d="M13 12l7 2.5-3 1 2.5 3-1.5 1.2-2.5-3-1.5 2.8z"/>',
  angle: '<path d="M4 19h16M4 19L15 5"/><path class="acc" d="M10.5 19a6.5 6.5 0 0 0-2.4-5.1"/>',
  radius: '<circle cx="12" cy="12" r="8"/><path class="acc" d="M12 12l5.7-5.7"/><circle cx="12" cy="12" r="1"/>',
  coord: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5"/><circle class="acc" cx="12" cy="12" r="2.5"/>',
  scale: '<path d="M3 14h18v4H3z"/><path d="M6 14v2M9 14v2.6M12 14v2M15 14v2.6M18 14v2"/><path class="acc" d="M7 6h3v5M14 6.5a1.6 1.6 0 1 1 3 .8L14 11h3.2"/>',
  stats: '<rect x="4" y="3.5" width="16" height="17" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h5"/><path class="acc" d="M16 16h1"/>',
  text: '<path d="M5 6V4.5h14V6M12 4.5V19M9 19h6"/><path class="acc" d="M17 14l3 3-3 3"/>',
  cloud: '<path class="acc" d="M6 18a3 3 0 0 1-.5-6 4 4 0 0 1 7.6-2.4A3.3 3.3 0 0 1 19 12a3 3 0 0 1-1 6z"/>',
  arrow: '<path d="M4 20L18 6"/><path class="acc" d="M10 5h9v9"/>',
  rect: '<rect class="acc" x="4" y="6" width="16" height="12" rx="1"/>',
  erase: '<path d="M14.5 4.5l5 5-9 9H6l-2.5-2.5z"/><path class="acc" d="M9.5 9.5l5 5M12 19h8"/>',
  find: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/><path class="acc" d="M8 13l2.5-6 2.5 6M8.9 11h3.2"/>',
  compare: '<rect x="3.5" y="3.5" width="11" height="11" rx="1"/><rect class="acc" x="9.5" y="9.5" width="11" height="11" rx="1"/>',
  export: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path class="acc" d="M4.5 13v6a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-6"/>',
  print: '<path d="M7 8V3.5h10V8"/><rect x="3.5" y="8" width="17" height="8" rx="1.5"/><path class="acc" d="M7 13.5h10V20H7z"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.7"/><path class="acc" d="M12 16.8v.2"/>',
  undo: '<path d="M9 7L4.5 11.5 9 16"/><path class="acc" d="M5 11.5h9a5 5 0 0 1 0 10h-2"/>',
  boxlen: '<rect x="3.5" y="5.5" width="17" height="13" rx="1" stroke-dasharray="3 2"/><path class="acc" d="M7 15l4-6 3 4 3-5"/>',
  count: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><path class="acc" d="M15 17h5M17.5 14.5v5"/>',
  line: '<path class="acc" d="M4 19L20 5"/><circle cx="4" cy="19" r="1.5"/><circle cx="20" cy="5" r="1.5"/>',
  num: '<circle class="acc" cx="12" cy="12" r="8"/><path d="M10.5 9.5l2-1.5V16M10.5 16h4"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="1"/><path d="M3.5 9.5h17M3.5 14.5h17M10 4.5v15"/><path class="acc" d="M14 12h5"/>',
  lin: '<path d="M5 6v12M19 6v12"/><path class="acc" d="M5 9h14M7.5 7.5L5 9l2.5 1.5M16.5 7.5L19 9l-2.5 1.5"/>',
  p2l: '<path d="M3 19L21 9"/><circle class="acc" cx="9" cy="5" r="1.6"/><path class="acc" d="M9 6.6l2.2 7.8"/>',
  arclen: '<path class="acc" d="M4 18a9 9 0 0 1 16 0"/><circle cx="4" cy="18" r="1.4"/><circle cx="20" cy="18" r="1.4"/>',
  seglen: '<path d="M3 17l6-8 6 6 6-9"/><path class="acc" d="M9 9v.01M15 15v.01M3 17v.01M21 6v.01" stroke-width="3"/>',
  batch: '<path d="M3 7h9M3 12h14M3 17h7"/><path class="acc" d="M15 15l2 2 4-4"/>',
  stake: '<path d="M3 17h18"/><path class="acc" d="M5 14v6M10 14v6M15 14v6M20 14v6"/><path d="M5 9h4"/>',
  rectarea: '<rect class="acc" x="4" y="6" width="16" height="12" rx="1"/><path d="M4 6l16 12" stroke-dasharray="2 2"/>',
  side: '<path d="M4 16l6-3 10 3"/><path class="acc" d="M4 16V8l6-3 10 3v8"/>',
  circle: '<circle class="acc" cx="12" cy="12" r="8"/><path d="M4 12h16"/>',
  shapes: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect class="acc" x="13.5" y="13.5" width="7" height="7" rx="1"/><path d="M13 7h5v4M11 17H6v-4"/>',
  markset: '<path d="M4 20l4-1 10-10-3-3L5 16z"/><path class="acc" d="M14 7l3 3"/><circle cx="18.5" cy="18.5" r="2"/>',
  hidemarks: '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><path class="acc" d="M4 20L20 4"/>',
  redo: '<path d="M15 7l4.5 4.5L15 16"/><path class="acc" d="M19 11.5h-9a5 5 0 0 0 0 10h2"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path class="acc" d="M18 3v4h-4"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7L4 17h5z"/><path class="acc" d="M15 7l5 10h-5z"/>',
  xref: '<rect x="3.5" y="5.5" width="11" height="13" rx="1"/><path class="acc" d="M13 12h8M18 9l3 3-3 3"/>',
  lay2m: '<rect x="3.5" y="4.5" width="9" height="12" rx="1"/><rect class="acc" x="11.5" y="8.5" width="9" height="11" rx="1"/><path d="M8 8.5v4"/>',
  oles: '<rect x="3.5" y="4.5" width="17" height="15" rx="1"/><path d="M3.5 9.5h17M9 9.5v10"/><path class="acc" d="M13 13h5M13 16.5h4"/>',
  edittext: '<path d="M4 6V4.5h10V6M9 4.5V16M7 16h4"/><path class="acc" d="M13 20l1-3.5 6-6 2.5 2.5-6 6z"/>',
  clip: '<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path class="acc" d="M8.5 15.5L18 4M15.5 15.5L6 4"/>',
};
const TABS = [
  { name: tr('开始'), groups: [
    [['open', tr('打开'), 'Ctrl+O'], ['recent', tr('最近打开')]],
    [['extents', tr('全图'), 'Home'], ['zoomwin', tr('窗口缩放')], ['rotate', tr('屏幕旋转')], ['mirror', tr('镜像')], ['layers', tr('图层')], ['bg', tr('背景')]],
    [['find', tr('文字查找'), 'Ctrl+F'], ['compare', tr('图纸对比')]],
    [['export', tr('导出')], ['print', tr('打印'), 'Ctrl+P'], ['help', tr('帮助')]],
  ] },
  { name: tr('测量'), groups: [
    [['dist', tr('对齐')], ['lin', tr('线性')], ['poly', tr('连续')], ['p2l', tr('点到线')], ['arclen', tr('弧长')], ['seglen', tr('分段长度')], ['batch', tr('批量长度')], ['stake', tr('定距')]],
    [['area', tr('面积')], ['rectarea', tr('矩形面积')], ['areapick', tr('点选面积')], ['side', tr('侧面积')]],
    [['angle', tr('角度')], ['radius', tr('半径')], ['circle', tr('测量圆')], ['coord', tr('坐标')]],
    [['boxlen', tr('框选总长')], ['count', tr('数量统计')], ['shapes', tr('图形识别')]],
    [['scale', tr('比例')], ['markset', tr('标注设置')], ['hidemarks', tr('隐藏标注')], ['stats', tr('测量统计')], ['undo', tr('撤销'), 'Ctrl+Z'], ['redo', tr('恢复'), 'Ctrl+Y']],
  ] },
  { name: tr('批注'), groups: [
    [['text', tr('文字批注')], ['cloud', tr('云线')], ['arrow', tr('箭头')], ['rect', tr('矩形框')], ['line', tr('画线')], ['num', tr('编号')]],
    [['erase', tr('删除标记')], ['undo', tr('撤销'), 'Ctrl+Z'], ['stats', tr('测量统计')]],
  ] },
  { name: tr('工具'), groups: [
    [['table', tr('表格提取')], ['oles', tr('嵌入表格')], ['xref', tr('外部参照')], ['edittext', tr('改文字')], ['clip', tr('图纸分割')], ['lay2m', tr('布局转模型')]],
    [['compare', tr('图纸对比')], ['find', tr('文字查找')]],
    [['export', tr('导出')], ['print', tr('打印')]],
  ] },
];
const TOOLS = TABS.flatMap(t => t.groups);
state.tab = 0;
const FIXED_TYPES = new Set(['count', 'boxlen', 'arclen', 'seglen', 'batch', 'stake']);
const CURVE_TOOLS = new Set(['arclen', 'seglen', 'batch', 'stake', 'p2l']);
const MODAL_TOOLS = new Set(['lin', 'side', 'rectarea', 'arclen', 'seglen', 'batch', 'stake', 'p2l', 'circle', 'shapes', 'zoomwin', 'dist', 'poly', 'area', 'areapick', 'angle', 'radius', 'coord', 'text', 'cloud', 'arrow', 'rect', 'erase', 'calib', 'boxlen', 'count', 'line', 'num', 'table', 'edittext', 'clip', 'findbox']);
const RECT_TOOLS = new Set(['boxlen', 'table', 'clip', 'findbox', 'shapes']);
const PICK_TOOLS = new Set(['erase', 'radius', 'circle', 'areapick', 'count', 'edittext', 'arclen', 'seglen', 'batch', 'stake']);
const TOOL_HINT = {
  zoomwin: tr('拖出一个矩形区域放大'), dist: tr('点两点，再点一下放置尺寸线（右键直接完成）'), lin: tr('点两点，再移动鼠标定水平或竖直方向并放置尺寸线'),
  side: tr('依次点取路线，右键结束后输入高度，得到侧面积'), rectarea: tr('点矩形的两个对角点'), arclen: tr('单击圆弧、圆或任意曲线，得到长度'), seglen: tr('单击多段线，逐段标出长度'),
  batch: tr('逐条单击要统计的线（再点一次取消），右键或回车完成'), stake: tr('单击一条线，按固定间距标出桩号'), p2l: tr('先单击一条直线，再点一个点'), circle: tr('单击圆，得到半径、直径、周长和面积'),
  shapes: tr('框选一个样板图形，统计图上相同的图形'), poly: tr('依次点取，右键或回车结束'), area: tr('依次点取顶点，右键或回车结束；按 A 切换弧线段（点弧上一点再点终点）'), areapick: tr('在封闭图形或填充内单击，直接得到面积'),
  angle: tr('先点角的顶点，再点两条边上各一点'), radius: tr('把鼠标移到圆或圆弧上单击'), coord: tr('单击取点坐标'), text: tr('单击放置文字批注'), cloud: tr('点两个角点画云线'), arrow: tr('先点箭尾，再点箭头'), rect: tr('点两个角点画矩形框'), boxlen: tr('点两个角点框选，统计框内全部线条的总长'), count: tr('单击一个图块（图形），统计同名图块数量'), line: tr('点两点画辅助线'), num: tr('单击依次放置编号'), table: tr('点两个角点框住表格，文字按行列导出 Excel'), edittext: tr('单击图上的文字进行修改（另存 DXF 时写入）'), clip: tr('点两个角点框选要分割导出的区域'), findbox: tr('点两个角点限定查找范围'), erase: tr('单击要删除的测量或批注'), calib: tr('点取已知长度的两端'),
};
function tabOf(id) { const cur = TABS[state.tab]; if (cur.groups.some(g => g.some(x => x[0] === id))) return state.tab; return TABS.findIndex(t => t.groups.some(g => g.some(x => x[0] === id))); }
function buildToolbar() {
  const tb = $('#toolbar'); tb.innerHTML = '';
  const strip = h('div', { cls: 'tabs' });
  TABS.forEach((t, i) => strip.append(h('button', { cls: 'tabbtn' + (i === state.tab ? ' on' : ''), text: t.name, onclick: () => { state.tab = i; buildToolbar(); refreshToolbar(); } })));
  tb.append(strip);
  const row = h('div', { cls: 'tbrow' }); tb.append(row);
  for (const g of TABS[state.tab].groups) {
    const grp = document.createElement('div'); grp.className = 'grp';
    for (const [id, label, key] of g) {
      const b = document.createElement('button'); b.className = 'tb'; b.dataset.id = id;
      b.title = label + (key ? `（${key}）` : '');
      b.innerHTML = `<svg viewBox="0 0 24 24">${IC[id]}</svg><span>${label}</span>`;
      b.onclick = (e) => command(id, e);
      grp.appendChild(b);
    }
    row.appendChild(grp);
  }
}
function refreshToolbar() {
  const d = state.cur; const draw = d && d.kind === 'drawing';
  for (const b of document.querySelectorAll('.tb')) {
    const id = b.dataset.id;
    const needDoc = !['open', 'recent', 'help'].includes(id);
    const needDrawing = MODAL_TOOLS.has(id) || ['scale', 'stats', 'undo', 'redo', 'compare', 'oles', 'markset', 'hidemarks', 'xref', 'lay2m'].includes(id);
    b.disabled = (needDoc && !d) || (needDrawing && !draw);
    b.classList.toggle('on', !!(state.tool === id || (state.side && state.side === sideOf(id)) || (id === 'bg' && R.bg === 'white') || (id === 'hidemarks' && state.hideMarks) || (id === 'mirror' && d && d.mir)));
  }
}
function sideOf(id) { return { layers: 'layers', stats: 'stats', find: 'find', compare: 'compare', help: 'help', oles: 'oles', xref: 'xref' }[id]; }

// ---------------- 命令 ----------------
async function command(id, e) {
  const d = state.cur;
  switch (id) {
    case 'open': return openDialog();
    case 'recent': return recentMenu(e.currentTarget);
    case 'extents': return zoomExtents();
    case 'layers': case 'stats': case 'find': case 'compare': case 'help': case 'oles': case 'xref': return toggleSide(id);
    case 'bg': R.bg = R.bg === 'black' ? 'white' : 'black'; state.settings.bg = R.bg; saveSettings(); $('#stage').style.background = R.bg === 'white' ? '#fff' : '#000'; refreshToolbar(); return redraw();
    case 'scale': return scaleDialog();
    case 'undo': return undo();
    case 'redo': return redo();
    case 'rotate': return rotateView(1);
    case 'mirror': return mirrorView();
    case 'hidemarks': state.hideMarks = !state.hideMarks; refreshToolbar(); toast(state.hideMarks ? tr('已隐藏测量和批注') : tr('已显示测量和批注')); return redraw();
    case 'markset': return markSettings();
    case 'lay2m': return layoutToModel();
    case 'export': return exportMenu(e.currentTarget);
    case 'print': return printDoc();
    default:
      if (MODAL_TOOLS.has(id)) setTool(state.tool === id ? null : id);
  }
}
// 线性尺寸的尺寸线两端（局部坐标，水平/竖直指图纸坐标轴）
function linEnds(p, orient) { const a = p[0], b = p[1], D = p[2] || p[1]; return orient === 'v' ? [[D[0], a[1]], [D[0], b[1]]] : [[a[0], D[1]], [b[0], D[1]]]; }
// 图纸里方向角 ang（弧度）在屏幕上的角度
function scrAng(q, ang) { const a = toScreen(q[0], q[1]), b = toScreen(q[0] + Math.cos(ang), q[1] + Math.sin(ang)); return Math.atan2(b[1] - a[1], b[0] - a[0]); }
function resetToolState() { state.tmp = []; state.tmpArc = new Set(); state.arcPending = false; state.batchSel = []; state.p2lSeg = null; state.hoverCurve = null; state.hoverCircle = null; state.hoverRegion = null; }
function setTool(t) {
  if (t && t !== 'calib' && t !== 'findbox') { const ti = tabOf(t); if (ti >= 0 && ti !== state.tab) { state.tab = ti; buildToolbar(); } }
  state.tool = t; resetToolState(); state.hover = null; state.arcMode = false;
  if (t === 'count' && state.side !== 'blocks' && state.cur && state.cur.kind === 'drawing') { state.side = 'blocks'; refreshSide(); } // 数量统计：同时列出全部图块
  cv.className = t ? (PICK_TOOLS.has(t) ? 'pick' : 'cross') : 'pan';
  $('#st-tool').textContent = t ? '▶ ' + (TOOL_HINT[t] || '') + tr('　Esc 退出') : '';
  hideTip(); refreshToolbar(); redraw();
}

// ---------------- 打开图纸 ----------------
async function openDialog() {
  if (B.openDialog) { const ps = await B.openDialog(); for (const p of ps || []) await openPath(p); }
  else $('#file-input').click();
}
$('#file-input').onchange = async (e) => { for (const f of e.target.files) await openFileObj(f); e.target.value = ''; };
async function openFileObj(f) {
  const p = B.pathForFile ? B.pathForFile(f) : '';
  if (p) return openPath(p);
  peek('read-start', { name: f.name, bytes: f.size || 0 });
  const tRead = performance.now();
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    peek('read-end', { name: f.name, bytes: bytes.byteLength, ms: performance.now() - tRead });
    return await openBytes(f.name, bytes, null);
  } catch (err) { peek('fail', { name: f.name, message: String(err && err.message || err) }); }
}
async function openPath(p) {
  const exist = state.docs.find(d => d.path === p && d.kind === 'drawing');
  if (exist) { activate(exist); return exist; }
  const name = p.split(/[\\/]/).pop();
  peek('read-start', { name, bytes: 0 });
  busy(tr('正在读取文件…'));
  const tRead = performance.now();
  try {
    const bytes = await B.readFile(p);
    peek('read-end', { name, bytes: bytes.byteLength || bytes.length || 0, ms: performance.now() - tRead });
    return await openBytes(name, bytes, p);
  } catch (err) { busy(); peek('fail', { name, message: String(err && err.message || err) }); toast(tr('打开失败：') + err.message); }
}
async function openBytes(name, bytes, path, opt = {}) {
  if (!/\.(dwg|dxf)$/i.test(name)) { toast(tr('只支持 DWG / DXF 图纸')); return; }
  busy(tr('闪电打开 ') + name + '…');
  const t0 = performance.now();
  try {
    const id = rpcId++;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const dedicatedWasm = !!(window.__peek && window.__peek.dedicatedWasm);
    const m = await rpc({ id, cmd: 'open', name, bytes: buf, dedicatedWasm }, [buf]);
    if (!opt.hidden) peek('parsed', { name, info: m.scene && m.scene.info });
    const sc = m.scene;
    const doc = {
      kind: 'drawing', id, name, path, scene: sc, spaceIdx: 0, views: {}, layerOn: new Map(sc.layers.map(l => [l.name, l.on])),
      measures: [], annots: [], undo: [], cat: '默认分类', cats: ['默认分类'], textEdits: {}, nextNo: 1,
      unit: unitFor(sc), openMs: Math.round(performance.now() - t0), _peek: !opt.hidden,
    };
    for (const sp of sc.spaces) { sp.items = { m: doc.measures }; }
    await loadSidecar(doc);
    const fontNote = await loadSceneFonts(sc);
    if (!opt.hidden) { state.docs.push(doc); activate(doc); addRecent(path, name); if (xrefList(doc).length) setTimeout(() => loadXrefs(doc), 0); }
    busy();
    const sk = Object.entries(sc.stats.skipped).filter(([k]) => !/^(ATTDEF|SEQEND)$/.test(k));
    if (!opt.hidden && sc.stats.entities === 0) { toast(tr('这张图纸里没有可显示的图元'), 5000); return doc; }
    if (!opt.hidden) toast(tr('闪电打开 {0}　{1}　{2} 个图元　用时 {3} 秒', name, sc.info.version, sc.stats.entities.toLocaleString(), (doc.openMs / 1000).toFixed(2)) + (sk.length ? tr('　（{0} 暂不显示）', sk.map(([k, v]) => k + '×' + v).join('，')) : '') + (doc.unit.uf !== 1 ? tr('　测量单位：1 图纸单位 = {0} mm（{1}，可点状态栏的比例修改）', +doc.unit.uf.toFixed(4), tr(UNIT_WHY[doc.unit.why] || '')) : '') + fontNote, 7000);
    return doc;
  } catch (err) { busy(); peek('fail', { name, message: String(err && err.message || err) }); toast(tr('打开失败：') + err.message, 6000); console.error(err); }
}
// 国内图纸的 $INSUNITS 常被误设为英寸；只在英制图纸（MEASUREMENT=0）里才信英寸/英尺
function applyTextEdits(doc) {
  for (const sp of doc.scene.spaces) {
    sp._txIdx = null;
    for (const t of sp.texts) {
      t._qb = undefined; t._w = undefined;
      if (!t.hd || doc.textEdits[t.hd] === undefined) continue;
      if (t._orig === undefined) { t._orig = t.s; t._origSr = t.sr; t._origSg = t.sg; }
      const lines = String(doc.textEdits[t.hd]).split('\n');
      if (t.mt) { const n = t.ln || 1; t.s = t.li === n - 1 ? lines.slice(t.li).join(' ') : (lines[t.li] ?? ''); }
      else t.s = lines.join(' ');
      t.sr = undefined; t.sg = undefined; // 改过的文字按普通字画；撤销时从 _origSr / _origSg 恢复符号
      t._w = undefined; t._wl = undefined;
    }
  }
  touchScene();
}
const UNIT_WHY = { label: '按图上「L=」管长标注判断', coord: '按测量坐标判断', header: '按图纸文件设置', default: '默认', manual: '手动设置' };
function legacyUf(sc) { const u = sc.insunits, cjk = /[\u4e00-\u9fff]/; const chinese = sc.layers.some(l => cjk.test(l.name)) || sc.spaces.some(sp => sp.texts.slice(0, 500).some(t => cjk.test(t.s))); if (!chinese && sc.measurement === 0 && (u === 1 || u === 2)) return u === 1 ? 25.4 : 304.8; return { 5: 10, 6: 1000, 14: 100 }[u] || 1; }
function unitFor(sc) { const g = guessUnit(sc); return { uf: g.uf, len: g.uf >= 1000 ? 'm' : 'mm', area: 'm2', dec: 2, why: g.why, ts: 0, color: '', tick: 'oblique' }; }
function sidecarPath(doc) { return doc.path ? doc.path + '.lpeek.json' : null; }
async function loadSidecar(doc) {
  const p = sidecarPath(doc); if (!p) return;
  try {
    const raw = await B.readText(p); if (!raw) return;
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(j.measures)) doc.measures.push(...j.measures);
    if (Array.isArray(j.annots)) doc.annots.push(...j.annots);
    // 0.1.2 及以前每次都保存比例、没有 manual 标记：和当时的默认值不同，才说明是用户改过的，继续沿用
    const legacyManual = j.unit && !('manual' in j.unit) && (Math.abs((j.unit.uf || 1) - legacyUf(doc.scene)) > 1e-9 || (j.unit.len && j.unit.len !== 'mm') || (j.unit.area && j.unit.area !== 'm2') || (j.unit.dec !== undefined && j.unit.dec !== 2));
    if (j.unit && (j.unit.manual || legacyManual)) { Object.assign(doc.unit, j.unit); doc.unit.manual = true; doc.unit.why = 'manual'; }
    else if (j.unit) for (const k of ['ts', 'color', 'tick']) if (j.unit[k] !== undefined) doc.unit[k] = j.unit[k];
    if (Array.isArray(j.cats)) doc.cats = [...new Set([...doc.cats, ...j.cats])];
    if (j.cat) doc.cat = j.cat;
    if (j.textEdits) { doc.textEdits = j.textEdits; applyTextEdits(doc); }
    if (j.nextNo) doc.nextNo = j.nextNo;
  } catch (e) { console.warn(tr('批注文件读取失败'), e); }
}
function sidecarJson(doc) { return JSON.stringify({ app: 'lightning-peek', ver: 1, file: doc.name, saved: new Date().toISOString(), unit: doc.unit, cats: doc.cats, cat: doc.cat, measures: doc.measures, annots: doc.annots, textEdits: doc.textEdits, nextNo: doc.nextNo }, (k, v) => (k === '_lb' ? undefined : v), 1); }
function saveSidecar(doc) {
  const p = sidecarPath(doc); if (!p) return;
  doc._dirty = true; clearTimeout(doc._saveTimer);
  doc._saveTimer = setTimeout(() => { doc._dirty = false; B.writeText(p, sidecarJson(doc)).catch(e => { console.warn('sidecar', e); if (!doc._warned) { doc._warned = true; toast(tr('批注无法保存到图纸所在的文件夹（可能是只读位置）。本次的测量和批注只在程序打开期间有效，可用「导出标注」另存一份'), 8000); } }); }, 400);
}
function flushSidecars() {
  for (const d of state.docs) if (d.kind === 'drawing' && d._dirty) { clearTimeout(d._saveTimer); d._dirty = false; const p = sidecarPath(d); if (p) { try { B.writeTextSync ? B.writeTextSync(p, sidecarJson(d)) : B.writeText(p, sidecarJson(d)); } catch (e) { /* 忽略 */ } } }
}
window.addEventListener('beforeunload', flushSidecars);

// ---------------- 文档标签 / 空间 ----------------
function activate(doc) {
  state.cur = doc; resetToolState(); state.hover = null;
  if (doc) { R.layerOn = doc.layerOn; document.title = doc.name + tr(' - 闪电看图'); }
  else document.title = tr('闪电看图');
  $('#empty').classList.toggle('hidden', !!doc);
  if (state.tool && (!doc || doc.kind !== 'drawing')) setTool(null);
  renderTabs(); renderSpaceTabs(); refreshSide(); refreshToolbar(); updateScaleInfo();
  if (doc && !doc.views[doc.spaceIdx]) zoomExtents(true);
  redraw();
}
function renderTabs() {
  const el = $('#doctabs'); el.innerHTML = '';
  for (const d of state.docs) {
    const t = document.createElement('div'); t.className = 'dtab' + (d === state.cur ? ' on' : ''); t.title = d.path || d.name;
    t.innerHTML = `<span class="nm"></span><button class="x" title="${tr('关闭')}">×</button>`;
    t.querySelector('.nm').textContent = d.name;
    t.onclick = () => activate(d);
    t.onauxclick = (e) => { if (e.button === 1) closeDoc(d); };
    t.querySelector('.x').onclick = (e) => { e.stopPropagation(); closeDoc(d); };
    el.appendChild(t);
  }
}
function releaseWorker(d) {
  if (!d || d.kind !== 'drawing') return;
  rpc({ cmd: 'close', doc: d.id }).catch(() => { });
  if (d.xrefDocs) for (const x of d.xrefDocs.values()) if (x.doc) rpc({ cmd: 'close', doc: x.doc.id }).catch(() => { });
  d.xrefDocs = null;
}
function closeDoc(d) {
  const i = state.docs.indexOf(d); if (i < 0) return;
  if (d._dirty) { clearTimeout(d._saveTimer); d._dirty = false; const p = sidecarPath(d); if (p) B.writeText(p, sidecarJson(d)).catch(() => { }); }
  state.docs.splice(i, 1);
  releaseWorker(d);
  if (state.cur === d) activate(state.docs[Math.min(i, state.docs.length - 1)] || null); else renderTabs();
  if (!state.docs.length) renderRecent();
}
function spaces(d) { return d.kind === 'drawing' ? d.scene.spaces : [d.space]; }
function curSpace() { const d = state.cur; if (!d) return null; return d.kind === 'drawing' ? spaces(d)[d.spaceIdx] || spaces(d)[0] : d.space; }
function modelSpace(d) { return d.scene.spaces.find(s => s.key === '*MODEL_SPACE'); }
function renderSpaceTabs() {
  const el = $('#spacetabs'); el.innerHTML = '';
  const d = state.cur; if (!d || d.kind !== 'drawing') return;
  const sps = spaces(d); if (!sps.length) return;
  sps.forEach((s, i) => {
    const t = document.createElement('div'); t.className = 'stab' + (i === d.spaceIdx ? ' on' : ''); t.textContent = spName(s);
    t.onclick = () => { d.spaceIdx = i; resetToolState(); if (!d.views[i]) zoomExtents(true); renderSpaceTabs(); refreshSide(); redraw(); };
    el.appendChild(t);
  });
}

// ---------------- 视图 ----------------
function view() { const d = state.cur; return d && d.views[d.spaceIdx]; }
function sizeCanvas() {
  DPR = window.devicePixelRatio || 1;
  if (cv !== sCv) return;
  const r = sCv.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * DPR)), h = Math.max(1, Math.round(r.height * DPR));
  if (sCv.width !== w || sCv.height !== h) { sCv.width = w; sCv.height = h; oCv.width = w; oCv.height = h; painted = null; }
}
// 屏幕旋转（每次 90°）与镜像：局部坐标增量 → 屏幕增量的 2×2 正交矩阵 [a, b, c, d]
function basis(d = state.cur) {
  const k = (d && d.rot) || 0, mir = d && d.mir ? -1 : 1;
  const cs = [1, 0, -1, 0][k & 3], sn = [0, 1, 0, -1][k & 3];
  return [cs * mir, -sn * mir, -sn, -cs]; // 先镜像 x，再逆时针旋转，最后翻转 y
}
function matrix(v = view()) { const [a, b, c, e] = basis(); return [v.s * a, v.s * b, v.s * c, v.s * e, cv.width / 2 - v.s * (a * v.cx + c * v.cy), cv.height / 2 - v.s * (b * v.cx + e * v.cy)]; }
function toLocal(px, py) { const v = view(); const [a, b, c, e] = basis(); const u = (px - cv.width / 2) / v.s, w = (py - cv.height / 2) / v.s; return [a * u + b * w + v.cx, c * u + e * w + v.cy]; }
function toScreen(x, y) { const v = view(); const [a, b, c, e] = basis(); const dx = x - v.cx, dy = y - v.cy; return [cv.width / 2 + v.s * (a * dx + c * dy), cv.height / 2 + v.s * (b * dx + e * dy)]; }
function swapWH() { const d = state.cur; return d && (d.rot & 1); }
function rotateView(step) { const d = state.cur; if (!d) return; const v = view(); const c = v ? [v.cx, v.cy] : null; d.rot = ((d.rot || 0) + step + 4) & 3; if (c) { v.cx = c[0]; v.cy = c[1]; } toast(tr('屏幕旋转 {0}°', d.rot * 90)); redraw(); }
function mirrorView() { const d = state.cur; if (!d) return; d.mir = !d.mir; toast(d.mir ? tr('已左右镜像显示') : tr('已取消镜像')); refreshToolbar(); redraw(); }
function zoomExtents(silent) {
  const d = state.cur; if (!d) return;
  sizeCanvas();
  const sp = curSpace(); let bb = sp.view || sp.bbox;
  if (sp.paper && sp.viewports && sp.viewports.length) {
    bb = [...(Number.isFinite(sp.bbox[0]) ? sp.bbox : [Infinity, Infinity, -Infinity, -Infinity])];
    for (const vp of sp.viewports) { bb[0] = Math.min(bb[0], vp.cx - vp.w / 2); bb[1] = Math.min(bb[1], vp.cy - vp.h / 2); bb[2] = Math.max(bb[2], vp.cx + vp.w / 2); bb[3] = Math.max(bb[3], vp.cy + vp.h / 2); }
  }
  if (sp.xrefs && sp.xrefs.length && d.xrefDocs) { // 把已加载的外部参照范围也算进来
    bb = [...(Number.isFinite(bb[0]) ? bb : [Infinity, Infinity, -Infinity, -Infinity])];
    for (const x of sp.xrefs) { const xd = d.xrefDocs.get(x.name.toUpperCase()); const xms = xd && xd.doc && modelSpace(xd.doc); if (!xms) continue; const v = xms.view || xms.bbox; if (!v || !Number.isFinite(v[0])) continue; const T = mmul(x.M, [1, 0, 0, 1, xms.origin[0], xms.origin[1]]);
      for (const q of [[v[0], v[1]], [v[2], v[1]], [v[2], v[3]], [v[0], v[3]]]) { const r = mapply(T, q[0], q[1]); bb[0] = Math.min(bb[0], r[0]); bb[1] = Math.min(bb[1], r[1]); bb[2] = Math.max(bb[2], r[0]); bb[3] = Math.max(bb[3], r[1]); } }
  }
  if (!Number.isFinite(bb[0])) bb = [0, 0, 100, 100];
  let w = Math.max(bb[2] - bb[0], 1e-9), h = Math.max(bb[3] - bb[1], 1e-9); if (swapWH()) [w, h] = [h, w];
  const s = Math.min(cv.width / w, cv.height / h) * 0.94;
  d.views[d.spaceIdx] = { s, cx: (bb[0] + bb[2]) / 2, cy: (bb[1] + bb[3]) / 2 };
  if (!silent) redraw();
}
function zoomTo(bb, padPx = 60) {
  const d = state.cur; sizeCanvas();
  let w = Math.max(bb[2] - bb[0], 1e-9), h = Math.max(bb[3] - bb[1], 1e-9); if (swapWH()) [w, h] = [h, w];
  const s = Math.min((cv.width - padPx * DPR) / w, (cv.height - padPx * DPR) / h);
  d.views[d.spaceIdx] = { s: Math.max(s, 1e-12), cx: (bb[0] + bb[2]) / 2, cy: (bb[1] + bb[3]) / 2 };
  redraw();
}
function zoomAt(px, py, f) {
  const v = view(); if (!v) return;
  const [x, y] = toLocal(px, py);
  v.s = Math.min(Math.max(v.s * f, 1e-12), 1e12);
  const [a, b, c, e] = basis(); const u = (px - cv.width / 2) / v.s, w = (py - cv.height / 2) / v.s;
  v.cx = x - (a * u + b * w); v.cy = y - (c * u + e * w);
  redraw();
}

// ---------------- 绘制 ----------------
function touchScene() { state.sceneRev = (state.sceneRev | 0) + 1; }
function hashStr(h, s) { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
function layerSig(on) {
  if (!on || typeof on.entries !== 'function') return 0;
  let h = 2166136261;
  for (const [k, v] of on) { h = hashStr(h, String(k)); h = (h ^ (v === false ? 2 : 1)) >>> 0; }
  return h;
}
const objIds = new WeakMap(); let objSeq = 1;
function objId(o) { if (!o || typeof o !== 'object') return 0; let id = objIds.get(o); if (!id) objIds.set(o, id = objSeq++); return id; }
function sceneKey(d, v) {
  let cmp = '';
  if (d.kind === 'compare') {
    const vis = d.cmpVis, k = d.cmpKinds;
    cmp = [d.cmpMode, vis.del, vis.add, vis.mod, vis.same, vis.sameHi, k.line, k.text, k.fill, d.cmpMode === 'swipe' ? d.swipe : 0, objId(d.result)].join(',');
  }
  return [objId(d), d.spaceIdx, d.rot | 0, d.mir ? 1 : 0, R.bg, v.s, v.cx, v.cy, sCv.width, sCv.height, state.sceneRev | 0, layerSig(d.layerOn), cmp].join('|');
}
function redraw() { if (!state.dirty) { state.dirty = true; requestAnimationFrame(draw); } }
function draw() {
  state.dirty = false;
  cv = sCv; ctx = sctx;
  sizeCanvas();
  const d = state.cur; const v = d && view();
  if (!d || !v) {
    sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.fillStyle = R.bg === 'white' ? '#ffffff' : '#000000'; sctx.fillRect(0, 0, sCv.width, sCv.height);
    octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, oCv.width, oCv.height);
    painted = null; return;
  }
  const key = sceneKey(d, v);
  const M = matrix(v); const rect = [0, 0, sCv.width, sCv.height];
  if (painted !== key) {
    ctx = sctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = R.bg === 'white' ? '#ffffff' : '#000000';
    ctx.fillRect(0, 0, sCv.width, sCv.height);
    if (d.kind === 'compare') drawCompare(d, M, rect);
    else {
      const sp = curSpace();
      if (sp.paper) drawPaper(d, sp, M, rect); else { R.drawSpace(ctx, sp, M, rect, { dpr: DPR }); drawXrefs(d, ctx, sp, M, rect, DPR); }
    }
    painted = key;
    if (d.kind === 'drawing' && d._peek && !d._peekPaint) {
      d._peekPaint = true;
      peek('first-paint', { name: d.name, ms: performance.now() });
    }
  }
  ctx = octx;
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, oCv.width, oCv.height);
  if (d.kind === 'compare') drawCompareChrome(d, M);
  drawOverlays(d, M);
  ctx = sctx;
}
function vpMatrix(vp, ms) {
  // 模型 WCS → DCS：减去视图目标点，再按扭转角旋转；DCS → 图纸：减去视图中心，按比例缩放，平移到视口中心
  const k = vp.h / vp.vh, c = Math.cos(vp.twist), s = Math.sin(vp.twist);
  let Mv = [k, 0, 0, k, vp.cx, vp.cy];
  Mv = mmul(Mv, [1, 0, 0, 1, -vp.vcx, -vp.vcy]);
  Mv = mmul(Mv, [c, s, -s, c, 0, 0]);
  return mmul(Mv, [1, 0, 0, 1, ms.origin[0] - (vp.tx || 0), ms.origin[1] - (vp.ty || 0)]);
}
function vpLayers(vp, base) {
  if (!vp.frozen || !vp.frozen.length) return base;
  // 只读视图：视口冻结的图层返回 false，其余沿用当前图层开关（不复制，开关变化立即生效）
  const fz = vp._fz || (vp._fz = new Set(vp.frozen));
  return { get: (n) => (fz.has(n) ? false : base.get(n)) };
}
function drawPaper(d, sp, M, rect, c2 = ctx, dpr = DPR) {
  const ms = modelSpace(d);
  const saved = R.layerOn;
  for (const vp of sp.viewports) {
    if (!vp.vh || !vp.h || !ms) continue;
    const Mv = mmul(M, vpMatrix(vp, ms));
    const poly = vp.clip || [[vp.cx - vp.w / 2, vp.cy - vp.h / 2], [vp.cx + vp.w / 2, vp.cy - vp.h / 2], [vp.cx + vp.w / 2, vp.cy + vp.h / 2], [vp.cx - vp.w / 2, vp.cy + vp.h / 2]];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    c2.save(); c2.setTransform(1, 0, 0, 1, 0, 0); c2.beginPath();
    poly.forEach((p, i) => { const q = mapply(M, p[0], p[1]); if (i) c2.lineTo(q[0], q[1]); else c2.moveTo(q[0], q[1]); x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); });
    c2.closePath();
    if (x1 < rect[0] || x0 > rect[2] || y1 < rect[1] || y0 > rect[3]) { c2.restore(); continue; }
    c2.clip();
    try {
      R.layerOn = vpLayers(vp, saved);
      const vr = [Math.max(x0, rect[0]), Math.max(y0, rect[1]), Math.min(x1, rect[2]), Math.min(y1, rect[3])];
      R.drawSpace(c2, ms, Mv, vr, { dpr }); drawXrefs(d, c2, ms, Mv, vr, dpr);
    } finally { R.layerOn = saved; c2.restore(); }
  }
  // 图纸空间自身的图元画在视口内容之上（图框、标注等）
  R.drawSpace(c2, sp, M, rect, { dpr }); drawXrefs(d, c2, sp, M, rect, dpr);
}
// ---- 外部参照 ----
function drawXrefs(d, c2, sp, M, rect, dpr) {
  if (!sp.xrefs || !sp.xrefs.length || !d.xrefDocs) return;
  for (const x of sp.xrefs) {
    const xd = d.xrefDocs.get(x.name.toUpperCase()); if (!xd || !xd.doc || !R.visible(x.layer)) continue;
    const xms = modelSpace(xd.doc); if (!xms) continue;
    const saved = R.layerOn; R.layerOn = xd.doc.layerOn; // 用外部图纸自己的图层开关
    try { R.drawSpace(c2, xms, mmul(M, mmul(x.M, [1, 0, 0, 1, xms.origin[0], xms.origin[1]])), rect, { dpr }); } finally { R.layerOn = saved; }
  }
}
function xrefList(d) { const m = new Map(); for (const sp of d.scene.spaces) for (const x of sp.xrefs || []) { const k = x.name.toUpperCase(); if (!m.has(k)) m.set(k, { name: x.name, path: x.path, n: 0 }); m.get(k).n++; } return [...m.values()]; }
function dirOf(p) { return p ? p.replace(/[\\/][^\\/]*$/, '') : ''; }
function xrefCandidates(host, ref) {
  if (!ref) return [];
  const sep = host && host.includes('\\') ? '\\' : '/';
  const norm = (x) => { const unc = /^[\\/]{2}[^\\/]/.test(x); const y = x.replace(/[\\/]+/g, sep); return unc ? sep + y : y; }; // 保留网络路径开头的两个斜杠
  const r = norm(ref); const base = r.split(sep).pop(); const dir = dirOf(host); const out = [];
  if (/^([a-z]:|[\\/])/i.test(ref)) out.push(r);
  if (dir) { out.push(dir + sep + r.replace(/^\.[\\/]/, '').replace(/^[a-z]:[\\/]?/i, '')); out.push(dir + sep + base); }
  return [...new Set(out)];
}
// 打开图纸后自动按记录的路径加载外部参照：先试原路径，再试与当前图纸同目录
async function loadXrefs(d) {
  const list = xrefList(d); if (!list.length) return;
  d.xrefDocs = d.xrefDocs || new Map(); let ok = 0;
  for (const x of list) {
    const k = x.name.toUpperCase(); if (d.xrefDocs.get(k)?.doc) { ok++; continue; }
    let got = null;
    for (const p of xrefCandidates(d.path, x.path)) { try { const bytes = await B.readFile(p); if (bytes && bytes.length) { got = await openBytes(p.split(/[\\/]/).pop(), bytes, p, { hidden: true }); if (got) { d.xrefDocs.set(k, { doc: got, path: p }); break; } } } catch (e) { /* 试下一个 */ } }
    if (got) ok++; else d.xrefDocs.set(k, { doc: null, path: x.path });
  }
  toast(tr('外部参照 {0} 个，已加载 {1} 个', list.length, ok) + (ok < list.length ? tr('。未找到的可在「工具 → 外部参照」里指定文件') : ''), 6000);
  touchScene(); redraw();
}
function xrefPanel(body, d) {
  const list = d.kind === 'drawing' ? xrefList(d) : [];
  if (!list.length) { body.append(h('div', { cls: 'empty-note', text: tr('这张图纸没有外部参照。') })); return; }
  body.append(h('div', { cls: 'k', style: 'color:#5b6676;font-size:11px;margin-bottom:8px', text: tr('外部参照只用于查看，叠加显示在插入位置；测量捕捉只针对当前图纸。') }));
  for (const x of list) {
    const st = d.xrefDocs && d.xrefDocs.get(x.name.toUpperCase());
    const ok = st && st.doc;
    body.append(h('div', { cls: 'mrow', style: 'display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid #e6e9ee' },
      h('div', { style: 'flex:1;min-width:0' }, h('div', { text: x.name + paren(x.n) }), h('div', { style: 'color:' + (ok ? '#2a8a3e' : '#c0392b') + ';font-size:11px;word-break:break-all', text: (ok ? tr('已加载：') + st.path : tr('未找到：') + (x.path || '')) })),
      h('button', { cls: 'btn', text: tr('指定文件'), onclick: async () => {
        const ps = B.openDialog ? await B.openDialog() : null; const p = ps && ps[0]; if (!p) return;
        try { const got = await openBytes(p.split(/[\\/]/).pop(), await B.readFile(p), p, { hidden: true }); if (got) { (d.xrefDocs = d.xrefDocs || new Map()).set(x.name.toUpperCase(), { doc: got, path: p }); touchScene(); refreshSide(); redraw(); } } catch (e) { toast(String(e.message || e)); }
      } })));
  }
}
const CMP_COLORS = { del: '#ff4d4f', add: '#2fd36b', mod: '#ffc531', modOld: '#ff8a3d', sameDim: '#5d6672', sameDimW: '#a3abb6', sameHi: '#3fa9ff' };
function cmpLayers(d, M, rect, set, ctx2 = ctx, dpr = DPR) {
  const r = d.result; const v = d.cmpVis; const kinds = ['fill', 'line', 'text'].filter(k => d.cmpKinds[k]);
  const draw = (name, color, alpha) => { for (const k of kinds) R.drawSpace(ctx2, r.buckets[name][k], M, rect, { dpr, color, dash: false, alpha }); };
  if (v.same && set.includes('same')) draw('same', v.sameHi ? CMP_COLORS.sameHi : (R.bg === 'white' ? CMP_COLORS.sameDimW : CMP_COLORS.sameDim), v.sameHi ? 0.9 : 1);
  if (v.mod && set.includes('modOld')) draw('modOld', CMP_COLORS.modOld, 0.55);
  if (v.del && set.includes('del')) draw('del', CMP_COLORS.del, 1);
  if (v.add && set.includes('add')) draw('add', CMP_COLORS.add, 1);
  if (v.mod && set.includes('mod')) draw('mod', CMP_COLORS.mod, 1);
}
function drawCompare(d, M, rect) {
  const W0 = cv.width, H0 = cv.height;
  const OLD = ['same', 'del', 'modOld'], NEW = ['same', 'add', 'mod'], ALL = ['same', 'modOld', 'del', 'add', 'mod'];
  if (d.cmpMode === 'side') {
    const half = W0 / 2;
    for (const [side, set, title] of [[0, OLD, tr('旧图：') + d.a], [1, NEW, tr('新图：') + d.b]]) {
      const Ms = M.slice(); Ms[4] += (side ? 1 : -1) * W0 / 4;
      ctx.save(); ctx.beginPath(); ctx.rect(side * half, 0, half, H0); ctx.clip();
      cmpLayers(d, Ms, [side * half, 0, side * half + half, H0], set);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = 'rgba(29,42,58,.85)'; ctx.fillRect(side * half + 8 * DPR, 8 * DPR, Math.min(half - 16 * DPR, 360 * DPR), 24 * DPR);
      ctx.fillStyle = '#fff'; ctx.font = `${12.5 * DPR}px "Noto Sans SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`; ctx.fillText(title, side * half + 16 * DPR, 25 * DPR);
      ctx.restore();
    }
    ctx.fillStyle = '#ffb400'; ctx.fillRect(half - DPR, 0, 2 * DPR, H0);
  } else if (d.cmpMode === 'swipe') {
    const x = Math.round(W0 * d.swipe);
    ctx.save(); ctx.beginPath(); ctx.rect(x, 0, W0 - x, H0); ctx.clip(); cmpLayers(d, M, [x, 0, W0, H0], NEW); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, x, H0); ctx.clip(); cmpLayers(d, M, [0, 0, x, H0], OLD); ctx.restore();
    ctx.fillStyle = '#ffb400'; ctx.fillRect(x - DPR, 0, 2 * DPR, H0);
    ctx.beginPath(); ctx.arc(x, H0 / 2, 14 * DPR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1d2a3a'; ctx.font = `600 ${12 * DPR}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⇆', x, H0 / 2); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(29,42,58,.85)'; ctx.fillRect(8 * DPR, 8 * DPR, 120 * DPR, 22 * DPR); ctx.fillRect(W0 - 128 * DPR, 8 * DPR, 120 * DPR, 22 * DPR);
    ctx.fillStyle = '#fff'; ctx.font = `${12 * DPR}px "Noto Sans SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`; ctx.fillText(tr('◀ 旧图'), 16 * DPR, 23 * DPR); ctx.fillText(tr('新图 ▶'), W0 - 118 * DPR, 23 * DPR);
  } else cmpLayers(d, M, rect, ALL);
}
function drawCompareChrome(d, M, live = true) {
  const W0 = cv.width, H0 = cv.height;
  const cl = d.result.changes[d.cmpIdx];
  if (cl && d.cmpMode !== 'side') {
    const a = mapply(M, cl.bb[0], cl.bb[1]), b = mapply(M, cl.bb[2], cl.bb[3]);
    const pad = 12 * DPR; const t = (performance.now() / 500) % 1;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.strokeStyle = '#ff3b8d'; ctx.lineWidth = 2.5 * DPR; ctx.setLineDash([8 * DPR, 5 * DPR]); ctx.lineDashOffset = -t * 13 * DPR;
    ctx.strokeRect(Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.abs(b[0] - a[0]) + pad * 2, Math.abs(b[1] - a[1]) + pad * 2); ctx.restore();
    if (live && !chromeTimer) chromeTimer = setTimeout(() => { chromeTimer = 0; redraw(); }, 80);
  }
  if (d.cmpVis.boxes) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineWidth = 1.2 * DPR;
    for (const c of d.result.changes) {
      const shift = d.cmpMode === 'side' ? W0 / 4 : 0;
      const a = mapply(M, c.bb[0], c.bb[1]), b = mapply(M, c.bb[2], c.bb[3]); const pad = 6 * DPR;
      ctx.strokeStyle = c.type === 'add' ? CMP_COLORS.add : c.type === 'del' ? CMP_COLORS.del : CMP_COLORS.mod;
      for (const sx of d.cmpMode === 'side' ? [-shift, shift] : [0]) ctx.strokeRect(Math.min(a[0], b[0]) - pad + sx, Math.min(a[1], b[1]) - pad, Math.abs(b[0] - a[0]) + pad * 2, Math.abs(b[1] - a[1]) + pad * 2);
    }
    ctx.restore();
  }
}

// ---------------- 测量与批注：数据 ----------------
function spaceKey() { const sp = curSpace(); return sp ? sp.key : ''; }
function spOrigin() { const sp = curSpace(); return sp && sp.origin ? sp.origin : [0, 0]; }
function W(p) { const o = spOrigin(); return [p[0] + o[0], p[1] + o[1]]; } // 局部 → 世界
function L(p) { const o = spOrigin(); return [p[0] - o[0], p[1] - o[1]]; } // 世界 → 局部
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
function polyLen(pts, closed) { let s = 0; for (let i = 0; i + 1 < pts.length; i++) s += dist(pts[i], pts[i + 1]); if (closed && pts.length > 2) s += dist(pts[pts.length - 1], pts[0]); return s; }
function angleAt(v, a, b) { let t = Math.atan2(b[1] - v[1], b[0] - v[0]) - Math.atan2(a[1] - v[1], a[0] - v[0]); t = Math.abs(t * 180 / Math.PI) % 360; return t > 180 ? 360 - t : t; }
function fmtLen(du, doc = state.cur) { const mm = du * doc.unit.uf; return doc.unit.len === 'm' ? (mm / 1000).toFixed(doc.unit.dec) + ' m' : mm.toFixed(doc.unit.dec) + ' mm'; }
function fmtArea(du2, doc = state.cur) { const mm2 = du2 * doc.unit.uf * doc.unit.uf; return doc.unit.area === 'mm2' || mm2 < 1e4 ? mm2.toFixed(doc.unit.dec) + ' mm²' : (mm2 / 1e6).toFixed(mm2 < 1e6 ? Math.max(doc.unit.dec, 4) : doc.unit.dec) + ' m²'; }
function fmtAreaMm(mm2, doc = state.cur) { return doc.unit.area === 'mm2' ? mm2.toFixed(doc.unit.dec) + ' mm²' : (mm2 / 1e6).toFixed(Math.max(doc.unit.dec, 2)) + ' m²'; }
const CK_NAME = () => ({ 0: tr('曲线'), 1: tr('直线'), 2: tr('圆弧'), 3: tr('圆'), 4: tr('多段线') });
function withExpand(v, m, doc) {
  if (m.height > 0 && v.kind === 'len') { const a = v.num * m.height; v.exp = a; v.sub = (v.sub ? v.sub + '　' : '') + tr('展开面积 {0}（高 {1} mm）', doc.unit.area === 'mm2' ? a.toFixed(doc.unit.dec) + ' mm²' : (a / 1e6).toFixed(3) + ' m²', m.height); }
  return v;
}
function measureValue(m, doc = state.cur) {
  const p = m.pts;
  switch (m.type) {
    case 'dist': return withExpand({ main: fmtLen(dist(p[0], p[1]), doc), num: dist(p[0], p[1]) * doc.unit.uf, kind: 'len', sub: `ΔX ${fmtLen(Math.abs(p[1][0] - p[0][0]), doc)}　ΔY ${fmtLen(Math.abs(p[1][1] - p[0][1]), doc)}` }, m, doc);
    case 'poly': return withExpand({ main: fmtLen(polyLen(p), doc), num: polyLen(p) * doc.unit.uf, kind: 'len', sub: tr('{0} 段', p.length - 1) }, m, doc);
    case 'boxlen': return withExpand({ main: fmtLen(m.total, doc), num: m.total * doc.unit.uf, kind: 'len', sub: tr('框内 {0} 条线', m.n) + (m.layers ? paren(m.layers) : '') }, m, doc);
    case 'count': return { main: tr('{0} 个', m.n), num: m.n, kind: 'count', sub: m.shape ? tr('与样板相同的图形') : tr('图块「{0}」', m.name) };
    case 'area': {
      if (m.radius > 0 && !m.offset && !(m.holes && m.holes.length)) { const a = Math.PI * m.radius * m.radius; return { main: fmtArea(a, doc), num: a * doc.unit.uf ** 2, kind: 'area', sub: tr('周长 ') + fmtLen(2 * Math.PI * m.radius, doc) }; }
      if (m.offset) { const q = offsetPoly(p, m.offset / doc.unit.uf); return { main: fmtArea(polyArea(q), doc), num: polyArea(q) * doc.unit.uf ** 2, kind: 'area', sub: tr('原面积 {0}　偏移 {1}{2} mm', fmtArea(polyArea(p), doc), m.offset > 0 ? '+' : '', m.offset), poly: q }; }
      const hole = (m.holes || []).reduce((a, h) => a + polyArea(h), 0);
      return { main: fmtArea(polyArea(p) - hole, doc), num: (polyArea(p) - hole) * doc.unit.uf ** 2, kind: 'area', sub: tr('周长 ') + fmtLen(polyLen(p, true), doc) + (hole ? tr('　已扣孤岛 {0} 个', m.holes.length) : '') };
    }
    case 'angle': return { main: angleAt(p[0], p[1], p[2]).toFixed(2) + '°', num: angleAt(p[0], p[1], p[2]), kind: 'angle', sub: '' };
    case 'radius': { const r = dist(p[0], p[1]); return { main: 'R ' + fmtLen(r, doc), num: r * doc.unit.uf, kind: 'radius', sub: tr('直径 ') + fmtLen(r * 2, doc) }; }
    case 'coord': return { main: `X ${p[0][0].toFixed(3)}`, sub: `Y ${p[0][1].toFixed(3)}`, kind: 'coord', num: null };
    case 'lin': { const v = m.orient === 'v' ? Math.abs(p[1][1] - p[0][1]) : Math.abs(p[1][0] - p[0][0]); return withExpand({ main: fmtLen(v, doc), num: v * doc.unit.uf, kind: 'len', sub: m.orient === 'v' ? tr('竖直方向') : tr('水平方向') }, m, doc); }
    case 'side': { const l = polyLen(p); const a = l * doc.unit.uf * (m.height || 0); return { main: fmtAreaMm(a, doc), num: a, kind: 'area', sub: tr('长 {0} × 高 {1}', fmtLen(l, doc), fmtLen((m.height || 0) / doc.unit.uf, doc)) }; }
    case 'arclen': return withExpand({ main: fmtLen(m.len, doc), num: m.len * doc.unit.uf, kind: 'len', sub: CK_NAME()[m.ck] || '' }, m, doc);
    case 'seglen': return withExpand({ main: fmtLen(m.len, doc), num: m.len * doc.unit.uf, kind: 'len', sub: tr('{0} 段', m.segs.length) }, m, doc);
    case 'batch': { const t = m.items.reduce((a, x) => a + x.len, 0); return withExpand({ main: fmtLen(t, doc), num: t * doc.unit.uf, kind: 'len', sub: tr('{0} 条线', m.items.length) }, m, doc); }
    case 'p2l': { const v = dist(p[2], p[3]); return { main: fmtLen(v, doc), num: v * doc.unit.uf, kind: 'len', sub: tr('点到直线的垂直距离') }; }
    case 'stake': return { main: fmtLen(m.len, doc), num: m.len * doc.unit.uf, kind: 'len', sub: tr('间距 {0}，共 {1} 个点', fmtLen(m.iv, doc), m.st.length) };
    case 'circle': { const r = dist(p[0], p[1]); return { main: fmtArea(Math.PI * r * r, doc), num: Math.PI * r * r * doc.unit.uf ** 2, kind: 'area', sub: `R ${fmtLen(r, doc)}　D ${fmtLen(2 * r, doc)}　` + tr('周长 ') + fmtLen(2 * Math.PI * r, doc), r }; }
  }
  return { main: '', sub: '' };
}
const spName = (sp) => (sp && sp.key === '*MODEL_SPACE' ? tr('模型') : sp ? sp.name : '');
const catName = (c) => (!c || c === '默认分类' ? tr('默认分类') : c);
const paren = (x) => (LANG === 'zh' ? `（${x}）` : ` (${x})`);
const TYPE_NAME = { dist: tr('对齐'), lin: tr('线性'), poly: tr('连续'), area: tr('面积'), angle: tr('角度'), radius: tr('半径'), coord: tr('坐标'), boxlen: tr('框选总长'), count: tr('数量'), side: tr('侧面积'), arclen: tr('弧长'), seglen: tr('分段长度'), batch: tr('批量长度'), p2l: tr('点到线'), stake: tr('定距'), circle: tr('测量圆') };
function addItem(kind, item) {
  const d = state.cur; item.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); item.space = spaceKey();
  (kind === 'm' ? d.measures : d.annots).push(item);
  pushUndo(d, { op: 'add', kind, item });
  saveSidecar(d); if (state.side === 'stats') refreshSide();
  redraw();
}
function removeItem(kind, item, record = true) {
  const d = state.cur; const arr = kind === 'm' ? d.measures : d.annots;
  const i = arr.indexOf(item); if (i < 0) return;
  arr.splice(i, 1);
  if (record) pushUndo(d, { op: 'del', kind, item, at: i });
  saveSidecar(d); if (state.side === 'stats') refreshSide(); redraw();
}
function pushUndo(d, u) { d.undo.push(u); d.redo = []; }
// 执行一条撤销记录，返回它的反向记录（供恢复/再撤销）
function applyRec(d, u) {
  if (u.op === 'text') {
    const cur = d.textEdits[u.hd];
    if (u.old === undefined) delete d.textEdits[u.hd]; else d.textEdits[u.hd] = u.old;
    for (const sp of d.scene.spaces) for (const t of sp.texts) if (t.hd === u.hd && t._orig !== undefined && u.old === undefined) { t.s = t._orig; t.sr = t._origSr; t.sg = t._origSg; t._w = undefined; t._wl = undefined; }
    applyTextEdits(d); return { op: 'text', hd: u.hd, old: cur };
  }
  if (u.op === 'move') { const inv = { op: 'move', item: u.item, old: u.item.pts, oldHoles: u.item.holes }; u.item.pts = u.old; if (u.oldHoles) u.item.holes = u.oldHoles; return inv; }
  if (u.op === 'props') { const old = {}; for (const k of Object.keys(u.old)) old[k] = u.item[k]; Object.assign(u.item, u.old); return { op: 'props', item: u.item, old }; }
  const arr = u.kind === 'm' ? d.measures : d.annots;
  if (u.op === 'add') { const i = arr.indexOf(u.item); if (i >= 0) arr.splice(i, 1); return { op: 'del', kind: u.kind, item: u.item, at: i < 0 ? arr.length : i }; }
  arr.splice(Math.min(u.at, arr.length), 0, u.item); return { op: 'add', kind: u.kind, item: u.item };
}
function undo() {
  const d = state.cur; if (!d || d.kind !== 'drawing') return;
  if (state.tmp.length) { state.tmp.pop(); for (const i of [...state.tmpArc]) if (i >= state.tmp.length) state.tmpArc.delete(i); state.arcPending = state.tmpArc.has(state.tmp.length - 1); redraw(); return; }
  const u = d.undo.pop(); if (!u) { toast(tr('没有可撤销的操作')); return; }
  (d.redo = d.redo || []).push(applyRec(d, u));
  saveSidecar(d); if (state.side === 'stats') refreshSide(); redraw();
}
function redo() {
  const d = state.cur; if (!d || d.kind !== 'drawing') return;
  const u = (d.redo || []).pop(); if (!u) { toast(tr('没有可恢复的操作')); return; }
  d.undo.push(applyRec(d, u));
  saveSidecar(d); if (state.side === 'stats') refreshSide(); redraw();
}

// ---------------- 测量与批注：绘制 ----------------
function accent() { return R.bg === 'white' ? '#e07b00' : '#ffc531'; }
function drawOverlays(d, M) {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (d.kind === 'drawing') {
    const key = spaceKey();
    if (!state.hideMarks) {
      for (const a of d.annots) if (a.space === key) drawAnnot(a, a === state.hover?.item);
      for (const m of d.measures) if (m.space === key) { try { drawMeasure(m, m === state.hover?.item || m.id === state.selMeasure); } catch (e) { console.warn('measure', m.type, e); } }
    }
    drawTemp();
  }
  if (state.flash && state.flash.doc === d && state.flash.until > performance.now()) {
    const f = state.flash; const a = toScreen(f.bb[0], f.bb[1]), b = toScreen(f.bb[2], f.bb[3]);
    const pad = 6 * DPR;
    ctx.strokeStyle = '#ff3b8d'; ctx.lineWidth = 2.5 * DPR;
    ctx.strokeRect(Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.abs(b[0] - a[0]) + pad * 2, Math.abs(b[1] - a[1]) + pad * 2);
    setTimeout(redraw, 120);
  }
  if (state.findBox && state.side === 'find' && state.findBox.space === spaceKey() && d.kind === 'drawing') {
    const fb = state.findBox.bb; const a = toScreen(fb[0], fb[1]), b = toScreen(fb[2], fb[3]);
    ctx.save(); ctx.strokeStyle = '#2f9bff'; ctx.lineWidth = 1.5 * DPR; ctx.setLineDash([8 * DPR, 4 * DPR]); ctx.strokeRect(a[0], b[1], b[0] - a[0], a[1] - b[1]); ctx.restore();
  }
  // 捕捉标记
  if (state.snapPt) {
    const [sx, sy] = toScreen(state.snapPt[0], state.snapPt[1]); const r = 6 * DPR; const t = state.snapPt[2];
    ctx.strokeStyle = '#00e1ff'; ctx.lineWidth = 2 * DPR; ctx.beginPath();
    if (t === 1 || t === 5) ctx.rect(sx - r, sy - r, r * 2, r * 2);
    else if (t === 2) { ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r, sy + r * .8); ctx.lineTo(sx - r, sy + r * .8); ctx.closePath(); }
    else if (t === 3) ctx.arc(sx, sy, r, 0, Math.PI * 2);
    else { ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r, sy); ctx.lineTo(sx, sy + r); ctx.lineTo(sx - r, sy); ctx.closePath(); }
    ctx.stroke();
  }
  // 窗口缩放框
  if (state.drag && state.drag.box) {
    const b = state.drag; ctx.strokeStyle = accent(); ctx.lineWidth = 1.5 * DPR; ctx.setLineDash([6 * DPR, 4 * DPR]);
    ctx.fillStyle = 'rgba(255,197,49,.08)';
    ctx.fillRect(b.x0, b.y0, b.x - b.x0, b.y - b.y0); ctx.strokeRect(b.x0, b.y0, b.x - b.x0, b.y - b.y0); ctx.setLineDash([]);
  }
  ctx.restore();
}
function label(text, x, y, opt = {}) {
  const fs = 12.5 * DPR;
  ctx.font = `600 ${fs}px "Noto Sans SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
  const lines = String(text).split('\n');
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 10 * DPR, h = lines.length * fs * 1.3 + 6 * DPR;
  const bx = x - w / 2, by = y - h - 6 * DPR;
  ctx.fillStyle = opt.bg || (R.bg === 'white' ? 'rgba(255,255,255,.92)' : 'rgba(18,24,33,.88)');
  ctx.strokeStyle = opt.color || accent(); ctx.lineWidth = 1 * DPR;
  ctx.beginPath(); ctx.roundRect(bx, by, w, h, 4 * DPR); ctx.fill(); ctx.stroke();
  ctx.fillStyle = opt.ink || (R.bg === 'white' ? '#1f2733' : '#ffffff'); ctx.textBaseline = 'top'; ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, x, by + 3 * DPR + i * fs * 1.3));
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  return [bx, by, w, h];
}
function dot(p, c) { ctx.fillStyle = c; ctx.fillRect(p[0] - 3 * DPR, p[1] - 3 * DPR, 6 * DPR, 6 * DPR); }
// ---- CAD 样式的尺寸线与引线 ----
const MFONT = '"Noto Sans SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
function mColor(hi, d = state.cur) { return hi ? '#ff3b8d' : (d && d.unit && d.unit.color) || (R.bg === 'white' ? '#d9480f' : '#ff8a3d'); }
function tsNow() { const d = state.cur; return ((d && d.unit && d.unit.ts) || 13) * DPR / view().s; } // 文字高度（图纸单位），随图缩放
function loNow() { const s = view().s; return [30 * DPR / s, 24 * DPR / s]; }
function mPx(m) { return Math.min(m.ts ? m.ts * view().s : 13 * DPR, 600 * DPR); }
function readAng(a) { while (a > Math.PI / 2 + 1e-9) a -= Math.PI; while (a <= -Math.PI / 2 + 1e-9) a += Math.PI; return a; }
function bboxOf(pts) { const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); const x0 = Math.min(...xs), y0 = Math.min(...ys); return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0]; }
// 旋转文字，(x,y) 为对齐点、文字底边；返回屏幕上的外包框
function rotText(str, x, y, ang, px, color, align = 'center') {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.font = `${px}px ${MFONT}`; ctx.textAlign = align; ctx.textBaseline = 'bottom';
  const w = ctx.measureText(str).width;
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2 * DPR, px * 0.2); ctx.strokeStyle = R.bg === 'white' ? 'rgba(255,255,255,.9)' : 'rgba(0,0,0,.8)';
  ctx.strokeText(str, 0, 0); ctx.fillStyle = color; ctx.fillText(str, 0, 0); ctx.restore();
  const x0 = align === 'center' ? -w / 2 : align === 'right' ? -w : 0, c = Math.cos(ang), sn = Math.sin(ang);
  return bboxOf([[x0, -px * 1.15], [x0 + w, -px * 1.15], [x0 + w, 0], [x0, 0]].map(([u, v]) => [x + u * c - v * sn, y + u * sn + v * c]));
}
// 尺寸线：A、B 为被测两点，A2、B2 为尺寸线两端（屏幕坐标）
function dimLines(A, B, A2, B2, txt, c, px, tick = 'oblique') {
  const ext = Math.max(3 * DPR, px * 0.45), gap = 2 * DPR;
  ctx.beginPath();
  for (const [P, Q] of [[A, A2], [B, B2]]) { const d = dist(P, Q); if (d > gap + 1) { const v = [(Q[0] - P[0]) / d, (Q[1] - P[1]) / d]; ctx.moveTo(P[0] + v[0] * gap, P[1] + v[1] * gap); ctx.lineTo(Q[0] + v[0] * ext, Q[1] + v[1] * ext); } }
  ctx.moveTo(A2[0], A2[1]); ctx.lineTo(B2[0], B2[1]); ctx.stroke();
  const L2 = dist(A2, B2) || 1, u = [(B2[0] - A2[0]) / L2, (B2[1] - A2[1]) / L2], n = [-u[1], u[0]];
  const t = Math.max(4 * DPR, px * 0.5);
  if (tick === 'arrow') {
    for (const [P, sg] of [[A2, 1], [B2, -1]]) { ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(P[0] + sg * u[0] * t * 1.4 + n[0] * t * 0.35, P[1] + sg * u[1] * t * 1.4 + n[1] * t * 0.35); ctx.lineTo(P[0] + sg * u[0] * t * 1.4 - n[0] * t * 0.35, P[1] + sg * u[1] * t * 1.4 - n[1] * t * 0.35); ctx.closePath(); ctx.fill(); }
  } else {
    const d45 = [(u[0] + n[0]) * t * 0.5, (u[1] + n[1]) * t * 0.5];
    ctx.beginPath(); for (const P of [A2, B2]) { ctx.moveTo(P[0] - d45[0], P[1] - d45[1]); ctx.lineTo(P[0] + d45[0], P[1] + d45[1]); } ctx.stroke();
  }
  const ang = readAng(Math.atan2(u[1], u[0])); const mid = [(A2[0] + B2[0]) / 2, (A2[1] + B2[1]) / 2];
  const up = [Math.sin(ang), -Math.cos(ang)];
  if (px < 5 * DPR) return [mid[0] - 5 * DPR, mid[1] - 5 * DPR, 10 * DPR, 10 * DPR];
  return rotText(txt, mid[0] + up[0] * px * 0.18, mid[1] + up[1] * px * 0.18, ang, px, c);
}
// 对齐尺寸：尺寸线平行于 AB，经过 D（D 为空时压在 AB 上）
function drawDim(A, B, D, txt, c, px, tick) {
  const L0 = dist(A, B); const u = L0 ? [(B[0] - A[0]) / L0, (B[1] - A[1]) / L0] : [1, 0]; const n = [-u[1], u[0]];
  const off = D ? (D[0] - A[0]) * n[0] + (D[1] - A[1]) * n[1] : 0;
  return dimLines(A, B, [A[0] + n[0] * off, A[1] + n[1] * off], [B[0] + n[0] * off, B[1] + n[1] * off], txt, c, px, tick);
}
// 引线标注：从锚点引出折线，文字写在水平基线上方
function leader(anchor, lines, m, c, px) {
  const s = view().s; const lo = m.lo || loNow();
  const T = [anchor[0] + lo[0] * s, anchor[1] - lo[1] * s];
  lines = lines.filter(Boolean);
  ctx.font = `${px}px ${MFONT}`; const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + px * 0.4;
  const right = lo[0] >= 0; const x0 = right ? T[0] : T[0] - w;
  ctx.beginPath(); ctx.moveTo(anchor[0], anchor[1]); ctx.lineTo(T[0], T[1]); ctx.lineTo(right ? T[0] + w : T[0] - w, T[1]); ctx.stroke();
  ctx.beginPath(); ctx.arc(anchor[0], anchor[1], Math.max(2 * DPR, Math.min(px * 0.16, 8 * DPR)), 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
  if (px < 5 * DPR) return [T[0] - 5 * DPR, T[1] - 5 * DPR, 10 * DPR, 10 * DPR];
  const lh = px * 1.3;
  lines.forEach((l, i) => rotText(l, x0 + px * 0.2, T[1] - (lines.length - 1 - i) * lh - px * 0.1, 0, px, c, 'left'));
  return [x0, T[1] - lines.length * lh - px * 0.15, w, lines.length * lh + px * 0.3];
}
function strokePts(P, closed) { ctx.beginPath(); P.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (closed) ctx.closePath(); ctx.stroke(); }
function drawMeasure(m, hi) {
  const d = state.cur; const c = mColor(hi); const px = mPx(m); const tick = d.unit.tick || 'oblique';
  const S = (q) => toScreen(...L(q));
  const P = m.pts.map(S);
  ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = (hi ? 2.2 : 1.3) * DPR; ctx.setLineDash([]);
  const val = measureValue(m);
  const note = m.note ? '  ' + m.note : '';
  const small = px * 0.8;
  const segTexts = (pts) => { for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1]; const ls = dist(a, b); if (ls < small * 4 || small < 5 * DPR) continue; const wl = dist(L(m.pts[i]), L(m.pts[i + 1])); const ang = readAng(Math.atan2(b[1] - a[1], b[0] - a[0])); rotText(fmtLen(wl), (a[0] + b[0]) / 2 + Math.sin(ang) * small * 0.2, (a[1] + b[1]) / 2 - Math.cos(ang) * small * 0.2, ang, small, c); } };
  switch (m.type) {
    case 'dist': m._lb = drawDim(P[0], P[1], P[2] || null, val.main + note, c, px, tick); break;
    case 'lin': {
      const [A2, B2] = linEnds(m.pts.map(L), m.orient).map(q => toScreen(q[0], q[1]));
      m._lb = dimLines(P[0], P[1], A2, B2, val.main + note, c, px, tick); break;
    }
    case 'poly': case 'side':
      strokePts(P); segTexts(P);
      m._lb = leader(P[P.length - 1], [(m.type === 'side' ? tr('侧面积 ') : tr('总长 ')) + val.main + note, m.type === 'side' ? val.sub : (m.height ? val.sub : '')], m, c, px); break;
    case 'area': {
      if (m.offset) { const q = val.poly.map(S); ctx.save(); ctx.setLineDash([4 * DPR, 3 * DPR]); strokePts(q, true); ctx.restore(); }
      ctx.beginPath(); P.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath();
      for (const hl of m.holes || []) { hl.forEach((q, i) => { const sq = S(q); i ? ctx.lineTo(sq[0], sq[1]) : ctx.moveTo(sq[0], sq[1]); }); ctx.closePath(); }
      ctx.save(); ctx.globalAlpha = 0.16; ctx.fill('evenodd'); ctx.restore(); ctx.stroke();
      let cx = 0, cy = 0; P.forEach(q => { cx += q[0]; cy += q[1]; }); cx /= P.length; cy /= P.length;
      m._lb = leader([cx, cy], [tr('面积 ') + val.main + note, val.sub], m, c, px); break;
    }
    case 'angle': {
      const [v, a, b] = P;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(v[0], v[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      const r = Math.max(26 * DPR, px * 2.5); let t0 = Math.atan2(a[1] - v[1], a[0] - v[0]), t1 = Math.atan2(b[1] - v[1], b[0] - v[0]);
      let dt = t1 - t0; while (dt > Math.PI) dt -= Math.PI * 2; while (dt < -Math.PI) dt += Math.PI * 2;
      ctx.beginPath(); ctx.arc(v[0], v[1], r, t0, t0 + dt, dt < 0); ctx.stroke();
      const tm = t0 + dt / 2; const q = [v[0] + Math.cos(tm) * (r + px * 0.3), v[1] + Math.sin(tm) * (r + px * 0.3)];
      m._lb = px < 5 * DPR ? [q[0] - 5, q[1] - 5, 10, 10] : rotText(val.main + note, q[0], q[1] + px * 0.5, 0, px, c); break;
    }
    case 'radius': case 'circle': {
      const [o, q] = P; const r = dist(o, q);
      if (m.type === 'radius') ctx.setLineDash([5 * DPR, 4 * DPR]);
      ctx.beginPath(); ctx.arc(o[0], o[1], r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); dot(o, c);
      m._lb = leader(q, m.type === 'radius' ? [val.main + note, val.sub] : [tr('面积 ') + val.main + note, val.sub], m, c, px); break;
    }
    case 'boxlen': {
      const [a, b] = P; ctx.setLineDash([7 * DPR, 4 * DPR]); ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); ctx.setLineDash([]);
      m._lb = leader([Math.max(a[0], b[0]), Math.min(a[1], b[1])], [tr('总长 ') + val.main + note, val.sub], m, c, px); break;
    }
    case 'count':
      ctx.lineWidth = 1.5 * DPR;
      for (const bx of m.boxes || []) { const a = S([bx[0], bx[1]]), b = S([bx[2], bx[3]]); ctx.strokeRect(Math.min(a[0], b[0]) - 2, Math.min(a[1], b[1]) - 2, Math.abs(b[0] - a[0]) + 4, Math.abs(b[1] - a[1]) + 4); }
      m._lb = leader(P[0], [tr('{0}：{1} 个', m.name, m.n) + note], m, c, px); break;
    case 'coord': {
      const q = P[0]; ctx.beginPath(); ctx.moveTo(q[0] - 8 * DPR, q[1]); ctx.lineTo(q[0] + 8 * DPR, q[1]); ctx.moveTo(q[0], q[1] - 8 * DPR); ctx.lineTo(q[0], q[1] + 8 * DPR); ctx.stroke();
      m._lb = leader(q, ['X=' + m.pts[0][0].toFixed(3), 'Y=' + m.pts[0][1].toFixed(3), m.note], m, c, px); break;
    }
    case 'arclen': {
      ctx.lineWidth = (hi ? 3 : 2.2) * DPR; strokePts(P); ctx.lineWidth = 1.3 * DPR;
      m._lb = leader(S(m.mid), [tr('弧长 ') + val.main + note, val.sub], m, c, px); break;
    }
    case 'seglen': {
      ctx.lineWidth = (hi ? 3 : 2) * DPR; strokePts(P); ctx.lineWidth = 1.3 * DPR;
      ctx.font = `${small}px ${MFONT}`;
      for (const sg of m.segs) { const q = S(sg.mid); const ang = readAng(scrAng(L(sg.mid), sg.ang)); const t0 = fmtLen(sg.len); if (small >= 5 * DPR && sg.len * view().s > ctx.measureText(t0).width * 1.15) rotText(fmtLen(sg.len), q[0] + Math.sin(ang) * small * 0.2, q[1] - Math.cos(ang) * small * 0.2, ang, small, c); dot(S(sg.a), c); }
      m._lb = leader(P[P.length - 1], [tr('总长 ') + val.main + note, val.sub], m, c, px); break;
    }
    case 'batch': {
      ctx.lineWidth = (hi ? 3 : 2) * DPR;
      for (const it of m.items) { const Q = it.pts.map(S); strokePts(Q); const q = S(it.mid); const ang = readAng(scrAng(L(it.mid), it.ang)); if (small >= 5 * DPR) rotText(fmtLen(it.len), q[0] + Math.sin(ang) * small * 0.2, q[1] - Math.cos(ang) * small * 0.2, ang, small, c); }
      ctx.lineWidth = 1.3 * DPR;
      m._lb = leader(P[0], [tr('合计 ') + val.main + note, val.sub], m, c, px); break;
    }
    case 'p2l': {
      const [A, B, Q, F] = P;
      ctx.save(); ctx.setLineDash([5 * DPR, 4 * DPR]); const near = dist(A, F) < dist(B, F) ? A : B; ctx.beginPath(); ctx.moveTo(near[0], near[1]); ctx.lineTo(F[0], F[1]); ctx.stroke(); ctx.restore();
      const l = dist(Q, F) || 1, u = [(Q[0] - F[0]) / l, (Q[1] - F[1]) / l], v = [(A[0] - B[0]), (A[1] - B[1])]; const lv = Math.hypot(...v) || 1; const k = 8 * DPR;
      ctx.beginPath(); ctx.moveTo(F[0] + u[0] * k, F[1] + u[1] * k); ctx.lineTo(F[0] + u[0] * k + v[0] / lv * k, F[1] + u[1] * k + v[1] / lv * k); ctx.lineTo(F[0] + v[0] / lv * k, F[1] + v[1] / lv * k); ctx.stroke();
      m._lb = drawDim(Q, F, null, val.main + note, c, px, tick); break;
    }
    case 'stake': {
      ctx.lineWidth = (hi ? 3 : 2) * DPR; strokePts(P); ctx.lineWidth = 1.3 * DPR;
      let lastQ = null;
      for (const st of m.st) { const q = S(st.p); const showLb = !lastQ || dist(lastQ, q) > small * 1.6; if (showLb) lastQ = q; const a = scrAng(L(st.p), st.ang); const n = [-Math.sin(a), Math.cos(a)]; const k = Math.max(5 * DPR, small * 0.7);
        ctx.beginPath(); ctx.moveTo(q[0] - n[0] * k, q[1] - n[1] * k); ctx.lineTo(q[0] + n[0] * k, q[1] + n[1] * k); ctx.stroke();
        if (small >= 5 * DPR && showLb) { const ang = readAng(a + Math.PI / 2); rotText(chainage(st.d + (m.k0 || 0), state.cur), q[0] + n[0] * k * 1.2, q[1] + n[1] * k * 1.2, ang, small, c, 'left'); } }
      m._lb = leader(P[P.length - 1], [tr('定距 ') + fmtLen(m.iv) + note, tr('全长 ') + val.main], m, c, px); break;
    }
  }
}
function drawAnnot(a, hi) {
  const s = view().s;
  const c = hi ? '#ff3b8d' : (a.color || '#ff3030');
  ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 2 * DPR; ctx.setLineDash([]);
  const P = a.pts.map(p => toScreen(...L(p)));
  if (a.type === 'rect' || a.type === 'cloud') {
    const x0 = Math.min(P[0][0], P[1][0]), x1 = Math.max(P[0][0], P[1][0]), y0 = Math.min(P[0][1], P[1][1]), y1 = Math.max(P[0][1], P[1][1]);
    if (a.type === 'rect') ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    else cloudPath(x0, y0, x1, y1, Math.max(6 * DPR, (a.arc || 0) * s));
  } else if (a.type === 'arrow') {
    const [p, q] = P; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]), hs = 14 * DPR;
    ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q[0] - hs * Math.cos(ang - 0.4), q[1] - hs * Math.sin(ang - 0.4)); ctx.lineTo(q[0] - hs * Math.cos(ang + 0.4), q[1] - hs * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill();
    if (a.text) a._lb = annotText(a.text, p[0], p[1], a, s, c);
  }
  if (a.type === 'text') a._lb = annotText(a.text, P[0][0], P[0][1], a, s, c);
  if (a.type === 'line') { ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); ctx.lineTo(P[1][0], P[1][1]); ctx.stroke(); }
  if (a.type === 'num') {
    const r = Math.max(9 * DPR, Math.min((a.size || 0) * s * 0.75, 300 * DPR));
    ctx.beginPath(); ctx.arc(P[0][0], P[0][1], r, 0, Math.PI * 2); ctx.fillStyle = R.bg === 'white' ? '#fff' : '#000'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = c; ctx.font = `600 ${r * 1.1}px "Noto Sans SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(a.text, P[0][0], P[0][1] + r * 0.05); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    a._lb = [P[0][0] - r, P[0][1] - r, r * 2, r * 2];
  }
}
function annotText(text, x, y, a, s, c) {
  const fs = Math.max(9 * DPR, Math.min((a.size || 0) * s, 400 * DPR));
  ctx.font = `${fs}px "Noto Sans SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`; ctx.textBaseline = 'top';
  const lines = String(text).split('\n'); const w = Math.max(...lines.map(l => ctx.measureText(l).width));
  const bg = R.bg === 'white' ? 'rgba(255,255,255,.8)' : 'rgba(0,0,0,.6)';
  ctx.fillStyle = bg; ctx.fillRect(x - 3, y - 2, w + 6, lines.length * fs * 1.25 + 4);
  ctx.fillStyle = c; lines.forEach((l, i) => ctx.fillText(l, x, y + i * fs * 1.25)); ctx.textBaseline = 'alphabetic';
  return [x - 3, y - 2, w + 6, lines.length * fs * 1.25 + 4];
}
function cloudPath(x0, y0, x1, y1, r) {
  const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return;
  const nx = Math.max(2, Math.round(w / (r * 1.6))), ny = Math.max(2, Math.round(h / (r * 1.6)));
  const pts = [];
  for (let i = 0; i < nx; i++) pts.push([x0 + w * i / nx, y0]);
  for (let i = 0; i < ny; i++) pts.push([x1, y0 + h * i / ny]);
  for (let i = 0; i < nx; i++) pts.push([x1 - w * i / nx, y1]);
  for (let i = 0; i < ny; i++) pts.push([x0, y1 - h * i / ny]);
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, rr = dist(a, b) / 2;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (i === 0) ctx.moveTo(a[0], a[1]);
    ctx.arc(mx, my, rr, ang + Math.PI, ang, false);
  }
  ctx.stroke();
}
function drawTemp() {
  const t = state.tool; if (!t || !state.mouse) return;
  const cur = state.cursorLocal; const P = state.tmp.map(p => toScreen(p[0], p[1]));
  const cs = cur ? toScreen(cur[0], cur[1]) : null;
  const c = '#00e1ff'; ctx.strokeStyle = c; ctx.lineWidth = 1.5 * DPR; ctx.setLineDash([6 * DPR, 4 * DPR]);
  const live = (txt) => { if (cs) showTip(txt, cs[0] / DPR, cs[1] / DPR); };
  const px0 = (state.cur.unit.ts || 13) * DPR;
  if ((t === 'dist' || t === 'lin') && P.length === 2 && cs) {
    ctx.setLineDash([]); ctx.fillStyle = c;
    const a = state.tmp[0], b = state.tmp[1];
    if (t === 'dist') { drawDim(P[0], P[1], cs, fmtLen(dist(a, b)), c, px0, state.cur.unit.tick); live(fmtLen(dist(a, b)) + tr('　单击放置尺寸线')); }
    else { const o = linOrient(a, b, cur); const [A2, B2] = linEnds([a, b, cur], o).map(q => toScreen(q[0], q[1])); const v = o === 'v' ? Math.abs(b[1] - a[1]) : Math.abs(b[0] - a[0]); dimLines(P[0], P[1], A2, B2, fmtLen(v), c, px0, state.cur.unit.tick); live((o === 'v' ? tr('竖直 ') : tr('水平 ')) + fmtLen(v)); }
  } else if (['dist', 'lin', 'poly', 'side', 'area', 'calib'].includes(t) && P.length && cs) {
    let pts = [...state.tmp, cur];
    if (t === 'area' && state.tmpArc.size) { const mids = new Set(state.tmpArc); pts = flattenArcs(pts, mids); }
    const SP = pts.map(q => toScreen(q[0], q[1]));
    ctx.beginPath(); SP.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    if (t === 'area' && SP.length > 2) ctx.lineTo(SP[0][0], SP[0][1]);
    ctx.stroke(); P.forEach(p => dot(p, c));
    if (t === 'dist' || t === 'lin' || t === 'calib') live(fmtLen(dist(pts[0], pts[pts.length - 1])));
    else if (t === 'poly' || t === 'side') live(tr('累计 ') + fmtLen(polyLen(pts)));
    else if (t === 'area') live((state.arcMode ? (state.arcPending ? tr('[弧] 点弧的终点　') : tr('[弧] 点弧上一点　')) : '') + (pts.length > 2 ? fmtArea(polyArea(pts)) + tr('　周长 ') + fmtLen(polyLen(pts, true)) : tr('继续点取顶点')));
  } else if (t === 'rectarea' && P.length && cs) {
    ctx.strokeRect(P[0][0], P[0][1], cs[0] - P[0][0], cs[1] - P[0][1]);
    const a = state.tmp[0]; live(fmtArea(Math.abs(cur[0] - a[0]) * Math.abs(cur[1] - a[1])) + '　' + fmtLen(Math.abs(cur[0] - a[0])) + ' × ' + fmtLen(Math.abs(cur[1] - a[1])));
  } else if (CURVE_TOOLS.has(t) && !(t === 'p2l' && state.tmp.length)) {
    const sp = curSpace();
    if (t === 'batch') { ctx.setLineDash([]); ctx.lineWidth = 3 * DPR; ctx.strokeStyle = '#00e1ff'; for (const ci of state.batchSel) strokeCurveScreen(sp, ci); }
    const hc = state.hoverCurve;
    if (hc) { ctx.setLineDash([]); ctx.lineWidth = 3 * DPR; ctx.strokeStyle = '#ff3b8d'; if (t === 'p2l') strokePts([hc.a, hc.b].map(q => toScreen(q[0], q[1]))); else strokeCurveScreen(sp, hc.ci); const kind = sp.cinfo[hc.ci * 3 + 2], len = sp.curves[hc.ci * 6]; live(t === 'p2l' ? tr('单击选这条线') : (CK_NAME()[kind] || '') + ' ' + fmtLen(len) + (t === 'batch' ? tr('　已选 {0} 条', state.batchSel.length) : '')); }
    else if (t === 'batch' && state.batchSel.length) live(tr('已选 {0} 条，合计 {1}　右键或回车完成', state.batchSel.length, fmtLen(state.batchSel.reduce((a, ci) => a + sp.curves[ci * 6], 0))));
    else hideTip();
  } else if (t === 'p2l' && state.p2lSeg && cs) {
    const [a, b] = state.p2lSeg; const f = footOn(cur, a, b); const F = toScreen(f[0], f[1]);
    ctx.setLineDash([]); ctx.lineWidth = 2.5 * DPR; ctx.strokeStyle = '#ff3b8d'; strokePts([a, b].map(q => toScreen(q[0], q[1])));
    ctx.strokeStyle = c; ctx.lineWidth = 1.5 * DPR; ctx.setLineDash([6 * DPR, 4 * DPR]); strokePts([cs, F]); live(fmtLen(dist(cur, f)));
  } else if (t === 'circle') {
    const hh = state.hoverCircle;
    if (hh) { const o = toScreen(hh[0], hh[1]); ctx.setLineDash([]); ctx.lineWidth = 2.5 * DPR; ctx.strokeStyle = '#ff3b8d'; ctx.beginPath(); ctx.arc(o[0], o[1], hh[2] * view().s, 0, Math.PI * 2); ctx.stroke(); live('R ' + fmtLen(hh[2]) + '　' + tr('面积 ') + fmtArea(Math.PI * hh[2] * hh[2])); }
    else hideTip();
  } else if (t === 'angle' && P.length && cs) {
    ctx.beginPath();
    if (P.length === 1) { ctx.moveTo(P[0][0], P[0][1]); ctx.lineTo(cs[0], cs[1]); live(tr('再点第一条边')); }
    else { ctx.moveTo(P[1][0], P[1][1]); ctx.lineTo(P[0][0], P[0][1]); ctx.lineTo(cs[0], cs[1]); live(angleAt(state.tmp[0], state.tmp[1], cur).toFixed(2) + '°'); }
    ctx.stroke();
  } else if (t === 'radius') {
    const h = state.hoverCircle;
    if (h) { const o = toScreen(h[0], h[1]); ctx.setLineDash([]); ctx.lineWidth = 2.5 * DPR; ctx.strokeStyle = '#ff3b8d'; ctx.beginPath(); ctx.arc(o[0], o[1], h[2] * view().s, 0, Math.PI * 2); ctx.stroke(); live('R ' + fmtLen(h[2])); }
    else hideTip();
  } else if (t === 'areapick') {
    const g = state.hoverRegion;
    if (g) {
      ctx.setLineDash([]); ctx.fillStyle = 'rgba(0,225,255,.18)';
      if (g.circ) { const o = toScreen(g.circ[0], g.circ[1]); ctx.beginPath(); ctx.arc(o[0], o[1], Math.abs(g.circ[2] * view().s), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      else { ctx.beginPath(); for (const r of [g.outer, ...g.holes]) { for (let i = 0; i < r.length; i += 2) { const p = toScreen(r[i], r[i + 1]); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); } ctx.closePath(); } ctx.fill('evenodd'); ctx.stroke(); }
      live(fmtArea(g.area) + (g.holes.length ? tr('（已扣除 {0} 个孤岛）', g.holes.length) : ''));
    }
    else hideTip();
  } else if (RECT_TOOLS.has(t) && P.length && cs) {
    ctx.strokeRect(P[0][0], P[0][1], cs[0] - P[0][0], cs[1] - P[0][1]);
    if (t === 'boxlen') { const r = boxLength(state.tmp[0], cur); live(tr('总长 {0}（{1} 条）', fmtLen(r.total), r.n)); }
  } else if (t === 'count' || t === 'edittext') {
    const hb = t === 'count' ? state.hoverInsert?.b : state.hoverText?.box;
    if (hb) { ctx.setLineDash([]); ctx.strokeStyle = '#ff3b8d'; ctx.lineWidth = 2 * DPR; const a = toScreen(hb[0], hb[1]), b = toScreen(hb[2], hb[3]); ctx.strokeRect(Math.min(a[0], b[0]) - 3, Math.min(a[1], b[1]) - 3, Math.abs(b[0] - a[0]) + 6, Math.abs(b[1] - a[1]) + 6); live(t === 'count' ? tr('图块：') + state.hoverInsert.n : tr('单击修改：') + state.hoverText.t.s.slice(0, 30)); }
    else hideTip();
  } else if (['cloud', 'rect', 'arrow', 'line'].includes(t) && P.length && cs) {
    ctx.setLineDash([]); ctx.strokeStyle = '#ff3030'; ctx.lineWidth = 2 * DPR;
    if (t === 'arrow' || t === 'line') { ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); ctx.lineTo(cs[0], cs[1]); ctx.stroke(); }
    else if (t === 'rect') ctx.strokeRect(P[0][0], P[0][1], cs[0] - P[0][0], cs[1] - P[0][1]);
    else cloudPath(Math.min(P[0][0], cs[0]), Math.min(P[0][1], cs[1]), Math.max(P[0][0], cs[0]), Math.max(P[0][1], cs[1]), 14 * DPR);
  } else if (t === 'coord' && cur) live(`X ${W(cur)[0].toFixed(3)}  Y ${W(cur)[1].toFixed(3)}`);
  ctx.setLineDash([]);
}

// ---------------- 捕捉 ----------------
function snapIndex(sp) {
  if (sp._snapIdx) return sp._snapIdx;
  const s = sp.snaps; const bb = sp.bbox;
  const size = Math.max(bb[2] - bb[0], bb[3] - bb[1], 1e-9);
  const cell = size / 256; const g = new Map();
  for (let i = 0; i < s.length; i += 4) {
    const k = Math.floor((s[i] - bb[0]) / cell) * 100003 + Math.floor((s[i + 1] - bb[1]) / cell);
    let a = g.get(k); if (!a) { a = []; g.set(k, a); } a.push(i);
  }
  sp._snapIdx = { g, cell, bb };
  return sp._snapIdx;
}
function findSnap(p) {
  const sp = curSpace(); if (!sp || !sp.snaps || !sp.snaps.length) return null;
  const tol = 12 * DPR / view().s; const I = snapIndex(sp);
  if (tol > I.cell * 6) return null;
  const i0 = Math.floor((p[0] - tol - I.bb[0]) / I.cell), i1 = Math.floor((p[0] + tol - I.bb[0]) / I.cell);
  const j0 = Math.floor((p[1] - tol - I.bb[1]) / I.cell), j1 = Math.floor((p[1] + tol - I.bb[1]) / I.cell);
  let best = null, bd = tol; const s = sp.snaps;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const a = I.g.get(i * 100003 + j); if (!a) continue;
    for (const k of a) {
      if (!layerVisible(sp, s[k + 3])) continue;
      const dd = Math.hypot(s[k] - p[0], s[k + 1] - p[1]);
      // 端点/圆心优先于中点
      const w = dd * (s[k + 2] === 2 ? 1.25 : 1);
      if (w < bd) { bd = w; best = [s[k], s[k + 1], s[k + 2]]; }
    }
  }
  return best;
}
function layerVisible(sp, lid) { const n = sp.curveLayers ? sp.curveLayers[lid] : undefined; return n === undefined ? true : R.visible(n); }
function gridOf(sp, key, items, boxOf) {
  if (sp[key]) return sp[key];
  const bb = sp.bbox && Number.isFinite(sp.bbox[0]) ? sp.bbox : [0, 0, 1, 1];
  const size = Math.max(bb[2] - bb[0], bb[3] - bb[1], 1e-9);
  const cell = size / 128; const g = new Map(); const big = [];
  for (let i = 0; i < items.length; i++) {
    const b = boxOf(items[i]);
    if (!b || !Number.isFinite(b[0])) { big.push(i); continue; }
    const i0 = Math.floor((b[0] - bb[0]) / cell), i1 = Math.floor((b[2] - bb[0]) / cell);
    const j0 = Math.floor((b[1] - bb[1]) / cell), j1 = Math.floor((b[3] - bb[1]) / cell);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4) { big.push(i); continue; }
    for (let x = i0; x <= i1; x++) for (let y = j0; y <= j1; y++) { const k = x * 100003 + y; let a = g.get(k); if (!a) g.set(k, a = []); a.push(i); }
  }
  return (sp[key] = { g, big, cell, bb, items });
}
function visitGrid(I, p, fn) {
  const ix = Math.floor((p[0] - I.bb[0]) / I.cell), iy = Math.floor((p[1] - I.bb[1]) / I.cell);
  const list = I.g.get(ix * 100003 + iy); if (list) for (const i of list) fn(I.items[i]);
  for (const i of I.big) fn(I.items[i]);
}
function circleIndex(sp) {
  if (sp._ciIdx) return sp._ciIdx;
  const c = sp.circles; const bb = sp.bbox && Number.isFinite(sp.bbox[0]) ? sp.bbox : [0, 0, 1, 1];
  const size = Math.max(bb[2] - bb[0], bb[3] - bb[1], 1e-9); const cell = size / 128; const g = new Map(); const big = [];
  for (let i = 0; i < c.length; i += 4) {
    if (c[i + 2] > cell * 4) { big.push(i); continue; }
    const k = Math.floor((c[i] - bb[0]) / cell) * 100003 + Math.floor((c[i + 1] - bb[1]) / cell);
    let a = g.get(k); if (!a) g.set(k, a = []); a.push(i);
  }
  return (sp._ciIdx = { g, big, cell, bb, c });
}
function findCircle(p) {
  const sp = curSpace(); const c = sp && sp.circles; if (!c || !c.length) return null;
  const I = circleIndex(sp); const tol = 8 * DPR / view().s;
  const reach = I.cell * 4 + tol;
  const i0 = Math.floor((p[0] - reach - I.bb[0]) / I.cell), i1 = Math.floor((p[0] + reach - I.bb[0]) / I.cell);
  const j0 = Math.floor((p[1] - reach - I.bb[1]) / I.cell), j1 = Math.floor((p[1] + reach - I.bb[1]) / I.cell);
  let best = null, bd = tol;
  const test = (i) => {
    if (!layerVisible(sp, c[i + 3])) return;
    const d = Math.abs(Math.hypot(p[0] - c[i], p[1] - c[i + 1]) - c[i + 2]);
    if (d < bd) { bd = d; best = [c[i], c[i + 1], c[i + 2]]; }
  };
  for (let x = i0; x <= i1; x++) for (let y = j0; y <= j1; y++) { const a = I.g.get(x * 100003 + y); if (a) for (const i of a) test(i); }
  for (const i of I.big) test(i);
  return best;
}
function ringArea(g) { let a = 0; for (let i = 0, j = g.length - 2; i < g.length; j = i, i += 2) a += g[j] * g[i + 1] - g[i] * g[j + 1]; return Math.abs(a) / 2; }
function inRing(g, p) {
  let inside = false;
  for (let i = 0, j = g.length - 2; i < g.length; j = i, i += 2) if (((g[i + 1] > p[1]) !== (g[j + 1] > p[1])) && p[0] < (g[j] - g[i]) * (p[1] - g[i + 1]) / (g[j + 1] - g[i + 1]) + g[i]) inside = !inside;
  return inside;
}
function regionBox(g) {
  if (g._bb) return g._bb;
  if (g.circ) { const [x, y, r] = g.circ; return (g._bb = [x - r, y - r, x + r, y + r]); }
  const a = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of g.rings || []) for (let i = 0; i < r.length; i += 2) { a[0] = Math.min(a[0], r[i]); a[1] = Math.min(a[1], r[i + 1]); a[2] = Math.max(a[2], r[i]); a[3] = Math.max(a[3], r[i + 1]); }
  return (g._bb = a);
}
function regionAreaOf(g) {
  if (g._area) return g._area;
  if (g.circ) return (g._area = Math.PI * g.circ[2] * g.circ[2]);
  const areas = (g.rings || []).map(ringArea);
  if (!areas.length) return (g._area = 0);
  const oi = areas.indexOf(Math.max(...areas));
  g._outer = g.rings[oi]; g._holes = g.rings.filter((_, i) => i !== oi);
  return (g._area = areas[oi] - areas.reduce((x, y, i) => i === oi ? x : x + y, 0));
}
function findRegion(p) {
  const sp = curSpace(); if (!sp || !sp.regions) return null;
  const I = gridOf(sp, '_rgIdx', sp.regions, regionBox);
  let best = null, ba = Infinity;
  const test = (g) => {
    if (!g || !layerVisible(sp, g.l)) return;
    const b = regionBox(g); if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) return;
    if (g.circ) { if (Math.hypot(p[0] - g.circ[0], p[1] - g.circ[1]) > g.circ[2]) return; }
    else { let inside = false; for (const r of g.rings || []) if (inRing(r, p)) inside = !inside; if (!inside) return; }
    const a = regionAreaOf(g); if (a < ba) { ba = a; best = g; }
  };
  visitGrid(I, p, test);
  if (!best) return null;
  if (best.circ) return { circ: best.circ, outer: null, holes: [], area: regionAreaOf(best) };
  regionAreaOf(best);
  return { outer: best._outer, holes: best._holes, area: best._area };
}
function boxLength(a, b) {
  const sp = curSpace(); const c = sp && sp.curves;
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  let total = 0, n = 0; const lays = new Set();
  if (!c) return { total, n, layers: [] };
  const scan = () => {
    for (let i = 0; i < c.length; i += 6) {
      if (c[i + 1] >= x0 && c[i + 3] <= x1 && c[i + 2] >= y0 && c[i + 4] <= y1) { const ln = sp.curveLayers[c[i + 5]]; if (!R.visible(ln)) continue; total += c[i]; n++; lays.add(ln); }
    }
  };
  const I = curveIndex(sp);
  const i0 = I.cl(Math.floor((x0 - I.bb[0]) / I.cell)), i1 = I.cl(Math.floor((x1 - I.bb[0]) / I.cell));
  const j0 = I.cl(Math.floor((y0 - I.bb[1]) / I.cell)), j1 = I.cl(Math.floor((y1 - I.bb[1]) / I.cell));
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4000) scan();
  else {
    const seen = new Set();
    const take = (ci) => {
      if (seen.has(ci)) return; seen.add(ci);
      const i = ci * 6;
      if (c[i + 1] >= x0 && c[i + 3] <= x1 && c[i + 2] >= y0 && c[i + 4] <= y1) { const ln = sp.curveLayers[c[i + 5]]; if (!R.visible(ln)) return; total += c[i]; n++; lays.add(ln); }
    };
    for (let x = i0; x <= i1; x++) for (let y = j0; y <= j1; y++) { const l = I.g.get(x * 100003 + y); if (l) for (const ci of l) take(ci); }
    for (const ci of I.big) take(ci);
  }
  return { total, n, layers: [...lays] };
}
// 能参与数量统计的图块：普通块和按内容分组的匿名块（*ANON），不含标注、填充等内部块
function countable(n) { return /^\*ANON/.test(n) || (!/^\*/.test(n) && !/^A\$/.test(n)); }
function blockLabel(n) { return /^\*ANON\d+$/.test(n) ? tr('匿名块 {0}', n.slice(5)) : n; }
function findInsert(p) {
  const sp = curSpace(); if (!sp || !sp.inserts || !sp.inserts.length) return null;
  const I = gridOf(sp, '_inIdx', sp.inserts, it => it.b);
  let best = null, ba = Infinity;
  const test = (it) => {
    if (!it || !countable(it.n) || !layerVisible(sp, it.l)) return;
    const b = it.b; if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) return;
    const a = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    if (a < ba) { ba = a; best = it; }
  };
  visitGrid(I, p, test);
  return best;
}
function textBox(t) {
  const L0 = (t._wl || approxW(t)); const ux = t.ux, uy = t.uy, sc = Math.hypot(ux, uy) || 1;
  const w = L0 * sc; const dx = ux / sc, dy = uy / sc; const off = t.ha === 1 ? -w / 2 : t.ha === 2 ? -w : 0;
  const hh = t.h * Math.hypot(t.vx, t.vy);
  const vb = t.va === 3 ? -hh : t.va === 2 ? -hh / 2 : 0;
  const pts = [[0, 0], [w, 0], [w, hh], [0, hh]].map(([u, v]) => [t.x + (u + off) * dx - (v + vb) * dy, t.y + (u + off) * dy + (v + vb) * dx]);
  return [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))];
}
function approxW(t) {
  const s = t.sg || t.s; let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0xE001 && c <= 0xE004) w += t.h * 0.828;
    else w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? t.h : t.h * 0.72;
  }
  return w * t.wf;
}
function findText(p) {
  const sp = curSpace(); if (!sp || !sp.texts) return null;
  const I = gridOf(sp, '_txIdx', sp.texts, (t) => t._qb || (t._qb = textBox(t)));
  let best = null, ba = Infinity;
  const test = (t) => {
    if (!t || !R.visible(t.layer)) return;
    const b = t._qb || textBox(t);
    if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) return;
    const a = (b[2] - b[0]) * (b[3] - b[1]);
    if (a < ba) { ba = a; best = { t, box: b }; }
  };
  visitGrid(I, p, test);
  return best;
}
function pickItem(px, py) {
  const d = state.cur; const key = spaceKey(); const tol = 7 * DPR;
  const segHit = (P, closed) => { for (let i = 0; i + 1 < P.length + (closed ? 1 : 0); i++) { const a = P[i], b = P[(i + 1) % P.length]; if (segDist([px, py], a, b) < tol) return true; } return false; };
  const inLb = (lb) => lb && px >= lb[0] && px <= lb[0] + lb[2] && py >= lb[1] && py <= lb[1] + lb[3];
  for (const kind of ['m', 'a']) {
    const arr = kind === 'm' ? d.measures : d.annots;
    for (let i = arr.length - 1; i >= 0; i--) {
      const it = arr[i]; if (it.space !== key) continue;
      const P = it.pts.map(p => toScreen(...L(p)));
      if (inLb(it._lb)) return { kind, item: it, label: true };
      if (it.type === 'batch') { for (const x of it.items) if (segHit(x.pts.map(q => toScreen(...L(q))))) return { kind, item: it }; continue; }
      if (it.type === 'dist' || it.type === 'lin') { // 被测线段和尺寸线
        let A2, B2; const Lp = it.pts.map(L);
        if (it.type === 'lin') [A2, B2] = linEnds(Lp, it.orient).map(q => toScreen(q[0], q[1]));
        else { const [A, B] = [P[0], P[1]]; const l0 = dist(A, B) || 1; const n = [-(B[1] - A[1]) / l0, (B[0] - A[0]) / l0]; const off = P[2] ? (P[2][0] - A[0]) * n[0] + (P[2][1] - A[1]) * n[1] : 0; A2 = [A[0] + n[0] * off, A[1] + n[1] * off]; B2 = [B[0] + n[0] * off, B[1] + n[1] * off]; }
        if (segHit([P[0], P[1]]) || segHit([A2, B2])) return { kind, item: it }; continue;
      }
      if (it.type === 'p2l') { if (segHit([P[2], P[3]])) return { kind, item: it }; continue; }
      if (it.type === 'circle') { if (Math.abs(dist([px, py], P[0]) - dist(P[0], P[1])) < tol) return { kind, item: it }; continue; }
      if (it.type === 'count') { if (P.length && dist(P[0], [px, py]) < tol * 2) return { kind, item: it }; continue; }
      if (it.type === 'rect' || it.type === 'cloud' || it.type === 'boxlen') { const x0 = Math.min(P[0][0], P[1][0]), x1 = Math.max(P[0][0], P[1][0]), y0 = Math.min(P[0][1], P[1][1]), y1 = Math.max(P[0][1], P[1][1]); if (segHit([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true)) return { kind, item: it }; }
      else if (it.type === 'radius') { if (Math.abs(dist([px, py], P[0]) - dist(P[0], P[1])) < tol || segHit(P)) return { kind, item: it }; }
      else if (segHit(P, it.type === 'area')) return { kind, item: it };
      else if (P.length === 1 && dist(P[0], [px, py]) < tol * 2) return { kind, item: it };
    }
  }
  return null;
}
// ---- 点选曲线（弧长、分段、批量、定距、点到线）----
function curveIndex(sp) {
  if (sp._cIdx) return sp._cIdx;
  // 网格按图纸主体范围（去掉远处零星图元）建立，超出范围的落到边缘格子里
  const c = sp.curves, bb = sp.view || sp.bbox; const N = 256; const size = Math.max(bb[2] - bb[0], bb[3] - bb[1], 1e-9); const cell = size / N; const g = new Map(); const big = [];
  const cl = (v) => Math.max(0, Math.min(N - 1, v));
  for (let i = 0, ci = 0; i < c.length; i += 6, ci++) {
    if (!sp.cinfo || !sp.cinfo[ci * 3 + 1]) { big.push(ci); continue; }
    const i0 = cl(Math.floor((c[i + 1] - bb[0]) / cell)), i1 = cl(Math.floor((c[i + 3] - bb[0]) / cell)), j0 = cl(Math.floor((c[i + 2] - bb[1]) / cell)), j1 = cl(Math.floor((c[i + 4] - bb[1]) / cell));
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 64) { big.push(ci); continue; }
    for (let x = i0; x <= i1; x++) for (let y = j0; y <= j1; y++) { const k = x * 100003 + y; let l = g.get(k); if (!l) g.set(k, l = []); l.push(ci); }
  }
  return (sp._cIdx = { g, big, cell, bb, N, cl });
}
function pickCurve(p, filter) {
  const sp = curSpace(); if (!sp || !sp.cinfo || !sp.cpts) return null;
  const I = curveIndex(sp); const tol = 8 * DPR / view().s;
  const c = sp.curves, P = sp.cpts; let best = null, bd = tol; const seen = new Set();
  const test = (ci) => {
    if (seen.has(ci)) return; seen.add(ci);
    const i = ci * 6; if (p[0] < c[i + 1] - tol || p[0] > c[i + 3] + tol || p[1] < c[i + 2] - tol || p[1] > c[i + 4] + tol) return;
    if (!layerVisible(sp, c[i + 5])) return; const kind = sp.cinfo[ci * 3 + 2]; if (filter && !filter(kind)) return;
    const s0 = sp.cinfo[ci * 3], n = sp.cinfo[ci * 3 + 1];
    for (let k = 0; k + 1 < n; k++) { const a = [P[(s0 + k) * 2], P[(s0 + k) * 2 + 1]], b = [P[(s0 + k + 1) * 2], P[(s0 + k + 1) * 2 + 1]]; const dd = segDist(p, a, b); if (dd < bd) { bd = dd; best = { ci, seg: k, a, b }; } }
  };
  const i0 = I.cl(Math.floor((p[0] - tol - I.bb[0]) / I.cell)), i1 = I.cl(Math.floor((p[0] + tol - I.bb[0]) / I.cell)), j0 = I.cl(Math.floor((p[1] - tol - I.bb[1]) / I.cell)), j1 = I.cl(Math.floor((p[1] + tol - I.bb[1]) / I.cell));
  if ((i1 - i0 + 1) * (j1 - j0 + 1) <= 400) for (let x = i0; x <= i1; x++) for (let y = j0; y <= j1; y++) { const l = I.g.get(x * 100003 + y); if (l) for (const ci of l) test(ci); }
  for (const ci of I.big) test(ci);
  return best;
}
function curveGeom(sp, ci) {
  const s0 = sp.cinfo[ci * 3], n = sp.cinfo[ci * 3 + 1]; const pts = [], vf = [];
  for (let k = 0; k < n; k++) { pts.push([sp.cpts[(s0 + k) * 2], sp.cpts[(s0 + k) * 2 + 1]]); vf.push(sp.cvf[s0 + k]); }
  return { pts, vf, len: sp.curves[ci * 6], kind: sp.cinfo[ci * 3 + 2], layer: sp.curveLayers[sp.curves[ci * 6 + 5]] };
}
function strokeCurveScreen(sp, ci, maxPts = 800) {
  if (!sp || !sp.cinfo) return;
  const s0 = sp.cinfo[ci * 3], n = sp.cinfo[ci * 3 + 1]; if (!n) return;
  const step = Math.max(1, Math.ceil((n - 1) / maxPts));
  ctx.beginPath();
  for (let k = 0, first = true; k < n; k += step) {
    const p = toScreen(sp.cpts[(s0 + k) * 2], sp.cpts[(s0 + k) * 2 + 1]);
    if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]);
  }
  if ((n - 1) % step) { const p = toScreen(sp.cpts[(s0 + n - 1) * 2], sp.cpts[(s0 + n - 1) * 2 + 1]); ctx.lineTo(p[0], p[1]); }
  ctx.stroke();
}
// 显示用的折线点数不超过 n
function thin(pts, n = 3000) { if (pts.length <= n) return pts; const st = pts.length / n; const out = []; for (let i = 0; i < n; i++) out.push(pts[Math.floor(i * st)]); out.push(pts[pts.length - 1]); return out; }
// 折线按长度缩放到真实长度（圆弧等离散后略短）
function scaledAlong(pts, len) { const fl = polyLen(pts) || 1; return (t) => alongPts(pts, t * fl / len); }
function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1]; const l = dx * dx + dy * dy; let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }

// ---------------- 鼠标 ----------------
function evPt(e) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * DPR, (e.clientY - r.top) * DPR]; }
function cursorPoint(px, py, useSnap = true) {
  let p = toLocal(px, py); state.snapPt = null;
  if (useSnap && state.snap && state.tool && !PICK_TOOLS.has(state.tool) && state.tool !== 'zoomwin' && !RECT_TOOLS.has(state.tool)) {
    const s = findSnap(p); if (s) { state.snapPt = s; p = [s[0], s[1]]; }
  }
  if (state.ortho && state.tmp.length && !state.snapPt) {
    const a = state.tmp[state.tool === 'angle' ? 0 : state.tmp.length - 1];
    if (Math.abs(p[0] - a[0]) > Math.abs(p[1] - a[1])) p = [p[0], a[1]]; else p = [a[0], p[1]];
  }
  return p;
}
cv.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
const fingers = new Map();
let pinch = null;
function fingerPt(e) { const [px, py] = evPt(e); return { px, py }; }
function pinchNow() {
  const pts = [...fingers.values()];
  if (pts.length < 2) return null;
  return { dist: Math.hypot(pts[1].px - pts[0].px, pts[1].py - pts[0].py) || 1, mx: (pts[0].px + pts[1].px) / 2, my: (pts[0].py + pts[1].py) / 2 };
}
cv.addEventListener('pointerdown', (e) => {
  if (!state.cur) return;
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 部分手机浏览器不支持 */ }
  fingers.set(e.pointerId, fingerPt(e));
  if (fingers.size >= 2) { state.drag = null; pinch = pinchNow(); return; }
  const [px, py] = evPt(e);
  if (e.button === 0 && state.cur.kind === 'compare' && state.cur.cmpMode === 'swipe' && Math.abs(px - cv.width * state.cur.swipe) < 18 * DPR) { state.drag = { swipe: true }; return; }
  if (e.button === 0 && !state.tool && state.hover && state.cur.kind === 'drawing' && state.hover.label && state.hover.kind === 'm' && !['angle', 'p2l'].includes(state.hover.item.type)) {
    const it = state.hover.item; const dim = it.type === 'dist' || it.type === 'lin';
    state.drag = { lab: true, dim, item: it, start: toLocal(px, py), x: px, y: py, maxMoved: 0, origLo: (it.lo || loNow()).slice(), origPts: it.pts.map(q => q.slice()), origOrient: it.orient }; return;
  }
  if (e.button === 0 && !state.tool && state.hover && state.cur.kind === 'drawing' && !FIXED_TYPES.has(state.hover.item.type)) {
    state.drag = { item: true, hit: state.hover, x: px, y: py, start: toLocal(px, py), copy: e.ctrlKey, moved: 0, maxMoved: 0, orig: state.hover.item.pts.map(q => q.slice()), origHoles: state.hover.item.holes ? state.hover.item.holes.map(hl => hl.map(q => q.slice())) : null }; return;
  }
  if (e.button === 1 || (e.button === 0 && !state.tool)) { state.drag = { pan: true, x: px, y: py, moved: 0, click: e.button === 0 }; cv.className = 'panning'; return; }
  if (e.button === 2) { finishTool(); return; }
  if (e.button === 0) {
    if (state.tool === 'zoomwin') { state.drag = { box: true, x0: px, y0: py, x: px, y: py }; return; }
    state.drag = { pan: true, x: px, y: py, moved: 0, click: true, pt: cursorPoint(px, py) };
  }
});
cv.addEventListener('pointermove', (e) => {
  if (!state.cur) return;
  if (fingers.has(e.pointerId)) fingers.set(e.pointerId, fingerPt(e));
  if (pinch && fingers.size >= 2) {
    const now = pinchNow();
    if (now) {
      zoomAt(now.mx, now.my, now.dist / pinch.dist);
      const v = view(); const [a, b, c, be] = basis();
      v.cx -= (a * (now.mx - pinch.mx) + b * (now.my - pinch.my)) / v.s;
      v.cy -= (c * (now.mx - pinch.mx) + be * (now.my - pinch.my)) / v.s;
      pinch = now; redraw();
    }
    return;
  }
  const [px, py] = evPt(e); state.mouse = [px, py];
  const dr = state.drag;
  if (dr && dr.pan) {
    const dx = px - dr.x, dy = py - dr.y; dr.moved += Math.abs(dx) + Math.abs(dy);
    if (!dr.click || dr.moved > 6 * DPR) {
      const v = view(); const [a, b, c, e] = basis(); v.cx -= (a * dx + b * dy) / v.s; v.cy -= (c * dx + e * dy) / v.s; dr.x = px; dr.y = py; dr.click = false; cv.className = 'panning'; redraw();
    }
    return;
  }
  if (dr && dr.box) { dr.x = px; dr.y = py; redraw(); return; }
  if (dr && dr.swipe) { state.cur.swipe = Math.max(0.02, Math.min(0.98, px / cv.width)); redraw(); return; }
  if (state.cur.kind === 'compare' && state.cur.cmpMode === 'swipe') cv.className = Math.abs(px - cv.width * state.cur.swipe) < 18 * DPR ? 'pick' : 'pan';
  if (dr && dr.lab) {
    dr.maxMoved = Math.max(dr.maxMoved, Math.abs(px - dr.x) + Math.abs(py - dr.y));
    if (dr.maxMoved > 3 * DPR) {
      const q = toLocal(px, py); const dx = q[0] - dr.start[0], dy = q[1] - dr.start[1]; const it = dr.item;
      if (dr.dim) { const o = dr.origPts; const base = o[2] || [(o[0][0] + o[1][0]) / 2, (o[0][1] + o[1][1]) / 2]; it.pts = [o[0], o[1], [base[0] + dx, base[1] + dy]]; if (it.type === 'lin' && !it.orientLock) it.orient = linOrient(L(o[0]), L(o[1]), L(it.pts[2])); }
      else { const s0 = view().s; it.lo = [dr.origLo[0] + (px - dr.x) / s0, dr.origLo[1] - (py - dr.y) / s0]; } // lo 是屏幕方向上的偏移（图纸单位）
      cv.className = 'panning'; redraw();
    }
    return;
  }
  if (dr && dr.item) {
    dr.moved = Math.abs(px - dr.x) + Math.abs(py - dr.y); dr.maxMoved = Math.max(dr.maxMoved, dr.moved);
    if (dr.maxMoved > 4 * DPR) {
      if (dr.copy && !dr.cloned) { const src = dr.hit.item; const c = JSON.parse(JSON.stringify({ ...src, _lb: undefined })); c.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); (dr.hit.kind === 'm' ? state.cur.measures : state.cur.annots).push(c); dr.hit = { kind: dr.hit.kind, item: c }; dr.cloned = true; }
      const q = toLocal(px, py); const dx = q[0] - dr.start[0], dy = q[1] - dr.start[1];
      dr.hit.item.pts = dr.orig.map(o => [o[0] + dx, o[1] + dy]);
      if (dr.origHoles) dr.hit.item.holes = dr.origHoles.map(hl => hl.map(o => [o[0] + dx, o[1] + dy]));
      if (dr.hit.item.boxes && dr.cloned) { /* 数量统计不随动 */ }
      cv.className = 'panning'; redraw();
    }
    return;
  }
  const prevSnap = state.snapPt && (state.snapPt[0] + ',' + state.snapPt[1]);
  const prev = [state.hover && state.hover.item, state.hoverCurve, state.hoverCircle, state.hoverRegion, state.hoverInsert, state.hoverText];
  const p = cursorPoint(px, py); state.cursorLocal = p;
  const w = W(p);
  $('#st-coord').textContent = `X: ${w[0].toFixed(3)}   Y: ${w[1].toFixed(3)}`;
  if (state.tool === 'radius' || state.tool === 'circle') state.hoverCircle = findCircle(toLocal(px, py));
  if (CURVE_TOOLS.has(state.tool) && !(state.tool === 'p2l' && state.tmp.length)) state.hoverCurve = pickCurve(toLocal(px, py), state.tool === 'p2l' ? (k) => k === 1 || k === 4 || k === 0 : null);
  if (state.tool === 'areapick') state.hoverRegion = findRegion(toLocal(px, py));
  if (state.tool === 'erase') { state.hover = pickItem(px, py); }
  if (!state.tool && state.cur.kind === 'drawing') { const h = state.hideMarks ? null : pickItem(px, py); const changed = (h && h.item) !== (state.hover && state.hover.item); state.hover = h; if (changed) cv.className = h ? 'pick' : 'pan'; }
  if (state.tool === 'count') state.hoverInsert = findInsert(toLocal(px, py));
  if (state.tool === 'edittext') state.hoverText = findText(toLocal(px, py));
  if (!['dist', 'lin', 'poly', 'side', 'area', 'rectarea', 'angle', 'radius', 'circle', 'areapick', 'coord', 'calib', 'boxlen', 'count', 'edittext', 'p2l', ...CURVE_TOOLS].includes(state.tool)) hideTip();
  const next = [state.hover && state.hover.item, state.hoverCurve, state.hoverCircle, state.hoverRegion, state.hoverInsert, state.hoverText];
  let hoverChanged = (state.snapPt && (state.snapPt[0] + ',' + state.snapPt[1])) !== prevSnap;
  if (!hoverChanged) for (let i = 0; i < prev.length; i++) if (prev[i] !== next[i]) { hoverChanged = true; break; }
  if (state.tool || state.drag || hoverChanged) redraw();
});
function endFinger(e) {
  fingers.delete(e.pointerId);
  if (fingers.size < 2) pinch = null;
}
cv.addEventListener('pointerup', (e) => {
  const wasPinch = pinch || fingers.size >= 2;
  endFinger(e);
  if (wasPinch) { state.drag = null; return; }
  const dr = state.drag; state.drag = null;
  if (!dr || dr.swipe) return;
  if (dr.lab) {
    const d = state.cur;
    if (dr.maxMoved > 3 * DPR) { pushUndo(d, dr.dim ? { op: 'props', item: dr.item, old: { pts: dr.origPts, orient: dr.origOrient } } : { op: 'props', item: dr.item, old: { lo: dr.origLo } }); saveSidecar(d); cv.className = 'pick'; return; }
    dr.click = true; dr.item = true;
  }
  if (dr.item) {
    const d = state.cur;
    if (dr.maxMoved > 4 * DPR) { pushUndo(d, dr.cloned ? { op: 'add', kind: dr.hit.kind, item: dr.hit.item } : { op: 'move', item: dr.hit.item, old: dr.orig, oldHoles: dr.origHoles }); saveSidecar(d); if (state.side === 'stats') refreshSide(); cv.className = 'pick'; return; }
    dr.click = true;
  }
  if (dr.box) {
    const a = toLocal(dr.x0, dr.y0), b = toLocal(dr.x, dr.y);
    if (Math.abs(dr.x - dr.x0) > 5 && Math.abs(dr.y - dr.y0) > 5) zoomTo([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], 0);
    setTool(null); return;
  }
  cv.className = state.tool ? (PICK_TOOLS.has(state.tool) ? 'pick' : 'cross') : 'pan';
  if (dr.click && e.button === 0 && !dr.moved) dr.moved = 0;
  if (dr.click && e.button === 0) {
    if (state.tool) toolClick(dr.pt, evPt(e));
    else if (state.hover && state.hover.kind === 'm') { state.selMeasure = state.hover.item.id; if (state.side !== 'stats') toggleSide('stats'); else refreshSide(); redraw(); }
    else if (state.hover && state.hover.kind === 'a' && (state.hover.item.type === 'text' || state.hover.item.type === 'arrow')) editAnnotText(state.hover.item);
  }
});
cv.addEventListener('dblclick', (e) => { if (e.button === 1) zoomExtents(); });
cv.addEventListener('wheel', (e) => { e.preventDefault(); if (!state.cur) return; const [px, py] = evPt(e); zoomAt(px, py, Math.pow(1.0018, -e.deltaY * (e.deltaMode === 1 ? 33 : 1))); }, { passive: false });
cv.addEventListener('pointercancel', (e) => { endFinger(e); state.drag = null; });
cv.addEventListener('pointerleave', () => { if (fingers.size) return; state.snapPt = null; hideTip(); redraw(); });
cv.addEventListener('auxclick', (e) => { if (e.button === 1 && e.detail === 2) zoomExtents(); });

async function toolClick(p, screen) {
  const t = state.tool; const d = state.cur;
  switch (t) {
    case 'calib':
      state.tmp.push(p);
      if (state.tmp.length === 2) { const pts = state.tmp; state.tmp = []; await calibrate(dist(pts[0], pts[1])); setTool(null); }
      break;
    case 'dist': case 'lin':
      // 前两点为被测点，第三点放置尺寸线
      state.tmp.push(state.tmp.length === 2 ? toLocal(...screen) : p);
      if (state.tmp.length === 3) {
        const [a, b, o] = state.tmp; state.tmp = [];
        if (dist(a, b) <= 0) break;
        const it = { type: t, pts: [a, b, o].map(W), ts: tsNow(), cat: d.cat };
        if (t === 'lin') it.orient = linOrient(a, b, o);
        addItem('m', it);
      }
      break;
    case 'poly': case 'side': state.tmp.push(p); break;
    case 'area':
      if (state.arcMode && state.tmp.length && !state.arcPending) { state.tmpArc.add(state.tmp.length); state.tmp.push(p); state.arcPending = true; }
      else { state.tmp.push(p); state.arcPending = false; }
      break;
    case 'rectarea':
      state.tmp.push(p);
      if (state.tmp.length === 2) { const [a, b] = state.tmp; state.tmp = []; if (Math.abs(a[0] - b[0]) * Math.abs(a[1] - b[1]) <= 0) break; addItem('m', { type: 'area', rect: true, pts: [a, [b[0], a[1]], b, [a[0], b[1]]].map(W), ts: tsNow(), lo: loNow(), cat: d.cat }); }
      break;
    case 'arclen': case 'seglen': case 'stake': case 'batch': {
      const hc = pickCurve(toLocal(...screen));
      if (!hc) { toast(tr('请把鼠标移到线上（变红后单击）')); break; }
      const sp0 = curSpace(); const g = curveGeom(sp0, hc.ci);
      if (t === 'batch') { const i = state.batchSel.indexOf(hc.ci); if (i >= 0) state.batchSel.splice(i, 1); else state.batchSel.push(hc.ci); showTip(tr('已选 {0} 条，合计 {1}　右键或回车完成', state.batchSel.length, fmtLen(state.batchSel.reduce((a, ci) => a + sp0.curves[ci * 6], 0))), screen[0] / DPR, screen[1] / DPR); break; }
      const along = scaledAlong(g.pts, g.len);
      if (t === 'arclen') { const mid = along(g.len / 2); addItem('m', { type: 'arclen', pts: thin(g.pts).map(W), len: g.len, ck: g.kind, mid: W(mid.p), ts: tsNow(), lo: loNow(), cat: d.cat }); break; }
      if (t === 'seglen') {
        const idx = []; g.vf.forEach((f, i) => { if (f) idx.push(i); }); if (idx[0] !== 0) idx.unshift(0); if (idx[idx.length - 1] !== g.pts.length - 1) idx.push(g.pts.length - 1);
        // 直线段用原长；圆弧段是离散的，按总长差额等比放大
        const parts = []; for (let j = 0; j + 1 < idx.length; j++) parts.push(g.pts.slice(idx[j], idx[j + 1] + 1));
        const straight = parts.filter(q => q.length === 2).reduce((a, q) => a + polyLen(q), 0), curved = parts.filter(q => q.length > 2).reduce((a, q) => a + polyLen(q), 0);
        const k = curved > 0 ? Math.max(0, g.len - straight) / curved : 1; const segs = [];
        for (const part of parts) { const l = polyLen(part) * (part.length > 2 ? k : 1); if (l <= 0) continue; const mm = alongPts(part, polyLen(part) / 2); segs.push({ len: l, mid: W(mm.p), ang: mm.ang, a: W(part[0]) }); }
        addItem('m', { type: 'seglen', pts: thin(g.pts).map(W), len: g.len, segs: segs.slice(0, 5000), ts: tsNow(), lo: loNow(), cat: d.cat }); break;
      }
      // 定距：从离点击处较近的一端开始
      const r = await ask(tr('定距测量'), [{ key: 'iv', label: tr('间距（{0}）', d.unit.len === 'm' ? tr('米') : tr('毫米')), type: 'number', value: d.unit.len === 'm' ? 20 : 1000 }, { key: 'k0', label: tr('起点桩号（{0}，可为 0）', d.unit.len === 'm' ? tr('米') : tr('毫米')), type: 'number', value: 0 }]);
      if (!r || !(+r.iv > 0)) break;
      const toDu = (v) => +v * (d.unit.len === 'm' ? 1000 : 1) / d.unit.uf;
      let pts = g.pts; const p0 = toLocal(...screen); if (dist(p0, pts[pts.length - 1]) < dist(p0, pts[0])) pts = pts.slice().reverse();
      const iv = toDu(r.iv); const n = Math.floor(g.len / iv + 1e-9); if (n > 5000) { toast(tr('间距太小，点数超过 5000')); break; }
      const al = scaledAlong(pts, g.len); const st = [];
      for (let k = 0; k <= n; k++) { const q = al(k * iv); st.push({ d: k * iv, p: W(q.p), ang: q.ang }); }
      if (g.len - n * iv > iv * 1e-3) { const q = al(g.len); st.push({ d: g.len, p: W(q.p), ang: q.ang }); }
      addItem('m', { type: 'stake', pts: thin(pts).map(W), len: g.len, iv, k0: toDu(r.k0 || 0), st, ts: tsNow(), lo: loNow(), cat: d.cat });
      break;
    }
    case 'p2l': {
      if (!state.tmp.length) {
        const hc = state.hoverCurve || pickCurve(toLocal(...screen));
        if (!hc) { toast(tr('先单击一条直线（变红后单击）')); break; }
        state.p2lSeg = [hc.a, hc.b]; state.tmp = [hc.a]; break;
      }
      const [a, b] = state.p2lSeg; const f = footOn(p, a, b);
      addItem('m', { type: 'p2l', pts: [a, b, p, f].map(W), ts: tsNow(), cat: d.cat }); state.tmp = []; state.p2lSeg = null;
      break;
    }
    case 'circle': {
      const c = findCircle(toLocal(...screen));
      if (!c) { toast(tr('请把鼠标移到圆或圆弧上（变红后单击）')); break; }
      const ang = Math.atan2(p[1] - c[1], p[0] - c[0]);
      addItem('m', { type: 'circle', pts: [W([c[0], c[1]]), W([c[0] + c[2] * Math.cos(ang), c[1] + c[2] * Math.sin(ang)])], ts: tsNow(), lo: loNow(), cat: d.cat });
      break;
    }
    case 'angle':
      state.tmp.push(p);
      if (state.tmp.length === 3) { addItem('m', { type: 'angle', pts: state.tmp.map(W), cat: d.cat, ts: tsNow() }); state.tmp = []; }
      break;
    case 'radius': {
      const c = findCircle(toLocal(...screen));
      if (!c) { toast(tr('请把鼠标移到圆或圆弧上（变红后单击）')); break; }
      const ang = Math.atan2(p[1] - c[1], p[0] - c[0]);
      addItem('m', { type: 'radius', pts: [W([c[0], c[1]]), W([c[0] + c[2] * Math.cos(ang), c[1] + c[2] * Math.sin(ang)])], ts: tsNow(), lo: loNow(), cat: d.cat });
      break;
    }
    case 'areapick': {
      const g = findRegion(toLocal(...screen));
      if (!g) { toast(tr('这里没有找到封闭图形或填充')); break; }
      if (g.circ) {
        const [x, y, r] = g.circ; const pts = [];
        for (let k = 0; k < 48; k++) pts.push(W([x + r * Math.cos(k * Math.PI / 24), y + r * Math.sin(k * Math.PI / 24)]));
        addItem('m', { type: 'area', pts, holes: [], cat: d.cat, picked: true, radius: r, ts: tsNow(), lo: loNow() });
        break;
      }
      const toPts = (r) => { const a = []; for (let i = 0; i < r.length; i += 2) a.push(W([r[i], r[i + 1]])); return a; };
      addItem('m', { type: 'area', pts: toPts(g.outer), holes: g.holes.map(toPts), cat: d.cat, picked: true, ts: tsNow(), lo: loNow() });
      break;
    }
    case 'coord': addItem('m', { type: 'coord', pts: [W(p)], cat: d.cat, ts: tsNow(), lo: loNow() }); break;
    case 'text': {
      const r = await ask(tr('文字批注'), [{ key: 't', label: tr('批注内容'), type: 'textarea' }]);
      if (r && r.t.trim()) addItem('a', { type: 'text', pts: [W(p)], text: r.t.trim(), size: 16 * DPR / view().s });
      break;
    }
    case 'cloud': case 'rect': case 'arrow':
      state.tmp.push(p);
      if (state.tmp.length === 2) {
        const pts = state.tmp.map(W); state.tmp = [];
        if (dist(L(pts[0]), L(pts[1])) * view().s < 4) break;
        const it = { type: t, pts, arc: 14 * DPR / view().s, size: 15 * DPR / view().s };
        if (t === 'arrow') { const r = await ask(tr('箭头说明（可留空）'), [{ key: 't', label: tr('说明文字'), type: 'textarea' }]); if (r && r.t.trim()) it.text = r.t.trim(); }
        addItem('a', it);
      }
      break;
    case 'boxlen': case 'table': case 'clip': case 'findbox': case 'shapes':
      state.tmp.push(p);
      if (state.tmp.length === 2) {
        const [a, b] = state.tmp; state.tmp = [];
        if (dist(a, b) * view().s < 6) break;
        if (t === 'boxlen') { const r = boxLength(a, b); if (!r.n) { toast(tr('框内没有完整的线条（只统计完全落在框内的线）')); break; } addItem('m', { type: 'boxlen', ts: tsNow(), lo: loNow(), pts: [W(a), W(b)], total: r.total, n: r.n, layers: r.layers.slice(0, 4).join('、') + (r.layers.length > 4 ? '…' : ''), cat: d.cat }); }
        else if (t === 'table') extractTable(a, b);
        else if (t === 'shapes') findShapes(a, b);
        else if (t === 'clip') clipMenu(a, b, screen);
        else { state.findBox = { space: spaceKey(), bb: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] }; setTool(null); state.side = 'find'; refreshSide(); refreshToolbar(); }
      }
      break;
    case 'count': {
      const it = findInsert(toLocal(...screen));
      if (!it || !countable(it.n)) { // 不是图块：自动改用图形识别，以点中的图形为样板
        if (!autoShapeAt(toLocal(...screen))) toast(tr('这里没有图块，也没有可以作为样板的图形'));
        break;
      }
      const sp0 = curSpace(); const same = (sp0.inserts || []).filter(x => x.n === it.n && layerVisible(sp0, x.l));
      addItem('m', { type: 'count', ts: tsNow(), lo: loNow(), name: blockLabel(it.n), block: it.n, n: same.length, pts: [W(p)], boxes: same.slice(0, 5000).map(x => [...W([x.b[0], x.b[1]]), ...W([x.b[2], x.b[3]])]), cat: d.cat });
      toast(tr('图块「{0}」共 {1} 个', blockLabel(it.n), same.length)); if (state.side === 'blocks') refreshSide();
      break;
    }
    case 'line': state.tmp.push(p); if (state.tmp.length === 2) { const pts = state.tmp.map(W); state.tmp = []; addItem('a', { type: 'line', pts }); } break;
    case 'num': addItem('a', { type: 'num', pts: [W(p)], text: String(d.nextNo++), size: 18 * DPR / view().s }); break;
    case 'edittext': {
      const h0 = findText(toLocal(...screen));
      if (!h0) { toast(tr('没有点中文字')); break; }
      const t0 = h0.t;
      if (!t0.hd) { toast(tr('这段文字无法定位到原图实体')); break; }
      const all = curSpace().texts.filter(x => x.hd === t0.hd);
      const paraItem = all.find(x => x.para !== undefined);
      const cur = d.textEdits[t0.hd] ?? (t0.mt ? (paraItem ? paraItem.para : all.slice(0, t0.ln || 1).map(x => x._orig ?? x.s).join('\n')) : (t0._orig ?? t0.s));
      const r = await ask(tr('修改原图文字') + (t0.blk ? tr('（在图块内，同名图块会一起改）') : ''), [{ key: 't', label: tr('文字内容（多行文字可换行）'), type: 'textarea', value: cur }]);
      if (!r) break;
      const old = d.textEdits[t0.hd];
      d.textEdits[t0.hd] = r.t; applyTextEdits(d);
      pushUndo(d, { op: 'text', hd: t0.hd, old });
      saveSidecar(d); toast(tr('已修改。用「导出 → 另存为 DXF」把修改写进新图纸，原图不变'), 4000);
      break;
    }
    case 'erase': { const h = pickItem(...screen); if (h) { removeItem(h.kind, h.item); state.hover = null; } else toast(tr('没有点中测量或批注')); break; }
  }
  redraw();
}
async function finishTool() {
  const t = state.tool; const d = state.cur;
  if (t === 'poly' && state.tmp.length >= 2) addItem('m', { type: 'poly', pts: state.tmp.map(W), cat: d.cat, ts: tsNow(), lo: loNow() });
  else if (t === 'side' && state.tmp.length >= 2) {
    const pts = state.tmp.slice(); state.tmp = []; redraw();
    const r = await ask(tr('侧面积'), [{ key: 'h', label: tr('高度（{0}）', d.unit.len === 'm' ? tr('米') : tr('毫米')), type: 'number', value: '' }]);
    if (r && +r.h > 0) addItem('m', { type: 'side', pts: pts.map(W), height: +r.h * (d.unit.len === 'm' ? 1000 : 1), cat: d.cat, ts: tsNow(), lo: loNow() });
    return;
  }
  else if (t === 'area' && state.tmp.length >= 3) { const pts = state.tmpArc.size ? flattenArcs(state.tmp, state.tmpArc) : state.tmp; addItem('m', { type: 'area', pts: pts.map(W), cat: d.cat, ts: tsNow(), lo: loNow(), arcs: state.tmpArc.size || undefined }); }
  else if ((t === 'dist' || t === 'lin') && state.tmp.length === 2) { const [a, b] = state.tmp; const it = { type: t, pts: [a, b].map(W), ts: tsNow(), cat: d.cat }; if (t === 'lin') it.orient = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 'h' : 'v'; addItem('m', it); }
  else if (t === 'batch' && state.batchSel.length) {
    const sp0 = curSpace(); const items = state.batchSel.map(ci => { const g = curveGeom(sp0, ci); const mm = scaledAlong(g.pts, g.len)(g.len / 2); return { len: g.len, pts: thin(g.pts, 800).map(W), mid: W(mm.p), ang: mm.ang }; });
    addItem('m', { type: 'batch', items, pts: [items[0].mid], ts: tsNow(), lo: loNow(), cat: d.cat }); state.batchSel = []; hideTip();
  }
  else if (state.tmp.length === 0 && t && !(t === 'batch' && state.batchSel.length)) { setTool(null); return; }
  state.tmp = []; state.tmpArc = new Set(); state.arcPending = false; state.p2lSeg = null; redraw();
}
async function editAnnotText(a) {
  const r = await ask(tr('修改批注'), [{ key: 't', label: tr('内容（清空则删除）'), type: 'textarea', value: a.text || '' }]);
  if (!r) return;
  if (!r.t.trim() && a.type === 'text') removeItem('a', a); else { pushUndo(state.cur, { op: 'props', item: a, old: { text: a.text } }); a.text = r.t.trim(); saveSidecar(state.cur); redraw(); }
}

// 点中的不是图块：取点击处最小的封闭图形（圆、闭合多段线）为样板；没有就取点中的那条线
function autoShapeAt(p) {
  const sp = curSpace(); const c = sp.curves; if (!c) return false;
  const v = view(); const lim = Math.min(cv.width, cv.height) / v.s * 0.25; // 样板不超过屏幕的四分之一
  let best = null, ba = Infinity;
  for (let i = 0, ci = 0; i < c.length; i += 6, ci++) {
    if (p[0] < c[i + 1] || p[0] > c[i + 3] || p[1] < c[i + 2] || p[1] > c[i + 4]) continue;
    const w = c[i + 3] - c[i + 1], h = c[i + 4] - c[i + 2]; if (Math.max(w, h) > lim || !layerVisible(sp, c[i + 5])) continue;
    const k = sp.cinfo ? sp.cinfo[ci * 3 + 2] : 0; const n = sp.cinfo ? sp.cinfo[ci * 3 + 1] : 0; const s0 = sp.cinfo ? sp.cinfo[ci * 3] : 0;
    const closed = k === 3 || (n > 2 && sp.cpts && Math.hypot(sp.cpts[s0 * 2] - sp.cpts[(s0 + n - 1) * 2], sp.cpts[s0 * 2 + 1] - sp.cpts[(s0 + n - 1) * 2 + 1]) < 1e-9 * (1 + w + h) + 1e-9);
    if (!closed) continue;
    const a = w * h; if (a < ba) { ba = a; best = [c[i + 1], c[i + 2], c[i + 3], c[i + 4]]; }
  }
  if (!best) { const hc = pickCurve(p); if (hc) { const i = hc.ci * 6; if (Math.max(c[i + 3] - c[i + 1], c[i + 4] - c[i + 2]) <= lim) best = [c[i + 1], c[i + 2], c[i + 3], c[i + 4]]; } }
  if (!best) return false;
  const e = Math.max(best[2] - best[0], best[3] - best[1]) * 0.02 + 1e-9;
  findShapes([best[0] - e, best[1] - e], [best[2] + e, best[3] + e]);
  return true;
}
// ---------------- 图块统计面板：自动列出当前空间的全部图块及数量 ----------------
function blockStats(sp) {
  const m = new Map();
  for (const it of sp.inserts || []) {
    if (!countable(it.n) || !layerVisible(sp, it.l)) continue;
    let g = m.get(it.n); if (!g) m.set(it.n, g = { n: it.n, items: [], layers: new Set() });
    g.items.push(it); g.layers.add(sp.curveLayers[it.l]);
  }
  return [...m.values()].sort((a, b) => b.items.length - a.items.length);
}
function blocksPanel(body, d) {
  if (d.kind !== 'drawing') { body.innerHTML = `<div class="empty-note">${tr('对比视图里不统计图块')}</div>`; return; }
  const sp = curSpace(); const list = blockStats(sp);
  const total = list.reduce((a, g) => a + g.items.length, 0);
  const filter = h('input', { type: 'text', placeholder: tr('按名称筛选') });
  const box = h('div');
  const render = () => {
    box.innerHTML = ''; const q = filter.value.trim().toLowerCase();
    for (const g of list) {
      const name = blockLabel(g.n); if (q && !name.toLowerCase().includes(q)) continue;
      box.append(h('div', { cls: 'mrow', style: 'display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid #e6e9ee' },
        h('div', { style: 'flex:1;min-width:0' }, h('div', { style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis', text: name, title: name }), h('div', { style: 'color:#7a8594;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', text: [...g.layers].join('、') })),
        h('b', { style: 'min-width:42px;text-align:right', text: String(g.items.length) }),
        h('button', { cls: 'btn', text: tr('标出'), title: tr('在图上框出全部位置，并记入测量统计'), onclick: () => {
          const bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const it of g.items) { bb[0] = Math.min(bb[0], it.b[0]); bb[1] = Math.min(bb[1], it.b[1]); bb[2] = Math.max(bb[2], it.b[2]); bb[3] = Math.max(bb[3], it.b[3]); }
          addItem('m', { type: 'count', ts: tsNow(), lo: loNow(), name: blockLabel(g.n), block: g.n, n: g.items.length, pts: [W([g.items[0].b[2], g.items[0].b[3]])], boxes: g.items.slice(0, 5000).map(x => [...W([x.b[0], x.b[1]]), ...W([x.b[2], x.b[3]])]), cat: d.cat });
          const w = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 0.05; zoomTo([bb[0] - w, bb[1] - w, bb[2] + w, bb[3] + w], 20);
        } })));
    }
    if (!box.childNodes.length) box.append(h('div', { cls: 'empty-note', text: list.length ? tr('没有匹配的图块') : tr('当前空间没有可见的图块。不是图块的符号，可以用「图形识别」或直接点它统计。') }));
  };
  filter.oninput = render;
  body.append(
    h('div', { cls: 'k', style: 'color:#5b6676;font-size:11px;margin-bottom:6px', text: tr('{0} 种图块，共 {1} 个（只统计打开的图层；动态块等匿名块按内容相同归为一类）。在图上单击一个图块可直接统计；单击的不是图块时，自动按图形识别。', list.length, total) }),
    h('div', { cls: 'row', style: 'margin-bottom:8px;gap:6px' }, h('button', { cls: 'btn primary', text: tr('导出 Excel'), onclick: () => {
      const rows = [[tr('图块名称'), tr('数量'), tr('图层')]]; for (const g of list) rows.push([blockLabel(g.n), g.items.length, [...g.layers].join('、')]);
      saveBytes(baseName(d) + tr('_图块清单.xlsx'), makeXlsx([{ name: tr('图块清单'), rows, widths: [36, 10, 40] }]));
    } })),
    filter, h('div', { style: 'height:6px' }), box);
  render();
}

// ---------------- 图形识别：统计与样板相同的图形（非图块的散线也能数） ----------------
function findShapes(a, b) {
  const d = state.cur; const sp = curSpace(); const c = sp.curves; if (!c || !c.length) { toast(tr('当前空间没有线条')); return; }
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const kindOf = (ci) => (sp.cinfo ? sp.cinfo[ci * 3 + 2] : 0);
  const tpl = [];
  for (let i = 0, ci = 0; i < c.length; i += 6, ci++) if (c[i + 1] >= x0 && c[i + 3] <= x1 && c[i + 2] >= y0 && c[i + 4] <= y1 && layerVisible(sp, c[i + 5])) { tpl.push(ci); if (tpl.length > 300) break; }
  if (!tpl.length) { toast(tr('框内没有完整的图形（只取完全落在框内的线）')); return; }
  if (tpl.length > 300) { toast(tr('框内线条太多（超过 300 条），请框小一点')); return; }
  const cen = (ci) => [(c[ci * 6 + 1] + c[ci * 6 + 3]) / 2, (c[ci * 6 + 2] + c[ci * 6 + 4]) / 2];
  let tb = [Infinity, Infinity, -Infinity, -Infinity]; for (const ci of tpl) { tb[0] = Math.min(tb[0], c[ci * 6 + 1]); tb[1] = Math.min(tb[1], c[ci * 6 + 2]); tb[2] = Math.max(tb[2], c[ci * 6 + 3]); tb[3] = Math.max(tb[3], c[ci * 6 + 4]); }
  const size = Math.max(tb[2] - tb[0], tb[3] - tb[1], 1e-9); const q = size * 0.004;
  const anchor = tpl.reduce((m, ci) => (c[ci * 6] > c[m * 6] ? ci : m), tpl[0]);
  const AL = c[anchor * 6], AK = kindOf(anchor), AC = cen(anchor), T = Math.max(q, AL * 0.002);
  const same = (ci, cj) => kindOf(ci) === kindOf(cj) && Math.abs(c[ci * 6] - c[cj * 6]) <= Math.max(q, c[cj * 6] * 0.002) && Math.abs((c[ci * 6 + 3] - c[ci * 6 + 1]) - (c[cj * 6 + 3] - c[cj * 6 + 1])) <= q && Math.abs((c[ci * 6 + 4] - c[ci * 6 + 2]) - (c[cj * 6 + 4] - c[cj * 6 + 2])) <= q;
  const sig = (ci) => { const i = ci * 6; return kindOf(ci) + ':' + Math.round(c[i] / T) + ':' + Math.round((c[i + 3] - c[i + 1]) / q) + ':' + Math.round((c[i + 4] - c[i + 2]) / q); };
  const buckets = new Map();
  for (let i = 0, ci = 0; i < c.length; i += 6, ci++) { if (!layerVisible(sp, c[i + 5])) continue; const s = sig(ci); let a = buckets.get(s); if (!a) buckets.set(s, a = []); a.push(ci); }
  const seeds = []; const seenSeed = new Set();
  for (const dl of [-1, 0, 1]) for (const dw of [-1, 0, 1]) for (const dh of [-1, 0, 1]) {
    const i = anchor * 6; const s = AK + ':' + Math.round(c[i] / T + dl) + ':' + Math.round((c[i + 3] - c[i + 1]) / q + dw) + ':' + Math.round((c[i + 4] - c[i + 2]) / q + dh);
    const list = buckets.get(s); if (!list) continue; for (const ci of list) if (!seenSeed.has(ci)) { seenSeed.add(ci); seeds.push(ci); }
  }
  const g = new Map(); const key = (x, y) => Math.round(x / q) * 1000003 + Math.round(y / q);
  for (let i = 0, ci = 0; i < c.length; i += 6, ci++) { if (!layerVisible(sp, c[i + 5])) continue; const p = cen(ci); const k = key(p[0], p[1]); let l = g.get(k); if (!l) g.set(k, l = []); l.push(ci); }
  const hasMatch = (x, y, tj) => { const gx = Math.round(x / q), gy = Math.round(y / q); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = g.get((gx + i) * 1000003 + gy + j); if (l) for (const ck of l) { const pk = cen(ck); if (same(ck, tj) && Math.hypot(pk[0] - x, pk[1] - y) <= q * 1.5) return true; } } return false; };
  const hits = []; const hitKeys = new Set();
  for (const ci of seeds) {
    const i = ci * 6;
    if (kindOf(ci) !== AK || Math.abs(c[i] - AL) > Math.max(q, AL * 0.002) || !same(ci, anchor) || !layerVisible(sp, c[i + 5])) continue;
    const p = cen(ci); const dx = p[0] - AC[0], dy = p[1] - AC[1];
    let ok = true;
    for (const tj of tpl) { if (tj === anchor) continue; const tc = cen(tj); if (!hasMatch(tc[0] + dx, tc[1] + dy, tj)) { ok = false; break; } }
    const hk = Math.round(dx / q) + ',' + Math.round(dy / q);
    if (ok && !hitKeys.has(hk)) { hitKeys.add(hk); hits.push([dx, dy]); }
    if (hits.length > 20000) break;
  }
  const boxes = hits.map(([dx, dy]) => [...W([tb[0] + dx, tb[1] + dy]), ...W([tb[2] + dx, tb[3] + dy])]);
  addItem('m', { type: 'count', name: tr('相同图形'), n: hits.length, pts: [W([tb[2], tb[3]])], boxes: boxes.slice(0, 5000), ts: tsNow(), lo: loNow(), cat: d.cat, shape: true });
  toast(tr('找到相同图形 {0} 处（含样板，按平移识别，旋转或镜像的不计）', hits.length), 5000);
}
// ---------------- 布局转模型：把当前布局（含视口里的内容）展平成一张 DXF ----------------
async function layoutToModel() {
  const d = state.cur; if (!d || d.kind !== 'drawing') return;
  const sp = curSpace(); if (!sp.paper) { toast(tr('请先切换到要转换的布局（底部的布局标签）')); return; }
  try {
    const mod = await import('./core/scenedxf.js');
    const text = mod.layoutToDxf(d.scene, sp.key, { layerOn: d.layerOn });
    const bytes = encodeLegacy(text, 'gbk');
    await saveBytes(baseName(d) + '_' + safeName(spName(sp)) + tr('_布局转模型.dxf'), bytes);
  } catch (e) { console.error(e); toast(tr('转换失败：') + (e.message || e)); }
}

// ---------------- 表格提取 / 图纸分割 ----------------
function extractTable(a, b) {
  const d = state.cur; const sp = curSpace();
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const items = [];
  for (const t of sp.texts) {
    if (!R.visible(t.layer) || !t.s.trim()) continue;
    const bb = textBox(t); const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
    items.push({ s: t.s.trim(), l: bb[0], cx, cy, h: Math.max(bb[3] - bb[1], 1e-9) });
  }
  if (!items.length) { toast(tr('框内没有文字')); return; }
  const hs = items.map(i => i.h).sort((p, q) => p - q); const hm = hs[Math.floor(hs.length / 2)];
  // 行：按纵坐标聚类
  items.sort((p, q) => q.cy - p.cy);
  const rows = []; for (const it of items) { const r = rows[rows.length - 1]; if (r && Math.abs(r.y - it.cy) < hm * 0.6) { r.items.push(it); r.y = (r.y * (r.items.length - 1) + it.cy) / r.items.length; } else rows.push({ y: it.cy, items: [it] }); }
  // 列：用表格竖线优先；没有竖线时按文字左端聚类
  const vx = [];
  const segs = sp.segs; for (let i = 0; i < segs.length; i += 4) { if (Math.abs(segs[i] - segs[i + 2]) < hm * 0.05 && Math.abs(segs[i + 1] - segs[i + 3]) > hm * 1.5 && segs[i] > x0 - hm && segs[i] < x1 + hm && Math.max(segs[i + 1], segs[i + 3]) > y0 && Math.min(segs[i + 1], segs[i + 3]) < y1) vx.push(segs[i]); }
  vx.sort((p, q) => p - q); const lines = []; for (const x of vx) if (!lines.length || x - lines[lines.length - 1] > hm * 0.5) lines.push(x);
  let colOf;
  if (lines.length >= 2) colOf = (it) => { let k = 0; while (k < lines.length && lines[k] <= it.cx) k++; return k; };
  else {
    const ls = items.map(i => i.l).sort((p, q) => p - q); const cols = []; for (const x of ls) if (!cols.length || x - cols[cols.length - 1] > hm * 1.5) cols.push(x);
    colOf = (it) => { let best = 0, bd = Infinity; cols.forEach((c, k) => { const dd = Math.abs(c - it.l); if (dd < bd) { bd = dd; best = k; } }); return best; };
  }
  const grid = rows.map(r => { const cells = []; for (const it of r.items.sort((p, q) => p.l - q.l)) { const k = colOf(it); cells[k] = cells[k] ? cells[k] + ' ' + it.s : it.s; } return cells; });
  const used = new Set(); grid.forEach(r => r.forEach((c, k) => { if (c !== undefined) used.add(k); }));
  const order = [...used].sort((p, q) => p - q);
  const out = grid.map(r => order.map(k => { const v = r[k] ?? ''; return /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(v) && !/^-?0\d/.test(v) ? +v : v; }));
  saveBytes(baseName(d) + tr('_表格提取.xlsx'), makeXlsx([{ name: tr('提取的表格'), rows: out, header: false, widths: order.map(() => 18) }]));
  toast(tr('提取了 {0} 行 × {1} 列', out.length, order.length));
}
function clipMenu(a, b, screen) {
  const d = state.cur; const bb = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  const anchor = { getBoundingClientRect: () => { const r = cv.getBoundingClientRect(); return { left: r.left + screen[0] / DPR, bottom: r.top + screen[1] / DPR, top: r.top + screen[1] / DPR }; } };
  showMenu(anchor, [[tr('分割导出为 PNG 图片'), () => exportRegion(d, bb, 'png')], [tr('分割导出为 PDF（A3）'), () => exportRegion(d, bb, 'pdf')], [tr('分割导出为 DXF 图纸'), () => exportRegion(d, bb, 'dxf')]]);
}
async function exportRegion(d, bb, kind) {
  busy(tr('正在导出…')); await nextFrame();
  try {
    if (kind === 'dxf') { busy(); return saveDxf(d, bb); }
    const oldBg = R.bg; if (kind === 'pdf') R.bg = 'white';
    const off = renderImage(d, bb, kind === 'pdf' ? 4961 : 6000); R.bg = oldBg;
    busy();
    if (kind === 'png') { const blob = await new Promise(r => off.toBlob(r, 'image/png')); await saveBytes(baseName(d) + tr('_分割.png'), new Uint8Array(await blob.arrayBuffer())); }
    else { const p = await B.exportPdf({ dataUrl: off.toDataURL('image/png'), landscape: off.width >= off.height, name: baseName(d) + tr('_分割.pdf') }); if (p) toast(tr('已保存：') + p, 4000); }
  } catch (e) { busy(); toast(tr('导出失败：') + e.message); }
}
async function saveDxf(d, bb) {
  busy(tr('正在生成 DXF…'));
  try {
    const m = await rpc({ cmd: 'dxf', doc: d.id, edits: d.textEdits, bbox: bb ? [bb[0] + spOrigin()[0], bb[1] + spOrigin()[1], bb[2] + spOrigin()[0], bb[3] + spOrigin()[1]] : null });
    busy();
    await saveBytes(baseName(d) + (bb ? tr('_分割') : tr('_另存')) + '.dxf', new Uint8Array(m.bytes));
    if (m.dropped) toast(tr('已导出。{0} 个天正/专业软件自定义对象无法转换，已略去', m.dropped), 6000);
  } catch (e) { busy(); toast(tr('导出失败：') + e.message); }
}

// 另存为 DWG：先生成 DXF（含文字修改），再交给本机安装的 ODA File Converter 转成 DWG
async function saveDwg(d) {
  if (!B.saveDwg) { toast(tr('另存为 DWG 只在桌面版里可用')); return; }
  const r = await ask(tr('另存为 DWG'), [{ key: 'ver', label: tr('DWG 版本（版本越低，能打开的 CAD 越多）'), type: 'select', value: state.settings.dwgVer || 'ACAD2013', options: [['ACAD2018', 'AutoCAD 2018'], ['ACAD2013', 'AutoCAD 2013'], ['ACAD2010', 'AutoCAD 2010'], ['ACAD2007', 'AutoCAD 2007'], ['ACAD2004', 'AutoCAD 2004'], ['ACAD2000', 'AutoCAD 2000']] }]);
  if (!r) return;
  state.settings.dwgVer = r.ver; saveSettings();
  for (let attempt = 0; attempt < 2; attempt++) {
    busy(tr('正在生成 DWG…'));
    let res;
    try {
      const m = await rpc({ cmd: 'dxf', doc: d.id, edits: d.textEdits, bbox: null });
      res = await B.saveDwg(baseName(d) + tr('_另存') + '.dwg', new Uint8Array(m.bytes), r.ver);
      busy();
      if (res && res.ok) { toast(tr('已另存为 DWG：{0}', res.path) + (m.dropped ? tr('（{0} 个天正/专业软件自定义对象无法转换，已略去）', m.dropped) : ''), 7000); return; }
    } catch (e) { busy(); toast(tr('导出失败：') + (e.message || e)); return; }
    if (!res || res.canceled) return;
    if (res.error) { toast(tr('转换失败：') + res.error, 8000); return; }
    if (res.need) {
      const c = await ask(tr('需要 ODA File Converter'), [{ key: 'a', label: tr('另存 DWG 要用到免费的 ODA File Converter（由开放设计联盟提供，本软件不能自带）。装好后闪电看图会自动找到它。'), type: 'select', value: 'dl', options: [['dl', tr('打开下载页面')], ['pick', tr('我已经装好了，手动指定 ODAFileConverter.exe')], ['dxf', tr('先另存为 DXF（CAD 都能打开）')]] }]);
      if (!c) return;
      if (c.a === 'dl') { B.odaPage(); toast(tr('下载安装后，再点一次「另存为 DWG」'), 6000); return; }
      if (c.a === 'dxf') { saveDxf(d, null); return; }
      if (!(await B.odaPick())) { toast(tr('没有选中 ODAFileConverter.exe')); return; }
    }
  }
}

// ---------------- 比例 ----------------
function updateScaleInfo() {
  const d = state.cur;
  $('#st-scale').textContent = d && d.kind === 'drawing' ? tr('比例：1 图纸单位 = {0} mm', +d.unit.uf.toFixed(6)) + (d.unit.why ? paren(tr(UNIT_WHY[d.unit.why] || '')) : '') : '';
  $('#st-scale').title = tr('点击修改比例与单位'); $('#st-scale').style.cursor = 'pointer'; $('#st-scale').onclick = () => state.cur && state.cur.kind === 'drawing' && scaleDialog();
  $('#st-info').textContent = d && d.kind === 'drawing' ? tr('{0} · {1} 图元', d.scene.info.version, d.scene.stats.entities.toLocaleString()) : '';
}
async function markSettings() {
  const d = state.cur; if (!d || d.kind !== 'drawing') return;
  const COLORS = [['', tr('默认（橙色）')], ['#ff3030', tr('红')], ['#ffc531', tr('黄')], ['#2fd36b', tr('绿')], ['#00e1ff', tr('青')], ['#3fa9ff', tr('蓝')], ['#ff3bd4', tr('品红')], ['#ffffff', tr('白')]];
  const r = await ask(tr('标注设置'), [
    { key: 'ts', label: tr('新标注的文字大小（屏幕像素，按当前缩放换算成图纸尺寸）'), type: 'number', value: d.unit.ts || 13 },
    { key: 'color', label: tr('标注颜色'), type: 'select', value: d.unit.color || '', options: COLORS },
    { key: 'tick', label: tr('尺寸线端头'), type: 'select', value: d.unit.tick || 'oblique', options: [['oblique', tr('建筑斜线')], ['arrow', tr('箭头')]] },
    { key: 'dec', label: tr('小数位数'), type: 'number', value: d.unit.dec },
    { key: 'all', label: tr('已有标注的文字大小'), type: 'select', value: 'keep', options: [['keep', tr('保持不变')], ['reset', tr('全部改成上面的大小')]] },
  ]);
  if (!r) return;
  d.unit.ts = Math.max(6, Math.min(80, +r.ts || 13)); d.unit.color = r.color; d.unit.tick = r.tick; d.unit.dec = Math.max(0, Math.min(6, Math.round(+r.dec || 0)));
  if (r.all === 'reset') { const ts = tsNow(); const key = spaceKey(); for (const m of d.measures) if (m.space === key) m.ts = ts; }
  saveSidecar(d); refreshSide(); redraw();
}
async function scaleDialog() {
  const d = state.cur;
  const r = await ask(tr('测量比例与单位'), [
    { key: 'mode', label: tr('设置方式'), type: 'select', value: 'num', options: [['num', tr('直接输入：1 个图纸单位 = 多少毫米')], ['pick', tr('在图上点两点，输入实际长度（校准）')]] },
    { key: 'uf', label: tr('1 图纸单位 = ? 毫米'), type: 'number', value: d.unit.uf },
    { key: 'len', label: tr('长度单位'), type: 'select', value: d.unit.len, options: [['mm', tr('毫米 mm')], ['m', tr('米 m')]] },
    { key: 'area', label: tr('面积单位'), type: 'select', value: d.unit.area, options: [['m2', tr('平方米 m²')], ['mm2', tr('平方毫米 mm²')]] },
    { key: 'dec', label: tr('小数位数'), type: 'number', value: d.unit.dec },
  ]);
  if (!r) return;
  d.unit.len = r.len; d.unit.area = r.area; d.unit.dec = Math.max(0, Math.min(6, Math.round(+r.dec || 0))); d.unit.manual = true; d.unit.why = 'manual';
  if (r.mode === 'pick') { setTool('calib'); toast(tr('点取图上一段已知长度的两端')); }
  else if (+r.uf > 0) d.unit.uf = +r.uf;
  saveSidecar(d); updateScaleInfo(); refreshSide(); redraw();
}
async function calibrate(du) {
  const d = state.cur;
  const r = await ask(tr('比例校准'), [{ key: 'v', label: tr('这段在图上是 {0} 图纸单位，实际长度是多少毫米？', du.toFixed(4)), type: 'number', value: (du * d.unit.uf).toFixed(2) }]);
  if (r && +r.v > 0 && du > 0) { d.unit.uf = +r.v / du; d.unit.manual = true; d.unit.why = 'manual'; saveSidecar(d); updateScaleInfo(); refreshSide(); redraw(); toast(tr('比例已更新：1 图纸单位 = {0} mm', +d.unit.uf.toFixed(6))); }
}

// ---------------- 侧边面板 ----------------
function toggleSide(id) { state.side = state.side === id ? null : id; refreshSide(); refreshToolbar(); }
$('#side-close').onclick = () => { state.side = null; refreshSide(); refreshToolbar(); };
function refreshSide() {
  const el = $('#side'); const body = $('#side-body');
  const id = state.side;
  el.classList.toggle('hidden', !id);
  requestAnimationFrame(() => { sizeCanvas(); redraw(); });
  if (!id) return;
  const d = state.cur;
  $('#side-title').textContent = { layers: tr('图层'), stats: tr('测量统计'), find: tr('文字查找'), compare: tr('图纸对比'), help: tr('帮助与快捷键'), oles: tr('嵌入表格（OLE）'), xref: tr('外部参照'), blocks: tr('图块统计') }[id];
  body.innerHTML = '';
  if (id === 'help') return helpPanel(body);
  if (!d) { body.innerHTML = `<div class="empty-note">${tr('先打开一张图纸')}</div>`; return; }
  if (id === 'layers') layersPanel(body, d);
  else if (id === 'stats') statsPanel(body, d);
  else if (id === 'find') findPanel(body, d);
  else if (id === 'compare') comparePanel(body, d);
  else if (id === 'oles') olePanel(body, d);
  else if (id === 'xref') xrefPanel(body, d);
  else if (id === 'blocks') blocksPanel(body, d);
}
// 图纸里嵌入的 OLE 对象（多为设计院附的 Excel 工程量表）：定位查看，或把原始 Excel 文件另存出来
function olePanel(body, d) {
  if (d.kind !== 'drawing') { body.innerHTML = `<div class="empty-note">${tr('对比视图里不显示嵌入表格')}</div>`; return; }
  const list = [];
  spaces(d).forEach((sp, si) => (sp.oles || []).forEach((o, k) => list.push({ o, si, sp, k })));
  if (!list.length) { body.append(h('div', { cls: 'empty-note', text: tr('这张图纸里没有嵌入的 OLE 对象。') })); return; }
  body.append(h('div', { cls: 'k', style: 'color:#5b6676;font-size:11px;margin-bottom:8px', text: tr('共 {0} 个。显示的是保存图纸时 Windows 记录的预览；「另存 Excel」导出的是嵌入的原始表格文件。', list.length) }));
  for (const it of list) {
    const title = oleTitle(it.o) || tr('OLE 对象 {0}', it.k + 1);
    const row = h('div', { cls: 'mrow', style: 'display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid #e6e9ee' },
      h('div', { style: 'flex:1;min-width:0' }, h('div', { style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis', text: title, title }), h('div', { style: 'color:#7a8594;font-size:11px', text: spName(it.sp) + (it.o.prog ? ' · ' + it.o.prog : '') })),
      h('button', { cls: 'btn', text: tr('定位'), onclick: () => locateOle(d, it) }),
      it.o.pkg ? h('button', { cls: 'btn', text: OLE_SAVE[it.o.pkgType] || tr('另存原文件'), onclick: () => saveBytes(baseName(d) + '_' + safeName(title) + '.' + (it.o.pkgType || 'zip'), it.o.pkg) }) : null);
    body.append(row);
  }
}
function oleTitle(o) {
  // 取预览里字号最大的一行文字作为标题（通常是「××材料表」「工程量表」）
  let best = null;
  for (const op of o.pic.ops) if (op.t === 'T' && op.s.trim().length > 1 && (!best || Math.abs(op.h) > Math.abs(best.h) + 0.5)) best = op;
  if (!best) return '';
  const line = o.pic.ops.filter(op => op.t === 'T' && Math.abs(op.y - best.y) < Math.abs(best.h) * 0.3 && Math.abs(op.h) === Math.abs(best.h)).sort((a, b) => a.x - b.x).map(op => op.s).join('');
  return line.trim().slice(0, 60);
}
function safeName(s) { return s.replace(/[\\/:*?"<>|\s\x00-\x1f]+/g, '_').slice(0, 40).replace(/[._]+$/, '') || 'OLE'; }
const OLE_SAVE = { xlsx: tr('另存 Excel'), docx: tr('另存 Word'), pptx: tr('另存 PPT') };
function locateOle(d, it) {
  if (d.spaceIdx !== it.si) { d.spaceIdx = it.si; renderSpaceTabs(); }
  const b = it.o.bb; const w = Math.max(b[2] - b[0], b[3] - b[1]) * 0.05;
  zoomTo([b[0] - w, b[1] - w, b[2] + w, b[3] + w], 20);
}
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) e[k] = v; else if (k === 'cls') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
function layersPanel(body, d) {
  const LAYERS = d.kind === 'drawing' ? d.scene.layers : (d.layersList || []);
  const list = h('div');
  const filter = h('input', { type: 'text', placeholder: tr('筛选图层…') });
  const render = () => {
    list.innerHTML = '';
    const q = filter.value.trim().toLowerCase();
    for (const l of LAYERS) {
      if (q && !l.name.toLowerCase().includes(q)) continue;
      const on = d.layerOn.get(l.name) !== false;
      const iso = h('button', { cls: 'iso', text: tr('只看'), title: tr('只显示这个图层（隔离）') });
      iso.onclick = (e) => { e.stopPropagation(); if (!d.layerSaved) d.layerSaved = new Map(d.layerOn); for (const x of LAYERS) d.layerOn.set(x.name, x.name === l.name); refreshSide(); redraw(); };
      const row = h('div', { cls: 'layer' + (on ? '' : ' off'), title: tr('单击开关此图层') },
        h('span', { cls: 'eye', text: on ? '●' : '○' }), h('span', { cls: 'sw', style: `background:${css(l.color, R.bg === 'white' ? 'white' : 'black')}` }), h('span', { cls: 'nm', text: l.name }), iso);
      row.onclick = () => { d.layerOn.set(l.name, !on); render(); redraw(); };
      list.appendChild(row);
    }
  };
  filter.oninput = render;
  const all = (v) => { d.layerSaved = null; for (const l of LAYERS) d.layerOn.set(l.name, v); refreshSide(); redraw(); };
  const restore = () => { if (d.layerSaved) { for (const [k, v] of d.layerSaved) d.layerOn.set(k, v); d.layerSaved = null; } refreshSide(); redraw(); };
  if (d.layerSaved) body.append(h('div', { cls: 'row', style: 'margin-bottom:8px;padding:6px 8px;background:#fff1c9;border-radius:6px' }, h('span', { text: tr('正在隔离显示'), style: 'flex:1' }), h('button', { cls: 'btn primary', text: tr('恢复显示'), onclick: restore })));
  body.append(h('div', { cls: 'row', style: 'margin-bottom:8px' }, h('button', { cls: 'btn', text: tr('全部打开'), onclick: () => all(true) }), h('button', { cls: 'btn', text: tr('全部关闭'), onclick: () => all(false) }), h('button', { cls: 'btn', text: tr('反选'), onclick: () => { for (const l of LAYERS) d.layerOn.set(l.name, d.layerOn.get(l.name) === false); render(); redraw(); } })), filter, h('div', { style: 'height:6px' }), list);
  render();
}
function statsPanel(body, d) {
  if (d.kind !== 'drawing') { body.innerHTML = `<div class="empty-note">${tr('对比视图不能测量')}</div>`; return; }
  const catSel = h('select'); for (const c of d.cats) catSel.append(h('option', { value: c, text: catName(c) }));
  catSel.value = d.cat; catSel.onchange = () => { d.cat = catSel.value; saveSidecar(d); };
  body.append(
    h('div', { cls: 'sec' }, h('h4', { text: tr('新测量归入分类') }), h('div', { cls: 'row' }, catSel, h('button', { cls: 'btn', text: tr('新建'), onclick: async () => { const r = await ask(tr('新建分类'), [{ key: 'n', label: tr('分类名称（如：电缆排管、混凝土包封）') }]); if (r && r.n.trim() && !d.cats.includes(r.n.trim())) { d.cats.push(r.n.trim()); d.cat = r.n.trim(); saveSidecar(d); refreshSide(); } } }))),
    h('div', { cls: 'row', style: 'margin-bottom:10px;flex-wrap:wrap' },
      h('button', { cls: 'btn primary', text: tr('导出 Excel'), onclick: () => exportXlsx(d) }),
      h('button', { cls: 'btn', text: tr('比例设置'), onclick: scaleDialog }),
      h('button', { cls: 'btn danger', text: tr('清空'), onclick: async () => { if (!d.measures.length) return; const r = await ask(tr('确定删除全部 {0} 条测量？', d.measures.length), []); if (r) { d.measures.splice(0); saveSidecar(d); refreshSide(); redraw(); } } })),
    h('div', { cls: 'k', style: 'color:#5b6676;font-size:11px;margin-bottom:8px', text: tr('比例 1:{0}（图纸单位→mm）· 结果自动保存在图纸旁的「图纸名.lpeek.json」', +d.unit.uf.toFixed(4)) }),
    h('div', { cls: 'disclaimer', text: tr('测量结果用于快速查看和粗略核量，依赖图纸绘制精度与比例设置，不能替代正式的工程量计算。') }),
  );
  body.append(h('div', { cls: 'row', style: 'margin-bottom:8px;flex-wrap:wrap' }, h('button', { cls: 'btn', text: tr('导出标注'), onclick: () => exportMarks(d) }), h('button', { cls: 'btn', text: tr('导入标注'), onclick: () => importMarks(d) }), h('button', { cls: 'btn', text: tr('图块清单'), onclick: () => blockList(d) })));
  if (!d.measures.length) { body.append(h('div', { cls: 'empty-note', html: '' }, tr('还没有测量结果。'), h('br'), tr('用工具栏的「长度」「面积」等量一下，结果会按分类汇总在这里。'), h('br'), tr('双击一条结果可改备注、分类，长度可填高度算展开面积，面积可设偏移。'), h('br'), tr('不选工具时，拖动测量或批注可移动，按住 Ctrl 拖动可复制。'))); return; }
  const groups = new Map();
  for (const m of d.measures) { const c = m.cat || '默认分类'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(m); }
  for (const [c, arr] of groups) {
    let len = 0, area = 0, nl = 0, na = 0, exp = 0, cnt = 0;
    for (const m of arr) { const v = measureValue(m); if (v.kind === 'len') { len += v.num; nl++; if (v.exp) exp += v.exp; } if (v.kind === 'area') { area += v.num; na++; } if (v.kind === 'count') cnt += v.num; }
    const fa = (a) => d.unit.area === 'mm2' ? a.toFixed(d.unit.dec) + ' mm²' : (a / 1e6).toFixed(3) + ' m²';
    const sum = [nl ? tr('长度合计 {0}', d.unit.len === 'm' ? (len / 1000).toFixed(3) + ' m' : len.toFixed(d.unit.dec) + ' mm') : '', na ? tr('面积合计 {0}', fa(area)) : '', exp ? tr('展开面积 {0}', fa(exp)) : '', cnt ? tr('数量 {0}', cnt) : ''].filter(Boolean).join('\n');
    const box = h('div', { cls: 'cat' }, h('div', { cls: 'h' }, h('span', { text: catName(c) + paren(arr.length) }), h('span', { cls: 'sum', text: sum })));
    for (const m of arr) {
      const v = measureValue(m);
      const sp = d.scene.spaces.find(s => s.key === m.space);
      const it = h('div', { cls: 'mitem' + (m.id === state.selMeasure ? ' sel' : ''), title: tr('单击定位，双击改备注/分类') },
        h('span', { text: TYPE_NAME[m.type] + (m.note ? ' · ' + m.note : '') }), h('span', { cls: 'v', text: v.main }),
        h('span', { cls: 'k', text: (sp && sp.paper ? spName(sp) + ' · ' : '') + (v.sub || '') }), h('span', { cls: 'k', html: '' }, h('a', { href: '#', text: tr('删除'), onclick: (e) => { e.preventDefault(); e.stopPropagation(); removeItem('m', m); } })));
      it.onclick = () => locateMeasure(m);
      it.ondblclick = async () => {
        const f = [{ key: 'note', label: tr('备注'), value: m.note || '' }, { key: 'cat', label: tr('分类'), type: 'select', value: m.cat || '默认分类', options: d.cats.map(x => [x, catName(x)]) }];
        if (['dist', 'lin', 'poly', 'boxlen', 'arclen', 'seglen', 'batch'].includes(m.type)) f.push({ key: 'height', label: tr('展开高度 mm（填了就按 长度×高度 算展开面积，如墙面、侧模）'), type: 'number', value: m.height || '' });
        if (m.type === 'area') f.push({ key: 'offset', label: tr('面积偏移 mm（正数外扩，负数内缩，如外放 500 的基坑）'), type: 'number', value: m.offset || '' });
        const r = await ask(tr('编辑测量'), f);
        if (r) { pushUndo(d, { op: 'props', item: m, old: { note: m.note, cat: m.cat, height: m.height, offset: m.offset } }); m.note = r.note.trim(); m.cat = r.cat; if ('height' in r) m.height = +r.height || 0; if ('offset' in r) m.offset = +r.offset || 0; saveSidecar(d); refreshSide(); redraw(); }
      };
      box.append(it);
    }
    body.append(box);
  }
}
function blockList(d) {
  const sp = curSpace(); const cnt = new Map();
  for (const it of sp.inserts || []) if (countable(it.n) && layerVisible(sp, it.l)) cnt.set(it.n, (cnt.get(it.n) || 0) + 1);
  if (!cnt.size) { toast(tr('当前空间没有图块')); return; }
  const rows = [[tr('图块名称'), tr('数量')]]; [...cnt].sort((a, b) => b[1] - a[1]).forEach(([n, c]) => rows.push([blockLabel(n), c]));
  saveBytes(baseName(d) + tr('_图块清单.xlsx'), makeXlsx([{ name: tr('图块清单'), rows, widths: [40, 10] }]));
}
function locateMeasure(m) {
  const d = state.cur;
  const si = spaces(d).findIndex(s => s.key === m.space); if (si >= 0 && si !== d.spaceIdx) { d.spaceIdx = si; renderSpaceTabs(); }
  if (!d.views[d.spaceIdx]) zoomExtents(true);
  const P = m.pts.map(L);
  let bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of P) { bb[0] = Math.min(bb[0], p[0]); bb[1] = Math.min(bb[1], p[1]); bb[2] = Math.max(bb[2], p[0]); bb[3] = Math.max(bb[3], p[1]); }
  if (m.type === 'radius') { const r = dist(P[0], P[1]); bb = [P[0][0] - r, P[0][1] - r, P[0][0] + r, P[0][1] + r]; }
  const w = Math.max(bb[2] - bb[0], bb[3] - bb[1]) || (curSpace().view[2] - curSpace().view[0]) / 50;
  zoomTo([bb[0] - w * .4, bb[1] - w * .4, bb[2] + w * .4, bb[3] + w * .4]);
  state.selMeasure = m.id; refreshSide();
}
function findPanel(body, d) {
  const input = h('input', { type: 'text', placeholder: tr('输入要查找的文字，回车搜索') });
  const out = h('div', { style: 'margin-top:8px' });
  const run = () => {
    out.innerHTML = '';
    const q = input.value.trim(); if (!q) return;
    const ql = q.toLowerCase(); const res = [];
    const sps = d.kind === 'drawing' ? spaces(d) : [d.space];
    const fb = state.findBox;
    sps.forEach((sp, si) => {
      if (fb && fb.space !== sp.key) return;
      for (const t of sp.texts) if (t.s.toLowerCase().includes(ql)) { if (fb && (t.x < fb.bb[0] || t.x > fb.bb[2] || t.y < fb.bb[1] || t.y > fb.bb[3])) continue; res.push({ t, si, sp }); if (res.length >= 2000) break; }
    });
    out.append(h('div', { cls: 'k', style: 'color:#5b6676;margin-bottom:6px', text: tr('找到 {0}{1} 处', res.length, res.length >= 2000 ? '+' : '') }));
    if (res.length) out.append(h('div', { cls: 'row', style: 'margin-bottom:6px' }, h('button', { cls: 'btn', text: tr('导出查找结果'), onclick: () => {
      const rows = [[tr('序号'), tr('文字'), tr('所在空间'), tr('图层'), 'X', 'Y']];
      res.forEach((r, i) => { const o = r.sp.origin || [0, 0]; rows.push([i + 1, r.t.s, spName(r.sp), r.t.layer, +(r.t.x + o[0]).toFixed(3), +(r.t.y + o[1]).toFixed(3)]); });
      saveBytes(baseName(d) + tr('_查找_') + q + '.xlsx', makeXlsx([{ name: tr('查找结果'), rows, widths: [6, 50, 10, 16, 14, 14] }]));
    } })));
    for (const r of res.slice(0, 600)) {
      const i = r.t.s.toLowerCase().indexOf(ql);
      const row = h('div', { cls: 'result' }, h('div', {}, r.t.s.slice(0, i), h('mark', { text: r.t.s.slice(i, i + q.length) }), r.t.s.slice(i + q.length)), h('div', { cls: 's', text: tr('{0} · 图层 {1}', spName(r.sp), r.t.layer) }));
      row.onclick = () => {
        if (d.kind === 'drawing' && r.si !== d.spaceIdx) { d.spaceIdx = r.si; renderSpaceTabs(); }
        const L0 = (r.t._wl || r.t.s.length * r.t.h) ; const ex = Math.hypot(r.t.ux, r.t.uy) * L0;
        const bb = [r.t.x - r.t.h * 2, r.t.y - r.t.h * 2, r.t.x + ex + r.t.h * 2, r.t.y + r.t.h * 3];
        const pad = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 1.2;
        zoomTo([bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad]);
        state.flash = { doc: d, bb: [r.t.x - r.t.h * .3, r.t.y - r.t.h * .4, r.t.x + ex * (r.t.ha === 1 ? .5 : 1) + r.t.h * .3, r.t.y + r.t.h * 1.3], until: performance.now() + 2500 };
        if (r.t.ha === 1) state.flash.bb = [r.t.x - ex / 2 - r.t.h * .3, state.flash.bb[1], r.t.x + ex / 2 + r.t.h * .3, state.flash.bb[3]];
        if (r.t.ha === 2) state.flash.bb = [r.t.x - ex - r.t.h * .3, state.flash.bb[1], r.t.x + r.t.h * .3, state.flash.bb[3]];
        redraw();
      };
      out.append(row);
    }
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') run(); e.stopPropagation(); };
  const fbRow = h('div', { cls: 'row', style: 'margin-top:6px' },
    h('button', { cls: 'btn', text: state.findBox ? tr('重新框选范围') : tr('框选查找范围'), onclick: () => setTool('findbox') }),
    state.findBox ? h('button', { cls: 'btn', text: tr('清除范围（全图查找）'), onclick: () => { state.findBox = null; refreshSide(); redraw(); } }) : null);
  body.append(h('div', { cls: 'row' }, input, h('button', { cls: 'btn primary', text: tr('查找'), onclick: run })), fbRow, out);
  if (state.lastFind) { input.value = state.lastFind; setTimeout(run, 0); }
  input.addEventListener('input', () => { state.lastFind = input.value; });
  setTimeout(() => input.focus(), 30);
}
function comparePanel(body, d) {
  if (d.kind === 'compare') {
    const r = d.result, c = r.counts, v = d.cmpVis;
    const stat = (n, t, color) => h('div', { style: `flex:1;text-align:center;padding:6px 2px;border-radius:6px;background:${color}22;border:1px solid ${color}` }, h('div', { style: 'font-size:18px;font-weight:700;font-family:Consolas,monospace', text: String(n) }), h('div', { style: 'font-size:11px;color:#5b6676', text: t }));
    body.append(
      h('div', { cls: 'k', style: 'line-height:1.6;font-size:12px', text: tr('旧图：{0}', d.a) }), h('div', { cls: 'k', style: 'line-height:1.6;font-size:12px;margin-bottom:6px', text: tr('新图：{0}', d.b) }),
      h('div', { cls: 'row', style: 'gap:6px;margin-bottom:6px' }, stat(c.diffAreas, tr('不同之处'), '#ff4d4f'), stat(c.sameAreas, tr('相同之处'), '#3fa9ff')),
      h('div', { cls: 'row', style: 'gap:6px;margin-bottom:8px' }, stat(c.del, tr('删除图元'), CMP_COLORS.del), stat(c.add, tr('新增图元'), CMP_COLORS.add), stat(c.mod, tr('修改文字'), '#e0a800'), stat(c.same, tr('相同图元'), '#7d8794')),
      h('div', { cls: 'k', style: 'font-size:11px;color:#5b6676;margin-bottom:8px', text: r.alignVotes >= 3 && (r.shift[0] || r.shift[1]) ? tr('已自动对齐：旧图整体平移 ({0}, {1})，依据 {2} 处相同文字', r.shift[0].toFixed(2), r.shift[1].toFixed(2), r.alignVotes) : (d.opts.align ? tr('两图位置一致，无需对齐') : tr('未启用自动对齐')) }),
    );
    const modeRow = h('div', { cls: 'row', style: 'margin-bottom:8px' });
    for (const [m, t] of [['overlay', tr('叠加')], ['side', tr('左右并排')], ['swipe', tr('卷帘')]]) modeRow.append(h('button', { cls: 'btn' + (d.cmpMode === m ? ' primary' : ''), text: t, onclick: () => { d.cmpMode = m; refreshSide(); redraw(); } }));
    body.append(h('h4', { text: tr('查看方式'), style: 'margin:4px 0;font-size:12px;color:#5b6676' }), modeRow);
    const chk = (obj, k, color, text) => { const cb = h('input', { type: 'checkbox' }); cb.checked = obj[k]; cb.onchange = () => { obj[k] = cb.checked; redraw(); }; return h('label', { cls: 'row', style: 'cursor:pointer' }, cb, color ? h('i', { style: `background:${color}` }) : null, text); };
    body.append(h('h4', { text: tr('显示与亮显'), style: 'margin:8px 0 4px;font-size:12px;color:#5b6676' }),
      h('div', { cls: 'legend' }, chk(v, 'del', CMP_COLORS.del, tr('删除（旧图有，新图没有）')), chk(v, 'add', CMP_COLORS.add, tr('新增（新图有，旧图没有）')), chk(v, 'mod', CMP_COLORS.mod, tr('修改（黄=新内容，橙=旧内容）')), chk(v, 'same', '#7d8794', tr('相同部分')), chk(v, 'sameHi', CMP_COLORS.sameHi, tr('亮显相同部分（蓝色）')), chk(v, 'boxes', null, tr('框出所有不同之处'))),
      h('div', { cls: 'row', style: 'gap:10px;margin:2px 0 8px' }, chk(d.cmpKinds, 'line', null, tr('线条')), chk(d.cmpKinds, 'text', null, tr('文字')), chk(d.cmpKinds, 'fill', null, tr('填充'))));
    const tolIn = h('input', { type: 'number', step: 'any', value: d.opts.tolMm ?? '' , placeholder: tr('自动') }); tolIn.style.width = '80px';
    const alignCb = h('input', { type: 'checkbox' }); alignCb.checked = d.opts.align;
    body.append(h('h4', { text: tr('对比设置'), style: 'margin:8px 0 4px;font-size:12px;color:#5b6676' }),
      h('div', { cls: 'row', style: 'flex-wrap:wrap;gap:8px;margin-bottom:6px' }, h('label', { cls: 'row' }, tr('容差'), tolIn, 'mm'), h('label', { cls: 'row' }, alignCb, tr('自动对齐')), h('button', { cls: 'btn', text: tr('重新对比'), onclick: () => { d.opts.tolMm = +tolIn.value || null; d.opts.align = alignCb.checked; rerunCompare(d); } })),
      h('div', { cls: 'row', style: 'flex-wrap:wrap;gap:6px;margin-bottom:10px' }, h('button', { cls: 'btn primary', text: tr('导出差异报告'), onclick: () => compareReport(d) }), h('button', { cls: 'btn', text: tr('新图差异处加云线'), onclick: () => cloudChanges(d) }), h('button', { cls: 'btn', text: tr('导出对比图 PDF'), onclick: () => exportPdf(d, 'full') })));
    const filt = d.cmpFilter || 'all';
    const fr = h('div', { cls: 'row', style: 'margin-bottom:6px;gap:4px' });
    for (const [code, label] of [['all', tr('全部')], ['mod', tr('修改')], ['add', tr('新增')], ['del', tr('删除')]]) { const n = code === 'all' ? r.changes.length : r.changes.filter(x => x.type === code).length; fr.append(h('button', { cls: 'btn' + (filt === code ? ' primary' : ''), text: tr('{0} {1}', tr(label), n), onclick: () => { d.cmpFilter = code; refreshSide(); } })); }
    body.append(h('h4', { text: tr('不同之处清单（{0} 处）', r.changes.length), style: 'margin:8px 0 6px;font-size:12px;color:#5b6676' }), fr,
      h('div', { cls: 'row', style: 'margin-bottom:6px' }, h('button', { cls: 'btn', text: tr('上一处'), onclick: () => gotoCluster(d, d.cmpIdx - 1) }), h('button', { cls: 'btn', text: tr('下一处'), onclick: () => gotoCluster(d, d.cmpIdx + 1) }), h('button', { cls: 'btn', text: tr('全图'), onclick: () => zoomExtents() })));
    if (!r.changes.length) body.append(h('div', { cls: 'empty-note', text: tr('两张图纸的模型空间完全相同') }));
    r.changes.forEach((c, i) => {
      if (filt !== 'all' && c.type !== filt) return;
      if (i > 800) return;
      const color = c.type === 'add' ? CMP_COLORS.add : c.type === 'del' ? CMP_COLORS.del : '#e0a800';
      const parts = [c.del ? tr('删 {0}', c.del) : '', c.add ? tr('增 {0}', c.add) : '', c.mod ? tr('改 {0}', c.mod) : ''].filter(Boolean).join(' · ');
      const row = h('div', { cls: 'result', style: i === d.cmpIdx ? 'background:#fff1c9' : '' },
        h('div', { cls: 'row' }, h('span', { style: `display:inline-block;padding:0 6px;border-radius:4px;color:#fff;background:${color};font-size:11px`, text: tr({ add: tr('新增'), del: tr('删除'), mod: tr('修改') }[c.type]) }), h('span', { text: tr('第 {0} 处', i + 1) }), h('span', { cls: 's', style: 'margin-left:auto', text: parts })),
        ...c.texts.slice(0, 3).map(([o, n]) => h('div', { cls: 's', style: 'margin-top:2px' }, h('s', { text: o.slice(0, 40), style: 'color:#d64545' }), ' → ', h('b', { text: n.slice(0, 40), style: 'color:#1f2733' }))),
        h('div', { cls: 's', text: tr('图层：') + c.layers.slice(0, 4).join('、') + (c.layers.length > 4 ? '…' : '') }));
      row.onclick = () => gotoCluster(d, i);
      body.append(row);
    });
    return;
  }
  body.append(
    h('div', { cls: 'empty-note', style: 'text-align:left' }, tr('把当前图纸当作「旧图」，再选一张「新图」，逐个图元比对，统计相同之处与不同之处，区分新增、删除、修改，并可叠加、并排、卷帘查看。'), h('br'), h('br'), tr('两版图纸整体挪了位置也能自动对齐。')),
    h('button', { cls: 'btn primary', text: tr('选择新图纸开始对比'), onclick: () => startCompare(d) }),
  );
  const others = state.docs.filter(x => x !== d && x.kind === 'drawing');
  if (others.length) {
    body.append(h('h4', { text: tr('或与已打开的图纸对比'), style: 'margin:14px 0 6px;font-size:12px;color:#5b6676' }));
    for (const o of others) body.append(h('div', { cls: 'result', onclick: () => runCompare(d, o) }, h('div', { text: o.name }), h('div', { cls: 's', text: tr('作为新图') })));
  }
}
async function startCompare(a) {
  let b = null;
  if (B.openDialog) { const ps = await B.openDialog({ single: true }); if (!ps || !ps.length) return; b = await openPath(ps[0]); }
  else {
    const f = await new Promise(res => { const i = h('input', { type: 'file', accept: '.dwg,.dxf' }); i.onchange = () => res(i.files[0]); i.click(); });
    if (!f) return; b = await openBytes(f.name, new Uint8Array(await f.arrayBuffer()), null);
  }
  if (b) runCompare(a, b);
}
async function runCompare(a, b) {
  const doc = { kind: 'compare', name: tr('对比：{0} → {1}', a.name, b.name), a: a.name, b: b.name, aDoc: a, bDoc: b, cmpVis: { del: true, add: true, mod: true, same: true, sameHi: false, boxes: true }, cmpKinds: { line: true, text: true, fill: true }, cmpMode: 'overlay', swipe: 0.5, cmpIdx: -1, spaceIdx: 0, views: {}, layerOn: new Map(), opts: { align: true, tolMm: null } };
  if (await computeCompare(doc)) { state.docs.push(doc); state.side = 'compare'; activate(doc); }
}
async function rerunCompare(d) { const v = d.views; if (await computeCompare(d)) { d.views = v; d.cmpIdx = -1; refreshSide(); redraw(); } }
async function computeCompare(doc) {
  busy(tr('正在对比图纸…'));
  try {
    const uf = doc.bDoc.unit ? doc.bDoc.unit.uf : 1;
    const m = await rpc({ cmd: 'compare', a: doc.aDoc.id, b: doc.bDoc.id, opts: { align: doc.opts.align, tol: doc.opts.tolMm ? doc.opts.tolMm / uf : 0 } });
    const r = m.result; doc.result = r;
    const texts = []; for (const k of Object.keys(r.buckets)) texts.push(...r.buckets[k].text.texts);
    doc.space = { key: 'cmp', name: tr('对比'), texts, view: r.view, bbox: r.view, origin: r.origin };
    doc.layerOn = new Map(r.layers.map(l => [l, doc.aDoc.layerOn.get(l) !== false && doc.bDoc.layerOn.get(l) !== false]));
    doc.layersList = r.layers.map(l => ({ name: l, color: (doc.bDoc.scene.layers.find(x => x.name === l) || doc.aDoc.scene.layers.find(x => x.name === l) || { color: -7 }).color, on: true }));
    busy();
    const c = r.counts;
    toast(c.diffAreas === 0 ? tr('两张图纸的模型空间完全相同') : tr('不同之处 {0} 处（删除 {1}、新增 {2}、修改 {3}），相同之处 {4} 处', c.diffAreas, c.del, c.add, c.mod, c.sameAreas), 6000);
    return true;
  } catch (err) { busy(); toast(tr('对比失败：') + err.message); return false; }
}
function gotoCluster(d, i) {
  const list = d.result.changes; const n = list.length; if (!n) return;
  d.cmpIdx = (i + n) % n; const c = list[d.cmpIdx];
  const w = Math.max(c.bb[2] - c.bb[0], c.bb[3] - c.bb[1], (d.space.view[2] - d.space.view[0]) / 80);
  zoomTo([c.bb[0] - w, c.bb[1] - w, c.bb[2] + w, c.bb[3] + w]); refreshSide();
}
function compareReport(d) {
  const r = d.result, c = r.counts, o = r.origin;
  const sum = [[tr('项目'), tr('数值')], [tr('旧图'), d.a], [tr('新图'), d.b], [tr('不同之处（处）'), c.diffAreas], [tr('相同之处（处）'), c.sameAreas], [tr('删除图元'), c.del], [tr('新增图元'), c.add], [tr('修改文字'), c.mod], [tr('相同图元'), c.same], [tr('旧图图元总数'), c.totalA], [tr('新图图元总数'), c.totalB], [tr('自动对齐平移'), r.alignVotes >= 3 ? `(${r.shift[0].toFixed(3)}, ${r.shift[1].toFixed(3)})` : tr('无')], [tr('对比时间'), new Date().toLocaleString(LANG === 'zh' ? 'zh-CN' : 'en-US')]];
  const rows = [[tr('序号'), tr('类型'), tr('删除'), tr('新增'), tr('修改'), tr('涉及图层'), tr('图元类别'), tr('文字变化（旧 → 新）'), tr('中心X'), tr('中心Y')]];
  r.changes.forEach((g, i) => rows.push([i + 1, tr({ add: tr('新增'), del: tr('删除'), mod: tr('修改') }[g.type]), g.del, g.add, g.mod, g.layers.join('、'), g.kinds.map(k => ({ line: tr('线条'), text: tr('文字'), fill: tr('填充') }[k])).join('、'), g.texts.map(([a, b]) => a + ' → ' + b).join('；'), +((g.bb[0] + g.bb[2]) / 2 + o[0]).toFixed(3), +((g.bb[1] + g.bb[3]) / 2 + o[1]).toFixed(3)]));
  saveBytes(d.b.replace(/\.(dwg|dxf)$/i, '') + tr('_对比报告.xlsx'), makeXlsx([{ name: tr('对比汇总'), rows: sum, widths: [18, 50] }, { name: tr('不同之处清单'), rows, widths: [6, 8, 6, 6, 6, 30, 14, 50, 14, 14] }]));
}
function cloudChanges(d) {
  const b = d.bDoc; if (!state.docs.includes(b)) { toast(tr('新图已关闭')); return; }
  const ms = modelSpace(b); const o = ms.origin; let n = 0;
  for (const c of d.result.changes) {
    const w = Math.max(c.bb[2] - c.bb[0], c.bb[3] - c.bb[1]) * 0.15 + d.result.size / 400;
    const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), space: ms.key, type: 'cloud', pts: [[c.bb[0] - w + o[0], c.bb[1] - w + o[1]], [c.bb[2] + w + o[0], c.bb[3] + w + o[1]]], arc: d.result.size / 300, color: c.type === 'add' ? '#2fd36b' : c.type === 'del' ? '#ff4d4f' : '#ff3030' };
    b.annots.push(item); pushUndo(b, { op: 'add', kind: 'a', item }); n++;
  }
  saveSidecar(b); toast(tr('已在新图「{0}」的 {1} 处差异加云线，切到该图纸即可查看', b.name, n), 5000);
}
const DEFAULT_KEYS = { dist: '1', poly: '2', area: '3', areapick: '4', angle: '5', radius: '6', coord: '7', boxlen: '8', count: '9', zoomwin: 'W', text: 'T', cloud: 'Y', arrow: 'A', rect: 'R', line: 'L', num: 'N', erase: 'E', table: 'B', edittext: 'X', clip: 'C', stats: 'S', layers: 'G' };
function keyMap() { const ks = { ...DEFAULT_KEYS, ...(state.settings.keys || {}) }; const m = {}; for (const [t, k] of Object.entries(ks)) if (k) m[k.toUpperCase()] = t; return m; }
function sceneFontNames(sc) {
  const s = new Set();
  for (const sp of sc.spaces || []) for (const t of sp.texts || []) {
    if (t.sf) s.add(t.sf);
    if (t.bf) s.add(t.bf);
    if (t.ff) s.add(t.ff);
  }
  return [...s];
}
async function loadSceneFonts(sc) {
  const names = sceneFontNames(sc);
  if (!names.length || !B.fontRead) return '';
  try {
    const info = await B.fontInfo(names);
    state.fontCount = info.count;
    state.fontDirs = info.dirs;
    const have = names.filter(n => info.have[n]);
    const rows = have.length ? await B.fontRead(have) : [];
    let shx = 0;
    for (const [name, bytes] of rows) {
      if (!bytes) continue;
      if (/\.shx$/i.test(name)) { try { if (installFont(name, bytes)) shx++; } catch (e) { console.warn(name, e); } }
      else {
        try {
          const key = String(name).toLowerCase();
          const fam = 'lp-' + key.replace(/[^a-z0-9]+/g, '');
          const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          const face = new FontFace(fam, buf);
          await face.load();
          document.fonts.add(face);
          R.ttf.set(key, '"' + fam + '"');
        } catch (e) { console.warn(name, e); }
      }
    }
    const miss = names.filter(n => !info.have[n]);
    if (miss.length) return tr('　这台电脑没有 {0}，已用软件自带的中文字体显示。', miss.slice(0, 6).join('、'));
    if (shx) return tr('　已用本机 SHX 字体');
    return '';
  } catch (e) { console.warn(e); return ''; }
}
async function reloadOpenFonts() {
  for (const d of state.docs) if (d.scene) await loadSceneFonts(d.scene);
  redraw();
}
async function chooseFontDir() {
  const r = await B.fontPickDir();
  if (!r) return;
  state.fontDirs = r.dirs;
  state.fontCount = r.count;
  await reloadOpenFonts();
  if (state.side === 'help') refreshSide();
  toast(tr('已改用字体文件夹：{0}（共 {1} 个）', r.dir, r.count), 5000);
}
async function copyFontsIn() {
  const r = await B.fontCopy();
  if (!r || !r.copied) { toast(tr('没有需要复制的字体。本机 AutoCAD 和 Windows 里的字体会自动使用。')); return; }
  const info = await B.fontInfo([]);
  state.fontCount = info.count;
  state.fontDirs = info.dirs;
  if (state.side === 'help') refreshSide();
  toast(tr('已把 {0} 个字体复制到软件里。以后不插这块硬盘也能显示。', r.copied), 5000);
}
async function refreshFontInfo() {
  if (!B.fontInfo) return;
  try { const info = await B.fontInfo([]); state.fontCount = info.count; state.fontDirs = info.dirs; } catch (e) { /* 忽略 */ }
}
function helpPanel(body) {
  const sel = h('select'); for (const [v, n] of [['zh', '中文'], ['en', 'English']]) sel.append(h('option', { value: v, text: n })); sel.value = LANG;
  sel.onchange = () => {
    setLang(sel.value); state.settings.lang = sel.value; saveSettings(); flushSidecars();
    try { sessionStorage.setItem('lpeek.reopen', JSON.stringify(state.docs.filter(d => d.kind === 'drawing' && d.path).map(d => d.path))); } catch (e) { /* 忽略 */ }
    location.reload();
  };
  if (B.fontInfo) {
    const dirs = state.fontDirs || [];
    body.append(h('h4', { text: tr('CAD 字体'), style: 'margin:0 0 6px;font-size:12px;color:#5b6676' }));
    body.append(h('div', { cls: 'k', style: 'color:#5b6676;font-size:11px;line-height:1.6;margin-bottom:8px', text: tr('打开图纸就会自动找本机字体：先用图纸里写的文件；没有时名字里带 hz 的大字体（hztxt.shx、gbcbig.shx、hzfs.shx、gbhzfs.shx）互相替，西文 simplex.shx、txt.shx、complex.shx、gbenor.shx、monotxt.shx、gbxwxt.shx 互相替。认不出的 SHX（例如 IDQSTYLE）也按这套标准字体显示，缺一个汉字就把整行改成软件自带的中文。2007 的天正文字从对象里读出来，也用这套中文来画。行宽按图纸来：有文字框的不超过文字框，原来是单线字的按单线字的行宽来画，不压住旁边的字。宋体、黑体用 Windows 里已经安装的。这些字体不随软件分发。下面的文件夹可以不选。') }));
    body.append(h('div', { style: 'font-size:12px;line-height:1.5;margin-bottom:8px;word-break:break-all;white-space:pre-wrap', text: dirs.length ? dirs.join('\n') : tr('这台电脑上还没找到 AutoCAD 或 Windows 字体目录。不选也能看字。') }));
    body.append(h('div', { style: 'font-size:12px;margin-bottom:8px', text: tr('已找到 {0} 个字体文件', state.fontCount || 0) }));
    body.append(h('div', { cls: 'row', style: 'margin-bottom:14px' },
      h('button', { cls: 'btn primary', text: tr('选择字体文件夹'), onclick: chooseFontDir }),
      h('button', { cls: 'btn', text: tr('复制到软件里'), onclick: copyFontsIn })));
  }
  if (B.openGuide) body.append(h('button', { cls: 'btn primary', style: 'width:100%;margin-bottom:12px', text: tr('打开使用说明（PDF）'), onclick: async () => { const r = await B.openGuide(); if (r) toast(tr('无法打开使用说明：') + r); } }));
  body.append(h('label', { style: 'display:flex;flex-direction:column;gap:4px;margin-bottom:12px;font-size:12px;color:#5b6676' }, tr('界面语言（切换后界面会重新加载）'), sel));
  const keys = [[tr('滚轮'), tr('以光标为中心缩放')], [tr('左键拖动 / 中键拖动'), tr('平移')], [tr('Home / 双击中键'), tr('全图')], ['W', tr('窗口缩放')], [tr('右键 / 回车'), tr('结束连续测量、面积')], ['Esc', tr('退出当前工具')], ['F3', tr('对象捕捉开关')], ['F8', tr('正交开关')], ['Ctrl+Z', tr('撤销')], ['Ctrl+O', tr('打开')], ['Ctrl+F', tr('文字查找')], ['Ctrl+P', tr('打印')], ['Ctrl+Tab', tr('切换图纸')]];
  const t = h('table', { cls: 'keys' }); for (const [k, v] of keys.filter(x => !/^1 ~ 7|^W$/.test(x[0]))) t.append(h('tr', {}, h('td', {}, h('span', { cls: 'kbd', text: k })), h('td', { text: v })));
  const names = {}; for (const g of TOOLS) for (const [id, label] of g) names[id] = label;
  const kt = h('table', { cls: 'keys' });
  const ks = { ...DEFAULT_KEYS, ...(state.settings.keys || {}) };
  for (const id of Object.keys(DEFAULT_KEYS)) {
    const inp = h('input', { type: 'text', value: ks[id] || '', maxlength: '1' }); inp.style.width = '46px'; inp.style.textAlign = 'center';
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key.length === 1) { e.preventDefault(); inp.value = e.key.toUpperCase(); } else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); inp.value = ''; } else return; const nk = { ...(state.settings.keys || {}) }; for (const [t2, k2] of Object.entries({ ...DEFAULT_KEYS, ...nk })) if (t2 !== id && inp.value && k2 === inp.value) nk[t2] = ''; nk[id] = inp.value; state.settings.keys = nk; saveSettings(); refreshSide(); };
    kt.append(h('tr', {}, h('td', { text: names[id] || id }), h('td', {}, inp)));
  }
  body.append(h('h4', { text: tr('快捷键（单击输入框后按新键即可修改，冲突会自动让出）'), style: 'margin:4px 0 6px;font-size:12px;color:#5b6676' }), kt, h('div', { cls: 'row', style: 'margin:8px 0 14px' }, h('button', { cls: 'btn', text: tr('恢复默认'), onclick: () => { state.settings.keys = {}; saveSettings(); refreshSide(); } })), h('h4', { text: tr('通用操作'), style: 'margin:4px 0 6px;font-size:12px;color:#5b6676' }));
  body.append(t, h('div', { cls: 'empty-note', style: 'text-align:left;font-size:12px' },
    tr('捕捉标记：□ 端点　△ 中点　○ 圆心　◇ 象限点'), h('br'), h('br'),
    tr('测量和批注保存在图纸同目录的「图纸名.dwg.lpeek.json」里，不会改动原图。'), h('br'), h('br'),
    tr('闪电看图 {0}　开源软件（GPL-3.0）。DWG 解析基于 LibreDWG（GPL-3.0）。', B.version || '')));
}

// ---------------- 导出 / 打印 ----------------
function baseName(d) { return d.name.replace(/\.(dwg|dxf)$/i, ''); }
function exportXlsx(d) {
  const rows = [[tr('序号'), tr('分类'), tr('类型'), tr('数值'), tr('单位'), tr('附加信息'), tr('展开面积/偏移后面积'), tr('备注'), tr('所在空间'), tr('点坐标')]];
  const sums = new Map();
  d.measures.forEach((m, i) => {
    const v = measureValue(m, d);
    const unit = v.kind === 'len' || v.kind === 'radius' ? (d.unit.len === 'm' ? 'm' : 'mm') : v.kind === 'area' ? (d.unit.area === 'mm2' ? 'mm²' : 'm²') : v.kind === 'angle' ? '°' : v.kind === 'count' ? tr('个') : '';
    let num = v.num; if (num != null) { if (v.kind === 'len' || v.kind === 'radius') num = d.unit.len === 'm' ? num / 1000 : num; else if (v.kind === 'area') num = d.unit.area === 'mm2' ? num : num / 1e6; num = +num.toFixed(6); }
    const sp = d.scene.spaces.find(s => s.key === m.space);
    const extra = v.exp ? +(d.unit.area === 'mm2' ? v.exp : v.exp / 1e6).toFixed(6) : '';
    rows.push([i + 1, catName(m.cat), TYPE_NAME[m.type], num ?? `${m.pts[0][0].toFixed(3)}, ${m.pts[0][1].toFixed(3)}`, unit, v.sub || '', extra, m.note || '', spName(sp), m.pts.map(p => `(${p[0].toFixed(3)}, ${p[1].toFixed(3)})`).join(' ')]);
    if (v.kind === 'len' || v.kind === 'area' || v.kind === 'count') { const k = (m.cat || '默认分类') + '\u0000' + v.kind; const s = sums.get(k) || { n: 0, v: 0, unit }; s.n++; s.v += num; sums.set(k, s); }
  });
  const sum = [[tr('分类'), tr('类型'), tr('条数'), tr('合计'), tr('单位')]];
  for (const [k, s] of sums) { const [c, kind] = k.split('\u0000'); sum.push([catName(c), { len: tr('长度'), area: tr('面积'), count: tr('数量') }[kind], s.n, +s.v.toFixed(6), s.unit]); }
  if (sum.length === 1) sum.push([tr('（无长度/面积测量）'), '', '', '', '']);
  const info = [[tr('项目'), tr('内容')], [tr('图纸'), d.name], [tr('路径'), d.path || ''], [tr('比例'), tr('1 图纸单位 = {0} mm', d.unit.uf)], [tr('导出时间'), new Date().toLocaleString(LANG === 'zh' ? 'zh-CN' : 'en-US')], [tr('软件'), tr('闪电看图') + ' ' + (B.version || '')], [tr('提示'), tr('测量结果用于快速查看和粗略核量，依赖图纸绘制精度与比例设置，不能替代正式的工程量计算。')]];
  saveBytes(baseName(d) + tr('_测量统计.xlsx'), makeXlsx([{ name: tr('分类汇总'), rows: sum, widths: [24, 10, 8, 16, 8] }, { name: tr('测量明细'), rows, widths: [6, 16, 8, 14, 6, 34, 16, 20, 10, 60] }, { name: tr('说明'), rows: info, widths: [12, 60] }]));
}
function exportMarks(d) {
  const j = { app: 'lightning-peek', kind: 'marks', file: d.name, unit: d.unit, cats: d.cats, measures: d.measures, annots: d.annots, textEdits: d.textEdits };
  saveBytes(baseName(d) + tr('_标注.json'), new TextEncoder().encode(JSON.stringify(j, (k, v) => k === '_lb' ? undefined : v, 1)));
}
async function importMarks(d) {
  let text = null;
  if (B.openAny) { const ps = await B.openAny({ name: tr('闪电看图标注'), ext: ['json'] }); if (!ps || !ps.length) return; text = await B.readText(ps[0]); }
  else { const f = await new Promise(res => { const i = h('input', { type: 'file', accept: '.json' }); i.onchange = () => res(i.files[0]); i.click(); }); if (!f) return; text = await f.text(); }
  try {
    const j = JSON.parse(text); let n = 0;
    const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    for (const m of j.measures || []) { m.id = nid(); d.measures.push(m); n++; }
    for (const a of j.annots || []) { a.id = nid(); d.annots.push(a); n++; }
    for (const c of j.cats || []) if (!d.cats.includes(c)) d.cats.push(c);
    saveSidecar(d); refreshSide(); redraw(); toast(tr('导入了 {0} 条测量和批注', n));
  } catch (e) { toast(tr('标注文件格式不对：') + e.message); }
}
async function saveBytes(name, bytes) {
  try { const p = await B.saveBytes(name, bytes); if (p) toast(tr('已保存：') + p, 4000); }
  catch (e) { toast(tr('保存失败：') + e.message); }
}
function renderImage(d, mode, maxSide) {
  // 生成离屏图像：current = 当前视图；full = 全图
  const v = view(); const sp = d.kind === 'drawing' ? curSpace() : d.space;
  // 导出总是按图纸本来的方向（不带屏幕旋转/镜像）；当前视图取屏幕四角在图纸上的外包范围
  const corners = () => { const q = [toLocal(0, 0), toLocal(cv.width, 0), toLocal(cv.width, cv.height), toLocal(0, cv.height)]; return [Math.min(...q.map(x => x[0])), Math.min(...q.map(x => x[1])), Math.max(...q.map(x => x[0])), Math.max(...q.map(x => x[1]))]; };
  let bb;
  if (Array.isArray(mode)) bb = mode;
  else if (mode === 'current') bb = corners();
  else { bb = sp.view || sp.bbox; if (sp.paper && sp.viewports.length) { const save = d.views[d.spaceIdx]; zoomExtents(true); bb = corners(); d.views[d.spaceIdx] = save; } }
  const w = bb[2] - bb[0], hgt = bb[3] - bb[1];
  let k = maxSide / Math.max(w, hgt);
  const MAX_PX = 16000000; const area = Math.max(w * hgt, 1e-12);
  if (area * k * k > MAX_PX) k = Math.sqrt(MAX_PX / area);
  const W0 = Math.max(1, Math.round(w * k)), H0 = Math.max(1, Math.round(hgt * k));
  const off = document.createElement('canvas'); off.width = W0; off.height = H0;
  const c2 = off.getContext('2d');
  // 临时把绘制目标换成离屏画布
  const vv = { s: k, cx: (bb[0] + bb[2]) / 2, cy: (bb[1] + bb[3]) / 2 };
  const M = [k, 0, 0, -k, W0 / 2 - k * vv.cx, H0 / 2 + k * vv.cy];
  c2.fillStyle = R.bg === 'white' ? '#fff' : '#000'; c2.fillRect(0, 0, W0, H0);
  const dprE = Math.max(1, maxSide / 2400);
  if (d.kind === 'compare') {
    withTarget(c2, off, dprE, vv, () => { drawCompare(d, M, [0, 0, W0, H0]); drawCompareChrome(d, M, false); });
  } else if (sp.paper) {
    withTarget(c2, off, dprE, vv, () => drawPaper(d, sp, M, [0, 0, W0, H0]));
  } else { R.drawSpace(c2, sp, M, [0, 0, W0, H0], { dpr: dprE }); drawXrefs(d, c2, sp, M, [0, 0, W0, H0], dprE); }
  if (d.kind === 'drawing') withTarget(c2, off, dprE, vv, () => drawOverlays(d, M));
  return off;
  function withTarget(c, canvas, dpr, vw, fn) {
    const oc = ctx, ocv = cv, od = DPR, ov = d.views[d.spaceIdx], orot = d.rot, omir = d.mir;
    ctx = c; cv = canvas; DPR = dpr; d.views[d.spaceIdx] = vw; d.rot = 0; d.mir = false;
    try { fn(); } finally { ctx = oc; cv = ocv; DPR = od; d.views[d.spaceIdx] = ov; d.rot = orot; d.mir = omir; }
  }
}
async function exportMenu(anchor) {
  const d = state.cur; if (!d) return;
  const items = [
    [tr('导出图片 PNG（当前视图，高清）'), () => exportPng(d, 'current')],
    [tr('导出图片 PNG（全图，超清）'), () => exportPng(d, 'full')],
    null,
    [tr('导出 PDF（全图，A3）'), () => exportPdf(d, 'full')],
    [tr('导出 PDF（当前视图，A3）'), () => exportPdf(d, 'current')],
  ];
  if (d.kind === 'drawing') items.push(null, [tr('另存为 DWG（含文字修改，原图不变）'), () => saveDwg(d)], [tr('另存为 DXF（含文字修改，原图不变）'), () => saveDxf(d, null)], [tr('导出测量统计 Excel'), () => exportXlsx(d)], null, [tr('导出标注文件（发给同事）'), () => exportMarks(d)], [tr('导入标注文件'), () => importMarks(d)]);
  showMenu(anchor, items);
}
async function exportPng(d, mode) {
  busy(tr('正在生成图片…')); await nextFrame();
  try {
    const off = renderImage(d, mode, mode === 'full' ? 8000 : Math.max(cv.width, cv.height) * 2);
    const blob = await new Promise(r => off.toBlob(r, 'image/png'));
    busy(); await saveBytes(baseName(d) + (mode === 'full' ? tr('_全图') : tr('_视图')) + '.png', new Uint8Array(await blob.arrayBuffer()));
  } catch (e) { busy(); toast(tr('导出失败：') + e.message); }
}
async function exportPdf(d, mode) {
  busy(tr('正在生成 PDF…')); await nextFrame();
  const oldBg = R.bg; R.bg = 'white';
  try {
    const off = renderImage(d, mode, 4961);
    R.bg = oldBg;
    const landscape = off.width >= off.height;
    const dataUrl = off.toDataURL('image/png');
    busy();
    if (B.browser) { const w = window.open(''); w.document.write(`<img src="${dataUrl}" style="width:100%">`); return; }
    const p = await B.exportPdf({ dataUrl, landscape, name: baseName(d) + '.pdf' });
    if (p) toast(tr('已保存：') + p, 4000);
  } catch (e) { R.bg = oldBg; busy(); toast(tr('导出失败：') + e.message); }
}
async function printDoc() {
  const d = state.cur; if (!d) return;
  const choice = await ask(tr('打印'), [{ key: 'm', label: tr('打印范围'), type: 'select', value: 'full', options: [['full', tr('全图')], ['current', tr('当前视图')]] }, { key: 'bg', label: tr('颜色'), type: 'select', value: 'white', options: [['white', tr('白底（推荐，省墨）')], ['keep', tr('保持当前背景')]] }]);
  if (!choice) return;
  busy(tr('正在准备打印…')); await nextFrame();
  const oldBg = R.bg; if (choice.bg === 'white') R.bg = 'white';
  try {
    const off = renderImage(d, choice.m, 4961);
    R.bg = oldBg;
    busy();
    await B.printImage({ dataUrl: off.toDataURL('image/png'), landscape: off.width >= off.height });
  } catch (e) { R.bg = oldBg; busy(); toast(tr('打印失败：') + e.message); }
  redraw();
}

// ---------------- 小部件 ----------------
function nextFrame() { return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); }
function busy(text) { const b = $('#busy'); if (!text) { b.classList.add('hidden'); return; } $('#busy-text').textContent = text; b.classList.remove('hidden'); }
let toastTimer = null;
function toast(t, ms = 2600) { const el = $('#toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), ms); }
function showTip(t, x, y) { const el = $('#tooltip'); el.textContent = t; el.style.left = (x + 16) + 'px'; el.style.top = (y + 14) + 'px'; el.classList.remove('hidden'); }
function hideTip() { $('#tooltip').classList.add('hidden'); }
function ask(title, fields) {
  return new Promise((resolve) => {
    $('#m-title').textContent = title; const body = $('#m-body'); body.innerHTML = '';
    const inputs = {};
    for (const f of fields) {
      let el;
      if (f.type === 'select') { el = h('select'); for (const [v, t] of f.options) el.append(h('option', { value: v, text: t })); el.value = f.value ?? f.options[0][0]; }
      else if (f.type === 'textarea') { el = h('textarea'); el.value = f.value ?? ''; }
      else { el = h('input', { type: f.type || 'text' }); el.value = f.value ?? ''; if (f.type === 'number') el.step = 'any'; }
      inputs[f.key] = el; body.append(h('label', {}, f.label, el));
    }
    const m = $('#modal'); m.classList.remove('hidden');
    const first = body.querySelector('input,textarea,select'); if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 20);
    const done = (ok) => { m.classList.add('hidden'); document.removeEventListener('keydown', key, true); const r = {}; for (const k in inputs) r[k] = inputs[k].value; resolve(ok ? r : null); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } else if (e.key === 'Enter' && !(e.target.tagName === 'TEXTAREA' && !e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); done(true); } };
    document.addEventListener('keydown', key, true);
    $('#m-ok').onclick = () => done(true); $('#m-cancel').onclick = () => done(false);
  });
}
function showMenu(anchor, items) {
  const m = $('#menu'); m.innerHTML = '';
  for (const it of items) { if (!it) { m.append(h('div', { cls: 'sep' })); continue; } const d = h('div', { cls: 'mi', text: it[0] }); d.onclick = () => { m.classList.add('hidden'); it[1](); }; m.append(d); }
  const r = anchor.getBoundingClientRect(); m.style.left = Math.min(r.left, innerWidth - 260) + 'px'; m.style.top = r.bottom + 2 + 'px'; m.classList.remove('hidden');
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!m.contains(e.target)) { m.classList.add('hidden'); document.removeEventListener('pointerdown', off, true); } }, true), 0);
}
function recentMenu(anchor) {
  const list = (state.settings.recent || []).filter(r => r.path);
  if (!list.length) { toast(tr('还没有最近打开的图纸')); return; }
  showMenu(anchor, [...list.slice(0, 15).map(r => [r.name + '　—　' + r.path, () => openPath(r.path)]), null, [tr('清空记录'), () => { state.settings.recent = []; saveSettings(); renderRecent(); }]]);
}
function addRecent(path, name) {
  if (!path) return;
  const r = (state.settings.recent || []).filter(x => x.path !== path);
  r.unshift({ path, name, t: Date.now() }); state.settings.recent = r.slice(0, 20); saveSettings(); renderRecent();
}
function saveSettings() { B.setSettings(state.settings).catch?.(() => { }); }
function renderRecent() {
  const el = $('#recent-list'); el.innerHTML = '';
  const list = (state.settings.recent || []).filter(r => r.path).slice(0, 8);
  if (!list.length) return;
  el.append(h('h4', { text: tr('最近打开') }));
  for (const r of list) el.append(h('div', { cls: 'recent', onclick: () => openPath(r.path) }, h('span', { text: r.name }), h('span', { cls: 'p', text: r.path })));
}

// ---------------- 键盘 ----------------
document.addEventListener('keydown', (e) => {
  if (!$('#modal').classList.contains('hidden')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const k = e.key; const c = e.ctrlKey || e.metaKey;
  if (c && k.toLowerCase() === 'o') { e.preventDefault(); openDialog(); }
  else if (c && k.toLowerCase() === 'f') { e.preventDefault(); if (state.cur) { state.side = 'find'; refreshSide(); refreshToolbar(); } }
  else if (c && k.toLowerCase() === 'p') { e.preventDefault(); printDoc(); }
  else if (c && k.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
  else if (c && k.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (c && k.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (!c && state.tool === 'area' && (k === 'a' || k === 'A')) { state.arcMode = !state.arcMode; toast(state.arcMode ? tr('弧线段：先点弧上一点，再点弧的终点；再按 A 回到直线') : tr('直线段')); redraw(); }
  else if (c && k === 'Tab') { e.preventDefault(); if (state.docs.length > 1) { const i = state.docs.indexOf(state.cur); activate(state.docs[(i + (e.shiftKey ? -1 : 1) + state.docs.length) % state.docs.length]); } }
  else if (c && k.toLowerCase() === 'w') { e.preventDefault(); if (state.cur) closeDoc(state.cur); }
  else if (k === 'Escape') { if (state.tmp.length || state.batchSel.length) { state.tmp = []; state.tmpArc = new Set(); state.batchSel = []; state.arcPending = false; state.p2lSeg = null; redraw(); } else setTool(null); $('#menu').classList.add('hidden'); }
  else if (k === 'Enter') finishTool();
  else if (k === 'Home') zoomExtents();
  else if (k === 'F3') { e.preventDefault(); state.snap = !state.snap; $('#st-snap').classList.toggle('on', state.snap); toast(tr('对象捕捉：') + (state.snap ? tr('开') : tr('关'))); }
  else if (k === 'F8') { e.preventDefault(); state.ortho = !state.ortho; $('#st-ortho').classList.toggle('on', state.ortho); toast(tr('正交：') + (state.ortho ? tr('开') : tr('关'))); }
  else if (!c && state.cur && state.cur.kind === 'drawing') {
    const map = keyMap();
    const kk = k.length === 1 ? k.toUpperCase() : k;
    if (map[kk]) { if (['stats', 'find', 'layers', 'compare'].includes(map[kk])) toggleSide(map[kk]); else if (MODAL_TOOLS.has(map[kk])) setTool(map[kk]); else command(map[kk], { currentTarget: document.querySelector(`.tb[data-id=${map[kk]}]`) }); }
    else if (k === 'Delete' && state.hover) { removeItem(state.hover.kind, state.hover.item); state.hover = null; }
  } else if (!c && (k === 'w' || k === 'W') && state.cur) setTool('zoomwin');
});
$('#st-snap').onclick = () => { state.snap = !state.snap; $('#st-snap').classList.toggle('on', state.snap); };
$('#st-ortho').onclick = () => { state.ortho = !state.ortho; $('#st-ortho').classList.toggle('on', state.ortho); };
$('#empty-open').onclick = openDialog;

// ---------------- 拖放 ----------------
window.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('drop', async (e) => { e.preventDefault(); for (const f of e.dataTransfer.files) await openFileObj(f); });
window.addEventListener('resize', () => redraw());
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => redraw());

// ---------------- 启动 ----------------
function localizeStatic() {
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
  document.title = tr('闪电看图');
  $('#empty h1').textContent = tr('闪电看图');
  $('#empty .logo p').textContent = tr('打开图纸，快速如闪电');
  $('#empty-open').textContent = tr('打开图纸');
  $('#empty .hint').textContent = window.matchMedia('(max-width: 800px)').matches ? tr('从手机文件里选择 DWG 或 DXF。单指移动，双指缩放。') : tr('也可以把图纸文件直接拖进窗口');
  $('#busy-text').textContent = tr('正在打开…');
  $('#st-snap').textContent = tr('捕捉'); $('#st-snap').title = tr('对象捕捉（F3）');
  $('#st-ortho').textContent = tr('正交'); $('#st-ortho').title = tr('正交（F8）');
  $('#st-scale').title = tr('测量比例');
  $('#m-cancel').textContent = tr('取消'); $('#m-ok').textContent = tr('确定');
  $('#side-close').title = tr('关闭面板');
}
(async function init() {
  localizeStatic();
  if (B.setLang) B.setLang(LANG);
  buildToolbar(); refreshToolbar(); cv.className = 'pan';
  try { await document.fonts.load('16px "Noto Sans SC"'); } catch (e) { /* 自带字体加载失败时仍用系统字体 */ }
  try { state.settings = Object.assign({ recent: [] }, await B.getSettings()); } catch (e) { /* ignore */ }
  await refreshFontInfo();
  if (state.settings.bg === 'white') { R.bg = 'white'; $('#stage').style.background = '#fff'; }
  renderRecent(); refreshToolbar();
  B.onOpenFile((p) => openPath(p));
  if (B.ready) B.ready();
  if (!window.sdkt && 'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  try { const re = JSON.parse(sessionStorage.getItem('lpeek.reopen') || '[]'); sessionStorage.removeItem('lpeek.reopen'); for (const p of re) await openPath(p); } catch (e) { /* 忽略 */ }
  // 测试钩子：?file=URL 直接打开
  const q = new URLSearchParams(location.search).get('file');
  if (q) { const r = await fetch(q); await openBytes(decodeURIComponent(q.split('/').pop()), new Uint8Array(await r.arrayBuffer()), null); }
  window.__sdkt = { textBox, findInsert, state, R, openBytes, setTool, toolClick, finishTool, toLocal, toScreen, command, zoomTo, exportXlsx, renderImage, runCompare, measureValue, curveGeom, curSpace, redraw, undo, redo };
})();
