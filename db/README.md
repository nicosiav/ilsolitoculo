# Database della lega (Supabase)

Postgres gestito, con account e permessi. È la base su cui crescerà la piattaforma: per ora ci vivono squadre, rose, giornate, formazioni e log.

## Cosa c'è dentro

| Tabella | A cosa serve |
|---|---|
| `teams` | le squadre della lega (una per partecipante) |
| `profiles` | un record per account: nome, ruolo (`player` o `admin`), squadra |
| `players` | le rose: 31 posti per squadra, con ruolo e nome |
| `matchdays` | le giornate, con scadenza e flag della giornata corrente |
| `lineups` | una formazione per squadra e giornata (si sovrascrive) |
| `lineup_slots` | i 22 posti: 1–11 titolari, 12–18 riserve, 19–22 panchina extra |
| `lineup_log` | ogni salvataggio: quando, chi, cosa è cambiato, formazione completa |

## Regole applicate dal database (non solo dall'app)

- Ognuno legge le rose di tutti, ma **modifica solo la formazione della propria squadra**.
- Le modifiche sono **bloccate dopo la scadenza** della giornata (`matchdays.deadline`).
- **Le formazioni altrui restano invisibili** finché la scadenza non è passata.
- Il log si può **solo aggiungere**, a proprio nome: non si modifica e non si cancella.
- L'amministratore (`profiles.role = 'admin'`) vede e modifica tutto, rose comprese.

Sono regole di Row Level Security: valgono anche se qualcuno chiama il database fuori dall'app.

## Installazione

1. Crea un progetto su [supabase.com](https://supabase.com) (piano gratuito). Scegli la region europea (`eu-central-1`) e conserva la password del database.
2. Nel progetto apri **SQL Editor** ed esegui, in quest'ordine:
   - `01_schema.sql`
   - `02_policies.sql`
   - `03_seed_rose.sql` — prima di eseguirlo **modifica l'ultima query**: numero, etichetta e scadenza della giornata corrente.
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
5. In **Project Settings → API** copia **Project URL** e chiave **anon public**: servono all'app. Sono valori pubblici: la protezione dei dati sta nelle policy, non nella chiave. La chiave `service_role` invece non va mai messa nel sito.

## Ogni settimana

L'amministratore apre una nuova giornata:

```sql
update public.matchdays set is_current = false where is_current;
insert into public.matchdays (id, label, deadline, is_current)
values (2, 'Giornata 2', '2026-10-03 18:00+02', true);
```

Le formazioni della giornata precedente restano dove sono, insieme al loro log.

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
```
