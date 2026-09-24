-- Il Solito Culo — schema del database (Supabase / PostgreSQL)
-- Eseguire una volta sola, nel SQL Editor del progetto Supabase.

create extension if not exists pgcrypto;

-- Squadre della lega (una per partecipante) -------------------------------
create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,          -- come lo chiamiamo noi: "Valerio"
  sheet_name  text not null unique,          -- nome del foglio nell'Excel della lega
  created_at  timestamptz not null default now()
);

-- Utenti: una riga per ogni account, collegata alla squadra ---------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text,
  role         text not null default 'player' check (role in ('player', 'admin')),
  team_id      uuid references public.teams on delete set null,
  created_at   timestamptz not null default now()
);

-- Rose: 31 posti per squadra, come le righe del foglio --------------------
create table if not exists public.players (
  id       uuid primary key default gen_random_uuid(),
  team_id  uuid not null references public.teams on delete cascade,
  slot     smallint not null check (slot between 1 and 31),
  role     char(1) not null check (role in ('P', 'D', 'C', 'A')),
  name     text not null,
  unique (team_id, slot)
);
create index if not exists players_team_idx on public.players (team_id);

-- Giornate: una sola è "corrente", ognuna ha la scadenza ------------------
create table if not exists public.matchdays (
  id         smallint primary key,           -- numero di giornata
  label      text,
  deadline   timestamptz not null,           -- dopo questo momento le formazioni si bloccano
  is_current boolean not null default false
);
create unique index if not exists matchdays_one_current on public.matchdays (is_current) where is_current;

-- Formazioni: una per squadra e giornata, si sovrascrive -------------------
create table if not exists public.lineups (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams on delete cascade,
  matchday   smallint not null references public.matchdays on delete cascade,
  module     text,
  bench_free boolean not null default false, -- riserve in ordine libero
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users,
  unique (team_id, matchday)
);

-- I 22 posti della formazione: 1–11 titolari, 12–18 riserve, 19–22 extra ---
create table if not exists public.lineup_slots (
  lineup_id uuid not null references public.lineups on delete cascade,
  pos       smallint not null check (pos between 1 and 22),
  player_id uuid not null references public.players on delete cascade,
  primary key (lineup_id, pos),
  unique (lineup_id, player_id)
);

-- Log: chi ha toccato cosa e quando ----------------------------------------
create table if not exists public.lineup_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  team_id   uuid not null references public.teams on delete cascade,
  matchday  smallint not null,
  user_id   uuid references auth.users,
  action    text not null check (action in ('creata', 'modificata', 'esportata')),
  changes   jsonb,                           -- cosa è cambiato in questa sessione
  snapshot  jsonb                            -- la formazione com'era dopo il salvataggio
);
create index if not exists lineup_log_team_idx on public.lineup_log (team_id, matchday, at desc);

-- Chi salva lascia la firma sulla formazione -------------------------------
create or replace function public.touch_lineup() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists lineups_touch on public.lineups;
create trigger lineups_touch before insert or update on public.lineups
  for each row execute function public.touch_lineup();

-- Ogni nuovo account nasce come giocatore senza squadra --------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
