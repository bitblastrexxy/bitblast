const CACHE_NAME = 'moniegram-cache-v6';
const urlsToCache = [
  '/',
  '/index.html',
  '/main-page.html',
  '/signup.html',
  '/login.html',
  '/otp.html',
  '/stripe.html',
  '/deposit-crypto.html',
  '/css/index.css',
  '/css/forms.css',
  '/css/depsoit-crypto.css',
  '/css/stripe.css',
  '/css/main-page.css',
  '/images/icon small.png',
  '/images/icon big.png',
  '/images/icon smaller.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!cacheWhitelist.includes(cacheName)) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
      })
  );
});