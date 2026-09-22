# Il Solito Culo — fantacalcio

Piattaforma su misura per gestire la lega: rose dei partecipanti (numero flessibile), formazioni di ogni giornata, campionato e coppe, sessioni di mercato, calcolo delle giornate.

## Strumenti disponibili

| Strumento | Link | Descrizione |
|---|---|---|
| Schiera Formazione | https://nicosiav.github.io/ilsolitoculo/schiera/ | Schiera la formazione dal telefono sul file `.xls` della lega e salva il file da inviare all'amministratore. [Dettagli](tools/schiera-formazione/README.md) |

Home del sito: https://nicosiav.github.io/ilsolitoculo/

## Struttura della repo

```
docs/                    sito pubblicato con GitHub Pages (branch main, cartella /docs)
  index.html             home della lega
  schiera/               app Schiera Formazione (generata da tools/schiera-formazione)
tools/
  schiera-formazione/    sorgenti, build e test dell'app
```

## Pubblicazione

GitHub Pages pubblica la cartella `docs/` del branch `main`: ogni push su `main` aggiorna il sito in un paio di minuti.
Dopo aver modificato i sorgenti di uno strumento, rigenera la sua cartella in `docs/` (vedi il README dello strumento) e fai commit di entrambi.
