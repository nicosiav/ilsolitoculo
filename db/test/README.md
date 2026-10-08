# Provare le regole su un PostgreSQL qualsiasi

Serve a controllare, senza toccare il progetto Supabase, che le regole del
database facciano quello che devono: giornate ricavate dal calendario, blocco
partita per partita, log delle modifiche.

```bash
initdb -D /var/tmp/pg/data -U postgres
pg_ctl -D /var/tmp/pg/data -o "-k /var/tmp/pg -p 5433" start
createdb -h /var/tmp/pg -p 5433 -U postgres lega

for f in db/test/00_finto_supabase.sql db/01_schema.sql db/02_policies.sql \
         db/04_functions.sql db/05_admin.sql db/06_calendario.sql db/08_stagione.sql; do
  psql -h /var/tmp/pg -p 5433 -U postgres -d lega -v ON_ERROR_STOP=1 -f "$f"
done
psql -h /var/tmp/pg -p 5433 -U postgres -d lega -f db/test/01_prova_regole.sql
```

`02_prova_giornata.sql` prova il caricamento del file di giornata: in testa al
file c'è il comando che genera il payload dal `.xls`.

`03_prova_mercato.sql` prova il mercato (`11_mercato.sql`) con il file di
giornata e il modello veri: in testa al file c'è il comando che prepara i tre
file JSON, poi `psql ... -v dir=CARTELLA -f db/test/03_prova_mercato.sql`. Ogni
controllo è un `ASSERT`: operazione (chi esce resta nello storico ed esce dalle
formazioni da giocare, chi entra prende il posto, crediti, costi), errori (ruolo
diverso, crediti insufficienti, giocatore già fuori rosa, solo l'amministratore),
posto vuoto segnato e tolto al nuovo salvataggio, annullamento (con il giocatore rimesso nella formazione), file di giornata senza e con l'operazione (crediti contati una volta
sola), "Aggiorna le rose" che non cancella nessuno, script rieseguibile.

`00_finto_supabase.sql` rifà le poche cose che su Supabase ci sono già
(`auth.users`, `auth.uid()`, i ruoli, lo storage). `01_prova_regole.sql` crea
due squadre, importa tre partite (una già giocata) e verifica che:

- le giornate nascano dalle partite, con la corrente scelta da sola;
- chi ha già giocato non si possa schierare né spostare (errore `P0007`);
- uno scambio fra giocatori non ancora scesi in campo passi;
- il log registri entrati, usciti, spostati e cambio modulo;
- a partite finite la giornata corrente passi alla successiva.

Con `02_prova_giornata.sql` si verifica che dal file di giornata escano giornate,
partite, voti, classifiche e statistiche per giocatore.

## Lo script degli account

`prova_crea_account.py` prova `db/crea_account.py` contro un finto Supabase
(Admin API e tabelle `teams`/`profiles`) che gira in locale, senza rete e senza
chiavi vere:

```bash
python3 db/test/prova_crea_account.py
```

Controlla la prova a vuoto, gli account nuovi (confermati, con password
provvisoria), il collegamento a squadra e ruolo, gli account già esistenti
lasciati con la loro password, `--nuova-password`, la password uguale per tutti
(`--password`), la chiave (incollata quando la chiede, `sb_secret_` o service_role; anon e publishable rifiutate), i nomi di squadra scritti in
modo diverso, gli errori chiari e il file dei messaggi.
