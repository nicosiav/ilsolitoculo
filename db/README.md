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
3. In **Authentication → Users → Add user** crea un account per ogni partecipante (email + password, spunta "Auto Confirm User"). Il profilo viene creato da solo.
4. Torna nel **SQL Editor** e collega ogni account alla sua squadra:

   ```sql
   update public.profiles p
   set team_id = t.id, display_name = t.name
   from public.teams t, auth.users u
   where p.id = u.id and u.email = 'email@esempio.it' and t.name = 'Valerio';

   -- e per l'amministratore
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'email.admin@esempio.it');
   ```
5. Esegui `05_admin.sql` e poi di nuovo `06_calendario.sql` (l'ordine conta: il
   secondo aggiorna le funzioni del primo): ruolo `admin` agli amministratori e
   funzioni di amministrazione.
   Poi pubblica la funzione `sync-calendario` seguendo
   [`supabase/functions/README.md`](../supabase/functions/README.md) ed esegui
   `07_cron.sql` per l'aggiornamento automatico.
6. In **Authentication → Sign In / Providers → Email** togli **Allow new users to sign up**: la chiave `anon` è pubblica, quindi senza questo chiunque potrebbe crearsi un account.
7. In **Authentication → URL Configuration** aggiungi `https://nicosiav.github.io/ilsolitoculo/schiera/` fra le Redirect URLs, per il link di recupero password.
8. In **Storage** carica il file Excel della lega nel bucket `modelli` con nome `formazioni.xls` (serve solo all'export; in alternativa lo carica l'app quando un amministratore aggiorna le rose).
9. In **Project Settings → API** copia **Project URL** e chiave **anon public**: servono all'app. Sono valori pubblici: la protezione dei dati sta nelle policy, non nella chiave. La chiave `service_role` invece non va mai messa nel sito.

## Ogni settimana

Niente: la giornata corrente si sposta da sola. `refresh_matchdays()` gira ogni
ora e passa alla giornata successiva appena finisce l'ultima partita di quella
in corso; il calendario si riscarica ogni notte, così orari spostati e recuperi
arrivano da soli. Le formazioni delle giornate passate restano dove sono,
insieme al loro log.

Dopo ogni giornata, dal sito come amministratore: **menu → Carica la giornata**
con il file `.xls` della lega. Da quel file nascono risultati, voti, classifiche,
statistiche, rose e crediti (`import_round()`).

Dopo il mercato, dall'app come amministratore: **Opzioni → Aggiorna le rose da
un .xls** (allinea le rose e il modello per gli export) e **Opzioni → Aggiorna
il calendario** con l'abbinamento delle squadre, per far ripartire il blocco
partita per partita sui giocatori nuovi. Quelli rimasti senza squadra si
sistemano da **Opzioni → Squadre dei giocatori**.

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
