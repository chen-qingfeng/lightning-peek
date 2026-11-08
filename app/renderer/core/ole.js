// 闪电看图 · OLE 对象（OLE2FRAME）解析
// DWG 里的 OLE 对象 = 0x80 字节 Autodesk 头 + 一个 OLE 复合文件（CFB）。
// 复合文件里的 "\x02OlePres000" 流是 Windows 保存的预览图（通常是 WMF 图元文件），
// "Package" 流是原始文档（Excel 表格就是一个 xlsx）。这里把 WMF 转成简单的绘图指令。

const CFB_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function findSig(b) {
  outer: for (let i = 0; i + 8 <= Math.min(b.length, 4096); i++) {
    for (let j = 0; j < 8; j++) if (b[i + j] !== CFB_SIG[j]) continue outer;
    return i;
  }
  return -1;
}

// 读取复合文件里的全部流：返回 Map(名称 → Uint8Array)
export function readCfb(all) {
  const at = findSig(all); if (at < 0) return null;
  const b = all.subarray(at);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u32 = o => dv.getUint32(o, true);
  const secShift = dv.getUint16(30, true), miniShift = dv.getUint16(32, true);
  const SS = 1 << secShift, MS = 1 << miniShift;
  if (SS < 128 || SS > 65536 || MS > SS) return null;
  const maxSec = Math.ceil(b.length / SS);
  // 所有数量都不能超过文件本身能容纳的扇区数，防止损坏的文件让程序卡死或耗尽内存
  const nFat = Math.min(u32(44), maxSec), dirStart = u32(48), miniCut = u32(56), miniFatStart = u32(60), nMiniFat = Math.min(u32(64), maxSec), difStart = u32(68), nDif = Math.min(u32(72), maxSec);
  const sec = s => (s + 1) * SS;
  const okSec = s => s < 0xfffffffa && sec(s) < b.length;
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(u32(76 + i * 4));
  let d = difStart;
  for (let k = 0; k < nDif && fatSecs.length < nFat && okSec(d); k++) {
    const o = sec(d); const per = SS / 4 - 1; if (o + SS > b.length) break;
    for (let i = 0; i < per && fatSecs.length < nFat; i++) fatSecs.push(u32(o + i * 4));
    d = u32(o + per * 4);
  }
  const fat = [];
  for (const s of fatSecs) { if (!okSec(s)) continue; const o = sec(s); for (let i = 0; i < SS / 4; i++) fat.push(o + i * 4 + 4 <= b.length ? u32(o + i * 4) : 0xfffffffe); }
  const chain = (start, table, limit) => { const r = []; const seen = new Set(); let s = start; while (s !== undefined && s < 0xfffffffa && r.length < limit && !seen.has(s)) { seen.add(s); r.push(s); s = table[s]; } return r; };
  const readChain = (start, size) => {
    size = Math.max(0, Math.min(size, b.length));
    const out = new Uint8Array(size); let p = 0;
    for (const s of chain(start, fat, (size >> secShift) + 2)) { const o = sec(s); const n = Math.min(SS, size - p, b.length - o); if (n <= 0 || o < 0) break; out.set(b.subarray(o, o + n), p); p += n; }
    return out;
  };
  // 目录
  const dirSecs = chain(dirStart, fat, Math.min(10000, maxSec)).filter(okSec);
  const dirBytes = new Uint8Array(dirSecs.length * SS);
  dirSecs.forEach((s, i) => dirBytes.set(b.subarray(sec(s), sec(s) + SS), i * SS));
  const dd = new DataView(dirBytes.buffer);
  const ents = [];
  for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
    const nl = dd.getUint16(o + 64, true); const type = dirBytes[o + 66];
    let name = ''; for (let i = 0; i + 2 <= nl - 2; i += 2) name += String.fromCharCode(dd.getUint16(o + i, true));
    ents.push({ name, type, start: dd.getUint32(o + 116, true), size: dd.getUint32(o + 120, true) });
  }
  const root = ents.find(e => e.type === 5);
  let mini = null, miniFat = null;
  if (root && root.size) mini = readChain(root.start, root.size);
  if (nMiniFat) { const mf = readChain(miniFatStart, nMiniFat * SS); miniFat = new Uint32Array(mf.buffer, 0, mf.length >> 2); }
  const streams = new Map();
  for (const e of ents) {
    if (e.type !== 2) continue;
    if (e.size < miniCut && mini && miniFat) {
      const size = Math.min(e.size, mini.length); const out = new Uint8Array(size); let p = 0;
      for (const s of chain(e.start, miniFat, (size >> miniShift) + 2)) { if (s * MS >= mini.length) break; const n = Math.min(MS, size - p, mini.length - s * MS); out.set(mini.subarray(s * MS, s * MS + n), p); p += n; if (p >= size) break; }
      streams.set(e.name, out);
    } else streams.set(e.name, readChain(e.start, e.size));
  }
  return streams;
}

// OlePres 流：格式头之后是图元数据。返回 { kind: 'wmf'|'emf'|'dib', data }
export function presentation(streams) {
  const names = [...streams.keys()].filter(n => /OlePres\d+$/.test(n)).sort();
  for (const n of names) {
    const p = streams.get(n); if (p.length < 40) continue;
    const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
    let o = 0; let fmt = 0;
    const tag = dv.getInt32(0, true);
    if (tag === -1 || tag === -2) { fmt = dv.getUint32(4, true); o = 8; }
    else if (tag > 0) { o = 4 + tag; } // 命名的剪贴板格式
    else o = 4;
    const tdSize = dv.getUint32(o, true); o += Math.max(4, tdSize);
    o += 4 + 4 + 4 + 4; // aspect, lindex, advf, reserved
    const width = dv.getUint32(o, true), height = dv.getUint32(o + 4, true), size = dv.getUint32(o + 8, true); o += 12;
    const data = p.subarray(o, Math.min(p.length, o + size));
    if (data.length < 18) continue;
    const kind = (data[0] === 1 && data[1] === 0 && data[2] === 9 && data[3] === 0) || (data[0] === 0xd7 && data[1] === 0xcd) ? 'wmf'
      : (data[0] === 1 && data[1] === 0 && data[2] === 0 && data[3] === 0 && data[40] === 0x20 && data[41] === 0x45) ? 'emf'
        : fmt === 8 || fmt === 2 ? 'dib' : 'wmf';
    return { kind, data, width, height, fmt };
  }
  return null;
}

const CHARSET_ENC = { 0: 'windows-1252', 128: 'shift_jis', 129: 'euc-kr', 134: 'gbk', 136: 'big5', 161: 'windows-1253', 162: 'windows-1254', 177: 'windows-1255', 178: 'windows-1256', 186: 'windows-1257', 204: 'windows-1251', 222: 'windows-874', 238: 'windows-1250' };
const decoders = new Map();
function decodeStr(bytes, charset, fallback) {
  // 0（ANSI）和 1（默认）按系统代码页处理，中文 Windows 即 GBK
  const enc = (charset > 1 && CHARSET_ENC[charset]) || fallback || 'gbk';
  let d = decoders.get(enc);
  if (!d) { try { d = new TextDecoder(enc); } catch (e) { d = new TextDecoder('latin1'); } decoders.set(enc, d); }
  return d.decode(bytes);
}
const rgb = v => ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);

// DIB（BITMAPINFOHEADER + 像素）→ { w, h, rgba }
function decodeDib(b) {
  if (b.length < 40) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const hs = dv.getUint32(0, true); if (hs < 12) return null;
  let w, h, bpp, comp = 0, used = 0;
  if (hs === 12) { w = dv.getUint16(4, true); h = dv.getInt16(6, true); bpp = dv.getUint16(10, true); }
  else { w = dv.getInt32(4, true); h = dv.getInt32(8, true); bpp = dv.getUint16(14, true); comp = dv.getUint32(16, true); used = dv.getUint32(32, true); }
  if (comp !== 0 && comp !== 3) return null;
  const top = h < 0; h = Math.abs(h);
  if (!(w > 0) || !h || w * h > 16e6 || ![1, 4, 8, 16, 24, 32].includes(bpp)) return null;
  const nPal = bpp <= 8 ? Math.min(used || (1 << bpp), 1 << bpp) : 0;
  const palOff = hs + (comp === 3 && hs === 40 ? 12 : 0); const pe = hs === 12 ? 3 : 4;
  const pal = []; for (let i = 0; i < nPal; i++) { const o = palOff + i * pe; pal.push([b[o + 2], b[o + 1], b[o]]); }
  if (palOff + nPal * pe > b.length) return null;
  const px = palOff + nPal * pe; const stride = ((w * bpp + 31) >> 5) << 2;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = px + (top ? y : h - 1 - y) * stride; if (row + stride > b.length) break;
    for (let x = 0; x < w; x++) {
      let r, g, bl; const o = (y * w + x) * 4;
      if (bpp === 24) { const q = row + x * 3; bl = b[q]; g = b[q + 1]; r = b[q + 2]; }
      else if (bpp === 32) { const q = row + x * 4; bl = b[q]; g = b[q + 1]; r = b[q + 2]; }
      else if (bpp === 16) { const v = b[row + x * 2] | (b[row + x * 2 + 1] << 8); r = ((v >> 10) & 31) << 3; g = ((v >> 5) & 31) << 3; bl = (v & 31) << 3; }
      else { const bit = x * bpp; const v = (b[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1); const c = pal[v] || [0, 0, 0]; r = c[0]; g = c[1]; bl = c[2]; }
      out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = 255;
    }
  }
  return { w, h, rgba: out };
}

// 交集为空时统一成 0 面积矩形（负宽度的矩形在 canvas 里仍会裁出一块区域）
function emptyFix(c) { return c[2] <= c[0] || c[3] <= c[1] ? [c[0], c[1], c[0], c[1]] : c; }

// WMF → { win:[x0,y0,w,h], ops:[...] }，坐标为 WMF 逻辑坐标（y 向下）
// 指令：{ t:'L', p:[x,y,...], c, w }  折线；{ t:'F', p:[...], c } 填充多边形；
//       { t:'T', x, y, s, h, c, al, wd, esc, bold, ital, face, adv }  文字；{ t:'I', x, y, w, h, img } 位图
//       每条指令带 clip:[x0,y0,x1,y1] 或 null
export function parseWmf(w, opts = {}) {
  const dv = new DataView(w.buffer, w.byteOffset, w.byteLength);
  let o = 0; let bounds = null;
  if (dv.getUint32(0, true) === 0x9ac6cdd7) { // 可放置头
    bounds = [dv.getInt16(6, true), dv.getInt16(8, true), dv.getInt16(10, true), dv.getInt16(12, true)];
    o = 22;
  }
  const hdrWords = dv.getUint16(o + 2, true); const nObj = dv.getUint16(o + 10, true);
  o += hdrWords * 2;
  const objs = new Array(Math.max(nObj, 1)).fill(null);
  const ops = [];
  let st = { pen: { c: 0, w: 0, none: false }, brush: { c: 0xffffff, none: false }, font: { h: 12, esc: 0, bold: false, ital: false, cs: 1, face: '' }, tc: 0, bk: 0xffffff, bkMode: 2, align: 0, clip: null, cx: 0, cy: 0, win: [0, 0, 1, 1], hasWin: false };
  const stack = [];
  let lineRun = null; // 合并连续的 MoveTo/LineTo
  const flush = () => { if (lineRun && lineRun.p.length >= 4) ops.push(lineRun); lineRun = null; };
  const s16 = (k) => dv.getInt16(p + k * 2, true);
  let p = 0;
  const addObj = (obj) => { const i = objs.indexOf(null); if (i >= 0) objs[i] = obj; else objs.push(obj); };
  let guard = 0;
  try {
  while (o + 6 <= w.length && guard++ < 2e6) {
    const size = dv.getUint32(o, true), fn = dv.getUint16(o + 4, true);
    if (size < 3) break;
    p = o + 6; const end = Math.min(w.length, o + size * 2);
    const n = (end - p) >> 1;
    switch (fn) {
      case 0x0000: o = w.length; continue;
      case 0x020B: st.win = [s16(1), s16(0), st.win[2], st.win[3]]; st.hasWin = true; break;
      case 0x020C: st.win = [st.win[0], st.win[1], s16(1), s16(0)]; st.hasWin = true; break;
      case 0x02FA: addObj({ k: 'pen', none: (dv.getUint16(p, true) & 15) === 5, w: s16(1), c: rgb(dv.getUint32(p + 6, true)) }); break;
      case 0x02FC: addObj({ k: 'brush', none: dv.getUint16(p, true) === 1, c: rgb(dv.getUint32(p + 2, true)) }); break;
      case 0x02FB: {
        let face = ''; for (let i = 18; i < 50 && p + i < end; i++) { const c = w[p + i]; if (!c) break; face += String.fromCharCode(c); }
        const cs = w[p + 13];
        if (/[\x80-\xff]/.test(face)) face = decodeStr(Uint8Array.from(face, c => c.charCodeAt(0)), cs, opts.enc);
        addObj({ k: 'font', h: s16(0), esc: s16(2), bold: s16(4) >= 600, ital: !!w[p + 10], cs, face });
        break;
      }
      case 0x06FF: case 0x0142: case 0x01F9: case 0x00F7: addObj({ k: 'other' }); break; // 区域、调色板、DIB 画刷等
      case 0x012D: { const ob = objs[dv.getUint16(p, true)]; if (ob) { if (ob.k === 'pen') st.pen = ob; else if (ob.k === 'brush') st.brush = ob; else if (ob.k === 'font') st.font = ob; } break; }
      case 0x01F0: { const i = dv.getUint16(p, true); if (i < objs.length) objs[i] = null; break; }
      case 0x0209: st.tc = rgb(dv.getUint32(p, true)); break;
      case 0x0201: st.bk = rgb(dv.getUint32(p, true)); break;
      case 0x0102: st.bkMode = s16(0); break;
      case 0x012E: st.align = dv.getUint16(p, true); break;
      case 0x001E: stack.push({ ...st }); break;
      case 0x0127: { flush(); let k = s16(0); if (k > 0) k = k - stack.length - 1; if (k >= 0) k = -1; let s = null; while (k++ < 0 && stack.length) s = stack.pop(); if (s) st = { ...s }; break; }
      case 0x0416: { flush(); const r = [s16(3), s16(2), s16(1), s16(0)]; st.clip = emptyFix(st.clip ? [Math.max(st.clip[0], r[0]), Math.max(st.clip[1], r[1]), Math.min(st.clip[2], r[2]), Math.min(st.clip[3], r[3])] : r); break; }
      case 0x012C: flush(); st.clip = null; break;
      case 0x0214: flush(); st.cx = s16(1); st.cy = s16(0); break;
      case 0x0213: {
        const x = s16(1), y = s16(0);
        if (!st.pen.none) {
          if (!lineRun || lineRun.c !== st.pen.c || lineRun.w !== st.pen.w || lineRun.clip !== st.clip || lineRun.p[lineRun.p.length - 2] !== st.cx || lineRun.p[lineRun.p.length - 1] !== st.cy) { flush(); lineRun = { t: 'L', p: [st.cx, st.cy], c: st.pen.c, w: st.pen.w, clip: st.clip }; }
          lineRun.p.push(x, y);
        }
        st.cx = x; st.cy = y; break;
      }
      case 0x0325: case 0x0324: {
        flush(); const cnt = s16(0); const pts = []; for (let i = 0; i < cnt && 1 + i * 2 + 1 < n; i++) pts.push(s16(1 + i * 2), s16(2 + i * 2));
        if (fn === 0x0324 && !st.brush.none) ops.push({ t: 'F', p: pts, c: st.brush.c, clip: st.clip });
        if (!st.pen.none) { if (fn === 0x0324) pts.push(pts[0], pts[1]); ops.push({ t: 'L', p: pts, c: st.pen.c, w: st.pen.w, clip: st.clip }); }
        break;
      }
      case 0x0538: { // PolyPolygon
        flush(); const np = s16(0); let q = 1 + np; const rings = [];
        for (let k = 0; k < np; k++) { const cnt = s16(1 + k); const pts = []; for (let i = 0; i < cnt; i++) { pts.push(s16(q), s16(q + 1)); q += 2; } rings.push(pts); }
        for (const pts of rings) {
          if (!st.brush.none) ops.push({ t: 'F', p: pts, c: st.brush.c, clip: st.clip });
          if (!st.pen.none) ops.push({ t: 'L', p: [...pts, pts[0], pts[1]], c: st.pen.c, w: st.pen.w, clip: st.clip });
        }
        break;
      }
      case 0x041B: {
        flush(); const b = s16(0), r = s16(1), t = s16(2), l = s16(3); const pts = [l, t, r, t, r, b, l, b];
        if (!st.brush.none) ops.push({ t: 'F', p: pts, c: st.brush.c, clip: st.clip });
        if (!st.pen.none) ops.push({ t: 'L', p: [...pts, l, t], c: st.pen.c, w: st.pen.w, clip: st.clip });
        break;
      }
      case 0x061D: case 0x0940: case 0x0B41: case 0x0F43: case 0x0922: case 0x0B23: {
        // PatBlt / DIBBitBlt / DIBStretchBlt / StretchDIBits / BitBlt / StretchBlt
        flush();
        const rop = dv.getUint32(p, true);
        let x, y, ww, hh, dib = null;
        if (fn === 0x061D) { hh = s16(2); ww = s16(3); y = s16(4); x = s16(5); }
        else if (fn === 0x0940) {
          if (size === 12) { hh = s16(5); ww = s16(6); y = s16(7); x = s16(8); }
          else { hh = s16(4); ww = s16(5); y = s16(6); x = s16(7); dib = w.subarray(p + 16, end); }
        } else if (fn === 0x0B41) {
          if (size === 14) { hh = s16(7); ww = s16(8); y = s16(9); x = s16(10); }
          else { hh = s16(6); ww = s16(7); y = s16(8); x = s16(9); dib = w.subarray(p + 20, end); }
        } else if (fn === 0x0F43) { hh = s16(7); ww = s16(8); y = s16(9); x = s16(10); dib = w.subarray(p + 22, end); }
        else break;
        if (dib && dib.length > 40 && (rop === 0x00CC0020 || rop === 0x00C000CA || rop === 0x008800C6 || rop === 0x00EE0086)) {
          const img = decodeDib(dib); if (img) ops.push({ t: 'I', x, y, w: ww, h: hh, img, clip: st.clip });
        } else if (rop === 0x00F00021 || rop === 0x00000042 || rop === 0x00FF0062) {
          const c = rop === 0x00000042 ? 0 : rop === 0x00FF0062 ? 0xffffff : st.brush.c;
          if (rop !== 0x00F00021 || !st.brush.none) ops.push({ t: 'F', p: [x, y, x + ww, y, x + ww, y + hh, x, y + hh], c, clip: st.clip });
        }
        break;
      }
      case 0x0A32: case 0x0521: {
        flush();
        let x, y, cnt, opt = 0, rect = null, sOff, dx = null;
        if (fn === 0x0A32) {
          y = s16(0); x = s16(1); cnt = s16(2); opt = dv.getUint16(p + 6, true); sOff = p + 8;
          if (opt & 6) { rect = [s16(4), s16(5), s16(6), s16(7)]; sOff += 8; }
          const dxOff = sOff + cnt + (cnt & 1);
          if (dxOff + cnt * 2 <= end) { dx = []; for (let i = 0; i < cnt; i++) dx.push(dv.getInt16(dxOff + i * 2, true)); }
        } else { cnt = s16(0); sOff = p + 2; const q = sOff + cnt + (cnt & 1); y = dv.getInt16(q, true); x = dv.getInt16(q + 2, true); }
        if (st.align & 1) { x = st.cx; y = st.cy; }
        if (rect && (opt & 2)) ops.push({ t: 'F', p: [rect[0], rect[1], rect[2], rect[1], rect[2], rect[3], rect[0], rect[3]], c: st.bk, clip: st.clip });
        if (cnt <= 0) break;
        const raw = w.subarray(sOff, Math.min(end, sOff + cnt));
        const s = decodeStr(raw, st.font.cs, opts.enc).replace(/\0+$/, '');
        if (!s.trim()) break;
        // dx 是逐字节的步进；多字节字符的第二个字节步进为 0 或计入前一个
        let adv = 0; if (dx) for (const v of dx) adv += v;
        let clip = st.clip;
        if (rect && (opt & 4)) clip = emptyFix(clip ? [Math.max(clip[0], rect[0]), Math.max(clip[1], rect[1]), Math.min(clip[2], rect[2]), Math.min(clip[3], rect[3])] : rect);
        ops.push({ t: 'T', x, y, s, h: st.font.h, c: st.tc, al: st.align, esc: st.font.esc / 10, bold: st.font.bold, ital: st.font.ital, face: st.font.face, adv, clip });
        if (st.align & 1) st.cx += adv;
        break;
      }
      default: break;
    }
    o += size * 2;
  }
  } catch (e) { /* 记录损坏：保留已经读到的内容 */ }
  flush();
  let win = st.hasWin && st.win[2] && st.win[3] ? [st.win[0], st.win[1], st.win[2], st.win[3]] : null;
  if (!win && bounds) win = [bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1]];
  if (!win) { // 用内容范围
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const op of ops) { const pts = op.p || [op.x, op.y]; for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); } }
    win = Number.isFinite(x0) ? [x0, y0, x1 - x0 || 1, y1 - y0 || 1] : [0, 0, 1, 1];
  }
  return { win, ops };
}

// 嵌入的 Office 文档是 zip：按包内文件名判断是 Excel、Word 还是 PowerPoint
function zipKind(z) {
  const s = new TextDecoder('latin1').decode(z.subarray(0, Math.min(z.length, 1 << 20)));
  if (s.includes('xl/workbook')) return 'xlsx';
  if (s.includes('word/document')) return 'docx';
  if (s.includes('ppt/presentation')) return 'pptx';
  return 'zip';
}

// 解析一个 OLE2FRAME 的数据块
export function parseOleFrame(data, opts = {}) {
  try { return parseOleInner(data, opts); } catch (e) { return { error: String(e && e.message || e) }; }
}
function parseOleInner(data, opts) {
  const streams = readCfb(data);
  if (!streams) return { error: 'nocfb' };
  const pres = presentation(streams);
  let progId = '';
  const co = streams.get('\x01CompObj');
  if (co) { const s = new TextDecoder('latin1').decode(co); const m = s.match(/(Excel|Word|PowerPoint|Visio|Paint|Package|Acrobat|WPS|ET|Equation)[\w. ]*/i); progId = m ? m[0] : ''; }
  const key = [...streams.keys()].find(k => /^(package|contents)$/i.test(k));
  const pkg = key ? streams.get(key) : null;
  const pkgType = pkg && pkg[0] === 0x50 && pkg[1] === 0x4b ? zipKind(pkg) : '';
  let pic = null;
  if (pres && pres.kind === 'wmf') pic = parseWmf(pres.data, opts);
  else if (pres && pres.kind === 'dib') { const img = decodeDib(pres.data); if (img) pic = { win: [0, 0, img.w, img.h], ops: [{ t: 'I', x: 0, y: 0, w: img.w, h: img.h, img, clip: null }] }; }
  return { pic, progId, pkg: pkgType ? pkg : null, pkgType, presKind: pres ? pres.kind : '' };
}
