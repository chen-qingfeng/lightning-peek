// AutoCAD SHX（shapes / bigfont / unifont）解析与单线字形。
// 字体文件由用户本机的字体文件夹提供，不随软件分发。

const DIRS = [
  [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [-0.5, 1], [-1, 1], [-1, 0.5],
  [-1, 0], [-1, -0.5], [-1, -1], [-0.5, -1], [0, -1], [0.5, -1], [1, -1], [1, -0.5],
];

export const fontLib = new Map();

function s8(b) { return b < 128 ? b : b - 256; }

function readHeader(u8) {
  let p = 0;
  let header = '';
  while (p < u8.length) {
    const b = u8[p++];
    if (b === 0x1a) break;
    if (b === 0x0d && u8[p] === 0x0a && u8[p + 1] === 0x1a) { p += 2; break; }
    header += String.fromCharCode(b);
  }
  const parts = header.trim().split(/\s+/);
  return { type: (parts[1] || '').toLowerCase(), p };
}

function u16(dv, p) { return dv.getUint16(p, true); }
function u32(dv, p) { return dv.getUint32(p, true); }

// 字符记录前面可能有形状名和一个 0。坐标里也会出现 0，不能把第一个 0 一律当成名字结束。
function stripShapeName(bytes) {
  if (!bytes.length) return bytes;
  if (bytes[0] === 0) return bytes.subarray(1);
  const z = bytes.indexOf(0);
  if (z <= 0) return bytes;
  for (let i = 0; i < z; i++) {
    const c = bytes[i];
    const ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
    if (!ok) return bytes;
  }
  return bytes.subarray(z + 1);
}

function fontInfo(bytes) {
  let i = bytes.indexOf(0);
  if (i < 0) i = bytes.findIndex(v => v === 0x0d || v === 0x0a);
  const meta = { baseUp: 8, baseDown: 0, verticalDual: false, extended: false };
  if (i >= 0 && i + 3 < bytes.length) {
    meta.baseUp = bytes[i + 1] || 8;
    meta.baseDown = bytes[i + 2] || 0;
    meta.verticalDual = bytes[i + 3] === 2;
  }
  if (!meta.baseUp) meta.baseUp = 8;
  return meta;
}

function bigfontInfo(bytes) {
  const meta = { baseUp: 8, baseDown: 0, verticalDual: false, extended: false };
  let i = 0;
  while (i < bytes.length && bytes[i] !== 0) i++;
  i++;
  while (i < bytes.length && bytes[i] === 0) i++;
  const n = bytes.length - i;
  if (n >= 5 || (n === 4 && bytes[i + 1] === 0 && bytes[i + 3] > 0 && bytes[i + 3] !== bytes[i])) {
    meta.baseUp = bytes[i] || 8;
    meta.extended = true;
    meta.verticalDual = bytes[i + 2] === 2;
    return meta;
  }
  if (n === 4) {
    meta.baseUp = bytes[i] || 8;
    meta.baseDown = bytes[i + 1] || 0;
    meta.verticalDual = bytes[i + 2] === 2;
    meta.extended = meta.verticalDual;
    return meta;
  }
  if (n === 3) {
    meta.baseUp = bytes[i] || 8;
    meta.verticalDual = bytes[i + 1] === 2;
    meta.extended = meta.verticalDual;
  }
  if (!meta.baseUp) meta.baseUp = 8;
  return meta;
}

function parseShapes(u8, dv, p) {
  p += 4;
  const count = u16(dv, p); p += 2;
  const index = [];
  for (let i = 0; i < count && p + 4 <= u8.length; i++) {
    const code = u16(dv, p); const length = u16(dv, p + 2); p += 4;
    if (length > 0) index.push([code, length]);
  }
  const raw = new Map();
  for (const [code, length] of index) {
    if (p + length > u8.length) break;
    let bytes = u8.subarray(p, p + length); p += length;
    if (code !== 0) bytes = stripShapeName(bytes);
    if (bytes.length) raw.set(code, bytes);
  }
  const meta = raw.has(0) ? fontInfo(raw.get(0)) : { baseUp: 8, baseDown: 0, verticalDual: false, extended: false };
  return { type: 'shapes', raw, ...meta };
}

function parseBigfont(u8, dv, p) {
  p += 2;
  const count = dv.getInt16(p, true); p += 2;
  const ranges = dv.getInt16(p, true); p += 2;
  if (count <= 0 || count > 200000) throw new Error('bad bigfont');
  p += Math.max(0, ranges) * 4;
  const index = [];
  for (let i = 0; i < count && p + 8 <= u8.length; i++) {
    const code = u16(dv, p); const length = u16(dv, p + 2); const offset = u32(dv, p + 4); p += 8;
    if (length > 0 && offset > 0) index.push([code, length, offset]);
  }
  const raw = new Map();
  for (const [code, length, offset] of index) {
    if (offset + length > u8.length) continue;
    raw.set(code, u8.subarray(offset, offset + length));
  }
  const meta = raw.has(0) ? bigfontInfo(raw.get(0)) : { baseUp: 8, baseDown: 0, verticalDual: false, extended: false };
  return { type: 'bigfont', raw, ...meta };
}

function parseUnifont(u8, dv, p) {
  const count = dv.getInt32(p, true); p += 4;
  const infoLen = u16(dv, p); p += 2;
  const info = u8.subarray(p, p + infoLen); p += infoLen;
  const meta = fontInfo(info);
  const raw = new Map();
  for (let i = 0; i < count - 1 && p + 4 <= u8.length; i++) {
    const code = u16(dv, p); const length = u16(dv, p + 2); p += 4;
    if (p + length > u8.length) break;
    let bytes = u8.subarray(p, p + length); p += length;
    bytes = stripShapeName(bytes);
    if (bytes.length) raw.set(code, bytes);
  }
  return { type: 'unifont', raw, ...meta };
}

export function parseShx(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const head = readHeader(u8);
  let body;
  if (head.type === 'bigfont') body = parseBigfont(u8, dv, head.p);
  else if (head.type === 'unifont') body = parseUnifont(u8, dv, head.p);
  else if (head.type === 'shapes') body = parseShapes(u8, dv, head.p);
  else throw new Error('不是 SHX 字体');
  body.cache = new Map();
  return body;
}

export function installFont(name, bytes) {
  const key = String(name || '').split(/[\\/]/).pop().toLowerCase();
  if (!key.endsWith('.shx')) return null;
  const font = parseShx(bytes);
  fontLib.set(key, font);
  return font;
}

function glyphBytes(font, code) {
  let data = font.raw.get(code);
  if (!data) return null;
  if (font.type === 'bigfont' && code > 0xff && data.length >= 2) {
    const hi = (code >> 8) & 255, lo = code & 255;
    if (data[0] === hi && data[1] === lo) {
      let s = 2;
      if (data[s] === 0) s++;
      data = data.subarray(s);
    }
  }
  return data;
}

function skipCommand(font, data, i) {
  const cb = data[i];
  if (cb === undefined) return i;
  if (cb > 0x0f) return i;
  switch (cb) {
    case 0x03: case 0x04: return i + 1;
    case 0x07: {
      if (font.type === 'shapes') return i + 1;
      if (font.type === 'unifont') return i + 2;
      const n = data[i + 1];
      if (font.verticalDual && n === 0x8e) return i + 1;
      if (font.verticalDual && n === 0x8f) return i + 2;
      if (n === 0) return i + (font.extended ? 7 : 6);
      return i + 1;
    }
    case 0x08: return i + 2;
    case 0x09: {
      let j = i + 1;
      while (j + 1 < data.length) {
        const x = data[j], y = data[j + 1];
        j += 2;
        if (x === 0 && y === 0) break;
      }
      return j - 1;
    }
    case 0x0a: return i + 2;
    case 0x0b: return i + 5;
    case 0x0c: return i + 3;
    case 0x0d: {
      let j = i + 1;
      while (j + 1 < data.length) {
        const x = data[j], y = data[j + 1];
        j += 2;
        if (x === 0 && y === 0) break;
        j++;
      }
      return j - 1;
    }
    default: return i;
  }
}

function bulgePts(x0, y0, x1, y1, bulge) {
  const b = Math.max(-127, bulge) / 127;
  if (Math.abs(b) < 1e-4) return [x1, y1];
  const dx = x1 - x0, dy = y1 - y0;
  const chord = Math.hypot(dx, dy) || 1e-9;
  const theta = 4 * Math.atan(b);
  const r = chord / (2 * Math.sin(theta / 2));
  const dist = r * Math.cos(theta / 2);
  const cx = (x0 + x1) / 2 + (-dy / chord) * dist;
  const cy = (y0 + y1) / 2 + (dx / chord) * dist;
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  const steps = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 10)));
  const pts = [];
  const ar = Math.abs(r);
  for (let k = 1; k <= steps; k++) {
    const a = a0 + theta * k / steps;
    pts.push(cx + ar * Math.cos(a), cy + ar * Math.sin(a));
  }
  return pts;
}

function interpret(font, data, stack) {
  let x = 0, y = 0, scale = 1, pen = font.type !== 'bigfont';
  let cur = pen ? [0, 0] : null;
  const lines = [];
  const saved = [];
  let ink = 0;
  const flush = () => { if (cur && cur.length >= 4) lines.push(cur); cur = null; };
  const mark = (nx, ny) => { if (pen && nx > ink) ink = nx; };
  const go = (nx, ny) => {
    if (pen) { if (!cur) cur = [x, y]; cur.push(nx, ny); if (nx > ink) ink = nx; }
    x = nx; y = ny;
  };
  const drawSub = (sub, ox, oy, sx, sy) => {
    if (!sub) return;
    for (const pl of sub.lines) {
      const out = [];
      for (let k = 0; k < pl.length; k += 2) out.push(ox + pl[k] * sx, oy + pl[k + 1] * sy);
      if (out.length >= 4) lines.push(out);
    }
  };
  for (let i = 0; i < data.length; i++) {
    const cb = data[i];
    if (cb > 0x0f) {
      const len = cb >> 4, dir = cb & 0x0f, v = DIRS[dir];
      go(x + v[0] * len * scale, y + v[1] * len * scale);
      continue;
    }
    switch (cb) {
      case 0x00: flush(); i = data.length; break;
      case 0x01: pen = true; if (!cur) cur = [x, y]; break;
      case 0x02: flush(); pen = false; break;
      case 0x03: { const d = data[++i] || 1; scale /= d; break; }
      case 0x04: { const m = data[++i] || 1; scale *= m; break; }
      case 0x05: saved.push([x, y]); break;
      case 0x06: {
        const p = saved.pop();
        if (p) { flush(); x = p[0]; y = p[1]; if (pen) cur = [x, y]; }
        break;
      }
      case 0x07: {
        flush();
        if (font.type === 'shapes') {
          const code = data[++i];
          const sub = nativeGlyph(font, code, stack);
          drawSub(sub, x, y, scale, scale);
          if (sub) { x += sub.endX * scale; y += sub.endY * scale; mark(x, y); }
        } else if (font.type === 'unifont') {
          const code = (data[++i] << 8) | data[++i];
          const sub = nativeGlyph(font, code, stack);
          drawSub(sub, x, y, scale, scale);
          if (sub) { x += sub.endX * scale; y += sub.endY * scale; }
        } else {
          const n = data[++i];
          if (font.verticalDual && n === 0x8e) break;
          if (font.verticalDual && n === 0x8f) { i++; break; }
          if (n === 0) {
            const code = (data[++i] << 8) | data[++i];
            const bx = s8(data[++i]) * scale, by = s8(data[++i]) * scale;
            let w, h;
            if (font.extended) { w = (data[++i] || 1) * scale; h = (data[++i] || 1) * scale; }
            else { h = (data[++i] || 1) * scale; w = h; }
            const sub = nativeGlyph(font, code, stack);
            if (sub) {
              const bh = Math.max(1e-6, sub.maxY - sub.minY);
              const bw = Math.max(1e-6, sub.maxX - sub.minX);
              drawSub(sub, x + bx - sub.minX * (w / bw), y + by - sub.minY * (h / bh), w / bw, h / bh);
            }
          } else {
            const sub = nativeGlyph(font, n, stack);
            drawSub(sub, x, y, scale, scale);
            // 子形画完后笔要停在它的终点。不前进的话，一个字的各部分会叠在同一个点上。
            if (sub) { x += sub.endX * scale; y += sub.endY * scale; mark(x, y); }
          }
        }
        if (pen) cur = [x, y];
        break;
      }
      case 0x08: {
        const dx = s8(data[++i]), dy = s8(data[++i]);
        go(x + dx * scale, y + dy * scale);
        break;
      }
      case 0x09: {
        for (;;) {
          const dx = s8(data[++i]), dy = s8(data[++i]);
          if (dx === 0 && dy === 0) break;
          go(x + dx * scale, y + dy * scale);
        }
        break;
      }
      case 0x0a: {
        const radius = data[++i] * scale;
        const flag = s8(data[++i]);
        let count = flag & 7; if (count === 0) count = 8;
        const start = (flag & 0x70) >> 4;
        const cw = flag < 0 ? -1 : 1;
        const a0 = start * Math.PI / 4;
        const cx = x - Math.cos(a0) * radius, cy = y - Math.sin(a0) * radius;
        const sweep = cw * count * Math.PI / 4;
        const steps = Math.max(2, count * 3);
        for (let k = 1; k <= steps; k++) {
          const a = a0 + sweep * k / steps;
          go(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
        }
        break;
      }
      case 0x0b: {
        const so = data[++i], eo = data[++i], hr = data[++i], lr = data[++i];
        const flag = s8(data[++i]);
        const r = (hr * 255 + lr) * scale;
        const n1 = (flag & 0x70) >> 4;
        let n2 = flag & 7; if (n2 === 0) n2 = 8;
        if (eo) n2--;
        const sign = flag < 0 ? -1 : 1;
        let a0 = (Math.PI / 4) * n1;
        let a1 = a0 + sign * (Math.PI / 4) * n2;
        a0 += sign * (Math.PI / 4) * so / 256;
        a1 += sign * (Math.PI / 4) * eo / 256;
        const cx = x - Math.cos(a0) * r, cy = y - Math.sin(a0) * r;
        const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 12)));
        for (let k = 1; k <= steps; k++) {
          const a = a0 + (a1 - a0) * k / steps;
          go(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        break;
      }
      case 0x0c: {
        const dx = s8(data[++i]), dy = s8(data[++i]), bul = s8(data[++i]);
        const pts = bulgePts(x, y, x + dx * scale, y + dy * scale, bul);
        for (let k = 0; k < pts.length; k += 2) go(pts[k], pts[k + 1]);
        break;
      }
      case 0x0d: {
        for (;;) {
          const dx = s8(data[++i]), dy = s8(data[++i]);
          if (dx === 0 && dy === 0) break;
          const bul = s8(data[++i]);
          const pts = bulgePts(x, y, x + dx * scale, y + dy * scale, bul);
          for (let k = 0; k < pts.length; k += 2) go(pts[k], pts[k + 1]);
        }
        break;
      }
      case 0x0e:
        i = skipCommand(font, data, i + 1);
        break;
      default: break;
    }
  }
  flush();
  let minX = 0, minY = 0, maxX = 0, maxY = 0, any = false;
  for (const pl of lines) for (let k = 0; k < pl.length; k += 2) {
    const px = pl[k], py = pl[k + 1];
    if (!any) { minX = maxX = px; minY = maxY = py; any = true; }
    else { if (px < minX) minX = px; if (py < minY) minY = py; if (px > maxX) maxX = px; if (py > maxY) maxY = py; }
  }
  const endX = x > 0.5 ? x : (any ? maxX : font.baseUp * 0.5);
  return { lines, endX, endY: y, minX, minY, maxX, maxY, adv: Math.max(endX, 0) };
}

function nativeGlyph(font, code, stack) {
  if (!code || stack.has(code)) return null;
  const hit = font.cache.get(code);
  if (hit) return hit;
  const data = glyphBytes(font, code);
  if (!data) return null;
  stack.add(code);
  let g;
  try { g = interpret(font, data, stack); }
  finally { stack.delete(code); }
  font.cache.set(code, g);
  return g;
}

export function glyphOf(font, code) {
  if (!font || !code) return null;
  return nativeGlyph(font, code, new Set());
}

let GBK = null;
function gbkCode(ch) {
  if (!GBK) {
    GBK = new Map();
    const dec = new TextDecoder('gbk');
    for (let a = 0x81; a <= 0xfe; a++) for (let b = 0x40; b <= 0xfe; b++) {
      if (b === 0x7f) continue;
      const s = dec.decode(new Uint8Array([a, b]));
      if (s.length === 1 && s !== '\ufffd' && !GBK.has(s)) GBK.set(s, (a << 8) | b);
    }
  }
  return GBK.get(ch) || 0;
}

function pick(ch, shapes, big) {
  const cp = ch.codePointAt(0);
  if (cp < 128 && shapes) { const g = glyphOf(shapes, cp); if (g) return g; }
  if (big) {
    const gbk = gbkCode(ch);
    if (gbk) { const g = glyphOf(big, gbk); if (g) return g; }
    const g = glyphOf(big, cp); if (g) return g;
  }
  if (shapes) { const g = glyphOf(shapes, cp); if (g) return g; }
  return null;
}

const CJK = /[⺀-鿿豈-﫿]/;
// 返回字体单位下的折线（y 向上，基线为 0）。一个字都没有，或缺了汉字时返回 null，调用方改用系统字体。
// 汉字只比西文少一个时不能留在单线字里，否则说明文字会丢掉整段中文。
export function layoutShx(str, primary, big) {
  let shapes = primary && primary.type !== 'bigfont' ? primary : null;
  if (primary && primary.type === 'bigfont') big = big || primary;
  if (!shapes && !big) return null;
  const up = (big && big.baseUp) || (shapes && shapes.baseUp) || 8;
  const down = (big && big.baseDown) || (shapes && shapes.baseDown) || 0;
  const lines = [];
  let x = 0, hit = 0, miss = 0, cjkMiss = false;
  for (const ch of str) {
    if (ch === ' ' || ch === '\t') { x += up * 0.5; continue; }
    const g = pick(ch, shapes, big);
    if (!g) {
      miss++;
      if (CJK.test(ch)) cjkMiss = true;
      x += CJK.test(ch) ? up : up * 0.5;
      continue;
    }
    hit++;
    for (const pl of g.lines) {
      const out = new Array(pl.length);
      for (let k = 0; k < pl.length; k += 2) { out[k] = x + pl[k]; out[k + 1] = pl[k + 1]; }
      lines.push(out);
    }
    const step = Math.max(g.adv, g.maxX);
    x += step > 0 ? step : up * 0.5;
  }
  if (!hit || cjkMiss || miss > hit) return null;
  return { lines, width: x, up, down };
}
