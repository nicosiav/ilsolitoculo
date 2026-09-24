#!/usr/bin/env python3
"""Crea gli account dei partecipanti su Supabase e li collega alla loro squadra.

Dalla cartella della repo:

    python3 db/crea_account.py db/account.csv                     (prova: dice cosa farebbe)
    python3 db/crea_account.py db/account.csv --davvero           (crea e collega)
    python3 db/crea_account.py db/account.csv --password PWD --davvero
                                                   (la stessa password PWD per tutti i nuovi)

Chiede la chiave segreta di Supabase (Project Settings -> API Keys: la
service_role, o una secret key sb_secret_...) e la legge senza mostrarla né
lasciarla nella cronologia del terminale. In alternativa la si mette in
SUPABASE_SERVICE_ROLE_KEY. L'indirizzo del progetto lo prende da
tools/schiera-formazione/src/config.js (o da SUPABASE_URL).

La chiave service_role apre tutto il database: si usa solo da qui, dal tuo
computer. Mai nel sito, mai nella repo, mai in chat.

account.csv, una riga per partecipante (c'è un esempio in db/account-esempio.csv):

    email,squadra,nome,ruolo
    mario.rossi@gmail.com,Massimo,Massimo,giocatore

  squadra   come in teams.name (MarcoI e "Marco I" vanno bene tutti e due)
  nome      come compare nel sito (vuoto = il nome della squadra)
  ruolo     giocatore | amministratore (vuoto = giocatore)

Chi non ha ancora un account lo riceve con una password provvisoria, già
confermato: nessuna email parte da Supabase. Senza --password ognuno ne ha una
diversa, generata a caso (tipo traversa-4827); con --password tutti gli account
nuovi hanno quella. La password non va scritta nella repo (è pubblica): si passa
solo da riga di comando. Chi ce l'ha già viene solo collegato alla squadra; la
password resta la sua (con --nuova-password gliela si cambia: generata a caso,
o quella di --password).

Alla fine scrive credenziali.txt, accanto al file .csv, con un messaggio
pronto da mandare su WhatsApp a ciascuno. Contiene password: non va nella
repo (è in .gitignore), cancellalo dopo averle mandate.

Usa solo la libreria standard di Python.
"""
import base64
import csv
import getpass
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
        h = {'apikey': self.key, 'Content-Type': 'application/json'}
        if not self.key.startswith('sb_'):      # la vecchia service_role è un JWT: va anche come Bearer
            h['Authorization'] = 'Bearer ' + self.key
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


def url_del_progetto():
    """L'indirizzo del progetto è già (pubblico) nella configurazione del sito."""
    conf = pathlib.Path(__file__).resolve().parent.parent / 'tools' / 'schiera-formazione' / 'src' / 'config.js'
    m = re.search(r"url:\s*'([^']+)'", conf.read_text(encoding='utf-8')) if conf.exists() else None
    if not m:
        raise SystemExit('Non trovo l\'indirizzo del progetto: impostalo con  export SUPABASE_URL=https://...supabase.co')
    return m.group(1)


def controlla_chiave(key):
    key = (key or '').strip().strip('"').strip("'")
    if not key:
        raise SystemExit('Manca la chiave segreta (Project Settings -> API Keys).')
    if key.startswith('sb_publishable_'):
        raise SystemExit('Questa è la chiave pubblica (publishable): serve quella segreta, sb_secret_... o service_role.')
    if key.count('.') == 2 and not key.startswith('sb_'):
        try:
            corpo = key.split('.')[1]
            ruolo = json.loads(base64.urlsafe_b64decode(corpo + '=' * (-len(corpo) % 4))).get('role')
        except Exception:
            ruolo = None
        if ruolo == 'anon':
            raise SystemExit('Questa è la chiave anon (quella pubblica del sito): serve la service_role, lì accanto.')
    return key


def opzioni(argv):
    args, davvero, rinnova, comune = [], False, False, None
    it = iter(argv)
    for a in it:
        if a == '--davvero':
            davvero = True
        elif a == '--nuova-password':
            rinnova = True
        elif a == '--password' or a.startswith('--password='):
            comune = a.split('=', 1)[1] if '=' in a else next(it, None)
            if not comune:
                raise SystemExit('--password vuole la password: --password <provvisoria>')
        elif a.startswith('--'):
            raise SystemExit(f'opzione sconosciuta: {a}')
        else:
            args.append(a)
    if comune is not None and len(comune) < 6:
        raise SystemExit('La password provvisoria deve avere almeno 6 caratteri (minimo di Supabase).')
    return args, davvero, rinnova, comune


def main():
    args, davvero, rinnova, comune = opzioni(sys.argv[1:])
    if not args:
        raise SystemExit(__doc__)
    nuova = (lambda: comune) if comune else password
    if not pathlib.Path(args[0]).exists():
        raise SystemExit(f'Non trovo {args[0]}: lancia il comando dalla cartella della repo '
                         '(quella con dentro db/ e docs/) e controlla il nome del file.')
    righe = leggi_csv(args[0])
    url = os.environ.get('SUPABASE_URL') or url_del_progetto()
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or getpass.getpass(
        'Incolla la chiave segreta di Supabase (service_role o sb_secret_...) e premi Invio.\n'
        'Mentre incolli non si vede niente: è normale. Chiave: ')
    key = controlla_chiave(key)

    sb = Supabase(url, key)
    squadre = {chiave(t['name']): t for t in sb.squadre()}
    squadre.update({chiave(t['sheet_name']): t for t in squadre.copy().values() if t.get('sheet_name')})
    for r in righe:
        if chiave(r['squadra']) not in squadre:
            raise SystemExit(f'{r["email"]}: la squadra "{r["squadra"]}" non c\'è. Squadre: '
                             + ', '.join(sorted(t['name'] for t in sb.squadre())))
    esistenti = {u['email'].lower(): u for u in sb.utenti() if u.get('email')}

    print(('' if davvero else '[PROVA: non cambio niente, aggiungi --davvero] ') + f'{len(righe)} partecipanti'
          + (', password provvisoria uguale per tutti gli account nuovi' if comune else '') + '\n')
    credenziali = []
    for r in righe:
        t = squadre[chiave(r['squadra'])]
        nome = r.get('nome') or t['name']
        u = esistenti.get(r['email'].lower())
        pwd = None
        if u is None:
            azione, pwd = 'nuovo account', nuova()
            if davvero:
                u = sb.crea_utente(r['email'], pwd, nome)
        else:
            azione = 'account già esistente'
            if rinnova:
                pwd = nuova()
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
