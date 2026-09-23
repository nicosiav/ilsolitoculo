# Provare le regole su un PostgreSQL qualsiasi

Serve a controllare, senza toccare il progetto Supabase, che le regole del
database facciano quello che devono: giornate ricavate dal calendario, blocco
partita per partita, log delle modifiche.

```bash
initdb -D /var/tmp/pg/data -U postgres
pg_ctl -D /var/tmp/pg/data -o "-k /var/tmp/pg -p 5433" start
createdb -h /var/tmp/pg -p 5433 -U postgres lega

for f in db/test/00_finto_supabase.sql db/01_schema.sql db/02_policies.sql \
         db/04_functions.sql db/05_admin.sql db/06_calendario.sql; do
  psql -h /var/tmp/pg -p 5433 -U postgres -d lega -v ON_ERROR_STOP=1 -f "$f"
done
psql -h /var/tmp/pg -p 5433 -U postgres -d lega -f db/test/01_prova_regole.sql
```

`00_finto_supabase.sql` rifà le poche cose che su Supabase ci sono già
(`auth.users`, `auth.uid()`, i ruoli, lo storage). `01_prova_regole.sql` crea
due squadre, importa tre partite (una già giocata) e verifica che:

- le giornate nascano dalle partite, con la corrente scelta da sola;
- chi ha già giocato non si possa schierare né spostare (errore `P0007`);
- uno scambio fra giocatori non ancora scesi in campo passi;
- il log registri entrati, usciti, spostati e cambio modulo;
- a partite finite la giornata corrente passi alla successiva.
