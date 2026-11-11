// 只改 libredwg-web.wasm 内存段的初始页数，不重编 LibreDWG。
// 内存由模块自己导出，胶水 JS 里没有 INITIAL_MEMORY 常量。
// 初始页数用 3 字节 LEB128 写回，文件其余字节不动，天正用的结构体偏移因此不变。
import fs from 'fs';

function readLeb(buf, o) {
  let result = 0, shift = 0, byte, start = o;
  do {
    byte = buf[o++];
    result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte & 0x80);
  return { value: result, next: o, length: o - start };
}

function encodeLeb3(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0x1fffff) throw new Error('页数超出 3 字节 LEB128：' + n);
  return [(n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, (n >> 14) & 0x7f];
}

// 返回 { initial, maximum, initialOffset, initialLength }
export function readWasmMemory(buf) {
  if (buf[0] !== 0 || buf[1] !== 0x61 || buf[2] !== 0x73 || buf[3] !== 0x6d) throw new Error('不是 wasm');
  let o = 8;
  while (o < buf.length) {
    const id = buf[o++];
    const sz = readLeb(buf, o);
    o = sz.next;
    const start = o;
    if (id === 5) {
      const count = readLeb(buf, o);
      o = count.next;
      if (count.value !== 1) throw new Error('内存段数量不是 1');
      const flags = buf[o++];
      const initial = readLeb(buf, o);
      const initialOffset = o;
      o = initial.next;
      let maximum = null;
      if (flags & 1) {
        const max = readLeb(buf, o);
        maximum = max.value;
        o = max.next;
      }
      if (o - start !== sz.value) throw new Error('内存段长度与内容不符');
      return { initial: initial.value, maximum, initialOffset, initialLength: initial.length, flags };
    }
    o += sz.value;
  }
  throw new Error('没有内存段');
}

export function patchWasmInitialPages(buf, pages) {
  const src = Buffer.from(buf);
  const info = readWasmMemory(src);
  if (info.maximum !== 65536) throw new Error('上限不是 65536 页，拒绝修改：' + info.maximum);
  if (info.initialLength !== 3) throw new Error('初始页数不是 3 字节，不能原位改：' + info.initialLength);
  const enc = encodeLeb3(pages);
  for (let i = 0; i < 3; i++) src[info.initialOffset + i] = enc[i];
  const after = readWasmMemory(src);
  if (after.initial !== pages || after.maximum !== 65536) throw new Error('改写后的内存段读回来不对');
  return src;
}

function main() {
  const pages = Number(process.argv[2]);
  const src = process.argv[3];
  const dest = process.argv[4] || src;
  if (!pages || !src) {
    console.error('用法: node tools/patch-wasm-memory.mjs <页数> <输入.wasm> [输出.wasm]');
    process.exit(2);
  }
  const out = patchWasmInitialPages(fs.readFileSync(src), pages);
  fs.writeFileSync(dest, out);
  const info = readWasmMemory(out);
  console.log(`初始 ${info.initial} 页（${info.initial * 64 / 1024} MiB），上限 ${info.maximum} 页`);
}

if (process.argv[1] && process.argv[1].endsWith('patch-wasm-memory.mjs')) main();
