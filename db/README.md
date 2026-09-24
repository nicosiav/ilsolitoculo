# Database della lega (Supabase)

Postgres gestito, con account e permessi. È la base su cui crescerà la piattaforma: per ora ci vivono squadre, rose, giornate, formazioni e log.

## Cosa c'è dentro

| Tabella | A cosa serve |
|---|---|
| `teams` | le squadre della lega (una per partecipante) |
| `profiles` | un record per account: nome, ruolo (`player` o `admin`), squadra |
| `players` | le rose: 31 posti per squadra, con ruolo, nome e squadra di Serie A |
| `fixtures` | il calendario della Serie A: partite, orari, giornata |
| `club_aliases` | i nomi delle squadre secondo l'API tradotti in quelli della lega |
| `matchdays` | le giornate ricavate dal calendario: prima partita, ultima partita, chiusura |
| `lineups` | una formazione per squadra e giornata (si sovrascrive) |
| `lineup_slots` | i 22 posti: 1–11 titolari, 12–18 riserve, 19–22 panchina extra |
| `lineup_log` | ogni salvataggio: quando, chi, cosa è cambiato, formazione completa |
| `rounds` | le giornate della lega (1–20) e la giornata di Serie A corrispondente |
| `matches` | le partite di campionato con risultato e punteggi |
| `round_teams` | il tabellino di ogni squadra per giornata: formazione, subentri, marcatori |
| `player_votes` | voto e fantavoto di ogni giocatore, giornata per giornata |
| `standings` | le classifiche fotografate a ogni giornata (campionato, Coppa di Lega, sfigometro, gol reali, Coppa) |
| `team_season`, `scorers`, `roster_costs`, `albo` | crediti, gol reali per giocatore, costo delle rose, albo d'oro |

## Regole applicate dal database (non solo dall'app)

- Ognuno legge tutto, ma **modifica solo la formazione della propria squadra**.
- **Le formazioni sono pubbliche**: ogni partecipante vede quelle di tutti, sempre.
- **Blocco partita per partita**: un giocatore si blocca quando la sua squadra di
  Serie A scende in campo. Da quel momento non lo si può più togliere, spostare o
  inserire; chi non ha ancora giocato si cambia a piacere.
- La giornata resta aperta **fino alla fine dell'ultima partita** (`closes_at`,
  cioè ultimo calcio d'inizio più due ore).
- Chi non ha una squadra di Serie A assegnata si blocca alla **prima partita**
  della giornata; chi gioca in una squadra che riposa resta libero.
- Si scrive **solo tramite `save_lineup()`**: è la funzione a controllare squadra,
  giornata e blocchi, e a calcolare il log. Sulle tabelle restano lettura e
  poteri dell'amministratore.
- Il log si scrive da solo a ogni salvataggio: non si modifica e non si cancella.
- L'amministratore (`profiles.role = 'admin'`) vede e modifica tutto, rose comprese.

Sono regole di Row Level Security: valgono anche se qualcuno chiama il database fuori dall'app.

## Installazione

1. Crea un progetto su [supabase.com](https://supabase.com) (piano gratuito). Scegli la region europea (`eu-central-1`) e conserva la password del database.
2. Nel progetto apri **SQL Editor** ed esegui, in quest'ordine:
   - `01_schema.sql`
   - `02_policies.sql`
   - `03_seed_rose.sql` — prima di eseguirlo **modifica l'ultima query**: numero, etichetta e scadenza della giornata corrente.
   - `04_functions.sql` — salvataggio della formazione, log e bucket per il modello .xls.
   - `06_calendario.sql` — calendario, giornate automatiche, blocco partita per partita, formazioni pubbliche.
   - `08_stagione.sql` — giornate, partite, voti, classifiche e caricamento del file .xls di giornata.
     In fondo c'è `notify pgrst, 'reload schema';`: serve a far vedere subito le
     tabelle nuove all'app. Se il sito dice *"Could not find the table
     'public.rounds' in the schema cache"*, o questo file non è stato eseguito,
     oppure basta rieseguire quella riga.
3. In **Authentication → Sign In / Providers → Email** togli **Allow new users to sign up**: la chiave `anon` è pubblica, quindi senza questo chiunque potrebbe crearsi un account.
4. Crea gli account dei partecipanti e collegali alle squadre: vedi
   [Aggiungere i partecipanti](#aggiungere-i-partecipanti) qui sotto.
5. Esegui `05_admin.sql` e poi di nuovo `06_calendario.sql` (l'ordine conta: il
   secondo aggiorna le funzioni del primo): ruolo `admin` agli amministratori e
   funzioni di amministrazione.
   Poi pubblica la funzione `sync-calendario` seguendo
   [`supabase/functions/README.md`](../supabase/functions/README.md) ed esegui
   `07_cron.sql` per l'aggiornamento automatico.
6. In **Authentication → URL Configuration** metti `https://nicosiav.github.io/ilsolitoculo/`
   come **Site URL** e aggiungilo anche fra le **Redirect URLs**: è lì che porta il
   link "password dimenticata" (il sito apre da solo la finestra per sceglierne
   una nuova). Il vecchio `…/ilsolitoculo/schiera/` si può lasciare: rimanda al sito.
7. In **Storage** carica il file Excel della lega nel bucket `modelli` con nome `formazioni.xls` (serve solo all'export; in alternativa lo carica l'app quando un amministratore aggiorna le rose).
8. In **Project Settings → API** copia **Project URL** e chiave **anon public**: servono all'app. Sono valori pubblici: la protezione dei dati sta nelle policy, non nella chiave. La chiave `service_role` invece non va mai messa nel sito.

## Aggiungere i partecipanti

Gli account li crei tu: le iscrizioni dal sito sono chiuse (passo 3). Due strade,
scegline una.

### Con lo script (consigliata: fa tutto e prepara i messaggi)

1. Copia `db/account-esempio.csv` in `db/account.csv` e metti le email vere, una
   riga per partecipante: `email,squadra,nome,ruolo` (ruolo `giocatore` o
   `amministratore`). `account.csv` resta sul tuo computer: è in `.gitignore`.
2. In **Project Settings → API** copia la chiave **service_role** (quella
   segreta). Solo nel terminale del tuo computer, mai nel sito, nella repo o in
   una chat.
3. Nel terminale, dalla cartella della repo:

   ```bash
   export SUPABASE_URL=https://<progetto>.supabase.co
   export SUPABASE_SERVICE_ROLE_KEY=<chiave service_role>
   python3 db/crea_account.py db/account.csv            # prova: dice cosa farebbe
   python3 db/crea_account.py db/account.csv --davvero  # lo fa
   ```

   Chi non ha un account lo riceve già confermato, con una password provvisoria
   tipo `traversa-4827`; chi ce l'ha (tu, per esempio) viene solo collegato alla
   squadra e al ruolo. Nessuna email parte da Supabase.
4. Apri `db/credenziali.txt`: c'è un messaggio pronto per ciascuno (link, email,
   password provvisoria, come cambiarla, promemoria del file .xls). Mandali su
   WhatsApp insieme alla guida, poi **cancella il file**.

Lo script si può rilanciare quando vuoi (un partecipante nuovo, una squadra
cambiata): non crea doppioni. Con `--nuova-password` rigenera la password anche
a chi l'account ce l'ha già, per esempio se qualcuno l'ha persa e non riesce a
usare "password dimenticata". Si prova senza rete con
`python3 db/test/prova_crea_account.py`.

### Tutta dal pannello di Supabase

1. **Authentication → Users → Add user → Create new user** per ogni
   partecipante: email, una password provvisoria, spunta **Auto Confirm User**.
2. Apri `09_account.sql`, metti le email vere ed eseguilo nel **SQL Editor**:
   collega ogni account a squadra, nome e ruolo, poi mostra una riga per squadra
   (con "manca l'account" dove qualcosa non torna).
3. Manda a ciascuno link del sito, email e password provvisoria.

### Dopo

- Ognuno cambia la password dal sito: tocca il suo nome in alto a destra →
  **Cambia password**. Se la dimentica, "Password dimenticata?" nella pagina di
  accesso gli manda una mail (servono Site URL e Redirect URLs del passo 6).
- Le email di Supabase gratuite sono poche all'ora: se molti chiedono il
  recupero insieme, alcuni devono aspettare. In quel caso fai prima con
  `--nuova-password` o con **Authentication → Users → … → Reset password**.
- Chi è entrato almeno una volta: la colonna `ultimo_accesso` in fondo a
  `09_account.sql` (oppure **Authentication → Users → Last signed in**).

## Ogni settimana

Niente: la giornata corrente si sposta da sola. `refresh_matchdays()` gira ogni
ora e passa alla giornata successiva appena finisce l'ultima partita di quella
in corso; il calendario si riscarica ogni notte, così orari spostati e recuperi
arrivano da soli. Le formazioni delle giornate passate restano dove sono,
insieme al loro log.

Dopo ogni giornata, dal sito come amministratore: **menu → Carica la giornata**
con il file `.xls` della lega. Da quel file nascono risultati, voti, classifiche,
statistiche, rose e crediti (`import_round()`).

Dopo il mercato, dal sito come amministratore: **menu → Aggiorna le rose da
un .xls** (allinea le rose e il modello per gli export) e **menu → Aggiorna il
calendario di Serie A** con l'abbinamento delle squadre, per far ripartire il
blocco partita per partita sui giocatori nuovi. Quelli rimasti senza squadra si
sistemano da **menu → Squadre dei giocatori**.

A mano, se serve:

```sql
select public.refresh_matchdays();                                   -- ricalcola le giornate
select public.set_current_matchday(2::smallint, 'Giornata 2',        -- giornata forzata, senza calendario
       '2026-10-03 18:00+02'::timestamptz);
```

## Controlli utili

```sql
-- chi ha schierato per la giornata corrente e quando
select t.name, l.module, l.updated_at
from public.lineups l join public.teams t on t.id = l.team_id
where l.matchday = (select id from public.matchdays where is_current)
order by l.updated_at;

-- storico delle modifiche di una squadra
select at, action, changes from public.lineup_log
where team_id = (select id from public.teams where name = 'Valerio')
order by at desc limit 20;

-- chi è già sceso in campo nella giornata corrente
select p.name, rl.club, rl.kickoff, rl.locked
from public.roster_locks((select id from public.matchdays where is_current),
                         (select id from public.teams where name = 'Valerio')) rl
join public.players p on p.id = rl.player_id
order by rl.kickoff nulls last;

-- giocatori senza squadra di Serie A (si bloccano alla prima partita)
select t.name, count(*) from public.players p
join public.teams t on t.id = p.team_id
where p.club is null group by t.name order by 2 desc;
```

Le regole si possono provare su un PostgreSQL qualsiasi: vedi
[`test/`](test/README.md).
