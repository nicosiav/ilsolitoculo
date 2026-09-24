\set ON_ERROR_STOP on
-- dati di prova -------------------------------------------------------------
insert into public.teams (name, sheet_name) values ('Valerio','Valerio'), ('Sebi','Sebi');
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','valerio@test.it'),
  ('22222222-2222-2222-2222-222222222222','sebi@test.it');
update public.profiles set display_name='Valerio', role='player',
  team_id=(select id from public.teams where name='Valerio')
  where id='11111111-1111-1111-1111-111111111111';
update public.profiles set display_name='Sebi', role='admin',
  team_id=(select id from public.teams where name='Sebi')
  where id='22222222-2222-2222-2222-222222222222';

insert into public.players (team_id, slot, role, name, club)
select t.id, g.i, (array['P','D','D','D','D','C','C','C','C','A','A','A'])[((g.i-1)%12)+1],
       t.name || ' g' || g.i,
       (array['Inter','Milan','Juventus','Napoli','Roma','Lazio'])[((g.i-1)%6)+1]
from public.teams t, generate_series(1,24) g(i);

-- come amministratore
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- calendario: Inter-Milan ieri, Juventus-Napoli fra due giorni ---------------
select public.import_fixtures(jsonb_build_array(
  jsonb_build_object('id',1,'matchday',7,'home','FC Internazionale Milano','home_short','Inter','away','AC Milan','away_short','Milan','kickoff', (now() - interval '1 day')::text,'status','FINISHED'),
  jsonb_build_object('id',2,'matchday',7,'home','Juventus FC','home_short','Juventus','away','SSC Napoli','away_short','Napoli','kickoff', (now() + interval '2 days')::text,'status','TIMED'),
  jsonb_build_object('id',4,'matchday',7,'home','AS Roma','home_short','Roma','away','SS Lazio','away_short','Lazio','kickoff', (now() + interval '3 days')::text,'status','TIMED'),
  jsonb_build_object('id',3,'matchday',8,'home','AC Milan','home_short','Milan','away','Juventus FC','away_short','Juventus','kickoff', (now() + interval '9 days')::text,'status','TIMED')
)) as import;

select id, label, first_kickoff, closes_at, is_current from public.matchdays order by id;

-- chi è bloccato ------------------------------------------------------------
select rl.club, count(*) quanti, bool_and(rl.locked) bloccati, min(rl.kickoff) inizio
from public.roster_locks(7::smallint, (select id from public.teams where name='Valerio')) rl
group by rl.club order by rl.club;

-- salvataggio come Valerio --------------------------------------------------
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.my_team() is not null as ho_squadra, public.matchday_open(7::smallint) as giornata_aperta;

-- 1) primo salvataggio con dentro chi ha gia' giocato: deve essere rifiutato
do $$
begin
  perform public.save_lineup(7::smallint, '4-3-3', false, (
    select jsonb_agg(jsonb_build_object('pos', n, 'player_id', id))
    from (select id, row_number() over (order by slot) n
          from public.players where team_id = public.my_team()) x where n <= 22));
  raise notice 'PROBLEMA: accettato un giocatore gia'' sceso in campo';
exception when others then
  raise notice 'rifiutato come previsto: % (%)', sqlerrm, sqlstate;
end $$;

-- 2) primo salvataggio con i soli giocatori non ancora scesi in campo
select public.save_lineup(7::smallint, '4-3-3', false, (
  select jsonb_agg(jsonb_build_object('pos', n, 'player_id', id))
  from (select id, row_number() over (order by slot) n
        from public.players where team_id = (select id from public.teams where name='Valerio')
          and not public.player_locked(7::smallint, id)) x
  where n <= 22
)) -> 'action' as primo_salvataggio;

-- prova a spostare un giocatore gia' sceso in campo (Inter/Milan) ------------
select public.player_locked(7::smallint, id) as bloccato, name, club
from public.players where team_id = (select id from public.teams where name='Valerio')
order by slot limit 4;

-- scambio due titolari: uno e' dell'Inter -> deve rifiutare
do $$
declare v_slots jsonb; v_a uuid; v_b uuid;
begin
  select jsonb_agg(jsonb_build_object('pos', s.pos, 'player_id', s.player_id) order by s.pos) into v_slots
  from public.lineup_slots s
  join public.lineups l on l.id = s.lineup_id
  where l.team_id = public.my_team() and l.matchday = 7;
  select player_id into v_a from public.lineup_slots s join public.lineups l on l.id=s.lineup_id
    where l.matchday=7 and s.pos=1;
  select id into v_b from public.players
    where team_id = public.my_team() and id not in (select player_id from public.lineup_slots s join public.lineups l on l.id=s.lineup_id where l.matchday=7)
    limit 1;
  begin
    perform public.save_lineup(7::smallint, '4-3-3', false,
      (select jsonb_agg(case when (e->>'pos')::int = 1
                             then jsonb_build_object('pos', 1, 'player_id', v_b) else e end)
       from jsonb_array_elements(v_slots) e));
    raise notice 'PROBLEMA: il cambio e'' passato';
  exception when others then
    raise notice 'rifiutato come previsto: % (%)', sqlerrm, sqlstate;
  end;
end $$;

-- cambio che tocca solo giocatori non ancora in campo -> deve passare
do $$
declare v_slots jsonb; v_a int; v_b int; v_ida uuid; v_idb uuid;
begin
  select s.pos, s.player_id into v_a, v_ida
  from public.lineup_slots s join public.lineups l on l.id = s.lineup_id
  join public.players p on p.id = s.player_id
  where l.matchday = 7 and not public.player_locked(7::smallint, p.id) order by s.pos limit 1;
  select s.pos, s.player_id into v_b, v_idb
  from public.lineup_slots s join public.lineups l on l.id = s.lineup_id
  join public.players p on p.id = s.player_id
  where l.matchday = 7 and not public.player_locked(7::smallint, p.id) and s.pos > v_a order by s.pos desc limit 1;
  select jsonb_agg(jsonb_build_object('pos', s.pos,
           'player_id', case when s.pos = v_a then v_idb when s.pos = v_b then v_ida else s.player_id end) order by s.pos)
    into v_slots
  from public.lineup_slots s join public.lineups l on l.id = s.lineup_id
  where l.team_id = public.my_team() and l.matchday = 7;
  perform public.save_lineup(7::smallint, '3-5-2', false, v_slots);
  raise notice 'scambio fra due non ancora in campo (posti % e %): accettato', v_a, v_b;
end $$;

-- il log ha registrato tutto ------------------------------------------------
select action, jsonb_array_length(coalesce(changes->'entrati','[]')) entrati,
       jsonb_array_length(coalesce(changes->'usciti','[]')) usciti
from public.lineup_log order by at;

-- giornata finita: niente piu' modifiche ------------------------------------
update public.matchdays set closes_at = now() - interval '1 hour' where id = 7;
select public.matchday_open(7::smallint) as aperta_dopo_la_fine;
select public.refresh_matchdays() as ricalcolo;
select id, is_current from public.matchdays order by id;
