# Prove dell'app con un finto Supabase

`server.js` è un finto Supabase per Schiera (rose, giornate, calendario,
formazioni, log, storage): la pagina ci parla come se fosse il progetto vero,
così si può provare tutto senza toccare i dati della lega.

Le prove girano **sul sito**, nella sezione `#/schiera`: il finto Supabase è
quello del sito (`tools/sito-lega/test/mock/server.js`), che per le tabelle di
Schiera usa `server.js` di questa cartella. `sito.py` avvia tutto ed entra.

```bash
cd tools/schiera-formazione/test/mock
node rose.js /percorso/Formazioni.xls > /tmp/rose.json   # rose di partenza
python3 ../../../sito-lega/build.py                      # il sito, con Schiera dentro
python3 -m http.server 8765                              # servito da una cartella che contenga ilsolitoculo/ -> docs/
FORMAZIONI=/percorso/Formazioni.xls python3 test_online.py   # accesso, salvataggio, export, amministrazione
FORMAZIONI=/percorso/Formazioni.xls python3 test_locks.py    # blocchi, formazioni pubbliche, ripristino, calendario
```

Le prove girano con Playwright su un telefono simulato. Ogni scenario riparte
con un server pulito; le variabili d'ambiente decidono la situazione:

| Variabile | Cosa simula |
|---|---|
| `PRELOAD` | una formazione già salvata per la giornata corrente |
| `PREV` | una formazione salvata in una giornata precedente (ripristino) |
| `LOCKED` | le prime due partite della giornata già iniziate |
| `LOCK30` | la prima partita inizia fra 20 minuti (già bloccata: il blocco scatta mezz'ora prima) |
| `PANCA` | formazione salvata con un panchinaro bloccato (Davis K. primo panchinaro dell'attacco, con `LOCKED`) |
| `SCADUTA` | scadenza della formazione completa già passata |
| `ADMIN_MOD` | l'amministratore ha già modificato la formazione di Valerio (con nota) |
| `NOSCAD` | database senza `db/12_scadenze.sql` (le colonne della scadenza non ci sono) |
| `CLOSED` | giornata finita |
| `NOCLUB` | rose senza squadra di Serie A |
| `ADMIN` | l'account è amministratore |
| `FORCE_P0007` | il database rifiuta qualsiasi salvataggio |
| `MD` | la giornata corrente di Serie A (7 se non indicata) |

Le formazioni di tutta la lega (Giornata → Formazioni del sito e il file unico
dell'amministratore) per la giornata corrente sono quella di Valerio salvata qui,
più due inventate per Sebi e Massimo; con `SOLO_MIA` c'è solo quella di Valerio.

`test_locks.py`, oltre a blocchi, formazioni pubbliche, ripristino e calendario,
prova le regole di `db/12_scadenze.sql`: il panchinaro bloccato che tiene fermo il
suo reparto (selettore con «fermo per …», moduli spenti, Svuota che lascia chi
serve), il blocco mezz'ora prima, la scadenza passata (Schiera e riquadro della
Home), l'amministratore che modifica un'altra squadra anche a scadenza passata
(nota, avviso pubblico in Formazioni, ritorno alla propria), la squadra che vede
la modifica, la scadenza scelta dall'amministratore e il database senza
scadenze. Con `SOLO=12,15` girano solo alcuni scenari.
