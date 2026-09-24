#!/usr/bin/env python3
"""Costruisce Schiera Formazione a partire dai sorgenti in src/.

Da settembre 2026 Schiera vive dentro il sito della lega (sezione #/schiera):
lì la mette tools/sito-lega/build.py, prendendo ui.html, ui.css e ui.js da qui.

  python3 tools/schiera-formazione/build.py          -> docs/schiera/ (il vecchio indirizzo: porta al sito)
  python3 tools/schiera-formazione/build.py --all    -> anche dist/ (versione offline a file singolo e artifact claude.ai)
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / 'src'
ROOT = HERE.parent.parent
PAGES = ROOT / 'docs' / 'schiera'
DIST = HERE / 'dist'

TITLE = 'Schiera Formazione'
FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700'
    '&family=Barlow+Condensed:wght@600;700&display=swap">'
)
BASE_CSS = ':root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}\n[hidden]{display:none!important}\n'


def read(name):
    return (SRC / name).read_text(encoding='utf-8')


def body():
    return (f"{read('ui.html')}\n<script>\n{read('engine.js')}\n</script>\n"
            f"<script>\n{read('sb.js')}\n</script>\n<script>\n{read('ui.js')}\n</script>\n")


def standalone():
    """la versione a sé: lavora sul file .xls, senza database"""
    return f"""<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1D6A3E">
<title>{TITLE}</title>
{FONTS}
<style>
{BASE_CSS}{read('ui.css')}
</style>
</head>
<body>
{body()}</body>
</html>
"""


# Il vecchio indirizzo .../schiera/ porta alla sezione Schiera del sito.
# Il link dell'email per la nuova password (…/schiera/#access_token=…) passa intero.
REDIRECT = """<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1D6A3E">
<title>Schiera Formazione — Il Solito Culo</title>
<link rel="icon" type="image/png" sizes="32x32" href="../icons/favicon-32.png">
<script>
  (function () {
    var h = location.hash || '';
    var dove = /access_token=|type=recovery|error=/.test(h) ? '../' + h : '../#/schiera';
    location.replace(dove);
  })();
</script>
<noscript><meta http-equiv="refresh" content="0; url=../#/schiera"></noscript>
</head>
<body style="font-family:system-ui,sans-serif;background:#EDF1EA;color:#14201A;padding:24px">
<p>Schiera Formazione adesso è dentro il sito della lega: <a href="../#/schiera">vai a Schiera</a>.</p>
</body>
</html>
"""

# Chi aveva installato la vecchia app ha ancora il suo service worker: questo
# lo sostituisce, svuota le cache e si toglie di mezzo.
RETIRE_SW = """/* Schiera Formazione ora vive dentro il sito della lega: questo service worker
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
"""


def main():
    PAGES.mkdir(parents=True, exist_ok=True)
    (PAGES / 'index.html').write_text(REDIRECT, encoding='utf-8')
    (PAGES / 'sw.js').write_text(RETIRE_SW, encoding='utf-8')
    vecchio = PAGES / 'manifest.webmanifest'
    if vecchio.exists():
        vecchio.unlink()
    print('docs/schiera/ aggiornato (rimanda al sito)')

    if '--all' in sys.argv:
        DIST.mkdir(exist_ok=True)
        (DIST / 'Schiera-Formazione-offline.html').write_text(standalone(), encoding='utf-8')
        artifact = f"<title>{TITLE}</title>\n{FONTS}\n<style>\n{read('ui.css')}\n</style>\n{body()}"
        (DIST / 'schiera-formazione.html').write_text(artifact, encoding='utf-8')
        print('dist/ aggiornato (versione offline + artifact)')


if __name__ == '__main__':
    main()
