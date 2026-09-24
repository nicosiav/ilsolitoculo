import asyncio, os, json, subprocess, time, signal
from playwright.async_api import async_playwright
from sito import scenario, login, modulo, FORMAZIONI

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
            assert 'Giornata 5 (7' in await pg.inner_text('#fileName'), 'manca la doppia numerazione'
            print('  sub:', await modulo(pg), '| login nascosto:', not await pg.is_visible('#loginCard'))
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
            # anche in un browser che dice di saper condividere file, il tasto non deve esserci
            await pg.evaluate("navigator.canShare = () => true; navigator.share = async () => {}")
            async with pg.expect_download() as dl:
                await pg.click('[data-act="export"]')
            d=await dl.value; await d.save_as('/tmp/export_online.xls')
            print('  export:', d.suggested_filename, '| log export:', os.path.exists('/tmp/last_export.json'))
            await pg.wait_for_timeout(300)
            piede = (await pg.inner_text('.sheet-f')).strip()
            print('  tasti dopo l\'export:', piede.replace('\n', ' | '))
            assert await pg.locator('[data-act="share"]').count() == 0, 'il tasto Condividi è ancora lì'
            assert 'Condividi' not in piede
            # storico
            await pg.click('[data-act="close"]'); await pg.click('#logBtn'); await pg.wait_for_timeout(400)
            print('  storico:', (await pg.inner_text('.sheet-b')).strip().split('\n')[0][:70])
        await scenario(pw,'2 login + salvataggio + export',{},s2)

        # 3) formazione già salvata: deve ricomparire
        async def s3(pg):
            await login(pg)
            print('  avviso:', (await pg.inner_text('#schNotices')).strip()[:70])
            print('  titolare 1:', await pg.inner_text('[data-z="s"][data-i="0"] .nm'), '| modulo:', await modulo(pg))
        await scenario(pw,'3 formazione precedente',{'PRELOAD':'1'},s3)

        # 4) giornata chiusa
        async def s4(pg):
            await login(pg)
            print('  avviso:', (await pg.inner_text('#schNotices')).strip()[:80])
            print('  salva disabilitato:', await pg.is_disabled('#saveBtn'), '| slot disabilitato:', await pg.is_disabled('[data-z="b"][data-i="0"]'))
        await scenario(pw,'4 giornata chiusa',{'CLOSED':'1','PRELOAD':'1'},s4)
asyncio.run(main())

async def admin_tests():
    async with async_playwright() as pw:
        async def s5(pg):
            await login(pg)
            await pg.click('#userBtn'); await pg.wait_for_timeout(200)
            print('  menu admin visibile:', await pg.is_visible('#rosterBtn'), await pg.is_visible('#matchdayBtn'))
            # aggiornamento rose
            await pg.set_input_files('#adminFile',FORMAZIONI); await pg.wait_for_timeout(800)
            print('  conferma:', (await pg.inner_text('.sheet-h')).replace('\n',' · '))
            await pg.click('[data-act="go"]'); await pg.wait_for_timeout(2500)
            imported=[l for l in open('/tmp/import.log')] if os.path.exists('/tmp/import.log') else []
            print('  squadre importate:', len(imported), '| modello caricato:', os.path.exists('/tmp/upload.flag'))
            print('  avviso:', (await pg.inner_text('#schNotices')).strip()[:80])
            # giornata corrente
            await pg.click('#userBtn'); await pg.click('#matchdayBtn'); await pg.wait_for_timeout(300)
            await pg.fill('#mdId','9'); await pg.fill('#mdLabel','Giornata 9'); await pg.fill('#mdDeadline','2026-10-04T18:00')
            await pg.click('[data-act="go"]'); await pg.wait_for_timeout(1200)
            md=json.load(open('/tmp/matchday.json'))
            print('  giornata impostata:', md['p_id'], md['p_label'], md['p_deadline'][:16])
        await scenario(pw,'5 amministratore',{'ADMIN':'1'},s5)

        async def s6(pg):
            await login(pg)
            await pg.click('#userBtn'); await pg.wait_for_timeout(200)
            print('  menu admin per un giocatore normale:', await pg.is_visible('#rosterBtn'))
        await scenario(pw,'6 giocatore normale',{},s6)
asyncio.run(admin_tests())
