import asyncio, os, subprocess, time, signal
from playwright.async_api import async_playwright

SITO = 'http://localhost:8765/ilsolitoculo/'
SCHIERA = 'http://localhost:8765/ilsolitoculo/schiera/'
# Schermate vere dei due strumenti, per la guida dell'amministratore.
#   XLS="03 Campionato - Terza Giornata.xls" python3 screenshots.py
# Servono: docs/ pubblicato su http://localhost:8765/ilsolitoculo/ e /tmp/rose.json
# (vedi il README qui accanto).
XLS = os.environ.get('XLS', 'giornata.xls')
XLS_PULITO = os.environ.get('XLS_PULITO', XLS)
HERE = os.path.dirname(os.path.abspath(__file__))
M_SITO = HERE
M_SCHIERA = os.path.join(HERE, '..', '..', '..', 'schiera-formazione', 'test', 'mock')
OUT = os.environ.get('OUT', os.path.join(HERE, 'schermate'))
os.makedirs(OUT, exist_ok=True)


def avvia(cwd, env):
    subprocess.run(['fuser', '-k', '8899/tcp'], capture_output=True)
    time.sleep(0.4)
    p = subprocess.Popen(['node', 'server.js'], cwd=cwd, env={**os.environ, 'XLS': XLS, **env},
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            import urllib.request
            urllib.request.urlopen('http://localhost:8899/rest/v1/teams', timeout=1)
            break
        except Exception:
            time.sleep(0.25)
    return p


async def pagina(ctx, url):
    async def reroute(route):
        r = await route.fetch()
        body = (await r.text()).replace('https://digonsptxuawnehebotw.supabase.co', 'http://localhost:8899')
        await route.fulfill(response=r, body=body)
    await ctx.route('**/ilsolitoculo/', reroute)
    await ctx.route('**/ilsolitoculo/schiera/', reroute)
    pg = await ctx.new_page()
    await pg.goto(url)
    await pg.wait_for_timeout(600)
    return pg


async def login(pg, email='valerio@test.it'):
    await pg.fill('#email', email)
    await pg.fill('#password', 'giusta')
    await pg.click('#loginBtn')
    await pg.wait_for_timeout(1400)


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks'])

        # ---------------- il sito, come amministratore
        srv = avvia(M_SITO, {'ADMIN': '1', 'DIFF': '1'})
        ctx = await b.new_context(viewport={'width': 400, 'height': 860}, device_scale_factor=2,
                                  is_mobile=True, has_touch=True, service_workers='block', color_scheme='light')
        pg = await pagina(ctx, SITO)
        await login(pg)

        # 1 · la home
        await pg.screenshot(path=f'{OUT}/01-home.png', clip={'x': 0, 'y': 0, 'width': 400, 'height': 700})

        # 2 · il menu con "Carica la giornata"
        await pg.click('#userBtn')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=f'{OUT}/02-menu.png', clip={'x': 0, 'y': 0, 'width': 400, 'height': 350})

        # 3 · l'anteprima del caricamento
        await pg.set_input_files('#roundFile', XLS_PULITO)
        await pg.wait_for_timeout(3500)
        el = await pg.query_selector('.sheet')
        if el:
            await el.screenshot(path=f'{OUT}/03-anteprima.png')

        # 4 · l'esito e le differenze
        await pg.click('[data-act="go"]')
        await pg.wait_for_timeout(3000)
        el = await pg.query_selector('.sheet')
        if el:
            await el.screenshot(path=f'{OUT}/04-differenze.png')
            await pg.click('[data-act="close"]')
            await pg.wait_for_timeout(400)
        await pg.screenshot(path=f'{OUT}/05-esito.png', clip={'x': 0, 'y': 0, 'width': 400, 'height': 330})

        # 6 · il tabellino di una partita (cosa vedono i partecipanti)
        await pg.goto(SITO + '#/calendario')
        await pg.wait_for_timeout(1200)
        await pg.click('.match[data-match]')
        await pg.wait_for_timeout(1200)
        el = await pg.query_selector('.sheet')
        if el:
            await el.screenshot(path=f'{OUT}/06-tabellino.png')
        await ctx.close()
        srv.send_signal(signal.SIGTERM)
        srv.wait()

        # ---------------- Schiera Formazione, come amministratore
        srv = avvia(M_SCHIERA, {'ADMIN': '1'})
        ctx = await b.new_context(viewport={'width': 400, 'height': 860}, device_scale_factor=2,
                                  is_mobile=True, has_touch=True, service_workers='block', color_scheme='light')
        pg = await pagina(ctx, SCHIERA)
        await login(pg)
        await pg.click('#menuBtn')
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=f'{OUT}/07-schiera-opzioni.png', clip={'x': 0, 'y': 0, 'width': 400, 'height': 420})
        # il campo con la formazione
        await pg.click('#menuBtn')
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{OUT}/08-schiera-campo.png', clip={'x': 0, 'y': 60, 'width': 400, 'height': 640})
        await ctx.close()
        srv.send_signal(signal.SIGTERM)
        srv.wait()
        await b.close()

asyncio.run(main())
