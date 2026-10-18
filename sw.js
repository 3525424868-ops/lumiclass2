/* LumiClass Web —— 离线缓存
 * 策略：
 *   - 页面导航（打开网址）：网络优先，拿不到再用缓存 → 保证一发布就能看到新版
 *   - 其它静态资源：缓存优先（快、可离线）
 * 改 CACHE 版本号可强制所有客户端换新缓存
 */
var CACHE = 'lumiclass-web-v10';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './core.js',
  './store.js',
  './photobundle.js',
  './album.js',
  './reminders.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) { return key !== CACHE; })
        .map(function (key) { return caches.delete(key); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  // 1) 打开页面：网络优先，保证新版本立刻生效
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); }).catch(function () {});
        return response;
      }).catch(function () {
        return caches.match(request).then(function (cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // 2) 其它资源：缓存优先
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () {
        return caches.match('./index.html');
      });
    })
  );
});
