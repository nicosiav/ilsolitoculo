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
    try:
        await steps(pg)
    finally:
        print(name,'| errori pagina:',errs)
        await b.close(); srv.send_signal(signal.SIGTERM); srv.wait()

async def login(pg, pwd='giusta'):
    await pg.fill('#email','valerio@test.it'); await pg.fill('#password',pwd)
    await pg.click('#loginBtn'); await pg.wait_for_timeout(700)

async def main():
    async with async_playwright() as pw:
        # 1) password sbagliata
        async def s1(pg):
            await login(pg,'sbagliata')
            print('  errore mostrato:', (await pg.inner_text('#notices')).strip()[:60], '| login ancora visibile:', await pg.is_visible('#loginCard'))
        await scenario(pw,'1 password sbagliata',{},s1)

        # 2) login, schieramento completo, salvataggio, export
        async def s2(pg):
            await login(pg)
            print('  header:', await pg.inner_text('#fileName'), '|', await pg.inner_text('#fileMeta'))
            print('  sub:', await pg.inner_text('#sub'), '| login nascosto:', not await pg.is_visible('#loginCard'))
            await pg.click('[data-mod="4-3-3"]')
            for n in ['Meret','Couto','Ramon','Estupinan','Bellanova','Paz N.','De Roon','Fazzini','Davis K.','Woltemade','Laurientè',
                      'Milinkovic-Savic V.','Valdepenas','Dragusin','Adzic','Samardzic','Ramos G.','Yeboah J.','Contini','Holm','Liberali','Camarda']:
                await pg.click(f'.pchip:has-text("{n}")')
            print('  contatore:', await pg.inner_text('#count'))
            await pg.click('#saveBtn'); await pg.wait_for_timeout(600)
            print('  esito:', (await pg.inner_text('.sheet-h')).replace('\n',' · '))
            saved=json.load(open('/tmp/last_save.json'))
            print('  RPC: giornata',saved['p_matchday'],'modulo',saved['p_module'],'slot',len(saved['p_slots']),
                  '| pos1..3', [s['pos'] for s in saved['p_slots'][:3]], [s['player_id'] for s in saved['p_slots'][:3]])
            async with pg.expect_download() as dl:
                await pg.click('[data-act="export"]')
            d=await dl.value; await d.save_as('/tmp/export_online.xls')
            print('  export:', d.suggested_filename, '| log export:', os.path.exists('/tmp/last_export.json'))
            await pg.wait_for_timeout(300)
            # storico
            await pg.click('[data-act="close"]'); await pg.click('#menuBtn'); await pg.click('#logBtn'); await pg.wait_for_timeout(400)
            print('  storico:', (await pg.inner_text('.sheet-b')).strip().split('\n')[0][:70])
        await scenario(pw,'2 login + salvataggio + export',{},s2)

        # 3) formazione già salvata: deve ricomparire
        async def s3(pg):
            await login(pg)
            print('  avviso:', (await pg.inner_text('#notices')).strip()[:70])
            print('  titolare 1:', await pg.inner_text('[data-z="s"][data-i="0"] .nm'), '| modulo:', await pg.inner_text('#sub'))
        await scenario(pw,'3 formazione precedente',{'PRELOAD':'1'},s3)

        # 4) giornata chiusa
        async def s4(pg):
            await login(pg)
            print('  avviso:', (await pg.inner_text('#notices')).strip()[:80])
            print('  salva disabilitato:', await pg.is_disabled('#saveBtn'), '| slot disabilitato:', await pg.is_disabled('[data-z="b"][data-i="0"]'))
        await scenario(pw,'4 giornata chiusa',{'CLOSED':'1','PRELOAD':'1'},s4)
asyncio.run(main())

async def admin_tests():
    async with async_playwright() as pw:
        async def s5(pg):
            await login(pg)
            await pg.click('#menuBtn'); await pg.wait_for_timeout(200)
            print('  menu admin visibile:', await pg.is_visible('#rosterBtn'), await pg.is_visible('#matchdayBtn'))
            # aggiornamento rose
            await pg.set_input_files('#adminFile',os.environ.get('XLS','/home/claude/Formazioni.xls')); await pg.wait_for_timeout(800)
            print('  conferma:', (await pg.inner_text('.sheet-h')).replace('\n',' · '))
            await pg.click('[data-act="go"]'); await pg.wait_for_timeout(2500)
            imported=[l for l in open('/tmp/import.log')] if os.path.exists('/tmp/import.log') else []
            print('  squadre importate:', len(imported), '| modello caricato:', os.path.exists('/tmp/upload.flag'))
            print('  avviso:', (await pg.inner_text('#notices')).strip()[:80])
            # giornata corrente
            await pg.click('#menuBtn'); await pg.click('#matchdayBtn'); await pg.wait_for_timeout(300)
            await pg.fill('#mdId','9'); await pg.fill('#mdLabel','Giornata 9'); await pg.fill('#mdDeadline','2026-10-04T18:00')
            await pg.click('[data-act="go"]'); await pg.wait_for_timeout(1200)
            md=json.load(open('/tmp/matchday.json'))
            print('  giornata impostata:', md['p_id'], md['p_label'], md['p_deadline'][:16])
        await scenario(pw,'5 amministratore',{'ADMIN':'1'},s5)

        async def s6(pg):
            await login(pg)
            await pg.click('#menuBtn'); await pg.wait_for_timeout(200)
            print('  menu admin per un giocatore normale:', await pg.is_visible('#rosterBtn'))
        await scenario(pw,'6 giocatore normale',{},s6)
asyncio.run(admin_tests())
