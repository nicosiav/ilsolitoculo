#!/usr/bin/env python3
"""Costruisce Schiera Formazione a partire dai sorgenti in src/.

  python3 tools/schiera-formazione/build.py          -> docs/schiera/ (GitHub Pages, app installabile)
  python3 tools/schiera-formazione/build.py --all    -> anche dist/ (versione offline a file singolo e artifact claude.ai)
"""
import hashlib
import pathlib
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


def body(online=False):
    cfg = f"<script>\n{read('config.js')}\n</script>\n" if online else ''
    return (f"{read('ui.html')}\n{cfg}<script>\n{read('engine.js')}\n</script>\n"
            f"<script>\n{read('sb.js')}\n</script>\n<script>\n{read('ui.js')}\n</script>\n")


def standalone(head_extra='', tail_extra='', online=False):
    return f"""<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1D6A3E">
<title>{TITLE}</title>
{head_extra}{FONTS}
<style>
{BASE_CSS}{read('ui.css')}
</style>
</head>
<body>
{body(online)}{tail_extra}</body>
</html>
"""


PWA_HEAD = """<meta name="description" content="Schiera la formazione del fantacalcio sul file .xls della lega e salvalo pronto da inviare.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Schiera">
"""

PWA_TAIL = """<script>
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
</script>
"""


def main():
    PAGES.mkdir(parents=True, exist_ok=True)
    html = standalone(PWA_HEAD, PWA_TAIL, online=True)
    manifest = read('manifest.webmanifest')
    version = hashlib.sha256((html + manifest + read('sw.js')).encode('utf-8')).hexdigest()[:10]
    (PAGES / 'index.html').write_text(html, encoding='utf-8')
    (PAGES / 'manifest.webmanifest').write_text(manifest, encoding='utf-8')
    (PAGES / 'sw.js').write_text(read('sw.js').replace('__VERSION__', version), encoding='utf-8')
    print(f'docs/schiera/ aggiornato (versione {version})')

    if '--all' in sys.argv:
        DIST.mkdir(exist_ok=True)
        (DIST / 'Schiera-Formazione-offline.html').write_text(standalone(), encoding='utf-8')
        artifact = f"<title>{TITLE}</title>\n{FONTS}\n<style>\n{read('ui.css')}\n</style>\n{body()}"
        (DIST / 'schiera-formazione.html').write_text(artifact, encoding='utf-8')
        print('dist/ aggiornato (versione offline + artifact)')


if __name__ == '__main__':
    main()
