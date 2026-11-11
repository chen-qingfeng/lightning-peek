// 闪电看图 · DWG → DXF 转换（在单独的读图线程里运行，见 dwgjob.js）
import { extractTch } from './tarch.js';

// wasm 运行时错误：越界、函数签名不符、abort、内存不够
export const wasmTrap = e => /memory access out of bounds|function signature mismatch|unreachable|^Aborted\(|out of memory|Cannot enlarge memory|could not allocate memory/i.test(String(e && e.message || e));

// 读一张图。读完模块就不再用：写某些图（例如 AC1015 天正图）的 DXF 时，LibreDWG 会把
// wasm 堆写坏，再读下一张会越界。所以每张图用一个新线程，读完把整个线程关掉。
export function convertDwg(m, bytes) {
  const inF = '/in.dwg', outF = '/out.dxf';
  const magic = dwgMagic(bytes);
  m.FS.writeFile(inF, bytes);
  let dwg = 0;
  const r = m.dwg_read_file(inF);
  const err = r && typeof r.error === 'number' ? r.error : 0;
  dwg = r && r.data || 0;
  if (err >= 128) throw codeError(err, magic);
  // 先把 DXF 复制出来。后面读天正、OLE 时若 wasm 越界，普通图元仍然能打开。
  const rc = m.dwg_write_dxf(inF, outF);
  if (rc >= 128 || !m.FS.analyzePath(outF).exists) throw codeError(rc || err, magic);
  const out = new Uint8Array(m.FS.readFile(outF));
  let oles = [], tch = null, dead = false;
  if (dwg) {
    try { oles = extractOles(m, dwg); } catch (e) { console.warn('OLE', e); if (wasmTrap(e)) dead = true; }
    // 2000/2004 按字段顺序读。2007 的文字在字符串流里，不能沿用旧顺序。
    const mode = magic === 'AC1015' || magic === 'AC1018' ? 1 : magic === 'AC1021' ? 2 : 0;
    if (!dead) { try { tch = extractTch(m, dwg, hex, mode); } catch (e) { console.warn('TArch', e); } }
  }
  return { bytes: out, warn: err, oles, tch };
}
function codeError(code, magic) { const e = new Error(errText(code, magic)); e.code = code; return e; }
export const dwgMagic = bytes => new TextDecoder('latin1').decode(bytes.subarray(0, 6));

// LibreDWG 写 DXF 时会丢掉 OLE2FRAME，这里直接从 DWG 对象里取出数据和位置
export const hex = v => (typeof v === 'bigint' ? v : BigInt(Math.round(Number(v) || 0))).toString(16).toUpperCase();
function extractOles(m, dwg) {
  const out = [];
  const n = m.dwg_get_num_objects(dwg);
  for (let i = 0; i < n; i++) {
    try {
      const obj = m.dwg_get_object(dwg, i);
      if (!obj || m.dwg_object_get_fixedtype(obj) !== 74) continue; // 74 = OLE2FRAME
      const et = m.dwg_object_to_entity_tio(obj);
      const ent = m.dwg_object_to_entity(obj);
      const d = m.dwg_entity_ole2frame_get_data(et);
      const data = d && d.data; if (!data || !data.length) continue;
      const p1 = m.dwg_dynapi_entity_value(et, 'pt1')?.data, p2 = m.dwg_dynapi_entity_value(et, 'pt2')?.data;
      if (!p1 || !p2) continue;
      let mode = 2, owner = '', layer = '';
      try { mode = m.dwg_object_entity_get_entmode(ent); } catch (e) { /* ignore */ }
      try { const o = m.dwg_object_entity_get_ownerhandle_object(ent); if (o && o.absolute_ref) owner = hex(o.absolute_ref); } catch (e) { /* ignore */ }
      try { const l = m.dwg_object_entity_get_layer_object_ref(ent); if (l && l.absolute_ref) layer = hex(l.absolute_ref); } catch (e) { /* ignore */ }
      out.push({ data: new Uint8Array(data), p1: [p1.x, p1.y], p2: [p2.x, p2.y], mode, owner, layer });
    } catch (e) { if (wasmTrap(e)) throw e; }
  }
  return out;
}

// LibreDWG 的错误位（dwg.h）：128 缺类表、256 缺段、512 缺页、1024 内部错误、
// 2048 不是有效的 DWG、4096 读文件出错、8192 内存不够。
// AutoCAD 2018 至今的图都是 AC1032，所以 2048 几乎不会是“版本太新”，按文件头判断再说。
const KNOWN = /^AC10(1[2-9]|2[1-7]|32)$/;
export function errText(code, magic = '') {
  if (code & 8192) return '内存不够，这张图纸没能读完。请关掉几张已打开的图纸后再试';
  if (code & 4096) return '读取图纸文件出错。请确认文件没有被其他程序占用，再试一次';
  if (code & 2048) {
    if (/^AC10\d\d$/.test(magic) && magic > 'AC1032') return '图纸版本（' + magic + '）过新，暂不支持。可以在 CAD 软件里另存为 2018 或更早版本后再打开';
    if (/^(AC1\.|AC2\.|AC1001|AC1002|AC100[3-9]|AC1010|AC1011)/.test(magic)) return '图纸版本（' + magic + '）太旧，暂不支持。可以在 CAD 软件里另存为 2000 或更新版本后再打开';
    if (!KNOWN.test(magic)) return '这不是可识别的 DWG 文件（文件头为「' + magic.replace(/[^\x20-\x7e]/g, '?') + '」）。请确认文件完整，或在 CAD 软件里另存一份后再试';
    return '图纸内容无法识别，文件可能不完整或已损坏（' + magic + '）。可以用 CAD 软件的「修复」功能处理，或另存一份后再试';
  }
  if (code & 1024) return '读取这张图纸时出错。可以用 CAD 软件的「修复」功能处理，或另存为 DXF 后再试';
  if (code & 512) return '图纸被加密或格式无法识别。请确认文件是 DWG 格式，加密图纸需先在原软件中解密';
  if (code & 256) return '无法读取这张图纸，文件可能已损坏。可以用 CAD 软件的「修复」功能处理，或另存为 DXF 后再试';
  if (code & 128) return '图纸缺少必要数据，无法打开。可以在 CAD 软件里另存一份后再试';
  console.warn('LibreDWG error code', code); return '图纸无法解析。可以在 CAD 软件里另存为 DXF 后再试，并欢迎反馈这张图纸的情况';
}
