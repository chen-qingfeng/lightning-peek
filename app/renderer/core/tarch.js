// 闪电看图 · 天正对象里的文字（单行/多行文字、标高、轴号、图名、门窗编号、引出标注、索引符号、箭头引注、表格、尺寸）
//
// 天正的自定义对象没有装天正插件时只能靠"代理图形"显示。很多图纸（例如天正导出的 _t7 图）
// 存的代理图形是空的（8 字节头，0 条指令），LibreDWG 也不认识这些类，写 DXF 时整条丢掉。
// 文字内容、位置、字高其实还在对象自己的数据里，这里把它们读出来，转换成普通的 TEXT / MTEXT。
//
// 数据（AutoCAD 通用实体数据之后，DWG 位流）：
//   RC  版本(=4)   BD 出图比例   BS 0   RS 512   TV 文字(ANSI，含结尾 \0)
//   3BD 插入点     BD 字高(图纸毫米，乘出图比例为实际高度)   BD 旋转(弧度)
//   TCH_TEXT : RS 对齐 (1–9 同 MTEXT 附着点，10/11/12 = 基线 左/中/右)
//   TCH_MTEXT: RS 对齐   RC 1   BD 文字框宽(图纸毫米)   BD 行距系数
//              插入点是文字框左上角，天正已把它放在使文字在表格格子里上下居中的位置。
//              对齐 10/11/12 = 框内 左/中/右（表格单元格实测）；其它值的框宽不可靠（见过 200mm 宽的"顶/棚"格子），按左上角处理。
//              行距 = 字高 × (1 + 系数) / 2：用说明文字里给表格留的空行和表格单元格的上下居中两处实测得出。
//   句柄流里最后一个绝对句柄是文字样式。
// 以上格式是根据实际图纸反推的，凡是读出来不合理的（长度、数值越界等）就放弃这一条，不猜。

export class Bits {
  constructor(bytes, nbits) { this.b = bytes; this.p = 0; this.n = nbits == null ? bytes.length * 8 : nbits; }
  bit() { if (this.p >= this.n) throw new Error('eof'); const v = (this.b[this.p >> 3] >> (7 - (this.p & 7))) & 1; this.p++; return v; }
  bits(k) { let v = 0; for (let i = 0; i < k; i++) v = v * 2 + this.bit(); return v; }
  RC() { return this.bits(8); }
  RS() { const a = this.RC(); return a | (this.RC() << 8); }
  RL() { const a = this.RS(); return (a | (this.RS() << 16)) >>> 0; }
  RD() { const u = new Uint8Array(8); for (let i = 0; i < 8; i++) u[i] = this.RC(); return new DataView(u.buffer).getFloat64(0, true); }
  BS() { const c = this.bits(2); return c === 0 ? this.RS() : c === 1 ? this.RC() : c === 2 ? 0 : 256; }
  BD() { const c = this.bits(2); if (c === 0) return this.RD(); if (c === 1) return 1; if (c === 2) return 0; throw new Error('bad BD'); }
  TV() { const L = this.BS(); if (L > 65535 || this.p + L * 8 > this.n) throw new Error('bad TV'); const u = new Uint8Array(L); for (let i = 0; i < L; i++) u[i] = this.RC(); return u; }
  H() { const code = this.bits(4), size = this.bits(4); let v = 0; for (let i = 0; i < size; i++) v = v * 256 + this.RC(); return { code, size, v }; }
}

export const TCH_TEXT_CLASSES = new Set(['TCH_TEXT', 'TCH_MTEXT']);
// 能读出来的天正类（墙、柱、楼梯、扶手、楼板等只有图形没有文字，仍然不显示）
export const TCH_CLASSES = new Set(['TCH_TEXT', 'TCH_MTEXT', 'TCH_ELEVATION', 'TCH_AXIS_LABEL', 'TCH_DRAWINGNAME', 'TCH_OPENING', 'TCH_MULTILEADER', 'TCH_INDEXPOINTER', 'TCH_ARROW', 'TCH_SHEET', 'TCH_DIMENSION2']);

const ok = v => Number.isFinite(v) && Math.abs(v) < 1e12;

// bytes：通用实体数据之后的位（LibreDWG 对未知对象保存的 unknown_bits，字节对齐）
// nbits：其中有效位数；hdlOff：句柄流在这些位里的起点（未知时传 -1）
export function decodeTch(kind, bytes, nbits, hdlOff = -1) {
  const r = new Bits(bytes, nbits);
  const f = { kind };
  f.ver = r.RC(); f.scale = r.BD(); r.BS(); r.RS();
  const raw = r.TV();
  let end = raw.length; while (end > 0 && raw[end - 1] === 0) end--;
  f.raw = raw.subarray(0, end);
  f.x = r.BD(); f.y = r.BD(); f.z = r.BD(); f.h = r.BD(); f.rot = r.BD();
  if (kind === 'TCH_TEXT') f.align = r.RS();
  else { f.align = r.RS(); r.RC(); f.width = r.BD(); f.lsf = r.BD(); }
  if (!(f.scale > 0) || !ok(f.scale) || !(f.h > 0) || !ok(f.h) || !ok(f.x) || !ok(f.y) || !ok(f.rot)) return null;
  if (!(f.align >= 1 && f.align <= 12)) f.align = kind === 'TCH_TEXT' ? 10 : 1;
  if (f.width != null && !(ok(f.width) && f.width >= 0)) f.width = 0;
  if (f.lsf != null && !(ok(f.lsf) && f.lsf > 0 && f.lsf < 20)) f.lsf = 0;
  // 样式：句柄流最后一个非零的绝对句柄（code 5）
  if (hdlOff >= 0 && hdlOff < nbits) {
    r.p = hdlOff; let last = 0;
    try { while (r.p + 8 <= nbits) { const h = r.H(); if (h.code === 5 && h.v) last = h.v; } } catch (e) { /* 到结尾 */ }
    f.style = last;
  }
  return f;
}

// 天正的上下标写法：m^U2^U → m²；其余 ^U…^U、^D…^D 去掉标记
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
export function tchMarkup(s) {
  return s
    .replace(/\^U([^^]*)\^U/g, (_, t) => [...t].every(c => SUP[c]) ? [...t].map(c => SUP[c]).join('') : t)
    .replace(/\^D([^^]*)\^D/g, (_, t) => [...t].every(c => SUB[c]) ? [...t].map(c => SUB[c]).join('') : t)
    .replace(/\^C([^^]*)\^C/g, (_, t) => circled(t));
}
// 天正的加圈字 ^C1^C → ①，^CA^C → Ⓐ
function circled(t) {
  if (/^\d+$/.test(t) && +t >= 1 && +t <= 20) return String.fromCharCode(0x2460 + (+t) - 1);
  if (/^[A-Z]$/.test(t)) return String.fromCharCode(0x24b6 + t.charCodeAt(0) - 65);
  if (/^[a-z]$/.test(t)) return String.fromCharCode(0x24d0 + t.charCodeAt(0) - 97);
  return t;
}

// MTEXT 附着点 → TEXT 的 72/73
const HA = [0, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2];
const VA = [0, 3, 3, 3, 2, 2, 2, 1, 1, 1, 0, 0, 0];

// 转换成 DXF 组码对（不含图层/颜色/样式），供 makeRec 使用
export function tchPairs(f, text) {
  const H = f.h * f.scale;
  if (f.kind === 'TCH_TEXT') {
    const ha = HA[f.align], va = VA[f.align];
    return { type: 'TEXT', pairs: [[10, f.x], [20, f.y], [30, f.z || 0], [11, f.x], [21, f.y], [31, f.z || 0], [40, H], [50, f.rot * 180 / Math.PI], [72, ha], [73, va], [1, text]] };
  }
  // 多行：文字框左上角为插入点，对齐只决定框内的左/中/右
  const W = (f.width || 0) * f.scale;
  const col = f.align >= 10 ? HA[f.align] : 0;
  const c = Math.cos(f.rot), s = Math.sin(f.rot), dx = W * col / 2;
  // 天正的字比我们估算的窄一些，换行宽度留 10% 余量，避免一格里的字被拆成一字一行
  const body = text.replace(/\r\n|\r|\n/g, '\\P').replace(/(\\P\s*)+$/, '');
  const pairs = [[10, f.x + c * dx], [20, f.y + s * dx], [30, f.z || 0], [40, H], [71, 1 + col], [1, body], [50, f.rot]];
  if (W > 0) pairs.push([41, W * 1.1]);
  if (f.lsf > 0) pairs.push([44, (1 + f.lsf) / 2 * 3 / 5]); // 引擎的行距 = 字高 × 5/3 × 组码44
  return { type: 'MTEXT', pairs };
}

// ---------- 其它天正对象 ----------
// 下面各类的位流格式同样是从实际图纸反推、并用图中已有的普通图元核对过的。所有长度类数值都是图纸毫米，
// 乘对象头里的出图比例后才是图形单位。
//   通用头：RC 版本  BD 出图比例  BS  RS 类版本
//   标高/引出/索引/箭头的公共部分：BD 字高  BD  BD  24 位标志  然后 2RD 基点（箭头引注是 TV 文字）

// p 处是否是一个以 \0 结尾、像文字的 TV（ANSI 双字节编码）
function tvAt(b, nb, p, minL = 1, maxL = 4096) {
  const r = new Bits(b, nb); r.p = p;
  try {
    const L = r.BS();
    if (L < minL || L > maxL || r.p + L * 8 > nb) return null;
    const u = new Uint8Array(L); for (let i = 0; i < L; i++) u[i] = r.RC();
    if (u[L - 1] !== 0) return null;
    for (let i = 0; i < L - 1; i++) {
      const c = u[i];
      if (c < 0x80) { if (c < 0x20 && c !== 13 && c !== 10 && c !== 9) return null; continue; }
      if (c < 0x81 || c > 0xfe || i + 1 >= L - 1) return null;
      const t = u[++i]; if (t < 0x40 || t > 0xfe || t === 0x7f) return null;
    }
    return { raw: u.subarray(0, L - 1), end: r.p };
  } catch (e) { return null; }
}
function bdAt(b, nb, p) { const r = new Bits(b, nb); r.p = p; try { const v = r.BD(); return { v, end: r.p }; } catch (e) { return null; } }
function rdAt(b, nb, p) { const r = new Bits(b, nb); r.p = p; try { return r.RD(); } catch (e) { return NaN; } }
function bitsEq(b, nb, p, str) { if (p < 0 || p + str.length > nb) return false; const r = new Bits(b, nb); r.p = p; for (const ch of str) if (r.bit() !== +ch) return false; return true; }
// 编码为 00 + RD 的“整齐”数（3 位小数以内）
function niceBdAt(b, nb, p, lo, hi) {
  const r = new Bits(b, nb); r.p = p;
  try { if (r.bits(2) !== 0) return NaN; const v = r.RD(); return (Number.isFinite(v) && v >= lo && v <= hi && Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6) ? v : NaN; } catch (e) { return NaN; }
}
const near = (a, b, d) => Math.abs(a[0] - b[0]) < d && Math.abs(a[1] - b[1]) < d;
const okPt = (x, y) => ok(x) && ok(y) && Math.abs(x) < 1e9 && Math.abs(y) < 1e9;

function header(r) { r.RC(); const sc = r.BD(); r.BS(); r.RS(); if (!(sc > 0 && sc < 1e5)) throw new Error('scale'); return sc; }
function base(r) { const h = r.BD(); r.BD(); r.BD(); const fl = r.bits(24); return { h, fl }; }

export function decodeTchAny(kind, bytes, nb, hdlOff = -1) {
  if (TCH_TEXT_CLASSES.has(kind)) return decodeTch(kind, bytes, nb, hdlOff);
  const end = hdlOff > 0 && hdlOff <= nb ? hdlOff : nb;
  const r = new Bits(bytes, end);
  try {
    const sc = header(r);
    const f = { kind, scale: sc };
    switch (kind) {
      case 'TCH_ELEVATION': {
        const { h, fl } = base(r); f.h = h; f.flags = fl & 63;
        f.x = r.RD(); f.y = r.RD(); f.raw = strip(r.TV());
        f.L = 0; try { f.L = r.BD(); } catch (e) { /* 没有 */ }
        if (!(h > 0 && h < 50) || !okPt(f.x, f.y)) return null;
        return f;
      }
      case 'TCH_AXIS_LABEL': {
        r.BS(); f.p1 = [r.RD(), r.RD()]; f.p2 = [r.RD(), r.RD()];
        if (!okPt(...f.p1) || !okPt(...f.p2) || (f.p1[0] === f.p2[0] && f.p1[1] === f.p2[1])) return null;
        let p = r.p, q = -1;
        for (let k = 0; k < 40; k++) if (tvAt(bytes, end, p + k, 2, 12)) { q = p + k; break; }
        f.items = [];
        while (q >= 0 && f.items.length < 200) {
          const t = tvAt(bytes, end, q, 2, 12); if (!t) break;
          const d1 = bdAt(bytes, end, t.end); if (!d1) break;
          const d2 = bdAt(bytes, end, d1.end); if (!d2) break;
          f.items.push({ raw: t.raw, dist: d1.v, ext: d2.v }); p = d2.end; q = -1;
          for (let k = 0; k < 14; k++) if (tvAt(bytes, end, p + k, 2, 12)) { q = p + k; break; }
        }
        // 末尾两个“整齐”的数：起点端、终点端的引线长度（默认 40）
        f.tail = [];
        for (let k = p; k < end - 66 && f.tail.length < 2; k++) { const v = niceBdAt(bytes, end, k, 1, 100); if (v === v) { f.tail.push(v); k += 65; } }
        while (f.tail.length < 2) f.tail.push(40);
        if (!f.items.length) return null;
        return f;
      }
      case 'TCH_DRAWINGNAME': {
        r.bits(2); f.x = r.BD(); f.y = r.BD(); r.BD();
        f.raw = strip(r.TV()); f.raw2 = strip(r.TV()); f.rot = r.BD(); f.h = r.BD(); f.h2 = r.BD();
        if (!okPt(f.x, f.y) || !(f.h > 0 && f.h < 100) || !(f.h2 > 0 && f.h2 < 100)) return null;
        return f;
      }
      case 'TCH_OPENING': {
        // 洞口：16 位，3BD 位置，BD 宽，BD 墙厚，BD 高，BD 方向角
        r.bits(16); f.x = r.BD(); f.y = r.BD(); r.BD(); f.w = r.BD(); r.BD(); r.BD(); f.ang = r.BD();
        if (!ok(f.ang)) return null;
        if (!okPt(f.x, f.y)) return null;
        // 编号文字后面紧跟它自己的位置（离洞口不远）
        for (let p = r.p; p < end - 200; p++) {
          const t = tvAt(bytes, end, p, 2, 64); if (!t) continue;
          const rr = new Bits(bytes, end); rr.p = t.end;
          try {
            const tx = rr.BD(), ty = rr.BD(); rr.BD(); rr.BS(); const h = rr.BD();
            if (okPt(tx, ty) && near([tx, ty], [f.x, f.y], 5000) && h > 0.5 && h < 20) { Object.assign(f, { raw: t.raw, tx, ty, rot: f.ang, h }); return f; }
          } catch (e) { /* 继续找 */ }
        }
        return null;
      }
      case 'TCH_MULTILEADER': {
        const { h } = base(r); f.h = h;
        f.x = r.RD(); f.y = r.RD(); f.L = r.BD(); r.RC();
        f.raw = strip(r.TV()); f.raw2 = strip(r.TV());
        const n = r.RC(); if (n > 50) return null;
        f.pts = []; for (let i = 0; i < n; i++) { const p = [r.RD(), r.RD()]; if (okPt(...p)) f.pts.push(p); }
        if (!(h > 0 && h < 50) || !okPt(f.x, f.y) || !ok(f.L)) return null;
        return f;
      }
      case 'TCH_INDEXPOINTER': {
        const { h } = base(r); f.h = h;
        f.p = [r.RD(), r.RD()]; f.q = [r.RD(), r.RD()]; f.rad = r.BD(); f.len = r.BD(); r.bits(2);
        f.raws = []; for (let i = 0; i < 4; i++) f.raws.push(strip(r.TV()));
        if (!(h > 0 && h < 50) || !okPt(...f.p) || !okPt(...f.q) || !(f.rad > 0 && f.rad < 50) || !ok(f.len)) return null;
        return f;
      }
      case 'TCH_ARROW': {
        const { h } = base(r); f.h = h;
        f.raw = strip(r.TV());
        f.x = r.BD(); f.y = r.BD(); r.BD();
        if (!(h > 0 && h < 50) || !okPt(f.x, f.y)) return null;
        // 箭头折线：每个顶点 2RD + 2 位凸度
        f.pts = [];
        for (let k = 0; k < 64 && !f.pts.length; k++) {
          const p0 = r.p + k, x0 = rdAt(bytes, end, p0), y0 = rdAt(bytes, end, p0 + 64);
          const x1 = rdAt(bytes, end, p0 + 130), y1 = rdAt(bytes, end, p0 + 194);
          if (okPt(x0, y0) && okPt(x1, y1) && near([x0, y0], [f.x, f.y], 20000) && near([x1, y1], [f.x, f.y], 20000) && (x0 !== x1 || y0 !== y1)) {
            for (let p = p0; p + 128 <= end; p += 130) { const x = rdAt(bytes, end, p), y = rdAt(bytes, end, p + 64); if (!okPt(x, y) || !near([x, y], [f.x, f.y], 20000)) break; f.pts.push([x, y]); }
          }
        }
        return f;
      }
      case 'TCH_SHEET': return decodeSheet(f, bytes, end, r.p);
      case 'TCH_DIMENSION2': {
        f.x = r.BD(); f.y = r.BD(); r.BD(); f.ang = r.BD(); f.off = r.BD();
        const n = r.BS(); if (n > 500) return null;
        f.segs = []; for (let i = 0; i < n; i++) f.segs.push(r.BD());
        if (!okPt(f.x, f.y) || !ok(f.ang) || !ok(f.off) || f.segs.some(v => !ok(v))) return null;
        return f;
      }
    }
  } catch (e) { return null; }
  return null;
}
function strip(u) { let e = u.length; while (e > 0 && u[e - 1] === 0) e--; return u.subarray(0, e); }

// 表格：标题 TV；列记录（每列 280 位：…BD 0.4 边距, BD 3.5 字高…，列宽 RD 在边距后 166 位）；
// 行记录（每行 106 位，BD 行高）；单元格（前 9 个 0 位 + TV 文字 + 0000001…）。合并单元格在文字后
// 8 位处跟 4 个 BS：起始行、起始列、结束行、结束列；其余单元格按行优先依次填进没被合并占用的格子。
// 插入点（标题区左上角）在数据末尾：句柄流前 142 位和 76 位处的两个 RD。
function decodeSheet(f, b, end, p0) {
  let t = null, p = p0;
  for (; p < end - 64; p++) { t = tvAt(b, end, p, 2, 400); if (t) break; }
  if (!t) return null;
  f.title = t.raw;
  const cols = [];
  for (let q = t.end; q < end - 140; q++) {
    if (cols.length && q > cols[cols.length - 1] + 280) break;
    if (niceBdAt(b, end, q, 0.4, 0.4) !== 0.4 || niceBdAt(b, end, q + 66, 3.5, 3.5) !== 3.5) continue;
    if (cols.length && q - cols[cols.length - 1] !== 280) break;
    cols.push(q);
  }
  if (!cols.length) return null;
  f.widths = cols.map(q => rdAt(b, end, q + 166));
  if (f.widths.some(w => !(w > 0 && w < 1000))) return null;
  let r0 = -1;
  for (let q = cols[cols.length - 1] + 200; q < end - 66; q++) { const v = niceBdAt(b, end, q, 0.001, 1e7); if (v === v) { r0 = q; break; } }
  if (r0 < 0) return null;
  f.heights = [];
  for (let q = r0; ; q += 106) { const v = bdAt(b, end, q); if (!v || !(v.v > 0.5 && v.v < 200)) break; f.heights.push(v.v); if (f.heights.length > 500) return null; }
  const nr = f.heights.length, nc = f.widths.length;
  if (!nr) return null;
  f.cells = [];
  for (let q = r0 + 106 * nr; q < end - 150; q++) {
    const c = tvAt(b, end, q, 1, 2000);
    if (!c || !bitsEq(b, end, q - 9, '000000000') || !bitsEq(b, end, c.end, '000000')) continue;
    let span = null;
    if (bitsEq(b, end, c.end + 7, '0')) {
      const rr = new Bits(b, end); rr.p = c.end + 8;
      try { const s = [rr.BS(), rr.BS(), rr.BS(), rr.BS()]; if (s[0] <= s[2] && s[2] < nr && s[1] <= s[3] && s[3] < nc) span = s; } catch (e) { /* 不是合并格 */ }
    }
    f.cells.push({ raw: c.raw, span }); q = c.end + 6;
  }
  f.x = rdAt(b, end, end - 142); f.y = rdAt(b, end, end - 76);
  if (!okPt(f.x, f.y)) return null;
  return f;
}

// ---------- 转成普通图元 ----------
const TXT = (x, y, h, rotRad, ha, va, s, wf) => { const p = [[10, x], [20, y], [11, x], [21, y], [40, h], [50, rotRad * 180 / Math.PI], [72, ha], [73, va], [1, s]]; if (wf) p.push([41, wf]); return { type: 'TEXT', pairs: p }; };
const LN = (a, b) => ({ type: 'LINE', pairs: [[10, a[0]], [20, a[1]], [11, b[0]], [21, b[1]]] });
const CIR = (c, r) => ({ type: 'CIRCLE', pairs: [[10, c[0]], [20, c[1]], [40, r]] });
const MT = (x, y, h, att, w, s, lsf) => { const p = [[10, x], [20, y], [40, h], [71, att], [1, s.replace(/\r\n|\r|\n/g, '\\P')]]; if (w > 0) p.push([41, w]); if (lsf) p.push([44, lsf]); return { type: 'MTEXT', pairs: p }; };
const CJKR = /[⺀-鿿豈-﫿＀-￯]/;
const estW = (s, h) => { let w = 0; for (const ch of s) w += CJKR.test(ch) ? h : h * 0.7; return w; };
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
// 让文字朝上可读：方向角落在 (-90°, 90°]
function readable(a) { let r = a % (2 * Math.PI); if (r < 0) r += 2 * Math.PI; if (r > Math.PI / 2 + 1e-6 && r <= 3 * Math.PI / 2 + 1e-6) r -= Math.PI; return r; }

// f：decodeTchAny 的结果；dec(Uint8Array) → 字符串（含天正上下标处理）
// 返回 [{ type, pairs }]，pairs 不含图层、颜色
export function tchBuild(f, dec) {
  const sc = f.scale, out = [];
  switch (f.kind) {
    case 'TCH_TEXT': case 'TCH_MTEXT': {
      const s = dec(f.raw); if (!s.trim()) return out;
      out.push(tchPairs(f, s)); return out;
    }
    case 'TCH_ELEVATION': {
      let s = dec(f.raw).trim(); if (!s) return out;
      if (/^0(\.0+)?$/.test(s)) s = '±' + s;
      const H = f.h * sc, tri = 3 * sc, mir = (f.flags & 2) ? -1 : 1, flip = (f.flags & 1) ? -1 : 1;
      const yt = f.y + flip * tri, x0 = f.x - mir * tri;
      const L = Math.max((f.L > 3 ? f.L : 0) * sc, estW(s, H) * 0.75 + sc);
      out.push(LN([f.x, f.y], [f.x - tri, yt]), LN([f.x, f.y], [f.x + tri, yt]), LN([x0, yt], [x0 + mir * L, yt]));
      out.push(TXT(x0 + mir * 0.5 * sc, yt + flip * sc, H, 0, mir > 0 ? 0 : 2, flip > 0 ? 0 : 3, s));
      return out;
    }
    case 'TCH_AXIS_LABEL': {
      const d = [f.p2[0] - f.p1[0], f.p2[1] - f.p1[1]], len = Math.hypot(d[0], d[1]); if (!len) return out;
      const u = [d[0] / len, d[1] / len], n = [u[1], -u[0]], R = 4 * sc;
      // 轴号画在哪一端：每个轴号自带的引线长度和哪一端的长度对得上就在哪一端（两端都是默认值时在起点端）
      const e0 = f.items.find(it => it.ext > 0)?.ext || 0;
      const atEnd = e0 > 0 && Math.abs(e0 - f.tail[1]) < Math.abs(e0 - f.tail[0]);
      const org = atEnd ? f.p2 : f.p1, dir = atEnd ? 1 : -1;
      let cum = 0;
      for (const it of f.items) {
        const s = dec(it.raw).trim();
        const b0 = add(org, n, cum), ext = (it.ext > 0 ? it.ext : f.tail[atEnd ? 1 : 0]) * sc;
        const e = add(b0, u, dir * ext), c = add(b0, u, dir * (ext + R));
        out.push(LN(b0, e), CIR(c, R));
        if (s) out.push(TXT(c[0], c[1], 4.5 * sc, 0, 1, 2, s));
        cum += it.dist;
      }
      return out;
    }
    case 'TCH_DRAWINGNAME': {
      const s = dec(f.raw).trim(), s2 = dec(f.raw2).trim(); if (!s && !s2) return out;
      const H = f.h * sc, H2 = f.h2 * sc, w = estW(s, H);
      const yb = f.y + sc;
      if (s) out.push(TXT(f.x, yb, H, 0, 1, 0, s));
      if (s2) out.push(TXT(f.x + w / 2 + 2 * sc, yb, H2, 0, 0, 0, s2));
      if (s) out.push(LN([f.x - w / 2 - sc, f.y], [f.x + w / 2 + sc, f.y]), LN([f.x - w / 2 - sc, f.y - 0.8 * sc], [f.x + w / 2 + sc, f.y - 0.8 * sc]));
      return out;
    }
    case 'TCH_OPENING': {
      const s = dec(f.raw).trim(); if (s) out.push(TXT(f.tx, f.ty, f.h * sc, readable(f.rot), 1, 2, s));
      return out;
    }
    case 'TCH_MULTILEADER': {
      const s1 = dec(f.raw).trim(), s2 = dec(f.raw2).trim(), H = f.h * sc;
      const P = [f.x, f.y], E = [f.x + f.L * sc, f.y], x0 = Math.min(P[0], E[0]);
      out.push(LN(P, E)); for (const q of f.pts) out.push(LN(P, q), CIR(q, 0.5 * sc));
      if (s1) out.push(TXT(x0, f.y + sc, H, 0, 0, 1, s1));
      if (s2) out.push(TXT(x0, f.y - sc, H, 0, 0, 3, s2));
      return out;
    }
    case 'TCH_INDEXPOINTER': {
      const [s0, s1, s2, s3] = f.raws.map(u => dec(u).trim()), H = f.h * sc, rad = f.rad * sc;
      const dx = f.q[0] >= f.p[0] ? 1 : -1, E = [f.q[0] + dx * f.len * sc, f.q[1]], C = [E[0] + dx * rad, E[1]];
      out.push(LN(f.p, f.q), LN(f.q, E), CIR(C, rad), LN([C[0] - rad, C[1]], [C[0] + rad, C[1]]));
      if (s0) out.push(TXT(C[0], C[1] + rad / 2, H, 0, 1, 2, s0));
      if (s1) out.push(TXT(C[0], C[1] - rad / 2, H, 0, 1, 2, s1));
      const mx = (f.q[0] + E[0]) / 2;
      if (s2) out.push(TXT(mx, f.q[1] + sc, H, 0, 1, 1, s2));
      if (s3) out.push(TXT(mx, f.q[1] - sc, H, 0, 1, 3, s3));
      return out;
    }
    case 'TCH_ARROW': {
      const s = dec(f.raw).trim();
      let rot = 0;
      if (f.pts.length >= 2) { rot = readable(Math.atan2(f.pts[1][1] - f.pts[0][1], f.pts[1][0] - f.pts[0][0])); for (let i = 0; i + 1 < f.pts.length; i++) out.push(LN(f.pts[i], f.pts[i + 1])); }
      if (s) out.push(TXT(f.x, f.y, f.h * sc, rot, 1, 1, s));
      return out;
    }
    case 'TCH_SHEET': {
      const W = f.widths.map(w => w * sc), Hs = f.heights.map(h => h * sc);
      const xs = [f.x]; for (const w of W) xs.push(xs[xs.length - 1] + w);
      const y0 = f.y - 10 * sc, ys = [y0]; for (const h of Hs) ys.push(ys[ys.length - 1] - h);
      const title = dec(f.title).trim();
      if (title) out.push(TXT((xs[0] + xs[xs.length - 1]) / 2, f.y - 3.5 * sc, 5 * sc, 0, 1, 2, title));
      const nr = Hs.length, nc = W.length, used = Array.from({ length: nr }, () => new Array(nc).fill(false));
      const placed = [];
      for (const c of f.cells) if (c.span) { const [r0, c0, r1, c1] = c.span; for (let i = r0; i <= r1; i++) for (let j = c0; j <= c1; j++) used[i][j] = true; placed.push([c.raw, ...c.span]); }
      const free = []; for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (!used[i][j]) free.push([i, j]);
      const plain = f.cells.filter(c => !c.span);
      free.forEach(([i, j], k) => placed.push([k < plain.length ? plain[k].raw : null, i, j, i, j]));
      for (const [raw, r0, c0, r1, c1] of placed) {
        const xa = xs[c0], xb = xs[c1 + 1], ya = ys[r0], yb = ys[r1 + 1];
        out.push(LN([xa, ya], [xb, ya]), LN([xa, yb], [xb, yb]), LN([xa, ya], [xa, yb]), LN([xb, ya], [xb, yb]));
        const s = raw ? dec(raw).trim() : '';
        if (s) out.push(MT((xa + xb) / 2, (ya + yb) / 2, 3.5 * sc, 5, Math.max(xb - xa - 0.8 * sc, sc) * 1.1, s, 0.72));
      }
      return out;
    }
    case 'TCH_DIMENSION2': {
      if (!f.segs.length) return out;
      const u = [Math.cos(f.ang), Math.sin(f.ang)], n = [-u[1], u[0]], off = f.off * sc, sg = off >= 0 ? 1 : -1;
      const rot = readable(f.ang), up = [-Math.sin(rot), Math.cos(rot)], H = 3.5 * sc;
      let cum = 0; const D = [];
      const pts = [0]; for (const s of f.segs) { cum += s; pts.push(cum); }
      for (const c of pts) {
        const B = add([f.x, f.y], u, c), Dp = add(B, n, off); D.push(Dp);
        if (Math.abs(off) > 3 * sc) out.push(LN(add(B, n, sg * 3 * sc), add(Dp, n, sg * 2.5 * sc)));
        const t = [(u[0] + n[0]) * 0.7 * sc, (u[1] + n[1]) * 0.7 * sc];
        out.push(LN(add(Dp, t, -1), add(Dp, t, 1)));
      }
      out.push(LN(D[0], D[D.length - 1]));
      for (let i = 0; i < f.segs.length; i++) {
        const v = f.segs[i]; if (!(Math.abs(v) > 1e-6)) continue;
        const m = [(D[i][0] + D[i + 1][0]) / 2, (D[i][1] + D[i + 1][1]) / 2];
        const s = Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(Math.abs(v))) : String(+Math.abs(v).toFixed(1));
        out.push(TXT(m[0] + up[0] * sc, m[1] + up[1] * sc, H, rot, 1, 0, s));
      }
      return out;
    }
  }
  return out;
}

// 从 LibreDWG（wasm）里取出天正对象。结构体偏移是针对随软件附带的 libredwg-web.wasm 的，读到的
// 数据不符合预期时直接放弃，不会影响图纸其余部分。
// 返回 { items: [{ f, layer, color, style, mode, owner }], counts: { 类名: 个数 }, failed: { 类名: 个数 } }
export function extractTch(m, dwg, hex, decode = true) {
  const items = [], counts = {}, failed = {};
  const nc = m.dwg_get_num_classes(dwg); const cls = new Map();
  for (let i = 0; i < nc; i++) { const c = m.dwg_get_class(dwg, i); if (c) cls.set(c.num, String(c.dxfname || '').replace(/\0+$/, '')); }
  if (!m.HEAPU32 || !m.HEAPU8) return { items, counts, failed, decoded: false };
  const n = m.dwg_get_num_objects(dwg);
  for (let i = 0; i < n; i++) {
    const obj = m.dwg_get_object(dwg, i);
    if (!obj || m.dwg_object_get_fixedtype(obj) !== 65534) continue; // UNKNOWN_ENT
    const name = cls.get(m.dwg_object_get_type(obj)) || '?';
    counts[name] = (counts[name] || 0) + 1;
    if (!decode || !TCH_CLASSES.has(name)) continue;
    let f = null;
    try {
      const U = m.HEAPU32, B = m.HEAPU8; // wasm 内存可能在循环中扩容，每次重新取视图
      const w = obj >> 2;
      // Dwg_Object: [0] size [2] type [4] fixedtype [18] bitsize [27] num_unknown_bits [28] unknown_bits
      if (U[w + 4] === 65534 && U[w + 2] === m.dwg_object_get_type(obj)) {
        const size = U[w], bitsize = U[w + 18], nb = U[w + 27], ptr = U[w + 28];
        if (ptr && nb && nb <= size * 8 && ptr + Math.ceil(nb / 8) <= B.length) {
          const bytes = B.slice(ptr, ptr + Math.ceil(nb / 8));
          const start = size * 8 - nb; // 天正数据在对象里的起点
          f = decodeTchAny(name, bytes, nb, bitsize > start ? bitsize - start : -1);
        }
      }
    } catch (e) { f = null; }
    if (!f) { failed[name] = (failed[name] || 0) + 1; continue; }
    const ent = m.dwg_object_to_entity(obj), tio = m.dwg_object_to_entity_tio(obj);
    let mode = 2, owner = '', layer = '', color = 256;
    try { mode = m.dwg_object_entity_get_entmode(ent); } catch (e) { /* ignore */ }
    try { const o = m.dwg_object_entity_get_ownerhandle_object(ent); if (o && o.absolute_ref) owner = hex(o.absolute_ref); } catch (e) { /* ignore */ }
    try { const l = m.dwg_object_entity_get_layer_object_ref(ent); if (l && l.absolute_ref) layer = hex(l.absolute_ref); } catch (e) { /* ignore */ }
    try { const c = m.dwg_dynapi_common_value(tio, 'color'); if (c && c.success && c.data && Number.isFinite(c.data.index)) color = c.data.index; } catch (e) { /* ignore */ }
    items.push({ f, mode, owner, layer, color, style: f.style ? hex(f.style) : '' });
  }
  return { items, counts, failed, decoded: decode };
}
