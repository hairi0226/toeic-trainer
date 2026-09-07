// sw.js — 离线缓存。策略：网络优先（4 秒超时），断网/超时时回退到缓存。
// 不维护文件清单：凡是加载过的同源文件都会进运行时缓存；进度数据不经过这里。
// 请求带 cache:'no-cache'，绕过 GitHub Pages 的 10 分钟 HTTP 缓存（用 ETag 重验证）。
const CACHE = 'toeic-trainer-runtime-v1';
const NET_TIMEOUT = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(['./', './index.html'].map((u) => cache.add(new Request(u, { cache: 'no-cache' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('toeic-trainer-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // GitHub API 等外部请求不拦
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await withTimeout(fetch(req, { cache: 'no-cache' }), NET_TIMEOUT);
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const index = await cache.match('./index.html');
        if (index) return index;
      }
      return new Response('offline', { status: 503, statusText: 'offline' });
    }
  })());
});
