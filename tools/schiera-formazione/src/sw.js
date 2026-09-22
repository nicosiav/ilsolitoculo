/* Service worker di Schiera Formazione
 * - rende l'app installabile e utilizzabile anche senza connessione
 * - riceve i file .xls condivisi da altre app (Condividi → Schiera)
 */
const VERSION = '__VERSION__';
const CACHE = 'schiera-' + VERSION;
const SHARED = 'schiera-condivisi';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/favicon-32.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('schiera-') && k !== CACHE && k !== SHARED).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // File condiviso da un'altra app (Web Share Target)
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/condividi')) {
    event.respondWith((async () => {
      try {
        const form = await req.formData();
        const file = form.getAll('file').find(f => f && typeof f !== 'string');
        if (file) {
          const c = await caches.open(SHARED);
          await c.put(new URL('file-condiviso', self.registration.scope).href,
            new Response(file, { headers: { 'x-nome': encodeURIComponent(file.name || 'Formazioni.xls') } }));
        }
      } catch (e) { /* la pagina mostrerà un avviso */ }
      return Response.redirect(new URL('./?condiviso=1', self.registration.scope).href, 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;

  // Font di Google: prima la cache, poi la rete
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }
      catch (e) { return hit || Response.error(); }
    })());
    return;
  }

  if (url.origin !== location.origin) return;

  // Pagine e file dell'app: prima la rete (per ricevere gli aggiornamenti), poi la cache
  event.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch (e) {
      const hit = await c.match(req, { ignoreSearch: req.mode === 'navigate' });
      return hit || (req.mode === 'navigate' ? c.match('./') : Response.error());
    }
  })());
});
