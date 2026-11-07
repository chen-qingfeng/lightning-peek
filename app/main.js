// 闪电看图 · 主进程
const { app, BrowserWindow, ipcMain, dialog, protocol, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_NAME = '闪电看图';
let LANG = 'zh';
const EN = { '打开图纸': 'Open drawing', '选择要对比的新图纸': 'Choose the new drawing to compare', 'CAD 图纸': 'CAD drawings', '所有文件': 'All files', '保存': 'Save', 'Excel 工作簿': 'Excel workbook', 'PNG 图片': 'PNG image', 'PDF 文档': 'PDF document', '导出 PDF': 'Export PDF', '选择文件': 'Choose a file', '文件': 'Files', '只能打开 DWG / DXF 文件': 'Only DWG and DXF files can be opened', '文件超过 400MB': 'The file is larger than 400 MB', '不允许写入该位置': 'Writing to this location is not allowed', '闪电看图': 'Lightning Peek' };
const tm = (s) => (LANG === 'en' ? EN[s] || s : s);
const ROOT = path.join(__dirname, 'renderer');

// ---- 便携数据目录：程序目录下的 data\，写不进去才退回系统用户目录 ----
function pickDataDir() {
  const exeDir = path.dirname(process.execPath);
  const portable = app.isPackaged ? path.join(exeDir, 'data') : path.join(__dirname, '..', 'data-dev');
  try { fs.mkdirSync(portable, { recursive: true }); fs.accessSync(portable, fs.constants.W_OK); return portable; }
  catch (e) { return path.join(app.getPath('appData'), APP_NAME); }
}
const DATA = pickDataDir();
app.setPath('userData', DATA);
app.setPath('sessionData', path.join(DATA, 'session'));
try { app.setPath('crashDumps', path.join(DATA, 'crash')); } catch (e) { /* 旧版本无此项 */ }
app.setName(APP_NAME);
const SETTINGS = path.join(DATA, 'settings.json');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };

let win = null;
const pendingFiles = [];
let rendererReady = false;

function filesFromArgv(argv) {
  return argv.slice(1).filter(a => /\.(dwg|dxf)$/i.test(a) && fs.existsSync(a)).map(a => path.resolve(a));
}
function sendOpen(files) {
  if (!files.length) return;
  if (win && rendererReady) for (const f of files) win.webContents.send('open-file', f);
  else pendingFiles.push(...files);
}

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', (e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    sendOpen(filesFromArgv(argv));
  });
  app.whenReady().then(() => {
    protocol.handle('app', async (req) => {
      const u = new URL(req.url);
      let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (!rel) rel = 'index.html';
      const file = path.normalize(path.join(ROOT, rel));
      if (!file.startsWith(ROOT)) return new Response('forbidden', { status: 403 });
      try {
        const data = await fs.promises.readFile(file);
        return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
      } catch (e) { return new Response('not found', { status: 404 }); }
    });
    Menu.setApplicationMenu(null);
    createWindow();
    pendingFiles.push(...filesFromArgv(process.argv));
  });
  app.on('window-all-closed', () => app.quit());
}

function loadSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch (e) { return {}; } }
function saveSettings(s) { try { fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 1), 'utf8'); } catch (e) { /* 忽略 */ } }

function createWindow() {
  const st = loadSettings();
  const b = st.window || {};
  win = new BrowserWindow({
    width: b.w || 1440, height: b.h || 900, x: b.x, y: b.y, minWidth: 900, minHeight: 560,
    title: tm(APP_NAME), backgroundColor: '#f4f6f9', show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  if (b.max) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://sdkt/index.html');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && input.control && input.shift) win.webContents.toggleDevTools();
  });
  win.on('close', () => {
    const s = loadSettings();
    const bb = win.getNormalBounds();
    s.window = { x: bb.x, y: bb.y, w: bb.width, h: bb.height, max: win.isMaximized() };
    saveSettings(s);
  });
}

// ---------------- IPC ----------------
ipcMain.on('set-lang', (e, l) => { LANG = l === 'en' ? 'en' : 'zh'; if (win) win.setTitle(tm(APP_NAME)); });
ipcMain.on('ready', () => { rendererReady = true; const f = pendingFiles.splice(0); sendOpen(f); });
ipcMain.handle('version', () => app.getVersion());
ipcMain.handle('open-dialog', async (e, opt = {}) => {
  const s = loadSettings();
  const r = await dialog.showOpenDialog(win, {
    title: opt.single ? tm('选择要对比的新图纸') : tm('打开图纸'), defaultPath: s.lastDir || undefined,
    properties: opt.single ? ['openFile'] : ['openFile', 'multiSelections'],
    filters: [{ name: tm('CAD 图纸'), extensions: ['dwg', 'dxf'] }, { name: tm('所有文件'), extensions: ['*'] }],
  });
  if (r.canceled) return [];
  if (r.filePaths[0]) { s.lastDir = path.dirname(r.filePaths[0]); saveSettings(s); }
  return r.filePaths;
});
// 页面只能读图纸、读写图纸旁的标注文件（纵深防御：即使页面被注入也碰不到其他文件）
const isDrawing = (p) => typeof p === 'string' && path.isAbsolute(p) && /\.(dwg|dxf)$/i.test(p);
const isMarks = (p) => typeof p === 'string' && path.isAbsolute(p) && /\.json$/i.test(p);
const isSidecar = (p) => typeof p === 'string' && path.isAbsolute(p) && /\.(dwg|dxf)\.lpeek\.json$/i.test(p);
ipcMain.handle('read-file', async (e, p) => {
  if (!isDrawing(p)) throw new Error(tm('只能打开 DWG / DXF 文件'));
  const st = await fs.promises.stat(p);
  if (st.size > 400 * 1024 * 1024) throw new Error(tm('文件超过 400MB'));
  return new Uint8Array(await fs.promises.readFile(p));
});
ipcMain.handle('read-text', async (e, p) => { if (!isMarks(p)) return null; try { return await fs.promises.readFile(p, 'utf8'); } catch (err) { return null; } });
ipcMain.handle('write-text', async (e, p, text) => { if (!isSidecar(p)) throw new Error(tm('不允许写入该位置')); await fs.promises.writeFile(p, text, 'utf8'); return true; });
ipcMain.on('write-text-sync', (e, p, text) => { try { if (isSidecar(p)) fs.writeFileSync(p, text, 'utf8'); e.returnValue = true; } catch (err) { e.returnValue = false; } });
ipcMain.handle('open-any', async (e, opt = {}) => {
  const r = await dialog.showOpenDialog(win, { title: tm('选择文件'), properties: ['openFile'], filters: [{ name: opt.name || tm('文件'), extensions: opt.ext || ['*'] }] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('get-settings', () => { const s = loadSettings(); delete s.window; return s; });
ipcMain.handle('set-settings', (e, obj) => { const s = loadSettings(); saveSettings({ ...s, ...obj, window: s.window, lastDir: s.lastDir, lastSaveDir: s.lastSaveDir }); return true; });
ipcMain.handle('save-bytes', async (e, name, bytes) => {
  const s = loadSettings();
  const ext = path.extname(name).slice(1).toLowerCase();
  const filters = { xlsx: [{ name: tm('Excel 工作簿'), extensions: ['xlsx'] }], png: [{ name: tm('PNG 图片'), extensions: ['png'] }], pdf: [{ name: tm('PDF 文档'), extensions: ['pdf'] }] }[ext] || [];
  const r = await dialog.showSaveDialog(win, { title: tm('保存'), defaultPath: path.join(s.lastSaveDir || s.lastDir || app.getPath('documents'), name), filters });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, Buffer.from(bytes));
  s.lastSaveDir = path.dirname(r.filePath); saveSettings(s);
  return r.filePath;
});
ipcMain.handle('reveal', (e, p) => { if (isDrawing(p) || isMarks(p)) shell.showItemInFolder(p); });

// 把一张大图放进一页 A3，再导出 PDF 或交给系统打印
async function pageWindow(dataUrl, landscape) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkt-'));
  const png = path.join(tmp, 'page.png');
  fs.writeFileSync(png, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const html = path.join(tmp, 'page.html');
  fs.writeFileSync(html, `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:A3 ${landscape ? 'landscape' : 'portrait'};margin:8mm}html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body><img src="page.png"></body></html>`, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await w.loadFile(html);
  await w.webContents.executeJavaScript('new Promise(r => { const i = document.images[0]; if (i.complete) r(); else i.onload = r; })');
  return { w, tmp };
}
function cleanup(tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ } }
ipcMain.handle('export-pdf', async (e, { dataUrl, landscape, name }) => {
  const s = loadSettings();
  const r = await dialog.showSaveDialog(win, { title: tm('导出 PDF'), defaultPath: path.join(s.lastSaveDir || s.lastDir || app.getPath('documents'), name), filters: [{ name: tm('PDF 文档'), extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  const { w, tmp } = await pageWindow(dataUrl, landscape);
  try {
    const pdf = await w.webContents.printToPDF({ pageSize: 'A3', landscape, printBackground: true, preferCSSPageSize: true });
    await fs.promises.writeFile(r.filePath, pdf);
    s.lastSaveDir = path.dirname(r.filePath); saveSettings(s);
    return r.filePath;
  } finally { w.destroy(); cleanup(tmp); }
});
ipcMain.handle('print-image', async (e, { dataUrl, landscape }) => {
  const { w, tmp } = await pageWindow(dataUrl, landscape);
  return new Promise((resolve) => {
    w.webContents.print({ silent: false, printBackground: true, landscape }, (ok, reason) => { w.destroy(); cleanup(tmp); resolve(ok ? true : reason); });
  });
});
