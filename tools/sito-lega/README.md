# Il sito della lega

Il sito con tutto quello che succede nella lega: rose, calendario e risultati,
classifiche, statistiche, coppe, playoff, albo d'oro e premi.

**Aprilo qui:** https://nicosiav.github.io/ilsolitoculo/

Serve l'account della lega: rose, voti e formazioni restano fra i partecipanti.

## Le sezioni

| Sezione | Cosa c'è |
|---|---|
| Home | la tua squadra, il risultato dell'ultima giornata, la prossima partita, l'andamento e la classifica |
| Squadra | una pagina per squadra: posizioni, punteggi di giornata, andamento, tutte le partite con l'esito e i migliori della rosa |
| Rose | le otto rose con ruolo, squadra di Serie A, costo, presenze, media e fantamedia; crediti residui e gol reali |
| Calendario | tutte le 20 giornate; toccando una partita esce il tabellino con voti, subentri e marcatori |
| Classifiche | campionato, campionato "corretto", Coppa di Lega, sfigometro, gol reali e classifica della Coppa |
| Statistiche | cannonieri, migliori fantamedie e medie voto, prestazioni della giornata, punteggi a confronto |
| Testa a testa | due squadre a confronto: scontri diretti, medie, giornate vinte, punteggi giornata per giornata |
| Coppe | classifica parallela della Coppa con gli accoppiamenti dei quarti, Coppa di Lega, Supercoppa |
| Playoff | il tabellone e le regole dei turni |
| Albo d'oro | la bacheca di sempre e tutte le stagioni dal 1991/92 |
| Premi | montepremi, ripartizione, crediti per la stagione dopo e come si passa dal punteggio ai gol |

Da ogni pagina si arriva a **Schiera Formazione**, che resta l'app per schierare.

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
- il motore `.xls` e il client Supabase arrivano da `tools/schiera-formazione/src/`.

```bash
python3 tools/sito-lega/build.py                      # aggiorna docs/index.html
node -e "const G=require('./tools/sito-lega/src/giornata.js'),fs=require('fs');
         console.log(Object.keys(G.parse(new Uint8Array(fs.readFileSync('giornata.xls')),'x')))"
```

Le prove del sito girano contro un finto Supabase costruito dal file di giornata
vero: vedi [`test/mock/`](test/mock/README.md).
