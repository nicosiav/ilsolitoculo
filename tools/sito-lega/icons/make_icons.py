#!/usr/bin/env python3
"""Rigenera le icone del sito dal marchio (tools/sito-lega/src/logo.svg).

  python3 tools/sito-lega/icons/make_icons.py

Scrive in docs/icons/:
  favicon-32.png        per i browser che non leggono la favicon in SVG
  apple-touch-icon.png  180x180 a tutto campo (gli angoli li arrotonda iOS)

Le PNG sono già nel repository: serve rilanciarlo solo se cambia il logo.
Usa Playwright (pip install playwright) per disegnare l'SVG.
"""
import asyncio
import pathlib
import re

from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
LOGO = HERE.parent / 'src' / 'logo.svg'
OUT = HERE.parent.parent.parent / 'docs' / 'icons'


def a_tutto_campo(svg):
    """niente angoli arrotondati e niente filo chiaro: il bordo lo decide iOS"""
    svg = re.sub(r'<rect width="64" height="64" rx="[\d.]+"', '<rect width="64" height="64"', svg, count=1)
    return re.sub(r'<rect x="1.2"[^>]*/>', '', svg, count=1)


async def disegna(pg, svg, size, path):
    await pg.set_viewport_size({'width': size, 'height': size})
    dimensioni = '<svg width="%d" height="%d" ' % (size, size)
    await pg.set_content('<html><body style="margin:0;background:transparent">'
                         + svg.replace('<svg ', dimensioni, 1) + '</body></html>')
    await pg.screenshot(path=str(path), omit_background=True,
                        clip={'x': 0, 'y': 0, 'width': size, 'height': size})


async def main():
    svg = LOGO.read_text(encoding='utf-8').strip()
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg = await (await b.new_context(device_scale_factor=1)).new_page()
        await disegna(pg, svg, 32, OUT / 'favicon-32.png')
        await disegna(pg, a_tutto_campo(svg), 180, OUT / 'apple-touch-icon.png')
        await b.close()
    print('icone aggiornate in', OUT)


if __name__ == '__main__':
    asyncio.run(main())
