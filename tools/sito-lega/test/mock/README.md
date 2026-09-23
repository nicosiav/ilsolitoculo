# Prove del sito con un finto Supabase

`server.js` costruisce le tabelle della stagione **dal file di giornata vero**,
con le stesse regole di `import_round()`: così le prove girano sugli stessi
numeri che vedrà la lega, senza toccare il progetto Supabase.

```bash
cd tools/sito-lega/test/mock
python3 ../../build.py                                   # aggiorna docs/index.html
XLS=/percorso/"03 Campionato - Terza Giornata.xls" node server.js &
# il sito va servito da una cartella che contenga ilsolitoculo/ -> docs/
XLS=/percorso/giornata.xls python3 test_sito.py
```

Gli scenari: home, tutte le sezioni, tabellino di una partita, tutte le
classifiche, e l'amministratore che carica la giornata (con le differenze fra
la formazione salvata in Schiera e quella del file).

| Variabile | Cosa simula |
|---|---|
| `XLS` | il file di giornata da cui nascono i dati |
| `ADMIN` | l'account è amministratore |
| `DIFF` | il database segnala una formazione diversa da quella salvata |
