import asyncio, os, json, subprocess, time, signal
from playwright.async_api import async_playwright
BASE='http://localhost:8765/ilsolitoculo/schiera/'

async def scenario(pw, name, env, steps):
    subprocess.run(['fuser','-k','8899/tcp'],capture_output=True)
    time.sleep(0.3)
    srv=subprocess.Popen(['node','server.js'],cwd=os.path.dirname(os.path.abspath(__file__)),env={**os.environ,**env},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            import urllib.request; urllib.request.urlopen('http://localhost:8899/rest/v1/players',timeout=1); break
        except Exception: time.sleep(0.25)
    b=await pw.chromium.launch(args=['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks'])
    ctx=await b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True,service_workers='block')
    async def reroute(route):
        r=await route.fetch()
        body=(await r.text()).replace('https://digonsptxuawnehebotw.supabase.co','http://localhost:8899')
        await route.fulfill(response=r, body=body)
    await ctx.route('**/schiera/', reroute)
    pg=await ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e)))
    await pg.goto(BASE); await pg.wait_for_timeout(400)
    print('---',name)
    try:
        await steps(pg)
    finally:
        print('  errori pagina:',errs)
        await b.close(); srv.send_signal(signal.SIGTERM); srv.wait()

async def login(pg, pwd='giusta'):
    await pg.fill('#email','valerio@test.it'); await pg.fill('#password',pwd)
    await pg.click('#loginBtn'); await pg.wait_for_timeout(900)

async def main():
    async with async_playwright() as pw:
        # 7) blocco partita per partita
        async def s7(pg):
            await login(pg)
            print('  barra:', await pg.inner_text('#fileMeta'))
            print('  avvisi:', (await pg.inner_text('#notices')).strip().replace('\n',' | ')[:160])
            n_locked=await pg.locator('.slot.locked, .row.locked').count()
            print('  posti bloccati in formazione:', n_locked)
            pool_locked=await pg.locator('.pchip.locked').count()
            print('  non schierati bloccati:', pool_locked, '| disabilitati:', await pg.locator('.pchip.locked[disabled]').count())
            # un titolare bloccato non deve aprire il selettore
            if n_locked:
                el=pg.locator('.slot.locked').first
                print('  titolare bloccato disabilitato:', await el.is_disabled())
            # cambio modulo: deve essere rifiutato se sposta un bloccato
            mod_prima=(await pg.inner_text('#sub'))
            await pg.click('[data-mod="3-5-2"]'); await pg.wait_for_timeout(400)
            toast=await pg.locator('.toast').count()
            print('  cambio modulo:', mod_prima, '->', await pg.inner_text('#sub'), '| avviso:',
                  (await pg.inner_text('.toast')) if toast else 'nessuno')
            # salvataggio rifiutato dal database
            await pg.click('#saveBtn'); await pg.wait_for_timeout(500)
            if await pg.locator('[data-act="save"]').count():
                await pg.click('[data-act="save"]'); await pg.wait_for_timeout(600)
            print('  esito salvataggio:', (await pg.inner_text('#notices')).strip().replace('\n',' | ')[:120])
        await scenario(pw,'7 blocco partita per partita',{'LOCKED':'1','PRELOAD':'1'},s7)

        # 8) formazioni di giornata pubbliche
        async def s8(pg):
            await login(pg)
            await pg.click('#menuBtn'); await pg.click('#allBtn'); await pg.wait_for_timeout(800)
            print('  titolo:', (await pg.inner_text('.sheet-h')).replace('\n',' · ')[:80])
            print('  squadre elencate:', await pg.locator('#allBody .team-block, #allBody .xr').count())
            print('  blocco squadre:', (await pg.inner_text('#allBody')).strip().replace('\n',' | ')[:160])
            print('  giornate selezionabili:', await pg.locator('#mdPick option').count())
        await scenario(pw,'8 formazioni di giornata',{'PRELOAD':'1'},s8)

        # 9) ripristino dall'ultima formazione salvata (giornate precedenti)
        async def s9(pg):
            await login(pg)
            print('  prima:', await pg.inner_text('#sub'), '| contatore', await pg.inner_text('#count'))
            await pg.click('#menuBtn'); await pg.click('#restoreBtn'); await pg.wait_for_timeout(900)
            print('  dopo:', await pg.inner_text('#sub'), '| contatore', await pg.inner_text('#count'))
            print('  avviso:', (await pg.inner_text('#notices')).strip().replace('\n',' | ')[:140])
            print('  titolare 1:', await pg.inner_text('[data-z="s"][data-i="0"] .nm'))
        await scenario(pw,'9 ripristino da giornata precedente',{'PREV':'1'},s9)

        # 10) amministratore: calendario e squadre dei giocatori
        async def s10(pg):
            await login(pg)
            await pg.click('#menuBtn'); await pg.wait_for_timeout(200)
            print('  voci admin:', await pg.is_visible('#calBtn'), await pg.is_visible('#clubBtn'))
            await pg.click('#calBtn'); await pg.wait_for_timeout(300)
            await pg.click('[data-act="go"]'); await pg.wait_for_timeout(1500)
            print('  sync:', json.load(open('/tmp/sync.json'))['q'] if os.path.exists('/tmp/sync.json') else 'mancante')
            print('  avviso:', (await pg.inner_text('#notices')).strip().replace('\n',' | ')[:160])
            await pg.click('#menuBtn'); await pg.click('#clubBtn'); await pg.wait_for_timeout(800)
            print('  squadre:', (await pg.inner_text('.sheet-h')).replace('\n',' · ')[:80])
            sel=pg.locator('#clubList select').first
            await sel.select_option('Inter')
            await pg.click('[data-act="go"]'); await pg.wait_for_timeout(1500)
            saved=json.load(open('/tmp/clubs.json')) if os.path.exists('/tmp/clubs.json') else {}
            print('  salvate:', saved.get('p_items'))
        try: os.remove('/tmp/clubs.json')
        except Exception: pass
        try: os.remove('/tmp/sync.json')
        except Exception: pass
        await scenario(pw,'10 amministratore: calendario e squadre',{'ADMIN':'1','NOCLUB':'1'},s10)

        # 11) il database rifiuta il salvataggio: il messaggio deve arrivare
        async def s11(pg):
            await login(pg)
            await pg.click('.pchip >> nth=0'); await pg.wait_for_timeout(200)
            await pg.click('#saveBtn'); await pg.wait_for_timeout(400)
            if await pg.locator('[data-act="save"]').count():
                await pg.click('[data-act="save"]'); await pg.wait_for_timeout(700)
            print('  avviso:', (await pg.inner_text('#notices')).strip().replace('\n',' | ')[:140])
            print('  foglio di conferma aperto:', await pg.locator('.sheet-h').count())
        await scenario(pw,'11 salvataggio rifiutato dal database',{'FORCE_P0007':'1'},s11)

asyncio.run(main())
