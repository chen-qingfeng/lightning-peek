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

function encodeFilePath(p) {
  return String(p).split('/').map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join('/');
}
async function readLocalPath(p) {
  const c = cap();
  const path = encodeFilePath(p);
  const url = c && c.convertFileSrc ? c.convertFileSrc(path) : path;
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
  readFile: async (p) => {
    const t = performance.now();
    const bytes = await readLocalPath(p);
    const name = String(p).split(/[/\\]/).pop();
    window.__peek.read = { name, bytes: bytes.byteLength, ms: performance.now() - t };
    return bytes;
  },
  onOpenFile: (cb) => {
    openCb = cb;
    const start = performance.now();
    const flush = () => {
      const ready = window.__sdkt && window.__sdkt.openBytes && window.__sdkt.openBytes.__peekWrapped;
      if (!ready && queued.length && performance.now() - start < 10000) { requestAnimationFrame(flush); return; }
      while (queued.length) cb(queued.shift());
    };
    flush();
  },
};

const runs = [];
let current = null;
let timer = 0;
let peak = emptyPeak();
let device = null;
let buildInfo = null;
let deviceError = '';
let incomingError = '';
let bootError = '';
let crashed = ls('peek.inflight', null);
try { const saved = ls('peek.runs', []); if (Array.isArray(saved)) runs.push(...saved.slice(0, 3)); } catch (e) { /* 忽略 */ }

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
    peak.otherRssKb = Math.max(peak.otherRssKb || 0, m.otherRssKb || 0);
    peak.otherCount = Math.max(peak.otherCount || 0, m.otherCount || 0);
    peak.last = m;
  } catch (e) { peak.nativeError = String(e && e.message || e); }
}
function startSampling() {
  peak = emptyPeak();
  noteHeap();
  if (timer) clearInterval(timer);
  timer = setInterval(() => { sampleNative().catch(() => {}); }, 100);
  sampleNative().catch(() => {});
}
function stopSampling() {
  if (timer) clearInterval(timer);
  timer = 0;
  return sampleNative();
}

window.__peek = {
  dedicatedWasm: ls('peek.dedicated', true) !== false,
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

function memLine(label, snap) {
  if (!snap) return label + '：—';
  const js = snap.js ? fmtBytes(snap.js.used) : '无 performance.memory';
  return label + '：wasm ' + fmtBytes(snap.wasm) + '，JS ' + js;
}
function runText(row, i) {
  const info = row.info || {};
  const grew = info.wasmGrew ? '，堆增长了' : (info.wasmBytes ? '，堆没有增长' : '');
  const pk = row.peak || {};
  const lines = ['图' + (i + 1) + ' ' + row.name + (info.runIndex ? '  #' + info.runIndex : '')];
  if (row.error) lines.push('打开失败：' + row.error);
  lines.push(
    '文件大小：' + fmtBytes(row.bytes),
    '读文件：' + fmtMs(row.readMs),
    'DWG 转换：' + fmtMs(info.dwgMs),
    '解析：' + fmtMs(info.parseMs),
    '准备（字体/旁注/提示）：' + fmtMs(row.prepMs),
    '首次绘制：' + fmtMs(row.paintMs),
    '从选中到画完：' + fmtMs(row.totalMs),
    'wasm 编译：' + fmtMs(info.wasmCompileMs) + (info.workerAgeMs != null ? '，线程已运行 ' + fmtMs(info.workerAgeMs) : ''),
    '冷热：' + (info.wasmCompileMs > 20 ? '冷（这次编译了 wasm）' : '热（wasm 已经在）'),
    'wasm：' + fmtBytes(info.wasmBefore) + ' → ' + fmtBytes(info.wasmBytes) + grew,
    info.wasmBytes ? (info.wasmOverlap ? '非专用：转换后立刻再加载一份 wasm，旧的要等回收，两份会叠一会儿' : '专用转换：转完即丢掉那份 wasm') : '',
    memLine('转换前', info.mem && info.mem.before),
    memLine('转换后', info.mem && info.mem.afterConvert),
    memLine('解析后', info.mem && info.mem.afterParse),
    '主线程 JS 堆峰值：' + (pk.jsUsed ? fmtBytes(pk.jsUsed) + ' / ' + fmtBytes(pk.jsTotal) : (jsHeap() ? '0' : '这个 WebView 没有 performance.memory')),
    'PSS 峰值：' + fmtKb(pk.pssKb) + (pk.otherCount ? '，另看到 ' + pk.otherCount + ' 个相关进程 RSS ' + fmtKb(pk.otherRssKb) : ''),
    'RSS 峰值：' + fmtKb(pk.rssKb),
  );
  if (pk.otherNote) lines.push('其他进程：' + pk.otherNote);
  if (row.release && row.release.length) {
    for (const s of row.release) {
      const n = s.native || {};
      lines.push('结束后 ' + s.sec + ' 秒：PSS ' + fmtKb(n.totalPssKb) + '，RSS ' + fmtKb(n.rssKb) + '，主线程 JS ' + (s.js ? fmtBytes(s.js.used) : '—'));
    }
  }
  return lines.filter(Boolean).join('\n');
}

function reportText() {
  const head = ['闪电看图安卓验证', deviceLines(), buildLines(), '专用转换线程：' + (window.__peek.dedicatedWasm ? '开' : '关')];
  if (bootError) head.push('wasm 启动失败：' + bootError);
  if (incomingError) head.push('外部打开失败：' + incomingError);
  if (crashed) head.push('上次没开完就退出了：' + (crashed.name || '') + '（' + fmtBytes(crashed.bytes) + '，' + (crashed.dedicated ? '专用转换' : '普通') + '）');
  if (!runs.length) return head.join('\n') + '\n\n还没有打开过图纸。';
  return head.join('\n') + '\n\n' + runs.map((r, i) => runText(r, i)).join('\n\n');
}

function render() {
  const pre = document.querySelector('#peek-probe .meta');
  const box = document.querySelector('#peek-probe textarea');
  if (pre) pre.textContent = [deviceLines(), buildLines(), bootError && ('wasm 启动失败：' + bootError), incomingError && ('外部打开失败：' + incomingError), crashed && ('上次没开完：' + (crashed.name || '')), current && ('正在打开 ' + current.name + '…')].filter(Boolean).join('\n');
  if (box && document.activeElement !== box) box.value = reportText();
}

function mount() {
  const root = document.createElement('aside');
  root.id = 'peek-probe';
  root.innerHTML = `
    <header>
      <strong>验证数据</strong>
      <button type="button" id="peek-copy">复制</button>
      <button type="button" id="peek-fold">展开</button>
    </header>
    <div class="body">
      <div class="meta"></div>
      <label><input type="checkbox" id="peek-dedicated"> 每张图单独转换，转完就丢掉 DWG 模块（可切换）</label>
      <div class="samples"></div>
      <textarea readonly></textarea>
    </div>`;
  root.classList.add('collapsed');
  document.body.appendChild(root);
  const box = root.querySelector('textarea');
  const dedicated = root.querySelector('#peek-dedicated');
  dedicated.checked = !!window.__peek.dedicatedWasm;
    dedicated.onchange = () => {
    window.__peek.dedicatedWasm = dedicated.checked;
    try { localStorage.setItem('peek.dedicated', JSON.stringify(dedicated.checked)); } catch (e) { /* 忽略 */ }
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
  const t = performance.now();
  const r = await fetch('samples/' + name);
  if (!r.ok) throw new Error('样图不在包里：' + name);
  const bytes = new Uint8Array(await r.arrayBuffer());
  window.__peek.read = { name, bytes: bytes.byteLength, ms: performance.now() - t };
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

function remember(row) {
  runs.unshift(row);
  if (runs.length > 3) runs.pop();
  try { localStorage.setItem('peek.runs', JSON.stringify(runs)); } catch (e) { /* 忽略 */ }
  try { localStorage.removeItem('peek.inflight'); } catch (e) { /* 忽略 */ }
  crashed = null;
}
function scheduleRelease(row) {
  for (const sec of [2, 10, 30]) {
    setTimeout(async () => {
      const snap = { sec, js: jsHeap(), native: null };
      try { snap.native = await nativeCall('getMemory'); } catch (e) { snap.err = String(e && e.message || e); }
      row.release = row.release || [];
      row.release.push(snap);
      try { localStorage.setItem('peek.runs', JSON.stringify(runs)); } catch (e) { /* 忽略 */ }
      render();
    }, sec * 1000);
  }
}
async function wrappedOpen(orig, name, bytes, path, opt) {
  if (opt && opt.hidden) return orig(name, bytes, path, opt);
  const read = window.__peek.read;
  window.__peek.read = null;
  const row = {
    name: (read && read.name) || name,
    bytes: (read && read.bytes) || (bytes && bytes.byteLength) || 0,
    readMs: read ? read.ms : null,
    dedicated: !!window.__peek.dedicatedWasm,
  };
  row.t0 = read && read.ms ? performance.now() - read.ms : performance.now();
  try { localStorage.setItem('peek.inflight', JSON.stringify({ name: row.name, bytes: row.bytes, dedicated: row.dedicated, t: Date.now() })); } catch (e) { /* 忽略 */ }
  current = row;
  startSampling();
  render();
  try {
    const tCall = performance.now();
    const doc = await orig(name, bytes, path, opt);
    row.afterOpen = performance.now();
    row.openCallMs = row.afterOpen - tCall;
    if (!doc) { row.error = '没有打开'; row.totalMs = performance.now() - row.t0; }
    else {
      row.info = (doc.scene && doc.scene.info) || {};
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      row.paintAt = performance.now();
      row.paintMs = row.paintAt - row.afterOpen;
      row.prepMs = Math.max(0, row.openCallMs - (row.info.dwgMs || 0) - (row.info.parseMs || 0));
      row.totalMs = row.paintAt - row.t0;
    }
    row.peak = { ...peak };
    current = null;
    await stopSampling();
    row.peak = { ...peak, otherCount: peak.last && peak.last.otherCount, otherRssKb: peak.last && peak.last.otherRssKb, otherNote: peak.last && peak.last.otherNote };
    remember(row);
    render();
    if (row.dedicated) scheduleRelease(row);
    return doc;
  } catch (err) {
    row.error = String(err && err.message || err);
    row.totalMs = performance.now() - row.t0;
    row.peak = { ...peak };
    current = null;
    await stopSampling();
    remember(row);
    render();
    throw err;
  }
}
function wrapApi() {
  const api = window.__sdkt;
  if (!api || !api.openBytes || api.openBytes.__peekWrapped) return !!(api && api.openBytes && api.openBytes.__peekWrapped);
  const orig = api.openBytes;
  const wrapped = function (name, bytes, path, opt) { return wrappedOpen(orig, name, bytes, path, opt); };
  wrapped.__peekWrapped = true;
  api.openBytes = wrapped;
  return true;
}
function armWrap() {
  if (wrapApi()) return;
  const t0 = performance.now();
  const tick = () => { if (!wrapApi() && performance.now() - t0 < 10000) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
const NativeWorker = window.Worker;
window.Worker = function (url, opts) {
  const w = new NativeWorker(url, opts);
  const origPost = w.postMessage.bind(w);
  w.postMessage = (msg, transfer) => {
    if (msg && msg.cmd === 'open' && window.__peek && window.__peek.dedicatedWasm) msg = Object.assign({}, msg, { dedicatedWasm: true });
    return origPost(msg, transfer);
  };
  w.addEventListener('message', (e) => {
    if (e.data && e.data.bootError) { bootError = e.data.bootError; render(); }
  });
  return w;
};
async function takeIncoming() {
  try {
    const file = await nativeCall('takePendingFile');
    if (file && file.path) emitOpen(file.path);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/没有原生桥|未实现/.test(msg)) return;
    incomingError = msg;
    render();
  }
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
  takeIncoming();
  armWrap();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') takeIncoming(); });
});
