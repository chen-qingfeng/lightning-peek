// 不放进 npm test：45000 条直线大约要十几秒。用法：npm run test:wasm-grow
import fs from 'fs';
import { patchWasmInitialPages } from './patch-wasm-memory.mjs';

const wasmUrl = new URL('../app/renderer/lib/libredwg-web.wasm', import.meta.url);
const jsUrl = new URL('../app/renderer/lib/libredwg-web.js', import.meta.url);
const original = fs.readFileSync(wasmUrl);
const pages = 1024;
const lines = Number(process.env.PEEK_GROW_LINES || 45000);

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

const factory = (await import(jsUrl.href)).default;
const m = await factory({ wasmBinary: patchWasmInitialPages(original, pages) });
const before = m.HEAPU8.byteLength;
if (before !== pages * 65536) throw new Error('初始内存不对：' + before);
const dxf = dxfWithLines(lines);
const t0 = Date.now();
m.FS.writeFile('/big.dxf', dxf);
const afterWrite = m.HEAPU8.byteLength;
const r = m.dxf_read_file('/big.dxf');
const after = m.HEAPU8.byteLength;
const n = r && r.data ? m.dwg_get_num_objects(r.data) : 0;
console.log(JSON.stringify({ lines, ms: Date.now() - t0, before, afterWrite, after, err: r && r.error, objects: n }));
if (!(after > before)) throw new Error('堆没有增长');
if (!(n > 1000)) throw new Error('对象太少：' + n);
console.log('堆增长检查通过');
