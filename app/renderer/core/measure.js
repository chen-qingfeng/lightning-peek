// 测量计算。不碰界面、不读全局状态，方便单独测试。
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function linOrient(a, b, o) { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; const w = Math.abs(b[0] - a[0]), hh = Math.abs(b[1] - a[1]);
  // 光标在两点竖向范围之外更远时标水平尺寸，否则标竖直尺寸（同 CAD 的线性标注）
  return Math.abs(o[1] - my) - hh / 2 >= Math.abs(o[0] - mx) - w / 2 ? 'h' : 'v'; }
export function footOn(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1]; const l = dx * dx + dy * dy || 1; const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l; return [a[0] + t * dx, a[1] + t * dy]; }
// 判断 1 个图纸单位是多少毫米。依据按可信度排列：
// 1) 图上「L=xx」管长标注与旁边线段长度的比例（标注按米写）；2) 文件头声明的单位（米、厘米、英寸等）；
// 3) 坐标是大地测量坐标（几十万、几百万）时按米；4) 其余按毫米。
export function guessUnit(sc) {
  const u = sc.insunits, cjk = /[\u4e00-\u9fff]/;
  const chinese = sc.layers.some(l => cjk.test(l.name)) || sc.spaces.some(sp => sp.texts.slice(0, 500).some(t => cjk.test(t.s)));
  const ms = sc.spaces.find(s => s.key === '*MODEL_SPACE');
  const k = ms ? labelUnitVote(ms) : null;
  if (k !== null) return { uf: 1000 * Math.pow(10, k), why: 'label' };
  if (!chinese && sc.measurement === 0 && (u === 1 || u === 2)) return { uf: u === 1 ? 25.4 : 304.8, why: 'header' };
  if (u === 5 || u === 6 || u === 14) return { uf: { 5: 10, 6: 1000, 14: 100 }[u], why: 'header' };
  if (ms && geodetic(ms)) return { uf: 1000, why: 'coord' };
  return { uf: 1, why: u === 4 ? 'header' : 'default' };
}
export function geodetic(ms) {
  const v = ms.view || ms.bbox; if (!v || !Number.isFinite(v[0])) return false;
  const cx = Math.abs((v[0] + v[2]) / 2 + ms.origin[0]), cy = Math.abs((v[1] + v[3]) / 2 + ms.origin[1]);
  const east = x => (x >= 2e4 && x < 1e6) || (x >= 1.3e7 && x < 4.6e7); // 含带号的横坐标
  const north = y => y >= 1e6 && y < 1e7;
  return Math.max(v[2] - v[0], v[3] - v[1]) < 2e5 && ((east(cx) && north(cy)) || (east(cy) && north(cx)));
}
export function labelUnitVote(ms) {
  const re = /^\s*L\s*[=＝:：]\s*(\d+(?:\.\d+)?)\s*(?:m|米)?\s*$/i;
  const labs = [];
  for (const t of ms.texts) { const m = re.exec(t.s); if (m && +m[1] > 0) { labs.push([t, +m[1]]); if (labs.length >= 600) break; } }
  if (labs.length < 3 || !ms.curves) return null;
  const hs = labs.map(x => x[0].h).sort((a, b) => a - b); const r = (hs[hs.length >> 1] || 1) * 40;
  const c = ms.curves; const g = new Map(); const key = (x, y) => Math.floor(x / r) * 1000003 + Math.floor(y / r);
  for (let i = 0; i < c.length; i += 6) { const kk = key((c[i + 1] + c[i + 3]) / 2, (c[i + 2] + c[i + 4]) / 2); let a = g.get(kk); if (!a) g.set(kk, a = []); a.push(i); }
  const votes = new Map(); let any = 0;
  for (const [t, val] of labs) {
    const ks = new Set(); const gx = Math.floor(t.x / r), gy = Math.floor(t.y / r);
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gy - 1; j <= gy + 1; j++) {
      const a = g.get(i * 1000003 + j); if (!a) continue;
      for (const ci of a) {
        if (Math.hypot((c[ci + 1] + c[ci + 3]) / 2 - t.x, (c[ci + 2] + c[ci + 4]) / 2 - t.y) > r) continue;
        const ratio = val / c[ci]; const k = Math.round(Math.log10(ratio)); if (k > 0 || k < -3) continue;
        if (Math.abs(ratio / Math.pow(10, k) - 1) < 0.02) ks.add(k);
      }
    }
    if (ks.size) any++; for (const k of ks) votes.set(k, (votes.get(k) || 0) + 1);
  }
  let best = null, bn = 0; for (const [k, n] of votes) if (n > bn) { bn = n; best = k; }
  if (!(bn >= 3 && bn >= any * 0.6)) return null;
  // 标注值等于线长（比例 1）时，既可能是「米制图纸配米制标注」，也可能是「毫米图纸配毫米标注」：
  // 只有标注多数带小数（如 L=24.31）或坐标是测量坐标时才判为米，否则交给后面的规则
  if (best === 0) { const dec = labs.filter(([t]) => /\d\.\d/.test(t.s)).length; if (!(dec >= labs.length * 0.5 || geodetic(ms))) return null; }
  return best;
}
export function polyArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }
export function offsetPoly(pts, d) {
  let sa = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; sa += p[0] * q[1] - q[0] * p[1]; }
  const sg = sa >= 0 ? 1 : -1; const n = pts.length; const out = [];
  const nrm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [sg * dy / l, -sg * dx / l]; };
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], v = pts[i], b = pts[(i + 1) % n];
    const n1 = nrm(a, v), n2 = nrm(v, b); const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    const f = k > 0.05 ? d / k : d / 0.05;
    out.push([v[0] + (n1[0] + n2[0]) * f, v[1] + (n1[1] + n2[1]) * f]);
  }
  return out;
}
// 沿折线取距起点 t 处的点和方向
export function alongPts(pts, t) {
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1], l = dist(a, b); if (acc + l >= t || i + 2 === pts.length) { const f = l ? Math.max(0, Math.min(1, (t - acc) / l)) : 0; return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], ang: Math.atan2(b[1] - a[1], b[0] - a[0]) }; } acc += l; }
  return { p: pts[0], ang: 0 };
}
export function chainage(du, doc) {
  const mm = du * doc.unit.uf; if (doc.unit.len !== 'm') return mm.toFixed(0);
  const dec = doc.unit.dec; const m = +(mm / 1000).toFixed(dec); const km = Math.floor(m / 1000); let r = Math.max(0, m - km * 1000).toFixed(dec).replace(/\.0+$/, ''); const [ip, fp] = r.split('.');
  return 'K' + km + '+' + ip.padStart(3, '0') + (fp ? '.' + fp : '');
}
// 3 点圆弧离散
export function arc3(a, m, b, n = 128) {
  const ax = a[0], ay = a[1], bx = m[0], by = m[1], cx = b[0], cy = b[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)); if (Math.abs(d) < 1e-12) return [m, b];
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy); const t0 = Math.atan2(ay - uy, ax - ux), tm = Math.atan2(by - uy, bx - ux), t1 = Math.atan2(cy - uy, cx - ux);
  const norm = (x) => { while (x < 0) x += Math.PI * 2; while (x >= Math.PI * 2) x -= Math.PI * 2; return x; };
  let sw = norm(t1 - t0); if (norm(tm - t0) > sw) sw = sw - Math.PI * 2; // 经过中间点的方向
  const out = []; for (let i = 1; i <= n; i++) { const t = t0 + sw * i / n; out.push([ux + r * Math.cos(t), uy + r * Math.sin(t)]); }
  return out;
}
// 面积工具：带弧线段的点列 → 折线
export function flattenArcs(pts, mids) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (mids.has(i) && i + 1 < pts.length) { out.push(...arc3(pts[i - 1], pts[i], pts[i + 1])); i++; }
    else out.push(pts[i]);
  }
  return out;
}
