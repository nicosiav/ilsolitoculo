import asyncio, os, json, subprocess, time, signal
from playwright.async_api import async_playwright
from sito import scenario, login, modulo, FORMAZIONI

async def main():
    async with async_playwright() as pw:
        # 7) blocco partita per partita
        async def s7(pg):
            await login(pg)
            print('  barra:', await pg.inner_text('#fileMeta'))
            print('  avvisi:', (await pg.inner_text('#schNotices')).strip().replace('\n',' | ')[:160])
            n_locked=await pg.locator('.slot.locked, .row.locked').count()
            print('  posti bloccati in formazione:', n_locked)
            pool_locked=await pg.locator('.pchip.locked').count()
            print('  non schierati bloccati:', pool_locked, '| disabilitati:', await pg.locator('.pchip.locked[disabled]').count())
            # un titolare bloccato non deve aprire il selettore
            if n_locked:
                el=pg.locator('.slot.locked').first
                print('  titolare bloccato disabilitato:', await el.is_disabled())
            # cambio modulo: deve essere rifiutato se sposta un bloccato
            mod_prima=(await modulo(pg))
            await pg.click('[data-mod="3-5-2"]'); await pg.wait_for_timeout(400)
            toast=await pg.locator('.toast').count()
            print('  cambio modulo:', mod_prima, '->', await modulo(pg), '| avviso:',
                  (await pg.inner_text('.toast')) if toast else 'nessuno')
            # salvataggio rifiutato dal database
            await pg.click('#saveBtn'); await pg.wait_for_timeout(500)
            if await pg.locator('[data-act="save"]').count():
                await pg.click('[data-act="save"]'); await pg.wait_for_timeout(600)
            print('  esito salvataggio:', (await pg.inner_text('#schNotices')).strip().replace('\n',' | ')[:120])
        await scenario(pw,'7 blocco partita per partita',{'LOCKED':'1','PRELOAD':'1'},s7)

        # 8) formazioni di giornata pubbliche
        async def s8(pg):
            await login(pg)
            await pg.click('#allBtn'); await pg.wait_for_timeout(800)
            print('  titolo:', (await pg.inner_text('.sheet-h')).replace('\n',' · ')[:80])
            print('  squadre elencate:', await pg.locator('#allBody .team-block, #allBody .xr').count())
            print('  blocco squadre:', (await pg.inner_text('#allBody')).strip().replace('\n',' | ')[:160])
            print('  giornate selezionabili:', await pg.locator('#mdPick option').count())
        await scenario(pw,'8 formazioni di giornata',{'PRELOAD':'1'},s8)

        # 9) ripristino dall'ultima formazione salvata (giornate precedenti)
        async def s9(pg):
            await login(pg)
            print('  prima:', await modulo(pg), '| contatore', await pg.inner_text('#count'))
            await pg.click('#restoreBtn'); await pg.wait_for_timeout(900)
            print('  dopo:', await modulo(pg), '| contatore', await pg.inner_text('#count'))
            print('  avviso:', (await pg.inner_text('#schNotices')).strip().replace('\n',' | ')[:140])
            print('  titolare 1:', await pg.inner_text('[data-z="s"][data-i="0"] .nm'))
        await scenario(pw,'9 ripristino da giornata precedente',{'PREV':'1'},s9)

        # 10) amministratore: calendario e squadre dei giocatori
        async def s10(pg):
            await login(pg)
            await pg.click('#userBtn'); await pg.wait_for_timeout(200)
            print('  voci admin:', await pg.is_visible('#calBtn'), await pg.is_visible('#clubBtn'))
            await pg.click('#calBtn'); await pg.wait_for_timeout(300)
            await pg.click('[data-act="go"]'); await pg.wait_for_timeout(1500)
            print('  sync:', json.load(open('/tmp/sync.json'))['q'] if os.path.exists('/tmp/sync.json') else 'mancante')
            print('  avviso:', (await pg.inner_text('#schNotices')).strip().replace('\n',' | ')[:160])
            await pg.click('#userBtn'); await pg.click('#clubBtn'); await pg.wait_for_timeout(800)
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
            print('  avviso:', (await pg.inner_text('#schNotices')).strip().replace('\n',' | ')[:140])
            print('  foglio di conferma aperto:', await pg.locator('.sheet-h').count())
        await scenario(pw,'11 salvataggio rifiutato dal database',{'FORCE_P0007':'1'},s11)

asyncio.run(main())
