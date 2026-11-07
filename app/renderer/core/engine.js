// 闪电看图 · 几何引擎
// DXF 文本 → 文档结构 → 场景（按样式合批的绘图指令、文字、捕捉点、圆弧表）
// 所有输出坐标都是“局部坐标”= 世界坐标 − 原点，避免大坐标在画布里丢精度。

// ---------- 颜色 ----------
const ACI = buildAci();
function buildAci() {
  const t = new Array(256).fill(0);
  const base = [0x000000, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x808080, 0xc0c0c0];
  for (let i = 0; i < 10; i++) t[i] = base[i];
  const vals = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3];
  for (let i = 10; i < 250; i++) {
    const h = Math.floor((i - 10) / 10) * 15;
    const k = (i - 10) % 10;
    const v = vals[k], s = k % 2 === 0 ? 1 : 0.5;
    t[i] = hsv(h, s, v);
  }
  const grays = [0x33, 0x5b, 0x84, 0xad, 0xd6, 0xff];
  for (let i = 0; i < 6; i++) t[250 + i] = grays[i] * 0x10101;
  return t;
}
function hsv(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}
// 颜色编码：-7 表示“白/黑随背景”，其余为 0xRRGGBB
export const FG = -7;
function aciToRgb(i) { return i === 7 ? FG : ACI[i] ?? FG; }

// ---------- 文本解码 ----------
export function decodeDxfBytes(bytes) { return decodeDxf(bytes).text; }
export function decodeDxf(bytes) {
  const r = decodeDxfInner(bytes);
  return typeof r === 'string' ? { text: r, enc: 'utf-8' } : r;
}
function decodeDxfInner(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { /* 含非法 UTF-8 字节 */ }
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 200000)));
  // R2007 及以后的图纸、或绝大多数多字节序列合法时，按 UTF-8 容错解码（个别截断字符显示为 �）
  const ver = (head.match(/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC(\d{4})/) || [])[1];
  const u = new TextDecoder('utf-8').decode(bytes);
  if (ver && +ver >= 1021) return u;
  // 文件头声明了非 UTF-8 代码页：以声明为准；没有声明时才按非法字节比例判断
  const declared = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(?!UTF)/i.test(head);
  if (!declared) {
    let bad = 0, multi = 0;
    for (let i = 0; i < u.length; i++) { const c = u.charCodeAt(i); if (c === 0xfffd) bad++; else if (c > 0x7f) multi++; }
    if (bad <= Math.max(3, multi * 0.01)) return u;
  }
  const m = head.match(/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n([^\r\n]+)/);
  const cp = (m ? m[1].trim() : 'ANSI_936').toUpperCase();
  const map = { ANSI_936: 'gbk', ANSI_950: 'big5', ANSI_932: 'shift_jis', ANSI_949: 'euc-kr', ANSI_1252: 'windows-1252', ANSI_1251: 'windows-1251', ANSI_1250: 'windows-1250' };
  const enc = map[cp] || 'gbk';
  return { text: new TextDecoder(enc).decode(bytes), enc };
}
// 把文本按旧代码页编码回字节（R2007 以前的 DXF 另存时用）
const ENC_MAPS = new Map();
export function encodeLegacy(text, enc) {
  let m = ENC_MAPS.get(enc);
  if (!m) {
    m = new Map(); const dec = new TextDecoder(enc);
    for (let a = 0x81; a <= 0xfe; a++) for (let b = 0x40; b <= 0xfe; b++) { const ch = dec.decode(new Uint8Array([a, b])); if (ch.length === 1 && ch !== '\ufffd' && !m.has(ch)) m.set(ch, [a, b]); }
    for (let a = 0x80; a <= 0xff; a++) { const ch = dec.decode(new Uint8Array([a])); if (ch.length === 1 && ch !== '\ufffd' && !m.has(ch)) m.set(ch, [a]); }
    ENC_MAPS.set(enc, m);
  }
  const out = new Uint8Array(text.length * 2); let n = 0;
  for (const ch of text) { const c = ch.codePointAt(0); if (c < 0x80) out[n++] = c; else { const e = m.get(ch); if (e) for (const x of e) out[n++] = x; else out[n++] = 0x3f; } }
  return out.subarray(0, n);
}

// LibreDWG 偶尔把 UTF-8 字节当 GBK 再转一遍（如「布局1」→「甯冨眬1」），这里反向修复
let GBK_ENC = null;
export function fixMojibake(s) {
  if (!s || !/[\u4e00-\u9fff]/.test(s) || typeof TextDecoder === 'undefined') return s;
  try {
    if (!GBK_ENC) {
      GBK_ENC = new Map(); const dec = new TextDecoder('gbk');
      for (let a = 0x81; a <= 0xfe; a++) for (let b = 0x40; b <= 0xfe; b++) { const ch = dec.decode(new Uint8Array([a, b])); if (ch.length === 1 && ch !== '\ufffd' && !GBK_ENC.has(ch)) GBK_ENC.set(ch, [a, b]); }
    }
    const bytes = [];
    for (const ch of s) { const c = ch.charCodeAt(0); if (c < 0x80) bytes.push(c); else { const e = GBK_ENC.get(ch); if (!e) return s; bytes.push(...e); } }
    const out = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    return out.length < s.length || /[\u4e00-\u9fff]/.test(out) ? out : s;
  } catch (e) { return s; }
}

// ---------- DXF 词法 ----------
function tokenize(text) {
  const lines = text.split(/\r?\n/);
  const n = lines.length >> 1;
  const codes = new Int32Array(n);
  const vals = new Array(n);
  let k = 0;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = parseInt(lines[i], 10);
    if (Number.isNaN(c)) { i--; continue; } // 容错：跳过一行重新对齐
    codes[k] = c; vals[k] = lines[i + 1]; k++;
  }
  return { codes: codes.subarray(0, k), vals, n: k };
}

class Rec {
  constructor(type, codes, vals) { this.type = type; this.c = codes; this.v = vals; }
  idx(code, from = 0) { const c = this.c; for (let i = from; i < c.length; i++) if (c[i] === code) return i; return -1; }
  s(code, d = '') { const i = this.idx(code); return i < 0 ? d : this.v[i].trim(); }
  raw(code, d = '') { const i = this.idx(code); return i < 0 ? d : this.v[i]; }
  f(code, d = 0) { const i = this.idx(code); if (i < 0) return d; const x = parseFloat(this.v[i]); return Number.isFinite(x) ? x : d; }
  i(code, d = 0) { const i = this.idx(code); if (i < 0) return d; const x = parseInt(this.v[i], 10); return Number.isFinite(x) ? x : d; }
  has(code) { return this.idx(code) >= 0; }
  all(code) { const r = []; for (let i = 0; i < this.c.length; i++) if (this.c[i] === code) r.push(this.v[i]); return r; }
}

export function parseDxf(text) {
  const { codes, vals, n } = tokenize(text);
  const doc = { header: {}, layers: new Map(), ltypes: new Map(), styles: new Map(), blocks: new Map(), blockRecords: new Map(), entities: [], layouts: [] };
  let p = 0;
  const readRec = () => {
    const type = vals[p].trim(); p++;
    const s = p;
    while (p < n && codes[p] !== 0) p++;
    return new Rec(type, Array.from(codes.subarray(s, p)), vals.slice(s, p));
  };
  while (p < n) {
    if (codes[p] === 0 && vals[p].trim() === 'SECTION') {
      p++;
      const name = vals[p].trim(); p++;
      if (name === 'HEADER') {
        let key = null;
        while (p < n && !(codes[p] === 0 && vals[p].trim() === 'ENDSEC')) {
          if (codes[p] === 9) { key = vals[p].trim(); doc.header[key] = []; }
          else if (key) doc.header[key].push([codes[p], vals[p].trim()]);
          p++;
        }
        p++;
      } else if (name === 'TABLES') {
        while (p < n && !(codes[p] === 0 && vals[p].trim() === 'ENDSEC')) {
          if (codes[p] !== 0) { p++; continue; }
          const r = readRec();
          if (r.type === 'LAYER') {
            const nm = r.s(2); const col = r.i(62, 7);
            const tc = r.has(420) ? r.i(420) & 0xffffff : null;
            doc.layers.set(nm.toUpperCase(), { name: nm, color: tc != null ? tc : aciToRgb(Math.abs(col) || 7), off: col < 0, frozen: (r.i(70) & 1) !== 0, ltype: r.s(6, 'CONTINUOUS'), plot: r.i(290, 1) });
          } else if (r.type === 'LTYPE') {
            doc.ltypes.set(r.s(2).toUpperCase(), { name: r.s(2), dashes: r.all(49).map(Number).filter(Number.isFinite), total: r.f(40) });
          } else if (r.type === 'STYLE') {
            doc.styles.set(r.s(2).toUpperCase(), { name: r.s(2), font: r.s(3), big: r.s(4), wf: r.f(41, 1) || 1, obl: r.f(50), h: r.f(40) });
          } else if (r.type === 'BLOCK_RECORD') {
            doc.blockRecords.set(r.s(5).toUpperCase(), r.s(2));
          }
        }
        p++;
      } else if (name === 'BLOCKS') {
        let cur = null;
        while (p < n && !(codes[p] === 0 && vals[p].trim() === 'ENDSEC')) {
          if (codes[p] !== 0) { p++; continue; }
          const r = readRec();
          if (r.type === 'BLOCK') {
            cur = { name: r.s(2), bx: r.f(10), by: r.f(20), flags: r.i(70), ents: [] };
            doc.blocks.set(cur.name.toUpperCase(), cur);
          } else if (r.type === 'ENDBLK') cur = null;
          else if (cur) cur.ents.push(r);
        }
        p++;
      } else if (name === 'ENTITIES') {
        while (p < n && !(codes[p] === 0 && vals[p].trim() === 'ENDSEC')) {
          if (codes[p] !== 0) { p++; continue; }
          doc.entities.push(readRec());
        }
        p++;
      } else if (name === 'OBJECTS') {
        while (p < n && !(codes[p] === 0 && vals[p].trim() === 'ENDSEC')) {
          if (codes[p] !== 0) { p++; continue; }
          const r = readRec();
          if (r.type === 'LAYOUT') {
            // LAYOUT 记录里有两个 1 组码区，名称在 AcDbLayout 子类之后
            const sub = r.c.lastIndexOf(100);
            let nm = '';
            for (let i = sub; i < r.c.length; i++) if (r.c[i] === 1) { nm = r.v[i].trim(); break; }
            const blk = r.all(330).map(s => s.trim().toUpperCase());
            doc.layouts.push({ name: fixMojibake(nm), order: r.i(71), blockHandles: blk });
          }
        }
        p++;
      } else {
        while (p < n && !(codes[p] === 0 && vals[p].trim() === 'ENDSEC')) p++;
        p++;
      }
    } else p++;
  }
  return doc;
}

function hdrNum(doc, key, code, d) {
  const h = doc.header[key]; if (!h) return d;
  const it = h.find(x => x[0] === code); if (!it) return d;
  const v = parseFloat(it[1]); return Number.isFinite(v) ? v : d;
}

// ---------- 仿射变换 [a b c d e f]：x'=a x + c y + e, y'=b x + d y + f ----------
const I = [1, 0, 0, 1, 0, 0];
function mul(m, n) { // m ∘ n
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function ap(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
function det(m) { return m[0] * m[3] - m[1] * m[2]; }
function similarity(m) { // 是否为相似变换（可带镜像）
  const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
  const dot = m[0] * m[2] + m[1] * m[3];
  return Math.abs(sx - sy) <= 1e-9 * Math.max(sx, sy) && Math.abs(dot) <= 1e-9 * sx * sy;
}
// 实体坐标系（OCS）→ 世界坐标的 2D 部分（任意轴算法）
function ocsMatrix(r) {
  const nx = r.f(210, 0), ny = r.f(220, 0), nz = r.f(230, 1);
  if (Math.abs(nx) < 1e-12 && Math.abs(ny) < 1e-12) return nz < 0 ? [-1, 0, 0, 1, 0, 0] : null;
  const L = Math.hypot(nx, ny, nz) || 1; const N = [nx / L, ny / L, nz / L];
  let ax;
  if (Math.abs(N[0]) < 1 / 64 && Math.abs(N[1]) < 1 / 64) ax = cross([0, 1, 0], N); else ax = cross([0, 0, 1], N);
  ax = norm(ax); const ay = norm(cross(N, ax));
  return [ax[0], ax[1], ay[0], ay[1], 0, 0];
}
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// ---------- 文本清理 ----------
export function cleanText(s) {
  if (!s) return '';
  s = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\M\+[0-9A-Fa-f]([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoOkK]/g, '').replace(/%%%/g, '%')
    .replace(/%%(\d{3})/g, (_, d) => String.fromCharCode(+d));
  return s;
}
function mtextLines(raw) {
  let s = cleanText(raw);
  // 叠字 \Sa^b; → a/b
  s = s.replace(/\\S([^;]*?)[\^#/]([^;]*?);/g, '$1/$2');
  s = s.replace(/\\[PpNn]/g, '\n').replace(/\\~/g, ' ');
  s = s.replace(/\\[fFHhWwQqTtAaCcpi][^;]*;/g, '');
  s = s.replace(/\\[LlOoKkXx]/g, '');
  s = s.replace(/\\\\/g, '\u0001').replace(/\\\{/g, '\u0002').replace(/\\\}/g, '\u0003');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}');
  return s.split('\n');
}
const CJK = /[⺀-鿿豈-﫿＀-￯]/;
export function approxWidth(str, h) { // 世界单位宽度估计（未乘宽度因子）
  let w = 0;
  for (const ch of str) w += CJK.test(ch) ? h * 1.0 : (ch === ' ' ? h * 0.5 : h * 0.72);
  return w;
}
function fontFor(doc, styleName) {
  const st = doc.styles.get((styleName || 'STANDARD').toUpperCase());
  const f = ((st && (st.font + ' ' + st.big)) || '').toLowerCase();
  const n = ((st && st.name) || '').toLowerCase();
  if (/simhei|黑/.test(f + n)) return 1;
  if (/simkai|楷/.test(f + n)) return 2;
  if (/simsun|宋|nsimsun/.test(f + n)) return 3;
  if (/msyh|yahei|雅黑/.test(f + n)) return 4;
  if (/arial|tahoma|verdana|calibri/.test(f)) return 5;
  if (/times/.test(f)) return 6;
  return 0; // SHX 等单线字体：用仿宋代替
}
export const FONT_FAMILIES = [
  '"FangSong","仿宋","STFangsong","SimSun","Noto Serif CJK SC",serif',
  '"SimHei","黑体","Microsoft YaHei","Noto Sans CJK SC",sans-serif',
  '"KaiTi","楷体","STKaiti","Noto Serif CJK SC",serif',
  '"SimSun","宋体","NSimSun","Noto Serif CJK SC",serif',
  '"Microsoft YaHei","微软雅黑","Noto Sans CJK SC",sans-serif',
  'Arial,"Microsoft YaHei","Noto Sans CJK SC",sans-serif',
  '"Times New Roman","SimSun","Noto Serif CJK SC",serif',
];

// ---------- 绘图指令编码 ----------
// 1 M x y | 2 L x y | 3 A cx cy r a0 a1 ccw | 4 E cx cy rx ry rot a0 a1 ccw | 5 Z
export const OP = { M: 1, L: 2, A: 3, E: 4, Z: 5 };

// ---------- 场景构建 ----------
export function buildScene(doc, opts = {}) {
  const ltscale = hdrNum(doc, '$LTSCALE', 40, 1) || 1;
  const insunits = hdrNum(doc, '$INSUNITS', 70, 0);
  const measurement = hdrNum(doc, '$MEASUREMENT', 70, 1);

  // 空间划分：模型空间 + 各布局
  const brName = h => doc.blockRecords.get((h || '').toUpperCase()) || '';
  const spaces = new Map(); // key -> space
  const mkSpace = (key, name, order, paper) => {
    if (!spaces.has(key)) spaces.set(key, { key, name, order, paper, ents: [] });
    return spaces.get(key);
  };
  mkSpace('*MODEL_SPACE', '模型', -1, false);
  for (const lo of doc.layouts) {
    if (/^model$/i.test(lo.name)) continue;
    const bn = lo.blockHandles.map(brName).find(b => /^\*PAPER_SPACE/i.test(b));
    if (bn) mkSpace(bn.toUpperCase(), lo.name, lo.order, true);
  }
  for (const r of doc.entities) {
    let owner = brName(r.s(330)).toUpperCase();
    if (!owner) owner = r.i(67) === 1 ? '*PAPER_SPACE' : '*MODEL_SPACE';
    if (!spaces.has(owner)) {
      if (/^\*PAPER_SPACE/.test(owner)) mkSpace(owner, owner === '*PAPER_SPACE' ? '布局1' : owner.replace('*PAPER_SPACE', '布局'), 99, true);
      else owner = '*MODEL_SPACE';
    }
    spaces.get(owner).ents.push(r);
  }
  // BLOCKS 段里的其他图纸空间
  for (const [k, b] of doc.blocks) {
    if (/^\*PAPER_SPACE/.test(k)) {
      const sp = spaces.get(k);
      if (sp && sp.ents.length === 0) sp.ents = b.ents;
    }
    if (k === '*MODEL_SPACE' && spaces.get(k).ents.length === 0) spaces.get(k).ents = b.ents;
  }

  // 原点：用第一个有坐标的模型实体
  let ox = 0, oy = 0;
  {
    const em = doc.header.$EXTMIN, eM = doc.header.$EXTMAX;
    const ms = spaces.get('*MODEL_SPACE').ents;
    const r0 = ms.find(r => r.has(10));
    if (r0) { ox = r0.f(10); oy = r0.f(20); }
    else if (em && eM) {
      const x0 = hdrNum(doc, '$EXTMIN', 10, 0), x1 = hdrNum(doc, '$EXTMAX', 10, 0), y0 = hdrNum(doc, '$EXTMIN', 20, 0), y1 = hdrNum(doc, '$EXTMAX', 20, 0);
      if (Math.abs(x0) < 1e15 && Math.abs(x1) < 1e15) { ox = (x0 + x1) / 2; oy = (y0 + y1) / 2; }
    }
  }

  if (opts.origin) { ox = opts.origin[0]; oy = opts.origin[1]; }
  const out = [];
  const stats = { entities: 0, skipped: {} };
  for (const sp of [...spaces.values()].sort((a, b) => a.order - b.order)) {
    if (sp.paper && sp.ents.length === 0) continue;
    const sink = opts.sinkFactory ? opts.sinkFactory(sp) : new SceneSink();
    const o = sp.paper ? [0, 0] : [ox, oy];
    const root = [1, 0, 0, 1, -o[0], -o[1]];
    const ctx = { doc, sink, ltscale, stats, viewports: [], depth: 0 };
    walk(ctx, sp.ents, root, { layer: '0', color: FG, ltype: 'CONTINUOUS' });
    const res = sink.finish();
    res.key = sp.key; res.name = sp.name; res.paper = sp.paper; res.origin = o;
    res.viewports = ctx.viewports;
    out.push(res);
  }
  const layers = [...doc.layers.values()].map(l => ({ name: l.name, color: l.color, on: !l.off && !l.frozen }));
  return { spaces: out, layers, insunits, measurement, stats, origin: [ox, oy] };
}

// 样式解析：返回 {layer, color, ltype}
function resolveStyle(ctx, r, inh) {
  const doc = ctx.doc;
  let layer = r.s(8, '0');
  if (layer === '0' && inh.layer !== '0' && ctx.depth > 0) layer = inh.layer;
  const lay = doc.layers.get(layer.toUpperCase());
  let color;
  if (r.has(420)) color = r.i(420) & 0xffffff;
  else {
    const c = r.i(62, 256);
    if (c === 256) color = lay ? lay.color : FG;
    else if (c === 0) color = inh.color;
    else color = aciToRgb(Math.abs(c));
  }
  let lt = r.s(6, 'BYLAYER').toUpperCase();
  if (lt === 'BYLAYER') lt = lay ? lay.ltype.toUpperCase() : 'CONTINUOUS';
  else if (lt === 'BYBLOCK') lt = inh.ltype;
  const lts = r.f(48, 1);
  return { layer, color, ltype: lt, lts };
}

function dashFor(ctx, st, m) {
  if (!st.ltype || st.ltype === 'CONTINUOUS') return null;
  const lt = ctx.doc.ltypes.get(st.ltype);
  if (!lt || lt.dashes.length < 2) return null;
  const sc = ctx.ltscale * (st.lts || 1) * Math.sqrt(Math.abs(det(m))) ;
  const d = lt.dashes.map(x => Math.max(Math.abs(x) * sc, 0)).map((x, i) => (x === 0 ? sc * 0.05 : x));
  if (d.reduce((a, b) => a + b, 0) <= 0) return null;
  return d;
}

function walk(ctx, ents, m, inh) {
  for (let i = 0; i < ents.length; i++) {
    const r = ents[i];
    if (r.i(60) === 1) continue; // 不可见
    try {
      const consumed = emitEntity(ctx, r, ents, i, m, inh);
      if (consumed) i += consumed;
    } catch (e) {
      ctx.stats.skipped[r.type + '!'] = (ctx.stats.skipped[r.type + '!'] || 0) + 1;
    }
  }
}

function arcPoints(cx, cy, r, a0, a1, n) {
  let sw = a1 - a0; while (sw <= 0) sw += Math.PI * 2;
  const k = Math.max(4, Math.ceil(n * sw / (Math.PI * 2)));
  const pts = [];
  for (let i = 0; i <= k; i++) { const a = a0 + sw * i / k; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}

// 把 OCS 中的圆弧（逆时针 a0→a1）用变换 m 输出为指令
function pushArc(ops, m, cx, cy, r, a0, a1, connect, full) {
  if (similarity(m)) {
    const [px, py] = ap(m, cx, cy);
    const s = Math.hypot(m[0], m[1]);
    const rot = Math.atan2(m[1], m[0]);
    const mir = det(m) < 0;
    let b0, b1;
    if (!mir) { b0 = a0 + rot; b1 = a1 + rot; }
    else { b0 = rot - a0; b1 = rot - a1; }
    const sx = px + r * s * Math.cos(b0), sy = py + r * s * Math.sin(b0);
    ops.push(connect ? OP.L : OP.M, sx, sy);
    if (full) ops.push(OP.A, px, py, r * s, b0, b0 + (mir ? -Math.PI * 2 : Math.PI * 2), mir ? 0 : 1);
    else ops.push(OP.A, px, py, r * s, b0, b1, mir ? 0 : 1);
    return;
  }
  const pts = full ? arcPoints(cx, cy, r, 0, Math.PI * 2, 96) : arcPoints(cx, cy, r, a0, a1, 96);
  pts.forEach((p, i) => { const q = ap(m, p[0], p[1]); ops.push(i === 0 && !connect ? OP.M : OP.L, q[0], q[1]); });
}

function bulgeArc(x0, y0, x1, y1, b) {
  const th = 4 * Math.atan(b);
  const c = Math.hypot(x1 - x0, y1 - y0);
  const r = c / (2 * Math.sin(Math.abs(th) / 2));
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const d = Math.sqrt(Math.max(r * r - c * c / 4, 0));
  const ux = (x1 - x0) / c, uy = (y1 - y0) / c;
  const sgn = (b > 0 ? 1 : -1) * (Math.abs(th) > Math.PI ? -1 : 1);
  const cx = mx - uy * d * sgn, cy = my + ux * d * sgn;
  const a0 = Math.atan2(y0 - cy, x0 - cx), a1 = Math.atan2(y1 - cy, x1 - cx);
  return { cx, cy, r, a0, a1, ccw: b > 0 };
}

// 顶点列表（含凸度）→ 指令；同时返回折线化点用于捕捉/面积
function polyOps(m, verts, closed) {
  const ops = []; const flat = [];
  const n = verts.length; if (n === 0) return { ops, flat };
  const segs = closed ? n : n - 1;
  let q = ap(m, verts[0][0], verts[0][1]);
  ops.push(OP.M, q[0], q[1]); flat.push(q);
  for (let i = 0; i < segs; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    const bulge = a[2] || 0;
    if (Math.abs(bulge) > 1e-9 && (a[0] !== b[0] || a[1] !== b[1])) {
      const g = bulgeArc(a[0], a[1], b[0], b[1], bulge);
      if (g.ccw) pushArc(ops, m, g.cx, g.cy, g.r, g.a0, g.a1, true, false);
      else { // 顺时针：反向用逆时针弧画会方向错，改为离散
        let sw = g.a0 - g.a1; while (sw <= 0) sw += Math.PI * 2;
        const k = Math.max(4, Math.ceil(96 * sw / (Math.PI * 2)));
        for (let j = 1; j <= k; j++) { const t = g.a0 - sw * j / k; const p = ap(m, g.cx + g.r * Math.cos(t), g.cy + g.r * Math.sin(t)); ops.push(OP.L, p[0], p[1]); }
      }
      const pts = g.ccw ? arcPoints(g.cx, g.cy, g.r, g.a0, g.a1, 48) : arcPoints(g.cx, g.cy, g.r, g.a1, g.a0, 48).reverse();
      for (let j = 1; j < pts.length; j++) flat.push(ap(m, pts[j][0], pts[j][1]));
    } else {
      q = ap(m, b[0], b[1]); ops.push(OP.L, q[0], q[1]); flat.push(q);
    }
  }
  if (closed) ops.push(OP.Z);
  return { ops, flat };
}

function emitEntity(ctx, r, ents, idx, m, inh) {
  const S = ctx.sink; const t = r.type;
  ctx.stats.entities++;
  S.cur = S.lid(resolveStyle(ctx, r, inh).layer);
  const st = () => resolveStyle(ctx, r, inh);
  const om = () => { const o = ocsMatrix(r); return o ? mul(m, o) : m; };
  switch (t) {
    case 'LINE': {
      const a = ap(m, r.f(10), r.f(20)), b = ap(m, r.f(11), r.f(21));
      const s = st();
      S.path(s, [OP.M, a[0], a[1], OP.L, b[0], b[1]], dashFor(ctx, s, m), 0, t);
      S.snap(a[0], a[1], 1); S.snap(b[0], b[1], 1); S.snap((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 2);
      S.seg(a[0], a[1], b[0], b[1]);
      S.curve(s.layer, Math.hypot(b[0] - a[0], b[1] - a[1]), [a, b]);
      return 0;
    }
    case 'XLINE': case 'RAY': {
      const x = r.f(10), y = r.f(20), dx = r.f(11), dy = r.f(21), L = 1e6;
      const a = ap(m, t === 'RAY' ? x : x - dx * L, t === 'RAY' ? y : y - dy * L), b = ap(m, x + dx * L, y + dy * L);
      S.path(st(), [OP.M, a[0], a[1], OP.L, b[0], b[1]], null, 0, t, true);
      return 0;
    }
    case 'CIRCLE': {
      const M = om(); const s = st();
      const ops = []; pushArc(ops, M, r.f(10), r.f(20), r.f(40), 0, Math.PI * 2, false, true);
      S.path(s, ops, dashFor(ctx, s, M), 0, t);
      const c = ap(M, r.f(10), r.f(20)); const rr = r.f(40) * Math.sqrt(Math.abs(det(M)));
      S.snap(c[0], c[1], 3);
      for (let k = 0; k < 4; k++) { const q = ap(M, r.f(10) + r.f(40) * Math.cos(k * Math.PI / 2), r.f(20) + r.f(40) * Math.sin(k * Math.PI / 2)); S.snap(q[0], q[1], 4); }
      S.circle(c[0], c[1], rr, 0, Math.PI * 2, true);
      S.curve(s.layer, 2 * Math.PI * rr, [[c[0] - rr, c[1] - rr], [c[0] + rr, c[1] + rr]]);
      { const ring = []; for (let k = 0; k < 720; k++) ring.push(ap(M, r.f(10) + r.f(40) * Math.cos(k * Math.PI / 360), r.f(20) + r.f(40) * Math.sin(k * Math.PI / 360))); S.region(ring); }
      return 0;
    }
    case 'ARC': {
      const M = om(); const s = st();
      const a0 = r.f(50) * Math.PI / 180, a1 = r.f(51) * Math.PI / 180;
      const ops = []; pushArc(ops, M, r.f(10), r.f(20), r.f(40), a0, a1, false, false);
      S.path(s, ops, dashFor(ctx, s, M), 0, t);
      const c = ap(M, r.f(10), r.f(20)); S.snap(c[0], c[1], 3);
      const p0 = ap(M, r.f(10) + r.f(40) * Math.cos(a0), r.f(20) + r.f(40) * Math.sin(a0));
      const p1 = ap(M, r.f(10) + r.f(40) * Math.cos(a1), r.f(20) + r.f(40) * Math.sin(a1));
      S.snap(p0[0], p0[1], 1); S.snap(p1[0], p1[1], 1);
      let am = a1; while (am < a0) am += Math.PI * 2; am = (a0 + am) / 2;
      const pm = ap(M, r.f(10) + r.f(40) * Math.cos(am), r.f(20) + r.f(40) * Math.sin(am)); S.snap(pm[0], pm[1], 2);
      S.circle(c[0], c[1], r.f(40) * Math.sqrt(Math.abs(det(M))), 0, 0, false);
      { let sw = a1 - a0; while (sw <= 0) sw += Math.PI * 2; const rr = r.f(40) * Math.sqrt(Math.abs(det(M))); const ps = arcPoints(r.f(10), r.f(20), r.f(40), a0, a1, 32).map(q => ap(M, q[0], q[1])); S.curve(s.layer, sw * rr, ps); }
      return 0;
    }
    case 'ELLIPSE': {
      const s = st();
      const cx = r.f(10), cy = r.f(20), mx = r.f(11), my = r.f(21), ratio = r.f(40, 1);
      let p0 = r.f(41, 0), p1 = r.f(42, Math.PI * 2);
      const nz = r.f(230, 1);
      // 次轴 = 法向 × 主轴 × 比例
      const nx_ = nz >= 0 ? -my : my, ny_ = nz >= 0 ? mx : -mx;
      let sw = p1 - p0; while (sw <= 0) sw += Math.PI * 2;
      const k = Math.max(8, Math.ceil(128 * sw / (Math.PI * 2)));
      const ops = []; const flat = [];
      for (let j = 0; j <= k; j++) {
        const u = p0 + sw * j / k;
        const q = ap(m, cx + mx * Math.cos(u) + nx_ * ratio * Math.sin(u), cy + my * Math.cos(u) + ny_ * ratio * Math.sin(u));
        ops.push(j === 0 ? OP.M : OP.L, q[0], q[1]); flat.push(q);
      }
      S.path(s, ops, dashFor(ctx, s, m), 0, t);
      const c = ap(m, cx, cy); S.snap(c[0], c[1], 3);
      if (sw < Math.PI * 2 - 1e-6) { S.snap(flat[0][0], flat[0][1], 1); S.snap(flat[k][0], flat[k][1], 1); }
      for (let j = 0; j < flat.length - 1; j++) S.seg(flat[j][0], flat[j][1], flat[j + 1][0], flat[j + 1][1]);
      S.curve(s.layer, flatLen(flat), flat);
      return 0;
    }
    case 'LWPOLYLINE': {
      const M = om(); const s = st();
      const verts = []; let cur = null;
      for (let j = 0; j < r.c.length; j++) {
        const c = r.c[j];
        if (c === 10) { cur = [parseFloat(r.v[j]), 0, 0]; verts.push(cur); }
        else if (c === 20 && cur) cur[1] = parseFloat(r.v[j]);
        else if (c === 42 && cur) cur[2] = parseFloat(r.v[j]);
      }
      const closed = (r.i(70) & 1) !== 0;
      const { ops, flat } = polyOps(M, verts, closed);
      const w = r.f(43, 0) || (r.has(40) ? r.f(40) : 0);
      S.path(s, ops, dashFor(ctx, s, M), w * Math.sqrt(Math.abs(det(M))), t);
      polySnaps(S, M, verts, flat, closed);
      if (closed && flat.length > 2) S.region(flat);
      S.curve(s.layer, polyLength(verts, closed) * Math.sqrt(Math.abs(det(M))), flat);
      return 0;
    }
    case 'POLYLINE': {
      const flags = r.i(70);
      const verts = []; let j = idx + 1;
      for (; j < ents.length; j++) {
        const v = ents[j];
        if (v.type === 'VERTEX') { const vf = v.i(70); if (vf & 16) continue; if (!(vf & 128) || (vf & 64)) verts.push([v.f(10), v.f(20), v.f(42)]); }
        else break;
      }
      const consumed = j - idx - (ents[j] && ents[j].type === 'SEQEND' ? 0 : 1);
      if (flags & (16 | 64)) { // 网格/多面网格：画顶点连线即可
        const s = st(); const ops = [];
        verts.forEach((v, k) => { const q = ap(m, v[0], v[1]); ops.push(k ? OP.L : OP.M, q[0], q[1]); });
        if (ops.length) S.path(s, ops, null, 0, t);
        return consumed;
      }
      const M = (flags & 8) ? m : om(); const s = st();
      const closed = (flags & 1) !== 0;
      const { ops, flat } = polyOps(M, verts, closed);
      S.path(s, ops, dashFor(ctx, s, M), r.f(40, 0) * Math.sqrt(Math.abs(det(M))), t);
      polySnaps(S, M, verts, flat, closed);
      if (closed && flat.length > 2) S.region(flat);
      S.curve(s.layer, (similarity(M) ? polyLength(verts, closed) * Math.sqrt(Math.abs(det(M))) : flatLen(closed ? [...flat, flat[0]] : flat)), flat);
      return consumed;
    }
    case 'SPLINE': {
      const s = st();
      const pts = splinePoints(r);
      if (pts.length < 2) return 0;
      const ops = []; const flat = pts.map(p => ap(m, p[0], p[1]));
      flat.forEach((q, k) => ops.push(k ? OP.L : OP.M, q[0], q[1]));
      S.path(s, ops, dashFor(ctx, s, m), 0, t);
      S.snap(flat[0][0], flat[0][1], 1); S.snap(flat[flat.length - 1][0], flat[flat.length - 1][1], 1);
      for (let k = 0; k < flat.length - 1; k++) S.seg(flat[k][0], flat[k][1], flat[k + 1][0], flat[k + 1][1]);
      S.curve(s.layer, flatLen(flat), flat);
      return 0;
    }
    case 'SOLID': case 'TRACE': case '3DFACE': {
      const s = st(); const M = t === '3DFACE' ? m : om();
      const p = [[r.f(10), r.f(20)], [r.f(11), r.f(21)], [r.f(13, r.f(12)), r.f(23, r.f(22))], [r.f(12), r.f(22)]].map(q => ap(M, q[0], q[1]));
      if (t === '3DFACE') S.path(s, [OP.M, p[0][0], p[0][1], OP.L, p[1][0], p[1][1], OP.L, p[3][0], p[3][1], OP.L, p[2][0], p[2][1], OP.Z], null, 0, t);
      else S.fill(s, [[p[0], p[1], p[2], p[3]]], t);
      return 0;
    }
    case 'POINT': {
      const q = ap(m, r.f(10), r.f(20)); const s = st();
      S.path(s, [OP.M, q[0], q[1], OP.L, q[0] + 1e-9, q[1]], null, -1, t);
      S.snap(q[0], q[1], 5);
      return 0;
    }
    case 'TEXT': case 'ATTRIB': {
      if (t === 'ATTRIB' && (r.i(70) & 1)) return 0;
      emitText(ctx, r, om(), st());
      return 0;
    }
    case 'ATTDEF': return 0; // 块定义里的属性定义不显示
    case 'MTEXT': emitMText(ctx, r, m, st()); return 0;
    case 'INSERT': case 'ACAD_TABLE': {
      // INSERT 之后可能跟着 ATTRIB…SEQEND
      let consumed = 0;
      const attribs = [];
      if (t === 'INSERT' && r.i(66) === 1) {
        let j = idx + 1;
        for (; j < ents.length && ents[j].type === 'ATTRIB'; j++) attribs.push(ents[j]);
        if (ents[j] && ents[j].type === 'SEQEND') j++;
        consumed = j - idx - 1;
      }
      emitInsert(ctx, r, m, inh, attribs);
      return consumed;
    }
    case 'DIMENSION': case 'ARC_DIMENSION': case 'LARGE_RADIAL_DIMENSION': {
      const bn = r.s(2);
      const blk = ctx.doc.blocks.get(bn.toUpperCase());
      if (!blk || ctx.depth > 12) return 0;
      const s = st();
      const M = mul(m, [1, 0, 0, 1, r.f(12, 0), r.f(22, 0)]);
      ctx.depth++; walk(ctx, blk.ents, M, { layer: s.layer, color: s.color, ltype: s.ltype }); ctx.depth--;
      return 0;
    }
    case 'LEADER': {
      const s = st(); const pts = [];
      for (let j = 0; j < r.c.length; j++) if (r.c[j] === 10) pts.push([parseFloat(r.v[j]), parseFloat(r.v[j + 1])]);
      if (pts.length < 2) return 0;
      const q = pts.map(p => ap(m, p[0], p[1]));
      const ops = []; q.forEach((p, k) => ops.push(k ? OP.L : OP.M, p[0], p[1]));
      S.path(s, ops, null, 0, t);
      if (r.i(71, 1)) { // 箭头
        const [a, b] = q; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > 0) {
          const sz = Math.min(L * 0.3, (r.f(41, 0) || 2.5) * hdrNum(ctx.doc, '$DIMSCALE', 40, 1));
          const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
          S.fill(s, [[a, [a[0] + ux * sz - uy * sz / 6, a[1] + uy * sz + ux * sz / 6], [a[0] + ux * sz + uy * sz / 6, a[1] + uy * sz - ux * sz / 6]]], t);
        }
      }
      return 0;
    }
    case 'HATCH': emitHatch(ctx, r, om(), st()); return 0;
    case 'VIEWPORT': {
      if (ctx.depth === 0 && r.i(69, 2) !== 1 && !(r.i(90) & 131072)) {
        const c = ap(m, r.f(10), r.f(20));
        ctx.viewports.push({ cx: c[0], cy: c[1], w: r.f(40), h: r.f(41), vcx: r.f(12), vcy: r.f(22), vh: r.f(45), twist: r.f(51) * Math.PI / 180, on: !(r.i(90) & 131072) });
      }
      return 0;
    }
    case 'SEQEND': case 'VERTEX': return 0;
    default:
      ctx.stats.skipped[t] = (ctx.stats.skipped[t] || 0) + 1;
      return 0;
  }
}

function polyLength(verts, closed) {
  let L = 0; const n = verts.length; const segs = closed ? n : n - 1;
  for (let k = 0; k < segs; k++) {
    const a = verts[k], b = verts[(k + 1) % n]; const c = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (a[2] && c > 0) { const th = 4 * Math.atan(Math.abs(a[2])); L += th * c / (2 * Math.sin(th / 2)); } else L += c;
  }
  return L;
}
function flatLen(f) { let L = 0; for (let i = 0; i + 1 < f.length; i++) L += Math.hypot(f[i + 1][0] - f[i][0], f[i + 1][1] - f[i][1]); return L; }
function polySnaps(S, M, verts, flat, closed) {
  const n = verts.length;
  for (let k = 0; k < n; k++) { const q = ap(M, verts[k][0], verts[k][1]); S.snap(q[0], q[1], 1); }
  const segs = closed ? n : n - 1;
  for (let k = 0; k < segs; k++) {
    const a = verts[k], b = verts[(k + 1) % n];
    if (!a[2]) { const q = ap(M, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); S.snap(q[0], q[1], 2); }
    else { const g = bulgeArc(a[0], a[1], b[0], b[1], a[2]); const c = ap(M, g.cx, g.cy); S.snap(c[0], c[1], 3); S.circle(c[0], c[1], g.r * Math.sqrt(Math.abs(det(M))), 0, 0, false); }
  }
  for (let k = 0; k < flat.length - 1; k++) S.seg(flat[k][0], flat[k][1], flat[k + 1][0], flat[k + 1][1]);
}

function emitInsert(ctx, r, m, inh, attribs) {
  const bn = r.s(2);
  const blk = ctx.doc.blocks.get(bn.toUpperCase());
  const s = resolveStyle(ctx, r, inh);
  if (blk && ctx.depth < 16) {
    const sx = r.f(41, 1) || 1, sy = r.f(42, 1) || 1, rot = r.f(50) * Math.PI / 180;
    const cols = Math.max(1, r.i(70, 1)), rows = Math.max(1, r.i(71, 1));
    const cs = r.f(44), rs = r.f(45);
    const O = ocsMatrix(r);
    const base = O ? mul(m, O) : m;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const total = cols * rows;
    for (let i = 0; i < Math.min(total, 4096); i++) {
      const ci = i % cols, ri = Math.floor(i / cols);
      const ix = r.f(10) + (ci * cs) * cos - (ri * rs) * sin;
      const iy = r.f(20) + (ci * cs) * sin + (ri * rs) * cos;
      const T = [cos * sx, sin * sx, -sin * sy, cos * sy, ix, iy];
      const B = [1, 0, 0, 1, -blk.bx, -blk.by];
      const M = mul(base, mul(T, B));
      ctx.depth++;
      const acc = ctx.sink.beginInsert();
      walk(ctx, blk.ents, M, { layer: s.layer, color: s.color, ltype: s.ltype });
      ctx.sink.endInsert(acc, blk.name, ctx.depth, s.layer);
      ctx.depth--;
    }
    ctx.sink.cur = ctx.sink.lid(s.layer);
    const ip = ap(base, r.f(10), r.f(20)); ctx.sink.snap(ip[0], ip[1], 5);
  }
  for (const a of attribs) {
    if (a.i(70) & 1) continue;
    emitText(ctx, a, (() => { const o = ocsMatrix(a); return o ? mul(m, o) : m; })(), resolveStyle(ctx, a, inh));
  }
}

function emitText(ctx, r, m, s) {
  const str = cleanText(r.raw(1)).replace(/\s+$/, '');
  if (!str) return;
  const doc = ctx.doc;
  const style = doc.styles.get(r.s(7, 'STANDARD').toUpperCase());
  const h = r.f(40, style && style.h ? style.h : 2.5);
  const wf = r.has(41) ? r.f(41, 1) : (style ? style.wf : 1);
  const obl = (r.has(51) ? r.f(51) : (style ? style.obl : 0)) * Math.PI / 180;
  let ha = r.i(72, 0), va = r.i(73, 0);
  if (r.type === 'ATTRIB') va = r.i(74, va);
  const p1 = [r.f(10), r.f(20)], p2 = [r.f(11, p1[0]), r.f(21, p1[1])];
  let rot = r.f(50) * Math.PI / 180;
  const gen = r.i(71, 0);
  let anchor = (ha || va) ? p2 : p1;
  let fitW = 0;
  if (ha === 3 || ha === 5) { // 对齐 / 布满：两点之间
    rot = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    fitW = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    anchor = p1; ha = 0; va = 0;
  } else if (ha === 4) { ha = 1; va = 2; }
  const item = textItem(m, anchor[0], anchor[1], rot, h, wf, obl, ha, va, str, fontFor(doc, r.s(7)), s, gen);
  item.hd = r.s(5); if (ctx.depth) item.blk = 1;
  if (fitW > 0) item.fit = fitW * Math.sqrt(Math.abs(det(m)));
  ctx.sink.text(s, item);
}

function textItem(m, x, y, rot, h, wf, obl, ha, va, str, font, s, gen = 0, dy = 0) {
  // 局部文字坐标系：基线方向 u、竖直方向 v，变换到输出坐标
  const ux = Math.cos(rot), uy = Math.sin(rot);
  const U = [m[0] * ux + m[2] * uy, m[1] * ux + m[3] * uy];
  const V = [m[0] * -uy + m[2] * ux, m[1] * -uy + m[3] * ux];
  const p = ap(m, x - uy * dy, y + ux * dy);
  return { s: str, x: p[0], y: p[1], ux: U[0], uy: U[1], vx: V[0], vy: V[1], h, wf: wf || 1, obl, ha, va, f: font, mx: (gen & 2) ? -1 : 1, my: (gen & 4) ? -1 : 1, layer: s.layer, color: s.color };
}

function emitMText(ctx, r, m, s) {
  const doc = ctx.doc;
  let raw = '';
  for (let j = 0; j < r.c.length; j++) if (r.c[j] === 3) raw += r.v[j];
  raw += r.raw(1);
  const lines = mtextLines(raw);
  const h = r.f(40, 2.5);
  const att = r.i(71, 1);
  let rot = r.f(50, 0);
  if (r.has(11)) rot = Math.atan2(r.f(21), r.f(11));
  else rot = rot; // DXF 中 MTEXT 的 50 为弧度
  const O = ocsMatrix(r); const M = O && !r.has(11) ? mul(m, O) : m;
  const width = r.f(41, 0);
  const style = doc.styles.get(r.s(7, 'STANDARD').toUpperCase());
  const wf = style ? style.wf : 1;
  const font = fontFor(doc, r.s(7));
  // \W 宽度因子（取第一个）
  const mw = raw.match(/\\W([\d.]+);/); const wfe = mw ? parseFloat(mw[1]) || wf : wf;
  // 自动换行
  const out = [];
  for (const ln of lines) {
    if (width > 0 && approxWidth(ln, h) * wfe > width * 1.02) {
      let cur = '', cw = 0;
      for (const ch of ln) {
        const w = approxWidth(ch, h) * wfe;
        if (cw + w > width * 1.02 && cur) { out.push(cur); cur = ''; cw = 0; }
        cur += ch; cw += w;
      }
      out.push(cur);
    } else out.push(ln);
  }
  const lsf = r.f(44, 1) || 1;
  const lh = h * 5 / 3 * lsf;
  const n = out.length;
  const total = (n - 1) * lh + h;
  const row = Math.floor((att - 1) / 3), col = (att - 1) % 3;
  const top = row === 0 ? 0 : row === 1 ? total / 2 : total;
  const x = r.f(10), y = r.f(20);
  out.forEach((ln, i) => {
    const str = ln.replace(/\s+$/, '');
    if (!str && i !== 0) return;
    if (!str) return;
    const dy = top - h - i * lh;
    const it = textItem(M, x, y, rot, h, wfe, 0, col, 0, str, font, s, 0, dy); it.hd = r.s(5); it.mt = 1; it.li = i; it.ln = n; if (ctx.depth) it.blk = 1; if (!ctx.sink._paraDone || ctx.sink._paraDone !== r) { it.para = lines.join('\n'); ctx.sink._paraDone = r; }
    ctx.sink.text(s, it);
  });
}

// ---------- 样条 ----------
function splinePoints(r) {
  const deg = r.i(71, 3);
  const knots = r.all(40).map(Number);
  const ctrl = [], fit = [], w = r.all(41).map(Number);
  for (let j = 0; j < r.c.length; j++) {
    if (r.c[j] === 10) ctrl.push([parseFloat(r.v[j]), parseFloat(r.v[j + 1])]);
    else if (r.c[j] === 11) fit.push([parseFloat(r.v[j]), parseFloat(r.v[j + 1])]);
  }
  if (ctrl.length >= deg + 1 && knots.length === ctrl.length + deg + 1) {
    const n = Math.max(32, ctrl.length * 12);
    const t0 = knots[deg], t1 = knots[knots.length - deg - 1];
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(deBoor(deg, ctrl, knots, w.length === ctrl.length ? w : null, t0 + (t1 - t0) * i / n));
    return pts;
  }
  if (fit.length >= 2) return catmull(fit);
  return ctrl;
}
function deBoor(p, P, U, W, t) {
  let k = p; const n = P.length;
  while (k < n - 1 && t >= U[k + 1]) k++;
  const d = [];
  for (let j = 0; j <= p; j++) { const q = P[j + k - p]; const ww = W ? W[j + k - p] : 1; d.push([q[0] * ww, q[1] * ww, ww]); }
  for (let rr = 1; rr <= p; rr++) for (let j = p; j >= rr; j--) {
    const den = U[j + 1 + k - rr] - U[j + k - p];
    const a = den === 0 ? 0 : (t - U[j + k - p]) / den;
    d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]];
  }
  return [d[p][0] / d[p][2], d[p][1] / d[p][2]];
}
function catmull(P) {
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(i - 1, 0)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, P.length - 1)];
    for (let k = 0; k < 10; k++) {
      const t = k / 10, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(c => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  out.push(P[P.length - 1]);
  return out;
}

// ---------- 填充 ----------
function emitHatch(ctx, r, m, s) {
  const c = r.c, v = r.v;
  let i = r.idx(91);
  if (i < 0) return;
  const npaths = parseInt(v[i], 10); i++;
  const rings = [];
  const F = k => parseFloat(v[k]);
  for (let pth = 0; pth < npaths && i < c.length; pth++) {
    while (i < c.length && c[i] !== 92) i++;
    const ptype = parseInt(v[i], 10); i++;
    const ring = [];
    if (ptype & 2) { // 多段线边界
      let hasBulge = 0, closed = 1, nv = 0;
      for (; i < c.length && c[i] !== 10; i++) { if (c[i] === 72) hasBulge = +v[i]; else if (c[i] === 73) closed = +v[i]; else if (c[i] === 93) nv = +v[i]; }
      const verts = [];
      for (let k = 0; k < nv && i < c.length; k++) {
        const x = F(i), y = F(i + 1); i += 2; let b = 0;
        if (hasBulge && c[i] === 42) { b = F(i); i++; }
        verts.push([x, y, b]);
      }
      const n = verts.length;
      for (let k = 0; k < n; k++) {
        const a = verts[k], bb = verts[(k + 1) % n];
        ring.push([a[0], a[1]]);
        if (a[2] && (k < n - 1 || closed)) {
          const g = bulgeArc(a[0], a[1], bb[0], bb[1], a[2]);
          const pts = g.ccw ? arcPoints(g.cx, g.cy, g.r, g.a0, g.a1, 64) : arcPoints(g.cx, g.cy, g.r, g.a1, g.a0, 64).reverse();
          for (let j = 1; j < pts.length - 1; j++) ring.push(pts[j]);
        }
      }
    } else { // 边集
      while (i < c.length && c[i] !== 93) i++;
      const ne = parseInt(v[i], 10); i++;
      for (let e = 0; e < ne && i < c.length; e++) {
        while (i < c.length && c[i] !== 72) i++;
        const et = parseInt(v[i], 10); i++;
        const get = (code) => { while (i < c.length && c[i] !== code) i++; const x = F(i); i++; return x; };
        if (et === 1) {
          const x0 = get(10), y0 = get(20), x1 = get(11), y1 = get(21);
          if (!ring.length || Math.hypot(ring[ring.length - 1][0] - x0, ring[ring.length - 1][1] - y0) > 1e-9) ring.push([x0, y0]);
          ring.push([x1, y1]);
        } else if (et === 2) {
          const cx = get(10), cy = get(20), rr = get(40); let a0 = get(50), a1 = get(51);
          const ccw = c[i] === 73 ? +v[i++] : 1;
          let pts;
          if (ccw) pts = arcPoints(cx, cy, rr, a0 * Math.PI / 180, a1 * Math.PI / 180 + (Math.abs(a1 - a0) >= 360 ? -1e-9 : 0), 72);
          else pts = arcPoints(cx, cy, rr, -a1 * Math.PI / 180, -a0 * Math.PI / 180, 72).reverse();
          for (const p of pts) ring.push(p);
        } else if (et === 3) {
          const cx = get(10), cy = get(20), mx = get(11), my = get(21), ratio = get(40); let a0 = get(50) * Math.PI / 180, a1 = get(51) * Math.PI / 180;
          const ccw = c[i] === 73 ? +v[i++] : 1;
          if (!ccw) { const t0 = -a1, t1 = -a0; a0 = t0; a1 = t1; }
          let sw = a1 - a0; while (sw <= 0) sw += Math.PI * 2;
          const pts = [];
          for (let k = 0; k <= 72; k++) {
            const ang = a0 + sw * k / 72;
            // 角度 → 参数
            const u = Math.atan2(Math.sin(ang) / (ratio || 1), Math.cos(ang));
            pts.push([cx + mx * Math.cos(u) - my * ratio * Math.sin(u), cy + my * Math.cos(u) + mx * ratio * Math.sin(u)]);
          }
          if (!ccw) pts.reverse();
          for (const p of pts) ring.push(p);
        } else if (et === 4) {
          const degree = parseInt(get(94), 10);
          let rational = 0, nk = 0, nc = 0;
          for (; i < c.length && c[i] !== 40; i++) { if (c[i] === 73) rational = +v[i]; else if (c[i] === 95) nk = +v[i]; else if (c[i] === 96) nc = +v[i]; }
          const knots = []; for (let k = 0; k < nk; k++) { knots.push(F(i)); i++; }
          const ctrl = []; const w = [];
          for (let k = 0; k < nc; k++) { ctrl.push([F(i), F(i + 1)]); i += 2; if (c[i] === 42) { w.push(F(i)); i++; } }
          if (c[i] === 97) { const nf = +v[i]; i++; i += nf * 2; }
          while (i < c.length && (c[i] === 12 || c[i] === 22 || c[i] === 13 || c[i] === 23)) i++;
          if (ctrl.length > degree && knots.length === ctrl.length + degree + 1) {
            const t0 = knots[degree], t1 = knots[knots.length - degree - 1];
            for (let k = 0; k <= 48; k++) ring.push(deBoor(degree, ctrl, knots, w.length === ctrl.length ? w : null, t0 + (t1 - t0) * k / 48));
          } else ring.push(...ctrl);
        }
      }
    }
    // 跳过源边界对象引用
    while (i < c.length && c[i] !== 97 && c[i] !== 92 && c[i] !== 75) i++;
    if (c[i] === 97) { const nb = parseInt(v[i], 10); i++; i += nb; }
    if (ring.length >= 3) rings.push(ring.map(p => ap(m, p[0], p[1])));
  }
  if (!rings.length) return;
  const solid = r.i(70) === 1 || r.s(2).toUpperCase() === 'SOLID' || r.i(450) === 1;
  ctx.sink.hatchRegion(rings);
  if (solid) { ctx.sink.fill(s, rings, 'HATCH'); return; }
  // 图案线
  const pi = r.idx(78);
  const lines = [];
  if (pi >= 0) {
    const nl = parseInt(v[pi], 10); let k = pi + 1;
    for (let L = 0; L < nl && k < c.length; L++) {
      while (k < c.length && c[k] !== 53) k++;
      const ang = F(k) * Math.PI / 180, bx = F(k + 1), by = F(k + 2), dx = F(k + 3), dy = F(k + 4); k += 5;
      const nd = c[k] === 79 ? parseInt(v[k], 10) : 0; k++;
      const dashes = []; for (let d = 0; d < nd; d++) { dashes.push(F(k)); k++; }
      lines.push({ ang, bx, by, dx, dy, dashes });
    }
  }
  if (!lines.length) { ctx.sink.fill(s, rings, 'HATCH', 0.25); return; }
  const lm = m; // 图案线定义在 OCS，与边界同变换
  const ok = patternSegments(rings.map(rg => rg.map(p => inv(lm, p))), lines, (a, b) => {
    const p = ap(lm, a[0], a[1]), q = ap(lm, b[0], b[1]);
    ctx.sink.patSeg(s, p, q);
  });
  if (!ok) ctx.sink.fill(s, rings, 'HATCH', 0.25);
}
function inv(m, p) {
  const d = det(m); const x = p[0] - m[4], y = p[1] - m[5];
  return [(m[3] * x - m[2] * y) / d, (-m[1] * x + m[0] * y) / d];
}
function patternSegments(rings, lines, emit) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const rg of rings) for (const p of rg) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; }
  const edges = [];
  for (const rg of rings) for (let k = 0; k < rg.length; k++) edges.push([rg[k], rg[(k + 1) % rg.length]]);
  // 先估算总线数，过密则放弃（用淡色填充代替）
  let budget = 0;
  for (const L of lines) {
    const nx = -Math.sin(L.ang), ny = Math.cos(L.ang);
    const sp = Math.abs(L.dx * nx + L.dy * ny);
    if (sp < 1e-12) return false;
    const proj = [[minx, miny], [maxx, miny], [minx, maxy], [maxx, maxy]].map(p => p[0] * nx + p[1] * ny);
    budget += (Math.max(...proj) - Math.min(...proj)) / sp;
  }
  if (budget > 6000) return false;
  let segCount = 0;
  for (const L of lines) {
    const ux = Math.cos(L.ang), uy = Math.sin(L.ang), nx = -uy, ny = ux;
    const sp = L.dx * nx + L.dy * ny; const shift = L.dx * ux + L.dy * uy;
    const proj = [[minx, miny], [maxx, miny], [minx, maxy], [maxx, maxy]].map(p => ((p[0] - L.bx) * nx + (p[1] - L.by) * ny) / sp);
    const k0 = Math.floor(Math.min(...proj)) - 1, k1 = Math.ceil(Math.max(...proj)) + 1;
    const period = L.dashes.reduce((a, b) => a + Math.abs(b), 0);
    for (let k = k0; k <= k1; k++) {
      const ox = L.bx + k * L.dx, oy = L.by + k * L.dy; // 该条线上的相位起点
      const ts = [];
      for (const [a, b] of edges) {
        const da = (a[0] - ox) * nx + (a[1] - oy) * ny, db = (b[0] - ox) * nx + (b[1] - oy) * ny;
        if ((da > 0) === (db > 0)) continue;
        const f = da / (da - db);
        const px = a[0] + (b[0] - a[0]) * f, py = a[1] + (b[1] - a[1]) * f;
        ts.push((px - ox) * ux + (py - oy) * uy);
      }
      if (ts.length < 2) continue;
      ts.sort((x, y) => x - y);
      for (let q = 0; q + 1 < ts.length; q += 2) {
        const s0 = ts[q], s1 = ts[q + 1];
        if (!L.dashes.length || period <= 0) { emit([ox + ux * s0, oy + uy * s0], [ox + ux * s1, oy + uy * s1]); segCount++; continue; }
        let n0 = Math.floor(s0 / period);
        for (let base = n0 * period; base < s1; base += period) {
          let pos = base;
          for (const d of L.dashes) {
            const len = Math.abs(d);
            if (d >= 0) {
              const a0 = Math.max(pos, s0), a1 = Math.min(pos + (d === 0 ? period * 0.02 : len), s1);
              if (a1 > a0) { emit([ox + ux * a0, oy + uy * a0], [ox + ux * a1, oy + uy * a1]); segCount++; }
            }
            pos += len;
          }
          if (segCount > 400000) return true;
        }
      }
    }
  }
  return true;
}

// ---------- 默认汇集器：按样式合批 ----------
export class SceneSink {
  constructor() {
    this.batches = new Map(); this.fills = new Map(); this.texts = [];
    this.snaps = []; this.circles = []; this.segs = []; this.regions = [];
    this.bb = [Infinity, Infinity, -Infinity, -Infinity];
    this.samplesX = []; this.samplesY = [];
    this.curves = []; this.layerIds = new Map(); this.inserts = []; this.acc = [];
  }
  lid(name) { let i = this.layerIds.get(name); if (i === undefined) { i = this.layerIds.size; this.layerIds.set(name, i); } return i; }
  curve(layer, len, pts) {
    if (!(len > 0) || this.curves.length > 6e6) return;
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const p of pts) { if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1]; }
    this.curves.push(len, a, b, c, d, this.lid(layer));
  }
  beginInsert() { const a = [Infinity, Infinity, -Infinity, -Infinity]; this.acc.push(a); return a; }
  endInsert(a, name, depth, layer) { this.acc.pop(); if (Number.isFinite(a[0]) && this.inserts.length < 600000) this.inserts.push({ n: name, d: depth, b: a, l: this.lid(layer || '0') }); }
  _bb(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const b = this.bb; if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
    for (let i = 0; i < this.acc.length; i++) { const a = this.acc[i]; if (x < a[0]) a[0] = x; if (y < a[1]) a[1] = y; if (x > a[2]) a[2] = x; if (y > a[3]) a[3] = y; }
    if (this.samplesX.length < 200000) { this.samplesX.push(x); this.samplesY.push(y); }
  }
  key(s, dash, w) { return s.layer + '\u0000' + s.color + '\u0000' + (dash ? dash.map(x => x.toPrecision(4)).join(',') : '') + '\u0000' + (w > 0 ? w.toPrecision(4) : w < 0 ? 'pt' : ''); }
  path(s, ops, dash, w = 0, type, noBB) {
    const k = this.key(s, dash, w);
    let b = this.batches.get(k);
    if (!b) { b = { layer: s.layer, color: s.color, dash, w, ops: [] }; this.batches.set(k, b); }
    const o = b.ops; for (let j = 0; j < ops.length; j++) o.push(ops[j]);
    if (!noBB) for (let j = 0; j < ops.length;) {
      const op = ops[j];
      if (op === OP.M || op === OP.L) { this._bb(ops[j + 1], ops[j + 2]); j += 3; }
      else if (op === OP.A) { this._bb(ops[j + 1] - ops[j + 3], ops[j + 2] - ops[j + 3]); this._bb(ops[j + 1] + ops[j + 3], ops[j + 2] + ops[j + 3]); j += 7; }
      else if (op === OP.E) j += 9; else j++;
    }
  }
  fill(s, rings, type, alpha = 1) {
    const k = s.layer + '\u0000' + s.color + '\u0000' + alpha;
    let b = this.fills.get(k);
    if (!b) { b = { layer: s.layer, color: s.color, alpha, rings: [], groups: [] }; this.fills.set(k, b); }
    const g0 = b.rings.length;
    for (const rg of rings) { const a = []; for (const p of rg) { a.push(p[0], p[1]); this._bb(p[0], p[1]); } b.rings.push(a); }
    b.groups.push(g0, b.rings.length);
  }
  patSeg(s, a, b) {
    const k = this.key(s, null, 0) + '\u0000pat';
    let bt = this.batches.get(k);
    if (!bt) { bt = { layer: s.layer, color: s.color, dash: null, w: 0, ops: [], pat: true }; this.batches.set(k, bt); }
    bt.ops.push(OP.M, a[0], a[1], OP.L, b[0], b[1]);
  }
  text(s, it) {
    this.texts.push(it);
    const L = approxWidth(it.s, it.h) * it.wf;
    this._bb(it.x, it.y); this._bb(it.x + it.ux * L, it.y + it.uy * L);
  }
  snap(x, y, t) { this.snaps.push(x, y, t, this.cur || 0); }
  circle(cx, cy, r, a0, a1, full) { this.circles.push(cx, cy, r, this.cur || 0); }
  seg(x0, y0, x1, y1) { if (this.segs.length < 4e6) this.segs.push(x0, y0, x1, y1); }
  region(flat) { if (this.regions.length < 40000) { const a = []; for (const p of flat) a.push(p[0], p[1]); this.regions.push({ rings: [a], l: this.cur || 0 }); } }
  hatchRegion(rings) { if (this.regions.length < 40000 && rings.length) this.regions.push({ rings: rings.map(rg => { const a = []; for (const p of rg) a.push(p[0], p[1]); return a; }), l: this.cur || 0, hatch: 1 }); }
  finish() {
    const batches = [...this.batches.values()].map(b => ({ ...b, ops: Float64Array.from(b.ops) }));
    const fills = [...this.fills.values()].map(b => ({ layer: b.layer, color: b.color, alpha: b.alpha, groups: b.groups, rings: b.rings.map(r => Float64Array.from(r)) }));
    return {
      batches, fills, texts: this.texts,
      snaps: Float64Array.from(this.snaps), circles: Float64Array.from(this.circles), segs: Float64Array.from(this.segs),
      regions: this.regions.map(g => ({ rings: g.rings.map(r => Float64Array.from(r)), l: g.l, hatch: g.hatch || 0 })),
      curves: Float64Array.from(this.curves), curveLayers: [...this.layerIds.keys()], inserts: this.inserts,
      bbox: this.bb, view: smartExtents(this.bb, this.samplesX, this.samplesY),
    };
  }
}

function smartExtents(bb, xs, ys) {
  if (!xs.length) return [0, 0, 100, 100];
  const q = (a, f) => { const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * f)))]; };
  const x0 = q(xs, 0.002), x1 = q(xs, 0.998), y0 = q(ys, 0.002), y1 = q(ys, 0.998);
  const full = (bb[2] - bb[0]) * (bb[3] - bb[1]);
  const part = Math.max((x1 - x0), 1e-9) * Math.max((y1 - y0), 1e-9);
  if (full > part * 50 && xs.length > 50) {
    const dx = (x1 - x0) * 0.08, dy = (y1 - y0) * 0.08;
    return [x0 - dx, y0 - dy, x1 + dx, y1 + dy];
  }
  return bb.slice();
}

// ---------- 对比：每个图元一个签名 ----------
export class SigSink extends SceneSink {
  constructor(q) { super(); this.q = q; this.items = []; }
  _r(x) { return Math.round(x / this.q); }
  _sig(arr) { let h = 2166136261; for (const x of arr) { const s = typeof x === 'number' ? String(x) : x; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= 44; h = Math.imul(h, 16777619); } return h >>> 0; }
  _pt(ops) { for (let j = 0; j < ops.length;) { const op = ops[j]; if (op === OP.M || op === OP.L) return [ops[j + 1], ops[j + 2]]; if (op === OP.A) return [ops[j + 1], ops[j + 2]]; j++; } return [0, 0]; }
  path(s, ops, dash, w = 0, type, noBB) {
    super.path(s, ops, dash, w, type, noBB);
    if (noBB) return;
    const parts = [type];
    for (let j = 0; j < ops.length;) {
      const op = ops[j]; parts.push(op);
      if (op === OP.M || op === OP.L) { parts.push(this._r(ops[j + 1]), this._r(ops[j + 2])); j += 3; }
      else if (op === OP.A) { parts.push(this._r(ops[j + 1]), this._r(ops[j + 2]), this._r(ops[j + 3]), Math.round(ops[j + 4] * 1e4), Math.round(ops[j + 5] * 1e4), ops[j + 6]); j += 7; }
      else if (op === OP.E) { for (let k = 1; k <= 4; k++) parts.push(this._r(ops[j + k])); for (let k = 5; k <= 7; k++) parts.push(Math.round(ops[j + k] * 1e4)); parts.push(ops[j + 8]); j += 9; }
      else j++;
    }
    this.items.push({ k: 'line', sig: this._sig(parts), ops: Float64Array.from(ops), layer: s.layer, p: this._pt(ops) });
  }
  fill(s, rings, type, alpha = 1) {
    super.fill(s, rings, type, alpha);
    const parts = ['F']; for (const rg of rings) for (const p of rg) parts.push(this._r(p[0]), this._r(p[1]));
    this.items.push({ k: 'fill', sig: this._sig(parts), rings: rings.map(rg => { const a = []; for (const p of rg) a.push(p[0], p[1]); return Float64Array.from(a); }), alpha, layer: s.layer, p: rings[0][0] });
  }
  patSeg(s, a, b) { super.patSeg(s, a, b); this.items.push({ k: 'fill', pat: 1, sig: this._sig(['H', this._r(a[0]), this._r(a[1]), this._r(b[0]), this._r(b[1])]), ops: Float64Array.of(OP.M, a[0], a[1], OP.L, b[0], b[1]), layer: s.layer, p: a }); }
  text(s, it) { super.text(s, it); this.items.push({ k: 'text', sig: this._sig(['T', it.s, this._r(it.x), this._r(it.y), Math.round(it.h * 100)]), it, layer: s.layer, p: [it.x, it.y] }); }
}
