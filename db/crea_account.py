#!/usr/bin/env python3
"""Crea gli account dei partecipanti su Supabase e li collega alla loro squadra.

    export SUPABASE_URL=https://<progetto>.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=<chiave service_role>    # Project Settings -> API
    python3 db/crea_account.py db/account.csv                # prova: dice cosa farebbe, non tocca niente
    python3 db/crea_account.py db/account.csv --davvero      # crea e collega

La chiave service_role apre tutto il database: si usa solo da qui, dal tuo
computer. Mai nel sito, mai nella repo, mai in chat.

account.csv, una riga per partecipante (c'è un esempio in db/account-esempio.csv):

    email,squadra,nome,ruolo
    mario.rossi@gmail.com,Massimo,Massimo,giocatore

  squadra   come in teams.name (MarcoI e "Marco I" vanno bene tutti e due)
  nome      come compare nel sito (vuoto = il nome della squadra)
  ruolo     giocatore | amministratore (vuoto = giocatore)

Chi non ha ancora un account lo riceve con una password provvisoria, già
confermato: nessuna email parte da Supabase. Chi ce l'ha già viene solo
collegato alla squadra; la password resta la sua (con --nuova-password se ne
genera una nuova anche per lui).

Alla fine scrive credenziali.txt, accanto al file .csv, con un messaggio
pronto da mandare su WhatsApp a ciascuno. Contiene password: non va nella
repo (è in .gitignore), cancellalo dopo averle mandate.

Usa solo la libreria standard di Python.
"""
import csv
import json
import os
import pathlib
import re
import secrets
import sys
import urllib.error
import urllib.request

SITO = 'https://nicosiav.github.io/ilsolitoculo/'
PAROLE = ['pallone', 'rigore', 'traversa', 'palo', 'corner', 'derby', 'tunnel', 'cucchiaio',
          'rovesciata', 'panchina', 'dribbling', 'fuorigioco', 'mezzala', 'libero', 'tackle']


def chiave(nome):
    return re.sub(r'[^A-Z0-9]', '', str(nome or '').upper())


def password():
    return secrets.choice(PAROLE) + '-' + ''.join(secrets.choice('23456789') for _ in range(4))


class Supabase:
    def __init__(self, url, key):
        self.url = url.rstrip('/')
        self.key = key

    def chiama(self, metodo, percorso, corpo=None, extra=None):
        h = {'apikey': self.key, 'Authorization': 'Bearer ' + self.key, 'Content-Type': 'application/json'}
        h.update(extra or {})
        dati = json.dumps(corpo).encode() if corpo is not None else None
        req = urllib.request.Request(self.url + percorso, data=dati, method=metodo, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                testo = r.read().decode() or 'null'
                return json.loads(testo)
        except urllib.error.HTTPError as e:
            raise SystemExit(f'{metodo} {percorso}: {e.code} {e.read().decode()[:300]}')

    def utenti(self):
        tutti, pagina = [], 1
        while True:
            r = self.chiama('GET', f'/auth/v1/admin/users?page={pagina}&per_page=200')
            lista = r.get('users', []) if isinstance(r, dict) else r
            tutti += lista
            if len(lista) < 200:
                return tutti
            pagina += 1

    def crea_utente(self, email, pwd, nome):
        return self.chiama('POST', '/auth/v1/admin/users',
                           {'email': email, 'password': pwd, 'email_confirm': True,
                            'user_metadata': {'display_name': nome}})

    def cambia_password(self, uid, pwd):
        return self.chiama('PUT', f'/auth/v1/admin/users/{uid}', {'password': pwd})

    def squadre(self):
        return self.chiama('GET', '/rest/v1/teams?select=id,name,sheet_name&order=name')

    def collega(self, uid, team_id, nome, ruolo):
        valori = {'team_id': team_id, 'display_name': nome, 'role': ruolo}
        r = self.chiama('PATCH', f'/rest/v1/profiles?id=eq.{uid}', valori, {'Prefer': 'return=representation'})
        if not r:   # profilo non creato dal trigger: lo creiamo noi
            self.chiama('POST', '/rest/v1/profiles', dict(valori, id=uid), {'Prefer': 'return=representation'})


def leggi_csv(percorso):
    righe = []
    with open(percorso, newline='', encoding='utf-8-sig') as f:
        for n, r in enumerate(csv.DictReader(f), start=2):
            r = {k.strip().lower(): (v or '').strip() for k, v in r.items() if k}
            if not r.get('email') or r['email'].startswith('#'):
                continue
            ruolo = (r.get('ruolo') or 'giocatore').lower()
            if ruolo not in ('giocatore', 'amministratore', 'player', 'admin'):
                raise SystemExit(f'riga {n}: ruolo "{ruolo}" sconosciuto (giocatore o amministratore)')
            r['ruolo'] = 'admin' if ruolo in ('amministratore', 'admin') else 'player'
            if '@' not in r['email']:
                raise SystemExit(f'riga {n}: "{r["email"]}" non sembra un\'email')
            if r['email'].lower().endswith('@esempio.it'):
                raise SystemExit(f'riga {n}: "{r["email"]}" è l\'indirizzo d\'esempio, mettici quello vero')
            righe.append(r)
    if not righe:
        raise SystemExit('nel file non c\'è nessun partecipante')
    return righe


def messaggio(nome, email, pwd):
    return (f'Ciao {nome}! Da questa stagione la formazione si schiera sul sito della lega:\n'
            f'{SITO}\n\n'
            f'Email: {email}\n'
            f'Password provvisoria: {pwd}\n\n'
            f'Appena entri cambiala: tocca il tuo nome in alto a destra, poi "Cambia password".\n'
            f'Il file .xls della formazione va sempre mandato all\'amministratore: nella guida c\'è come.')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    davvero = '--davvero' in sys.argv
    rinnova = '--nuova-password' in sys.argv
    if not args:
        raise SystemExit(__doc__)
    url, key = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise SystemExit('Mancano SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (vedi l\'inizio di questo file).')

    righe = leggi_csv(args[0])
    sb = Supabase(url, key)
    squadre = {chiave(t['name']): t for t in sb.squadre()}
    squadre.update({chiave(t['sheet_name']): t for t in squadre.copy().values() if t.get('sheet_name')})
    for r in righe:
        if chiave(r['squadra']) not in squadre:
            raise SystemExit(f'{r["email"]}: la squadra "{r["squadra"]}" non c\'è. Squadre: '
                             + ', '.join(sorted(t['name'] for t in sb.squadre())))
    esistenti = {u['email'].lower(): u for u in sb.utenti() if u.get('email')}

    print(('' if davvero else '[PROVA: non cambio niente, aggiungi --davvero] ') + f'{len(righe)} partecipanti\n')
    credenziali = []
    for r in righe:
        t = squadre[chiave(r['squadra'])]
        nome = r.get('nome') or t['name']
        u = esistenti.get(r['email'].lower())
        pwd = None
        if u is None:
            azione, pwd = 'nuovo account', password()
            if davvero:
                u = sb.crea_utente(r['email'], pwd, nome)
        else:
            azione = 'account già esistente'
            if rinnova:
                pwd = password()
                azione += ', password nuova'
                if davvero:
                    sb.cambia_password(u['id'], pwd)
        if davvero:
            sb.collega(u['id'], t['id'], nome, r['ruolo'])
        ruolo = 'amministratore' if r['ruolo'] == 'admin' else 'giocatore'
        print(f'  {r["email"]:34} -> {t["name"]:11} {ruolo:14} {azione}')
        if pwd:
            credenziali.append((nome, r['email'], pwd))

    senza = sorted({t['name'] for t in squadre.values()} - {squadre[chiave(r['squadra'])]['name'] for r in righe})
    if senza:
        print('\nSquadre senza nessun account in questo file: ' + ', '.join(senza))

    if davvero and credenziali:
        out = pathlib.Path(args[0]).resolve().parent / 'credenziali.txt'
        out.write_text('\n\n----------\n\n'.join(messaggio(*c) for c in credenziali) + '\n', encoding='utf-8')
        print(f'\nMessaggi pronti per WhatsApp in {out} ({len(credenziali)}). '
              'Contiene password: cancellalo dopo averli mandati.')
    elif credenziali:
        print(f'\nCon --davvero creerei {len(credenziali)} password provvisorie e i messaggi da mandare.')


if __name__ == '__main__':
    main()
