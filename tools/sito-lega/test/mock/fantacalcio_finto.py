"""Un finto Excel delle "Statistiche Serie A" di Fantacalcio.it, per le prove.

Stessa forma del file vero (riga del titolo, poi Id, R, Rm, Nome, Squadra, Pv,
Mv, Fm, Gf, Gs, Rp, Rc, R+, R-, Ass, Amm, Esp, Au), con i giocatori delle rose
del finto Supabase e qualche giocatore che nelle rose non c'è. I numeri sono
inventati ma sempre gli stessi.

    python3 fantacalcio_finto.py /tmp/fc_stats.xlsx [/tmp/rose.json] [--listone listone.json]
    (con --xls salva anche la copia .xls accanto, se c'è LibreOffice; con --listone
    aggiunge gli svincolati del LISTONE: [{ruolo, nome, squadra}], vedi il README)
"""
import json, random, subprocess, sys, pathlib
from openpyxl import Workbook

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else '/tmp/fc_stats.xlsx')
dopo_listone = sys.argv.index('--listone') + 1 if '--listone' in sys.argv else -1
rose = json.load(open(next((a for i, a in enumerate(sys.argv[2:], 2) if a.endswith('.json') and i != dopo_listone), '/tmp/rose.json')))
rnd = random.Random(7)
CLUBS = ['Atalanta', 'Bologna', 'Cagliari', 'Como', 'Cremonese', 'Fiorentina', 'Genoa', 'Inter', 'Juventus', 'Lazio',
         'Lecce', 'Milan', 'Napoli', 'Parma', 'Pisa', 'Roma', 'Sassuolo', 'Torino', 'Udinese', 'Verona']

wb = Workbook()
ws = wb.active
ws.title = 'Tutti'
ws.append(['Statistiche Fantacalcio Stagione 2026/27'])
ws.merge_cells('A1:R1')
ws.append(['Id', 'R', 'Rm', 'Nome', 'Squadra', 'Pv', 'Mv', 'Fm', 'Gf', 'Gs', 'Rp', 'Rc', 'R+', 'R-', 'Ass', 'Amm', 'Esp', 'Au'])
n = 100
visti = set()
for squadra, giocatori in rose.items():
    for i, p in enumerate(giocatori):
        if not p.get('name') or p['name'] in visti:
            continue
        visti.add(p['name'])
        n += 1
        pv = rnd.randint(0, 6)
        mv = round(rnd.uniform(5.5, 7.0) * 2) / 2 if pv else 0
        gf = rnd.randint(0, 3) if p['role'] in 'CA' and pv else 0
        fm = mv + gf * 3 / max(pv, 1) if pv else 0
        ws.append([n, p['role'], '', p['name'], CLUBS[(n * 7) % len(CLUBS)], pv, round(mv, 2), round(fm, 2), gf,
                   rnd.randint(2, 9) if p['role'] == 'P' and pv else 0, 0, 0, 0, 0, rnd.randint(0, 2), rnd.randint(0, 2), 0, 0])
if '--listone' in sys.argv:
    for x in json.load(open(sys.argv[sys.argv.index('--listone') + 1])):
        if x['nome'] in visti:
            continue
        visti.add(x['nome'])
        n += 1
        r = x['ruolo']
        pv = rnd.choice([0, 0, 1, 2, 3, 4, 5, 6])
        mv = round(rnd.uniform(5.5, 6.8) * 2) / 2 if pv else 0
        gf = rnd.randint(0, 2) if r in 'CA' and pv else 0
        fm = mv + gf * 3 / max(pv, 1) if pv else 0
        ws.append([n, r, '', x['nome'], x.get('squadra') or 'Pisa', pv, round(mv, 2), round(fm, 2), gf,
                   rnd.randint(1, 8) if r == 'P' and pv else 0, rnd.randint(0, 1) if r == 'P' and pv else 0, 0, 0, 0,
                   rnd.randint(0, 2) if pv else 0, rnd.randint(0, 2) if pv else 0, rnd.choice([0, 0, 0, 1]) if pv else 0, 0])
for nome, r in [('Calciatore Svincolato', 'C'), ('Portiere Riserva', 'P')]:
    n += 1
    ws.append([n, r, '', nome, 'Pisa', 1, 6, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
wb.save(out)
print('scritto', out, n - 100, 'giocatori')
if '--xls' in sys.argv:
    subprocess.run(['soffice', '--headless', '--convert-to', 'xls', '--outdir', str(out.parent), str(out)],
                   check=True, capture_output=True)
    print('scritto', out.with_suffix('.xls'))
