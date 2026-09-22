# Schiera Formazione

App web per schierare la formazione dal telefono sul file Excel (`.xls`) della lega, senza scrivere a mano i numeri nella colonna D.

**Usala qui:** https://nicosiav.github.io/ilsolitoculo/schiera/

## Come si usa

1. Apri l'app e carica il file `.xls` ricevuto dall'amministratore (la prima volta scegli la tua squadra).
2. Scegli il modulo e tocca i posti sul campo, in panchina e in panchina extra (oppure tocca i giocatori "non schierati" per metterli nel primo posto libero).
3. Tocca **Salva file Excel**: scarichi `formazioni_AAAAMMGG_Squadra.xls`, da inviare all'amministratore.

Il file viene letto e scritto **solo sul telefono**: non viene inviato a nessun server.

### Installarla come app (Android, Chrome)

Apri il link in Chrome → menu ⋮ → **Installa app** (o "Aggiungi a schermata Home"), oppure usa il pulsante "Installa l'app sul telefono" che compare nell'app.
Una volta installata:
- si apre a schermo intero e funziona anche senza connessione;
- compare tra le app di **Condividi**: da WhatsApp/Gmail puoi condividere direttamente il `.xls` con "Schiera".

## Cosa scrive nel file

Replica esattamente la macro `Formazioni` (pulsante "Schiera formazione") del foglio della squadra:

| Dove | Cosa |
|---|---|
| `D1:D31` | numeri di schieramento: 1–11 titolari (1 = portiere), 12–18 riserve, 19–22 panchina extra |
| `H31:I52` | ruolo e nome dei 22 giocatori in ordine di numero (come "incolla valori" della macro) |
| `J31:K52` | colonne F:G degli stessi giocatori (voto/fantavoto, di solito vuote) |
| formule | ricalcola i valori mostrati (es. `I5:I29`, modulo in `I2:K2`) e segna il foglio da ricalcolare all'apertura in Excel |

Tutto il resto del file (macro VBA, pulsante, formati, altri fogli) resta identico byte per byte.

Le riserve sono per ruolo (12 P, 13–14 D, 15–16 C, 17–18 A), come previsto dalle formule "riserva d'ufficio" del foglio; dal menu **Opzioni** si possono mettere in ordine libero.
Se mancano numeri, l'app avvisa: come con la macro, l'ordine "scala" e i posti vuoti vengono presi dai giocatori successivi.

## Sviluppo

- `src/engine.js` — lettura/scrittura `.xls` (BIFF8 in contenitore CFB) senza librerie esterne, con valutatore delle formule del foglio.
- `src/ui.html`, `src/ui.css`, `src/ui.js` — interfaccia.
- `src/manifest.webmanifest`, `src/sw.js` — app installabile, funzionamento offline, ricezione file condivisi.
- `icons/make_icons.py` — genera le icone in `docs/schiera/icons/`.

```bash
python3 tools/schiera-formazione/build.py          # aggiorna docs/schiera/ (pubblicato da GitHub Pages)
python3 tools/schiera-formazione/build.py --all    # anche la versione offline a file singolo in dist/
node tools/schiera-formazione/test/engine.test.js "Formazioni.xls" NomeSquadra
```

I file `.xls` della lega non vanno messi nella repo (sono esclusi da `.gitignore`).
