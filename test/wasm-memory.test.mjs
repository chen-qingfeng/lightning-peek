// 安卓壳用的 wasm 内存实验。不改仓库里的原 wasm，只在临时副本上改初始页数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { patchWasmInitialPages, readWasmMemory } from '../tools/patch-wasm-memory.mjs';
import { extractTch } from '../app/renderer/core/tarch.js';

const wasmUrl = new URL('../app/renderer/lib/libredwg-web.wasm', import.meta.url);
const jsUrl = new URL('../app/renderer/lib/libredwg-web.js', import.meta.url);
const glue = fs.readFileSync(jsUrl, 'utf8');
const original = fs.readFileSync(wasmUrl);

async function loadPages(pages) {
  const bin = patchWasmInitialPages(original, pages);
  const factory = (await import(jsUrl.href)).default;
  const m = await factory({ wasmBinary: bin });
  return m;
}

function readDwg(m, bytes, ext) {
  const name = '/in-' + Math.random().toString(16).slice(2) + ext;
  const before = m.HEAPU8.byteLength;
  m.FS.writeFile(name, bytes);
  const afterWrite = m.HEAPU8.byteLength;
  const r = ext === '.dxf' ? m.dxf_read_file(name) : m.dwg_read_file(name);
  const after = m.HEAPU8.byteLength;
  return { r, before, afterWrite, after, dwg: r && r.data || 0, name };
}

test('胶水 JS 不把初始内存写死，增长走 emscripten_resize_heap', () => {
  assert.equal(glue.includes('INITIAL_MEMORY'), false);
  assert.equal(glue.includes('new WebAssembly.Memory'), false);
  assert.equal(glue.includes('1073741824'), false);
  assert.match(glue, /wasmMemory=wasmExports\["memory"\]/);
  assert.match(glue, /function _emscripten_resize_heap/);
  assert.match(glue, /wasmMemory\.grow\(pages\)/);
});

test('tarch.js 只用对象指针加字段偏移', () => {
  const src = fs.readFileSync(new URL('../app/renderer/core/tarch.js', import.meta.url), 'utf8');
  assert.match(src, /const w = obj >> 2/);
  assert.match(src, /U\[w \+ 4\]/);
  assert.match(src, /U\[w \+ 18\]/);
  assert.match(src, /U\[w \+ 28\]/);
  assert.doesNotMatch(src, /HEAPU(?:8|32)\[\s*(?:0x[0-9a-fA-F]{5,}|\d{6,})\s*\]/);
  assert.doesNotMatch(src, /0x[0-9a-fA-F]{6,}/);
});

test('原 wasm 初始 16384 页、上限 65536 页，改成 1024 和 2048 后都能加载', async () => {
  const info = readWasmMemory(original);
  assert.equal(info.initial, 16384);
  assert.equal(info.maximum, 65536);
  for (const pages of [1024, 2048]) {
    const patched = patchWasmInitialPages(original, pages);
    assert.equal(patched.length, original.length);
    let same = 0;
    for (let i = 0; i < patched.length; i++) if (patched[i] === original[i]) same++;
    assert.equal(patched.length - same, 2);
    const back = readWasmMemory(patched);
    assert.equal(back.initial, pages);
    assert.equal(back.maximum, 65536);
    const m = await loadPages(pages);
    assert.equal(m.HEAPU8.byteLength, pages * 65536);
    m.HEAPU8[0] = m.HEAPU8[0];
  }
});

test('合成天正样图在 1024 和 2048 页上都能读出文字', async () => {
  const file = new URL('../docs/samples/tarch-note.dwg', import.meta.url);
  assert.equal(fs.existsSync(file), true, '缺少 docs/samples/tarch-note.dwg');
  const bytes = fs.readFileSync(file);
  assert.match(new TextDecoder('latin1').decode(bytes.subarray(0, 6)), /^AC10/);
  const hex = (v) => (typeof v === 'bigint' ? v : BigInt(Math.round(Number(v) || 0))).toString(16).toUpperCase();
  for (const pages of [1024, 2048]) {
    const m = await loadPages(pages);
    const { r, dwg, after, before } = readDwg(m, bytes, '.dwg');
    assert.ok(dwg, '没有读到图纸，错误码 ' + (r && r.error));
    const tch = extractTch(m, dwg, hex, 1);
    assert.equal(tch.trap, undefined);
    const td = new TextDecoder('gbk');
    const texts = (tch.items || []).filter((it) => it.f && it.f.raw).map((it) => td.decode(it.f.raw));
    assert.ok(texts.includes('消防'), '读到的文字：' + texts.join(','));
    const item = tch.items.find((it) => it.f && td.decode(it.f.raw) === '消防');
    assert.ok(Math.abs(item.f.x - 71796.85) < 1e-4);
    assert.ok(Math.abs(item.f.y - 25636.74) < 1e-4);
    assert.equal(item.f.h, 3.5);
    assert.equal(item.f.scale, 100);
    assert.ok(after >= before);
    try { m.dwg_free(dwg); } catch (e) { /* 样图已读完 */ }
  }
});

function dxfWithLines(n) {
  const header = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n';
  const line = Buffer.from('0\nLINE\n8\n0\n10\n0\n20\n0\n11\n1\n21\n1\n');
  const footer = '0\nENDSEC\n0\nEOF\n';
  const buf = Buffer.allocUnsafe(header.length + n * line.length + footer.length);
  let o = buf.write(header, 0);
  for (let i = 0; i < n; i++) { line.copy(buf, o); o += line.length; }
  buf.write(footer, o);
  return buf;
}

test('一张生成的大图会把 1024 页的堆撑大', { timeout: 180000 }, async () => {
  const m = await loadPages(1024);
  const before = m.HEAPU8.byteLength;
  assert.equal(before, 1024 * 65536);
  // 直线数量在本地试过：写进 wasm 并解析后，堆会越过 64 MiB 的初始值。
  const dxf = dxfWithLines(Number(process.env.PEEK_GROW_LINES || 45000));
  const { afterWrite, after, dwg, r } = readDwg(m, dxf, '.dxf');
  assert.ok(after > before, `堆没有增长：写入后 ${afterWrite}，解析后 ${after}，初始 ${before}，错误 ${r && r.error}`);
  assert.ok(dwg, '大图没有解析出来');
  const n = m.dwg_get_num_objects(dwg);
  assert.ok(n > 1000, '对象太少：' + n);
  try { m.dwg_free(dwg); } catch (e) { /* 测完即弃 */ }
});
