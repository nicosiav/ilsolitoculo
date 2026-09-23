-- Prova del caricamento di una giornata.
-- Prima genera il payload dal file .xls:
--   node -e "const G=require('./tools/sito-lega/src/giornata.js'),fs=require('fs');
--            fs.writeFileSync('/tmp/payload.json', JSON.stringify(
--              G.parse(new Uint8Array(fs.readFileSync(process.argv[1])), 'giornata.xls')))" "giornata.xls"
-- poi:
--   psql ... -f db/test/02_prova_giornata.sql

\set ON_ERROR_STOP on

insert into public.teams (name, sheet_name) values
 ('Massimo','Massimo'),('Giovanni','Giovanni'),('Colombrita','Colombrita'),('Giuseppe','Giuseppe'),
 ('MarcoI','MarcoI'),('MarcoII','MarcoII'),('Valerio','Valerio'),('Sebi','Sebi')
on conflict do nothing;

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','admin@test.it')
on conflict do nothing;
update public.profiles set role = 'admin', team_id = (select id from public.teams where name = 'Sebi')
where id = '22222222-2222-2222-2222-222222222222';

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\set payload `cat /tmp/payload.json`
select jsonb_pretty(public.import_round(:'payload'::jsonb)) as esito;

-- controlli
select 'giornate' k, count(*) tot, count(*) filter (where giocata) giocate from public.rounds;
select t.name, s.pos, s.valore punti, s.dati ->> 'gf' gf, s.dati ->> 'gs' gs
from public.standings s join public.teams t on t.id = s.team_id
where s.tipo = 'campionato' and s.round = (select max(round) from public.standings where tipo = 'campionato')
order by s.pos;
select count(*) voti, count(distinct nome) giocatori from public.player_votes;
select squadra, nome, presenze, media, fantamedia from public.player_stats
order by fantamedia desc nulls last limit 5;
