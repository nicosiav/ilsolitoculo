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

`04_prova_scadenze.sql` prova `12_scadenze.sql` (database con 00 e db/01, 02,
04, 05, 06, 08, 10, 11, 12): scadenza ricavata dal calendario (domenica 12.00 nel
weekend, mercoledì 20.00 nei turni infrasettimanali, anche a cavallo del cambio
d'ora), giornata che non si allunga per una rinviata o un recupero lontano,
blocco 30 minuti prima (squadra ignota con la prima partita, rinviata e recupero
liberi), il caso del primo panchinaro bloccato (secondo panchinaro o extra
titolari: no; titolari scambiati fra loro: sì; dopo di lui: libero), il reparto
davanti a un panchinaro bloccato in difesa e in panchina extra, il modulo che non
può cambiare il numero dei titolari del reparto, il titolare bloccato, la
scadenza passata (`P0008`), le funzioni riservate all'amministratore, la modifica
dell'amministratore (senza blocchi, nel log con autore e nota) e i permessi delle
funzioni interne. Ogni controllo è un `ASSERT` o un rifiuto atteso con il suo
codice: se qualcosa non torna lo script si ferma.

`05_prova_operazioni.sql` prova `13_mercato_operazioni.sql` (database con 00 e
db/01..13 senza 03, 07, 09; stessi tre file JSON di 03, `-v dir=CARTELLA`): i
limiti delle rose (totale e reparti, sul risultato e solo per le squadre toccate),
i rifiuti (giocatore non in rosa o due volte, svincolato già preso, costo negativo,
cessione alla propria squadra, crediti fra la stessa squadra, operazione vuota,
crediti sotto zero, limiti), lo svincolo senza acquisto con rimborso, l'acquisto in
un altro ruolo nella riga giusta, lo scambio difensore↔attaccante con crediti (il
costo resta il suo, il ceduto esce dalla formazione salvata con il motivo
«ceduto»), la cessione senza contropartita, i passaggi di crediti, l'annullamento a
ritroso (formazione compresa), il file di giornata che riconosce le operazioni
riportate (non quelle di soli crediti), «È già nel file», gli anni di contratto
(letti dal file, penale costo/3, /4, /5, svincolo che costa la penale, cessione che
tiene l'anno con la penale ricalcolata, acquisto al 1° anno, file che non cancella le
righe delle operazioni da riportare, annullamento che rimette gli anni), le
operazioni fatte con 11 viste come movimenti e lo script rieseguibile. `03_prova_mercato.sql` passa
anche con 13 (alla fine riesegue 11: dopo va rieseguito 13).

`00_finto_supabase.sql` rifà le poche cose che su Supabase ci sono già
(`auth.users`, `auth.uid()`, i ruoli, lo storage). `01_prova_regole.sql` crea
due squadre, importa tre partite (una già giocata) e verifica che:

- le giornate nascano dalle partite, con la corrente scelta da sola;
- chi ha già giocato non si possa schierare né spostare (errore `P0007`);
- uno scambio fra giocatori non ancora bloccati passi;
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
