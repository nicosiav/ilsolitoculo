-- Il Solito Culo — permessi (Row Level Security)
-- Regole: ognuno modifica solo la formazione della propria squadra, e solo prima
-- della scadenza della giornata. Le formazioni altrui si vedono solo a scadenza
-- passata. L'amministratore vede e modifica tutto.

-- Funzioni di appoggio ------------------------------------------------------
create or replace function public.my_team() returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.deadline_passed(md smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select now() > deadline from public.matchdays where id = md), false)
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.lineup_team(l uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from public.lineups where id = l
$$;

create or replace function public.lineup_matchday(l uuid) returns smallint
language sql stable security definer set search_path = public as $$
  select matchday from public.lineups where id = l
$$;

alter table public.teams        enable row level security;
alter table public.profiles     enable row level security;
alter table public.players      enable row level security;
alter table public.matchdays    enable row level security;
alter table public.lineups      enable row level security;
alter table public.lineup_slots enable row level security;
alter table public.lineup_log   enable row level security;

-- Squadre, rose, giornate: tutti leggono, solo l'admin scrive --------------
drop policy if exists teams_read on public.teams;
create policy teams_read on public.teams for select to authenticated using (true);
drop policy if exists teams_admin on public.teams;
create policy teams_admin on public.teams for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists players_read on public.players;
create policy players_read on public.players for select to authenticated using (true);
drop policy if exists players_admin on public.players;
create policy players_admin on public.players for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists matchdays_read on public.matchdays;
create policy matchdays_read on public.matchdays for select to authenticated using (true);
drop policy if exists matchdays_admin on public.matchdays;
create policy matchdays_admin on public.matchdays for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Profili: ognuno vede il proprio, l'admin li vede tutti -------------------
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for update to authenticated
  -- si può cambiare solo il proprio nome: ruolo e squadra restano all'admin
  -- (my_role() e my_team() sono security definer: niente ricorsione fra policy)
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.my_role() and team_id is not distinct from public.my_team());
drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Formazioni: la propria sempre, le altre dopo la scadenza ------------------
drop policy if exists lineups_read on public.lineups;
create policy lineups_read on public.lineups for select to authenticated
  using (team_id = public.my_team() or public.is_admin() or public.deadline_passed(matchday));

drop policy if exists lineups_write on public.lineups;
create policy lineups_write on public.lineups for insert to authenticated
  with check ((team_id = public.my_team() and not public.deadline_passed(matchday)) or public.is_admin());

drop policy if exists lineups_update on public.lineups;
create policy lineups_update on public.lineups for update to authenticated
  using ((team_id = public.my_team() and not public.deadline_passed(matchday)) or public.is_admin())
  with check ((team_id = public.my_team() and not public.deadline_passed(matchday)) or public.is_admin());

drop policy if exists lineups_delete on public.lineups;
create policy lineups_delete on public.lineups for delete to authenticated using (public.is_admin());

drop policy if exists slots_read on public.lineup_slots;
create policy slots_read on public.lineup_slots for select to authenticated
  using (public.lineup_team(lineup_id) = public.my_team() or public.is_admin() or public.deadline_passed(public.lineup_matchday(lineup_id)));

drop policy if exists slots_write on public.lineup_slots;
create policy slots_write on public.lineup_slots for all to authenticated
  using ((public.lineup_team(lineup_id) = public.my_team() and not public.deadline_passed(public.lineup_matchday(lineup_id))) or public.is_admin())
  with check ((public.lineup_team(lineup_id) = public.my_team() and not public.deadline_passed(public.lineup_matchday(lineup_id))) or public.is_admin());

-- Log: si scrive solo a proprio nome, non si modifica né si cancella -------
drop policy if exists log_insert on public.lineup_log;
create policy log_insert on public.lineup_log for insert to authenticated
  with check (user_id = auth.uid() and (team_id = public.my_team() or public.is_admin()));

drop policy if exists log_read on public.lineup_log;
create policy log_read on public.lineup_log for select to authenticated
  using (team_id = public.my_team() or public.is_admin() or public.deadline_passed(matchday));
