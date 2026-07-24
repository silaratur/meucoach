// Service worker do Meu Coach: cache dos arquivos do app para funcionar offline.
// As chamadas de IA (/api) sempre vão para a rede.
const CACHE = 'meu-coach-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api')) return;

  // Rede primeiro com fallback para o cache (bom para desenvolvimento e produção simples)
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copia));
        return resp;
      })
      .catch(() => caches.match(event.request).then((r) => r || caches.match('/'))),
  );
});

// Lembrete diário (push) — o servidor manda { title, body, url } como JSON no payload.
self.addEventListener('push', (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    // payload não veio em JSON — usa os textos padrão abaixo.
  }
  const titulo = dados.title || 'Meu Coach';
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: dados.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: dados.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      const existente = lista.find((c) => c.url.includes(self.location.origin));
      if (existente) return existente.focus();
      return self.clients.openWindow(url);
    }),
  );
});
