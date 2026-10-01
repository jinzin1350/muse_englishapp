/* Retired worker: caching moved into OneSignalSDKWorker.js (single root-scope
   worker, so web push keeps working). This stub unregisters itself on
   browsers that still have the old /sw.js registered. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.registration.unregister(); })
  );
});
