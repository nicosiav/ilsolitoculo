# Schiera Formazione

Lo strumento per schierare la formazione dal telefono senza scrivere a mano i
numeri nella colonna D del file Excel della lega.

**Da settembre 2026 è una sezione del sito della lega:**
https://nicosiav.github.io/ilsolitoculo/#/schiera — il pulsante verde al centro
della barra in basso. Il vecchio indirizzo `…/schiera/` porta lì da solo.

Questa cartella contiene il codice di Schiera: il sito lo prende da qui
(`tools/sito-lega/build.py`) e lo monta nella sua pagina. Da qui esce anche la
versione offline a file singolo.

## Come si usa (dentro il sito)

1. Entri nel sito con email e password: lo stesso account vale per tutto.
2. Tocchi **Schiera** nella barra in basso. Rosa e formazione della giornata arrivano dal [database della lega](../../db/README.md).
3. Scegli il modulo e tocchi i posti sul campo, in panchina e in panchina extra (oppure tocchi i giocatori "non schierati" per metterli nel primo posto libero).
4. Tocchi **Salva formazione**: la formazione finisce nel database, la vedono tutti e ogni modifica resta nel log.

### Il conto alla rovescia e i blocchi

In cima alla pagina c'è il **conto alla rovescia al primo fischio** della
giornata (giorni, ore, minuti, secondi); lo stesso numero compare nel riquadro
verde della Home. Da lì in poi **ogni giocatore si blocca quando la sua squadra
scende in campo**: chi è già in campo resta dov'è (segnato con un pallino, non
selezionabile), tutti gli altri si cambiano a piacere, e il conto passa al
prossimo dei tuoi che scende in campo. La giornata si chiude dopo l'ultima
partita. È il database ad applicare la regola, non solo la pagina.

Finché la formazione della giornata non è salvata, sul pulsante Schiera della
barra c'è un pallino rosso.

### I comandi

Nella pagina: **Ripristina l'ultima salvata** (pesca la più recente, anche da
giornate precedenti), **Svuota**, **Riserve in ordine libero**; in fondo
**Formazioni di giornata** (quelle di tutte le squadre, anche delle giornate
passate), **Esporta il file .xls** (genera `formazioni_AAAAMMGG_Squadra.xls` dal
modello della lega tenuto in Supabase Storage) e **Storico modifiche**.

Per l'amministratore, nel menu in alto a destra del sito: **Aggiorna le rose da
un .xls**, **Aggiorna il calendario di Serie A**, **Squadre dei giocatori** (chi
non ha una squadra di Serie A si blocca alla prima partita della giornata),
**Giornata corrente (a mano)**.

## Versione offline (senza account)

`dist/Schiera-Formazione-offline.html` è un file unico che non parla con il
database: carichi il file .xls della lega, schieri e scarichi il file
aggiornato. Serve solo come riserva, se il sito non fosse raggiungibile.

## Cosa scrive nel file

Replica esattamente la macro `Formazioni` (pulsante "Schiera formazione") del foglio della squadra:

| Dove | Cosa |
|---|---|
| `D1:D31` | numeri di schieramento: 1–11 titolari (1 = portiere), 12–18 riserve, 19–22 panchina extra |
| `H31:I52` | ruolo e nome dei 22 giocatori in ordine di numero (come "incolla valori" della macro) |
| `J31:K52` | colonne F:G degli stessi giocatori (voto/fantavoto, di solito vuote) |
| formule | ricalcola i valori mostrati (es. `I5:I29`, modulo in `I2:K2`) e segna il foglio da ricalcolare all'apertura in Excel |

Tutto il resto del file (macro VBA, pulsante, formati, altri fogli) resta identico byte per byte.

Le riserve sono per ruolo (12 P, 13–14 D, 15–16 C, 17–18 A), come previsto dalle formule "riserva d'ufficio" del foglio; con **Riserve in ordine libero** entrano nell'ordine scelto.
Se mancano numeri, la pagina avvisa: come con la macro, l'ordine "scala" e i posti vuoti vengono presi dai giocatori successivi.

## Sviluppo

- `src/engine.js` — lettura/scrittura `.xls` (BIFF8 in contenitore CFB) senza librerie esterne, con valutatore delle formule del foglio.
- `src/sb.js` — client minimo per Supabase (login, query, RPC, funzioni, storage), senza librerie esterne.
- `src/config.js` — indirizzo e chiave pubblica del progetto Supabase (la chiave `anon` è pubblica per scelta; la `service_role` non va mai qui).
- `src/ui.html`, `src/ui.css`, `src/ui.js` — la pagina. Le parti fra `<!--solo-app-->` e `<!--/solo-app-->` servono solo alla versione offline; dentro il sito cerca i suoi elementi solo sotto `#schiera-app` e parla col sito tramite `window.Schiera` (avvia, mostra, esci, scadenza, funzioni da amministratore, nuova password).
- `icons/make_icons.py` — le vecchie icone in `docs/schiera/icons/` (le icone dell'app ora sono quelle del sito).

```bash
python3 tools/sito-lega/build.py                   # il sito, con Schiera dentro (docs/index.html)
python3 tools/schiera-formazione/build.py          # docs/schiera/: il vecchio indirizzo che porta al sito
python3 tools/schiera-formazione/build.py --all    # anche la versione offline a file singolo in dist/
node tools/schiera-formazione/test/engine.test.js "Formazioni.xls" NomeSquadra
```

Le prove di Schiera (accesso, salvataggio, export, blocchi, formazioni
pubbliche, ripristino, amministrazione) girano sul sito, nella sezione
`#/schiera`, contro un finto Supabase: vedi [`test/mock/`](test/mock/README.md).

I file `.xls` della lega non vanno messi nella repo (sono esclusi da `.gitignore`).
