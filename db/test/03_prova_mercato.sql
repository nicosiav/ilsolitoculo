-- Prova del mercato (11_mercato.sql) su un PostgreSQL qualsiasi.
-- Servono tre file in una cartella (DIR), generati dal file di giornata e dal modello:
--   node -e "
--     const G=require('./tools/sito-lega/src/giornata.js'),X=require('./tools/schiera-formazione/src/engine.js'),fs=require('fs');
--     const [xls,mod,dir]=process.argv.slice(1);
--     const d=G.parse(new Uint8Array(fs.readFileSync(xls)),'giornata.xls');
--     fs.writeFileSync(dir+'/payload.json',JSON.stringify(d));
--     const wb=X.load(new Uint8Array(fs.readFileSync(mod))),o={};
--     wb.sheetNames.forEach(n=>o[n]=wb.roster(n).filter(p=>p.name).map(p=>({slot:p.row+1,role:p.role,name:p.name})));
--     fs.writeFileSync(dir+'/rose.json',JSON.stringify(o));
--     const d2=JSON.parse(JSON.stringify(d));
--     d2.rose.find(r=>r.squadra==='VALERIO'&&r.slot===3).nome='Bleve';
--     d2.crediti.find(c=>c.squadra==='VALERIO').crediti=68;
--     d2.listone[d2.listone.findIndex(x=>x.nome==='Bleve')]={ruolo:'P',nome:'Contini',squadra:'Napoli'};
--     fs.writeFileSync(dir+'/payload2.json',JSON.stringify(d2));" "giornata.xls" "Formazioni.xls" "$DIR"
-- poi, su un database con 00_finto_supabase.sql e db/01..11 (senza 03, 07, 09):
--   psql ... -v dir="$DIR" -f db/test/03_prova_mercato.sql
-- Ogni controllo è un ASSERT: se qualcosa non torna lo script si ferma con l'errore.

\set ON_ERROR_STOP on
\set payload `cat :dir/payload.json`
\set payload2 `cat :dir/payload2.json`
\set rose `cat :dir/rose.json`

insert into public.teams (name, sheet_name) values
 ('Massimo','Massimo'),('Giovanni','Giovanni'),('Colombrita','Colombrita'),('Giuseppe','Giuseppe'),
 ('MarcoI','MarcoI'),('MarcoII','MarcoII'),('Valerio','Valerio'),('Sebi','Sebi')
on conflict do nothing;
insert into auth.users (id, email) values
 ('22222222-2222-2222-2222-222222222222','admin@test.it'), ('33333333-3333-3333-3333-333333333333','giocatore@test.it')
on conflict do nothing;
update public.profiles set role = 'admin', team_id = (select id from public.teams where name = 'Sebi')
where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set role = 'player', team_id = (select id from public.teams where name = 'Valerio')
where id = '33333333-3333-3333-3333-333333333333';
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- la giornata 3 e le rose (come "Aggiorna le rose da un .xls")
select (public.import_round(:'payload'::jsonb)) ->> 'giornata' as giornata_caricata;
select public.import_players(k, v) from jsonb_each(:'rose'::jsonb) as x(k, v);
select public.mercato_dal_file(3::smallint, (:'payload'::jsonb) -> 'rose', (:'payload'::jsonb) -> 'listone') ->> 'listone' as svincolati;

-- una giornata da giocare con la formazione di Valerio salvata (Contini in panchina, posto 12)
insert into public.matchdays (id, label, deadline, is_current) values (7, 'Giornata 7', now() + interval '3 days', true)
on conflict (id) do update set deadline = excluded.deadline;
insert into public.lineups (team_id, matchday, module)
select id, 7, '4-3-3' from public.teams where name = 'Valerio';
insert into public.lineup_slots (lineup_id, pos, player_id)
select l.id, 12, p.id from public.lineups l join public.teams t on t.id = l.team_id join public.players p on p.team_id = t.id
where t.name = 'Valerio' and p.name = 'Contini';
-- e una giornata passata, dove Contini era titolare: deve restare com'è
insert into public.matchdays (id, label, deadline) values (5, 'Giornata 5', now() - interval '10 days') on conflict do nothing;
insert into public.lineups (team_id, matchday, module) select id, 5, '3-4-3' from public.teams where name = 'Valerio';
insert into public.lineup_slots (lineup_id, pos, player_id)
select l.id, 1, p.id from public.lineups l join public.teams t on t.id = l.team_id join public.players p on p.team_id = t.id
where t.name = 'Valerio' and l.matchday = 5 and p.name = 'Contini';

do $$
declare v_val uuid := (select id from public.teams where name = 'Valerio');
begin
  assert (select count(*) from public.listone) = 302, 'listone: attesi 302 svincolati';
  assert (select count(*) from public.players where slot is not null) = 231, 'rose: attesi 231 giocatori';
  assert (select crediti from public.mercato_crediti() where team_id = v_val) = 73, 'crediti di Valerio dal file: 73';
  raise notice 'ok  partenza: 302 svincolati, 231 in rosa, Valerio con 73 crediti';
end $$;

-- 1) Valerio: esce Contini (P, posto 3), entra Bleve (P, Lecce) per 5 crediti
\set ON_ERROR_STOP on
select public.mercato_sostituisci(
  (select p.id from public.players p join public.teams t on t.id = p.team_id where t.name = 'Valerio' and p.name = 'Contini'),
  (select id from public.listone where nome = 'Bleve'), 0, 5, 'prova') as op1 \gset
do $$
declare v_val uuid := (select id from public.teams where name = 'Valerio');
        v_contini public.players; v_bleve public.players;
begin
  select * into v_contini from public.players where team_id = v_val and name = 'Contini';
  select * into v_bleve from public.players where team_id = v_val and name = 'Bleve';
  assert v_contini.slot is null and v_contini.fuori_rosa_at is not null, 'Contini deve essere fuori rosa (non cancellato)';
  assert v_bleve.slot = 3 and v_bleve.role = 'P' and v_bleve.club = 'Lecce', 'Bleve al posto 3 con la squadra del LISTONE';
  assert not exists (select 1 from public.listone where nome = 'Bleve'), 'Bleve non è più svincolato';
  assert exists (select 1 from public.listone where nome = 'Contini' and origine = 'svincolo'), 'Contini è fra gli svincolati';
  assert (select nome || '/' || costo from public.roster_costs where team_id = v_val and slot = 3) = 'Bleve/5.0', 'costo in rosa';
  assert (select crediti from public.mercato_crediti() where team_id = v_val) = 68, 'crediti 73 - 5 = 68';
  assert not exists (select 1 from public.lineup_slots s join public.lineups l on l.id = s.lineup_id
                     where l.matchday = 7 and s.player_id = v_contini.id), 'Contini tolto dalla formazione da giocare';
  assert exists (select 1 from public.lineup_slots s join public.lineups l on l.id = s.lineup_id
                 where l.matchday = 5 and s.player_id = v_contini.id), 'la formazione passata resta com''era';
  assert (select jsonb_array_length(formazioni) from public.market_ops order by id desc limit 1) = 1, 'operazione: una formazione toccata';
  raise notice 'ok  operazione: Contini fuori rosa (storico intatto), Bleve al posto 3, crediti 68, formazione da giocare ripulita';
end $$;

-- 2) gli errori
do $$
declare v_ok boolean;
  v_sebi uuid := (select id from public.teams where name = 'Sebi');
  v_dif uuid := (select p.id from public.players p where p.team_id = (select id from public.teams where name = 'Sebi') and p.role = 'D' and p.slot is not null limit 1);
  v_por uuid := (select p.id from public.players p where p.team_id = (select id from public.teams where name = 'Sebi') and p.role = 'P' and p.slot is not null limit 1);
begin
  -- ruolo diverso
  begin
    perform public.mercato_sostituisci(v_dif, (select id from public.listone where ruolo = 'P' limit 1), 0, 1);
    v_ok := false;
  exception when sqlstate 'P0012' then v_ok := true; end;
  assert v_ok, 'un D non si sostituisce con un P';
  -- crediti insufficienti
  begin
    perform public.mercato_sostituisci(v_por, (select id from public.listone where ruolo = 'P' limit 1), 0, 100000);
    v_ok := false;
  exception when sqlstate 'P0014' then v_ok := true; end;
  assert v_ok, 'crediti insufficienti';
  -- chi è già uscito non si svincola di nuovo
  begin
    perform public.mercato_sostituisci((select id from public.players where name = 'Contini' and slot is null), (select id from public.listone where ruolo = 'P' limit 1), 0, 1);
    v_ok := false;
  exception when sqlstate 'P0010' then v_ok := true; end;
  assert v_ok, 'chi è fuori rosa non si svincola';
  -- acquisto negativo
  begin
    perform public.mercato_sostituisci(v_por, (select id from public.listone where ruolo = 'P' limit 1), 0, -3);
    v_ok := false;
  exception when sqlstate 'P0013' then v_ok := true; end;
  assert v_ok, 'acquisto negativo rifiutato';
  -- chi non è in rosa non si schiera
  begin
    insert into public.lineup_slots (lineup_id, pos, player_id)
    select l.id, 20, p.id from public.lineups l, public.players p where l.matchday = 7 and p.name = 'Contini';
    v_ok := false;
  exception when sqlstate 'P0004' then v_ok := true; end;
  assert v_ok, 'chi è fuori rosa non si può schierare';
  raise notice 'ok  errori: ruolo diverso, crediti insufficienti, già fuori rosa, acquisto negativo, schierare chi è fuori rosa';
end $$;

-- un giocatore non può fare operazioni
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$
declare v_ok boolean;
begin
  begin
    perform public.mercato_sostituisci((select id from public.players where name = 'Bleve'), (select id from public.listone where ruolo = 'P' limit 1), 0, 1);
    v_ok := false;
  exception when sqlstate 'P0005' then v_ok := true; end;
  assert v_ok, 'solo l''amministratore';
  assert (select count(*) from public.market_ops) = 1, 'tutti vedono le operazioni';
  raise notice 'ok  un giocatore vede le operazioni ma non può farne';
end $$;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- 3) una seconda operazione (Sebi, un D con rimborso) e l'annullamento
select public.mercato_sostituisci(
  (select p.id from public.players p join public.teams t on t.id = p.team_id where t.name = 'Sebi' and p.role = 'D' and p.slot is not null order by p.slot limit 1),
  (select id from public.listone where ruolo = 'D' and origine = 'file' order by id limit 1), -2, 3) ->> 'id' as op2 \gset
do $$
declare v_ok boolean; v_op2 bigint := (select max(id) from public.market_ops);
  v_sebi uuid := (select id from public.teams where name = 'Sebi'); v_o public.market_ops; v_cred int;
begin
  select * into v_o from public.market_ops where id = v_op2;
  v_cred := (select crediti from public.mercato_crediti() where team_id = v_sebi);
  assert v_cred = v_o.crediti_prima - 1, 'rimborso di 2 e acquisto di 3: un credito in meno';
  -- la prima non si annulla: non è l'ultima
  begin
    perform public.mercato_annulla((select min(id) from public.market_ops));
    v_ok := false;
  exception when sqlstate 'P0015' then v_ok := true; end;
  assert v_ok, 'si annulla solo l''ultima';
  perform public.mercato_annulla(v_op2);
  assert exists (select 1 from public.players where id = v_o.esce_id and slot = v_o.slot), 'chi era uscito torna al suo posto';
  assert not exists (select 1 from public.players where id = v_o.entra_id), 'chi era entrato (mai schierato) sparisce';
  assert exists (select 1 from public.listone where nome = v_o.entra_nome), 'torna fra gli svincolati';
  assert not exists (select 1 from public.listone where nome = v_o.esce_nome), 'chi era uscito non è più svincolato';
  assert (select crediti from public.mercato_crediti() where team_id = v_sebi) = v_o.crediti_prima, 'crediti come prima';
  assert (select nome from public.roster_costs where team_id = v_sebi and slot = v_o.slot) = v_o.esce_nome, 'costo in rosa come prima';
  raise notice 'ok  annullamento: solo l''ultima, rosa, svincolati, crediti e costi come prima';
end $$;

-- 4) il file della settimana dopo NON ha ancora l'operazione: segnalata, crediti giusti, Contini resta svincolato
select public.import_round(:'payload'::jsonb) is not null as ricaricata;
select public.mercato_dal_file(3::smallint, (:'payload'::jsonb) -> 'rose', (:'payload'::jsonb) -> 'listone') as esito \gset
\echo :esito
do $$
declare v_val uuid := (select id from public.teams where name = 'Valerio');
begin
  assert (select riportata_at from public.market_ops where id = (select min(id) from public.market_ops)) is null, 'non ancora riportata';
  assert (select crediti from public.mercato_crediti() where team_id = v_val) = 68, 'crediti: 73 del file meno i 5 non ancora riportati';
  assert exists (select 1 from public.listone where nome = 'Contini'), 'Contini resta svincolato anche se il file non lo sa';
  raise notice 'ok  file non aggiornato: operazione in sospeso, crediti 68, Contini svincolato';
end $$;

-- 5) il file aggiornato (Bleve al posto 3, 68 crediti, Contini nel LISTONE): operazione recepita
select public.import_round(:'payload2'::jsonb) is not null as caricata;
select public.mercato_dal_file(3::smallint, (:'payload2'::jsonb) -> 'rose', (:'payload2'::jsonb) -> 'listone') ->> 'riportate' as riportate;
do $$
declare v_val uuid := (select id from public.teams where name = 'Valerio'); v_ok boolean;
begin
  assert (select riportata_round from public.market_ops where id = (select min(id) from public.market_ops)) = 3, 'riportata con la giornata 3';
  assert (select crediti from public.mercato_crediti() where team_id = v_val) = 68, 'crediti: quelli del file, senza contarla due volte';
  assert (select count(*) from public.listone where nome = 'Contini') = 1, 'Contini una volta sola fra gli svincolati';
  begin
    perform public.mercato_annulla((select min(id) from public.market_ops));
    v_ok := false;
  exception when sqlstate 'P0015' then v_ok := true; end;
  assert v_ok, 'un''operazione già nel file non si annulla';
  raise notice 'ok  file aggiornato: operazione riportata, crediti 68 contati una volta, non più annullabile';
end $$;

-- 6) "Aggiorna le rose da un .xls" non cancella nessuno e riprende chi torna
select public.import_players('Valerio', (select jsonb_agg(case when (e ->> 'slot')::int = 3
         then jsonb_build_object('slot', 3, 'role', 'P', 'name', 'Contini') else e end)
       from jsonb_array_elements((:'rose'::jsonb) -> 'Valerio') e)) as rose_valerio;
do $$
declare v_val uuid := (select id from public.teams where name = 'Valerio');
begin
  assert (select count(*) from public.players where team_id = v_val and name = 'Contini') = 1, 'Contini ripreso, non duplicato';
  assert (select slot from public.players where team_id = v_val and name = 'Contini') = 3, 'Contini di nuovo al posto 3';
  assert (select slot from public.players where team_id = v_val and name = 'Bleve') is null, 'Bleve fuori rosa, non cancellato';
  assert exists (select 1 from public.lineup_slots s join public.lineups l on l.id = s.lineup_id
                 join public.players p on p.id = s.player_id where l.matchday = 5 and p.name = 'Contini'), 'storico intatto';
  raise notice 'ok  aggiorna le rose: nessuno cancellato, chi torna riprende il suo record';
end $$;

-- si può rieseguire 11_mercato.sql senza perdere niente
\ir ../11_mercato.sql
do $$ begin
  assert (select count(*) from public.market_ops) = 2, 'operazioni ancora tutte lì';
  raise notice 'ok  11_mercato.sql rieseguito senza perdere dati';
end $$;
