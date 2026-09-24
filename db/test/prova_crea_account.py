#!/usr/bin/env python3
"""Prova db/crea_account.py contro un finto Supabase (Admin API + PostgREST), senza rete.

    python3 db/test/prova_crea_account.py

Controlla: prova a vuoto che non tocca niente, creazione degli account nuovi,
collegamento alla squadra e al ruolo, account già esistenti lasciati con la
loro password, --nuova-password, squadre scritte in modo diverso, errori chiari
su squadra sconosciuta e indirizzo d'esempio, credenziali.txt.
"""
import http.server
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import threading
import uuid

QUI = pathlib.Path(__file__).resolve().parent
SCRIPT = QUI.parent / 'crea_account.py'
CHIAVE = 'finta-service-role'
SQUADRE = [{'id': str(uuid.uuid4()), 'name': n, 'sheet_name': n}
           for n in ['Massimo', 'Giovanni', 'Colombrita', 'Giuseppe', 'MarcoI', 'MarcoII', 'Valerio', 'Sebi']]
STATO = {'utenti': {}, 'profili': {}, 'chiamate': []}


def nuovo_utente(email, pwd, meta=None):
    uid = str(uuid.uuid4())
    STATO['utenti'][uid] = {'id': uid, 'email': email, 'password': pwd, 'user_metadata': meta or {}}
    # come il trigger on_auth_user_created
    STATO['profili'][uid] = {'id': uid, 'display_name': (meta or {}).get('display_name') or email.split('@')[0],
                             'role': 'player', 'team_id': None}
    return STATO['utenti'][uid]


class Finto(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def rispondi(self, codice, corpo):
        dati = json.dumps(corpo).encode()
        self.send_response(codice)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(dati)))
        self.end_headers()
        self.wfile.write(dati)

    def corpo(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'null')

    def gestisci(self, metodo):
        STATO['chiamate'].append((metodo, self.path))
        if self.headers.get('apikey') != CHIAVE or self.headers.get('Authorization') != 'Bearer ' + CHIAVE:
            return self.rispondi(401, {'msg': 'chiave sbagliata'})
        p = self.path
        if metodo == 'GET' and p.startswith('/auth/v1/admin/users'):
            pagina = int(re.search(r'page=(\d+)', p).group(1))
            tutti = list(STATO['utenti'].values())
            return self.rispondi(200, {'users': tutti[(pagina - 1) * 200: pagina * 200]})
        if metodo == 'POST' and p == '/auth/v1/admin/users':
            b = self.corpo()
            if any(u['email'] == b['email'] for u in STATO['utenti'].values()):
                return self.rispondi(422, {'msg': 'already registered'})
            assert b.get('email_confirm') is True, 'l\'account deve nascere confermato'
            return self.rispondi(200, nuovo_utente(b['email'], b['password'], b.get('user_metadata')))
        m = re.fullmatch(r'/auth/v1/admin/users/([0-9a-f-]+)', p)
        if metodo == 'PUT' and m:
            STATO['utenti'][m.group(1)]['password'] = self.corpo()['password']
            return self.rispondi(200, STATO['utenti'][m.group(1)])
        if metodo == 'GET' and p.startswith('/rest/v1/teams'):
            return self.rispondi(200, SQUADRE)
        m = re.fullmatch(r'/rest/v1/profiles\?id=eq\.([0-9a-f-]+)', p)
        if metodo == 'PATCH' and m:
            prof = STATO['profili'].get(m.group(1))
            if not prof:
                return self.rispondi(200, [])
            prof.update(self.corpo())
            return self.rispondi(200, [prof])
        if metodo == 'POST' and p == '/rest/v1/profiles':
            b = self.corpo()
            STATO['profili'][b['id']] = b
            return self.rispondi(201, [b])
        return self.rispondi(404, {'msg': 'non previsto: ' + metodo + ' ' + p})

    def do_GET(self):
        self.gestisci('GET')

    def do_POST(self):
        self.gestisci('POST')

    def do_PUT(self):
        self.gestisci('PUT')

    def do_PATCH(self):
        self.gestisci('PATCH')


def lancia(csv_testo, *opzioni, cartella):
    f = pathlib.Path(cartella) / 'account.csv'
    f.write_text(csv_testo, encoding='utf-8')
    env = dict(os.environ, SUPABASE_URL=URL, SUPABASE_SERVICE_ROLE_KEY=CHIAVE)
    return subprocess.run([sys.executable, str(SCRIPT), str(f), *opzioni], env=env,
                          capture_output=True, text=True)


def profilo(email):
    uid = next(u['id'] for u in STATO['utenti'].values() if u['email'] == email)
    p = STATO['profili'][uid]
    squadra = next((t['name'] for t in SQUADRE if t['id'] == p['team_id']), None)
    return squadra, p['role'], p['display_name'], STATO['utenti'][uid]['password']


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Finto)
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{server.server_port}'
ok = 0


def controlla(cond, cosa):
    global ok
    if not cond:
        raise SystemExit('NO: ' + cosa)
    ok += 1
    print('  ok ', cosa)


# Valerio ha già un account (è l'amministratore che lancia lo script)
nuovo_utente('valerio@prova.it', 'la-sua-password')
CSV = ('email,squadra,nome,ruolo\n'
       'massimo@prova.it,Massimo,,\n'
       'marco1@prova.it,Marco I,Marco I,giocatore\n'
       'VALERIO@prova.it,valerio,Valerio,amministratore\n')

with tempfile.TemporaryDirectory() as tmp:
    CREDENZIALI = pathlib.Path(tmp) / 'credenziali.txt'
    print('prova a vuoto')
    r = lancia(CSV, cartella=tmp)
    controlla(r.returncode == 0, 'termina senza errori: ' + r.stderr.strip()[:200])
    controlla('[PROVA' in r.stdout, 'dice che è una prova')
    controlla(not any(m in ('POST', 'PUT', 'PATCH') for m, _ in STATO['chiamate']), 'non scrive niente')
    controlla(len(STATO['utenti']) == 1, 'nessun account creato')
    controlla('Squadre senza nessun account' in r.stdout and 'Giovanni' in r.stdout, 'elenca le squadre scoperte')

    print('davvero')
    r = lancia(CSV, '--davvero', cartella=tmp)
    controlla(r.returncode == 0, 'termina senza errori: ' + r.stderr.strip()[:200])
    controlla(len(STATO['utenti']) == 3, 'due account nuovi')
    sq, ruolo, nome, pwd = profilo('massimo@prova.it')
    controlla((sq, ruolo, nome) == ('Massimo', 'player', 'Massimo'), 'Massimo: squadra, giocatore, nome dalla squadra')
    controlla(re.fullmatch(r'[a-z]+-[2-9]{4}', pwd) is not None, 'password provvisoria leggibile (' + pwd + ')')
    sq, ruolo, nome, _ = profilo('marco1@prova.it')
    controlla((sq, ruolo, nome) == ('MarcoI', 'player', 'Marco I'), '"Marco I" riconosciuto come MarcoI')
    sq, ruolo, nome, pwd = profilo('valerio@prova.it')
    controlla((sq, ruolo) == ('Valerio', 'admin'), 'account esistente collegato, amministratore')
    controlla(pwd == 'la-sua-password', 'la password di chi c\'era già non cambia')
    testo = CREDENZIALI.read_text(encoding='utf-8')
    controlla(testo.count('Password provvisoria') == 2 and 'valerio@prova.it' not in testo,
              'credenziali.txt: solo i due nuovi')
    controlla('https://nicosiav.github.io/ilsolitoculo/' in testo and 'Cambia password' in testo
              and '.xls' in testo, 'il messaggio ha link, istruzioni e promemoria del file .xls')

    print('di nuovo, con --nuova-password')
    r = lancia(CSV, '--davvero', '--nuova-password', cartella=tmp)
    controlla(r.returncode == 0 and len(STATO['utenti']) == 3, 'nessun doppione')
    controlla(profilo('valerio@prova.it')[3] != 'la-sua-password', 'password rinnovata')
    controlla(CREDENZIALI.read_text(encoding='utf-8').count('Password provvisoria') == 3, 'tre messaggi')

    print('errori')
    r = lancia('email,squadra\nx@prova.it,Juventus\n', cartella=tmp)
    controlla(r.returncode != 0 and 'Juventus' in r.stderr and 'Massimo' in r.stderr, 'squadra sconosciuta: dice quali ci sono')
    r = lancia((QUI.parent / 'account-esempio.csv').read_text(encoding='utf-8'), cartella=tmp)
    controlla(r.returncode != 0 and 'esempio' in r.stderr, 'il file d\'esempio va compilato prima')
    r = lancia('email,squadra,nome,ruolo\nx@prova.it,Sebi,,capitano\n', cartella=tmp)
    controlla(r.returncode != 0 and 'capitano' in r.stderr, 'ruolo sconosciuto')

server.shutdown()
print(f'\n{ok} controlli passati')
