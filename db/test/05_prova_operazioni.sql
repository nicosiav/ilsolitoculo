-- Prova delle operazioni di mercato composte (13_mercato_operazioni.sql) su un PostgreSQL
-- qualsiasi, con il file di giornata e il modello veri: gli stessi tre file JSON di
-- 03_prova_mercato.sql (vedi lì il comando che li prepara), poi, su un database con
-- 00_finto_supabase.sql e db/01..13 (senza 03, 07, 09):
--   psql ... -v dir="$DIR" -f db/test/05_prova_operazioni.sql
-- Ogni controllo è un ASSERT o un rifiuto atteso con il suo codice.

\set ON_ERROR_STOP on
set client_min_messages = notice;
\set payload `cat :dir/payload.json`
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

select (public.import_round(:'payload'::jsonb)) ->> 'giornata' as giornata_caricata;
select public.import_players(k, v) from jsonb_each(:'rose'::jsonb) as x(k, v);
select public.mercato_dal_file(3::smallint, (:'payload'::jsonb) -> 'rose', (:'payload'::jsonb) -> 'listone') ->> 'listone' as svincolati;

-- una giornata da giocare: Valerio ha in formazione Woltemade (11) e Holm (13)
insert into public.matchdays (id, label, deadline, is_current) values (7, 'Giornata 7', now() + interval '3 days', true)
on conflict (id) do update set deadline = excluded.deadline;
insert into public.lineups (team_id, matchday, module) select id, 7, '4-3-3' from public.teams where name = 'Valerio';
insert into public.lineup_slots (lineup_id, pos, player_id)
select l.id, x.pos, p.id from public.lineups l join public.teams t on t.id = l.team_id
join (values (11, 'Woltemade'), (13, 'Holm')) x(pos, nome) on true
join public.players p on p.team_id = t.id and p.name = x.nome
where t.name = 'Valerio' and l.matchday = 7;

-- strumenti --------------------------------------------------------------------------
create or replace function pg_temp.tid(n text) returns uuid language sql as $$ select id from public.teams where name = n $$;
create or replace function pg_temp.pid(t text, n text) returns uuid language sql as
$$ select p.id from public.players p where p.team_id = pg_temp.tid(t) and p.name = n and p.slot is not null $$;
create or replace function pg_temp.lid(n text) returns int language sql as $$ select id from public.listone where nome = n order by id desc limit 1 $$;
create or replace function pg_temp.cr(t text) returns int language sql as $$ select crediti from public.mercato_crediti() where team_id = pg_temp.tid(t) $$;
create or replace function pg_temp.slot(t text, n text) returns smallint language sql as
$$ select slot from public.players where team_id = pg_temp.tid(t) and name = n and slot is not null $$;
create or replace function pg_temp.conta(t text, r text default null) returns int language sql as
$$ select count(*)::int from public.players where team_id = pg_temp.tid(t) and slot is not null and (r is null or role = r) $$;
create or replace function pg_temp.ok(b boolean, msg text) returns text language plpgsql as $$
begin
  if b is not true then raise exception 'controllo fallito: %', msg; end if;
  raise notice 'ok  %', msg;
  return 'ok';
end $$;
create or replace function pg_temp.rifiuta(q jsonb, codice text, testo text default null) returns text language plpgsql as $$
begin
  begin
    perform public.mercato_operazione(q);
  exception when others or assert_failure then
    if sqlstate <> codice then raise exception 'atteso % ma è arrivato % (%)', codice, sqlstate, sqlerrm; end if;
    if testo is not null and sqlerrm not like testo then raise exception 'messaggio inatteso: %', sqlerrm; end if;
    return sqlerrm;
  end;
  raise exception 'doveva essere rifiutata (%): %', codice, q;
end $$;

do $$ begin
  assert pg_temp.conta('Valerio') = 29 and pg_temp.cr('Valerio') = 73, 'partenza: Valerio 29 giocatori, 73 crediti';
  assert pg_temp.conta('Massimo') = 28 and pg_temp.cr('Massimo') = 62, 'partenza: Massimo 28 giocatori, 62 crediti';
  assert (select count(*) from public.rosa_limiti) = 5, 'limiti: totale e quattro ruoli';
  assert public.rosa_fuori_limiti(jsonb_build_array(jsonb_build_object('team_id', pg_temp.tid('Valerio'), 'ruolo', 'D', 'd', 1)))
         = 'Valerio: giocatori 30 (massimo 29)', 'limite totale';
  assert public.rosa_fuori_limiti(jsonb_build_array(jsonb_build_object('team_id', pg_temp.tid('Valerio'), 'ruolo', 'D', 'd', -1))) is null,
         'con un difensore in meno Valerio è a posto';
  raise notice 'ok  partenza e limiti';
end $$;

-- 1) quello che non si può fare ---------------------------------------------------------
select pg_temp.rifiuta(jsonb_build_object('acquisti', jsonb_build_array(jsonb_build_object(
  'listone_id', pg_temp.lid('Abankwah'), 'team_id', pg_temp.tid('Valerio'), 'costo', 1))),
  'P0017', 'Limiti della rosa: Valerio: giocatori 30 (massimo 29)') as rosa_piena;
select pg_temp.rifiuta(jsonb_build_object('svincoli', jsonb_build_array(jsonb_build_object(
  'player_id', pg_temp.pid('Valerio', 'Contini'), 'costo', 0))),
  'P0017', '%Valerio: portieri 2 (minimo 3)') as troppo_pochi_portieri;
select pg_temp.rifiuta(jsonb_build_object('svincoli', jsonb_build_array(
  jsonb_build_object('player_id', pg_temp.pid('Valerio', 'Holm')), jsonb_build_object('player_id', pg_temp.pid('Valerio', 'Holm')))),
  'P0016', 'Nella stessa operazione due volte: Holm') as due_volte;
select pg_temp.rifiuta(jsonb_build_object('cessioni', jsonb_build_array(jsonb_build_object(
  'player_id', pg_temp.pid('Valerio', 'Holm'), 'team_id', pg_temp.tid('Valerio')))), 'P0016') as cessione_a_se_stessi;
select pg_temp.rifiuta(jsonb_build_object(
  'svincoli', jsonb_build_array(jsonb_build_object('player_id', pg_temp.pid('Valerio', 'Holm'))),
  'acquisti', jsonb_build_array(jsonb_build_object('listone_id', pg_temp.lid('Abankwah'), 'team_id', pg_temp.tid('Valerio'), 'costo', -1))),
  'P0013') as acquisto_negativo;
select pg_temp.rifiuta(jsonb_build_object(
  'svincoli', jsonb_build_array(jsonb_build_object('player_id', pg_temp.pid('MarcoI', 'Lulli'))),
  'acquisti', jsonb_build_array(jsonb_build_object('listone_id', pg_temp.lid('Akpoguma'), 'team_id', pg_temp.tid('MarcoI'), 'costo', 60))),
  'P0014', 'Crediti insufficienti: MarcoI ne ha 56, l''operazione gliene toglie 60') as crediti_insufficienti;
select pg_temp.rifiuta(jsonb_build_object('crediti', jsonb_build_array(jsonb_build_object(
  'da', pg_temp.tid('Sebi'), 'a', pg_temp.tid('Sebi'), 'crediti', 3))), 'P0016') as crediti_a_se_stessi;
select pg_temp.rifiuta('{}'::jsonb, 'P0016', 'L''operazione è vuota') as vuota;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.rifiuta(jsonb_build_object('crediti', jsonb_build_array(jsonb_build_object(
  'da', pg_temp.tid('Sebi'), 'a', pg_temp.tid('Valerio'), 'crediti', 3))), 'P0005') as solo_admin;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- 2) A: svincolo senza acquisto, con un rimborso ---------------------------------------
select public.mercato_operazione(jsonb_build_object('note', 'A',
  'svincoli', jsonb_build_array(jsonb_build_object('player_id', pg_temp.pid('Valerio', 'Holm'), 'costo', -1)))) ->> 'id' as op_a \gset
do $$ begin
  assert pg_temp.conta('Valerio') = 28 and pg_temp.conta('Valerio', 'D') = 8, 'A: Valerio 28 giocatori, 8 difensori';
  assert pg_temp.cr('Valerio') = 74, 'A: rimborso di 1 credito (73 → 74)';
  assert exists (select 1 from public.listone where nome = 'Holm' and origine = 'svincolo'), 'A: Holm fra gli svincolati';
  assert exists (select 1 from public.lineup_vuoti where nome = 'Holm' and motivo = 'svincolato' and pos = 13), 'A: Holm tolto dalla formazione';
  raise notice 'ok  A: svincolo senza acquisto (rimborso 1)';
end $$;

-- 3) B: svincolo di un centrocampista e acquisto di un difensore ------------------------
select public.mercato_operazione(jsonb_build_object('note', 'B',
  'svincoli', jsonb_build_array(jsonb_build_object('player_id', pg_temp.pid('Valerio', 'Bernardeschi'), 'costo', 0)),
  'acquisti', jsonb_build_array(jsonb_build_object('listone_id', pg_temp.lid('Abankwah'), 'team_id', pg_temp.tid('Valerio'), 'costo', 4))))
  ->> 'id' as op_b \gset
do $$ begin
  assert pg_temp.slot('Valerio', 'Abankwah') = 13, 'B: Abankwah nella prima riga libera dei difensori (13)';
  assert pg_temp.conta('Valerio', 'C') = 9 and pg_temp.conta('Valerio', 'D') = 9 and pg_temp.conta('Valerio') = 28, 'B: C 9, D 9, totale 28';
  assert pg_temp.cr('Valerio') = 70, 'B: 74 → 70';
  assert (select costo from public.roster_costs where team_id = pg_temp.tid('Valerio') and slot = 13) = 4, 'B: costo in rosa 4';
  assert (select anno || '/' || valore from public.roster_costs where team_id = pg_temp.tid('Valerio') and slot = 13) = '1/1.0',
         'B: Abankwah al 1° anno di contratto, penale 4/3 = 1';
  assert not exists (select 1 from public.roster_costs where team_id = pg_temp.tid('Valerio') and slot = 24), 'B: riga di Bernardeschi vuota';
  raise notice 'ok  B: acquisto in un ruolo diverso da chi esce';
end $$;

-- 4) C: scambio fra ruoli diversi, con un costo cambiato e 5 crediti --------------------
select (select costo from public.roster_costs where team_id = pg_temp.tid('Valerio') and slot = 27) as costo_woltemade \gset
select public.mercato_operazione(jsonb_build_object('note', 'C',
  'cessioni', jsonb_build_array(
     jsonb_build_object('player_id', pg_temp.pid('Valerio', 'Woltemade'), 'team_id', pg_temp.tid('Massimo')),
     jsonb_build_object('player_id', pg_temp.pid('Massimo', 'Birindelli'), 'team_id', pg_temp.tid('Valerio'), 'costo', 2)),
  'crediti', jsonb_build_array(jsonb_build_object('da', pg_temp.tid('Valerio'), 'a', pg_temp.tid('Massimo'), 'crediti', 5))))
  ->> 'id' as op_c \gset
do $$ begin
  assert pg_temp.slot('Valerio', 'Birindelli') = 14 and pg_temp.slot('Massimo', 'Woltemade') = 31, 'C: righe libere 14 e 31';
  assert pg_temp.conta('Valerio', 'D') = 10 and pg_temp.conta('Valerio', 'A') = 6, 'C: Valerio D 10, A 6';
  assert pg_temp.conta('Massimo', 'D') = 8 and pg_temp.conta('Massimo', 'A') = 7, 'C: Massimo D 8, A 7';
  assert pg_temp.cr('Valerio') = 65 and pg_temp.cr('Massimo') = 67, 'C: 5 crediti da Valerio a Massimo';
  assert (select costo from public.roster_costs where team_id = pg_temp.tid('Valerio') and slot = 14) = 2, 'C: costo di Birindelli cambiato a 2';
  assert (select anno || '/' || valore from public.roster_costs where team_id = pg_temp.tid('Valerio') and slot = 14) = '1/1.0',
         'C: Birindelli tiene il 1° anno, penale ricalcolata sul costo nuovo (2/3 = 1)';
  assert (select anno || '/' || valore from public.roster_costs where team_id = pg_temp.tid('Massimo') and slot = 31) = '1/14.0',
         'C: Woltemade tiene il 1° anno e la penale (43/3 = 14)';
  assert exists (select 1 from public.lineup_vuoti where nome = 'Woltemade' and motivo = 'ceduto'), 'C: Woltemade tolto dalla formazione (ceduto)';
  assert exists (select 1 from public.players where name = 'Woltemade' and team_id = pg_temp.tid('Valerio') and slot is null),
         'C: il vecchio record di Woltemade resta nello storico di Valerio';
  raise notice 'ok  C: scambio difensore-attaccante con 5 crediti';
end $$;
select pg_temp.ok((select costo from public.roster_costs where team_id = pg_temp.tid('Massimo') and slot = 31) = :'costo_woltemade'::numeric,
  'C: Woltemade porta il suo costo (' || :'costo_woltemade' || ')');

-- 5) D: cessione senza contropartita; E: soli crediti -----------------------------------
select public.mercato_operazione(jsonb_build_object('cessioni', jsonb_build_array(
  jsonb_build_object('player_id', pg_temp.pid('Sebi', 'Rodriguez Je.'), 'team_id', pg_temp.tid('Massimo'))))) ->> 'id' as op_d \gset
select public.mercato_operazione(jsonb_build_object('crediti', jsonb_build_array(
  jsonb_build_object('da', pg_temp.tid('Giuseppe'), 'a', pg_temp.tid('Sebi'), 'crediti', 10)))) ->> 'id' as op_e \gset
do $$ begin
  assert pg_temp.slot('Massimo', 'Rodriguez Je.') = 24 and pg_temp.conta('Massimo') = 29 and pg_temp.conta('Sebi') = 28, 'D: Massimo 29, Sebi 28';
  assert pg_temp.cr('Giuseppe') = 110 and pg_temp.cr('Sebi') = 96 and pg_temp.cr('Massimo') = 67, 'E: 10 crediti da Giuseppe a Sebi';
  raise notice 'ok  D: cessione senza contropartita · E: soli crediti';
end $$;
-- ora Massimo è a 29: non può ricevere nessuno senza dare via qualcuno
select pg_temp.rifiuta(jsonb_build_object('cessioni', jsonb_build_array(jsonb_build_object(
  'player_id', pg_temp.pid('Sebi', 'Lucca'), 'team_id', pg_temp.tid('Massimo')))),
  'P0017', '%Massimo: giocatori 30 (massimo 29), attaccanti 8 (massimo 7)') as massimo_pieno;

-- chi è già uscito non si svincola di nuovo; chi è già stato preso non si riprende
select pg_temp.rifiuta(jsonb_build_object('svincoli', jsonb_build_array(jsonb_build_object(
  'player_id', (select id from public.players where name = 'Holm' and slot is null limit 1)))),
  'P0010', 'Un giocatore da svincolare non è più in rosa') as gia_fuori;
select pg_temp.rifiuta(jsonb_build_object('acquisti', jsonb_build_array(jsonb_build_object(
  'listone_id', 999999, 'team_id', pg_temp.tid('Sebi'), 'costo', 1))),
  'P0011', 'Un giocatore da prendere non è più fra gli svincolati') as gia_preso;

-- 6) annullare: solo l'ultima, e torna tutto com'era ------------------------------------
do $$ begin
  begin
    perform public.mercato_annulla(currval(pg_get_serial_sequence('public.market_ops', 'id')) - 2);
    raise exception 'doveva rifiutare';
  exception when others then
    assert sqlstate = 'P0015', 'solo l''ultima: ' || sqlerrm;
  end;
end $$;
select public.mercato_annulla(:op_e) ->> 'id' as annullata_e;
select public.mercato_annulla(:op_d) ->> 'id' as annullata_d;
select public.mercato_annulla(:op_c) ->> 'rimessi' as rimessi_c;
do $$ begin
  assert pg_temp.cr('Giuseppe') = 120 and pg_temp.cr('Sebi') = 86, 'annullata E: crediti come prima';
  assert pg_temp.slot('Sebi', 'Rodriguez Je.') = 24 and pg_temp.slot('Massimo', 'Rodriguez Je.') is null, 'annullata D: Rodriguez di nuovo a Sebi';
  assert pg_temp.slot('Valerio', 'Woltemade') = 27 and pg_temp.slot('Massimo', 'Birindelli') = 13, 'annullata C: tutti al loro posto';
  assert pg_temp.cr('Valerio') = 70 and pg_temp.cr('Massimo') = 62, 'annullata C: crediti come prima';
  assert (select costo from public.roster_costs where team_id = pg_temp.tid('Massimo') and slot = 13) is not null, 'annullata C: costo di Birindelli rimesso';
  assert exists (select 1 from public.lineup_slots s join public.players p on p.id = s.player_id where p.name = 'Woltemade' and s.pos = 11),
         'annullata C: Woltemade di nuovo nella formazione';
  assert not exists (select 1 from public.lineup_vuoti where nome = 'Woltemade'), 'annullata C: posto non più da rifare';
  raise notice 'ok  annullamenti (crediti, cessione, scambio con la formazione)';
end $$;

-- 7) il file di giornata: le operazioni con giocatori si riconoscono, i crediti no ------
select public.mercato_operazione(jsonb_build_object('note', 'C2',
  'cessioni', jsonb_build_array(
     jsonb_build_object('player_id', pg_temp.pid('Valerio', 'Woltemade'), 'team_id', pg_temp.tid('Massimo')),
     jsonb_build_object('player_id', pg_temp.pid('Massimo', 'Birindelli'), 'team_id', pg_temp.tid('Valerio'), 'costo', 2)),
  'crediti', jsonb_build_array(jsonb_build_object('da', pg_temp.tid('Valerio'), 'a', pg_temp.tid('Massimo'), 'crediti', 5))))
  ->> 'id' as op_c2 \gset
select public.mercato_operazione(jsonb_build_object('crediti', jsonb_build_array(
  jsonb_build_object('da', pg_temp.tid('Giuseppe'), 'a', pg_temp.tid('Sebi'), 'crediti', 10)))) ->> 'id' as op_f \gset
-- il file com'è adesso sul sito (l'amministratore ha riportato tutto nell'Excel)
select public.mercato_dal_file(3::smallint,
  (select jsonb_agg(jsonb_build_object('squadra', t.sheet_name, 'slot', p.slot, 'nome', p.name))
   from public.players p join public.teams t on t.id = p.team_id where p.slot is not null), '[]'::jsonb) as dal_file \gset
select pg_temp.ok((:'dal_file'::jsonb ->> 'riportate')::int = 3, 'file: riportate A, B e C2');
select pg_temp.ok((:'dal_file'::jsonb ->> 'in_sospeso')::int = 1, 'file: resta quella dei soli crediti');
select pg_temp.ok(jsonb_array_length(:'dal_file'::jsonb -> 'differenze') = 0, 'file: nessuna differenza fra file e sito');
select public.mercato_riportata(:op_f);
do $$ begin
  assert not exists (select 1 from public.market_ops where annullata_at is null and riportata_at is null), 'segnata a mano: niente in sospeso';
  raise notice 'ok  file di giornata: riconosciute 3, quella dei crediti segnata a mano';
end $$;
do $$ begin
  begin
    perform public.mercato_annulla(currval(pg_get_serial_sequence('public.market_ops', 'id')));
    raise exception 'doveva rifiutare';
  exception when others then
    assert sqlstate = 'P0015' and sqlerrm like 'È già nel file%', 'riportata: non si annulla (' || sqlerrm || ')';
  end;
end $$;

-- 8) un file vecchio: chi è uscito è ancora lì, l'operazione resta da riportare --------
select public.mercato_operazione(jsonb_build_object(
  'svincoli', jsonb_build_array(jsonb_build_object('player_id', pg_temp.pid('Sebi', 'Lucca'), 'costo', 0)))) ->> 'id' as op_g \gset
select public.mercato_dal_file(3::smallint, (:'payload'::jsonb) -> 'rose', '[]'::jsonb) ->> 'riportate' as riportate_file_vecchio \gset
select pg_temp.ok(:'riportate_file_vecchio'::int = 0, 'file vecchio: niente riportato');
select pg_temp.ok(exists (select 1 from public.listone where nome = 'Lucca'), 'file vecchio: Lucca resta fra gli svincolati');

-- 9) anni di contratto e penale di svincolo -------------------------------------------
do $$ begin
  assert (select count(*) from public.roster_costs where anno is not null) >= 200, 'anni: letti dal file di giornata';
  assert (select anno from public.roster_costs where team_id = pg_temp.tid('MarcoII') and nome = 'Malen') = 2, 'anni: Malen al 2° anno';
  assert public.penale_svincolo(63, 2) = 16 and public.penale_svincolo(2, 2) = 1 and public.penale_svincolo(1, 1) = 0
     and public.penale_svincolo(35, 3) = 7 and public.penale_svincolo(10, 9) is null, 'penale: costo/3, /4, /5 arrotondato';
  raise notice 'ok  anni di contratto dal file, penale';
end $$;
-- H: uno svincolo senza costo scritto costa la penale (Malen: 63 al 2° anno = 16)
select pg_temp.cr('MarcoII') as cr_m2 \gset
select public.mercato_operazione(jsonb_build_object('svincoli', jsonb_build_array(
  jsonb_build_object('player_id', pg_temp.pid('MarcoII', 'Malen'))))) ->> 'id' as op_h \gset
select pg_temp.ok(pg_temp.cr('MarcoII') = :cr_m2 - 16, 'H: lo svincolo costa la penale (16)');
select pg_temp.ok((select costo || '/' || anno from public.market_moves where op_id = :op_h) = '16.0/2', 'H: movimento con penale e anno');
-- I: Santos A. da Colombrita a Marco II con il costo cambiato (12 → 20, resta al 2° anno:
--    penale 20/4 = 5) e Bayo V. dagli svincolati a Colombrita (1° anno: 7/3 = 2)
select public.mercato_operazione(jsonb_build_object(
  'cessioni', jsonb_build_array(jsonb_build_object('player_id', pg_temp.pid('Colombrita', 'Santos A.'), 'team_id', pg_temp.tid('MarcoII'), 'costo', 20)),
  'acquisti', jsonb_build_array(jsonb_build_object('listone_id', pg_temp.lid('Bayo V.'), 'team_id', pg_temp.tid('Colombrita'), 'costo', 7))))
  ->> 'id' as op_i \gset
do $$ begin
  assert pg_temp.slot('MarcoII', 'Santos A.') = 25, 'I: Santos nella riga lasciata da Malen';
  assert (select costo || '/' || valore || '/' || anno from public.roster_costs where team_id = pg_temp.tid('MarcoII') and slot = 25) = '20.0/5.0/2',
         'I: Santos costo 20, penale 5, 2° anno';
  assert (select costo || '/' || valore || '/' || anno from public.roster_costs
          where team_id = pg_temp.tid('Colombrita') and nome = 'Bayo V.') = '7.0/2.0/1', 'I: Bayo V. costo 7, penale 2, 1° anno';
  raise notice 'ok  H: svincolo con la penale · I: cessione che tiene l''anno, acquisto al 1° anno';
end $$;
-- il file di giornata (che non ha ancora H e I) riscrive le righe: quelle delle operazioni restano
update public.roster_costs set nome = 'Malen', costo = 63, valore = 16, anno = null
where team_id = pg_temp.tid('MarcoII') and slot = 25;
select public.mercato_dal_file(3::smallint, (:'payload'::jsonb) -> 'rose', '[]'::jsonb) ->> 'riportate' as riportate_hi \gset
select pg_temp.ok((select nome || '/' || costo || '/' || valore || '/' || anno from public.roster_costs
                   where team_id = pg_temp.tid('MarcoII') and slot = 25) = 'Santos A./20.0/5.0/2',
                  'file senza l''operazione: la riga di Santos resta quella dell''operazione');
-- annullare I e H rimette costo, penale e anno di prima
select public.mercato_annulla(:op_i) is not null as annullata_i;
select public.mercato_annulla(:op_h) is not null as annullata_h;
do $$ begin
  assert (select costo || '/' || valore || '/' || anno from public.roster_costs where team_id = pg_temp.tid('Colombrita') and slot = 28) = '12.0/3.0/2',
         'annullata I: Santos torna a Colombrita con 12, penale 3, 2° anno';
  assert (select nome || '/' || costo || '/' || valore || '/' || anno from public.roster_costs where team_id = pg_temp.tid('MarcoII') and slot = 25) = 'Malen/63.0/16.0/2',
         'annullata H: Malen torna con 63, penale 16, 2° anno';
  raise notice 'ok  il file non cancella le operazioni da riportare, l''annullamento rimette gli anni';
end $$;

-- 10) le operazioni di prima diventano movimenti (e rieseguire 13 non duplica) ---------
insert into public.market_ops (team_id, slot, ruolo, esce_nome, entra_nome, costo_svincolo, costo_acquisto, crediti_prima, crediti_dopo, annullata_at)
values (pg_temp.tid('Giovanni'), 2, 'P', 'Vecchio Uscito', 'Vecchio Entrato', 1, 3, 87, 83, now());
\ir ../13_mercato_operazioni.sql
\ir ../13_mercato_operazioni.sql
do $$
declare v_id bigint := (select id from public.market_ops where esce_nome = 'Vecchio Uscito');
begin
  assert (select count(*) from public.market_moves where op_id = v_id) = 2, 'vecchia operazione: svincolo + acquisto';
  assert (select string_agg(tipo || ':' || costo, ',' order by n) from public.market_moves where op_id = v_id) = 'svincolo:1.0,acquisto:3.0',
         'vecchia operazione: costi al loro posto';
  assert (select crediti -> 0 ->> 'dopo' from public.market_ops where id = v_id) = '83', 'vecchia operazione: crediti';
  raise notice 'ok  operazioni di prima trasformate, script rieseguibile';
end $$;

select 'tutto ok' as esito;
