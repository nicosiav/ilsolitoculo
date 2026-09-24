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
classifiche, l'amministratore che carica la giornata (con le differenze fra
la formazione salvata in Schiera e quella del file), il database della stagione
mancante, e la navigazione (barra in basso con Schiera al centro, pannello
Altro, riquadro verde con il conto alla rovescia).

Per tutto quello che riguarda Schiera (profilo con la squadra, rosa, giornata di
Serie A, partite, formazioni, salvataggio) `server.js` passa la mano al finto
Supabase di Schiera (`tools/schiera-formazione/test/mock/server.js`), che legge
le rose da `/tmp/rose.json` e il modello per l'export da `FORMAZIONI`.

| Variabile | Cosa simula |
|---|---|
| `XLS` | il file di giornata da cui nascono i dati |
| `ADMIN` | l'account è amministratore |
| `DIFF` | il database segnala una formazione diversa da quella salvata |
| `FORMAZIONI` | il file Formazioni.xls (modello per l'export di Schiera) |
| `MD` | la giornata corrente di Serie A per Schiera (7 se non indicata) |
| `PRELOAD`, `LOCKED`, `CLOSED`… | le situazioni di Schiera (vedi le sue prove) |

## Schermate per la guida

`screenshots.py` rifà le schermate usate nella guida dell'amministratore (menu,
anteprima del caricamento, esito, differenze, menu Opzioni di Schiera): stesso
finto Supabase, telefono simulato, tema chiaro.

```bash
XLS=/percorso/"03 Campionato - Terza Giornata.xls" python3 screenshots.py
```

Le immagini finiscono in `schermate/`. Vanno rifatte quando l'interfaccia cambia.
