-- Prova delle scadenze (12_scadenze.sql) su un PostgreSQL qualsiasi.
-- Database con 00_finto_supabase.sql e db/01, 02, 04, 05, 06, 08, 10, 11, 12, poi:
--   psql ... -f db/test/04_prova_scadenze.sql
-- Ogni controllo è un ASSERT: se qualcosa non torna lo script si ferma con l'errore.

\set ON_ERROR_STOP on
set client_min_messages = warning;

insert into public.teams (name, sheet_name) values ('Valerio','Valerio'), ('Sebi','Sebi') on conflict do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','valerio@test.it'),
  ('22222222-2222-2222-2222-222222222222','sebi@test.it')
on conflict do nothing;
update public.profiles set display_name = 'Valerio', role = 'player', team_id = (select id from public.teams where name = 'Valerio')
where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Sebi', role = 'admin', team_id = (select id from public.teams where name = 'Sebi')
where id = '22222222-2222-2222-2222-222222222222';

-- la rosa di Valerio: ruolo e squadra di Serie A nel nome
insert into public.players (team_id, slot, role, name, club)
select (select id from public.teams where name = 'Valerio'), s, r, n, c from (values
  (1,'P','P Inter','Inter'), (2,'P','P Juve','Juventus'),
  (3,'D','D Juve','Juventus'), (4,'D','D Napoli','Napoli'), (5,'D','D Roma','Roma'), (6,'D','D Lazio','Lazio'),
  (7,'D','D Milan','Milan'), (8,'D','D Atalanta','Atalanta'),
  (9,'C','C Juve','Juventus'), (10,'C','C Napoli','Napoli'), (11,'C','C Roma','Roma'), (12,'C','C Lazio','Lazio'),
  (13,'C','C Bologna','Bologna'), (14,'C','C Torino','Torino'),
  (15,'A','A Juve','Juventus'), (16,'A','A Napoli','Napoli'), (17,'A','A Inter','Inter'), (18,'A','A Roma','Roma'),
  (19,'A','A Como','Como'), (20,'D','D Senza',null), (21,'C','C Genoa','Genoa')
) v(s, r, n, c);
insert into public.players (team_id, slot, role, name, club)
values ((select id from public.teams where name = 'Sebi'), 1, 'P', 'P di Sebi', 'Inter');

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';   -- amministratore

-- Giornata 7, intorno ad adesso:
--   Inter–Milan fra 20 minuti   -> già bloccati (mezz'ora prima)
--   Atalanta–Bologna fra 40 min -> ancora liberi
--   Torino–Genoa rinviata       -> liberi
--   Como–Lecce fra 25 giorni    -> recupero: liberi, e non allunga la giornata
select public.import_fixtures(jsonb_build_array(
  jsonb_build_object('id',1,'matchday',7,'home','FC Internazionale Milano','home_short','Inter','away','AC Milan','away_short','Milan','kickoff',(now() + interval '20 minutes')::text,'status','TIMED'),
  jsonb_build_object('id',2,'matchday',7,'home','Atalanta BC','home_short','Atalanta','away','Bologna FC 1909','away_short','Bologna','kickoff',(now() + interval '40 minutes')::text,'status','TIMED'),
  jsonb_build_object('id',3,'matchday',7,'home','Juventus FC','home_short','Juventus','away','SSC Napoli','away_short','Napoli','kickoff',(now() + interval '2 days')::text,'status','TIMED'),
  jsonb_build_object('id',4,'matchday',7,'home','AS Roma','home_short','Roma','away','SS Lazio','away_short','Lazio','kickoff',(now() + interval '3 days')::text,'status','TIMED'),
  jsonb_build_object('id',5,'matchday',7,'home','Torino FC','home_short','Torino','away','Genoa CFC','away_short','Genoa','kickoff',(now() - interval '1 hour')::text,'status','POSTPONED'),
  jsonb_build_object('id',6,'matchday',7,'home','Como 1907','home_short','Como','away','US Lecce','away_short','Lecce','kickoff',(now() + interval '25 days')::text,'status','TIMED'),
  -- giornata 30: turno del weekend (ven 16 – lun 19 ottobre 2026, ora legale)
  jsonb_build_object('id',30,'matchday',30,'home','Juventus FC','away','SSC Napoli','kickoff','2026-10-16 20:45+02','status','TIMED'),
  jsonb_build_object('id',31,'matchday',30,'home','AS Roma','away','SS Lazio','kickoff','2026-10-17 18:00+02','status','TIMED'),
  jsonb_build_object('id',32,'matchday',30,'home','AC Milan','away','Torino FC','kickoff','2026-10-18 12:30+02','status','TIMED'),
  jsonb_build_object('id',33,'matchday',30,'home','Genoa CFC','away','Como 1907','kickoff','2026-10-18 15:00+02','status','TIMED'),
  jsonb_build_object('id',34,'matchday',30,'home','US Lecce','away','Parma Calcio 1913','kickoff','2026-10-19 20:45+02','status','TIMED'),
  -- giornata 31: turno infrasettimanale (mar 27 – gio 29 ottobre, ora solare)
  jsonb_build_object('id',40,'matchday',31,'home','Juventus FC','away','AS Roma','kickoff','2026-10-27 18:30+01','status','TIMED'),
  jsonb_build_object('id',41,'matchday',31,'home','SSC Napoli','away','SS Lazio','kickoff','2026-10-28 20:45+01','status','TIMED'),
  jsonb_build_object('id',42,'matchday',31,'home','AC Milan','away','Genoa CFC','kickoff','2026-10-29 18:30+01','status','TIMED'),
  -- giornata 32: weekend con l'anticipo di sabato e una partita di sabato in più
  jsonb_build_object('id',50,'matchday',32,'home','Juventus FC','away','AS Roma','kickoff','2026-11-07 15:00+01','status','TIMED'),
  jsonb_build_object('id',51,'matchday',32,'home','SSC Napoli','away','SS Lazio','kickoff','2026-11-07 18:00+01','status','TIMED'),
  jsonb_build_object('id',52,'matchday',32,'home','AC Milan','away','Genoa CFC','kickoff','2026-11-08 20:45+01','status','TIMED')
)) is not null as calendario;

-- 1) scadenza dal calendario -----------------------------------------------------
do $$ begin
  assert (select scadenza_auto from public.matchdays where id = 30) = '2026-10-18 12:00+02'::timestamptz,
    'giornata 30: attesa domenica 18 alle 12.00';
  assert (select scadenza_auto from public.matchdays where id = 31) = '2026-10-28 20:00+01'::timestamptz,
    'giornata 31: atteso mercoledì 28 alle 20.00';
  assert (select scadenza_auto from public.matchdays where id = 32) = '2026-11-08 12:00+01'::timestamptz,
    'giornata 32: attesa domenica 8 alle 12.00';
  assert (select scadenza from public.matchdays where id = 30) = (select scadenza_auto from public.matchdays where id = 30),
    'senza scelta dell''amministratore vale quella del calendario';
end $$;

-- 2) la giornata 7: il recupero lontano e la rinviata non contano ---------------
do $$
declare m record;
begin
  select * into m from public.matchdays where id = 7;
  assert m.last_kickoff < now() + interval '4 days', 'il recupero fra 25 giorni non deve allungare la giornata';
  assert m.closes_at < now() + interval '4 days', 'chiusura: ultima partita della giornata più due ore';
  assert m.first_kickoff > now(), 'la rinviata (orario passato) non è la prima partita';
  assert m.is_current, 'la giornata 7 è la corrente';
end $$;

-- 3) blocco mezz'ora prima ----------------------------------------------------------
do $$
declare v uuid;
begin
  assert public.player_locked(7::smallint, (select id from public.players where name = 'A Inter')), 'Inter fra 20 minuti: bloccato';
  assert public.player_locked(7::smallint, (select id from public.players where name = 'D Milan')), 'Milan fra 20 minuti: bloccato';
  assert not public.player_locked(7::smallint, (select id from public.players where name = 'C Bologna')), 'Bologna fra 40 minuti: libero';
  assert not public.player_locked(7::smallint, (select id from public.players where name = 'C Torino')), 'partita rinviata: libero';
  assert not public.player_locked(7::smallint, (select id from public.players where name = 'A Como')), 'recupero lontano: libero';
  assert public.player_locked(7::smallint, (select id from public.players where name = 'D Senza')), 'senza squadra: bloccato con la prima partita';
  select id into v from public.players where name = 'D Atalanta';
  assert public.player_lock_at(7::smallint, v) = (select kickoff from public.fixtures where id = 2) - interval '30 minutes',
    'il blocco scatta 30 minuti prima della partita';
  assert (select count(*) from public.roster_locks(7::smallint, (select id from public.teams where name = 'Valerio')) where locked) = 4,
    'bloccati: P Inter, D Milan, A Inter, D Senza';
end $$;

-- la scadenza della giornata 7 la fissa l'amministratore, così la prova non dipende dal giorno
select public.set_scadenza(7::smallint, now() + interval '2 days') ->> 'giornata' as scadenza_scelta;

-- strumenti della prova ----------------------------------------------------------
-- una formazione come testo "posto=nome;posto=nome"; mods cambia o toglie posti ("11=A Roma;22=")
create or replace function pg_temp.con(base text, mods text default '') returns jsonb language plpgsql as $$
declare m jsonb := '{}'; x text;
begin
  foreach x in array string_to_array(base, ';') loop
    m := m || jsonb_build_object(btrim(split_part(x, '=', 1)), btrim(split_part(x, '=', 2)));
  end loop;
  if mods <> '' then
    foreach x in array string_to_array(mods, ';') loop
      if btrim(split_part(x, '=', 2)) = '' then m := m - btrim(split_part(x, '=', 1));
      else m := m || jsonb_build_object(btrim(split_part(x, '=', 1)), btrim(split_part(x, '=', 2))); end if;
    end loop;
  end if;
  return (select jsonb_agg(jsonb_build_object('pos', e.k::int, 'player_id', p.id) order by e.k::int)
          from jsonb_each_text(m) e(k, v)
          join public.players p on p.name = e.v and p.team_id = (select id from public.teams where name = 'Valerio'));
end $$;

-- rimette la formazione di partenza come se fosse stata salvata prima dei blocchi
create or replace function pg_temp.metti(base text, modulo text) returns void language plpgsql as $$
declare v uuid;
begin
  insert into public.lineups (team_id, matchday, module) values ((select id from public.teams where name = 'Valerio'), 7, modulo)
  on conflict (team_id, matchday) do update set module = excluded.module returning id into v;
  delete from public.lineup_slots where lineup_id = v;
  insert into public.lineup_slots (lineup_id, pos, player_id)
  select v, (e ->> 'pos')::smallint, (e ->> 'player_id')::uuid from jsonb_array_elements(pg_temp.con(base)) e;
end $$;

-- deve essere rifiutato con quel codice (e, se c'è, quel testo)
create or replace function pg_temp.rifiuta(q text, codice text, testo text default null) returns text language plpgsql as $$
begin
  begin
    execute q;
  -- P0004 per PL/pgSQL è "assert_failure": "others" da solo non lo prende
  exception when others or assert_failure then
    if sqlstate <> codice then raise exception 'atteso % ma è arrivato % (%): %', codice, sqlstate, sqlerrm, q; end if;
    if testo is not null and sqlerrm not like testo then raise exception 'messaggio inatteso: %', sqlerrm; end if;
    return sqlerrm;
  end;
  raise exception 'doveva essere rifiutato (%): %', codice, q;
end $$;

-- La formazione di partenza (4-4-2):
--   titolari  1 P Inter (bloccato) · 2-5 D Juve, D Napoli, D Roma, D Lazio · 6-9 C Juve, C Napoli, C Roma, C Lazio · 10-11 A Juve, A Napoli
--   riserve   12 P Juve · 13 D Atalanta · 14 D Milan (bloccato) · 15 C Bologna · 16 C Torino · 17 A Inter (bloccato: "Lucca") · 18 A Roma
--   extra     19 A Como · 20 D Senza (bloccato) · 21 C Genoa
\set base '1=P Inter;2=D Juve;3=D Napoli;4=D Roma;5=D Lazio;6=C Juve;7=C Napoli;8=C Roma;9=C Lazio;10=A Juve;11=A Napoli;12=P Juve;13=D Atalanta;14=D Milan;15=C Bologna;16=C Torino;17=A Inter;18=A Roma;19=A Como;20=D Senza;21=C Genoa'

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';   -- Valerio

-- 4) il caso di Lucca: primo panchinaro dell'attacco già bloccato -----------------
select pg_temp.metti(:'base', '4-4-2');
select pg_temp.rifiuta(format('select public.save_lineup(7::smallint, %L, false, pg_temp.con(%L, %L))',
  '4-4-2', :'base', '11=A Roma;18=A Napoli'), 'P0007', 'A Inter (posto 17) è già bloccato%') as secondo_panchinaro_titolare;
select pg_temp.rifiuta(format('select public.save_lineup(7::smallint, %L, false, pg_temp.con(%L, %L))',
  '4-4-2', :'base', '11=A Como;19=A Napoli'), 'P0007', '%attaccanti%') as extra_titolare;
-- i due titolari dell'attacco si scambiano fra loro: va bene
select public.save_lineup(7::smallint, '4-4-2', false, pg_temp.con(:'base', '10=A Napoli;11=A Juve')) ->> 'action' as scambio_titolari_attacco;
-- dopo di lui si cambia a piacere: il secondo panchinaro scambiato con l'extra
select pg_temp.metti(:'base', '4-4-2');
select public.save_lineup(7::smallint, '4-4-2', false, pg_temp.con(:'base', '18=A Como;19=A Roma')) ->> 'action' as dopo_lucca_libero;

-- 5) difesa: D Milan bloccato secondo panchinaro ---------------------------------
-- titolare e primo panchinaro della difesa si scambiano: va bene
select pg_temp.metti(:'base', '4-4-2');
select public.save_lineup(7::smallint, '4-4-2', false, pg_temp.con(:'base', '2=D Atalanta;13=D Juve')) ->> 'action' as scambio_titolare_primo_panchinaro;
-- il primo panchinaro esce e al suo posto va uno nuovo: no
select pg_temp.metti(:'base', '4-4-2');
select pg_temp.rifiuta(format('select public.save_lineup(7::smallint, %L, false, pg_temp.con(%L, %L))',
  '4-4-2', :'base', '13='), 'P0007', '%difensori%') as primo_panchinaro_tolto;

-- 6) il modulo non può cambiare il numero dei titolari del reparto ---------------
-- 4-4-2 -> 3-5-2: un difensore titolare va in panchina (dopo D Milan) e entra un centrocampista
select pg_temp.rifiuta(format('select public.save_lineup(7::smallint, %L, false, pg_temp.con(%L, %L))',
  '3-5-2', :'base', '5=C Bologna;15=D Lazio'), 'P0007', '%titolari in difesa restano 4%') as cambio_modulo_difesa;
-- riserve in ordine libero: D Lazio nel posto 12 (prima di D Milan) resta "davanti" ma i titolari scendono a 3: no
select pg_temp.rifiuta(format('select public.save_lineup(7::smallint, %L, true, pg_temp.con(%L, %L))',
  '3-5-2', :'base', '5=C Bologna;12=D Lazio;15=P Juve'), 'P0007', '%titolari in difesa restano 4%') as titolari_contati;

-- 4-4-2 -> 4-3-3 con gli stessi giocatori: il terzo posto in attacco resterebbe vuoto
-- (e Lucca, primo panchinaro, diventerebbe di fatto titolare): no
select pg_temp.rifiuta(format('select public.save_lineup(7::smallint, %L, false, pg_temp.con(%L))',
  '4-3-3', :'base'), 'P0007', 'A Inter (posto 17)%gli attaccanti%titolari in attacco restano 2.') as modulo_con_posto_vuoto;

-- 7) i reparti senza panchinari bloccati si cambiano a piacere -------------------
select pg_temp.metti(:'base', '4-4-2');
select public.save_lineup(7::smallint, '4-4-2', false, pg_temp.con(:'base', '9=C Genoa;21=C Lazio;6=C Bologna;15=C Juve')) ->> 'action' as centrocampo_libero;

-- 8) panchina extra bloccata: D Senza al 20 tiene fermi i difensori prima di lui --
-- (qui D Milan, bloccato fuori formazione, resta fuori)
\set base2 '1=P Inter;2=D Juve;3=D Napoli;4=D Roma;5=D Lazio;6=C Juve;7=C Napoli;8=C Roma;9=C Lazio;10=A Juve;11=A Napoli;12=P Juve;13=D Atalanta;15=C Bologna;16=C Torino;17=A Inter;18=A Roma;19=A Como;20=D Senza;21=C Genoa'
select pg_temp.metti(:'base2', '4-4-2');
-- D Atalanta dal 13 al 19: sempre prima di D Senza, va bene
select public.save_lineup(7::smallint, '4-4-2', false, pg_temp.con(:'base2', '13=;19=D Atalanta;22=A Como')) ->> 'action' as extra_prima_resta_prima;
-- D Atalanta dopo D Senza: no
select pg_temp.metti(:'base2', '4-4-2');
select pg_temp.rifiuta(format('select public.save_lineup(7::smallint, %L, false, pg_temp.con(%L, %L))',
  '4-4-2', :'base2', '13=;22=D Atalanta'), 'P0007', 'D Senza (posto 20) è già bloccato%') as extra_bloccato;
-- D Milan, bloccato e fuori formazione, non entra
select pg_temp.rifiuta(format('select public.save_lineup(7::smallint, %L, false, pg_temp.con(%L, %L))',
  '4-4-2', :'base2', '14=D Milan'), 'P0007', '%D Milan%') as bloccato_fuori_resta_fuori;

-- 9) un titolare bloccato non si sposta ------------------------------------------
select pg_temp.metti(:'base', '4-4-2');
select pg_temp.rifiuta(format('select public.save_lineup(7::smallint, %L, false, pg_temp.con(%L, %L))',
  '4-4-2', :'base', '1=P Juve;12=P Inter'), 'P0007', 'Partita già iniziata (o al via fra meno di 30 minuti) per: P Inter') as titolare_bloccato;

-- 10) dopo la scadenza la squadra non cambia più niente --------------------------
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.set_scadenza(7::smallint, now() - interval '1 minute') ->> 'scadenza' is not null as scadenza_passata;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.rifiuta(format('select public.save_lineup(7::smallint, %L, false, pg_temp.con(%L, %L))',
  '4-4-2', :'base', '9=C Genoa;21=C Lazio'), 'P0008', 'Scadenza passata%') as dopo_la_scadenza;
-- e l'amministratore no: le sue funzioni non le chiama chi non lo è
select pg_temp.rifiuta(format('select public.admin_save_lineup(%L::uuid, 7::smallint, %L, false, pg_temp.con(%L))',
  (select id from public.teams where name = 'Sebi'), '4-4-2', '1=P di Sebi'), 'P0005') as admin_solo_admin;
select pg_temp.rifiuta('select public.set_scadenza(7::smallint, null)', 'P0005') as scadenza_solo_admin;

-- 11) l'amministratore modifica a piacere, e resta scritto ------------------------
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.rifiuta(format('select public.admin_save_lineup(%L::uuid, 7::smallint, %L, false, %L::jsonb)',
  (select id from public.teams where name = 'Valerio'), '4-4-2',
  jsonb_build_array(jsonb_build_object('pos', 1, 'player_id', (select id from public.players where name = 'P di Sebi')))),
  'P0004') as admin_giocatore_di_altri;
do $$
declare r jsonb; l record;
begin
  r := public.admin_save_lineup((select id from public.teams where name = 'Valerio'), 7::smallint, '3-5-2', false,
         pg_temp.con('1=P Juve;2=D Juve;3=D Napoli;4=D Roma;5=C Bologna;6=C Juve;7=C Napoli;8=C Roma;9=C Lazio;10=A Roma;11=A Napoli;12=P Inter;13=D Atalanta;14=D Milan;17=A Inter;18=A Como'),
         'Comunicata su WhatsApp alle 11:40');
  assert r ->> 'action' = 'modificata' and (r ->> 'da_admin')::boolean, 'salvataggio dell''amministratore';
  select * into l from public.lineup_log where da_admin order by id desc limit 1;
  assert l.team_id = (select id from public.teams where name = 'Valerio'), 'log sulla squadra modificata';
  assert l.autore = 'Sebi' and l.nota = 'Comunicata su WhatsApp alle 11:40', 'autore e nota nel log';
  assert l.changes -> 'modulo' ->> 'a' = '3-5-2', 'cambio di modulo nel log';
  assert exists (select 1 from jsonb_array_elements(l.changes -> 'spostati') x where x ->> 'nome' = 'P Inter'),
    'lo spostamento del bloccato è nel log';
  assert (select count(*) from public.lineup_log where not da_admin) >= 4, 'i salvataggi della squadra restano "suoi"';
end $$;

-- la scadenza torna quella del calendario
select (public.set_scadenza(7::smallint, null) ->> 'scelta') is null as scadenza_automatica;
do $$ begin
  assert (select scadenza is not distinct from scadenza_auto from public.matchdays where id = 7), 'scadenza di nuovo dal calendario';
end $$;

-- 12) le funzioni interne non si chiamano dall'app ---------------------------------
do $$ begin
  assert not has_function_privilege('authenticated',
    'public.scrivi_formazione(uuid, smallint, text, boolean, jsonb, jsonb, text, boolean, text)', 'execute'),
    'scrivi_formazione chiamabile da authenticated';
  assert not has_function_privilege('anon',
    'public.scrivi_formazione(uuid, smallint, text, boolean, jsonb, jsonb, text, boolean, text)', 'execute'),
    'scrivi_formazione chiamabile da anon';
  assert not has_function_privilege('authenticated', 'public.togli_dalle_formazioni(uuid, text)', 'execute'),
    'togli_dalle_formazioni chiamabile da authenticated';
  assert has_function_privilege('authenticated', 'public.admin_save_lineup(uuid, smallint, text, boolean, jsonb, text)', 'execute'),
    'admin_save_lineup deve essere chiamabile (controlla da sé chi è amministratore)';
end $$;

select 'tutto ok' as esito;
