// 闪电看图 · 安卓验证壳
// 在 app.js 之前执行，装上和手机浏览器模式一样的桥，并记下开图耗时和内存。
// 许可：GPL-3.0-or-later

const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };

let openCb = null;
const queued = [];
function emitOpen(p) { if (openCb) openCb(p); else queued.push(p); }

function cap() { return window.Capacitor || null; }
function nativeCall(method, args) {
  const c = cap();
  if (!c || typeof c.nativePromise !== 'function') return Promise.reject(new Error('没有原生桥'));
  return c.nativePromise('PeekProbe', method, args || {});
}

async function readLocalPath(p) {
  const c = cap();
  const url = c && c.convertFileSrc ? c.convertFileSrc(p) : p;
  const r = await fetch(url);
  if (!r.ok) throw new Error('读文件失败 ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

window.sdkt = {
  browser: true,
  version: 'android-shell',
  getSettings: async () => ls('sdkt.settings', {}),
  setSettings: async (s) => { try { localStorage.setItem('sdkt.settings', JSON.stringify(s)); } catch (e) { /* 忽略 */ } },
  readText: async (p) => ls('sdkt.side.' + p, null),
  writeText: async (p, t) => { try { localStorage.setItem('sdkt.side.' + p, JSON.stringify(t)); } catch (e) { /* 忽略 */ } },
  saveBytes: async (name, bytes) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes]));
    a.download = name;
    a.click();
    return name;
  },
  exportPdf: async () => null,
  printImage: async (o) => {
    const w = window.open('');
    if (w) { w.document.write(`<img src="${o.dataUrl}" style="width:100%">`); w.print(); }
  },
  readFile: (p) => readLocalPath(p),
  onOpenFile: (cb) => { openCb = cb; while (queued.length) cb(queued.shift()); },
};

const runs = [];
let current = null;
let timer = 0;
let peak = emptyPeak();
let device = null;
let buildInfo = null;
let deviceError = '';

function emptyPeak() {
  return { jsUsed: 0, jsTotal: 0, pssKb: 0, rssKb: 0, nativeHeapKb: 0 };
}
function jsHeap() {
  const m = performance.memory;
  if (!m) return null;
  return { used: m.usedJSHeapSize || 0, total: m.totalJSHeapSize || 0 };
}
function noteHeap() {
  const j = jsHeap();
  if (j) {
    peak.jsUsed = Math.max(peak.jsUsed, j.used);
    peak.jsTotal = Math.max(peak.jsTotal, j.total);
  }
}
async function sampleNative() {
  noteHeap();
  try {
    const m = await nativeCall('getMemory');
    peak.pssKb = Math.max(peak.pssKb, m.totalPssKb || 0);
    peak.rssKb = Math.max(peak.rssKb, m.rssKb || 0);
    peak.nativeHeapKb = Math.max(peak.nativeHeapKb, m.nativeHeapKb || 0);
    peak.last = m;
  } catch (e) { peak.nativeError = String(e && e.message || e); }
}
function startSampling() {
  peak = emptyPeak();
  noteHeap();
  if (timer) clearInterval(timer);
  timer = setInterval(() => { sampleNative().catch(() => {}); }, 250);
  sampleNative().catch(() => {});
}
function stopSampling() {
  if (timer) clearInterval(timer);
  timer = 0;
  return sampleNative();
}

window.__peek = {
  dedicatedWasm: !!ls('peek.dedicated', false),
  on(ev, data) {
    if (ev === 'read-start') {
      current = { name: data.name || '', t0: performance.now(), bytes: data.bytes || 0 };
      startSampling();
      render();
      return;
    }
    if (!current) return;
    if (ev === 'read-end') {
      current.readMs = data.ms;
      current.bytes = data.bytes;
    } else if (ev === 'parsed') {
      current.info = data.info || {};
      current.parseDone = performance.now();
    } else if (ev === 'fail') {
      if (current) {
        current.error = data.message || '打开失败';
        current.totalMs = performance.now() - current.t0;
        runs.unshift(current);
        if (runs.length > 3) runs.pop();
      }
      current = null;
      stopSampling().finally(render);
      return;
    } else if (ev === 'first-paint') {
      current.paintAt = data.ms;
      current.totalMs = data.ms - current.t0;
      current.peak = { ...peak };
      const row = current;
      current = null;
      stopSampling().finally(() => {
        row.peak = { ...peak };
        runs.unshift(row);
        if (runs.length > 3) runs.pop();
        render();
      });
    }
    render();
  },
};

function fmtMs(v) { return v == null || !Number.isFinite(v) ? '—' : Math.round(v) + ' ms'; }
function fmtBytes(n) {
  if (!n) return '—';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MiB';
  if (n >= 1024) return Math.round(n / 1024) + ' KiB';
  return n + ' B';
}
function fmtKb(n) { return n ? (n / 1024).toFixed(1) + ' MiB' : '—'; }

function deviceLines() {
  if (!device) return deviceError ? '机型：还没拿到（' + deviceError + '）' : '机型：正在读取…';
  const bit = device.is64Bit ? '64 位' : '32 位';
  return [
    '机型：' + (device.manufacturer || '') + ' ' + (device.model || ''),
    '安卓：' + device.release + '（API ' + device.sdk + '）',
    'WebView：' + (device.webView || '未知'),
    '进程：' + bit + (device.abi ? '，' + device.abi : ''),
  ].join('\n');
}

function buildLines() {
  if (!buildInfo) return '包：未知';
  const pages = buildInfo.wasmInitialPages;
  return '包：' + (buildInfo.variant === 'smallmem' ? '调小内存' : '原始 wasm') + '，初始 ' + pages + ' 页（' + buildInfo.wasmInitialMiB + ' MiB）';
}

function runText(row, i) {
  const info = row.info || {};
  const paintMs = row.paintAt != null && row.parseDone != null ? row.paintAt - row.parseDone : null;
  const grew = info.wasmGrew ? '，堆增长了' : (info.wasmBytes ? '，堆没有增长' : '');
  const pk = row.peak || {};
  if (row.error) {
    return ['图' + (i + 1) + ' ' + row.name, '打开失败：' + row.error, '读文件：' + fmtMs(row.readMs)].join('\n');
  }
  return [
    '图' + (i + 1) + ' ' + row.name,
    '文件大小：' + fmtBytes(row.bytes),
    '读文件：' + fmtMs(row.readMs),
    'DWG 转换：' + fmtMs(info.dwgMs),
    '解析：' + fmtMs(info.parseMs),
    '首次绘制：' + fmtMs(paintMs),
    '从选中到画完：' + fmtMs(row.totalMs),
    'wasm：' + fmtBytes(info.wasmBefore) + ' → ' + fmtBytes(info.wasmBytes) + grew,
    'JS 堆峰值：' + (pk.jsUsed ? fmtBytes(pk.jsUsed) + ' / ' + fmtBytes(pk.jsTotal) : (jsHeap() ? '0' : '这个 WebView 没有 performance.memory')),
    'PSS 峰值：' + fmtKb(pk.pssKb),
    'RSS 峰值：' + fmtKb(pk.rssKb),
  ].join('\n');
}

function reportText() {
  const head = ['闪电看图安卓验证', deviceLines(), buildLines(), '专用转换线程：' + (window.__peek.dedicatedWasm ? '开' : '关')].join('\n');
  if (!runs.length) return head + '\n\n还没有打开过图纸。';
  return head + '\n\n' + runs.map((r, i) => runText(r, i)).join('\n\n');
}

function render() {
  const pre = document.querySelector('#peek-probe .meta');
  const box = document.querySelector('#peek-probe textarea');
  if (pre) pre.textContent = deviceLines() + '\n' + buildLines() + (current ? '\n正在打开 ' + current.name + '…' : '');
  if (box && document.activeElement !== box) box.value = reportText();
}

function mount() {
  const root = document.createElement('aside');
  root.id = 'peek-probe';
  root.innerHTML = `
    <header>
      <strong>验证数据</strong>
      <button type="button" id="peek-copy">复制</button>
      <button type="button" id="peek-fold">收起</button>
    </header>
    <div class="body">
      <div class="meta"></div>
      <label><input type="checkbox" id="peek-dedicated"> 每张图单独转换，转完就丢掉 DWG 模块（可切换）</label>
      <div class="samples"></div>
      <textarea readonly></textarea>
    </div>`;
  document.body.appendChild(root);
  const box = root.querySelector('textarea');
  const dedicated = root.querySelector('#peek-dedicated');
  dedicated.checked = !!window.__peek.dedicatedWasm;
  dedicated.onchange = () => {
    window.__peek.dedicatedWasm = dedicated.checked;
    try { localStorage.setItem('peek.dedicated', JSON.stringify(dedicated.checked)); } catch (e) { /* 忽略 */ }
    if (window.__peekResetWorker) window.__peekResetWorker();
    render();
  };
  root.querySelector('#peek-fold').onclick = () => {
    root.classList.toggle('collapsed');
    root.querySelector('#peek-fold').textContent = root.classList.contains('collapsed') ? '展开' : '收起';
  };
  root.querySelector('#peek-copy').onclick = async () => {
    const text = reportText();
    box.value = text;
    box.focus();
    box.select();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { /* 下面用选中文本 */ }
    try { if (!ok) ok = document.execCommand('copy'); } catch (e) { /* 忽略 */ }
    root.querySelector('#peek-copy').textContent = ok ? '已复制' : '请长按复制';
    setTimeout(() => { const b = root.querySelector('#peek-copy'); if (b) b.textContent = '复制'; }, 1600);
  };
  render();
}

async function openBundled(name) {
  const r = await fetch('samples/' + name);
  if (!r.ok) throw new Error('样图不在包里：' + name);
  const bytes = new Uint8Array(await r.arrayBuffer());
  window.__peek.on('read-start', { name, bytes: bytes.byteLength });
  window.__peek.on('read-end', { name, bytes: bytes.byteLength, ms: 0 });
  const openBytes = window.__sdkt && window.__sdkt.openBytes;
  if (!openBytes) throw new Error('页面还没准备好');
  await openBytes(name, bytes, null);
}

function addSampleButtons() {
  const host = document.querySelector('#peek-probe .samples');
  if (!host || !buildInfo) return;
  const names = buildInfo.samples || [];
  for (const name of names) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.onclick = () => openBundled(name).catch((e) => { host.insertAdjacentHTML('beforeend', `<div class="err">${e.message || e}</div>`); });
    host.appendChild(b);
  }
}

async function loadBuildInfo() {
  try {
    buildInfo = await fetch('probe-build.json').then((r) => r.json());
  } catch (e) {
    buildInfo = { variant: 'unknown', wasmInitialPages: '?', wasmInitialMiB: '?' };
  }
  buildInfo.samples = buildInfo.samples || [];
  addSampleButtons();
  render();
}

async function loadDevice() {
  try {
    device = await nativeCall('getInfo');
  } catch (e) {
    deviceError = String(e && e.message || e);
  }
  render();
}

async function takeIncoming() {
  try {
    const file = await nativeCall('takePendingFile');
    if (file && file.path) emitOpen(file.path);
  } catch (e) { /* 没有待打开的文件 */ }
}
window.__peekIncoming = () => { takeIncoming(); };

function whenReady(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}
whenReady(() => {
  mount();
  loadBuildInfo();
  loadDevice();
  // app.js 在本模块之后执行，等它挂上 __sdkt 再收「用其他应用打开」
  const wait = setInterval(() => {
    if (window.__sdkt && window.__sdkt.openBytes) { clearInterval(wait); takeIncoming(); }
  }, 200);
  setTimeout(() => clearInterval(wait), 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') takeIncoming(); });
});
