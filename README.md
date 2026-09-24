# Il Solito Culo — fantacalcio

Piattaforma su misura per gestire la lega: rose dei partecipanti (numero flessibile), formazioni di ogni giornata, campionato e coppe, sessioni di mercato, calcolo delle giornate.

## Strumenti disponibili

| Strumento | Link | Descrizione |
|---|---|---|
| Il sito della lega | https://nicosiav.github.io/ilsolitoculo/ | Tutto in un posto, installabile come app: **Schiera** (la formazione della giornata, con il conto alla rovescia al primo fischio), rose, calendario e risultati, classifiche, statistiche, coppe, playoff, albo d'oro e premi. L'amministratore carica ogni settimana il `.xls` di giornata e il sito si aggiorna da solo. [Dettagli](tools/sito-lega/README.md) |
| Schiera Formazione | https://nicosiav.github.io/ilsolitoculo/#/schiera | La sezione del sito per schierare: la formazione va nel database della lega (con log delle modifiche), giornate dal calendario di Serie A, blocco partita per partita, formazioni di tutti consultabili, export `.xls` su richiesta. Il vecchio indirizzo `…/schiera/` porta qui. [Dettagli](tools/schiera-formazione/README.md) |

## Struttura della repo

```
db/                      database della lega su Supabase: schema, permessi, rose iniziali, calendario
supabase/functions/      funzioni sul server (calendario di Serie A da football-data.org)
docs/                    sito pubblicato con GitHub Pages (branch main, cartella /docs)
  index.html             il sito della lega, con Schiera dentro (generato da tools/sito-lega)
  manifest.webmanifest, sw.js, icons/   il sito come app da installare
  schiera/               il vecchio indirizzo di Schiera: porta al sito
tools/
  sito-lega/             sorgenti, build e prove del sito
  schiera-formazione/    sorgenti di Schiera (montata dentro il sito), versione offline, prove
```

## Dove stanno i dati

Le rose, le formazioni di ogni giornata e il log delle modifiche vivono in un database Postgres su Supabase, con un account per partecipante e permessi applicati dal database stesso: [istruzioni in `db/`](db/README.md). Il calendario della Serie A arriva da football-data.org tramite una funzione sul server ([`supabase/functions/`](supabase/functions/README.md)): da lì nascono le giornate e il blocco partita per partita. Il file `.xls` di giornata resta il motore dei calcoli: l'amministratore lo carica dal sito e da lì escono risultati, voti, classifiche e statistiche. L'export `.xls` della formazione resta disponibile nella sezione Schiera.

## Pubblicazione

GitHub Pages pubblica la cartella `docs/` del branch `main`: ogni push su `main` aggiorna il sito in un paio di minuti.
Dopo aver modificato i sorgenti di uno strumento, rigenera la sua cartella in `docs/` (vedi il README dello strumento) e fai commit di entrambi.
