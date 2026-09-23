#!/usr/bin/env python3
"""Costruisce il sito della lega a partire dai sorgenti in src/.

  python3 tools/sito-lega/build.py   -> docs/index.html (pubblicato da GitHub Pages)

Il motore .xls e il client Supabase sono condivisi con Schiera Formazione:
si prendono da tools/schiera-formazione/src/ e finiscono dentro la pagina,
così il sito resta un file solo senza dipendenze esterne.
"""
import pathlib

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


def read(p):
    return p.read_text(encoding='utf-8')


def main():
    html = f"""<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1D6A3E">
<title>{TITLE} — fantacalcio</title>
<meta name="description" content="Rose, calendario, classifiche e statistiche della lega Il Solito Culo.">
<link rel="icon" type="image/png" sizes="32x32" href="schiera/icons/favicon-32.png">
{FONTS}
<style>
{BASE_CSS}{read(SRC / 'app.css')}
</style>
</head>
<body>
{read(SRC / 'index.html')}
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
{read(SRC / 'giornata.js')}
</script>
<script>
{read(SRC / 'app.js')}
</script>
</body>
</html>
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding='utf-8')
    print(f'docs/index.html aggiornato ({len(html) // 1024} KB)')


if __name__ == '__main__':
    main()
