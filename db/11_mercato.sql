-- Mercato: gli svincolati (dal foglio LISTONE del file di giornata) e le operazioni
-- dell'amministratore (uno svincolato prende il posto di un giocatore in rosa).
--
-- Regole decise da Valerio (08/10/2026):
--   - i costi li scrive l'amministratore a ogni operazione (svincolo e acquisto);
--   - chi entra ha lo stesso ruolo di chi esce;
--   - il sito aggiorna il modello delle formazioni e dà l'elenco delle operazioni da
--     riportare nel file di giornata; al file successivo controlla che rose e LISTONE
--     coincidano.
--
-- Da eseguire nel SQL Editor dopo 10_fantacalcio.sql. Si può rieseguire.

-- 1) Chi esce dalla rosa non si cancella ------------------------------------
-- Resta nel database senza posto (slot vuoto): le formazioni passate continuano a
-- mostrarlo. Prima veniva cancellato, e con lui i posti nelle formazioni salvate.
alter table public.players alter column slot drop not null;
alter table public.players add column if not exists fuori_rosa_at timestamptz;

-- nessuno può schierare chi non è più in rosa
create or replace function public.lineup_slot_in_rosa() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.players where id = new.player_id and slot is null) then
    raise exception 'Giocatore non più in rosa' using errcode = 'P0004';
  end if;
  return new;
end $$;
drop trigger if exists lineup_slots_in_rosa on public.lineup_slots;
create trigger lineup_slots_in_rosa before insert on public.lineup_slots
  for each row execute function public.lineup_slot_in_rosa();

-- nomi a confronto senza accenti, punti, apostrofi e spazi ("Laurientè" = "Laurientè")
create or replace function public.nome_norm(t text) returns text
language sql immutable as $$
  select lower(regexp_replace(translate(coalesce(t, ''),
    'àáâäãåèéêëìíîïòóôöõùúûüçñćčšžřýğışńłÀÁÂÄÃÅÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÇÑĆČŠŽŘÝĞİŞŃŁ',
    'aaaaaaeeeeiiiiooooouuuucnccszrygisnlAAAAAAEEEEIIIIOOOOOUUUUCNCCSZRYGISNL'), '[^a-zA-Z0-9]', '', 'g'))
$$;

-- toglie un giocatore dalle formazioni delle giornate non ancora iniziate
-- (le altre restano com'erano: sono storia)
create or replace function public.togli_dalle_formazioni(p_player uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with tolti as (
    delete from public.lineup_slots s
    using public.lineups l
    where s.lineup_id = l.id and s.player_id = p_player
      and not exists (select 1 from public.fixtures f where f.matchday = l.matchday and f.kickoff <= now())
      and exists (select 1 from public.matchdays md where md.id = l.matchday and md.deadline > now())
    returning l.team_id, l.matchday, s.pos
  )
  select coalesce(jsonb_agg(jsonb_build_object('team_id', team_id, 'matchday', matchday, 'pos', pos)), '[]'::jsonb)
    into v from tolti;
  return v;
end $$;
revoke all on function public.togli_dalle_formazioni(uuid) from public;

-- 2) Gli svincolati -----------------------------------------------------------
create table if not exists public.listone (
  id          serial primary key,
  ruolo       char(1) not null check (ruolo in ('P', 'D', 'C', 'A')),
  nome        text not null,
  club        text,                         -- squadra di Serie A
  origine     text not null default 'file', -- 'file' (LISTONE) o 'svincolo' (svincolato dal sito)
  aggiunto_at timestamptz not null default now()
);
create index if not exists listone_nome_idx on public.listone (public.nome_norm(nome));

-- 3) Le operazioni --------------------------------------------------------------
create table if not exists public.market_ops (
  id              bigserial primary key,
  at              timestamptz not null default now(),
  fatta_da        uuid references auth.users on delete set null,
  team_id         uuid not null references public.teams on delete cascade,
  slot            smallint not null,             -- il posto in rosa (riga del foglio)
  ruolo           char(1) not null,
  esce_id         uuid references public.players on delete set null,
  esce_nome       text not null,
  esce_club       text,
  esce_costo      numeric(6,1),                  -- costo e "secondo numero" di ROSE, per l'annullamento
  esce_valore     numeric(6,1),
  entra_id        uuid references public.players on delete set null,
  entra_nome      text not null,
  entra_club      text,
  costo_svincolo  integer not null default 0,    -- negativo = rimborso
  costo_acquisto  integer not null default 0,
  crediti_prima   integer,
  crediti_dopo    integer,
  note            text,
  formazioni      jsonb,                         -- formazioni da cui è stato tolto chi esce
  modello_at      timestamptz,                   -- modello .xls delle formazioni aggiornato
  riportata_at    timestamptz,                   -- il file di giornata l'ha recepita
  riportata_round smallint,
  annullata_at    timestamptz,
  annullata_da    uuid references auth.users on delete set null
);
create index if not exists market_ops_team_idx on public.market_ops (team_id);

alter table public.listone enable row level security;
alter table public.market_ops enable row level security;
drop policy if exists listone_read on public.listone;
create policy listone_read on public.listone for select to authenticated using (true);
drop policy if exists market_ops_read on public.market_ops;
create policy market_ops_read on public.market_ops for select to authenticated using (true);
grant select on public.listone, public.market_ops to authenticated;
-- si scrive solo con le funzioni qui sotto

-- 4) I crediti di adesso ----------------------------------------------------------
-- Quelli dell'ultimo file di giornata, meno le operazioni che il file non ha ancora
-- recepito: così un'operazione conta subito e non conta due volte quando la riporti.
create or replace function public.mercato_crediti()
returns table (team_id uuid, crediti integer, dal_file integer, round smallint, in_sospeso integer)
language sql stable security definer set search_path = public as $$
  with base as (select max(r.id) r from public.rounds r where r.caricata_at is not null)
  select t.id,
         ts.crediti - coalesce(o.spesa, 0),
         ts.crediti,
         base.r,
         coalesce(o.n, 0)::int
  from public.teams t
  cross join base
  left join public.team_season ts on ts.round = base.r and ts.team_id = t.id
  left join (select m.team_id, sum(m.costo_svincolo + m.costo_acquisto)::int spesa, count(*) n
             from public.market_ops m
             where m.annullata_at is null and m.riportata_at is null
             group by m.team_id) o on o.team_id = t.id
$$;
grant execute on function public.mercato_crediti() to authenticated;

-- 5) L'operazione: uno svincolato prende il posto di un giocatore in rosa ----------
create or replace function public.mercato_sostituisci(
  p_esce uuid, p_entra integer, p_costo_svincolo integer, p_costo_acquisto integer, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p     public.players;
  v_l     public.listone;
  v_rc    public.roster_costs;
  v_cred  integer;
  v_tot   integer := coalesce(p_costo_svincolo, 0) + coalesce(p_costo_acquisto, 0);
  v_new   uuid;
  v_form  jsonb;
  v_id    bigint;
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore può fare operazioni di mercato' using errcode = 'P0005';
  end if;
  perform pg_advisory_xact_lock(hashtext('mercato'));

  select * into v_p from public.players where id = p_esce for update;
  if v_p.id is null or v_p.slot is null then
    raise exception 'Il giocatore da svincolare non è più in rosa' using errcode = 'P0010';
  end if;
  select * into v_l from public.listone where id = p_entra for update;
  if v_l.id is null then
    raise exception 'Il giocatore da prendere non è più fra gli svincolati' using errcode = 'P0011';
  end if;
  if exists (select 1 from public.players p where p.slot is not null and p.role = v_l.ruolo
             and public.nome_norm(p.name) = public.nome_norm(v_l.nome)) then
    raise exception '% è già in una rosa', v_l.nome using errcode = 'P0011';
  end if;
  if v_l.ruolo <> v_p.role then
    raise exception 'Ruoli diversi: % è %, % è %', v_p.name, v_p.role, v_l.nome, v_l.ruolo using errcode = 'P0012';
  end if;
  if coalesce(p_costo_acquisto, 0) < 0 then
    raise exception 'Il costo dell''acquisto non può essere negativo' using errcode = 'P0013';
  end if;
  select c.crediti into v_cred from public.mercato_crediti() c where c.team_id = v_p.team_id;
  if v_cred is not null and v_cred - v_tot < 0 then
    raise exception 'Crediti insufficienti: ne ha %, l''operazione ne costa %', v_cred, v_tot using errcode = 'P0014';
  end if;
  select * into v_rc from public.roster_costs where team_id = v_p.team_id and slot = v_p.slot;

  -- chi esce: fuori rosa (resta nello storico) e fuori dalle formazioni non ancora giocate
  update public.players set slot = null, fuori_rosa_at = now() where id = v_p.id;
  v_form := public.togli_dalle_formazioni(v_p.id);
  -- chi entra: al suo posto, con la squadra di Serie A del LISTONE
  insert into public.players (team_id, slot, role, name, club)
  values (v_p.team_id, v_p.slot, v_p.role, v_l.nome, nullif(v_l.club, ''))
  returning id into v_new;
  -- svincolati: esce chi è entrato, entra chi è uscito
  delete from public.listone where id = v_l.id;
  insert into public.listone (ruolo, nome, club, origine) values (v_p.role, v_p.name, v_p.club, 'svincolo');
  -- costo in rosa (il "secondo numero" non si conosce: lo mette l'amministratore nell'Excel)
  insert into public.roster_costs (team_id, slot, nome, costo, valore)
  values (v_p.team_id, v_p.slot, v_l.nome, coalesce(p_costo_acquisto, 0), null)
  on conflict (team_id, slot) do update set nome = excluded.nome, costo = excluded.costo, valore = excluded.valore;

  insert into public.market_ops (fatta_da, team_id, slot, ruolo, esce_id, esce_nome, esce_club, esce_costo, esce_valore,
                                 entra_id, entra_nome, entra_club, costo_svincolo, costo_acquisto,
                                 crediti_prima, crediti_dopo, note, formazioni)
  values (auth.uid(), v_p.team_id, v_p.slot, v_p.role, v_p.id, v_p.name, v_p.club,
          case when public.nome_norm(v_rc.nome) = public.nome_norm(v_p.name) then v_rc.costo end,
          case when public.nome_norm(v_rc.nome) = public.nome_norm(v_p.name) then v_rc.valore end,
          v_new, v_l.nome, nullif(v_l.club, ''), coalesce(p_costo_svincolo, 0), coalesce(p_costo_acquisto, 0),
          v_cred, v_cred - v_tot, nullif(trim(coalesce(p_note, '')), ''), v_form)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'entra_id', v_new, 'crediti_prima', v_cred, 'crediti_dopo', v_cred - v_tot,
                            'formazioni', v_form);
end $$;
revoke all on function public.mercato_sostituisci(uuid, integer, integer, integer, text) from public;
grant execute on function public.mercato_sostituisci(uuid, integer, integer, integer, text) to authenticated;

-- 6) Annullare l'ultima operazione (se il file di giornata non l'ha già recepita) ----
create or replace function public.mercato_annulla(p_op bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_o public.market_ops;
  v_l integer;
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore può annullare le operazioni' using errcode = 'P0005';
  end if;
  perform pg_advisory_xact_lock(hashtext('mercato'));
  select * into v_o from public.market_ops where id = p_op for update;
  if v_o.id is null or v_o.annullata_at is not null then
    raise exception 'Operazione non trovata o già annullata' using errcode = 'P0015';
  end if;
  if exists (select 1 from public.market_ops where id > p_op and annullata_at is null) then
    raise exception 'Si può annullare solo l''ultima operazione' using errcode = 'P0015';
  end if;
  if v_o.riportata_at is not null then
    raise exception 'È già nel file di giornata: per tornare indietro fai l''operazione inversa' using errcode = 'P0015';
  end if;
  if not exists (select 1 from public.players where id = v_o.entra_id and team_id = v_o.team_id and slot = v_o.slot)
     or not exists (select 1 from public.players where id = v_o.esce_id and slot is null) then
    raise exception 'La rosa è cambiata dopo l''operazione: non posso annullarla' using errcode = 'P0015';
  end if;

  -- chi era entrato: se è già stato schierato resta nello storico, altrimenti sparisce
  perform public.togli_dalle_formazioni(v_o.entra_id);
  if exists (select 1 from public.lineup_slots where player_id = v_o.entra_id) then
    update public.players set slot = null, fuori_rosa_at = now() where id = v_o.entra_id;
  else
    delete from public.players where id = v_o.entra_id;
  end if;
  -- chi era uscito torna al suo posto
  update public.players set slot = v_o.slot, fuori_rosa_at = null where id = v_o.esce_id;
  -- svincolati come prima
  select id into v_l from public.listone
  where ruolo = v_o.ruolo and public.nome_norm(nome) = public.nome_norm(v_o.esce_nome) order by id desc limit 1;
  if v_l is not null then delete from public.listone where id = v_l; end if;
  insert into public.listone (ruolo, nome, club, origine) values (v_o.ruolo, v_o.entra_nome, v_o.entra_club, 'file');
  update public.roster_costs set nome = v_o.esce_nome, costo = v_o.esce_costo, valore = v_o.esce_valore
  where team_id = v_o.team_id and slot = v_o.slot;

  update public.market_ops set annullata_at = now(), annullata_da = auth.uid() where id = p_op;
  return jsonb_build_object('id', p_op, 'formazioni', v_o.formazioni);
end $$;
revoke all on function public.mercato_annulla(bigint) from public;
grant execute on function public.mercato_annulla(bigint) to authenticated;

-- il modello .xls delle formazioni è stato aggiornato (lo fa il sito dopo l'operazione)
create or replace function public.mercato_modello(p_op bigint, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore' using errcode = 'P0005';
  end if;
  update public.market_ops set modello_at = case when p_ok then now() end where id = p_op;
end $$;
revoke all on function public.mercato_modello(bigint, boolean) from public;
grant execute on function public.mercato_modello(bigint, boolean) to authenticated;

-- 7) Dopo il caricamento del file di giornata ---------------------------------------
-- Il LISTONE del file diventa la lista degli svincolati; le operazioni che il file
-- contiene (chi è entrato è nella rosa del file, al suo posto) risultano riportate;
-- chi è stato svincolato dal sito resta svincolato anche se il file non lo sa ancora.
-- Ritorna le differenze fra le rose del file e quelle del sito.
-- p_rose = [{ squadra, slot, nome }], p_listone = [{ ruolo, nome, squadra }]
create or replace function public.mercato_dal_file(p_round smallint, p_rose jsonb, p_listone jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_listone int := 0;
  v_riportate int := 0;
  v_diff jsonb;
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore' using errcode = 'P0005';
  end if;
  perform pg_advisory_xact_lock(hashtext('mercato'));

  if jsonb_array_length(coalesce(p_listone, '[]'::jsonb)) > 0 then
    delete from public.listone where true;
    insert into public.listone (ruolo, nome, club, origine)
    select upper(left(e ->> 'ruolo', 1)), trim(e ->> 'nome'), nullif(trim(coalesce(e ->> 'squadra', '')), ''), 'file'
    from jsonb_array_elements(p_listone) e
    where trim(coalesce(e ->> 'nome', '')) <> '' and upper(left(e ->> 'ruolo', 1)) in ('P', 'D', 'C', 'A');
    get diagnostics v_listone = row_count;
  end if;

  if jsonb_array_length(coalesce(p_rose, '[]'::jsonb)) > 0 then
    update public.market_ops m set riportata_at = now(), riportata_round = p_round
    where m.annullata_at is null and m.riportata_at is null
      and exists (select 1 from jsonb_array_elements(p_rose) e
                  where public.team_by_name(e ->> 'squadra') = m.team_id and (e ->> 'slot')::int = m.slot
                    and public.nome_norm(e ->> 'nome') = public.nome_norm(m.entra_nome));
    get diagnostics v_riportate = row_count;
  end if;

  -- chi è stato svincolato dal sito e il file non lo sa ancora: resta fra gli svincolati
  insert into public.listone (ruolo, nome, club, origine)
  select m.ruolo, m.esce_nome, m.esce_club, 'svincolo'
  from public.market_ops m
  where m.annullata_at is null and m.riportata_at is null
    and not exists (select 1 from public.listone l where l.ruolo = m.ruolo and public.nome_norm(l.nome) = public.nome_norm(m.esce_nome))
    and not exists (select 1 from public.players p where p.slot is not null and p.role = m.ruolo
                    and public.nome_norm(p.name) = public.nome_norm(m.esce_nome));

  -- rose del file e rose del sito, posto per posto
  if jsonb_array_length(coalesce(p_rose, '[]'::jsonb)) > 0 then
    with file as (
      select public.team_by_name(e ->> 'squadra') team_id, (e ->> 'slot')::smallint slot, e ->> 'nome' nome
      from jsonb_array_elements(p_rose) e
    ), sito as (
      select p.team_id, p.slot, p.name nome from public.players p
      where p.slot is not null and p.team_id in (select team_id from file where team_id is not null)
    ), d as (
      select coalesce(f.team_id, s.team_id) team_id, coalesce(f.slot, s.slot) slot, f.nome nel_file, s.nome sul_sito
      from (select * from file where team_id is not null) f
      full join sito s on s.team_id = f.team_id and s.slot = f.slot
      where public.nome_norm(f.nome) is distinct from public.nome_norm(s.nome)
    )
    select jsonb_agg(jsonb_build_object(
             'team_id', d.team_id, 'slot', d.slot, 'nel_file', d.nel_file, 'sul_sito', d.sul_sito,
             'operazione', (select m.id from public.market_ops m
                            where m.annullata_at is null and m.riportata_at is null
                              and m.team_id = d.team_id and m.slot = d.slot order by m.id desc limit 1))
           order by d.team_id, d.slot)
      into v_diff from d;
  end if;

  return jsonb_build_object(
    'listone', v_listone, 'riportate', v_riportate,
    'in_sospeso', (select count(*) from public.market_ops where annullata_at is null and riportata_at is null),
    'differenze', coalesce(v_diff, '[]'::jsonb));
end $$;
revoke all on function public.mercato_dal_file(smallint, jsonb, jsonb) from public;
grant execute on function public.mercato_dal_file(smallint, jsonb, jsonb) to authenticated;

-- 8) "Aggiorna le rose da un .xls" non cancella più nessuno -------------------------
-- Chi non è più nel file (o al suo posto c'è un altro) va fuori rosa e resta nello
-- storico; chi torna in rosa riprende il suo vecchio record.
create or replace function public.import_players(p_sheet text, p_players jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_team uuid; v_ins int := 0; v_upd int := 0; v_del int := 0;
  e jsonb; v_slot smallint; v_name text; v_role text; v_club text;
  v_cur public.players; v_old uuid; r record;
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore può aggiornare le rose' using errcode = 'P0005';
  end if;
  select id into v_team from public.teams where sheet_name = p_sheet or name = p_sheet;
  if v_team is null then
    raise exception 'Squadra "%" non trovata', p_sheet using errcode = 'P0006';
  end if;

  -- chi ha un posto che nel file non c'è più, o un altro nome al suo posto: fuori rosa
  for r in
    select p.id from public.players p
    where p.team_id = v_team and p.slot is not null
      and not exists (select 1 from jsonb_array_elements(p_players) x
                      where (x ->> 'slot')::smallint = p.slot and public.nome_norm(x ->> 'name') = public.nome_norm(p.name))
  loop
    update public.players set slot = null, fuori_rosa_at = now() where id = r.id;
    perform public.togli_dalle_formazioni(r.id);
    v_del := v_del + 1;
  end loop;

  for e in select * from jsonb_array_elements(p_players) loop
    v_slot := (e ->> 'slot')::smallint; v_name := e ->> 'name'; v_role := upper(e ->> 'role');
    v_club := nullif(e ->> 'club', '');
    select * into v_cur from public.players where team_id = v_team and slot = v_slot;
    if v_cur.id is not null then
      update public.players set role = v_role, club = coalesce(v_club, club) where id = v_cur.id;
      v_upd := v_upd + 1;
    else
      -- torna in rosa chi c'era già stato, altrimenti è un giocatore nuovo
      select id into v_old from public.players
      where team_id = v_team and slot is null and public.nome_norm(name) = public.nome_norm(v_name)
      order by fuori_rosa_at desc nulls last limit 1;
      if v_old is not null then
        update public.players set slot = v_slot, role = v_role, club = coalesce(v_club, club), fuori_rosa_at = null where id = v_old;
      else
        insert into public.players (team_id, slot, role, name, club) values (v_team, v_slot, v_role, v_name, v_club);
      end if;
      v_ins := v_ins + 1;
    end if;
  end loop;

  return jsonb_build_object('squadra', p_sheet, 'nuovi', v_ins, 'aggiornati', v_upd, 'rimossi', v_del);
end $$;
revoke all on function public.import_players(text, jsonb) from public;
grant execute on function public.import_players(text, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- Controlli utili
-- select * from public.mercato_crediti();
-- select count(*), origine from public.listone group by origine;
-- select at, entra_nome, esce_nome, costo_svincolo, costo_acquisto, riportata_at, annullata_at from public.market_ops order by id desc;
