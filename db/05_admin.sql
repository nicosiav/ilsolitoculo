-- Il Solito Culo — amministratori e funzioni di amministrazione
-- Da eseguire dopo aver creato gli account in Authentication → Users.

-- Chi amministra la lega ---------------------------------------------------
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and u.email in ('valerionicosia86@gmail.com', 'sebi.nicosia@tiscali.it');

-- Aggiorna la rosa di una squadra dal file Excel ---------------------------
-- L'app legge il foglio della squadra e manda qui i 31 posti: i giocatori
-- nuovi entrano, quelli cambiati si aggiornano, i posti svuotati si liberano.
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
    select (e ->> 'slot')::smallint slot, upper(e ->> 'role') role, e ->> 'name' name
    from jsonb_array_elements(p_players) e
  ), done as (
    insert into public.players (team_id, slot, role, name)
    select v_team, slot, role, name from src
    on conflict (team_id, slot) do update set role = excluded.role, name = excluded.name
    returning (xmax = 0) as inserito
  )
  select count(*) filter (where inserito), count(*) filter (where not inserito)
  into v_ins, v_upd from done;

  return jsonb_build_object('squadra', p_sheet, 'nuovi', v_ins, 'aggiornati', v_upd, 'rimossi', v_del);
end $$;

revoke all on function public.import_players(text, jsonb) from public;
grant execute on function public.import_players(text, jsonb) to authenticated;

-- Apre (o sposta) la giornata corrente ------------------------------------
create or replace function public.set_current_matchday(p_id smallint, p_label text, p_deadline timestamptz)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore può cambiare la giornata' using errcode = 'P0005';
  end if;
  update public.matchdays set is_current = false where is_current and id <> p_id;
  insert into public.matchdays (id, label, deadline, is_current)
  values (p_id, coalesce(nullif(p_label, ''), 'Giornata ' || p_id), p_deadline, true)
  on conflict (id) do update set label = excluded.label, deadline = excluded.deadline, is_current = true;
  return jsonb_build_object('id', p_id, 'deadline', p_deadline);
end $$;

revoke all on function public.set_current_matchday(smallint, text, timestamptz) from public;
grant execute on function public.set_current_matchday(smallint, text, timestamptz) to authenticated;

-- Controllo: chi amministra e qual è la giornata aperta --------------------
-- select u.email, p.role, t.name from public.profiles p
--   join auth.users u on u.id = p.id left join public.teams t on t.id = p.team_id order by p.role;
-- select * from public.matchdays where is_current;
