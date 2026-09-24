-- Il Solito Culo — la stagione: giornate, partite, voti, classifiche
-- Da eseguire dopo 07_cron.sql.
--
-- Tutto quello che sta qui dentro arriva da un solo posto: il file .xls di
-- giornata che l'amministratore carica ogni settimana (es. "03 Campionato -
-- Terza Giornata.xls"). Il sito non ricalcola niente: mostra quello che il
-- file dice, con i nomi e le regole della lega.

-- 1) Le giornate della lega ------------------------------------------------
-- La 1ª di lega è la 3ª di Serie A (regolamento, punto 5.1): serie_a = id + 2.
create table if not exists public.rounds (
  id          smallint primary key,       -- giornata di lega
  serie_a     smallint,                   -- giornata di Serie A corrispondente
  fase        text not null default 'regolare'
              check (fase in ('regolare', 'orologio', 'coppa', 'playoff', 'supercoppa')),
  label       text,
  giocata     boolean not null default false,
  caricata_at timestamptz,
  file        text
);

-- 2) Le partite -------------------------------------------------------------
create table if not exists public.matches (
  round        smallint not null references public.rounds on delete cascade,
  competizione text not null default 'campionato',
  slot         smallint not null,         -- 1..4, posizione nel blocco della giornata
  casa         uuid references public.teams on delete set null,
  fuori        uuid references public.teams on delete set null,
  pos_casa     smallint,                  -- fase a orologio non ancora risolta
  pos_fuori    smallint,
  gol_casa     smallint,
  gol_fuori    smallint,
  punti_casa   numeric(6,2),              -- punteggio Coppa di Lega
  punti_fuori  numeric(6,2),
  campo_casa   numeric(4,2),
  campo_fuori  numeric(4,2),
  bonus_casa   numeric(4,2),              -- bonus dal modulo dell'avversario
  bonus_fuori  numeric(4,2),
  modulo_casa  text,
  modulo_fuori text,
  totale_casa  numeric(6,2),
  totale_fuori numeric(6,2),
  primary key (round, competizione, slot)
);
create index if not exists matches_casa_idx  on public.matches (casa);
create index if not exists matches_fuori_idx on public.matches (fuori);

-- 3) Il tabellino di ogni squadra per giornata ------------------------------
create table if not exists public.round_teams (
  round         smallint not null references public.rounds on delete cascade,
  team_id       uuid not null references public.teams on delete cascade,
  modulo        text,
  punteggio     numeric(6,2),             -- punteggio di Coppa di Lega
  somma_voti    numeric(6,2),
  fattore_campo numeric(4,2),
  bonus_modulo  numeric(4,2),
  totale        numeric(6,2),
  gol_fatti     smallint,
  gol_subiti    smallint,
  avversario    uuid references public.teams on delete set null,
  in_casa       boolean,
  sostituzioni  jsonb,                    -- {P,D,C,A,tot}
  marcatori     jsonb,                    -- ["Adzic", ...]
  formazione    jsonb,                    -- chi è sceso in campo, con voti
  schierati     jsonb,                    -- i 22 posti schierati, con voti
  primary key (round, team_id)
);

-- 4) I voti di ogni giocatore, giornata per giornata ------------------------
create table if not exists public.player_votes (
  round     smallint not null references public.rounds on delete cascade,
  team_id   uuid not null references public.teams on delete cascade,
  nome      text not null,
  ruolo     char(1),
  voto      numeric(4,2),
  fantavoto numeric(4,2),
  player_id uuid references public.players on delete set null,
  primary key (round, team_id, nome)
);
create index if not exists votes_nome_idx on public.player_votes (nome);

-- 5) Le classifiche, fotografate a ogni giornata ----------------------------
-- tipo: campionato | coppa_lega | sfigometro | gol_totali | gol_sfruttati
--       super_standard | super_corretta | coppa
create table if not exists public.standings (
  round   smallint not null references public.rounds on delete cascade,
  tipo    text not null,
  team_id uuid not null references public.teams on delete cascade,
  pos     smallint,
  valore  numeric(8,2),
  dati    jsonb,
  primary key (round, tipo, team_id)
);

-- 6) Gol reali e crediti ----------------------------------------------------
create table if not exists public.team_season (
  round         smallint not null references public.rounds on delete cascade,
  team_id       uuid not null references public.teams on delete cascade,
  crediti       integer,
  gol_totali    integer,
  gol_sfruttati integer,
  primary key (round, team_id)
);

create table if not exists public.scorers (
  round         smallint not null references public.rounds on delete cascade,
  team_id       uuid not null references public.teams on delete cascade,
  nome          text not null,
  gol           integer default 0,        -- gol reali totali
  gol_sfruttati integer default 0,        -- quelli con il giocatore schierato
  primary key (round, team_id, nome)
);

-- 7) Costo e valore dei giocatori (foglio ROSE) -----------------------------
create table if not exists public.roster_costs (
  team_id uuid not null references public.teams on delete cascade,
  slot    smallint not null,
  nome    text not null,
  costo   numeric(6,1),
  valore  numeric(6,1),
  primary key (team_id, slot)
);

-- 8) Albo d'oro -------------------------------------------------------------
create table if not exists public.albo (
  stagione    text primary key,
  campionato  text,
  coppa       text,
  coppa_lega  text,
  supercoppa  text
);

-- 9) Permessi: leggono tutti i partecipanti, scrive solo l'import ----------
do $$ declare t text;
begin
  foreach t in array array['rounds','matches','round_teams','player_votes','standings',
                           'team_season','scorers','roster_costs','albo'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
end $$;

-- 10) Squadre della lega per nome (il file le scrive in modi diversi) -------
create or replace function public.team_by_name(p_name text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.teams
  where upper(regexp_replace(coalesce(sheet_name, ''), '[^a-zA-Z0-9]', '', 'g'))
        = upper(regexp_replace(coalesce(p_name, '#'), '[^a-zA-Z0-9]', '', 'g'))
     or upper(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'))
        = upper(regexp_replace(coalesce(p_name, '#'), '[^a-zA-Z0-9]', '', 'g'))
  limit 1
$$;

grant execute on function public.team_by_name(text) to authenticated;

-- 11) Caricamento della giornata -------------------------------------------
-- Riceve quello che l'app ha letto dal file .xls e scrive tutto in una volta.
-- Ritorna un riepilogo, comprese le differenze fra la formazione salvata
-- nell'app e quella che risulta dal file.
create or replace function public.import_round(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_round   smallint := (p ->> 'giornata')::smallint;
  v_seriea  smallint := (p ->> 'serie_a')::smallint;
  v_n       int;
  v_out     jsonb := '{}'::jsonb;
  v_ignote  text;
  v_diff    jsonb;
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore può caricare la giornata' using errcode = 'P0005';
  end if;
  if v_round is null then
    raise exception 'Nel file non trovo il numero di giornata' using errcode = 'P0003';
  end if;

  -- squadre del file che non esistono nella lega
  select string_agg(distinct s, ', ') into v_ignote
  from jsonb_array_elements_text(coalesce(p -> 'squadre', '[]'::jsonb)) s
  where public.team_by_name(s) is null;
  if v_ignote is not null then
    raise exception 'Squadre non riconosciute: %', v_ignote using errcode = 'P0006';
  end if;

  -- giornate: dal calendario completo, così il sito le ha tutte
  insert into public.rounds (id, serie_a, fase, label, giocata)
  select n, n + 2,
         case when n <= 14 then 'regolare' else 'orologio' end,
         'Giornata ' || n, giocata
  from (
    select (e ->> 'giornata')::smallint n, bool_or((e ->> 'giocata')::boolean) giocata
    from jsonb_array_elements(coalesce(p -> 'calendario', '[]'::jsonb)) e
    group by 1
  ) x
  on conflict (id) do update set
    serie_a = excluded.serie_a,
    giocata = public.rounds.giocata or excluded.giocata;

  update public.rounds set caricata_at = now(), file = p ->> 'file', serie_a = coalesce(v_seriea, serie_a)
  where id = v_round;

  -- partite di tutte le giornate presenti nel file
  delete from public.matches m
  where m.competizione = 'campionato'
    and m.round in (select distinct (e ->> 'giornata')::smallint
                    from jsonb_array_elements(coalesce(p -> 'calendario', '[]'::jsonb)) e);

  with src as (
    select (e ->> 'giornata')::smallint round,
           row_number() over (partition by (e ->> 'giornata')::smallint order by ord) slot,
           public.team_by_name(e ->> 'casa') casa,
           public.team_by_name(e ->> 'fuori') fuori,
           nullif(e ->> 'pos_casa', '')::smallint pos_casa,
           nullif(e ->> 'pos_fuori', '')::smallint pos_fuori,
           nullif(e ->> 'gol_casa', '')::smallint gol_casa,
           nullif(e ->> 'gol_fuori', '')::smallint gol_fuori
    from jsonb_array_elements(coalesce(p -> 'calendario', '[]'::jsonb)) with ordinality t(e, ord)
  )
  insert into public.matches (round, competizione, slot, casa, fuori, pos_casa, pos_fuori, gol_casa, gol_fuori)
  select round, 'campionato', slot, casa, fuori, pos_casa, pos_fuori, gol_casa, gol_fuori from src;
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('partite', v_n);

  -- tabellino di ogni squadra per questa giornata
  delete from public.round_teams where round = v_round;
  insert into public.round_teams (round, team_id, modulo, punteggio, somma_voti, fattore_campo,
                                  bonus_modulo, totale, gol_fatti, gol_subiti, avversario, in_casa,
                                  sostituzioni, marcatori, formazione, schierati)
  select v_round, public.team_by_name(e ->> 'squadra'), e ->> 'modulo',
         nullif(e ->> 'punteggio', '')::numeric, nullif(e ->> 'somma_voti', '')::numeric,
         nullif(e ->> 'fattore_campo', '')::numeric, nullif(e ->> 'bonus_modulo', '')::numeric,
         nullif(e ->> 'totale', '')::numeric,
         nullif(e ->> 'gol_fatti', '')::smallint, nullif(e ->> 'gol_subiti', '')::smallint,
         public.team_by_name(e ->> 'avversario'), (e ->> 'in_casa')::boolean,
         e -> 'sostituzioni', e -> 'marcatori', e -> 'formazione', e -> 'schierati'
  from jsonb_array_elements(coalesce(p -> 'squadre_giornata', '[]'::jsonb)) e
  where public.team_by_name(e ->> 'squadra') is not null;
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('squadre', v_n);

  -- completa i punteggi delle partite di questa giornata dal tabellino
  update public.matches m set
    punti_casa = c.punteggio, punti_fuori = f.punteggio,
    campo_casa = c.fattore_campo, campo_fuori = f.fattore_campo,
    bonus_casa = c.bonus_modulo, bonus_fuori = f.bonus_modulo,
    modulo_casa = c.modulo, modulo_fuori = f.modulo,
    totale_casa = c.totale, totale_fuori = f.totale
  from public.round_teams c, public.round_teams f
  where m.round = v_round and c.round = v_round and f.round = v_round
    and c.team_id = m.casa and f.team_id = m.fuori;

  -- voti di tutti i giocatori
  delete from public.player_votes where round = v_round;
  insert into public.player_votes (round, team_id, nome, ruolo, voto, fantavoto, player_id)
  select v_round, t.id, e ->> 'nome', upper(left(e ->> 'ruolo', 1)),
         nullif(e ->> 'voto', '')::numeric, nullif(e ->> 'fantavoto', '')::numeric,
         (select pl.id from public.players pl where pl.team_id = t.id and pl.name = e ->> 'nome' limit 1)
  from jsonb_array_elements(coalesce(p -> 'voti', '[]'::jsonb)) e
  join lateral (select public.team_by_name(e ->> 'squadra') id) t on true
  where t.id is not null and coalesce(e ->> 'nome', '') <> ''
  on conflict (round, team_id, nome) do update
    set voto = excluded.voto, fantavoto = excluded.fantavoto, ruolo = excluded.ruolo;
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('voti', v_n);

  -- classifiche
  delete from public.standings where round = v_round;
  insert into public.standings (round, tipo, team_id, pos, valore, dati)
  select v_round, x.tipo, public.team_by_name(x.e ->> 'squadra'), x.pos,
         coalesce(nullif(x.e ->> 'punti', ''), nullif(x.e ->> 'totale', ''),
                  nullif(x.e ->> 'valore', ''), nullif(x.e ->> 'definitivo', ''))::numeric,
         x.e
  from (
    select 'campionato' tipo, e, row_number() over () pos
      from jsonb_array_elements(coalesce(p -> 'classifica', '[]'::jsonb)) e
    union all
    select 'super_standard', e, row_number() over ()
      from jsonb_array_elements(coalesce(p #> '{superclassifica,campionato_standard}', '[]'::jsonb)) e
    union all
    select 'super_corretta', e, row_number() over ()
      from jsonb_array_elements(coalesce(p #> '{superclassifica,campionato_corretta}', '[]'::jsonb)) e
    union all
    select 'coppa_lega', e, row_number() over ()
      from jsonb_array_elements(coalesce(p #> '{superclassifica,coppa_lega}', '[]'::jsonb)) e
    union all
    select 'sfigometro', e, row_number() over ()
      from jsonb_array_elements(coalesce(p #> '{superclassifica,sfigometro}', '[]'::jsonb)) e
    union all
    select 'gol_totali', e, row_number() over ()
      from jsonb_array_elements(coalesce(p #> '{superclassifica,gol_totali}', '[]'::jsonb)) e
    union all
    select 'gol_sfruttati', e, row_number() over ()
      from jsonb_array_elements(coalesce(p #> '{superclassifica,gol_sfruttati}', '[]'::jsonb)) e
    union all
    select 'coppa', e, row_number() over ()
      from jsonb_array_elements(coalesce(p #> '{coppa,quarti}', '[]'::jsonb)) e
  ) x
  where public.team_by_name(x.e ->> 'squadra') is not null
  on conflict (round, tipo, team_id) do update set pos = excluded.pos, valore = excluded.valore, dati = excluded.dati;
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('classifiche', v_n);

  -- punteggi di Coppa di Lega e sfigometro giornata per giornata
  insert into public.standings (round, tipo, team_id, pos, valore, dati)
  select (gg.key)::smallint, x.tipo, public.team_by_name(x.e ->> 'squadra'), null, (gg.value #>> '{}')::numeric, null
  from (
    select 'cdl_giornata' tipo, e from jsonb_array_elements(coalesce(p #> '{coppa_lega,settimanali,righe}', '[]'::jsonb)) e
    union all
    select 'sfiga_giornata', e from jsonb_array_elements(coalesce(p #> '{sfigometro,settimanali,righe}', '[]'::jsonb)) e
  ) x, jsonb_each(coalesce(x.e -> 'per_giornata', '{}'::jsonb)) gg
  where public.team_by_name(x.e ->> 'squadra') is not null
    and exists (select 1 from public.rounds r where r.id = (gg.key)::smallint)
  on conflict (round, tipo, team_id) do update set valore = excluded.valore;

  -- crediti e gol reali
  delete from public.team_season where round = v_round;
  insert into public.team_season (round, team_id, crediti, gol_totali, gol_sfruttati)
  select v_round, t.id,
         (select nullif(c ->> 'crediti', '')::int from jsonb_array_elements(coalesce(p -> 'crediti', '[]'::jsonb)) c
           where public.team_by_name(c ->> 'squadra') = t.id limit 1),
         (select nullif(gr ->> 'totali', '')::int from jsonb_array_elements(coalesce(p -> 'gol_reali', '[]'::jsonb)) gr
           where public.team_by_name(gr ->> 'squadra') = t.id limit 1),
         (select nullif(gr ->> 'sfruttati', '')::int from jsonb_array_elements(coalesce(p -> 'gol_reali', '[]'::jsonb)) gr
           where public.team_by_name(gr ->> 'squadra') = t.id limit 1)
  from public.teams t;

  -- marcatori (gol reali per giocatore)
  delete from public.scorers where round = v_round;
  insert into public.scorers (round, team_id, nome, gol, gol_sfruttati)
  select v_round, public.team_by_name(gr ->> 'squadra'), g ->> 'nome',
         coalesce(nullif(g ->> 'totali', '')::int, 0), coalesce(nullif(g ->> 'sfruttati', '')::int, 0)
  from jsonb_array_elements(coalesce(p -> 'gol_reali', '[]'::jsonb)) gr,
       jsonb_array_elements(coalesce(gr -> 'giocatori', '[]'::jsonb)) g
  where public.team_by_name(gr ->> 'squadra') is not null
  on conflict (round, team_id, nome) do update set gol = excluded.gol, gol_sfruttati = excluded.gol_sfruttati;
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('marcatori', v_n);

  -- costo e valore dei giocatori
  insert into public.roster_costs (team_id, slot, nome, costo, valore)
  select public.team_by_name(e ->> 'squadra'), (e ->> 'slot')::smallint, e ->> 'nome',
         nullif(e ->> 'costo', '')::numeric, nullif(e ->> 'valore', '')::numeric
  from jsonb_array_elements(coalesce(p -> 'rose', '[]'::jsonb)) e
  where public.team_by_name(e ->> 'squadra') is not null
  on conflict (team_id, slot) do update
    set nome = excluded.nome, costo = excluded.costo, valore = excluded.valore;

  -- albo d'oro (solo le stagioni con almeno un vincitore)
  insert into public.albo (stagione, campionato, coppa, coppa_lega, supercoppa)
  select e ->> 'stagione', nullif(e ->> 'campionato', ''), nullif(e ->> 'coppa', ''),
         nullif(e ->> 'coppa_lega', ''), nullif(e ->> 'supercoppa', '')
  from jsonb_array_elements(coalesce(p -> 'albo', '[]'::jsonb)) e
  where coalesce(e ->> 'stagione', '') <> ''
  on conflict (stagione) do update set
    campionato = coalesce(excluded.campionato, public.albo.campionato),
    coppa = coalesce(excluded.coppa, public.albo.coppa),
    coppa_lega = coalesce(excluded.coppa_lega, public.albo.coppa_lega),
    supercoppa = coalesce(excluded.supercoppa, public.albo.supercoppa);

  -- differenze fra la formazione salvata nell'app e quella che risulta dal file
  select jsonb_agg(d order by d ->> 'squadra') into v_diff from (
    select jsonb_build_object('squadra', t.name, 'nell_app', a.nomi, 'nel_file', f.nomi) d
    from public.round_teams rt
    join public.teams t on t.id = rt.team_id
    join lateral (
      select jsonb_agg(x ->> 'nome' order by (x ->> 'pos')::int) nomi
      from jsonb_array_elements(coalesce(rt.schierati, '[]'::jsonb)) x
    ) f on true
    join lateral (
      select jsonb_agg(pl.name order by s.pos) nomi
      from public.lineups l
      join public.lineup_slots s on s.lineup_id = l.id
      join public.players pl on pl.id = s.player_id
      where l.team_id = rt.team_id and l.matchday = v_seriea
    ) a on true
    where rt.round = v_round and a.nomi is not null and f.nomi is distinct from a.nomi
  ) q;

  return v_out || jsonb_build_object('giornata', v_round, 'serie_a', v_seriea,
                                     'differenze', coalesce(v_diff, '[]'::jsonb));
end $$;

revoke all on function public.import_round(jsonb) from public;
grant execute on function public.import_round(jsonb) to authenticated;

-- 12) Qualche vista comoda per il sito -------------------------------------
-- Statistiche per giocatore sulla stagione (media voto, fantamedia, presenze)
create or replace view public.player_stats with (security_invoker = on) as
select v.team_id, t.name squadra, v.nome, max(v.ruolo) ruolo,
       count(*) filter (where v.voto is not null and v.voto > 0) presenze,
       round(avg(v.voto) filter (where v.voto is not null and v.voto > 0), 2) media,
       round(avg(v.fantavoto) filter (where v.voto is not null and v.voto > 0), 2) fantamedia,
       max(v.fantavoto) miglior_fantavoto,
       sum(v.fantavoto - v.voto) filter (where v.voto is not null and v.voto > 0) bonus_netti
from public.player_votes v
join public.teams t on t.id = v.team_id
group by v.team_id, t.name, v.nome;

grant select on public.player_stats to authenticated;

-- 13) Avvisa PostgREST che lo schema è cambiato --------------------------
-- Senza questo l'app può rispondere "Could not find the table 'public.rounds'
-- in the schema cache" finché la cache non si aggiorna da sola.
notify pgrst, 'reload schema';

-- Controlli utili ----------------------------------------------------------
-- select * from public.rounds order by id;
-- select r.id, tc.name casa, m.gol_casa, m.gol_fuori, tf.name fuori
--   from public.matches m join public.rounds r on r.id = m.round
--   left join public.teams tc on tc.id = m.casa left join public.teams tf on tf.id = m.fuori
--   order by r.id, m.slot;
-- select * from public.player_stats order by fantamedia desc nulls last limit 20;
