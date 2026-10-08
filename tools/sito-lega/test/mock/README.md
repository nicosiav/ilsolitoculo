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

Gli scenari: home, tutte le sezioni e le loro schede (e i vecchi indirizzi che
portano alle nuove), tabellino di una partita, tutte le classifiche,
l'amministratore che carica la giornata (con le differenze fra la formazione
salvata in Schiera e quella del file), il database della stagione mancante, la
navigazione (barra in basso con Schiera al centro, pannello Altro con Squadre e
Lega, riquadro verde con il conto alla rovescia, barra in alto sul computer), le
formazioni della giornata (selettore delle squadre in cima, salvate e giocate,
le partite che si toccano con le due formazioni affiancate e allineate riga per
riga, a 360, 390 e 1100 px), il file unico con tutte le formazioni (riletto con il motore: foglio
pieno per chi ha salvato, vuoto per gli altri), le medie di Fantacalcio.it
caricate dall'amministratore e mostrate in Rosa, le statistiche (grafici, tabelle
dei numeri, tocco sulle colonne, niente scorrimento di lato), il mercato
(svincolati con filtri e ordinamento; l'amministratore prende Bleve al posto di
Contini: crediti, rosa, formazione salvata ripulita, modello .xls riletto con il
motore; elenco da riportare, annullamento con il modello che torna com'era; file
di giornata che non contiene ancora l'operazione), il mercato visto da chi gioca e
il database senza `11_mercato.sql`. `SOLO=13,14` fa girare solo quegli scenari.

Prima di lanciarle serve l'Excel finto di Fantacalcio.it:

```bash
python3 fantacalcio_finto.py /tmp/fc_stats.xlsx /tmp/rose.json --listone /tmp/listone.json
```

(`/tmp/listone.json` è il LISTONE del file di giornata, `[{ruolo, nome, squadra}]`:
`node -e "const G=require('../../src/giornata.js'),fs=require('fs');fs.writeFileSync('/tmp/listone.json',JSON.stringify(G.parse(new Uint8Array(fs.readFileSync(process.argv[1])),'x').listone))" giornata.xls`)

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
| `FC` | un Excel di Fantacalcio.it già caricato (es. `/tmp/fc_stats.xlsx`) |
| `NOFC` | il database senza le tabelle di `db/10_fantacalcio.sql` |
| `NOMERCATO` | il database senza `db/11_mercato.sql` (svincolati e operazioni) |
| `FORMAZIONI` | il modello .xls delle formazioni; dopo un'operazione di mercato il sito lo ricarica aggiornato (copia in `/tmp/modello_mercato.xls`) |
| `NOSTORICO` | solo la giornata del file (di solito le giornate prima hanno voti e formazioni inventati, sempre uguali, per le statistiche) |

## Schermate per la guida

`screenshots.py` rifà le schermate usate nella guida dell'amministratore (menu,
anteprima del caricamento, esito, differenze, menu Opzioni di Schiera): stesso
finto Supabase, telefono simulato, tema chiaro.

```bash
XLS=/percorso/"03 Campionato - Terza Giornata.xls" python3 screenshots.py
```

Le immagini finiscono in `schermate/`. Vanno rifatte quando l'interfaccia cambia.
