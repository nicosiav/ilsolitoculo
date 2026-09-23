import asyncio, os, json, subprocess, time, signal
from playwright.async_api import async_playwright

BASE = os.environ.get('BASE', 'http://localhost:8765/ilsolitoculo/')
XLS = os.environ.get('XLS', '/root/.claude/uploads/01e16dca-3147-5c65-b05b-ee8683976523/8977fb44-03_Campionato_-_Terza_Giornata.xls')
HERE = os.path.dirname(os.path.abspath(__file__))


async def apri(pw, env, passi, nome):
    subprocess.run(['fuser', '-k', '8899/tcp'], capture_output=True)
    time.sleep(0.3)
    srv = subprocess.Popen(['node', 'server.js'], cwd=HERE, env={**os.environ, 'XLS': XLS, **env},
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            import urllib.request
            urllib.request.urlopen('http://localhost:8899/rest/v1/teams', timeout=1)
            break
        except Exception:
            time.sleep(0.25)
    b = await pw.chromium.launch(args=['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks'])
    ctx = await b.new_context(viewport={'width': 390, 'height': 900}, is_mobile=True, has_touch=True, service_workers='block')

    async def reroute(route):
        r = await route.fetch()
        body = (await r.text()).replace('https://digonsptxuawnehebotw.supabase.co', 'http://localhost:8899')
        await route.fulfill(response=r, body=body)
    await ctx.route('**/ilsolitoculo/', reroute)
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console:' + m.text) if m.type == 'error' else None)
    await pg.goto(BASE)
    await pg.wait_for_timeout(500)
    print('---', nome)
    try:
        await passi(pg)
    finally:
        print('  errori pagina:', errs[:4])
        await b.close()
        srv.send_signal(signal.SIGTERM)
        srv.wait()


async def login(pg):
    await pg.fill('#email', 'valerio@test.it')
    await pg.fill('#password', 'giusta')
    await pg.click('#loginBtn')
    await pg.wait_for_timeout(900)


async def main():
    async with async_playwright() as pw:
        async def s1(pg):
            await login(pg)
            print('  utente:', await pg.inner_text('#userBtn'), '| sezioni:', await pg.locator('#nav a').count())
            print('  home:', (await pg.inner_text('#view')).strip().replace('\n', ' | ')[:180])
            print('  riquadri:', await pg.locator('.tile').count(), '| partite:', await pg.locator('.match').count(),
                  '| grafico:', await pg.locator('svg.chart').count())
        await apri(pw, {}, s1, '1 home')

        async def s2(pg):
            await login(pg)
            for sez, atteso in [('squadra', '.prow'), ('rose', '.prow'), ('calendario', '.match'), ('classifiche', '.tbl'),
                                ('confronto', '.tile'),
                                ('statistiche', '.prow'), ('coppe', '.tbl'), ('playoff', '.match'),
                                ('albo', '.tbl'), ('premi', '.prow')]:
                await pg.goto(BASE + '#/' + sez)
                await pg.wait_for_timeout(700)
                t = (await pg.inner_text('#view')).strip().replace('\n', ' | ')
                print(f'  {sez}: {await pg.locator(atteso).count()} elementi · {t[:90]}')
        await apri(pw, {}, s2, '2 tutte le sezioni')

        async def s3(pg):
            await login(pg)
            await pg.goto(BASE + '#/calendario')
            await pg.wait_for_timeout(700)
            await pg.click('.match[data-match]')
            await pg.wait_for_timeout(700)
            print('  tabellino:', (await pg.inner_text('.sheet-h')).replace('\n', ' · ')[:90])
            print('  giocatori:', await pg.locator('.sheet .prow').count(), '| riquadri:', await pg.locator('.sheet .tile').count())
            body = await pg.inner_text('.sheet-b')
            print('  contiene marcatori:', '⚽' in body, '| contiene sostituzioni:', 'Sostituzioni' in body)
        await apri(pw, {}, s3, '3 tabellino di una partita')

        async def s4(pg):
            await login(pg)
            await pg.goto(BASE + '#/classifiche')
            await pg.wait_for_timeout(700)
            for c in ['super_corretta', 'coppa_lega', 'sfigometro', 'gol_totali', 'coppa']:
                await pg.click(f'[data-class="{c}"]')
                await pg.wait_for_timeout(500)
                righe = await pg.locator('.tbl tbody tr').count()
                print(f'  {c}: {righe} righe · {(await pg.inner_text(".card .sec-h")).replace(chr(10), " ")[:50]}')
        await apri(pw, {}, s4, '4 tutte le classifiche')

        async def s5(pg):
            await login(pg)
            await pg.click('#userBtn')
            await pg.wait_for_timeout(200)
            print('  voce admin visibile:', await pg.is_visible('#adminBtn'))
            await pg.set_input_files('#roundFile', XLS)
            await pg.wait_for_timeout(3000)
            print('  anteprima:', (await pg.inner_text('.sheet-h')).replace('\n', ' · ')[:80])
            print('  riquadri anteprima:', await pg.locator('.sheet .tile').count())
            await pg.click('[data-act="go"]')
            await pg.wait_for_timeout(2500)
            inviato = json.load(open('/tmp/import_round.json')) if os.path.exists('/tmp/import_round.json') else {}
            print('  inviato al database:', inviato)
            print('  avviso:', (await pg.inner_text('#notices')).strip().replace('\n', ' | ')[:120])
            print('  differenze mostrate:', await pg.locator('.sheet').count())
        try:
            os.remove('/tmp/import_round.json')
        except Exception:
            pass
        await apri(pw, {'ADMIN': '1', 'DIFF': '1'}, s5, '5 amministratore carica la giornata')

        async def s6(pg):
            await login(pg)
            await pg.goto(BASE + '#/confronto')
            await pg.wait_for_timeout(900)
            print('  riquadri:', await pg.locator('.tile').count(), '| legenda:', await pg.locator('.legend span').count(),
                  '| precedenti:', await pg.locator('.match').count())
            print('  testo:', (await pg.inner_text('#view')).strip().replace(chr(10), ' | ')[:150])
            await pg.select_option('[data-conf="b"]', label='Giuseppe')
            await pg.wait_for_timeout(800)
            print('  dopo il cambio:', (await pg.inner_text('.tiles')).replace(chr(10), ' ')[:110])
            await pg.goto(BASE + '#/squadra')
            await pg.wait_for_timeout(900)
            print('  squadra:', (await pg.inner_text('.tiles')).replace(chr(10), ' ')[:110],
                  '| partite:', await pg.locator('.esito').count(), '| grafici:', await pg.locator('svg.chart').count())
        await apri(pw, {}, s6, '6 squadra e testa a testa')

        # 7) il database della stagione non c'è ancora
        async def s7(pg):
            await login(pg)
            print('  entrato lo stesso:', await pg.is_visible('#nav'), '| sezioni:', await pg.locator('#nav a').count())
            print('  avviso:', (await pg.inner_text('#notices')).strip().replace(chr(10), ' | ')[:190])
            print('  home:', (await pg.inner_text('#view')).strip().replace(chr(10), ' | ')[:110])
            for sez in ['rose', 'calendario', 'classifiche', 'statistiche', 'albo']:
                await pg.goto(BASE + '#/' + sez)
                await pg.wait_for_timeout(600)
                print(f'  {sez}:', (await pg.inner_text('#view')).strip().replace(chr(10), ' | ')[:80])
        await apri(pw, {'ADMIN': '1', 'NOSTAGIONE': '1'}, s7, "7 database della stagione mancante")

asyncio.run(main())
