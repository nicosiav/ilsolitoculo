#!/usr/bin/env python3
"""Costruisce il sito della lega a partire dai sorgenti in src/.

  python3 tools/sito-lega/build.py   -> docs/index.html (pubblicato da GitHub Pages)

Schiera Formazione è una sezione del sito (#/schiera): la sua pagina, il suo
stile e il suo codice si prendono da tools/schiera-formazione/src/ e finiscono
dentro la pagina, insieme al motore .xls e al client Supabase. Lo stile di
Schiera viene "chiuso" sotto .sch, così non tocca il resto del sito.

Il sito è anche l'app da installare sul telefono: docs/manifest.webmanifest e
docs/sw.js (che non tiene niente in cache: serve solo a renderla installabile).
"""
import pathlib
import re
from urllib.parse import quote

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / 'src'
ROOT = HERE.parent.parent
SCHIERA = ROOT / 'tools' / 'schiera-formazione' / 'src'
OUT = ROOT / 'docs' / 'index.html'

TITLE = 'Il Solito Culo'
FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700'
    '&family=Barlow+Condensed:wght@600;700&display=swap">'
)
BASE_CSS = ':root{padding-top:env(safe-area-inset-top,0px)}\n[hidden]{display:none!important}\n'
CREST = '<span class="crest" aria-hidden="true"></span>'
SLOT_SCHIERA = '<!-- schiera: qui build.py mette Schiera Formazione (tools/schiera-formazione/src/ui.html) -->'

# regole di base che il sito ha già: da Schiera non si prendono
SALTA = re.compile(r'^(\*|html|body|button|select|input|:focus-visible)$')


def blocchi(css):
    """[(prelude, corpo)] dei blocchi di primo livello"""
    out, i, n = [], 0, len(css)
    while i < n:
        j = css.find('{', i)
        if j < 0:
            break
        k, prof = j + 1, 1
        while prof and k < n:
            prof += {'{': 1, '}': -1}.get(css[k], 0)
            k += 1
        out.append((css[i:j].strip(), css[j + 1:k - 1]))
        i = k
    return out


def chiudi_css(css, pre='.sch'):
    """lo stile di Schiera, valido solo dentro .sch"""
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    out = []
    for prelude, corpo in blocchi(css):
        if prelude.startswith('@keyframes'):
            out.append(f'{prelude} {{{corpo}}}')
            continue
        if prelude.startswith('@'):
            dentro = chiudi_css(corpo, pre)
            if dentro.strip():
                out.append(f'{prelude} {{\n{dentro}\n}}')
            continue
        sel = []
        for x in (t.strip() for t in prelude.split(',')):
            if x.startswith(':root'):
                testa, _, resto = x.partition(' ')
                if resto:                      # es. :root[data-theme="dark"] .error
                    sel.append(f'{testa} {pre} {resto}')
                continue                       # i colori li ha già il sito
            if SALTA.match(x):
                continue
            sel.append(f'{pre} {x}')
        if sel:
            out.append(f'{", ".join(sel)} {{{corpo}}}')
    return '\n'.join(out)


def schiera_html():
    """la pagina di Schiera senza le parti che servono solo alla versione a sé"""
    h = read(SCHIERA / 'ui.html')
    h = re.sub(r'<!--solo-app.*?<!--/solo-app-->', '', h, flags=re.S)
    return f'<div class="sch" id="schiera-app">\n{h.strip()}\n</div>'


def read(p):
    return p.read_text(encoding='utf-8')


def logo():
    """src/logo.svg: il marchio della lega, un file solo per intestazione e favicon."""
    return read(SRC / 'logo.svg').strip()


def favicon():
    return 'data:image/svg+xml,' + quote(logo(), safe='=:/,.-')


def pagina():
    corpo = read(SRC / 'index.html')
    if CREST not in corpo:
        raise SystemExit('manca lo spazio del marchio in src/index.html')
    svg = logo().replace('<svg ', '<svg role="presentation" focusable="false" ', 1)
    corpo = corpo.replace(CREST, f'<span class="crest" aria-hidden="true">{svg}</span>')
    if SLOT_SCHIERA not in corpo:
        raise SystemExit('manca lo spazio di Schiera in src/index.html')
    return corpo.replace(SLOT_SCHIERA, schiera_html())


def main():
    html = f"""<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1D6A3E">
<title>{TITLE} — fantacalcio</title>
<meta name="description" content="Rose, calendario, classifiche e statistiche della lega Il Solito Culo.">
<link rel="icon" type="image/svg+xml" href="{favicon()}">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="manifest" href="manifest.webmanifest">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Il Solito Culo">
{FONTS}
<style>
{BASE_CSS}{read(SRC / 'app.css')}
</style>
<style>
/* Schiera Formazione (tools/schiera-formazione/src/ui.css), solo dentro .sch */
{chiudi_css(read(SCHIERA / 'ui.css'))}
</style>
</head>
<body>
{pagina()}
<script>
{read(SCHIERA / 'config.js')}
</script>
<script>
{read(SCHIERA / 'sb.js')}
</script>
<script>
{read(SCHIERA / 'engine.js')}
</script>
<script>
window.SCHIERA_EMBED = true;
</script>
<script>
{read(SCHIERA / 'ui.js')}
</script>
<script>
{read(SRC / 'giornata.js')}
</script>
<script>
{read(SRC / 'app.js')}
</script>
<script>
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {{
  window.addEventListener('load', function () {{ navigator.serviceWorker.register('sw.js').catch(function () {{}}); }});
}}
</script>
</body>
</html>
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding='utf-8')
    (OUT.parent / 'manifest.webmanifest').write_text(read(SRC / 'manifest.webmanifest'), encoding='utf-8')
    (OUT.parent / 'sw.js').write_text(read(SRC / 'sw.js'), encoding='utf-8')
    print(f'docs/index.html aggiornato ({len(html) // 1024} KB)')


if __name__ == '__main__':
    main()
