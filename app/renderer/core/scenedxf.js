// 闪电看图 · 场景 → DXF R12（AC1009）导出
// layoutToDxf：把一个布局“展平”到模型空间（图纸坐标），视口内的模型内容按视口矩阵变换并精确裁剪。
// spaceToDxf：单独导出一个空间（模型空间输出世界坐标）。
// 返回字符串，编码（GBK）由调用方负责。
import { OP, FG } from './engine.js';

const TAU = Math.PI * 2;
const STEP = 2 * Math.acos(1 - 1e-3); // 圆弧离散步长：弦高 ≤ 1e-3 半径
const EPS = 1e-9;

// ---------- ACI 调色板（与 engine.js 相同的算法） ----------
const ACI = (() => {
  const t = new Array(256).fill(0);
  const base = [0x000000, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x808080, 0xc0c0c0];
  for (let i = 0; i < 10; i++) t[i] = base[i];
  const vals = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3];
  const hsv = (h, s, v) => {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
  };
  for (let i = 10; i < 250; i++) t[i] = hsv(Math.floor((i - 10) / 10) * 15, (i - 10) % 2 === 0 ? 1 : 0.5, vals[(i - 10) % 10]);
  const grays = [0x33, 0x5b, 0x84, 0xad, 0xd6, 0xff];
  for (let i = 0; i < 6; i++) t[250 + i] = grays[i] * 0x10101;
  return t;
})();
const aciCache = new Map();
export function nearestAci(c) {
  if (c === FG || c == null || c === 0xffffff || c === 0) return 7; // 前景色 / 纯白 / 纯黑 → 7
  let v = aciCache.get(c);
  if (v !== undefined) return v;
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  let best = 7, bd = Infinity;
  for (let i = 1; i < 256; i++) {
    const q = ACI[i]; const dr = ((q >> 16) & 255) - r, dg = ((q >> 8) & 255) - g, db = (q & 255) - b;
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bd) { bd = d; best = i; }
  }
  aciCache.set(c, best);
  return best;
}

// ---------- 多边形裁剪器（可为凹多边形，偶奇规则） ----------
class Clipper {
  constructor(poly) {
    const P = poly.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (P.length > 1 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1]) P.pop();
    const ax = [], ay = [], bx = [], by = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      ax.push(a[0]); ay.push(a[1]); bx.push(b[0]); by.push(b[1]);
    }
    const n = this.n = ax.length;
    this.ax = Float64Array.from(ax); this.ay = Float64Array.from(ay); this.bx = Float64Array.from(bx); this.by = Float64Array.from(by);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of P) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1;
    // 轴对齐矩形：走快速路径
    this.rect = n === 4 && [0, 1, 2, 3].every(i => (ax[i] === bx[i] || ay[i] === by[i]) && (ax[i] === x0 || ax[i] === x1) && (ay[i] === y0 || ay[i] === y1));
    // 按 y 分带索引边，点测试与求交只看相关的带
    const nb = this.nb = Math.max(1, Math.min(256, n >> 1));
    this.bh = (y1 - y0) / nb || 1;
    this.bands = Array.from({ length: nb }, () => []);
    for (let e = 0; e < n; e++) {
      const b0 = this.band(Math.min(ay[e], by[e])), b1 = this.band(Math.max(ay[e], by[e]));
      for (let b = b0; b <= b1; b++) this.bands[b].push(e);
    }
    this.mark = new Int32Array(n); this.stamp = 0;
    this.ts = []; this.res = [];
  }
  band(y) { const b = Math.floor((y - this.y0) / this.bh); return b < 0 ? 0 : b >= this.nb ? this.nb - 1 : b; }
  inside(x, y) {
    if (!(x >= this.x0 && x <= this.x1 && y >= this.y0 && y <= this.y1)) return false;
    if (this.rect) return true;
    const L = this.bands[this.band(y)]; let c = false;
    for (let i = 0; i < L.length; i++) {
      const e = L[i]; const ya = this.ay[e], yb = this.by[e];
      if ((ya > y) !== (yb > y)) { const xi = this.ax[e] + (y - ya) * (this.bx[e] - this.ax[e]) / (yb - ya); if (x < xi) c = !c; }
    }
    return c;
  }
  // 线段 → 保留区间 [t0,t1,...]（端点不被裁时精确为 0 / 1）
  seg(x0, y0, x1, y1) {
    const R = this.res; R.length = 0;
    const sx0 = x0 < x1 ? x0 : x1, sx1 = x0 < x1 ? x1 : x0, sy0 = y0 < y1 ? y0 : y1, sy1 = y0 < y1 ? y1 : y0;
    if (sx1 < this.x0 || sx0 > this.x1 || sy1 < this.y0 || sy0 > this.y1) return R;
    const dx = x1 - x0, dy = y1 - y0;
    if (this.rect) { // Liang–Barsky
      let t0 = 0, t1 = 1;
      const P = [-dx, dx, -dy, dy], Q = [x0 - this.x0, this.x1 - x0, y0 - this.y0, this.y1 - y0];
      for (let i = 0; i < 4; i++) {
        if (P[i] === 0) { if (Q[i] < 0) return R; continue; }
        const r = Q[i] / P[i];
        if (P[i] < 0) { if (r > t0) t0 = r; } else if (r < t1) t1 = r;
      }
      if (t1 > t0) R.push(t0, t1);
      return R;
    }
    const ts = this.ts; ts.length = 0;
    const st = ++this.stamp;
    const b0 = this.band(sy0), b1 = this.band(sy1);
    for (let b = b0; b <= b1; b++) {
      const L = this.bands[b];
      for (let i = 0; i < L.length; i++) {
        const e = L[i]; if (this.mark[e] === st) continue; this.mark[e] = st;
        const ax = this.ax[e], ay = this.ay[e], ex = this.bx[e] - ax, ey = this.by[e] - ay;
        if (Math.max(ax, ax + ex) < sx0 || Math.min(ax, ax + ex) > sx1 || Math.max(ay, ay + ey) < sy0 || Math.min(ay, ay + ey) > sy1) continue;
        const den = dx * ey - dy * ex; if (den === 0) continue;
        const t = ((ax - x0) * ey - (ay - y0) * ex) / den, u = ((ax - x0) * dy - (ay - y0) * dx) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
      }
    }
    if (ts.length > 1) ts.sort((a, b) => a - b);
    ts.push(1);
    let prev = 0;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i]; if (t - prev <= 1e-12 && t !== 1) continue;
      const m = (prev + t) / 2;
      if (t > prev && this.inside(x0 + dx * m, y0 + dy * m)) {
        if (R.length && R[R.length - 1] === prev) R[R.length - 1] = t; else R.push(prev, t);
      }
      prev = t;
    }
    return R;
  }
}

// 折线（扁平坐标，闭合时末点 = 首点）裁剪；整条保留时返回 true 且不调用 emit
function clipChain(clip, xy, emit) {
  const n = xy.length >> 1; if (n < 2) return false;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < xy.length; i += 2) { const x = xy[i], y = xy[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < clip.x0 || x0 > clip.x1 || y1 < clip.y0 || y0 > clip.y1) return false;
  if (clip.rect && x0 >= clip.x0 && x1 <= clip.x1 && y0 >= clip.y0 && y1 <= clip.y1) return true;
  const chains = []; let cur = null, open = false, all = true;
  for (let i = 0; i + 1 < n; i++) {
    const ax = xy[2 * i], ay = xy[2 * i + 1], bx = xy[2 * i + 2], by = xy[2 * i + 3];
    if (ax === bx && ay === by) continue;
    const R = clip.seg(ax, ay, bx, by);
    if (!(R.length === 2 && R[0] === 0 && R[1] === 1)) all = false;
    if (!R.length) { open = false; continue; }
    for (let k = 0; k < R.length; k += 2) {
      const t0 = R[k], t1 = R[k + 1];
      const px = t1 === 1 ? bx : ax + (bx - ax) * t1, py = t1 === 1 ? by : ay + (by - ay) * t1;
      if (t0 === 0 && open && cur) cur.push(px, py);
      else {
        cur = t0 === 0 ? [ax, ay, px, py] : [ax + (bx - ax) * t0, ay + (by - ay) * t0, px, py];
        cur.seg0 = t0 === 0 ? i : -1; chains.push(cur);
      }
      open = t1 === 1;
    }
  }
  if (all) return true;
  // 闭合环：首段从起点开始、末段到终点结束时首尾相接
  const closed = n > 2 && xy[0] === xy[xy.length - 2] && xy[1] === xy[xy.length - 1];
  if (closed && chains.length > 1 && chains[0].seg0 === 0 && open) {
    const last = chains.pop(); for (let k = 2; k < chains[0].length; k++) last.push(chains[0][k]); chains[0] = last;
  }
  for (const c of chains) emit(c);
  return false;
}

// ---------- 数字与字符串 ----------
function num(x) {
  if (!Number.isFinite(x)) return '0';
  let s = x.toFixed(8);
  let e = s.length; while (s.charCodeAt(e - 1) === 48) e--; if (s.charCodeAt(e - 1) === 46) e--;
  s = s.slice(0, e);
  return s === '-0' ? '0' : s;
}
const BAD_NAME = /[<>/\\":;?*|=`,\u0000-\u001f]/g;
// 显示用的符号写回 CAD 的控制码：GBK 里没有 Ø、上下标，直接编码会变成「?」。
const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹', SUBS = '₀₁₂₃₄₅₆₇₈₉';
function txt(s) {
  return String(s).replace(/[\r\n\t]+/g, ' ').replace(/%%/g, '%%%%%%')
    .replace(/[\u00d8\u2300]/g, '%%c').replace(/\u00b0/g, '%%d').replace(/\u00b1/g, '%%p')
    .replace(/[\x82-\x85\x8c-\x8f]/g, c => '%%' + c.charCodeAt(0)) // 结构钢筋符号、上下标标记（原始 %%130–%%143）
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/g, c => { const i = SUPS.indexOf(c); return String(i >= 0 ? i : SUBS.indexOf(c)); })
    .replace(/[\u0000-\u001f\u007f]/g, '');
}

// ---------- DXF 写出器 ----------
class Writer {
  constructor(scene, opts) {
    this.o = []; this.opts = opts;
    this.bb = [Infinity, Infinity, -Infinity, -Infinity];
    this.layers = new Map(); // 原名 → { name, aci }
    this.names = new Set();
    this.ltypes = new Map(); // 键 → { name, d }
    for (const l of scene.layers || []) this.layer(l.name, l.color);
    this.layer('0', FG);
  }
  p(...a) { for (const x of a) this.o.push(x); }
  ext(x, y) { const b = this.bb; if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
  layer(n, color) {
    let L = this.layers.get(n);
    if (!L) {
      let nm = String(n || '0').replace(BAD_NAME, '_').trim() || '0';
      if (this.names.has(nm.toUpperCase())) { let i = 2; while (this.names.has((nm + '_' + i).toUpperCase())) i++; nm += '_' + i; }
      this.names.add(nm.toUpperCase());
      L = { name: nm, aci: nearestAci(color === undefined ? FG : color) };
      this.layers.set(n, L);
    }
    return L;
  }
  ltype(d, s) {
    const v = d.map(x => x * s); // 正数画、负数空，原样写回
    const k = v.map(x => x.toPrecision(6)).join(',');
    let t = this.ltypes.get(k);
    if (!t) { t = { name: 'LP' + (this.ltypes.size + 1), d: v }; this.ltypes.set(k, t); }
    return t.name;
  }
  // 公共组码：类型、图层、线型、颜色（与图层同色时随层）
  head(type, st) {
    const L = this.layer(st.layer, st.color);
    this.o.push('0', type, '8', L.name);
    if (st.lt) this.o.push('6', st.lt);
    const a = nearestAci(st.color);
    if (a !== L.aci) this.o.push('62', String(a));
  }
  line(x0, y0, x1, y1, st) {
    this.head('LINE', st);
    this.p('10', num(x0), '20', num(y0), '30', '0', '11', num(x1), '21', num(y1), '31', '0');
    this.ext(x0, y0); this.ext(x1, y1);
  }
  poly(xy, closed, st) {
    let n = xy.length >> 1;
    if (closed && n > 1 && xy[0] === xy[2 * n - 2] && xy[1] === xy[2 * n - 1]) n--;
    if (n < 2) return;
    if (n === 2 && !closed && !(st.w > 0)) return this.line(xy[0], xy[1], xy[2], xy[3], st);
    this.head('POLYLINE', st);
    this.p('66', '1', '10', '0', '20', '0', '30', '0', '70', closed ? '1' : '0');
    if (st.w > 0) this.p('40', num(st.w), '41', num(st.w));
    const L = this.layer(st.layer).name;
    for (let i = 0; i < n; i++) { this.p('0', 'VERTEX', '8', L, '10', num(xy[2 * i]), '20', num(xy[2 * i + 1]), '30', '0'); this.ext(xy[2 * i], xy[2 * i + 1]); }
    this.p('0', 'SEQEND', '8', L);
  }
  arc(cx, cy, r, s, e, full, st) { // 角度为弧度，逆时针 s→e
    this.head(full ? 'CIRCLE' : 'ARC', st);
    this.p('10', num(cx), '20', num(cy), '30', '0', '40', num(r));
    if (!full) { const d = a => { let v = a * 180 / Math.PI % 360; if (v < 0) v += 360; return num(v); }; this.p('50', d(s), '51', d(e)); }
    this.ext(cx - r, cy - r); this.ext(cx + r, cy + r);
  }
  point(x, y, st) { this.head('POINT', st); this.p('10', num(x), '20', num(y), '30', '0'); this.ext(x, y); }
  solid(r, n, st) { // 环顺序 → SOLID 的 1,2,4,3 顶点顺序
    const q = n === 3 ? [0, 1, 2, 2] : [0, 1, 3, 2];
    this.head('SOLID', st);
    for (let k = 0; k < 4; k++) { const i = q[k]; this.p(String(10 + k), num(r[2 * i]), String(20 + k), num(r[2 * i + 1]), String(30 + k), '0'); this.ext(r[2 * i], r[2 * i + 1]); }
  }
  // t：场景文字；x,y：输出锚点；U,V：输出的基线/竖直向量；s：长度比例
  text(t, x, y, Ux, Uy, Vx, Vy, s) {
    const lu = Math.hypot(Ux, Uy), lv = Math.hypot(Vx, Vy);
    if (!(lu > 0 && lv > 0) || !t.s) return;
    let my = t.my < 0, mx = t.mx < 0;
    if (Ux * Vy - Uy * Vx < 0) my = !my; // 镜像变换：等价于上下颠倒
    const h = t.h * lv, rot = Math.atan2(Uy, Ux);
    this.head('TEXT', t);
    this.p('10', num(x), '20', num(y), '30', '0', '40', num(h), '1', txt(t.sr || t.s)); // sr 是钢筋符号的原始写法
    let deg = rot * 180 / Math.PI % 360; if (deg < 0) deg += 360;
    if (Math.abs(deg) > 1e-9) this.p('50', num(deg));
    const wf = (t.wf || 1) * lu / lv;
    if (Math.abs(wf - 1) > 1e-9) this.p('41', num(wf));
    if (t.obl) this.p('51', num(t.obl * 180 / Math.PI));
    this.p('7', 'STANDARD');
    const gen = (mx ? 2 : 0) | (my ? 4 : 0);
    if (gen) this.p('71', String(gen));
    if (t.fit > 0) {
      const L = t.fit * s;
      this.p('72', '5', '11', num(x + Ux / lu * L), '21', num(y + Uy / lu * L), '31', '0');
    } else if (t.ha || t.va) {
      if (t.ha) this.p('72', String(t.ha));
      this.p('11', num(x), '21', num(y), '31', '0');
      if (t.va) this.p('73', String(t.va));
    }
    this.ext(x, y);
  }
  finish() {
    const H = [];
    const b = Number.isFinite(this.bb[0]) ? this.bb : [0, 0, 0, 0];
    const cp = this.opts.codepage || 'ANSI_936';
    H.push('0', 'SECTION', '2', 'HEADER',
      '9', '$ACADVER', '1', 'AC1009',
      '9', '$DWGCODEPAGE', '3', cp,
      '9', '$INSBASE', '10', '0', '20', '0', '30', '0',
      '9', '$EXTMIN', '10', num(b[0]), '20', num(b[1]), '30', '0',
      '9', '$EXTMAX', '10', num(b[2]), '20', num(b[3]), '30', '0',
      '9', '$LIMMIN', '10', num(b[0]), '20', num(b[1]),
      '9', '$LIMMAX', '10', num(b[2]), '20', num(b[3]),
      '9', '$LTSCALE', '40', '1',
      '0', 'ENDSEC');
    H.push('0', 'SECTION', '2', 'TABLES');
    H.push('0', 'TABLE', '2', 'LTYPE', '70', String(this.ltypes.size + 1),
      '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0');
    for (const t of this.ltypes.values()) {
      H.push('0', 'LTYPE', '2', t.name, '70', '0', '3', '', '72', '65', '73', String(t.d.length), '40', num(t.d.reduce((a, x) => a + Math.abs(x), 0)));
      t.d.forEach((x) => H.push('49', num(x)));
    }
    H.push('0', 'ENDTAB');
    H.push('0', 'TABLE', '2', 'LAYER', '70', String(this.layers.size));
    for (const L of this.layers.values()) H.push('0', 'LAYER', '2', L.name, '70', '0', '62', String(L.aci), '6', 'CONTINUOUS');
    H.push('0', 'ENDTAB');
    H.push('0', 'TABLE', '2', 'STYLE', '70', '1',
      '0', 'STYLE', '2', 'STANDARD', '70', '0', '40', '0', '41', '1', '50', '0', '71', '0', '42', '2.5',
      '3', this.opts.font || 'txt', '4', this.opts.bigFont ?? 'gbcbig.shx', '0', 'ENDTAB');
    H.push('0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
    const out = H.concat(this.o); this.o = null;
    out.push('0', 'ENDSEC', '0', 'EOF');
    return out.join('\r\n') + '\r\n';
  }
}

// ---------- 空间输出 ----------
// M：局部坐标 → 输出坐标的仿射；clip：裁剪器或 null；vis(layer)：图层是否输出
function emitSpace(W, sp, M, clip, vis) {
  const det = M[0] * M[3] - M[1] * M[2];
  const s = Math.sqrt(Math.abs(det));
  const sim = Math.abs(Math.hypot(M[0], M[1]) - Math.hypot(M[2], M[3])) <= 1e-9 * s && Math.abs(M[0] * M[2] + M[1] * M[3]) <= 1e-9 * s * s;
  const ident = M[0] === 1 && M[1] === 0 && M[2] === 0 && M[3] === 1 && M[4] === 0 && M[5] === 0;
  const tx = (x, y) => M[0] * x + M[2] * y + M[4], ty = (x, y) => M[1] * x + M[3] * y + M[5];
  const xf = (src) => { if (ident) return src; const d = new Array(src.length); for (let i = 0; i < src.length; i += 2) { d[i] = tx(src[i], src[i + 1]); d[i + 1] = ty(src[i], src[i + 1]); } return d; };
  // 输出一条折线（输出坐标），按需裁剪
  const chain = (xy, closed, st) => {
    if (closed && (xy[0] !== xy[xy.length - 2] || xy[1] !== xy[xy.length - 1])) xy.push(xy[0], xy[1]);
    if (!clip || clipChain(clip, xy, c => W.poly(c, false, st))) W.poly(xy, closed, st);
  };

  for (const b of sp.batches) {
    if (!vis(b.layer)) continue;
    const st = { layer: b.layer, color: b.color, lt: b.dash && b.dash.length >= 2 ? W.ltype(b.dash, s) : null, w: b.w > 0 ? b.w * s : 0 };
    const ops = b.ops;
    if (b.w < 0) { // 点
      for (let j = 0; j < ops.length;) {
        const op = ops[j];
        if (op === OP.M) { const x = tx(ops[j + 1], ops[j + 2]), y = ty(ops[j + 1], ops[j + 2]); if (!clip || clip.inside(x, y)) W.point(x, y, { layer: b.layer, color: b.color }); j += 3; }
        else j += op === OP.L ? 3 : op === OP.A ? 7 : op === OP.E ? 9 : 1;
      }
      continue;
    }
    // 逐个子路径：pts 为源坐标扁平点列；arcP 记录“仅一段圆弧”的子路径
    let pts = [], arcP = null, nOps = 0, sx = 0, sy = 0;
    const add = (x, y) => { const n = pts.length; if (n && Math.abs(pts[n - 2] - x) <= EPS && Math.abs(pts[n - 1] - y) <= EPS) return; pts.push(x, y); };
    const flush = (closed) => {
      if (pts.length >= 4) {
        if (arcP && sim && !closed) {
          let ok = !clip;
          if (clip) { // 先看外接框，再看折线是否完整保留
            const c = [tx(arcP.cx, arcP.cy), ty(arcP.cx, arcP.cy)], R = arcP.r * s;
            if (c[0] + R < clip.x0 || c[0] - R > clip.x1 || c[1] + R < clip.y0 || c[1] - R > clip.y1) ok = null;
            else ok = clipChain(clip, xf(pts), c2 => W.poly(c2, false, st));
          }
          if (ok) {
            let a = arcP.dir > 0 ? arcP.a0 : arcP.a0 - arcP.d, e = arcP.dir > 0 ? arcP.a0 + arcP.d : arcP.a0;
            let A = Math.atan2(M[1] * Math.cos(a) + M[3] * Math.sin(a), M[0] * Math.cos(a) + M[2] * Math.sin(a));
            let E = Math.atan2(M[1] * Math.cos(e) + M[3] * Math.sin(e), M[0] * Math.cos(e) + M[2] * Math.sin(e));
            if (det < 0) [A, E] = [E, A];
            W.arc(tx(arcP.cx, arcP.cy), ty(arcP.cx, arcP.cy), arcP.r * s, A, E, arcP.full, st);
          }
        } else chain(xf(pts), closed, st);
      }
      pts = []; arcP = null; nOps = 0;
    };
    const sweep = (a0, a1, ccw) => { // canvas arc 规则下的扫掠角（带符号）
      let d = ccw ? a1 - a0 : a0 - a1;
      if (d >= TAU - 1e-12) return { d: TAU, full: true };
      d %= TAU; if (d < 0) d += TAU;
      return { d, full: false };
    };
    for (let j = 0; j < ops.length;) {
      const op = ops[j];
      if (op === OP.M) { flush(false); sx = ops[j + 1]; sy = ops[j + 2]; add(sx, sy); j += 3; }
      else if (op === OP.L) { if (!pts.length) { sx = ops[j + 1]; sy = ops[j + 2]; } add(ops[j + 1], ops[j + 2]); nOps++; arcP = null; j += 3; }
      else if (op === OP.A) {
        const cx = ops[j + 1], cy = ops[j + 2], r = ops[j + 3], a0 = ops[j + 4], ccw = ops[j + 6] !== 0;
        const { d, full } = sweep(a0, ops[j + 5], ccw), dir = ccw ? 1 : -1;
        const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        const lone = nOps === 0 && pts.length === 2 && Math.abs(pts[0] - x0) <= 1e-7 * (1 + r) && Math.abs(pts[1] - y0) <= 1e-7 * (1 + r);
        if (!pts.length) { sx = x0; sy = y0; }
        add(x0, y0);
        const k = Math.max(2, Math.ceil(d / STEP));
        for (let i = 1; i <= k; i++) { const a = a0 + dir * d * i / k; add(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
        arcP = lone && d > 0 ? { cx, cy, r, a0, d, dir, full } : null;
        nOps++; j += 7;
      } else if (op === OP.E) {
        const cx = ops[j + 1], cy = ops[j + 2], rx = ops[j + 3], ry = ops[j + 4], ro = ops[j + 5], t0 = ops[j + 6], ccw = ops[j + 8] !== 0;
        const { d } = sweep(t0, ops[j + 7], ccw), dir = ccw ? 1 : -1, c = Math.cos(ro), sn = Math.sin(ro);
        const k = Math.max(2, Math.ceil(d / STEP));
        for (let i = 0; i <= k; i++) { const t = t0 + dir * d * i / k, ex = rx * Math.cos(t), ey = ry * Math.sin(t); add(cx + c * ex - sn * ey, cy + sn * ex + c * ey); }
        if (pts.length === 2) { sx = pts[0]; sy = pts[1]; }
        arcP = null; nOps++; j += 9;
      } else if (op === OP.Z) { flush(true); add(sx, sy); j++; }
      else j++;
    }
    flush(false);
  }

  // 填充：小三角/四边形输出 SOLID，其余输出闭合外轮廓
  for (const f of sp.fills) {
    if (!vis(f.layer)) continue;
    const st = { layer: f.layer, color: f.color, w: 0 };
    for (let g = 0; g < f.groups.length; g += 2) {
      const g0 = f.groups[g], g1 = f.groups[g + 1];
      for (let k = g0; k < g1; k++) {
        const r = xf(Array.from(f.rings[k]));
        const n = r.length >> 1;
        if (g1 - g0 === 1 && f.alpha >= 1 && (n === 3 || n === 4)) {
          const ring = r.concat([r[0], r[1]]);
          if (!clip || clipChain(clip, ring, () => {})) { W.solid(r, n, st); continue; }
        }
        if (n >= 2) chain(r, true, st);
      }
    }
  }

  // 文字：插入点在裁剪区内才输出
  for (const t of sp.texts) {
    if (!vis(t.layer)) continue;
    const x = tx(t.x, t.y), y = ty(t.x, t.y);
    if (clip && !clip.inside(x, y)) continue;
    W.text(t, x, y, M[0] * t.ux + M[2] * t.uy, M[1] * t.ux + M[3] * t.uy, M[0] * t.vx + M[2] * t.vy, M[1] * t.vx + M[3] * t.vy, s);
  }
}

function visFn(scene, opts, frozen) {
  const on = opts.layerOn || new Map((scene.layers || []).map(l => [l.name, l.on]));
  return (n) => { if (frozen && frozen.has(n)) return false; const v = on.get(n); return v === undefined ? true : !!v; };
}
function mmul(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
// 与 app.js vpMatrix 相同：模型局部坐标 → 图纸坐标
export function viewportMatrix(vp, ms) {
  const k = vp.h / vp.vh, c = Math.cos(vp.twist || 0), s = Math.sin(vp.twist || 0);
  let Mv = [k, 0, 0, k, vp.cx, vp.cy];
  Mv = mmul(Mv, [1, 0, 0, 1, -vp.vcx, -vp.vcy]);
  Mv = mmul(Mv, [c, s, -s, c, 0, 0]);
  return mmul(Mv, [1, 0, 0, 1, ms.origin[0] - (vp.tx || 0), ms.origin[1] - (vp.ty || 0)]);
}
export function viewportClip(vp) {
  return vp.clip && vp.clip.length > 2 ? vp.clip : [[vp.cx - vp.w / 2, vp.cy - vp.h / 2], [vp.cx + vp.w / 2, vp.cy - vp.h / 2], [vp.cx + vp.w / 2, vp.cy + vp.h / 2], [vp.cx - vp.w / 2, vp.cy + vp.h / 2]];
}

// 布局展平：图纸空间图元 + 各视口里裁剪后的模型内容（图纸坐标）
export function layoutToDxf(scene, paperKey, opts = {}) {
  const sp = scene.spaces.find(s => s.key === paperKey);
  if (!sp) throw new Error('layout not found: ' + paperKey);
  const ms = scene.spaces.find(s => !s.paper);
  const W = new Writer(scene, opts);
  if (ms) for (const vp of sp.viewports || []) {
    if (!vp.vh || !vp.h) continue;
    const clip = new Clipper(viewportClip(vp));
    if (clip.n < 3) continue;
    emitSpace(W, ms, viewportMatrix(vp, ms), clip, visFn(scene, opts, vp.frozen && vp.frozen.length ? new Set(vp.frozen) : null));
  }
  emitSpace(W, sp, [1, 0, 0, 1, 0, 0], null, visFn(scene, opts)); // 图纸空间原点为 0
  return W.finish();
}

// 单个空间（不处理视口）；模型空间输出世界坐标。opts.clip：可选的局部坐标多边形，只导出其内部
export function spaceToDxf(scene, spaceKey, opts = {}) {
  const sp = scene.spaces.find(s => s.key === spaceKey);
  if (!sp) throw new Error('space not found: ' + spaceKey);
  const o = sp.origin || [0, 0];
  const M = [1, 0, 0, 1, o[0], o[1]];
  const clip = opts.clip && opts.clip.length > 2 ? new Clipper(opts.clip.map(p => [p[0] + o[0], p[1] + o[1]])) : null;
  const W = new Writer(scene, opts);
  emitSpace(W, sp, M, clip, visFn(scene, opts));
  return W.finish();
}
