-- Il Solito Culo — calendario di Serie A, blocco partita per partita, formazioni pubbliche
-- Da eseguire dopo 05_admin.sql.

-- 1) La squadra di Serie A di ogni giocatore (serve per il blocco) ---------
alter table public.players add column if not exists club text;
create index if not exists players_club_idx on public.players (club);

-- 2) Il calendario, aggiornato dalla funzione di sincronizzazione ----------
create table if not exists public.fixtures (
  id        bigint primary key,            -- id della partita su football-data.org
  matchday  smallint not null,
  home      text not null,                 -- nomi come nel listone della lega
  away      text not null,
  kickoff   timestamptz not null,
  status    text,
  updated_at timestamptz not null default now()
);
create index if not exists fixtures_matchday_idx on public.fixtures (matchday, kickoff);

-- Nomi delle squadre secondo l'API tradotti in quelli del listone ----------
create table if not exists public.club_aliases (
  fd_name text primary key,
  club    text not null
);
insert into public.club_aliases (fd_name, club) values
  ('Atalanta BC', 'Atalanta'), ('Bologna FC 1909', 'Bologna'), ('Cagliari Calcio', 'Cagliari'),
  ('Como 1907', 'Como'), ('Empoli FC', 'Empoli'), ('ACF Fiorentina', 'Fiorentina'),
  ('Frosinone Calcio', 'Frosinone'), ('Genoa CFC', 'Genoa'), ('Hellas Verona FC', 'Verona'),
  ('FC Internazionale Milano', 'Inter'), ('Juventus FC', 'Juventus'), ('SS Lazio', 'Lazio'),
  ('US Lecce', 'Lecce'), ('AC Milan', 'Milan'), ('AC Monza', 'Monza'), ('SSC Napoli', 'Napoli'),
  ('Parma Calcio 1913', 'Parma'), ('AS Roma', 'Roma'), ('US Salernitana 1919', 'Salernitana'),
  ('US Sassuolo Calcio', 'Sassuolo'), ('Torino FC', 'Torino'), ('Udinese Calcio', 'Udinese'),
  ('Venezia FC', 'Venezia'), ('US Cremonese', 'Cremonese'), ('Pisa Sporting Club', 'Pisa'),
  ('AC Pisa 1909', 'Pisa'), ('Spezia Calcio', 'Spezia'), ('UC Sampdoria', 'Sampdoria'),
  ('Palermo FC', 'Palermo'), ('SSD Palermo', 'Palermo'), ('Benevento Calcio', 'Benevento')
on conflict (fd_name) do nothing;

-- 3) Le giornate ora arrivano dal calendario -------------------------------
alter table public.matchdays add column if not exists first_kickoff timestamptz;
alter table public.matchdays add column if not exists last_kickoff  timestamptz;
alter table public.matchdays add column if not exists closes_at     timestamptz;
alter table public.matchdays alter column deadline drop not null;

-- Ricalcola giornate e giornata corrente a partire dalle partite
create or replace function public.refresh_matchdays() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int; v_cur smallint;
begin
  insert into public.matchdays (id, label, first_kickoff, last_kickoff, closes_at, deadline)
  select f.matchday, 'Giornata ' || f.matchday, min(f.kickoff), max(f.kickoff),
         max(f.kickoff) + interval '2 hours', min(f.kickoff)
  from public.fixtures f group by f.matchday
  on conflict (id) do update set
    first_kickoff = excluded.first_kickoff,
    last_kickoff  = excluded.last_kickoff,
    closes_at     = excluded.closes_at,
    deadline      = excluded.deadline,
    label         = coalesce(public.matchdays.label, excluded.label);
  get diagnostics v_n = row_count;

  select id into v_cur from public.matchdays
  where closes_at is not null and closes_at > now() order by closes_at limit 1;
  if v_cur is null then select max(id) into v_cur from public.matchdays; end if;
  -- in due passi: l'indice unico ammette una sola giornata corrente alla volta
  update public.matchdays set is_current = false where is_current and id is distinct from v_cur;
  update public.matchdays set is_current = true  where id = v_cur and not is_current;

  return jsonb_build_object('giornate', v_n, 'corrente', v_cur);
end $$;

grant execute on function public.refresh_matchdays() to authenticated, service_role;

-- 4) Quando si può toccare cosa -------------------------------------------
-- La giornata è aperta finché l'ultima partita non è finita.
create or replace function public.matchday_open(md smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select now() < closes_at from public.matchdays where id = md), false)
$$;

-- Un giocatore è bloccato quando la sua squadra è scesa in campo.
-- Chi non ha una squadra nota si blocca al via della prima partita di giornata;
-- chi gioca in una squadra che questa giornata riposa resta libero.
create or replace function public.player_locked(md smallint, p_player uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_club text; v_locked boolean;
begin
  select club into v_club from public.players where id = p_player;
  if v_club is null or v_club = '' then
    return coalesce((select min(kickoff) <= now() from public.fixtures where matchday = md), false);
  end if;
  select bool_or(kickoff <= now()) into v_locked
  from public.fixtures where matchday = md and (home = v_club or away = v_club);
  -- squadra che in questa giornata non gioca (turno di riposo, rinvio): resta libero
  return coalesce(v_locked, false);
end $$;

grant execute on function public.matchday_open(smallint), public.player_locked(smallint, uuid) to authenticated;

-- Elenco pronto per l'app: chi è bloccato e da che ora --------------------
create or replace function public.roster_locks(md smallint, p_team uuid default null) returns table (
  player_id uuid, club text, kickoff timestamptz, locked boolean
) language sql stable security definer set search_path = public as $$
  select p.id, p.club,
         (select min(f.kickoff) from public.fixtures f
          where f.matchday = md and (f.home = p.club or f.away = p.club)),
         public.player_locked(md, p.id)
  from public.players p
  where p.team_id = coalesce(p_team, p.team_id)
$$;

grant execute on function public.roster_locks(smallint, uuid) to authenticated;

-- 5) Salvataggio: rispetta i blocchi partita per partita -------------------
create or replace function public.save_lineup(
  p_matchday   smallint,
  p_module     text,
  p_bench_free boolean,
  p_slots      jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team       uuid := public.my_team();
  v_lineup     uuid;
  v_old        jsonb;
  v_old_module text;
  v_new        jsonb;
  v_action     text;
  v_changes    jsonb;
  v_bloccati   text;
begin
  if v_team is null then
    raise exception 'Questo account non è collegato a nessuna squadra' using errcode = 'P0001';
  end if;
  if not public.matchday_open(p_matchday) then
    raise exception 'La giornata è finita: la formazione non si può più cambiare' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_slots) is distinct from 'array' then
    raise exception 'Formazione non valida' using errcode = 'P0003';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_slots) e
    join public.players p on p.id = (e ->> 'player_id')::uuid
    where p.team_id <> v_team
  ) then
    raise exception 'Puoi schierare solo giocatori della tua rosa' using errcode = 'P0004';
  end if;

  select l.id, l.module into v_lineup, v_old_module
  from public.lineups l where l.team_id = v_team and l.matchday = p_matchday;

  if v_lineup is not null then
    select jsonb_agg(jsonb_build_object('pos', s.pos, 'player_id', s.player_id, 'nome', p.name, 'ruolo', p.role) order by s.pos)
      into v_old
    from public.lineup_slots s join public.players p on p.id = s.player_id
    where s.lineup_id = v_lineup;
  end if;

  -- niente modifiche che coinvolgono giocatori già scesi in campo
  with o as (
    select (e ->> 'pos')::smallint pos, (e ->> 'player_id')::uuid pid, e ->> 'nome' nome
    from jsonb_array_elements(coalesce(v_old, '[]'::jsonb)) e
  ), n as (
    select (e ->> 'pos')::smallint pos, (e ->> 'player_id')::uuid pid
    from jsonb_array_elements(p_slots) e
  ), diff as (
    select coalesce(o.pos, n.pos) pos, o.pid old_pid, n.pid new_pid
    from o full join n on o.pos = n.pos
    where o.pid is distinct from n.pid
  )
  select case when count(*) > 3
              then string_agg(nome, ', ' order by nome) filter (where n <= 3) || ' e altri ' || (count(*) - 3)
              else string_agg(nome, ', ' order by nome) end
    into v_bloccati
  from (
    select distinct pl.name nome, dense_rank() over (order by pl.name) n
    from diff
    join public.players pl on pl.id in (diff.old_pid, diff.new_pid)
    where public.player_locked(p_matchday, pl.id)
  ) b;

  if v_bloccati is not null then
    raise exception 'Partita già iniziata per: %', v_bloccati using errcode = 'P0007';
  end if;

  insert into public.lineups (team_id, matchday, module, bench_free, updated_by)
  values (v_team, p_matchday, p_module, coalesce(p_bench_free, false), auth.uid())
  on conflict (team_id, matchday)
    do update set module = excluded.module, bench_free = excluded.bench_free
  returning id into v_lineup;

  delete from public.lineup_slots where lineup_id = v_lineup;
  insert into public.lineup_slots (lineup_id, pos, player_id)
  select v_lineup, (e ->> 'pos')::smallint, (e ->> 'player_id')::uuid
  from jsonb_array_elements(p_slots) e;

  select coalesce(jsonb_agg(jsonb_build_object('pos', s.pos, 'nome', p.name, 'ruolo', p.role) order by s.pos), '[]'::jsonb)
    into v_new
  from public.lineup_slots s join public.players p on p.id = s.player_id
  where s.lineup_id = v_lineup;

  v_action := case when v_old is null then 'creata' else 'modificata' end;

  with o as (select (e ->> 'pos')::int pos, e ->> 'nome' nome from jsonb_array_elements(coalesce(v_old, '[]'::jsonb)) e),
       n as (select (e ->> 'pos')::int pos, e ->> 'nome' nome from jsonb_array_elements(v_new) e)
  select jsonb_build_object(
    'entrati',  coalesce((select jsonb_agg(jsonb_build_object('pos', n.pos, 'nome', n.nome) order by n.pos)
                          from n left join o on o.nome = n.nome where o.nome is null), '[]'::jsonb),
    'usciti',   coalesce((select jsonb_agg(jsonb_build_object('pos', o.pos, 'nome', o.nome) order by o.pos)
                          from o left join n on n.nome = o.nome where n.nome is null), '[]'::jsonb),
    'spostati', coalesce((select jsonb_agg(jsonb_build_object('nome', n.nome, 'da', o.pos, 'a', n.pos) order by n.pos)
                          from n join o on o.nome = n.nome where o.pos is distinct from n.pos), '[]'::jsonb),
    'modulo',   case when coalesce(v_old_module, '') is distinct from coalesce(p_module, '')
                     then jsonb_build_object('da', v_old_module, 'a', p_module) end
  ) into v_changes;

  insert into public.lineup_log (team_id, matchday, user_id, action, changes, snapshot)
  values (v_team, p_matchday, auth.uid(), v_action, v_changes, v_new);

  return jsonb_build_object('lineup_id', v_lineup, 'action', v_action, 'changes', v_changes, 'snapshot', v_new);
end $$;

revoke all on function public.save_lineup(smallint, text, boolean, jsonb) from public;
grant execute on function public.save_lineup(smallint, text, boolean, jsonb) to authenticated;

-- 6) Formazioni visibili a tutti i partecipanti ---------------------------
-- La scrittura passa solo da save_lineup(): sulle tabelle restano lettura e
-- poteri dell'amministratore.
drop policy if exists lineups_read on public.lineups;
create policy lineups_read on public.lineups for select to authenticated using (true);
drop policy if exists lineups_write on public.lineups;
drop policy if exists lineups_update on public.lineups;
drop policy if exists lineups_admin on public.lineups;
create policy lineups_admin on public.lineups for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists slots_read on public.lineup_slots;
create policy slots_read on public.lineup_slots for select to authenticated using (true);
drop policy if exists slots_write on public.lineup_slots;
drop policy if exists slots_admin on public.lineup_slots;
create policy slots_admin on public.lineup_slots for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists log_read on public.lineup_log;
create policy log_read on public.lineup_log for select to authenticated using (true);
drop policy if exists log_insert on public.lineup_log;
drop policy if exists log_admin on public.lineup_log;
create policy log_admin on public.lineup_log for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.fixtures enable row level security;
drop policy if exists fixtures_read on public.fixtures;
create policy fixtures_read on public.fixtures for select to authenticated using (true);
drop policy if exists fixtures_admin on public.fixtures;
create policy fixtures_admin on public.fixtures for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.club_aliases enable row level security;
drop policy if exists aliases_read on public.club_aliases;
create policy aliases_read on public.club_aliases for select to authenticated using (true);
drop policy if exists aliases_admin on public.club_aliases;
create policy aliases_admin on public.club_aliases for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Tutti vedono i nomi e le squadre dei partecipanti ------------------------
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);

-- 7) L'import delle rose porta anche la squadra di Serie A -----------------
create or replace function public.import_players(p_sheet text, p_players jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_team uuid; v_ins int := 0; v_upd int := 0; v_del int := 0;
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore può aggiornare le rose' using errcode = 'P0005';
  end if;
  select id into v_team from public.teams where sheet_name = p_sheet or name = p_sheet;
  if v_team is null then
    raise exception 'Squadra "%" non trovata', p_sheet using errcode = 'P0006';
  end if;

  with keep as (select (e ->> 'slot')::smallint slot from jsonb_array_elements(p_players) e)
  delete from public.players p
  where p.team_id = v_team and p.slot not in (select slot from keep);
  get diagnostics v_del = row_count;

  with src as (
    select (e ->> 'slot')::smallint slot, upper(e ->> 'role') role, e ->> 'name' name, nullif(e ->> 'club', '') club
    from jsonb_array_elements(p_players) e
  ), done as (
    insert into public.players (team_id, slot, role, name, club)
    select v_team, slot, role, name, club from src
    on conflict (team_id, slot) do update
      set role = excluded.role, name = excluded.name,
          club = coalesce(excluded.club, public.players.club)
    returning (xmax = 0) as inserito
  )
  select count(*) filter (where inserito), count(*) filter (where not inserito)
  into v_ins, v_upd from done;

  return jsonb_build_object('squadra', p_sheet, 'nuovi', v_ins, 'aggiornati', v_upd, 'rimossi', v_del);
end $$;

grant execute on function public.import_players(text, jsonb) to authenticated;

-- 8) Dal calendario dell'API ai nomi della lega ----------------------------
-- Prova, in ordine: la tabella degli alias, il nome breve, una squadra già
-- usata nelle rose; in mancanza d'altro tiene il nome breve dell'API.
create or replace function public.club_name(p_name text, p_short text) returns text
language sql stable set search_path = public as $$
  select coalesce(
    (select a.club from public.club_aliases a where a.fd_name = p_name),
    (select a.club from public.club_aliases a where a.fd_name = p_short),
    (select pc.club from (select distinct club from public.players
                          where club is not null and club <> '') pc
      where p_short = pc.club or p_name ilike '%' || pc.club || '%'
      order by length(pc.club) desc limit 1),
    nullif(p_short, ''), p_name)
$$;

-- Scrive le partite arrivate dall'API e ricalcola le giornate --------------
-- La chiama la funzione "sync-calendario" (chiave di servizio) oppure
-- l'amministratore dall'app.
create or replace function public.import_fixtures(p_matches jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_n int := 0; v_ignote text;
begin
  if not (public.is_admin() or v_role = 'service_role') then
    raise exception 'Solo l''amministratore può aggiornare il calendario' using errcode = 'P0005';
  end if;
  if jsonb_typeof(p_matches) is distinct from 'array' then
    raise exception 'Calendario non valido' using errcode = 'P0003';
  end if;

  with src as (
    select (e ->> 'id')::bigint id,
           (e ->> 'matchday')::smallint matchday,
           public.club_name(e ->> 'home', e ->> 'home_short') home,
           public.club_name(e ->> 'away', e ->> 'away_short') away,
           (e ->> 'kickoff')::timestamptz kickoff,
           nullif(e ->> 'status', '') status
    from jsonb_array_elements(p_matches) e
    where (e ->> 'matchday') is not null and (e ->> 'kickoff') is not null
  ), done as (
    insert into public.fixtures (id, matchday, home, away, kickoff, status, updated_at)
    select id, matchday, home, away, kickoff, status, now() from src
    on conflict (id) do update set
      matchday = excluded.matchday, home = excluded.home, away = excluded.away,
      kickoff = excluded.kickoff, status = excluded.status, updated_at = now()
    returning 1
  )
  select count(*) into v_n from done;

  -- squadre del calendario che non compaiono in nessuna rosa: di solito è un
  -- alias da aggiungere in club_aliases
  select string_agg(distinct c, ', ') into v_ignote
  from (select home c from public.fixtures union select away from public.fixtures) x
  where c not in (select distinct club from public.players where club is not null);

  return jsonb_build_object('partite', v_n, 'giornate', public.refresh_matchdays(), 'da_controllare', v_ignote);
end $$;

revoke all on function public.import_fixtures(jsonb) from public;
grant execute on function public.import_fixtures(jsonb) to authenticated, service_role;

-- 9) La squadra di Serie A dei giocatori in rosa ---------------------------
-- Serve al blocco partita per partita: chi non ce l'ha si blocca all'inizio
-- della giornata. La riempie l'abbinamento automatico o l'amministratore.
create or replace function public.set_player_clubs(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_n int := 0;
begin
  if not (public.is_admin() or v_role = 'service_role') then
    raise exception 'Solo l''amministratore può cambiare le squadre dei giocatori' using errcode = 'P0005';
  end if;
  with src as (
    select (e ->> 'player_id')::uuid id, nullif(btrim(e ->> 'club'), '') club
    from jsonb_array_elements(p_items) e
  ), done as (
    update public.players p set club = src.club from src
    where p.id = src.id and p.club is distinct from src.club
    returning 1
  )
  select count(*) into v_n from done;
  return jsonb_build_object('aggiornati', v_n);
end $$;

revoke all on function public.set_player_clubs(jsonb) from public;
grant execute on function public.set_player_clubs(jsonb) to authenticated, service_role;

-- 10) Giornata impostata a mano (senza calendario) -------------------------
-- Resta come scorciatoia: qui la chiusura coincide con la scadenza indicata.
create or replace function public.set_current_matchday(p_id smallint, p_label text, p_deadline timestamptz)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore può cambiare la giornata' using errcode = 'P0005';
  end if;
  insert into public.matchdays (id, label, deadline, closes_at, is_current)
  values (p_id, coalesce(nullif(p_label, ''), 'Giornata ' || p_id), p_deadline, p_deadline, false)
  on conflict (id) do update set label = excluded.label, deadline = excluded.deadline,
                                 closes_at = excluded.closes_at;
  update public.matchdays set is_current = false where is_current and id <> p_id;
  update public.matchdays set is_current = true  where id = p_id and not is_current;
  return jsonb_build_object('id', p_id, 'chiude', p_deadline);
end $$;

grant execute on function public.set_current_matchday(smallint, text, timestamptz) to authenticated;

-- Controlli utili ----------------------------------------------------------
-- select * from public.matchdays order by id;
-- select * from public.fixtures where matchday = (select id from public.matchdays where is_current) order by kickoff;
-- select t.name, count(*) filter (where p.club is null) senza_squadra
--   from public.players p join public.teams t on t.id = p.team_id group by t.name order by t.name;
