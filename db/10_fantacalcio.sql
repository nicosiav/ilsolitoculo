-- Medie di Serie A da Fantacalcio.it, mostrate in Rose accanto a quelle della lega.
--
-- L'amministratore scarica l'Excel dalla pagina "Statistiche Serie A" di
-- Fantacalcio.it e lo carica dal sito (menu → "Carica le medie di Fantacalcio.it"):
-- il sito lo legge e chiama import_fc_stats(). Nessun download automatico: le
-- condizioni d'uso di Fantacalcio.it non lo permettono.
--
-- Da eseguire una volta nel SQL Editor, dopo 08_stagione.sql. Si può rieseguire.

create table if not exists public.fc_stats (
  id       serial primary key,
  fc_id    integer,                 -- "Id" del file
  ruolo    char(1),                 -- P D C A
  ruolo_m  text,                    -- ruolo Mantra, se c'è
  nome     text not null,
  squadra  text,                    -- squadra di Serie A
  pv       smallint,                -- partite a voto
  mv       numeric(4,2),            -- media voto
  fm       numeric(4,2),            -- fantamedia
  gf smallint, gs smallint, rp smallint, rc smallint, r_piu smallint, r_meno smallint,
  ass smallint, amm smallint, esp smallint, au smallint
);
create index if not exists fc_stats_nome_idx on public.fc_stats (nome);

-- una riga sola: quando e da quale file
create table if not exists public.fc_stats_meta (
  id            boolean primary key default true check (id),
  aggiornate_at timestamptz,
  file          text,
  stagione      text,
  righe         integer,
  caricate_da   uuid references auth.users on delete set null
);

alter table public.fc_stats enable row level security;
alter table public.fc_stats_meta enable row level security;
drop policy if exists fc_stats_read on public.fc_stats;
create policy fc_stats_read on public.fc_stats for select to authenticated using (true);
drop policy if exists fc_stats_meta_read on public.fc_stats_meta;
create policy fc_stats_meta_read on public.fc_stats_meta for select to authenticated using (true);
grant select on public.fc_stats, public.fc_stats_meta to authenticated;
-- si scrive solo con import_fc_stats()

-- p = { file, stagione, righe: [{ id, ruolo, ruolo_m, nome, squadra, pv, mv, fm, gf, gs, rp, rc, r_piu, r_meno, ass, amm, esp, au }] }
create or replace function public.import_fc_stats(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if not public.is_admin() then
    raise exception 'Solo l''amministratore può caricare le medie' using errcode = 'P0005';
  end if;
  if jsonb_array_length(coalesce(p -> 'righe', '[]'::jsonb)) = 0 then
    raise exception 'Nel file non ci sono giocatori' using errcode = 'P0006';
  end if;
  delete from public.fc_stats where true;
  insert into public.fc_stats (fc_id, ruolo, ruolo_m, nome, squadra, pv, mv, fm, gf, gs, rp, rc, r_piu, r_meno, ass, amm, esp, au)
  select (e ->> 'id')::numeric::int, left(nullif(e ->> 'ruolo', ''), 1), nullif(e ->> 'ruolo_m', ''), e ->> 'nome', e ->> 'squadra',
         (e ->> 'pv')::numeric::smallint, (e ->> 'mv')::numeric, (e ->> 'fm')::numeric,
         (e ->> 'gf')::numeric::smallint, (e ->> 'gs')::numeric::smallint, (e ->> 'rp')::numeric::smallint,
         (e ->> 'rc')::numeric::smallint, (e ->> 'r_piu')::numeric::smallint, (e ->> 'r_meno')::numeric::smallint,
         (e ->> 'ass')::numeric::smallint, (e ->> 'amm')::numeric::smallint, (e ->> 'esp')::numeric::smallint,
         (e ->> 'au')::numeric::smallint
  from jsonb_array_elements(p -> 'righe') e
  where coalesce(e ->> 'nome', '') <> '';
  get diagnostics v_n = row_count;
  insert into public.fc_stats_meta (id, aggiornate_at, file, stagione, righe, caricate_da)
  values (true, now(), p ->> 'file', p ->> 'stagione', v_n, auth.uid())
  on conflict (id) do update set aggiornate_at = excluded.aggiornate_at, file = excluded.file,
    stagione = excluded.stagione, righe = excluded.righe, caricate_da = excluded.caricate_da;
  return jsonb_build_object('righe', v_n, 'aggiornate_at', now());
end $$;

revoke all on function public.import_fc_stats(jsonb) from public;
grant execute on function public.import_fc_stats(jsonb) to authenticated;

notify pgrst, 'reload schema';

-- Controlli utili
-- select * from public.fc_stats_meta;
-- select nome, squadra, pv, mv, fm from public.fc_stats order by fm desc nulls last limit 20;
