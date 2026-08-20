const CACHE_NAME = 'stocksense-v1';
const APP_SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg'];

if (isServiceWorkerScope(self)) {
  const serviceWorker = self;
  serviceWorker.addEventListener('install', (event) => {
    if (!isExtendableEvent(event)) return;
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => serviceWorker.skipWaiting()));
  });

  serviceWorker.addEventListener('activate', (event) => {
    if (!isExtendableEvent(event)) return;
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
        .then(() => serviceWorker.clients.claim()),
    );
  });

  serviceWorker.addEventListener('fetch', (event) => {
    if (!isFetchEvent(event)) return;
    const { request } = event;
    if (request.method !== 'GET') return;

    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
    );
  });
}

function isServiceWorkerScope(scope: WorkerGlobalScope): scope is ServiceWorkerGlobalScope {
  return 'clients' in scope && 'skipWaiting' in scope;
}

function isExtendableEvent(event: Event): event is ExtendableEvent {
  return 'waitUntil' in event;
}

function isFetchEvent(event: Event): event is FetchEvent {
  return 'request' in event && 'respondWith' in event;
}
