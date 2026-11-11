// 闪电看图 · 后台解析线程
import { parseDxf, buildScene, decodeDxf, encodeLegacy, SigSink, OP, makeRec, ansiOf } from './engine.js';
import { tchBuild, tchMarkup, orientTch, tchUnsupported } from './tarch.js';
import { serial } from './serial.js';
import { injectedPoints, lostCount } from './lost.js';
import { convertDwg } from './dwgconv.js';

// 每张 DWG 在一个新的读图线程里转换，读完就关掉线程。
// 以前在同一个线程里每张图换一个新的读图模块：旧模块每个至少占 1GB，回收不及时，
// 连开三四张大图后内存不够，后面的图卡在「正在转换」或报出误导的错误。
const LIB = new URL('../lib/libredwg-web.wasm', import.meta.url).href;
const JOB_MS = 5 * 60 * 1000;
let compiled = null;
function wasmModule() {
  if (!compiled) compiled = (async () => {
    const res = await fetch(LIB);
    return WebAssembly.compileStreaming ? WebAssembly.compileStreaming(res) : WebAssembly.compile(await res.arrayBuffer());
  })().catch(() => (compiled = null));
  return compiled;
}
function runJob(bytes, module) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('./dwgjob.js', import.meta.url), { type: 'module' }); } catch (e) { reject(Object.assign(e, { noWorker: true })); return; }
    const done = (fn, v) => { clearTimeout(timer); w.terminate(); fn(v); };
    const timer = setTimeout(() => done(reject, new Error('转换超时，这张图纸可能太大或已损坏。可以在 CAD 软件里另存为 DXF 后再试')), JOB_MS);
    w.onmessage = (e) => {
      const m = e.data;
      if (m.ok) done(resolve, m.r);
      else done(reject, Object.assign(new Error(m.error), { code: m.code, trap: m.trap }));
    };
    w.onerror = (e) => { e.preventDefault && e.preventDefault(); done(reject, Object.assign(new Error('读图线程出错：' + (e.message || '')), { trap: true })); };
    w.onmessageerror = () => done(reject, Object.assign(new Error('读图线程出错'), { trap: true }));
    const copy = bytes.slice();
    w.postMessage({ bytes: copy.buffer, module }, [copy.buffer]);
  });
}
// 没有子线程可用（个别浏览器）时，退回在本线程里读：每张图都换一个新模块
let factory = null;
async function runHere(bytes) {
  if (!factory) factory = (await import('../lib/libredwg-web.js')).default;
  const m = await factory({ locateFile: (f) => new URL('../lib/' + f, import.meta.url).href });
  return convertDwg(m, bytes);
}
const canNest = typeof Worker !== 'undefined';
async function dwgToDxf(bytes) {
  if (!canNest) return runHere(bytes);
  const module = await wasmModule();
  try { return await runJob(bytes, module || null); }
  catch (e) {
    if (e.noWorker) return runHere(bytes);
    // 线程崩溃、wasm 越界或内存不够：换一个干净的线程再读一次
    if (!(e.trap || (e.code & 8192))) throw e;
    try { return await runJob(bytes, module || null); }
    catch (e2) {
      if (e2.trap) throw new Error('读图模块读这张图时出错（' + e2.message + '），可能含有暂不支持的对象。可以在 CAD 软件里另存为 DXF 后再试');
      throw e2;
    }
  }
}

const docs = new Map();
const dwgQueue = serial();

// 把 DXF 输出里丢失的对象作为记录放回解析后的图纸：模型空间 / 图纸空间 / 所在的块
function placer(doc) {
  const byHandle = new Map(); for (const [h, nm] of doc.blockRecords) byHandle.set(h, nm);
  // 哪些空间的图元写在 ENTITIES 段（当前布局和模型），其余布局的图元在 BLOCKS 段里
  const inEntities = new Set(); for (const r of doc.entities) { const h = r.s(330).toUpperCase(); if (h) inEntities.add(h); }
  return (type, pairs, mode, owner, extra) => {
    const bn = mode === 0 ? (byHandle.get(owner) || '') : '';
    if (mode === 1) { doc.entities.push(makeRec(type, [...pairs, [67, 1]], extra)); return; }
    if (!bn || mode === 2) { doc.entities.push(makeRec(type, pairs, extra)); return; }
    const b = doc.blocks.get(bn.toUpperCase());
    const isSpace = /^\*(MODEL|PAPER)_SPACE/i.test(bn);
    if (isSpace && inEntities.has(owner)) { doc.entities.push(makeRec(type, [...pairs, [330, owner]], extra)); return; }
    if (b) { b.ents.push(makeRec(type, pairs, extra)); return; }
    if (isSpace) doc.entities.push(makeRec(type, [...pairs, [330, owner]], extra));
  };
}
function injectOles(doc, oles) {
  if (!oles || !oles.length) return;
  const place = placer(doc);
  // 有的版本 DXF 输出里已经带了 OLE2FRAME：按角点去重；DXF 里那条没有数据时把数据补给它
  const key = (x, y) => Math.round(x * 1000) + ',' + Math.round(y * 1000);
  const have = new Map();
  const scan = ents => { for (const r of ents) if (r.type === 'OLE2FRAME') have.set(key(r.f(10), r.f(20)), r); };
  scan(doc.entities); for (const b of doc.blocks.values()) scan(b.ents);
  for (const o of oles) {
    const old = have.get(key(o.p1[0], o.p1[1]));
    if (old) { if (!old.has(310)) old._ole = o.data; continue; }
    const pairs = [[8, doc.layerHandles.get(o.layer) || '0'], [10, o.p1[0]], [20, o.p1[1]], [11, o.p2[0]], [21, o.p2[1]]];
    place('OLE2FRAME', pairs, o.mode, o.owner, { _ole: o.data, _lost: o });
  }
}
// 天正对象：读出的文字和它们自带的线框转成普通 TEXT / MTEXT / LINE / CIRCLE。
// 墙、柱、楼梯等只有图形的天正对象仍然无法显示，记入"暂不显示"
function injectTch(doc, tch) {
  if (!tch) return 0;
  orientTch(doc, tch);
  const place = placer(doc);
  let td = null; try { td = new TextDecoder(ansiOf(doc)); } catch (e) { td = new TextDecoder('gbk'); }
  const dec = u => tchMarkup(td.decode(u));
  let n = 0;
  for (const it of tch.items) {
    let recs = [];
    try { recs = tchBuild(it.f, dec); } catch (e) { recs = []; }
    if (!recs.length) continue;
    const lay = doc.layerHandles.get(it.layer) || '0';
    const st = it.style && doc.styleHandles.get(it.style);
    for (const { type, pairs } of recs) {
      pairs.unshift([8, lay], [62, it.color]);
      if (st && (type === 'TEXT' || type === 'MTEXT')) pairs.push([7, st]);
      place(type, pairs, it.mode, it.owner, { _tch: it.f.kind, _tchBundled: it.f.rotFrom === 'stream' || !!it.f.landingText, _lost: it });
    }
    n++;
  }
  return n;
}
function tchSkipped(tch) { return tchUnsupported(tch); }

function collect(scene, list = []) {
  for (const s of scene.spaces) {
    for (const b of s.batches) list.push(b.ops.buffer);
    for (const f of s.fills) for (const r of f.rings) list.push(r.buffer);
    list.push(s.snaps.buffer, s.circles.buffer, s.segs.buffer);
    if (s.cpts) list.push(s.cpts.buffer, s.cvf.buffer, s.cinfo.buffer);
    for (const g of s.regions) for (const r of g.rings) list.push(r.buffer);
  }
  return list;
}

async function open(id, name, bytes) {
  const t0 = performance.now();
  const lower = name.toLowerCase();
  let dxfBytes = bytes, warn = 0, version = '', oles = null, tch = null;
  const magic = new TextDecoder('latin1').decode(bytes.subarray(0, 6));
  if (lower.endsWith('.dwg') || /^AC10\d\d/.test(magic)) {
    post({ id, progress: '正在转换 DWG…' });
    // 一张一张读，同一时间只有一个读图线程占内存
    const r = await dwgQueue(() => dwgToDxf(bytes));
    dxfBytes = r.bytes; warn = r.warn; version = magic; oles = r.oles; tch = r.tch;
  } else {
    if (new TextDecoder('latin1').decode(bytes.subarray(0, 22)).startsWith('AutoCAD Binary DXF')) throw new Error('暂不支持二进制 DXF。请在 CAD 软件里另存为文本格式（ASCII）的 DXF');
  }
  post({ id, progress: '正在解析图元…' });
  const decoded = decodeDxf(dxfBytes);
  const text = decoded.text, enc = decoded.enc, codepageDeclared = !!decoded.codepageDeclared;
  const doc = parseDxf(text);
  injectOles(doc, oles);
  const tchTexts = injectTch(doc, tch);
  if (!version) { const v = doc.header.$ACADVER; version = v && v[0] ? v[0][1] : 'DXF'; }
  const t1 = performance.now();
  const scene = buildScene(doc, { codepageDeclared });
  for (const [k, v] of Object.entries(tchSkipped(tch))) scene.stats.skipped[k] = v;
  const t2 = performance.now();
  docs.set(id, { bytes: dxfBytes.slice(), enc, codepageDeclared, warn, oles, tch, injected: injectedPoints(doc) });
  scene.info = { version: verName(version), convertMs: Math.round(t1 - t0), buildMs: Math.round(t2 - t1), warn, tchTexts };
  return scene;
}
function textOf(D) { return decodeDxf(D.bytes).text; }
function docOf(id) {
  const D = docs.get(id);
  if (!D) return null;
  if (!D.doc) { D.doc = parseDxf(textOf(D)); injectOles(D.doc, D.oles); injectTch(D.doc, D.tch); }
  return D.doc;
}
function verName(v) {
  const m = { AC1009: 'R12', AC1012: 'R13', AC1014: 'R14', AC1015: '2000', AC1018: '2004', AC1021: '2007', AC1024: '2010', AC1027: '2013', AC1032: '2018' };
  return m[v] ? 'AutoCAD ' + m[v] : v;
}

function modelTexts(doc, origin, codepageDeclared) {
  const opt = { codepageDeclared: !!codepageDeclared };
  if (origin) opt.origin = origin;
  const sc = buildScene(doc, opt);
  const sp = sc.spaces[0];
  return { sp, origin: sc.origin };
}
// 自动对齐：用两图里各只出现一次的相同文字，求出最常见的整体位移
function autoAlign(A, B, cpA, cpB) {
  const a = modelTexts(A, null, cpA), b = modelTexts(B, null, cpB);
  const ua = new Map(), ub = new Map();
  const uniq = (sp, o, m) => { const c = new Map(); for (const t of sp.texts) c.set(t.s, (c.get(t.s) || 0) + 1); for (const t of sp.texts) if (c.get(t.s) === 1 && t.s.length >= 2) m.set(t.s, [t.x + o[0], t.y + o[1]]); };
  uniq(a.sp, a.origin, ua); uniq(b.sp, b.origin, ub);
  const size = Math.max(b.sp.bbox[2] - b.sp.bbox[0], b.sp.bbox[3] - b.sp.bbox[1], 1);
  const q = size * 1e-5; const votes = new Map();
  for (const [s, pa] of ua) { const pb = ub.get(s); if (!pb) continue; const k = Math.round((pb[0] - pa[0]) / q) + ',' + Math.round((pb[1] - pa[1]) / q); const v = votes.get(k) || { n: 0, d: [pb[0] - pa[0], pb[1] - pa[1]] }; v.n++; votes.set(k, v); }
  let best = null; for (const v of votes.values()) if (!best || v.n > best.n) best = v;
  if (!best || best.n < 3) return { d: [0, 0], n: best ? best.n : 0 };
  return best;
}
function compare(aId, bId, opts = {}) {
  const DA = docs.get(aId), DB = docs.get(bId);
  const A = docOf(aId), B = docOf(bId);
  if (!A || !B) throw new Error('对比的图纸已关闭');
  const cpA = !!(DA && DA.codepageDeclared), cpB = !!(DB && DB.codepageDeclared);
  const pre = buildScene(B, { codepageDeclared: cpB, sinkFactory: () => new SigSink(1) });
  const mb = pre.spaces[0];
  const size = Math.max(mb.bbox[2] - mb.bbox[0], mb.bbox[3] - mb.bbox[1], 1);
  const q = opts.tol > 0 ? opts.tol : size * 2e-6;
  const origin = pre.origin;
  let shift = [0, 0], alignVotes = 0;
  if (opts.align !== false) { const al = autoAlign(A, B, cpA, cpB); shift = al.d; alignVotes = al.n; }
  const sinkA = new SigSink(q), sinkB = new SigSink(q);
  buildScene(A, { codepageDeclared: cpA, origin: [origin[0] - shift[0], origin[1] - shift[1]], sinkFactory: sp => (sp.key === '*MODEL_SPACE' ? sinkA : new SigSink(q)) });
  buildScene(B, { codepageDeclared: cpB, origin, sinkFactory: sp => (sp.key === '*MODEL_SPACE' ? sinkB : new SigSink(q)) });
  const count = (items) => { const m = new Map(); for (const it of items) m.set(it.sig, (m.get(it.sig) || 0) + 1); return m; };
  const keyA = count(sinkA.items), keyB = count(sinkB.items);
  const same = [], add = [], del = [];
  const used = new Map();
  for (const it of sinkB.items) { const n = keyA.get(it.sig) || 0, u = used.get(it.sig) || 0; if (u < n) { used.set(it.sig, u + 1); same.push(it); } else add.push(it); }
  const usedA = new Map();
  for (const it of sinkA.items) { const n = keyB.get(it.sig) || 0, u = usedA.get(it.sig) || 0; if (u < n) usedA.set(it.sig, u + 1); else del.push(it); }
  // 文字修改：位置几乎相同但内容变了
  const mod = [], modOld = [], textPairs = [];
  const addTexts = add.filter(i => i.k === 'text');
  const grid = new Map(); const cell = Math.max(q * 50, size / 2000);
  for (const it of addTexts) { const k = Math.floor(it.p[0] / cell) + ',' + Math.floor(it.p[1] / cell); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(it); }
  const takenAdd = new Set(), takenDel = new Set();
  for (const it of del) {
    if (it.k !== 'text') continue;
    const tol = Math.max(it.it.h * 0.6, q * 5);
    const gx = Math.floor(it.p[0] / cell), gy = Math.floor(it.p[1] / cell);
    let best = null, bd = tol;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const c of grid.get((gx + i) + ',' + (gy + j)) || []) { if (takenAdd.has(c)) continue; const dd = Math.hypot(c.p[0] - it.p[0], c.p[1] - it.p[1]); if (dd < bd) { bd = dd; best = c; } }
    if (best) { takenAdd.add(best); takenDel.add(it); mod.push(best); modOld.push(it); textPairs.push({ o: it.it.s, n: best.it.s, p: best.p, layer: best.layer }); }
  }
  const add2 = add.filter(i => !takenAdd.has(i)), del2 = del.filter(i => !takenDel.has(i));
  // 差异分组
  const ccell = size / 50;
  const groups = new Map();
  const put = (it, kind) => {
    const k = Math.floor(it.p[0] / ccell) + ',' + Math.floor(it.p[1] / ccell);
    let g = groups.get(k); if (!g) { g = { bb: [Infinity, Infinity, -Infinity, -Infinity], del: 0, add: 0, mod: 0, layers: new Set(), kinds: new Set(), texts: [] }; groups.set(k, g); }
    const bb = itemBox(it); g.bb[0] = Math.min(g.bb[0], bb[0]); g.bb[1] = Math.min(g.bb[1], bb[1]); g.bb[2] = Math.max(g.bb[2], bb[2]); g.bb[3] = Math.max(g.bb[3], bb[3]);
    g[kind]++; g.layers.add(it.layer); g.kinds.add(it.k);
  };
  for (const it of del2) put(it, 'del'); for (const it of add2) put(it, 'add'); for (const it of mod) put(it, 'mod');
  for (const tp of textPairs) { const k = Math.floor(tp.p[0] / ccell) + ',' + Math.floor(tp.p[1] / ccell); const g = groups.get(k); if (g && g.texts.length < 20) g.texts.push([tp.o, tp.n]); }
  const changes = [...groups.values()].map(g => ({ bb: g.bb, del: g.del, add: g.add, mod: g.mod, type: g.mod || (g.del && g.add) ? 'mod' : g.add ? 'add' : 'del', layers: [...g.layers], kinds: [...g.kinds], texts: g.texts }))
    .sort((a, b) => (b.bb[3] - a.bb[3]) || (a.bb[0] - b.bb[0]));
  // 相同之处：同样分组统计
  const sameCells = new Set(); for (const it of same) sameCells.add(Math.floor(it.p[0] / ccell) + ',' + Math.floor(it.p[1] / ccell));
  const res = { buckets: {}, changes, origin, view: mb.view, shift, alignVotes, q, size };
  const sets = { same, del: del2, add: add2, mod, modOld };
  for (const [name, arr] of Object.entries(sets)) res.buckets[name] = bucketByKind(arr);
  res.counts = { same: same.length, del: del2.length, add: add2.length, mod: mod.length, sameAreas: sameCells.size, diffAreas: changes.length, totalA: sinkA.items.length, totalB: sinkB.items.length };
  res.layers = [...new Set([...sinkA.items, ...sinkB.items].map(i => i.layer))];
  return res;
}
function itemBox(it) {
  if (it.k === 'text') { const t = it.it; const L = t.s.length * t.h * t.wf; return [t.x - t.h, t.y - t.h, t.x + L * Math.abs(t.ux) + t.h, t.y + t.h * 2]; }
  let a = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (x, y) => { a[0] = Math.min(a[0], x); a[1] = Math.min(a[1], y); a[2] = Math.max(a[2], x); a[3] = Math.max(a[3], y); };
  if (it.ops) { const o = it.ops; for (let j = 0; j < o.length;) { const op = o[j]; if (op === OP.M || op === OP.L) { add(o[j + 1], o[j + 2]); j += 3; } else if (op === OP.A) { add(o[j + 1] - o[j + 3], o[j + 2] - o[j + 3]); add(o[j + 1] + o[j + 3], o[j + 2] + o[j + 3]); j += 7; } else if (op === OP.E) j += 9; else j++; } }
  if (it.rings) for (const r of it.rings) for (let j = 0; j < r.length; j += 2) add(r[j], r[j + 1]);
  if (!Number.isFinite(a[0])) a = [it.p[0], it.p[1], it.p[0], it.p[1]];
  return a;
}
function bucketByKind(arr) {
  const out = {};
  for (const kind of ['line', 'text', 'fill']) {
    const byLayer = new Map(); const fills = new Map(); const texts = [];
    for (const it of arr) {
      if (it.k !== kind) continue;
      if (it.ops) { let b = byLayer.get(it.layer); if (!b) { b = []; byLayer.set(it.layer, b); } for (const x of it.ops) b.push(x); }
      else if (it.rings) { let f = fills.get(it.layer); if (!f) { f = { layer: it.layer, color: 0, alpha: 0.35, groups: [], rings: [] }; fills.set(it.layer, f); } const g0 = f.rings.length; f.rings.push(...it.rings); f.groups.push(g0, f.rings.length); }
      else if (it.it) texts.push(it.it);
    }
    out[kind] = { batches: [...byLayer].map(([layer, ops]) => ({ layer, color: 0, dash: null, w: 0, ops: Float64Array.from(ops) })), fills: [...fills.values()], texts };
  }
  return out;
}
// 把文字修改写进 DXF：按句柄找到实体，替换 1 组码，MTEXT 去掉 3 组码续行
function applyEdits(text, edits) {
  const lines = text.split(/\r?\n/);
  const want = new Map(Object.entries(edits).map(([k, v]) => [k.toUpperCase(), v]));
  if (!want.size) return lines.join('\r\n');
  const out = [];
  let i = 0;
  while (i + 1 < lines.length) {
    const c = lines[i].trim(), v = lines[i + 1];
    if (c === '0' && (v === 'TEXT' || v === 'MTEXT' || v === 'ATTRIB')) {
      // 读出整条实体记录
      const rec = [lines[i], v]; let j = i + 2;
      while (j + 1 < lines.length && lines[j].trim() !== '0') { rec.push(lines[j], lines[j + 1]); j += 2; }
      let hd = null; for (let k = 2; k + 1 < rec.length; k += 2) if (rec[k].trim() === '5') { hd = rec[k + 1].trim().toUpperCase(); break; }
      if (hd && want.has(hd)) {
        const nv = String(want.get(hd));
        if (v === 'MTEXT') {
          let orig = ''; for (let k = 2; k + 1 < rec.length; k += 2) { const cc = rec[k].trim(); if (cc === '3' || cc === '1') orig += rec[k + 1]; }
          const prefix = (orig.match(/^(?:\{|\\[ACcFfHhQqTtWp][^;]*;|\\[LlOoKk])*/) || [''])[0].replace(/\{/g, '');
          const body = prefix + nv.replace(/\r?\n/g, '\\P');
          const rec2 = []; let put = false;
          for (let k = 0; k + 1 < rec.length; k += 2) { const cc = rec[k].trim(); if (cc === '3') continue; if (cc === '1' && !put) { rec2.push(rec[k], body); put = true; continue; } rec2.push(rec[k], rec[k + 1]); }
          out.push(...rec2);
        } else {
          let put = false; for (let k = 0; k + 1 < rec.length; k += 2) { if (rec[k].trim() === '1' && !put) { out.push(rec[k], nv.replace(/\r?\n/g, '^J')); put = true; } else out.push(rec[k], rec[k + 1]); }
        }
      } else out.push(...rec);
      i = j; continue;
    }
    out.push(lines[i], v); i += 2;
  }
  if (i < lines.length) out.push(...lines.slice(i));
  return out.join('\r\n');
}

// 分割导出：只保留 ENTITIES 段里定位点落在范围内的实体（INSERT/ATTRIB/VERTEX 跟随主实体）
function filterRegion(text, bb) {
  const L = text.split('\r\n'); const out = []; let i = 0; let inEnt = false;
  while (i + 1 < L.length) {
    const c = L[i].trim(), v = L[i + 1];
    if (c === '0' && v === 'SECTION' && L[i + 2] && L[i + 2].trim() === '2' && L[i + 3] === 'ENTITIES') { inEnt = true; out.push(L[i], v, L[i + 2], L[i + 3]); i += 4; continue; }
    if (inEnt && c === '0' && v === 'ENDSEC') { inEnt = false; }
    if (inEnt && c === '0') {
      // 读取一个主实体及其附属记录
      let j = i + 2; const rec = [L[i], v];
      while (j + 1 < L.length && L[j].trim() !== '0') { rec.push(L[j], L[j + 1]); j += 2; }
      while (j + 1 < L.length && L[j].trim() === '0' && /^(VERTEX|ATTRIB|SEQEND)$/.test(L[j + 1])) { rec.push(L[j], L[j + 1]); j += 2; while (j + 1 < L.length && L[j].trim() !== '0') { rec.push(L[j], L[j + 1]); j += 2; } }
      let x = null, y = null; let skip = v === 'HATCH' ? 1 : 0; // 填充的第一个 10/20 是标高点 (0,0)，用第二个（边界上的点）
      for (let k = 2; k + 1 < rec.length; k += 2) { const cc = rec[k].trim(); if (cc === '10') { if (skip) { skip--; continue; } if (x === null) x = parseFloat(rec[k + 1]); } else if (cc === '20' && x !== null && y === null) { y = parseFloat(rec[k + 1]); break; } }
      if (x === null || y === null || (x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3])) out.push(...rec);
      i = j; continue;
    }
    out.push(L[i], v); i += 2;
  }
  return out.join('\r\n');
}
function post(m, t) { self.postMessage(m, t || []); }
wasmModule();
self.onmessage = async (e) => {
  const { id, cmd } = e.data;
  try {
    if (cmd === 'open') {
      const scene = await open(id, e.data.name, new Uint8Array(e.data.bytes));
      post({ id, ok: true, scene }, collect(scene));
    } else if (cmd === 'compare') {
      const r = compare(e.data.a, e.data.b, e.data.opts || {});
      post({ id, ok: true, result: r });
    } else if (cmd === 'close') { docs.delete(e.data.doc); post({ id, ok: true }); }
    else if (cmd === 'dxf') {
      const D = docs.get(e.data.doc); if (!D) throw new Error('图纸已关闭');
      let txt = applyEdits(textOf(D), e.data.edits || {});
      if (e.data.bbox) txt = filterRegion(txt, e.data.bbox);
      const dropped = (txt.match(/\r\n\s*0\r\nACAD_PROXY_ENTITY\r\n/g) || []).length + lostCount(D.injected, e.data.bbox);
      const out = D.enc && D.enc !== 'utf-8' ? encodeLegacy(txt, D.enc).slice() : new TextEncoder().encode(txt);
      post({ id, ok: true, bytes: out.buffer, dropped }, [out.buffer]);
    }
  } catch (err) {
    post({ id, ok: false, error: String(err && err.message || err) });
  }
};
