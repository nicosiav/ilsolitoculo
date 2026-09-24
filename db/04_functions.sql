-- Il Solito Culo — salvataggio della formazione in un colpo solo
-- L'app chiama save_lineup(): scrive formazione e log nella stessa transazione,
-- e il log (cosa è entrato, uscito, spostato) lo calcola il database, non il client.

create or replace function public.save_lineup(
  p_matchday   smallint,
  p_module     text,
  p_bench_free boolean,
  p_slots      jsonb          -- [{"pos":1,"player_id":"..."}, ...]
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_team       uuid := public.my_team();
  v_lineup     uuid;
  v_old        jsonb;
  v_old_module text;
  v_new        jsonb;
  v_action     text;
  v_changes    jsonb;
begin
  if v_team is null then
    raise exception 'Questo account non è collegato a nessuna squadra' using errcode = 'P0001';
  end if;
  if public.deadline_passed(p_matchday) then
    raise exception 'La giornata è chiusa: la formazione non si può più cambiare' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_slots) is distinct from 'array' then
    raise exception 'Formazione non valida' using errcode = 'P0003';
  end if;

  select l.id, l.module into v_lineup, v_old_module
  from public.lineups l where l.team_id = v_team and l.matchday = p_matchday;

  if v_lineup is not null then
    select jsonb_agg(jsonb_build_object('pos', s.pos, 'nome', p.name, 'ruolo', p.role) order by s.pos)
      into v_old
    from public.lineup_slots s join public.players p on p.id = s.player_id
    where s.lineup_id = v_lineup;
  end if;

  insert into public.lineups (team_id, matchday, module, bench_free)
  values (v_team, p_matchday, p_module, coalesce(p_bench_free, false))
  on conflict (team_id, matchday)
    do update set module = excluded.module, bench_free = excluded.bench_free
  returning id into v_lineup;

  delete from public.lineup_slots where lineup_id = v_lineup;

  insert into public.lineup_slots (lineup_id, pos, player_id)
  select v_lineup, (e ->> 'pos')::smallint, (e ->> 'player_id')::uuid
  from jsonb_array_elements(p_slots) e;

  if exists (
    select 1 from public.lineup_slots s
    join public.players p on p.id = s.player_id
    where s.lineup_id = v_lineup and p.team_id <> v_team
  ) then
    raise exception 'Puoi schierare solo giocatori della tua rosa' using errcode = 'P0004';
  end if;

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

-- Traccia anche l'export del file .xls -------------------------------------
create or replace function public.log_export(p_matchday smallint) returns void
language plpgsql security invoker set search_path = public as $$
declare v_team uuid := public.my_team();
begin
  if v_team is null then return; end if;
  insert into public.lineup_log (team_id, matchday, user_id, action)
  values (v_team, p_matchday, auth.uid(), 'esportata');
end $$;

revoke all on function public.log_export(smallint) from public;
grant execute on function public.log_export(smallint) to authenticated;

-- Modello .xls della lega, per l'export ------------------------------------
-- Bucket privato: lo legge chi è autenticato, lo aggiorna solo l'amministratore.
insert into storage.buckets (id, name, public)
values ('modelli', 'modelli', false)
on conflict (id) do nothing;

drop policy if exists modelli_read on storage.objects;
create policy modelli_read on storage.objects for select to authenticated
  using (bucket_id = 'modelli');

drop policy if exists modelli_write on storage.objects;
create policy modelli_write on storage.objects for all to authenticated
  using (bucket_id = 'modelli' and public.is_admin())
  with check (bucket_id = 'modelli' and public.is_admin());
