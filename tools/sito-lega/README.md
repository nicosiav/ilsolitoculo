# Il sito della lega

Il sito con tutto quello che succede nella lega: rose, calendario e risultati,
classifiche, statistiche, coppe, playoff, albo d'oro e premi.

**Aprilo qui:** https://nicosiav.github.io/ilsolitoculo/

Serve l'account della lega: rose, voti e formazioni restano fra i partecipanti.

## Le sezioni

Sei sezioni. Al telefono la barra in basso ha Home, Giornata, **Schiera** (il
pulsante verde al centro, con un pallino rosso finché la formazione della
giornata non è salvata), Classifiche e **Altro**, che apre Squadre e Lega. Sul
computer stanno tutte nella barra in alto e Schiera è il riquadro verde con il
conto alla rovescia in cima a ogni sezione.

| Sezione | Schede | Cosa c'è |
|---|---|---|
| Home | | il riquadro verde per schierare, con il conto alla rovescia; la tua squadra, l'ultima giornata, la prossima partita, l'andamento, la classifica |
| Giornata | Partite · Formazioni | le partite di ogni giornata (tocca una partita giocata per il tabellino, una da giocare per le formazioni salvate); le formazioni di tutte le squadre, salvate in Schiera o, per le giornate giocate, come risultano dal file con i fantavoti. All'amministratore: **Scarica tutte in un file .xls** |
| Schiera | | la formazione della giornata ([dettagli](../schiera-formazione/README.md)) |
| Classifiche | Campionato · Corretta · Coppa di Lega · Sfigometro · Gol reali · Coppa · Playoff | tutte le classifiche del regolamento, la Coppa con gli accoppiamenti e la Supercoppa, il tabellone e le regole dei playoff |
| Squadre | Panoramica · Rosa · Statistiche · Confronto | per ogni squadra: numeri e ultime partite; la rosa con costo, media e fantamedia di lega e (se caricate) di Serie A da Fantacalcio.it; punteggio contro la media, posizione nel tempo, serie, punti per reparto, migliori e peggiori, bonus, formazione ideale; il confronto con un'altra squadra |
| Lega | Statistiche · Albo d'oro · Premi | record e curiosità, punteggi di ogni giornata, punti lasciati in panchina, cannonieri, migliori medie; la bacheca e tutte le stagioni dal 1991/92; montepremi e crediti |

I vecchi indirizzi (`#/calendario`, `#/rose`, `#/statistiche`…) portano da soli
alla sezione nuova.

### La formazione ideale

Per ogni squadra e giornata: i migliori di chi ha preso un voto, con un portiere e
il modulo che dà più punti fra quelli ammessi (3-4-3, 3-5-2, 4-3-3, 4-4-2, 4-5-1,
5-3-2, 5-4-1). I "punti lasciati in panchina" sono la differenza con i fantavoti di
chi è entrato davvero (il punteggio di Coppa di Lega: senza fattore campo e bonus
del modulo). I calcoli stanno in `src/calcoli.js`.

Il sito si installa come app: su Android dal menu in alto a destra ("Installa
l'app sul telefono") o dal menu di Chrome; su iPhone da Safari → Condividi →
"Aggiungi alla schermata Home".

## Per l'amministratore

Nel menu in alto a destra, oltre a **Carica la giornata** (qui sotto):

- **Scarica tutte le formazioni**: un solo `.xls` con il modello della lega
  (Supabase Storage, `modelli/formazioni.xls`) e ogni foglio squadra compilato con
  la formazione salvata, come se ognuno avesse scaricato il suo; chi non ha salvato
  resta con il foglio vuoto (colonna D e H31:K52) e il sito lo dice prima. Lo stesso
  pulsante sta in fondo a Giornata → Formazioni, per qualsiasi giornata.
- **Carica le medie di Fantacalcio.it**: l'Excel scaricato a mano dalla pagina
  [Statistiche Serie A](https://www.fantacalcio.it/statistiche-serie-a) (`.xlsx`, o
  `.xls`). Il sito lo legge nel browser (`src/fantacalcio.js`), abbina i giocatori
  per nome (e ruolo e squadra quando serve), mostra un'anteprima e lo salva con
  `import_fc_stats()` ([`db/10_fantacalcio.sql`](../../db/10_fantacalcio.sql)).
  Niente scaricamenti automatici: le condizioni d'uso di Fantacalcio.it (art. 3.3 e
  8) non li permettono, né permettono di ripubblicare i dati; in Rosa compaiono solo
  ai partecipanti, con la fonte e la data.

## Ogni settimana: carica la giornata

L'amministratore apre il menu in alto a destra → **Carica la giornata** e sceglie
il file `.xls` della giornata (quello con i fogli `voti`, `CALENDARIO`,
`CLASSIFICHE`, `SUPERCLASSIFICA`, `GOL REALI`, `ROSE` e un foglio per squadra).

Il sito legge il file nel browser, mostra un'anteprima (giornata, partite, voti,
punteggi di ogni squadra) e, dopo la conferma, scrive tutto nel database in una
sola operazione: risultati e calendario, voti e fantavoti di ogni giocatore,
formazioni realmente schierate con subentri e marcatori, classifiche,
superclassifica, gol reali, rose e crediti.

Le formazioni salvate in Schiera **non vengono toccate**: se non coincidono con
quelle del file, il sito le mostra a confronto. Vale il file, perché è quello
con cui sono stati calcolati i punteggi.

La giornata 1 della lega è la 3ª di Serie A (regolamento, punto 5.1): il
collegamento lo fa il sito da solo.

## Se il sito dice che manca una tabella

*"Could not find the table 'public.rounds' in the schema cache"* vuol dire che
il database della stagione non c'è ancora: esegui `db/08_stagione.sql` nel SQL
Editor di Supabase. Se le tabelle ci sono già, è solo la cache di PostgREST:

```sql
notify pgrst, 'reload schema';
```

Il sito in quel caso entra lo stesso e lo dice in chiaro all'amministratore: le
sezioni restano vuote finché le tabelle non ci sono.

## Sviluppo

- `src/index.html`, `src/app.css`, `src/app.js` — il sito.
- `src/giornata.js` — lettura del file .xls di giornata (tutti i fogli).
- `src/calcoli.js` — formazione ideale, punti per reparto, serie, record, distribuzione dei punteggi, posizioni nel tempo (funzioni pure, provate da `test/calcoli.test.js`).
- `src/fantacalcio.js` — lettura dell'Excel delle statistiche di Fantacalcio.it (`.xlsx` senza librerie, `.xls` con il motore di Schiera) e abbinamento alle rose.
- Schiera arriva da `tools/schiera-formazione/src/` (`ui.html`, `ui.css`, `ui.js`): `build.py` la mette al posto del segnaposto in `src/index.html` e ne chiude lo stile sotto `.sch`, così non tocca il resto del sito.
- `src/manifest.webmanifest`, `src/sw.js` — il sito come app installabile (il service worker non tiene niente in cache).
- `src/logo.svg` — il marchio della lega (il "colpo di culo"). `build.py` lo mette
  nell'intestazione e lo usa come favicon; `icons/make_icons.py` ne ricava le PNG
  in `docs/icons/` (favicon, icone dell'app e icona per la schermata Home dell'iPhone). Se cambi il
  logo, rilancia tutti e due.
- il motore `.xls` e il client Supabase arrivano da `tools/schiera-formazione/src/`.

```bash
python3 tools/sito-lega/build.py                      # aggiorna docs/index.html
node -e "const G=require('./tools/sito-lega/src/giornata.js'),fs=require('fs');
         console.log(Object.keys(G.parse(new Uint8Array(fs.readFileSync('giornata.xls')),'x')))"
```

Le prove del sito girano contro un finto Supabase costruito dal file di giornata
vero: vedi [`test/mock/`](test/mock/README.md). I calcoli si provano anche da soli:

```bash
python3 tools/sito-lega/test/mock/fantacalcio_finto.py /tmp/fc_stats.xlsx    # un Excel di Fantacalcio.it finto
node tools/sito-lega/test/calcoli.test.js "giornata.xls" /tmp/fc_stats.xlsx
```
