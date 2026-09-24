/* Schiera Formazione ora vive dentro il sito della lega: questo service worker
 * prende il posto di quello vecchio, cancella le sue cache e si disinstalla. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('schiera-')).map(k => caches.delete(k)));
    await self.registration.unregister();
    const finestre = await self.clients.matchAll({ type: 'window' });
    finestre.forEach(c => { try { c.navigate(new URL('../#/schiera', self.registration.scope).href); } catch (e) { /* ignora */ } });
  })());
});
