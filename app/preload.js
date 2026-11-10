// 闪电看图 · 预加载：只暴露白名单接口
const { contextBridge, ipcRenderer, webUtils } = require('electron');

let openCb = null;
const queued = [];
ipcRenderer.on('open-file', (e, p) => { if (openCb) openCb(p); else queued.push(p); });

contextBridge.exposeInMainWorld('sdkt', {
  version: '0.2.4',
  openDialog: (opt) => ipcRenderer.invoke('open-dialog', opt || {}),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  readText: (p) => ipcRenderer.invoke('read-text', p),
  writeText: (p, t) => ipcRenderer.invoke('write-text', p, t),
  writeTextSync: (p, t) => ipcRenderer.sendSync('write-text-sync', p, t),
  openGuide: () => ipcRenderer.invoke('open-guide'),
  saveDwg: (name, bytes, ver) => ipcRenderer.invoke('save-dwg', name, bytes, ver),
  odaFind: () => ipcRenderer.invoke('oda-find'),
  odaPick: () => ipcRenderer.invoke('oda-pick'),
  odaPage: () => ipcRenderer.invoke('oda-page'),
  openAny: (opt) => ipcRenderer.invoke('open-any', opt || {}),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (s) => ipcRenderer.invoke('set-settings', s),
  fontInfo: (names) => ipcRenderer.invoke('font-info', names || []),
  fontRead: (names) => ipcRenderer.invoke('font-read', names || []),
  fontPickDir: () => ipcRenderer.invoke('font-pick-dir'),
  fontCopy: () => ipcRenderer.invoke('font-copy'),
  saveBytes: (name, bytes) => ipcRenderer.invoke('save-bytes', name, bytes),
  exportPdf: (o) => ipcRenderer.invoke('export-pdf', o),
  printImage: (o) => ipcRenderer.invoke('print-image', o),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch (e) { return ''; } },
  onOpenFile: (cb) => { openCb = cb; while (queued.length) cb(queued.shift()); },
  ready: () => ipcRenderer.send('ready'),
  setLang: (l) => ipcRenderer.send('set-lang', l),
});
