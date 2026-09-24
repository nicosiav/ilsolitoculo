/* Service worker del sito della lega. Non tiene niente in cache: i dati cambiano
 * ogni giornata e devono arrivare sempre freschi. Serve solo a rendere il sito
 * installabile come app sul telefono. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* lascia fare alla rete */ });
