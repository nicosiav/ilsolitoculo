"""Le prove di Schiera girano sul sito della lega, nella sezione #/schiera.

Il finto Supabase è quello del sito (tools/sito-lega/test/mock/server.js), che
passa a server.js di questa cartella tutto quello che riguarda Schiera.
  FORMAZIONI  il file Formazioni.xls (modello per l'export, rose per l'import)
  XLS         il file di giornata che alimenta il resto del sito
"""
import os, subprocess, time, signal, urllib.request

BASE = os.environ.get('BASE', 'http://localhost:8765/ilsolitoculo/')
FORMAZIONI = os.environ.get('FORMAZIONI', '/home/claude/Formazioni.xls')
MOCK_SITO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'sito-lega', 'test', 'mock')


async def scenario(pw, name, env, steps):
    subprocess.run(['fuser', '-k', '8899/tcp'], capture_output=True)
    time.sleep(0.3)
    srv = subprocess.Popen(['node', 'server.js'], cwd=MOCK_SITO, env={**os.environ, 'FORMAZIONI': FORMAZIONI, **env},
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            urllib.request.urlopen('http://localhost:8899/rest/v1/matchdays', timeout=1); break
        except Exception:
            time.sleep(0.25)
    b = await pw.chromium.launch(args=['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks'])
    ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
                              accept_downloads=True, service_workers='block')

    async def reroute(route):
        r = await route.fetch()
        body = (await r.text()).replace('https://digonsptxuawnehebotw.supabase.co', 'http://localhost:8899')
        await route.fulfill(response=r, body=body)
    await ctx.route('**/ilsolitoculo/', reroute)
    pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(BASE); await pg.wait_for_timeout(400)
    print('---', name)
    try:
        await steps(pg)
    finally:
        print('  errori pagina:', errs)
        await b.close(); srv.send_signal(signal.SIGTERM); srv.wait()


async def login(pg, pwd='giusta'):
    """entra dal sito e apre la sezione Schiera"""
    await pg.fill('#email', 'valerio@test.it'); await pg.fill('#password', pwd)
    await pg.click('#loginBtn'); await pg.wait_for_timeout(900)
    if pwd == 'giusta':
        await pg.evaluate("location.hash = '#/schiera'"); await pg.wait_for_timeout(700)


async def modulo(pg):
    return await pg.inner_text('[data-mod][aria-pressed="true"]')
