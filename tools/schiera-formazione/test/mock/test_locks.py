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
            # cambio modulo: se sposta un bloccato il modulo non si può scegliere (e dice perché)
            b=pg.locator('[data-mod="3-5-2"]')
            print('  3-5-2 spento:', await b.is_disabled(), '|', await b.get_attribute('title'))
            assert await b.is_disabled()
            # salvataggio rifiutato dal database
            await pg.click('#saveBtn'); await pg.wait_for_timeout(500)
            if await pg.locator('[data-act="save"]').count():
                await pg.click('[data-act="save"]'); await pg.wait_for_timeout(600)
            print('  esito salvataggio:', (await pg.inner_text('#schNotices')).strip().replace('\n',' | ')[:120])
        await scenario(pw,'7 blocco partita per partita',{'LOCKED':'1','PRELOAD':'1'},s7)

        # 8) formazioni di giornata pubbliche
        async def s8(pg):
            await login(pg)
            # dentro il sito "Formazioni di giornata" porta a Giornata → Formazioni
            await pg.click('#allBtn'); await pg.wait_for_timeout(1200)
            print('  indirizzo:', pg.url.split('#')[1], '| Schiera nascosta:', not await pg.is_visible('#pitch'))
            assert pg.url.endswith('#/giornata/formazioni') and not await pg.is_visible('#pitch')
            # in cima il selettore delle squadre: chi ha salvato ha "✓ salvata"
            n = await pg.locator('.sq-sel .chip').count(); salvate = await pg.locator('.sq-sel .chip span.ok').count()
            print('  squadre elencate:', n, '| con la formazione salvata:', salvate)
            assert n == 8 and salvate >= 1
            mia = (await pg.inner_text('.form-pan:visible')).strip()
            print('  la mia:', mia.replace('\n',' | ')[:120])
            assert mia.upper().startswith('VALERIO')
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

        # 12) il caso di Lucca: primo panchinaro dell'attacco già bloccato
        async def s12(pg):
            await login(pg)
            avv=(await pg.inner_text('#schNotices')).strip().replace('\n',' | ')
            print('  avvisi:', avv[:260])
            assert 'Davis K. è in panchina (17): Woltemade e Ramos G., messi prima di lui' in avv
            # il titolare 11 (Ramos G.): il secondo panchinaro e gli extra sono fermi, Woltemade si scambia
            await pg.click('[data-z="s"][data-i="10"]'); await pg.wait_for_timeout(300)
            righe=await pg.locator('.sheet [data-pick]').all()
            stato={}
            for r in righe:
                stato[(await r.inner_text()).split('\n')[1]]=(await r.is_disabled(), (await r.inner_text()).split('\n')[-1])
            print('  selettore:', stato)
            print('  spiegazione:', (await pg.inner_text('.sheet .spiega'))[:120])
            assert stato['Yeboah J.'][0] and 'fermo per Davis K.' in stato['Yeboah J.'][1]
            assert stato['Camarda'][0] and stato['Geubbels'][0] and stato['Davis K.'][0]
            assert not stato['Woltemade'][0]
            assert not await pg.locator('[data-act="clear"]').count(), 'Svuota posto non deve esserci'
            await pg.click('.sheet [data-pick] >> text=Woltemade'); await pg.wait_for_timeout(300)
            print('  dopo lo scambio:', await pg.inner_text('[data-z="s"][data-i="9"] .nm'), '/', await pg.inner_text('[data-z="s"][data-i="10"] .nm'))
            assert await pg.inner_text('[data-z="s"][data-i="9"] .nm') == 'Ramos G.'
            # i moduli che cambiano i titolari in attacco sono spenti; 3-5-2 e 5-3-2 no
            spenti=[await b.get_attribute('data-mod') for b in await pg.locator('[data-mod][disabled]').all()]
            print('  moduli spenti:', spenti)
            assert set(spenti)=={'3-4-3','4-3-3','4-5-1','5-4-1'}
            # Svuota: restano i bloccati e chi li precede nel reparto
            await pg.click('#clearBtn'); await pg.wait_for_timeout(300)
            print('  svuota:', await pg.inner_text('#count'), '|', await pg.inner_text('.toast'))
            assert await pg.inner_text('#count') == '5/22'
            # il database (finto) riceve una formazione che rispetta le regole
            await pg.click('#saveBtn'); await pg.wait_for_timeout(400)
            if await pg.locator('[data-act="save"]').count():
                await pg.click('[data-act="save"]'); await pg.wait_for_timeout(700)
            print('  salvata:', await pg.locator('.sheet h4').first.inner_text() if await pg.locator('.sheet h4').count() else (await pg.inner_text('#schNotices'))[:120])
        await scenario(pw,'12 panchinaro bloccato: il reparto davanti resta fermo',{'LOCKED':'1','PANCA':'1'},s12)

        # 13) mezz'ora prima: la partita fra 20 minuti è già bloccata
        async def s13(pg):
            await login(pg)
            t=await pg.inner_text('[data-z="s"][data-i="0"]')
            print('  titolare 1:', t.replace('\n',' '), '| bloccato:', await pg.locator('[data-z="s"][data-i="0"].locked').count())
            assert await pg.locator('[data-z="s"][data-i="0"].locked').count() == 1
            conto=(await pg.inner_text('#conto')).replace('\n',' ')
            print('  conto:', conto[:200])
            assert 'si blocca fra' in conto.lower() and '30 minuti prima' in conto
        await scenario(pw,"13 blocco mezz'ora prima",{'LOCK30':'1','PRELOAD':'1'},s13)

        # 14) scadenza passata: niente più modifiche, e il sito lo dice
        async def s14(pg):
            await login(pg)
            conto=(await pg.inner_text('#conto')).replace('\n',' ')
            print('  conto:', conto[:160])
            assert 'formazioni chiuse' in conto.lower() and 'scrivi all’amministratore' in conto
            print('  salva spento:', await pg.is_disabled('#saveBtn'), '| campo spento:', await pg.is_disabled('[data-z="s"][data-i="3"]'),
                  '| moduli spenti:', await pg.locator('[data-mod][disabled]').count())
            assert await pg.is_disabled('#saveBtn') and await pg.is_disabled('[data-z="s"][data-i="3"]')
            await pg.evaluate("location.hash = '#/'"); await pg.wait_for_timeout(800)
            tile=(await pg.inner_text('#schieraBig')).replace('\n',' ')
            print('  riquadro in Home:', tile)
            assert 'scadenza passata' in tile
        await scenario(pw,'14 scadenza passata',{'SCADUTA':'1','PRELOAD':'1'},s14)

        # 15) l'amministratore modifica la formazione di un'altra squadra (anche a scadenza passata)
        async def s15(pg):
            try: os.remove('/tmp/admin_save.json')
            except Exception: pass
            await login(pg)
            print('  menu squadre:', await pg.is_visible('#teamField'), (await pg.inner_text('#teamField')).replace('\n',' ')[:120])
            await pg.select_option('#sheetSel', 'team-Sebi'); await pg.wait_for_timeout(900)
            print('  barra:', await pg.inner_text('#fileName'), '|', await pg.inner_text('#fileMeta'))
            avv=(await pg.inner_text('#schNotices')).strip().replace('\n',' | ')
            print('  avvisi:', avv[:160])
            assert 'come amministratore' in avv and 'Sebi' in await pg.inner_text('#fileName')
            print('  campo attivo a scadenza passata:', not await pg.is_disabled('[data-z="s"][data-i="1"]'), '| conto nascosto:', await pg.is_hidden('#conto'))
            assert not await pg.is_disabled('[data-z="s"][data-i="1"]')
            # tocca il primo non schierato e salva con la nota
            await pg.click('.pchip >> nth=0'); await pg.wait_for_timeout(200)
            await pg.click('#saveBtn'); await pg.wait_for_timeout(400)
            if await pg.locator('[data-act="save"]').count():
                await pg.click('[data-act="save"]'); await pg.wait_for_timeout(400)
            print('  foglio:', (await pg.inner_text('.sheet h4')))
            await pg.fill('#admNota', 'Comunicata su WhatsApp alle 11.40')
            await pg.click('[data-act="go"]'); await pg.wait_for_timeout(900)
            inv=json.load(open('/tmp/admin_save.json'))
            print('  inviato:', inv['p_team'], inv['p_nota'], len(inv['p_slots']), 'posti')
            assert inv['p_team']=='team-Sebi' and inv['p_nota'].startswith('Comunicata')
            print('  conferma:', (await pg.inner_text('.sheet .sheet-b p'))[:140])
            await pg.click('[data-act="close"]')
            # nella pagina Formazioni del sito la modifica si vede, con la nota
            await pg.evaluate("location.hash = '#/giornata/formazioni'"); await pg.wait_for_timeout(1200)
            chip=await pg.inner_text('[data-form-sq="team-Sebi"]')
            print('  selettore:', chip.replace('\n',' '))
            await pg.click('[data-form-sq="team-Sebi"]'); await pg.wait_for_timeout(300)
            box=await pg.inner_text('.form-pan:visible .avv-admin')
            print('  avviso pubblico:', box.replace('\n',' ')[:200])
            assert 'Modificata dall’amministratore' in box and 'WhatsApp' in box
            # dal pannello di un'altra squadra si torna in Schiera con quella squadra
            await pg.click('[data-form-sq="team-Massimo"]'); await pg.wait_for_timeout(200)
            await pg.click('.form-pan:visible [data-adm-form]'); await pg.wait_for_timeout(1200)
            print('  da Formazioni:', pg.url.split('#')[1], '|', await pg.inner_text('#fileName'))
            assert 'Massimo' in await pg.inner_text('#fileName')
            # e si torna alla propria
            await pg.click('#schNotices button >> text=Torna alla tua'); await pg.wait_for_timeout(900)
            print('  di nuovo:', await pg.inner_text('#fileName'), '|', await pg.inner_text('#fileMeta'))
            assert 'Valerio' in await pg.inner_text('#fileName')
        await scenario(pw,"15 l'amministratore modifica un'altra squadra",{'ADMIN':'1','PRELOAD':'1','SCADUTA':'1'},s15)

        # 16) la squadra che ha "subito" la modifica la vede, in Schiera e in Formazioni
        async def s16(pg):
            await login(pg)
            avv=(await pg.inner_text('#schNotices')).strip().replace('\n',' | ')
            print('  avvisi:', avv[:220])
            assert "L’amministratore (Sebi) ha modificato la tua formazione" in avv and 'WhatsApp' in avv
            print('  barra:', await pg.inner_text('#fileMeta'))
            await pg.click('#logBtn'); await pg.wait_for_timeout(500)
            st=(await pg.inner_text('.sheet .sheet-b')).replace('\n',' ')
            print('  storico:', st[:160])
            assert 'dall’amministratore (Sebi)' in st
            await pg.click('.sheet .btn-primary')
            await pg.evaluate("location.hash = '#/giornata/formazioni'"); await pg.wait_for_timeout(1200)
            print('  pagina Formazioni:', (await pg.inner_text('.form-pan:visible .avv-admin')).replace('\n',' ')[:160])
        await scenario(pw,'16 la squadra vede la modifica',{'PRELOAD':'1','ADMIN_MOD':'1'},s16)

        # 17) l'amministratore sposta la scadenza di una giornata, poi torna a quella del calendario
        async def s17(pg):
            try: os.remove('/tmp/scadenza.json')
            except Exception: pass
            await login(pg)
            await pg.click('#userBtn'); await pg.click('#scadBtn'); await pg.wait_for_timeout(600)
            print('  foglio:', (await pg.inner_text('.sheet')).replace('\n',' ')[:220])
            await pg.fill('#scadVal', '2026-12-20T11:30')
            await pg.click('[data-act="go"]'); await pg.wait_for_timeout(1200)
            print('  scelta:', json.load(open('/tmp/scadenza.json')))
            print('  avviso:', (await pg.inner_text('#schNotices')).strip().replace('\n',' | ')[:160])
            await pg.click('#userBtn'); await pg.click('#scadBtn'); await pg.wait_for_timeout(600)
            await pg.click('[data-act="auto"]'); await pg.wait_for_timeout(1200)
            print('  di nuovo dal calendario:', json.load(open('/tmp/scadenza.json')))
            assert json.load(open('/tmp/scadenza.json'))['p_scadenza'] is None
        await scenario(pw,"17 scadenza scelta dall'amministratore",{'ADMIN':'1'},s17)

        # 18) database senza db/12_scadenze.sql: Schiera funziona come prima
        async def s18(pg):
            await login(pg)
            print('  barra:', await pg.inner_text('#fileMeta'), '| conto:', (await pg.inner_text('#conto')).replace('\n',' ')[:80])
            assert await pg.locator('[data-z="s"]').count() == 11
        await scenario(pw,'18 senza le scadenze nel database',{'NOSCAD':'1','PRELOAD':'1'},s18)

asyncio.run(main())
