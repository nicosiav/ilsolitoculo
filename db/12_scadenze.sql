-- Scadenze delle formazioni: blocco 30 minuti prima, regola del reparto, scadenza
-- della formazione completa, modifiche dell'amministratore pubbliche.
--
-- Regole decise da Valerio (13/10/2026), dal regolamento (punti 7.1, 7.2, 7.4):
--   - un giocatore si blocca 30 minuti prima della partita della sua squadra di Serie A
--     (prima si bloccava al fischio d'inizio). Chi non ha una squadra si blocca 30
--     minuti prima della prima partita della giornata; chi gioca un recupero o una
--     partita rinviata resta libero fino alla scadenza;
--   - un panchinaro bloccato (riserve 12–18 o panchina extra 19–22) "tiene fermi" i
--     giocatori del suo reparto che lo precedono in formazione: titolari del reparto e
--     panchinari del reparto messi prima di lui restano gli stessi (si possono solo
--     scambiare fra loro) e il numero dei titolari di quel reparto non cambia;
--   - la formazione completa scade alle 12.00 di domenica nei turni del weekend e alle
--     20.00 di mercoledì nei turni infrasettimanali: la data si ricava dal calendario e
--     l'amministratore la può cambiare giornata per giornata. Dopo, la formazione non
--     si cambia più;
--   - l'amministratore può sempre modificare la formazione di qualsiasi squadra: la
--     modifica resta nel log come "dell'amministratore", con una nota, e il sito la
--     mostra a tutti sulla pagina della formazione di quella squadra.
--
-- Da eseguire nel SQL Editor dopo 11_mercato.sql. Si può rieseguire.
-- Se si riesegue 06_calendario.sql, poi va rieseguito anche questo.

-- 1) Le colonne nuove ----------------------------------------------------------
alter table public.matchdays add column if not exists scadenza_auto  timestamptz;  -- dal calendario
alter table public.matchdays add column if not exists scadenza_admin timestamptz;  -- scelta dall'amministratore
alter table public.matchdays add column if not exists scadenza timestamptz
  generated always as (coalesce(scadenza_admin, scadenza_auto)) stored;            -- quella che vale

alter table public.lineup_log add column if not exists da_admin boolean not null default false;
alter table public.lineup_log add column if not exists nota     text;
alter table public.lineup_log add column if not exists autore   text;
create index if not exists lineup_log_admin_idx on public.lineup_log (matchday, team_id) where da_admin;

-- 2) Le partite che fanno la giornata --------------------------------------------
-- Senza le rinviate e le annullate, e senza i recuperi giocati settimane dopo: valgono
-- le partite a non più di 4 giorni dalla partita "di mezzo" (la mediana). Così una
-- giornata con un recupero a dicembre non resta aperta fino a dicembre.
create or replace function public.partite_della_giornata(md smallint) returns setof public.fixtures
language sql stable set search_path = public as $$
  with f as (
    select * from public.fixtures
    where matchday = md and coalesce(status, '') not in ('POSTPONED', 'CANCELLED')
  ), m as (
    select percentile_disc(0.5) within group (order by kickoff) k from f
  )
  select f.* from f, m
  where f.kickoff between m.k - interval '4 days' and m.k + interval '4 days'
$$;

-- La scadenza della formazione completa (regolamento 7.1), ora italiana:
--   turno del weekend (partita di mezzo fra venerdì e lunedì)  -> domenica alle 12.00
--   turno infrasettimanale (fra martedì e giovedì)             -> mercoledì alle 20.00
create or replace function public.scadenza_da_calendario(md smallint) returns timestamptz
language sql stable set search_path = public as $$
  with m as (
    select percentile_disc(0.5) within group (order by kickoff) k from public.partite_della_giornata(md)
  ), g as (
    select (k at time zone 'Europe/Rome')::date d,
           extract(isodow from k at time zone 'Europe/Rome')::int dow
    from m where k is not null
  )
  select case
    when dow in (2, 3, 4) then ((d + (3 - dow)) + time '20:00') at time zone 'Europe/Rome'
    else ((d + case when dow = 1 then -1 else 7 - dow end) + time '12:00') at time zone 'Europe/Rome'
  end
  from g
$$;

-- 3) Le giornate dal calendario, con la scadenza --------------------------------
-- Prima partita, ultima partita e chiusura si contano sulle partite della giornata
-- (vedi sopra); "deadline" resta la prima partita (serve al mercato: giornata iniziata).
create or replace function public.refresh_matchdays() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int; v_cur smallint;
begin
  insert into public.matchdays (id, label, first_kickoff, last_kickoff, closes_at, deadline, scadenza_auto)
  select x.matchday, 'Giornata ' || x.matchday, b.primo, b.ultimo, b.ultimo + interval '2 hours', b.primo,
         public.scadenza_da_calendario(x.matchday)
  from (select distinct matchday from public.fixtures) x
  cross join lateral (
    select coalesce(min(p.kickoff), (select min(kickoff) from public.fixtures where matchday = x.matchday)) primo,
           coalesce(max(p.kickoff), (select max(kickoff) from public.fixtures where matchday = x.matchday)) ultimo
    from public.partite_della_giornata(x.matchday) p
  ) b
  on conflict (id) do update set
    first_kickoff = excluded.first_kickoff,
    last_kickoff  = excluded.last_kickoff,
    closes_at     = excluded.closes_at,
    deadline      = excluded.deadline,
    scadenza_auto = excluded.scadenza_auto,
    label         = coalesce(public.matchdays.label, excluded.label);
  get diagnostics v_n = row_count;

  select id into v_cur from public.matchdays
  where closes_at is not null and closes_at > now() order by closes_at limit 1;
  if v_cur is null then select max(id) into v_cur from public.matchdays; end if;
  update public.matchdays set is_current = false where is_current and id is distinct from v_cur;
  update public.matchdays set is_current = true  where id = v_cur and not is_current;

  return jsonb_build_object('giornate', v_n, 'corrente', v_cur);
end $$;
grant execute on function public.refresh_matchdays() to authenticated, service_role;

-- 4) Quando si blocca un giocatore -----------------------------------------------
-- 30 minuti prima della partita della sua squadra (regolamento 7.4, con mezz'ora
-- invece di un'ora). Squadra ignota: 30 minuti prima della prima partita della
-- giornata. Squadra che riposa, partita rinviata o recupero lontano: libero (fino
-- alla scadenza della formazione completa, che blocca tutto).
create or replace function public.player_lock_at(md smallint, p_player uuid) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare v_club text; v_k timestamptz;
begin
  select club into v_club from public.players where id = p_player;
  if v_club is null or v_club = '' then
    select coalesce(m.first_kickoff, (select min(kickoff) from public.partite_della_giornata(md)))
      into v_k from public.matchdays m where m.id = md;
    if v_k is null then select min(kickoff) into v_k from public.partite_della_giornata(md); end if;
  else
    select min(kickoff) into v_k from public.fixtures
    where matchday = md and (home = v_club or away = v_club)
      and coalesce(status, '') not in ('POSTPONED', 'CANCELLED');
  end if;
  return v_k - interval '30 minutes';
end $$;

create or replace function public.player_locked(md smallint, p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.player_lock_at(md, p_player) <= now(), false)
$$;

grant execute on function public.player_lock_at(smallint, uuid), public.player_locked(smallint, uuid) to authenticated;

-- la scadenza della formazione completa è passata?
create or replace function public.scadenza_passata(md smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select scadenza <= now() from public.matchdays where id = md), false)
$$;
grant execute on function public.scadenza_passata(smallint) to authenticated;

create or replace function public.roster_locks(md smallint, p_team uuid default null) returns table (
  player_id uuid, club text, kickoff timestamptz, locked boolean
) language sql stable security definer set search_path = public as $$
  select p.id, p.club, public.player_lock_at(md, p.id) + interval '30 minutes', public.player_locked(md, p.id)
  from public.players p
  where p.team_id = coalesce(p_team, p.team_id) and p.slot is not null
$$;
grant execute on function public.roster_locks(smallint, uuid) to authenticated;

-- 5) Le regole sui giocatori bloccati ------------------------------------------
-- quanti titolari di un reparto prevede un modulo ("4-4-2", 'D' -> 4)
create or replace function public.modulo_conta(p_modulo text, p_ruolo text) returns int
language sql immutable as $$
  select case when p_modulo !~ '^[0-9]-[0-9]-[0-9]$' then null
              when p_ruolo = 'P' then 1
              when p_ruolo = 'D' then split_part(p_modulo, '-', 1)::int
              when p_ruolo = 'C' then split_part(p_modulo, '-', 2)::int
              when p_ruolo = 'A' then split_part(p_modulo, '-', 3)::int end
$$;

-- Confronta la formazione salvata (p_old, con il suo modulo) con quella nuova (p_new),
-- entrambe come [{pos, player_id}]. Ritorna il motivo del rifiuto, o null se va bene.
drop function if exists public.controlla_blocchi(smallint, jsonb, jsonb);
create or replace function public.controlla_blocchi(p_matchday smallint, p_old jsonb, p_new jsonb,
                                                    p_old_module text default null, p_new_module text default null) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text; r record;
begin
  -- a) chi è bloccato resta dov'è: non entra, non esce, non cambia posto
  with o as (select (e ->> 'pos')::smallint pos, (e ->> 'player_id')::uuid pid from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) e),
       n as (select (e ->> 'pos')::smallint pos, (e ->> 'player_id')::uuid pid from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) e),
       cambi as (select o.pid a, n.pid b from o full join n on o.pos = n.pos where o.pid is distinct from n.pid),
       chi as (select distinct x pid from cambi cross join lateral (values (cambi.a), (cambi.b)) v(x) where x is not null),
       b as (select p.name, row_number() over (order by p.name) k, count(*) over () tot
             from chi join public.players p on p.id = chi.pid
             where public.player_locked(p_matchday, chi.pid))
  select string_agg(name, ', ' order by name) filter (where k <= 3)
         || case when max(tot) > 3 then ' e altri ' || (max(tot) - 3) else '' end
    into v from b;
  if v is not null then
    return 'Partita già iniziata (o al via fra meno di 30 minuti) per: ' || v;
  end if;

  -- b) un panchinaro bloccato tiene fermi i giocatori del suo reparto messi prima di lui;
  --    e i titolari di quel reparto restano tanti quanti erano, nel modulo e in campo
  with o as (select (e ->> 'pos')::smallint pos, p.id pid, p.role
             from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) e join public.players p on p.id = (e ->> 'player_id')::uuid),
       n as (select (e ->> 'pos')::smallint pos, p.id pid, p.role
             from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) e join public.players p on p.id = (e ->> 'player_id')::uuid),
       l as (select o.* from o where o.pos >= 12 and public.player_locked(p_matchday, o.pid))
  select l.pos, l.role, pl.name,
         coalesce(public.modulo_conta(p_old_module, l.role), (select count(*) from o where o.role = l.role and o.pos <= 11)) titolari
    into r
  from l join public.players pl on pl.id = l.pid
  where array(select o.pid from o where o.role = l.role and o.pos < l.pos order by o.pid)
          is distinct from array(select n.pid from n where n.role = l.role and n.pos < l.pos order by n.pid)
     or (select count(*) from o where o.role = l.role and o.pos <= 11)
          <> (select count(*) from n where n.role = l.role and n.pos <= 11)
     or (public.modulo_conta(p_old_module, l.role) is not null
         and public.modulo_conta(p_old_module, l.role) is distinct from public.modulo_conta(p_new_module, l.role))
  order by l.pos limit 1;
  if found then
    return format('%s (posto %s) è già bloccato: %s schierati prima di lui, titolari compresi, restano gli stessi (puoi solo scambiarli fra loro) e i titolari %s restano %s.',
      r.name, r.pos,
      case r.role when 'P' then 'i portieri' when 'D' then 'i difensori' when 'C' then 'i centrocampisti' else 'gli attaccanti' end,
      case r.role when 'P' then 'in porta' when 'D' then 'in difesa' when 'C' then 'a centrocampo' else 'in attacco' end,
      r.titolari);
  end if;
  return null;
end $$;
revoke all on function public.controlla_blocchi(smallint, jsonb, jsonb, text, text) from public;
grant execute on function public.controlla_blocchi(smallint, jsonb, jsonb, text, text) to authenticated;

-- 6) Scrittura della formazione (comune a squadra e amministratore) ---------------
-- Non si chiama da fuori: la usano save_lineup() e admin_save_lineup(), che fanno i
-- controlli. Scrive formazione e log nella stessa transazione.
create or replace function public.scrivi_formazione(
  p_team uuid, p_matchday smallint, p_module text, p_bench_free boolean, p_slots jsonb,
  p_old jsonb, p_old_module text, p_da_admin boolean, p_nota text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_lineup uuid; v_new jsonb; v_action text; v_changes jsonb; v_autore text;
begin
  insert into public.lineups (team_id, matchday, module, bench_free, updated_by)
  values (p_team, p_matchday, p_module, coalesce(p_bench_free, false), auth.uid())
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

  v_action := case when p_old is null then 'creata' else 'modificata' end;

  with o as (select (e ->> 'pos')::int pos, e ->> 'nome' nome from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) e),
       n as (select (e ->> 'pos')::int pos, e ->> 'nome' nome from jsonb_array_elements(v_new) e)
  select jsonb_build_object(
    'entrati',  coalesce((select jsonb_agg(jsonb_build_object('pos', n.pos, 'nome', n.nome) order by n.pos)
                          from n left join o on o.nome = n.nome where o.nome is null), '[]'::jsonb),
    'usciti',   coalesce((select jsonb_agg(jsonb_build_object('pos', o.pos, 'nome', o.nome) order by o.pos)
                          from o left join n on n.nome = o.nome where n.nome is null), '[]'::jsonb),
    'spostati', coalesce((select jsonb_agg(jsonb_build_object('nome', n.nome, 'da', o.pos, 'a', n.pos) order by n.pos)
                          from n join o on o.nome = n.nome where o.pos is distinct from n.pos), '[]'::jsonb),
    'modulo',   case when coalesce(p_old_module, '') is distinct from coalesce(p_module, '')
                     then jsonb_build_object('da', p_old_module, 'a', p_module) end
  ) into v_changes;

  if p_da_admin then
    select coalesce(display_name, 'amministratore') into v_autore from public.profiles where id = auth.uid();
  end if;

  insert into public.lineup_log (team_id, matchday, user_id, action, changes, snapshot, da_admin, nota, autore)
  values (p_team, p_matchday, auth.uid(), v_action, v_changes, v_new,
          coalesce(p_da_admin, false), nullif(btrim(coalesce(p_nota, '')), ''), v_autore);

  return jsonb_build_object('lineup_id', v_lineup, 'action', v_action, 'changes', v_changes, 'snapshot', v_new,
                            'da_admin', coalesce(p_da_admin, false));
end $$;
-- su Supabase le funzioni nuove sono chiamabili da anon e authenticated: qui no
revoke all on function public.scrivi_formazione(uuid, smallint, text, boolean, jsonb, jsonb, text, boolean, text) from public, anon, authenticated;

-- la formazione salvata di una squadra, come [{pos, player_id, nome, ruolo}]
create or replace function public.formazione_salvata(p_team uuid, p_matchday smallint, out slots jsonb, out modulo text)
language sql stable security definer set search_path = public as $$
  select (select jsonb_agg(jsonb_build_object('pos', s.pos, 'player_id', s.player_id, 'nome', p.name, 'ruolo', p.role) order by s.pos)
          from public.lineup_slots s join public.players p on p.id = s.player_id where s.lineup_id = l.id),
         l.module
  from public.lineups l where l.team_id = p_team and l.matchday = p_matchday
$$;
revoke all on function public.formazione_salvata(uuid, smallint) from public, anon, authenticated;

-- stessa cosa per la funzione del mercato che toglie un giocatore dalle formazioni:
-- la chiamano solo le funzioni dell'amministratore, mai l'app
revoke all on function public.togli_dalle_formazioni(uuid, text) from public, anon, authenticated;

-- 7) Il salvataggio della squadra: scadenza, blocchi, reparto ---------------------
create or replace function public.save_lineup(
  p_matchday   smallint,
  p_module     text,
  p_bench_free boolean,
  p_slots      jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team uuid := public.my_team();
  v_old  record;
  v_scad timestamptz;
  v_no   text;
begin
  if v_team is null then
    raise exception 'Questo account non è collegato a nessuna squadra' using errcode = 'P0001';
  end if;
  if not public.matchday_open(p_matchday) then
    raise exception 'La giornata è finita: la formazione non si può più cambiare' using errcode = 'P0002';
  end if;
  select scadenza into v_scad from public.matchdays where id = p_matchday;
  if v_scad is not null and v_scad <= now() then
    raise exception 'Scadenza passata (%): la formazione non si può più cambiare. Per una modifica scrivi all''amministratore.',
      to_char(v_scad at time zone 'Europe/Rome', 'DD/MM HH24:MI') using errcode = 'P0008';
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

  select * into v_old from public.formazione_salvata(v_team, p_matchday);
  v_no := public.controlla_blocchi(p_matchday, v_old.slots, p_slots, v_old.modulo, p_module);
  if v_no is not null then
    raise exception '%', v_no using errcode = 'P0007';
  end if;

  return public.scrivi_formazione(v_team, p_matchday, p_module, p_bench_free, p_slots,
                                  v_old.slots, v_old.modulo, false, null);
end $$;
revoke all on function public.save_lineup(smallint, text, boolean, jsonb) from public;
grant execute on function public.save_lineup(smallint, text, boolean, jsonb) to authenticated;

-- 8) L'amministratore modifica la formazione di una squadra ----------------------
-- Senza blocchi né scadenze. La modifica va nel log con da_admin = true, il nome di
-- chi l'ha fatta e la nota: il sito la mostra a tutti sulla pagina della formazione.
create or replace function public.admin_save_lineup(
  p_team       uuid,
  p_matchday   smallint,
  p_module     text,
  p_bench_free boolean,
  p_slots      jsonb,
  p_nota       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_old record;
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore può modificare la formazione di un''altra squadra' using errcode = 'P0005';
  end if;
  if not exists (select 1 from public.teams where id = p_team) then
    raise exception 'Squadra non trovata' using errcode = 'P0006';
  end if;
  if not exists (select 1 from public.matchdays where id = p_matchday) then
    raise exception 'Giornata % non trovata', p_matchday using errcode = 'P0006';
  end if;
  if jsonb_typeof(p_slots) is distinct from 'array' then
    raise exception 'Formazione non valida' using errcode = 'P0003';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_slots) e
    left join public.players p on p.id = (e ->> 'player_id')::uuid
    where p.id is null or p.team_id <> p_team
  ) then
    raise exception 'Nella formazione ci sono giocatori che non sono di questa squadra' using errcode = 'P0004';
  end if;

  select * into v_old from public.formazione_salvata(p_team, p_matchday);
  return public.scrivi_formazione(p_team, p_matchday, p_module, p_bench_free, p_slots,
                                  v_old.slots, v_old.modulo, true, p_nota);
end $$;
revoke all on function public.admin_save_lineup(uuid, smallint, text, boolean, jsonb, text) from public;
grant execute on function public.admin_save_lineup(uuid, smallint, text, boolean, jsonb, text) to authenticated;

-- 9) La scadenza scelta dall'amministratore (null = torna quella del calendario) ---
create or replace function public.set_scadenza(p_matchday smallint, p_scadenza timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore può cambiare la scadenza' using errcode = 'P0005';
  end if;
  update public.matchdays set scadenza_admin = p_scadenza where id = p_matchday
  returning scadenza, scadenza_auto, scadenza_admin into r;
  if not found then
    raise exception 'Giornata % non trovata', p_matchday using errcode = 'P0006';
  end if;
  return jsonb_build_object('giornata', p_matchday, 'scadenza', r.scadenza, 'automatica', r.scadenza_auto,
                            'scelta', r.scadenza_admin);
end $$;
revoke all on function public.set_scadenza(smallint, timestamptz) from public;
grant execute on function public.set_scadenza(smallint, timestamptz) to authenticated;

-- 10) Giornata impostata a mano (senza calendario): la scadenza è quella indicata --
create or replace function public.set_current_matchday(p_id smallint, p_label text, p_deadline timestamptz)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore può cambiare la giornata' using errcode = 'P0005';
  end if;
  insert into public.matchdays (id, label, deadline, closes_at, scadenza_auto, is_current)
  values (p_id, coalesce(nullif(p_label, ''), 'Giornata ' || p_id), p_deadline, p_deadline, p_deadline, false)
  on conflict (id) do update set label = excluded.label, deadline = excluded.deadline,
                                 closes_at = excluded.closes_at, scadenza_auto = excluded.scadenza_auto;
  update public.matchdays set is_current = false where is_current and id <> p_id;
  update public.matchdays set is_current = true  where id = p_id and not is_current;
  return jsonb_build_object('id', p_id, 'chiude', p_deadline);
end $$;
grant execute on function public.set_current_matchday(smallint, text, timestamptz) to authenticated;

-- le giornate già nel database prendono subito chiusura e scadenza nuove
select public.refresh_matchdays();

notify pgrst, 'reload schema';

-- Controlli utili ------------------------------------------------------------------
-- select id, first_kickoff, closes_at, scadenza_auto, scadenza_admin, scadenza, is_current from public.matchdays order by id;
-- select p.name, p.club, public.player_lock_at(m.id, p.id) from public.players p, public.matchdays m
--   where m.is_current and p.slot is not null order by 3 limit 20;
-- select at, team_id, autore, nota, changes from public.lineup_log where da_admin order by at desc;
