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


async def affiancate(pg):
    """Le due formazioni della partita stanno una accanto all'altra, riga per riga, senza scorrere di lato."""
    a = await pg.eval_on_selector('.sheet .dc.sx.primo', 'e => e.getBoundingClientRect().toJSON()')
    b = await pg.eval_on_selector('.sheet .dc.dx.primo', 'e => e.getBoundingClientRect().toJSON()')
    assert abs(a['top'] - b['top']) < 1 and b['left'] >= a['right'] - 1, (a, b)
    largo = await pg.eval_on_selector('.sheet', 'e => e.scrollWidth > e.clientWidth')
    assert not largo, 'il foglio scorre di lato'
    righe = await pg.eval_on_selector_all('.sheet .dc.sx', 'l => l.map(e => Math.round(e.getBoundingClientRect().top))')
    righe_dx = await pg.eval_on_selector_all('.sheet .dc.dx', 'l => l.map(e => Math.round(e.getBoundingClientRect().top))')
    assert righe == righe_dx, 'le righe delle due colonne non sono allineate'
    print(f'  affiancate: {round(a["width"])} + {round(b["width"])} px, {len(righe)} righe allineate')


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
            for sez, atteso in [('squadre', '.prow'), ('squadre/rosa', '.prow'), ('squadre/statistiche', 'svg.chart'),
                                ('squadre/confronto', '.tile'), ('giornata', '.match'), ('giornata/formazioni', '.form-pan'),
                                ('classifiche', '.tbl'), ('classifiche/coppa', '.tbl'), ('classifiche/playoff', '.match'),
                                ('lega', '.prow'), ('lega/albo', '.tbl'), ('lega/premi', '.prow')]:
                await pg.goto(BASE + '#/' + sez)
                await pg.wait_for_timeout(700)
                t = (await pg.inner_text('#view')).strip().replace('\n', ' | ')
                n = await pg.locator(atteso).count()
                print(f'  {sez}: {n} elementi · {t[:90]}')
                assert n > 0, 'sezione vuota: ' + sez
            # i vecchi indirizzi portano dove sta ora la stessa cosa
            for vecchio, nuovo in [('calendario', 'giornata'), ('rose', 'squadre/rosa'), ('statistiche', 'lega'),
                                   ('coppe', 'classifiche/coppa'), ('albo', 'lega/albo'), ('confronto', 'squadre/confronto')]:
                await pg.goto(BASE + '#/' + vecchio); await pg.wait_for_timeout(500)
                assert pg.url.endswith('#/' + nuovo), (vecchio, pg.url)
            print('  vecchi indirizzi: ok')
        await apri(pw, {}, s2, '2 tutte le sezioni')

        async def s3(pg):
            await login(pg)
            await pg.goto(BASE + '#/giornata')
            await pg.wait_for_timeout(700)
            await pg.click('.match[data-match]')
            await pg.wait_for_timeout(700)
            print('  tabellino:', (await pg.inner_text('.sheet-h')).replace('\n', ' · ')[:90])
            sx, dx = await pg.locator('.sheet .dc.sx .badge').count(), await pg.locator('.sheet .dc.dx .badge').count()
            print('  giocatori in campo:', sx, '+', dx, '| numeri:', await pg.locator('.sheet .confronto .cr').count())
            assert sx >= 10 and dx >= 10 and await pg.locator('.sheet .confronto .cr').count() == 4
            await affiancate(pg)
            body = await pg.inner_text('.sheet-b')
            print('  contiene marcatori:', '⚽' in body, '| contiene sostituzioni:', 'SOSTITUZIONI' in body.upper())
        await apri(pw, {}, s3, '3 tabellino di una partita')

        async def s4(pg):
            await login(pg)
            await pg.goto(BASE + '#/classifiche')
            await pg.wait_for_timeout(700)
            for c in ['corretta', 'coppa-di-lega', 'sfigometro', 'gol-reali', 'coppa']:
                await pg.click(f'a.chip[href="#/classifiche/{c}"]')
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
            await pg.goto(BASE + '#/squadre/confronto')
            await pg.wait_for_timeout(900)
            print('  riquadri:', await pg.locator('.tile').count(), '| legenda:', await pg.locator('.legend span').count(),
                  '| precedenti:', await pg.locator('.match').count())
            print('  testo:', (await pg.inner_text('#view')).strip().replace(chr(10), ' | ')[:150])
            await pg.select_option('[data-conf="b"]', label='Giuseppe')
            await pg.wait_for_timeout(800)
            print('  dopo il cambio:', (await pg.inner_text('.tiles')).replace(chr(10), ' ')[:110])
            await pg.goto(BASE + '#/squadre')
            await pg.wait_for_timeout(900)
            print('  squadra:', (await pg.inner_text('.tiles')).replace(chr(10), ' ')[:110],
                  '| partite:', await pg.locator('.esito').count())
            await pg.click('#sqChips [data-squadra="team-Giuseppe"]'); await pg.wait_for_timeout(700)
            assert 'GIUSEPPE' in (await pg.inner_text('.card .sec-h h2')).upper()
        await apri(pw, {}, s6, '6 squadra e testa a testa')

        # 7) il database della stagione non c'è ancora
        async def s7(pg):
            await login(pg)
            print('  entrato lo stesso:', await pg.is_visible('#nav'), '| sezioni:', await pg.locator('#nav a').count())
            print('  avviso:', (await pg.inner_text('#notices')).strip().replace(chr(10), ' | ')[:190])
            print('  home:', (await pg.inner_text('#view')).strip().replace(chr(10), ' | ')[:110])
            for sez in ['squadre/rosa', 'giornata', 'giornata/formazioni', 'classifiche', 'lega', 'squadre/statistiche', 'lega/albo']:
                await pg.goto(BASE + '#/' + sez)
                await pg.wait_for_timeout(600)
                print(f'  {sez}:', (await pg.inner_text('#view')).strip().replace(chr(10), ' | ')[:80])
        await apri(pw, {'ADMIN': '1', 'NOSTAGIONE': '1'}, s7, "7 database della stagione mancante")

        # 8) la navigazione: barra in basso con Schiera al centro, "Altro", riquadro verde in Home
        async def s8(pg):
            await login(pg)
            barra = await pg.eval_on_selector('#nav', 'e => { const r = e.getBoundingClientRect(); return [getComputedStyle(e).position, Math.round(innerHeight - r.bottom)] }')
            voci = [v.strip() for v in await pg.locator('#nav > a, #nav > button').all_inner_texts()]
            print('  barra:', barra, '|', ' · '.join(voci))
            assert barra[0] == 'fixed' and barra[1] == 0, 'la barra non sta in basso'
            visibili = [v.strip() for v in await pg.locator('#nav > a:visible, #nav > button:visible').all_inner_texts()]
            assert visibili == ['Home', 'Giornata', 'Schiera', 'Classifiche', 'Altro'], visibili
            verde = (await pg.inner_text('#schieraBig')).replace(chr(10), ' ')
            print('  riquadro verde in Home:', verde)
            assert 'SCHIERA LA FORMAZIONE' in verde.upper() and await pg.is_visible('#schieraBig')
            assert await pg.locator('#schieraBig [data-conto]').count() == 1, 'manca il conto alla rovescia'
            c1 = await pg.inner_text('#schieraBig [data-conto]'); await pg.wait_for_timeout(1300)
            c2 = await pg.inner_text('#schieraBig [data-conto]')
            print('  conto alla rovescia:', c1, '->', c2)
            assert c1 != c2, 'il conto alla rovescia non scorre'
            assert await pg.locator('#view a[href="schiera/"], #view a[href="#/schiera"]').count() == 0, 'il pulsante nero è ancora nella Home'
            print('  pallino "da schierare":', await pg.locator('#nav .tb-schiera[data-da-fare]').count())
            # "Altro": le sezioni che non stanno nella barra
            await pg.click('#altroBtn'); await pg.wait_for_timeout(300)
            tessere = await pg.locator('.altro-grid a').all_inner_texts()
            print('  pannello:', ' · '.join(tessere))
            assert await pg.locator('.altro .schiera-big').count() == 0
            assert len(tessere) == 2 and tessere[0].strip().upper().startswith('SQUADRE') and tessere[1].strip().upper().startswith('LEGA')
            await pg.click('.altro-grid a[href="#/squadre"]'); await pg.wait_for_timeout(700)
            assert pg.url.endswith('#/squadre') and await pg.locator('.scrim').count() == 0
            assert (await pg.get_attribute('#altroBtn', 'aria-current')) == 'page'
            assert not await pg.is_visible('#schieraBig'), 'il riquadro verde deve stare solo in Home'
            # Schiera dentro il sito: stessa intestazione, stessa barra
            await pg.click('#nav .tb-schiera'); await pg.wait_for_timeout(900)
            print('  Schiera:', pg.url.split('#')[1], '|', (await pg.inner_text('#fileName')), '|',
                  (await pg.inner_text('#conto')).replace(chr(10), ' ')[:80])
            assert pg.url.endswith('#/schiera') and await pg.is_visible('#pitch') and await pg.is_visible('#saveBtn')
            assert not await pg.is_visible('#view') and await pg.is_visible('.crest')
            sb = await pg.eval_on_selector('#bar', 'e => Math.round(innerHeight - e.getBoundingClientRect().bottom)')
            tb = await pg.eval_on_selector('#nav', 'e => Math.round(e.getBoundingClientRect().height)')
            print(f'  barra di Schiera {sb}px dal fondo, barra delle sezioni alta {tb}px')
            assert sb >= tb, 'la barra di Schiera finisce sotto quella delle sezioni'
            for w in (390, 1100):
                await pg.set_viewport_size({'width': w, 'height': 800}); await pg.wait_for_timeout(200)
                sc = await pg.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth')
                pos = await pg.eval_on_selector('#nav', 'e => getComputedStyle(e).position')
                print(f'  {w}px: barra {pos}, scorre di lato: {sc}')
                assert not sc
            await pg.evaluate("location.hash = '#/classifiche'"); await pg.wait_for_timeout(600)
            assert not await pg.is_visible('#pitch') and await pg.is_visible('#view')
            # sul computer (siamo a 1100 px): Schiera è il riquadro verde in ogni sezione, non una voce della barra
            voci_pc = [v.strip() for v in await pg.locator('#nav > a:visible, #nav > button:visible').all_inner_texts()]
            print('  computer, barra:', ' · '.join(voci_pc), '| riquadro in Classifiche:', await pg.is_visible('#schieraBig'))
            assert voci_pc == ['Home', 'Giornata', 'Classifiche', 'Squadre', 'Lega'], voci_pc
            assert await pg.is_visible('#schieraBig')
            await pg.click('#schieraBig'); await pg.wait_for_timeout(800)
            print('  computer, dal riquadro a:', pg.url.split('#')[1], '| riquadro dentro Schiera:', await pg.is_visible('#schieraBig'))
            assert pg.url.endswith('#/schiera') and not await pg.is_visible('#schieraBig') and await pg.is_visible('#pitch')
            await pg.set_viewport_size({'width': 390, 'height': 800}); await pg.evaluate("location.hash = '#/classifiche'"); await pg.wait_for_timeout(600)
            assert not await pg.is_visible('#schieraBig'), 'al telefono il riquadro sta solo in Home'
        await apri(pw, {}, s8, '8 barra, Schiera al centro, riquadro verde in Home')

        FORMAZIONI = os.environ.get('FORMAZIONI', '/home/claude/Formazioni.xls')
        FC = os.environ.get('FC_XLSX', '/tmp/fc_stats.xlsx')
        ENGINE = os.path.join(HERE, '..', '..', '..', 'schiera-formazione', 'src', 'engine.js')

        # 9) Giornata → Formazioni, e le partite non ancora giocate che si toccano
        async def s9(pg):
            await login(pg)
            await pg.goto(BASE + '#/giornata/formazioni'); await pg.wait_for_timeout(1000)
            testa = (await pg.inner_text('.card .sec-h')).replace(chr(10), ' ')
            chip = [c.replace(chr(10), ' ') for c in await pg.locator('.sq-sel .chip').all_inner_texts()]
            visibili = await pg.locator('.form-pan:visible').count()
            print(f'  {testa} | selettore: {" · ".join(chip)}')
            assert 'GIORNATA 5' in testa.upper() and 'in corso' in testa and len(chip) == 8 and visibili == 1
            assert sum('salvata' in c for c in chip) == 3 and sum('non ancora' in c for c in chip) == 5
            # la propria squadra è scelta, l'avversario è subito accanto
            assert chip[0].startswith('Valerio') and (await pg.get_attribute('.sq-sel .chip >> nth=0', 'aria-pressed')) == 'true'
            pan = await pg.inner_text('.form-pan:visible')
            assert pan.upper().startswith('VALERIO') and await pg.locator('.form-pan:visible .prow').count() >= 11
            # tutto il selettore sta in vista, senza scorrere
            assert not await pg.eval_on_selector('.sq-sel', 'e => e.scrollWidth > e.clientWidth')
            alto = await pg.eval_on_selector('.sq-sel', 'e => Math.round(e.getBoundingClientRect().height)')
            print('  selettore alto', alto, 'px | prima:', pan.replace(chr(10), ' ')[:70])
            # un'altra squadra: si cambia senza ricaricare
            await pg.click('.sq-sel .chip:has-text("Colombrita")'); await pg.wait_for_timeout(200)
            pan = await pg.inner_text('.form-pan:visible')
            assert pan.upper().startswith('COLOMBRITA') and 'non ancora schierata' in pan, pan[:80]
            assert await pg.locator('.form-pan:visible').count() == 1
            # "contro …" apre la partita con le due formazioni affiancate
            await pg.click('.sq-sel .chip:has-text("Sebi")'); await pg.wait_for_timeout(200)
            await pg.click('.form-pan:visible .contro'); await pg.wait_for_timeout(900)
            print('  contro:', (await pg.inner_text('.sheet-h')).replace(chr(10), ' · ')[:100])
            await affiancate(pg)
            await pg.click('.sheet [data-act="close"]'); await pg.wait_for_timeout(200)
            # una giornata già giocata: le formazioni del file, con i fantavoti; la squadra scelta resta Sebi
            await pg.click('[data-gio="3"]'); await pg.wait_for_timeout(900)
            chip = [c.replace(chr(10), ' ') for c in await pg.locator('.sq-sel .chip').all_inner_texts()]
            assert all(' pt' in c for c in chip), chip
            mia = await pg.inner_text('.form-pan:visible')
            print('  giornata 3:', ' · '.join(chip)[:90], '|', mia.replace(chr(10), ' ')[:80])
            assert mia.upper().startswith('SEBI') and 'punti' in mia and 'TITOLARI' in mia.upper()
            # Partite: la giornata in corso, una partita da giocare si tocca e mostra le formazioni affiancate
            await pg.click('a.chip[href="#/giornata"]'); await pg.wait_for_timeout(700)
            assert 'GIORNATA 3' in (await pg.inner_text('.card .sec-h')).upper(), 'Partite riparte dalla giornata scelta'
            await pg.click('[data-gio="5"]'); await pg.wait_for_timeout(700)
            await pg.click('.match[data-formazioni]:has-text("Valerio")'); await pg.wait_for_timeout(900)
            foglio = await pg.inner_text('.sheet')
            print('  partita da giocare:', foglio.replace(chr(10), ' ')[:140])
            assert 'formazioni salvate' in foglio and await pg.locator('.sheet .dc .badge').count() >= 11
            await affiancate(pg)
            for w in (360, 1100):
                await pg.set_viewport_size({'width': w, 'height': 800}); await pg.wait_for_timeout(300)
                await affiancate(pg)
        await apri(pw, {'PRELOAD': '1', 'FORMAZIONI': FORMAZIONI}, s9, '9 formazioni della giornata')

        # 10) l'amministratore scarica tutte le formazioni in un file
        async def s10(pg):
            await login(pg)
            await pg.click('#userBtn'); await pg.wait_for_timeout(200)
            assert await pg.is_visible('#tutteBtn') and await pg.is_visible('#fcBtn')
            await pg.click('#tutteBtn'); await pg.wait_for_timeout(1200)
            assert pg.url.endswith('#/giornata/formazioni')
            elenco = await pg.inner_text('.sheet')
            print('  prima di scaricare:', elenco.replace(chr(10), ' ')[:160])
            assert 'Mancano 5' in elenco
            async with pg.expect_download() as dl:
                await pg.click('.sheet [data-act="go"]')
            d = await dl.value
            await d.save_as('/tmp/tutte.xls')
            await pg.wait_for_timeout(500)
            print('  file:', d.suggested_filename, '|', (await pg.inner_text('#notices')).replace(chr(10), ' ')[:150])
            assert d.suggested_filename.endswith('_tutte.xls')
            js = ("const E=require(process.argv[1]),fs=require('fs');const wb=E.load(new Uint8Array(fs.readFileSync('/tmp/tutte.xls')));"
                  "const o={};wb.sheetNames.forEach(n=>{o[n]=wb.roster(n).filter(p=>p.number!=null).map(p=>[p.number,p.name]).sort((a,b)=>a[0]-b[0])});console.log(JSON.stringify(o))")
            fogli = json.loads(subprocess.run(['node', '-e', js, ENGINE], capture_output=True, text=True, check=True).stdout)
            print('  nel file:', {k: len(v) for k, v in fogli.items()})
            assert len(fogli['Valerio']) == 11 and fogli['Valerio'][0][1] == 'Meret'
            assert len(fogli['Sebi']) == 18 and len(fogli['Massimo']) == 18   # nel finto Supabase schierano 18 giocatori
            assert all(len(fogli[k]) == 0 for k in fogli if k not in ('Valerio', 'Sebi', 'Massimo')), 'chi non ha schierato deve avere il foglio vuoto'
        await apri(pw, {'ADMIN': '1', 'PRELOAD': '1', 'FORMAZIONI': FORMAZIONI}, s10, '10 tutte le formazioni in un file')

        # 11) l'amministratore carica le medie di Fantacalcio.it, che compaiono in Rosa
        async def s11(pg):
            await login(pg)
            await pg.goto(BASE + '#/squadre/rosa'); await pg.wait_for_timeout(900)
            assert await pg.locator('.prow.quattro').count() == 0
            print('  prima:', (await pg.inner_text('.card p.small')).replace(chr(10), ' ')[:110])
            await pg.click('#userBtn'); await pg.click('#fcBtn')
            await pg.set_input_files('#fcFile', FC); await pg.wait_for_timeout(1500)
            anteprima = await pg.inner_text('.sheet')
            print('  anteprima:', anteprima.replace(chr(10), ' ')[:150])
            assert '2026/27' in anteprima and 'giocatori nel file' in anteprima
            await pg.click('.sheet [data-act="go"]'); await pg.wait_for_timeout(1500)
            print('  inviato:', json.load(open('/tmp/import_fc.json')), '|', (await pg.inner_text('#notices')).replace(chr(10), ' ')[:90])
            righe = await pg.locator('.prow.quattro:not(.testata)').count()
            fonte = await pg.inner_text('.card p.small')
            print(f'  Rosa: {righe} giocatori con la colonna Serie A |', fonte.replace(chr(10), ' ')[:120])
            assert righe >= 25 and 'Fantacalcio.it' in fonte
            assert await pg.locator('.card p.small a[href="https://www.fantacalcio.it/statistiche-serie-a"]').count() == 1
        try:
            os.remove('/tmp/import_fc.json')
        except Exception:
            pass
        await apri(pw, {'ADMIN': '1'}, s11, '11 medie di Fantacalcio.it')

        # 12) statistiche di squadra e di lega: grafici, numeri e tocchi
        async def s12(pg):
            await login(pg)
            await pg.goto(BASE + '#/squadre/statistiche'); await pg.wait_for_timeout(1200)
            grafici = await pg.locator('svg.chart').count()
            titoli = [t.strip() for t in await pg.locator('.card .sec-h h2, .card .sec-h h3').all_inner_texts()]
            print(f'  squadra: {grafici} grafici ·', ' · '.join(titoli))
            assert grafici == 3 and await pg.locator('.coppia').count() == 4
            assert await pg.locator('details.numeri').count() >= 2
            col = pg.locator('.chart-wrap.tt g[data-tt]').first
            await col.hover(); await pg.wait_for_timeout(300)
            tip = await pg.inner_text('.chart-wrap.tt .tip')
            print('  tocco sulla colonna:', tip.replace(chr(10), ' · '))
            assert 'Giornata' in tip and 'lasciati' in tip
            await pg.goto(BASE + '#/lega'); await pg.wait_for_timeout(1200)
            rec = await pg.locator('.card:first-of-type .prow').count()
            print('  lega: record', rec, '| grafici', await pg.locator('svg.chart').count(),
                  '|', (await pg.inner_text('#view')).replace(chr(10), ' ')[60:200])
            assert rec >= 6 and await pg.locator('svg.chart').count() == 1
            for w in (390, 1100):
                await pg.set_viewport_size({'width': w, 'height': 800}); await pg.wait_for_timeout(300)
                for h in ('#/lega', '#/squadre/statistiche', '#/giornata/formazioni', '#/squadre/rosa'):
                    await pg.evaluate(f"location.hash = '{h}'"); await pg.wait_for_timeout(700)
                    assert not await pg.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth'), (w, h)
            print('  niente scorrimento di lato a 390 e 1100 px')
        await apri(pw, {'PRELOAD': '1', 'FC': FC}, s12, '12 statistiche')

asyncio.run(main())
