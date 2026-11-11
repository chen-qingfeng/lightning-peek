// 把唯一一份网页代码 app/renderer 复制到安卓壳的 www。
// 不在 app/ 里留第二份页面。可选把复制出来的 wasm 初始页数改小，桌面版原文件不动。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { patchWasmInitialPages, readWasmMemory } from './patch-wasm-memory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesIdx = process.argv.indexOf('--pages');
const pages = pagesIdx >= 0 ? Number(process.argv[pagesIdx + 1]) : 0;
if (pages && (pages < 256 || pages > 65536)) {
  console.error('--pages 应在 256 到 65536 之间');
  process.exit(2);
}

const src = path.join(root, 'app/renderer');
const dest = path.join(root, 'mobile/www');
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
fs.copyFileSync(path.join(root, 'app/icon.png'), path.join(dest, 'icon.png'));

const samplesDir = path.join(dest, 'samples');
fs.mkdirSync(samplesDir, { recursive: true });
const sampleNames = [];
for (const name of fs.readdirSync(path.join(root, 'docs/samples'))) {
  if (!/\.(dxf|dwg)$/i.test(name)) continue;
  fs.copyFileSync(path.join(root, 'docs/samples', name), path.join(samplesDir, name));
  sampleNames.push(name);
}

const manPath = path.join(dest, 'manifest.webmanifest');
const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
man.icons = [{ src: 'icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }];
fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n');

let html = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
html = html.replace('href="../icon.png"', 'href="icon.png"');
if (!html.includes('peek-probe.js')) {
  html = html.replace(
    '<script type="module" src="app.js"></script>',
    '<link rel="stylesheet" href="peek-probe.css">\n<script type="module" src="peek-probe.js"></script>\n<script type="module" src="app.js"></script>',
  );
}
fs.writeFileSync(path.join(dest, 'index.html'), html);
fs.copyFileSync(path.join(root, 'mobile/probe/peek-probe.js'), path.join(dest, 'peek-probe.js'));
fs.copyFileSync(path.join(root, 'mobile/probe/peek-probe.css'), path.join(dest, 'peek-probe.css'));

const wasmPath = path.join(dest, 'lib/libredwg-web.wasm');
const before = readWasmMemory(fs.readFileSync(wasmPath));
let wasmPages = before.initial;
if (pages && pages !== before.initial) {
  const patched = patchWasmInitialPages(fs.readFileSync(wasmPath), pages);
  fs.writeFileSync(wasmPath, patched);
  wasmPages = pages;
}
const variant = pages && pages < before.initial ? 'smallmem' : 'stock';
fs.writeFileSync(path.join(dest, 'probe-build.json'), JSON.stringify({
  variant,
  wasmInitialPages: wasmPages,
  wasmInitialMiB: wasmPages / 16,
  stockInitialPages: before.initial,
  samples: sampleNames,
}, null, 2) + '\n');
console.log(`www → ${dest}`);
console.log(`wasm 初始 ${wasmPages} 页（${wasmPages / 16} MiB），变体 ${variant}`);
