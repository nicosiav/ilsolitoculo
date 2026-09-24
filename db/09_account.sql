-- Collega gli account alle squadre, senza script (strada "tutta dal pannello").
--
-- 1. Authentication -> Users -> Add user -> Create new user, per ogni partecipante:
--    email, una password provvisoria, spunta "Auto Confirm User".
-- 2. Qui sotto metti le email vere al posto di quelle d'esempio ed esegui tutto
--    nel SQL Editor. Si può rieseguire quante volte vuoi.
--
-- Chi preferisce lo script (crea gli account e prepara i messaggi WhatsApp):
-- db/crea_account.py, vedi db/README.md.

with elenco (email, squadra, nome, ruolo) as (values
  ('email-di-massimo@esempio.it',    'Massimo',    'Massimo',    'player'),
  ('email-di-giovanni@esempio.it',   'Giovanni',   'Giovanni',   'player'),
  ('email-di-colombrita@esempio.it', 'Colombrita', 'Colombrita', 'player'),
  ('email-di-giuseppe@esempio.it',   'Giuseppe',   'Giuseppe',   'player'),
  ('email-di-marco-i@esempio.it',    'MarcoI',     'Marco I',    'player'),
  ('email-di-marco-ii@esempio.it',   'MarcoII',    'Marco II',   'player'),
  ('valerionicosia86@gmail.com',     'Valerio',    'Valerio',    'admin'),
  ('sebi.nicosia@tiscali.it',        'Sebi',       'Sebi',       'admin')
)
update public.profiles p
set team_id = t.id, display_name = e.nome, role = e.ruolo
from elenco e
join auth.users u on lower(u.email) = lower(e.email)
join public.teams t on t.name = e.squadra
where p.id = u.id;

-- Controllo: una riga per squadra. "manca l'account" = email sbagliata o utente non ancora creato.
select t.name as squadra,
       coalesce(u.email, 'manca l''account') as email,
       p.display_name as nome, p.role as ruolo,
       u.last_sign_in_at as ultimo_accesso
from public.teams t
left join public.profiles p on p.team_id = t.id
left join auth.users u on u.id = p.id
order by t.name;
