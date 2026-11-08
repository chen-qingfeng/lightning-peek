// 闪电看图 · Canvas 渲染器
import { OP, FG, FONT_FAMILIES } from './engine.js';

export function buildPath(ops) {
  const p = new Path2D();
  for (let j = 0; j < ops.length;) {
    const op = ops[j];
    if (op === OP.M) { p.moveTo(ops[j + 1], ops[j + 2]); j += 3; }
    else if (op === OP.L) { p.lineTo(ops[j + 1], ops[j + 2]); j += 3; }
    else if (op === OP.A) { p.arc(ops[j + 1], ops[j + 2], ops[j + 3], ops[j + 4], ops[j + 5], ops[j + 6] === 0); j += 7; }
    else if (op === OP.E) { p.ellipse(ops[j + 1], ops[j + 2], ops[j + 3], ops[j + 4], ops[j + 5], ops[j + 6], ops[j + 7], ops[j + 8] === 0); j += 9; }
    else if (op === OP.Z) { p.closePath(); j++; }
    else j++;
  }
  return p;
}
function ringsPath(rings, g0, g1) {
  const p = new Path2D();
  for (let k = g0; k < g1; k++) {
    const r = rings[k];
    p.moveTo(r[0], r[1]);
    for (let j = 2; j < r.length; j += 2) p.lineTo(r[j], r[j + 1]);
    p.closePath();
  }
  return p;
}
export function css(c, bg) {
  if (c === FG) return bg === 'white' ? '#000000' : '#ffffff';
  if (bg === 'white' && c === 0xffffff) return '#000000';
  return '#' + (c >>> 0).toString(16).padStart(6, '0');
}
export function mapply(M, x, y) { return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]; }
export function mmul(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
export function minv(m) {
  const d = m[0] * m[3] - m[1] * m[2];
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}

const OLE_FONTS = '"Microsoft YaHei","SimSun","Noto Sans CJK SC","PingFang SC",sans-serif';
function oleFont(face) { return face && !/[",]/.test(face) ? '"' + face + '",' + OLE_FONTS : OLE_FONTS; }
const measureCtx = (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : document.createElement('canvas')).getContext('2d');

export class Renderer {
  constructor() { this.bg = 'black'; this.layerOn = new Map(); this.prepared = new WeakMap(); this.highlight = null; this.lineScale = 1; this.showText = true; }
  prepare(space) {
    let P = this.prepared.get(space);
    if (P) return P;
    P = {
      batches: space.batches.map(b => ({ b, path: null })),
      fills: space.fills.map(f => ({ f, paths: null })),
    };
    this.prepared.set(space, P);
    return P;
  }
  visible(layer) { const v = this.layerOn.get(layer); return v === undefined ? true : v; }
  colorOf(c, override) { return override || css(c, this.bg); }

  // 在仿射 M（局部坐标 → 设备像素）下绘制一个空间
  drawSpace(ctx, space, M, viewRect, opt = {}) {
    const P = this.prepare(space);
    const s = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]));
    const dpr = opt.dpr || 1;
    const px = Math.max(1, dpr * 0.9) * this.lineScale;
    const over = opt.color;
    ctx.save();
    ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
    ctx.lineJoin = 'round';
    // 填充
    for (const F of P.fills) {
      const f = F.f; if (!this.visible(f.layer)) continue;
      if (!F.paths) { F.paths = []; for (let g = 0; g < f.groups.length; g += 2) F.paths.push(ringsPath(f.rings, f.groups[g], f.groups[g + 1])); }
      ctx.globalAlpha = (opt.alpha ?? 1) * f.alpha;
      ctx.fillStyle = this.colorOf(f.color, over);
      for (const p of F.paths) ctx.fill(p, 'evenodd');
    }
    ctx.globalAlpha = opt.alpha ?? 1;
    // 线
    for (const B of P.batches) {
      const b = B.b; if (!this.visible(b.layer)) continue;
      if (!B.path) B.path = buildPath(b.ops);
      ctx.strokeStyle = this.colorOf(b.color, over);
      if (b.w < 0) { ctx.lineWidth = 3 * px / s; ctx.lineCap = 'round'; }
      else { ctx.lineWidth = Math.max(b.w, px / s); ctx.lineCap = b.w > 0 ? 'square' : 'butt'; }
      if (b.dash && opt.dash !== false) {
        const minD = Math.min(...b.dash) * s;
        const total = b.dash.reduce((a, x) => a + x, 0) * s;
        ctx.setLineDash(total > 6 * dpr && minD > 0.6 ? b.dash : []);
      } else ctx.setLineDash([]);
      ctx.stroke(B.path);
    }
    ctx.setLineDash([]);
    ctx.restore();
    if (this.showText) this.drawTexts(ctx, space.texts, M, viewRect, over, opt);
    if (space.oles && space.oles.length) this.drawOles(ctx, space.oles, M, viewRect, opt);
  }

  // OLE 对象（嵌入的 Excel 表格等）：按 Windows 保存的预览图元绘制，底色为白色，和 CAD 里一致
  drawOles(ctx, oles, M, viewRect, opt = {}) {
    const [vx0, vy0, vx1, vy1] = viewRect;
    const dpr = opt.dpr || 1;
    for (const o of oles) {
      if (!this.visible(o.layer)) continue;
      const q = o.quad.map(p => mapply(M, p[0], p[1]));
      const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
      if (Math.max(...xs) < vx0 || Math.min(...xs) > vx1 || Math.max(...ys) < vy0 || Math.min(...ys) > vy1) continue;
      const T = mmul(M, o.L);
      const sx = Math.hypot(T[0], T[1]), sy = Math.hypot(T[2], T[3]); const sc = Math.sqrt(sx * sy);
      ctx.save();
      ctx.globalAlpha = opt.alpha ?? 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
      if (opt.color) { ctx.strokeStyle = opt.color; ctx.lineWidth = dpr; ctx.stroke(); ctx.restore(); continue; }
      ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.clip();
      if (Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < 6 * dpr) { ctx.restore(); continue; }
      ctx.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]);
      const px = Math.max(1, dpr * 0.9) / sc;
      let clip = undefined;
      for (const op of o.pic.ops) {
        if (op.clip !== clip) {
          if (clip !== undefined) ctx.restore();
          ctx.save(); clip = op.clip;
          if (clip) { ctx.beginPath(); ctx.rect(clip[0], clip[1], clip[2] - clip[0], clip[3] - clip[1]); ctx.clip(); }
        }
        if (op.t === 'L') {
          ctx.strokeStyle = css(op.c); ctx.lineWidth = Math.max(op.w || 0, px); ctx.lineCap = 'butt';
          ctx.beginPath(); ctx.moveTo(op.p[0], op.p[1]); for (let j = 2; j < op.p.length; j += 2) ctx.lineTo(op.p[j], op.p[j + 1]); ctx.stroke();
        } else if (op.t === 'F') {
          ctx.fillStyle = css(op.c);
          ctx.beginPath(); ctx.moveTo(op.p[0], op.p[1]); for (let j = 2; j < op.p.length; j += 2) ctx.lineTo(op.p[j], op.p[j + 1]); ctx.closePath(); ctx.fill();
        } else if (op.t === 'T') {
          const h = Math.abs(op.h) || 12;
          if (h * sc < 1.6 * dpr) continue;
          const size = op.h < 0 ? h : h * 0.86; // 正值是字符格高度，含行距
          ctx.font = (op.ital ? 'italic ' : '') + (op.bold ? 'bold ' : '') + '100px ' + oleFont(op.face);
          const k = size / 100;
          if (op._w === undefined) { measureCtx.font = ctx.font; op._w = measureCtx.measureText(op.s).width; }
          let fx = k; if (op.adv > 0 && op._w > 0) fx = Math.min(k, op.adv / op._w);
          const ha = (op.al & 6) === 6 ? 0.5 : (op.al & 6) === 2 ? 1 : 0;
          const va = (op.al & 24) === 24 ? 'alphabetic' : (op.al & 8) ? 'bottom' : 'top';
          ctx.save();
          ctx.translate(op.x, op.y);
          if (op.esc) ctx.rotate(-op.esc * Math.PI / 180);
          ctx.scale(fx, k);
          ctx.textBaseline = va;
          ctx.fillStyle = css(op.c);
          ctx.fillText(op.s, -op._w * ha, 0);
          ctx.restore();
        } else if (op.t === 'I') {
          if (!op._cv) {
            const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(op.img.w, op.img.h) : Object.assign(document.createElement('canvas'), { width: op.img.w, height: op.img.h });
            c.getContext('2d').putImageData(new ImageData(op.img.rgba, op.img.w, op.img.h), 0, 0); op._cv = c;
          }
          ctx.drawImage(op._cv, op.x, op.y, op.w, op.h);
        }
      }
      if (clip !== undefined) ctx.restore();
      ctx.restore();
    }
  }

  drawTexts(ctx, texts, M, viewRect, over, opt = {}) {
    const [vx0, vy0, vx1, vy1] = viewRect;
    const minPx = (opt.dpr || 1) * 1.6;
    let curFont = -1;
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = opt.alpha ?? 1;
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      if (!this.visible(t.layer)) continue;
      // 屏幕上的竖直方向长度 = 字高像素
      const Vx = M[0] * t.vx + M[2] * t.vy, Vy = M[1] * t.vx + M[3] * t.vy;
      const hpx = t.h * Math.hypot(Vx, Vy);
      if (hpx < minPx) continue;
      const e = M[0] * t.x + M[2] * t.y + M[4], f = M[1] * t.x + M[3] * t.y + M[5];
      const Ux = M[0] * t.ux + M[2] * t.uy, Uy = M[1] * t.ux + M[3] * t.uy;
      const reach = (t._wl || t.s.length * t.h * 1.1 * t.wf) * Math.hypot(Ux, Uy) + hpx * 2;
      if (e + reach < vx0 || e - reach > vx1 || f + reach < vy0 || f - reach > vy1) continue;
      if (curFont !== t.f) { ctx.font = '100px ' + FONT_FAMILIES[t.f]; curFont = t.f; }
      if (t._w === undefined) { measureCtx.font = '100px ' + FONT_FAMILIES[t.f]; t._w = measureCtx.measureText(t.s).width; }
      const em = t.h * 1.15, k = em / 100;
      t._wl = t._w * k * t.wf;
      let hx = t.wf * t.mx * k;
      if (t.fit) hx = t.fit / t._w * t.mx;
      const tanO = Math.tan(t.obl || 0);
      // 字形坐标 (gx, gy↓) → 局部：U*hx*gx + (−V*k*my − U*hx*tanO)*gy
      const ax = t.ux * hx, ay = t.uy * hx;
      const cx = -t.vx * k * t.my - t.ux * hx * tanO, cy = -t.vy * k * t.my - t.uy * hx * tanO;
      ctx.setTransform(M[0] * ax + M[2] * ay, M[1] * ax + M[3] * ay, M[0] * cx + M[2] * cy, M[1] * cx + M[3] * cy, e, f);
      ctx.fillStyle = this.colorOf(t.color, over);
      const capPx = 100 / 1.15;
      const gx = t.fit ? 0 : -t._w * (t.ha === 1 ? 0.5 : t.ha === 2 ? 1 : 0);
      const gy = t.va === 3 ? capPx : t.va === 2 ? capPx / 2 : t.va === 1 ? -14 : 0;
      ctx.fillText(t.s, gx, gy);
    }
    ctx.restore();
  }
}
