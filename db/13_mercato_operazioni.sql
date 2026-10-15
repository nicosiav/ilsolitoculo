-- Mercato, seconda versione: operazioni composte e limiti delle rose.
--
-- Regole decise da Valerio (15/10/2026):
--   - un'operazione può mettere insieme svincoli (con il loro costo, negativo se è un
--     rimborso), acquisti dagli svincolati (in qualsiasi ruolo, con il loro costo),
--     cessioni fra squadre (anche senza contropartita: uno scambio sono due cessioni) e
--     passaggi di crediti fra squadre;
--   - chi cambia squadra porta con sé il costo in rosa che aveva, ma l'amministratore lo
--     può cambiare;
--   - alla fine dell'operazione ogni squadra toccata deve rispettare i limiti della rosa:
--     da 22 a 29 giocatori, portieri 3–4, difensori 7–10, centrocampisti 7–10,
--     attaccanti 5–7 (tabella rosa_limiti), e nessuna squadra può finire sotto zero
--     crediti. Una sola conferma, un solo annullamento.
--   - nel foglio ROSE ogni ruolo ha le sue righe (portieri 1–4, difensori 5–14,
--     centrocampisti 15–24, attaccanti 25–31): chi entra prende la prima libera del suo
--     ruolo.
--   - anni di contratto: il "secondo numero" di ROSE è la penale di svincolo, il costo
--     diviso 3, 4 o 5 (arrotondato) se il giocatore è al 1°, 2° o 3° anno di contratto con
--     la squadra. Lo svincolo propone la penale come costo; chi viene acquistato dagli
--     svincolati parte dal 1° anno; chi passa a un'altra squadra con una cessione (o uno
--     scambio) tiene i suoi anni di contratto.
--
-- Le operazioni di prima (uno svincolato al posto di un giocatore dello stesso ruolo)
-- diventano operazioni con due movimenti, svincolo e acquisto: tutto il resto (crediti,
-- annullamento, controllo del file di giornata) lavora sui movimenti.
--
-- Da eseguire nel SQL Editor dopo 12_scadenze.sql. Si può rieseguire.

-- 1) I limiti delle rose e le righe di ogni ruolo nel foglio ROSE ----------------
create table if not exists public.rosa_limiti (
  ruolo   char(1) primary key check (ruolo in ('T', 'P', 'D', 'C', 'A')),   -- T = tutta la rosa
  minimo  smallint not null,
  massimo smallint not null,
  riga_da smallint,          -- righe del ruolo nel foglio ROSE (= posti in rosa)
  riga_a  smallint
);
insert into public.rosa_limiti (ruolo, minimo, massimo, riga_da, riga_a) values
  ('T', 22, 29, 1, 31), ('P', 3, 4, 1, 4), ('D', 7, 10, 5, 14), ('C', 7, 10, 15, 24), ('A', 5, 7, 25, 31)
on conflict (ruolo) do nothing;
alter table public.rosa_limiti enable row level security;
drop policy if exists rosa_limiti_read on public.rosa_limiti;
create policy rosa_limiti_read on public.rosa_limiti for select to authenticated using (true);
grant select on public.rosa_limiti to authenticated;

-- 2) Le operazioni: la testata resta market_ops, i movimenti in market_moves -------
alter table public.market_ops alter column team_id    drop not null;
alter table public.market_ops alter column slot       drop not null;
alter table public.market_ops alter column ruolo      drop not null;
alter table public.market_ops alter column esce_nome  drop not null;
alter table public.market_ops alter column entra_nome drop not null;
alter table public.market_ops add column if not exists tipo    text not null default 'sostituzione';  -- sostituzione (prima) | composta
alter table public.market_ops add column if not exists crediti jsonb;      -- [{team_id, prima, dopo}] delle squadre toccate

create table if not exists public.market_moves (
  id           bigserial primary key,
  op_id        bigint not null references public.market_ops on delete cascade,
  n            smallint not null,                      -- ordine nell'operazione
  tipo         text not null check (tipo in ('svincolo', 'acquisto', 'cessione', 'crediti')),
  ruolo        char(1),
  nome         text,
  club         text,
  team_da      uuid references public.teams on delete cascade,   -- chi lascia il giocatore / dà i crediti
  team_a       uuid references public.teams on delete cascade,   -- chi lo prende / riceve i crediti
  slot_da      smallint,                               -- riga di ROSE che si libera
  slot_a       smallint,                               -- riga di ROSE che si occupa
  da_id        uuid references public.players on delete set null,   -- il giocatore che esce dalla rosa
  a_id         uuid references public.players on delete set null,   -- il record nuovo nella rosa di arrivo
  costo        numeric(6,1) not null default 0,        -- svincolo: costo (negativo = rimborso) · acquisto: costo, che
                                                       -- diventa il costo in rosa · cessione: costo in rosa nella
                                                       -- squadra nuova (non costa crediti) · crediti: quanti
  valore       numeric(6,1),                           -- cessione e acquisto: la penale (il "secondo numero") nella squadra nuova
  costo_prima  numeric(6,1),                           -- costo e secondo numero in ROSE di chi esce (per annullare)
  valore_prima numeric(6,1),
  formazioni   jsonb,                                  -- formazioni da cui è stato tolto chi esce
  unique (op_id, n)
);
create index if not exists market_moves_op_idx on public.market_moves (op_id);
-- l'anno di contratto (1°, 2°, 3°) del giocatore con la squadra: nelle rose viene dal file
-- di giornata (il divisore della formula del secondo numero), nei movimenti è quello di chi
-- esce (che chi viene ceduto si porta dietro) o il 1° di chi viene acquistato
alter table public.roster_costs add column if not exists anno smallint check (anno between 1 and 9);
alter table public.market_moves add column if not exists anno smallint;
comment on column public.roster_costs.valore is 'secondo numero di ROSE: la penale di svincolo (costo / (anno + 2), arrotondato)';
comment on column public.roster_costs.anno is 'anno di contratto del giocatore con la squadra (1°, 2°, 3°)';

-- la penale di svincolo: 1/3 del costo al 1° anno, 1/4 al 2°, 1/5 al 3°, all'intero più vicino
create or replace function public.penale_svincolo(p_costo numeric, p_anno integer) returns numeric
language sql immutable as $$
  select case when p_costo is not null and p_anno between 1 and 3 then round(p_costo / (p_anno + 2)) end
$$;
revoke all on function public.penale_svincolo(numeric, integer) from public, anon;
grant execute on function public.penale_svincolo(numeric, integer) to authenticated;
alter table public.market_moves enable row level security;
drop policy if exists market_moves_read on public.market_moves;
create policy market_moves_read on public.market_moves for select to authenticated using (true);
grant select on public.market_moves to authenticated;

-- le operazioni di prima diventano svincolo + acquisto (una volta sola)
insert into public.market_moves (op_id, n, tipo, ruolo, nome, club, team_da, slot_da, da_id, costo, costo_prima, valore_prima, formazioni)
select m.id, 1, 'svincolo', m.ruolo, m.esce_nome, m.esce_club, m.team_id, m.slot, m.esce_id, m.costo_svincolo,
       m.esce_costo, m.esce_valore, m.formazioni
from public.market_ops m
where m.tipo = 'sostituzione' and m.esce_nome is not null
  and not exists (select 1 from public.market_moves v where v.op_id = m.id);
insert into public.market_moves (op_id, n, tipo, ruolo, nome, club, team_a, slot_a, a_id, costo)
select m.id, 2, 'acquisto', m.ruolo, m.entra_nome, m.entra_club, m.team_id, m.slot, m.entra_id, m.costo_acquisto
from public.market_ops m
where m.tipo = 'sostituzione' and m.entra_nome is not null
  and not exists (select 1 from public.market_moves v where v.op_id = m.id and v.n = 2);
update public.market_ops m
set crediti = jsonb_build_array(jsonb_build_object('team_id', m.team_id, 'prima', m.crediti_prima, 'dopo', m.crediti_dopo))
where m.tipo = 'sostituzione' and m.crediti is null and m.team_id is not null;

-- 3) I crediti di adesso -------------------------------------------------------------
-- Quelli dell'ultimo file di giornata meno i movimenti delle operazioni che il file non
-- ha ancora recepito: svincoli e acquisti costano a chi li fa, i crediti passano da una
-- squadra all'altra, le cessioni non costano niente.
create or replace function public.mercato_spesa() returns table (team_id uuid, spesa integer, n integer)
language sql stable security definer set search_path = public as $$
  select t, round(sum(s))::int, count(distinct op)::int from (
    select v.team_da t, v.costo s, v.op_id op from public.market_moves v
    where v.tipo in ('svincolo', 'crediti') and v.team_da is not null
    union all
    select v.team_a, v.costo, v.op_id from public.market_moves v where v.tipo = 'acquisto'
    union all
    select v.team_a, -v.costo, v.op_id from public.market_moves v where v.tipo = 'crediti'
  ) x
  join public.market_ops m on m.id = x.op
  where m.annullata_at is null and m.riportata_at is null
  group by t
$$;
revoke all on function public.mercato_spesa() from public, anon, authenticated;

create or replace function public.mercato_crediti()
returns table (team_id uuid, crediti integer, dal_file integer, round smallint, in_sospeso integer)
language sql stable security definer set search_path = public as $$
  with base as (select max(r.id) r from public.rounds r where r.caricata_at is not null)
  select t.id, ts.crediti - coalesce(s.spesa, 0), ts.crediti, base.r, coalesce(s.n, 0)
  from public.teams t
  cross join base
  left join public.team_season ts on ts.round = base.r and ts.team_id = t.id
  left join public.mercato_spesa() s on s.team_id = t.id
$$;
grant execute on function public.mercato_crediti() to authenticated;

-- 4) La rosa rispetta i limiti? (null se sì, altrimenti il motivo) -------------------
-- p_delta = [{team_id, ruolo, d}]: chi entra (+1) e chi esce (-1) rispetto alla rosa di adesso
create or replace function public.rosa_fuori_limiti(p_delta jsonb) returns text
language sql stable security definer set search_path = public as $$
  with d as (
    select (e ->> 'team_id')::uuid team_id, e ->> 'ruolo' ruolo, (e ->> 'd')::int d
    from jsonb_array_elements(coalesce(p_delta, '[]'::jsonb)) e
  ), sq as (select distinct team_id from d), r(ruolo) as (values ('P'), ('D'), ('C'), ('A')),
  fin as (
    select sq.team_id, r.ruolo,
           (select count(*) from public.players p where p.team_id = sq.team_id and p.slot is not null and p.role = r.ruolo)
           + coalesce((select sum(d.d) from d where d.team_id = sq.team_id and d.ruolo = r.ruolo), 0) n
    from sq cross join r
  ), fuori as (
    select f.team_id, 1 ord, f.ruolo, f.n, l.minimo, l.massimo
    from fin f join public.rosa_limiti l on l.ruolo = f.ruolo
    where f.n < l.minimo or f.n > l.massimo
    union all
    select f.team_id, 0, 'T', sum(f.n), l.minimo, l.massimo
    from fin f cross join public.rosa_limiti l where l.ruolo = 'T'
    group by f.team_id, l.minimo, l.massimo having sum(f.n) < l.minimo or sum(f.n) > l.massimo
  )
  -- "Valerio: giocatori 30 (massimo 29), attaccanti 8 (massimo 7); Sebi: …"
  select string_agg(y.testo, '; ' order by y.name) from (
    select t.name, t.name || ': ' || string_agg(
             case x.ruolo when 'T' then 'giocatori' when 'P' then 'portieri' when 'D' then 'difensori'
                          when 'C' then 'centrocampisti' else 'attaccanti' end || ' ' || x.n ||
             case when x.n < x.minimo then ' (minimo ' || x.minimo || ')' else ' (massimo ' || x.massimo || ')' end,
             ', ' order by x.ord, position(x.ruolo in 'PDCA')) testo
    from fuori x join public.teams t on t.id = x.team_id
    group by t.name
  ) y
$$;
grant execute on function public.rosa_fuori_limiti(jsonb) to authenticated;

-- 5) L'operazione composta ---------------------------------------------------------------
-- p = { "svincoli": [{player_id, costo}],
--       "acquisti": [{listone_id, team_id, costo}],
--       "cessioni": [{player_id, team_id, costo?}]     -- costo assente = resta il suo
--       "crediti":  [{da, a, crediti}],
--       "note": "…" }
create or replace function public.mercato_operazione(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e jsonb; m record; v_p public.players; v_l public.listone; v_rc public.roster_costs;
  v_op bigint; v_n int := 0; v_slot smallint; v_new uuid; v_form jsonb; v_tutte jsonb := '[]'::jsonb; v_costo numeric;
  v_no text; v_delta jsonb; v_cred jsonb; v_neg text; v_mov int;
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore può fare operazioni di mercato' using errcode = 'P0005';
  end if;
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Operazione non valida' using errcode = 'P0003';
  end if;
  perform pg_advisory_xact_lock(hashtext('mercato'));

  create temp table if not exists _mov (
    n int, tipo text, pid uuid, lid int, team_da uuid, team_a uuid, ruolo char(1), nome text, club text,
    slot_da smallint, costo numeric, valore numeric, costo_prima numeric, valore_prima numeric, anno smallint
  ) on commit drop;
  truncate _mov;

  -- a) i movimenti, controllati uno per uno ------------------------------------------
  for e in select * from jsonb_array_elements(coalesce(p -> 'svincoli', '[]'::jsonb)) loop
    select * into v_p from public.players where id = (e ->> 'player_id')::uuid for update;
    if v_p.id is null or v_p.slot is null then
      raise exception 'Un giocatore da svincolare non è più in rosa' using errcode = 'P0010';
    end if;
    select * into v_rc from public.roster_costs where team_id = v_p.team_id and slot = v_p.slot
      and public.nome_norm(nome) = public.nome_norm(v_p.name);
    v_n := v_n + 1;
    -- senza un costo scritto, lo svincolo costa la penale (il secondo numero di ROSE)
    insert into _mov values (v_n, 'svincolo', v_p.id, null, v_p.team_id, null, v_p.role, v_p.name, v_p.club,
                             v_p.slot, round(coalesce((e ->> 'costo')::numeric, v_rc.valore, 0)), null, v_rc.costo, v_rc.valore,
                             v_rc.anno);
  end loop;
  for e in select * from jsonb_array_elements(coalesce(p -> 'cessioni', '[]'::jsonb)) loop
    select * into v_p from public.players where id = (e ->> 'player_id')::uuid for update;
    if v_p.id is null or v_p.slot is null then
      raise exception 'Un giocatore da cedere non è più in rosa' using errcode = 'P0010';
    end if;
    if not exists (select 1 from public.teams where id = (e ->> 'team_id')::uuid) then
      raise exception 'Cessione di %: squadra di arrivo non trovata', v_p.name using errcode = 'P0016';
    end if;
    if (e ->> 'team_id')::uuid = v_p.team_id then
      raise exception '% è già di quella squadra', v_p.name using errcode = 'P0016';
    end if;
    select * into v_rc from public.roster_costs where team_id = v_p.team_id and slot = v_p.slot
      and public.nome_norm(nome) = public.nome_norm(v_p.name);
    v_n := v_n + 1;
    -- il costo in rosa resta il suo (se non è scritto) e così gli anni di contratto: la
    -- penale nella squadra nuova si ricalcola dal costo con lo stesso anno
    v_costo := coalesce((e ->> 'costo')::numeric, v_rc.costo, 0);
    insert into _mov values (v_n, 'cessione', v_p.id, null, v_p.team_id, (e ->> 'team_id')::uuid, v_p.role, v_p.name,
                             v_p.club, v_p.slot, v_costo,
                             coalesce(public.penale_svincolo(v_costo, v_rc.anno), case when v_costo = v_rc.costo then v_rc.valore end),
                             v_rc.costo, v_rc.valore, v_rc.anno);
  end loop;
  for e in select * from jsonb_array_elements(coalesce(p -> 'acquisti', '[]'::jsonb)) loop
    select * into v_l from public.listone where id = (e ->> 'listone_id')::int for update;
    if v_l.id is null then
      raise exception 'Un giocatore da prendere non è più fra gli svincolati' using errcode = 'P0011';
    end if;
    if exists (select 1 from public.players p where p.slot is not null and p.role = v_l.ruolo
               and public.nome_norm(p.name) = public.nome_norm(v_l.nome)) then
      raise exception '% è già in una rosa', v_l.nome using errcode = 'P0011';
    end if;
    if not exists (select 1 from public.teams where id = (e ->> 'team_id')::uuid) then
      raise exception 'Acquisto di %: squadra non trovata', v_l.nome using errcode = 'P0016';
    end if;
    if coalesce((e ->> 'costo')::numeric, 0) < 0 then
      raise exception 'Il costo dell''acquisto di % non può essere negativo', v_l.nome using errcode = 'P0013';
    end if;
    v_n := v_n + 1;
    -- dagli svincolati si parte dal 1° anno di contratto
    v_costo := round(coalesce((e ->> 'costo')::numeric, 0));
    insert into _mov values (v_n, 'acquisto', null, v_l.id, null, (e ->> 'team_id')::uuid, v_l.ruolo, v_l.nome,
                             nullif(v_l.club, ''), null, v_costo, public.penale_svincolo(v_costo, 1), null, null, 1);
  end loop;
  for e in select * from jsonb_array_elements(coalesce(p -> 'crediti', '[]'::jsonb)) loop
    if (e ->> 'da')::uuid is null or (e ->> 'a')::uuid is null or (e ->> 'da')::uuid = (e ->> 'a')::uuid
       or coalesce((e ->> 'crediti')::numeric, 0) <= 0 then
      raise exception 'Passaggio di crediti non valido: servono due squadre diverse e almeno un credito' using errcode = 'P0016';
    end if;
    v_n := v_n + 1;
    insert into _mov (n, tipo, team_da, team_a, costo)
    values (v_n, 'crediti', (e ->> 'da')::uuid, (e ->> 'a')::uuid, round((e ->> 'crediti')::numeric));
  end loop;

  if v_n = 0 then
    raise exception 'L''operazione è vuota' using errcode = 'P0016';
  end if;
  select string_agg(nome, ', ') into v_no from (
    select nome from _mov where pid is not null group by pid, nome having count(*) > 1
    union all
    select nome from _mov where lid is not null group by lid, nome having count(*) > 1) x;
  if v_no is not null then
    raise exception 'Nella stessa operazione due volte: %', v_no using errcode = 'P0016';
  end if;

  -- b) i limiti delle rose, alla fine dell'operazione -----------------------------------
  select jsonb_agg(x) into v_delta from (
    select jsonb_build_object('team_id', team_da, 'ruolo', ruolo, 'd', -1) x from _mov where tipo in ('svincolo', 'cessione')
    union all
    select jsonb_build_object('team_id', team_a, 'ruolo', ruolo, 'd', 1) from _mov where tipo in ('acquisto', 'cessione')
  ) y;
  v_no := public.rosa_fuori_limiti(v_delta);
  if v_no is not null then
    raise exception 'Limiti della rosa: %', v_no using errcode = 'P0017';
  end if;

  -- c) i crediti: nessuno sotto zero ----------------------------------------------------
  with spesa as (
    select t, sum(s) s from (
      select team_da t, costo s from _mov where tipo in ('svincolo', 'crediti')
      union all select team_a, costo from _mov where tipo = 'acquisto'
      union all select team_a, -costo from _mov where tipo = 'crediti'
      union all select team_da, 0 from _mov where tipo = 'cessione'
      union all select team_a, 0 from _mov where tipo = 'cessione') x
    group by t
  )
  select jsonb_agg(jsonb_build_object('team_id', s.t, 'prima', c.crediti, 'dopo', c.crediti - round(s.s)::int) order by tm.name),
         string_agg(case when c.crediti is not null and c.crediti - s.s < 0
                         then tm.name || ' ne ha ' || c.crediti || ', l''operazione gliene toglie ' || round(s.s)::int end, '; ')
    into v_cred, v_neg
  from spesa s
  join public.teams tm on tm.id = s.t
  left join public.mercato_crediti() c on c.team_id = s.t;
  if v_neg is not null then
    raise exception 'Crediti insufficienti: %', v_neg using errcode = 'P0014';
  end if;

  -- d) l'operazione ------------------------------------------------------------------------
  insert into public.market_ops (fatta_da, tipo, note, crediti)
  values (auth.uid(), 'composta', nullif(btrim(coalesce(p ->> 'note', '')), ''), v_cred)
  returning id into v_op;

  -- chi esce: fuori rosa (resta nello storico), fuori dalle formazioni non ancora giocate
  for m in select * from _mov where tipo in ('svincolo', 'cessione') order by n loop
    update public.players set slot = null, fuori_rosa_at = now() where id = m.pid;
    delete from public.roster_costs where team_id = m.team_da and slot = m.slot_da;
    v_form := public.togli_dalle_formazioni(m.pid, case m.tipo when 'svincolo' then 'svincolato' else 'ceduto' end);
    if jsonb_array_length(v_form) > 0 then
      v_tutte := v_tutte || (select jsonb_agg(f || jsonb_build_object('nome', m.nome)) from jsonb_array_elements(v_form) f);
    end if;
    if m.tipo = 'svincolo' then
      insert into public.listone (ruolo, nome, club, origine) values (m.ruolo, m.nome, m.club, 'svincolo');
      insert into public.market_moves (op_id, n, tipo, ruolo, nome, club, team_da, slot_da, da_id, costo,
                                       costo_prima, valore_prima, anno, formazioni)
      values (v_op, m.n, 'svincolo', m.ruolo, m.nome, m.club, m.team_da, m.slot_da, m.pid, m.costo,
              m.costo_prima, m.valore_prima, m.anno, v_form);
    else
      insert into public.market_moves (op_id, n, tipo, ruolo, nome, club, team_da, team_a, slot_da, da_id, costo, valore,
                                       costo_prima, valore_prima, anno, formazioni)
      values (v_op, m.n, 'cessione', m.ruolo, m.nome, m.club, m.team_da, m.team_a, m.slot_da, m.pid, m.costo, m.valore,
              m.costo_prima, m.valore_prima, m.anno, v_form);
    end if;
  end loop;

  -- chi entra: la riga lasciata libera da chi esce dalla stessa squadra con lo stesso
  -- ruolo ("al posto di"), altrimenti la prima riga libera del suo ruolo
  for m in select * from _mov where tipo in ('cessione', 'acquisto') order by n loop
    select coalesce(
      (select v.slot_da from _mov v
       where v.tipo in ('svincolo', 'cessione') and v.team_da = m.team_a and v.ruolo = m.ruolo
         and not exists (select 1 from public.players p where p.team_id = m.team_a and p.slot = v.slot_da)
       order by v.n limit 1),
      (select min(g)::smallint
       from public.rosa_limiti l, generate_series(l.riga_da::int, l.riga_a::int) g
       where l.ruolo = m.ruolo
         and not exists (select 1 from public.players p where p.team_id = m.team_a and p.slot = g)))
      into v_slot;
    if v_slot is null then
      raise exception 'Nella rosa di arrivo non c''è una riga libera per %', m.nome using errcode = 'P0017';
    end if;
    insert into public.players (team_id, slot, role, name, club)
    values (m.team_a, v_slot, m.ruolo, m.nome, m.club) returning id into v_new;
    insert into public.roster_costs (team_id, slot, nome, costo, valore, anno)
    values (m.team_a, v_slot, m.nome, m.costo, m.valore, m.anno)
    on conflict (team_id, slot) do update
      set nome = excluded.nome, costo = excluded.costo, valore = excluded.valore, anno = excluded.anno;
    if m.tipo = 'acquisto' then
      delete from public.listone where id = m.lid;
      insert into public.market_moves (op_id, n, tipo, ruolo, nome, club, team_a, slot_a, a_id, costo, valore, anno)
      values (v_op, m.n, 'acquisto', m.ruolo, m.nome, m.club, m.team_a, v_slot, v_new, m.costo, m.valore, m.anno);
    else
      update public.market_moves set slot_a = v_slot, a_id = v_new where op_id = v_op and n = m.n;
    end if;
  end loop;

  insert into public.market_moves (op_id, n, tipo, team_da, team_a, costo)
  select v_op, n, 'crediti', team_da, team_a, costo from _mov where tipo = 'crediti';

  update public.market_ops set formazioni = case when jsonb_array_length(v_tutte) > 0 then v_tutte end where id = v_op;
  select count(*) into v_mov from public.market_moves where op_id = v_op;

  return jsonb_build_object('id', v_op, 'movimenti', v_mov, 'crediti', coalesce(v_cred, '[]'::jsonb),
                            'formazioni', v_tutte,
                            'righe', (select jsonb_agg(jsonb_build_object('n', n, 'tipo', tipo, 'nome', nome, 'team_da', team_da,
                                                                         'team_a', team_a, 'slot_da', slot_da, 'slot_a', slot_a) order by n)
                                      from public.market_moves where op_id = v_op));
end $$;
revoke all on function public.mercato_operazione(jsonb) from public, anon;
grant execute on function public.mercato_operazione(jsonb) to authenticated;

-- l'operazione di prima (uno svincolato al posto di uno in rosa) passa da qui
create or replace function public.mercato_sostituisci(
  p_esce uuid, p_entra integer, p_costo_svincolo integer, p_costo_acquisto integer, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_team uuid; v_p public.players; v_l public.listone;
begin
  select * into v_p from public.players where id = p_esce;
  select * into v_l from public.listone where id = p_entra;
  v_team := v_p.team_id;
  -- "al posto di": stesso ruolo, come prima
  if v_p.id is not null and v_l.id is not null and v_l.ruolo <> v_p.role then
    raise exception 'Ruoli diversi: % è %, % è %', v_p.name, v_p.role, v_l.nome, v_l.ruolo using errcode = 'P0012';
  end if;
  v := public.mercato_operazione(jsonb_build_object(
         'svincoli', jsonb_build_array(jsonb_build_object('player_id', p_esce, 'costo', coalesce(p_costo_svincolo, 0))),
         'acquisti', jsonb_build_array(jsonb_build_object('listone_id', p_entra, 'team_id', v_team, 'costo', coalesce(p_costo_acquisto, 0))),
         'note', p_note));
  -- la testata come la scriveva la versione di prima (chi la legge ancora la trova)
  update public.market_ops o set
    team_id = v_team, ruolo = a.ruolo, slot = a.slot_a,
    esce_id = s.da_id, esce_nome = s.nome, esce_club = s.club, esce_costo = s.costo_prima, esce_valore = s.valore_prima,
    entra_id = a.a_id, entra_nome = a.nome, entra_club = a.club,
    costo_svincolo = s.costo::int, costo_acquisto = a.costo::int,
    crediti_prima = (select (c ->> 'prima')::int from jsonb_array_elements(v -> 'crediti') c where (c ->> 'team_id')::uuid = v_team),
    crediti_dopo  = (select (c ->> 'dopo')::int  from jsonb_array_elements(v -> 'crediti') c where (c ->> 'team_id')::uuid = v_team)
  from public.market_moves s, public.market_moves a
  where o.id = (v ->> 'id')::bigint and s.op_id = o.id and s.tipo = 'svincolo' and a.op_id = o.id and a.tipo = 'acquisto';
  return v || (select jsonb_build_object('crediti_prima', crediti_prima, 'crediti_dopo', crediti_dopo)
               from public.market_ops where id = (v ->> 'id')::bigint);
end $$;
revoke all on function public.mercato_sostituisci(uuid, integer, integer, integer, text) from public, anon;
grant execute on function public.mercato_sostituisci(uuid, integer, integer, integer, text) to authenticated;

-- 6) Annullare l'ultima operazione (se il file di giornata non l'ha già recepita) ----
create or replace function public.mercato_annulla(p_op bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_o public.market_ops; m record; f jsonb; v_lin uuid; v_pos smallint; v_l integer; v_rimessi int := 0;
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
  -- chi è entrato è ancora lì, chi è uscito è ancora fuori rosa
  if exists (select 1 from public.market_moves v where v.op_id = p_op and v.tipo in ('acquisto', 'cessione')
             and not exists (select 1 from public.players p where p.id = v.a_id and p.team_id = v.team_a and p.slot = v.slot_a))
     or exists (select 1 from public.market_moves v where v.op_id = p_op and v.tipo in ('svincolo', 'cessione')
             and not exists (select 1 from public.players p where p.id = v.da_id and p.slot is null)) then
    raise exception 'Le rose sono cambiate dopo l''operazione: non posso annullarla' using errcode = 'P0015';
  end if;

  -- chi era entrato: se è già stato schierato resta nello storico, altrimenti sparisce
  for m in select * from public.market_moves where op_id = p_op and tipo in ('acquisto', 'cessione') order by n desc loop
    perform public.togli_dalle_formazioni(m.a_id, 'annullata');
    if exists (select 1 from public.lineup_slots where player_id = m.a_id) then
      update public.players set slot = null, fuori_rosa_at = now() where id = m.a_id;
    else
      delete from public.players where id = m.a_id;
    end if;
    delete from public.roster_costs where team_id = m.team_a and slot = m.slot_a;
    if m.tipo = 'acquisto' then
      insert into public.listone (ruolo, nome, club, origine) values (m.ruolo, m.nome, m.club, 'file');
    end if;
  end loop;

  -- chi era uscito torna al suo posto, con il suo costo
  for m in select * from public.market_moves where op_id = p_op and tipo in ('svincolo', 'cessione') order by n desc loop
    if exists (select 1 from public.players where team_id = m.team_da and slot = m.slot_da) then
      raise exception 'La riga % di % è occupata: non posso rimettere %', m.slot_da,
        (select name from public.teams where id = m.team_da), m.nome using errcode = 'P0015';
    end if;
    update public.players set slot = m.slot_da, fuori_rosa_at = null where id = m.da_id;
    if m.costo_prima is not null or m.valore_prima is not null or m.anno is not null then
      insert into public.roster_costs (team_id, slot, nome, costo, valore, anno)
      values (m.team_da, m.slot_da, m.nome, m.costo_prima, m.valore_prima, m.anno)
      on conflict (team_id, slot) do update
        set nome = excluded.nome, costo = excluded.costo, valore = excluded.valore, anno = excluded.anno;
    end if;
    if m.tipo = 'svincolo' then
      select id into v_l from public.listone
      where ruolo = m.ruolo and public.nome_norm(nome) = public.nome_norm(m.nome) order by id desc limit 1;
      if v_l is not null then delete from public.listone where id = v_l; end if;
    end if;
    -- torna nelle formazioni da cui era stato tolto, se la giornata non è iniziata e il
    -- suo posto è ancora libero: allora quel posto non è più da rifare
    for f in select * from jsonb_array_elements(coalesce(m.formazioni, '[]'::jsonb)) loop
      select l.id into v_lin from public.lineups l
      where l.team_id = (f ->> 'team_id')::uuid and l.matchday = (f ->> 'matchday')::smallint;
      v_pos := (f ->> 'pos')::smallint;
      if v_lin is not null
         and not exists (select 1 from public.lineup_slots where lineup_id = v_lin and (pos = v_pos or player_id = m.da_id))
         and not exists (select 1 from public.fixtures fx where fx.matchday = (f ->> 'matchday')::smallint and fx.kickoff <= now())
         and exists (select 1 from public.matchdays md where md.id = (f ->> 'matchday')::smallint and md.deadline > now()) then
        insert into public.lineup_slots (lineup_id, pos, player_id) values (v_lin, v_pos, m.da_id);
        delete from public.lineup_vuoti where lineup_id = v_lin and pos = v_pos;
        v_rimessi := v_rimessi + 1;
      end if;
    end loop;
  end loop;

  update public.market_ops set annullata_at = now(), annullata_da = auth.uid() where id = p_op;
  return jsonb_build_object('id', p_op, 'formazioni', v_o.formazioni, 'rimessi', v_rimessi);
end $$;
revoke all on function public.mercato_annulla(bigint) from public, anon;
grant execute on function public.mercato_annulla(bigint) to authenticated;

-- 7) "Già nel file": per le operazioni che il controllo non può riconoscere da solo
--    (per esempio un passaggio di soli crediti)
create or replace function public.mercato_riportata(p_op bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore' using errcode = 'P0005';
  end if;
  update public.market_ops
  set riportata_at = now(), riportata_round = (select max(id) from public.rounds where caricata_at is not null)
  where id = p_op and annullata_at is null and riportata_at is null;
end $$;
revoke all on function public.mercato_riportata(bigint) from public, anon;
grant execute on function public.mercato_riportata(bigint) to authenticated;

-- 8) Dopo il caricamento del file di giornata ---------------------------------------
-- Il LISTONE del file diventa la lista degli svincolati; un'operazione risulta riportata
-- quando nel foglio ROSE del file chi è entrato è al suo posto e chi è uscito non c'è più
-- (le operazioni di soli crediti si segnano a mano); chi è stato svincolato dal sito resta
-- svincolato anche se il file non lo sa ancora. Ritorna le differenze fra le rose.
-- Scrive anche l'anno di contratto di ogni riga (import_round scrive costo e penale) e
-- rimette costo, penale e anno dei giocatori entrati con operazioni non ancora nel file.
-- p_rose = [{ squadra, slot, nome, anno }], p_listone = [{ ruolo, nome, squadra }]
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
    with file as (
      select public.team_by_name(e ->> 'squadra') team_id, (e ->> 'slot')::smallint slot, public.nome_norm(e ->> 'nome') nome
      from jsonb_array_elements(p_rose) e
    )
    update public.market_ops m set riportata_at = now(), riportata_round = p_round
    where m.annullata_at is null and m.riportata_at is null
      and exists (select 1 from public.market_moves v where v.op_id = m.id and v.tipo <> 'crediti')
      and not exists (select 1 from public.market_moves v where v.op_id = m.id and v.tipo in ('acquisto', 'cessione')
                      and not exists (select 1 from file f where f.team_id = v.team_a and f.slot = v.slot_a
                                      and f.nome = public.nome_norm(v.nome)))
      and not exists (select 1 from public.market_moves v where v.op_id = m.id and v.tipo in ('svincolo', 'cessione')
                      and exists (select 1 from file f where f.team_id = v.team_da and f.slot = v.slot_da
                                  and f.nome = public.nome_norm(v.nome)));
    get diagnostics v_riportate = row_count;
  end if;

  -- l'anno di contratto di ogni riga del file (costo e penale li ha scritti import_round)
  if jsonb_array_length(coalesce(p_rose, '[]'::jsonb)) > 0 then
    update public.roster_costs rc set anno = f.anno
    from (select public.team_by_name(e ->> 'squadra') team_id, (e ->> 'slot')::smallint slot, e ->> 'nome' nome,
                 nullif(e ->> 'anno', '')::smallint anno
          from jsonb_array_elements(p_rose) e) f
    where rc.team_id = f.team_id and rc.slot = f.slot and public.nome_norm(rc.nome) = public.nome_norm(f.nome)
      and rc.anno is distinct from f.anno;
  end if;

  -- chi è entrato con un'operazione che il file non ha ancora: la sua riga tiene costo,
  -- penale e anno dell'operazione (import_round l'ha appena riscritta con il file)
  insert into public.roster_costs (team_id, slot, nome, costo, valore, anno)
  select distinct on (v.team_a, v.slot_a) v.team_a, v.slot_a, v.nome, v.costo, v.valore, v.anno
  from public.market_moves v
  join public.market_ops m on m.id = v.op_id
  join public.players p on p.id = v.a_id and p.team_id = v.team_a and p.slot = v.slot_a
  where v.tipo in ('acquisto', 'cessione') and m.annullata_at is null and m.riportata_at is null
  order by v.team_a, v.slot_a, m.id desc
  on conflict (team_id, slot) do update
    set nome = excluded.nome, costo = excluded.costo, valore = excluded.valore, anno = excluded.anno;

  -- chi è stato svincolato dal sito e il file non lo sa ancora: resta fra gli svincolati
  insert into public.listone (ruolo, nome, club, origine)
  select distinct v.ruolo, v.nome, v.club, 'svincolo'
  from public.market_moves v join public.market_ops m on m.id = v.op_id
  where v.tipo = 'svincolo' and m.annullata_at is null and m.riportata_at is null
    and not exists (select 1 from public.listone l where l.ruolo = v.ruolo and public.nome_norm(l.nome) = public.nome_norm(v.nome))
    and not exists (select 1 from public.players p where p.slot is not null and p.role = v.ruolo
                    and public.nome_norm(p.name) = public.nome_norm(v.nome));

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
             'operazione', (select max(m.id) from public.market_ops m join public.market_moves v on v.op_id = m.id
                            where m.annullata_at is null and m.riportata_at is null
                              and ((v.team_a = d.team_id and v.slot_a = d.slot) or (v.team_da = d.team_id and v.slot_da = d.slot))))
           order by d.team_id, d.slot)
      into v_diff from d;
  end if;

  return jsonb_build_object(
    'listone', v_listone, 'riportate', v_riportate,
    'in_sospeso', (select count(*) from public.market_ops where annullata_at is null and riportata_at is null),
    'differenze', coalesce(v_diff, '[]'::jsonb));
end $$;
revoke all on function public.mercato_dal_file(smallint, jsonb, jsonb) from public, anon;
grant execute on function public.mercato_dal_file(smallint, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- Controlli utili
-- select * from public.rosa_limiti order by ruolo;
-- select t.name, p.role, count(*) from public.players p join public.teams t on t.id = p.team_id
--   where p.slot is not null group by 1, 2 order by 1, 2;
-- select m.id, m.at, m.tipo, v.n, v.tipo, v.nome, v.team_da, v.team_a, v.slot_da, v.slot_a, v.costo
--   from public.market_ops m join public.market_moves v on v.op_id = m.id order by m.id desc, v.n;
-- select * from public.mercato_crediti();
-- select t.name, rc.slot, rc.nome, rc.costo, rc.valore penale, rc.anno from public.roster_costs rc
--   join public.teams t on t.id = rc.team_id order by t.name, rc.slot;
