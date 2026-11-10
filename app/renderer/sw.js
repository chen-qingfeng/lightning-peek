// 只为了让安卓浏览器能把页面加到主屏幕。图纸本身不缓存。
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', () => {});
