# Prove dell'app con un finto Supabase

`server.js` è un finto Supabase (accesso, rose, giornate, calendario,
formazioni, log, storage): l'app ci parla come se fosse il progetto vero, così
si può provare tutto senza toccare i dati della lega.

```bash
cd tools/schiera-formazione/test/mock
node rose.js /percorso/Formazioni.xls > /tmp/rose.json   # rose di partenza
python3 ../../build.py                                   # aggiorna docs/schiera
python3 -m http.server 8765                              # servito da una cartella che contenga ilsolitoculo/
XLS=/percorso/Formazioni.xls python3 test_online.py      # accesso, salvataggio, export, amministrazione
XLS=/percorso/Formazioni.xls python3 test_locks.py       # blocchi, formazioni pubbliche, ripristino, calendario
```

Le prove girano con Playwright su un telefono simulato. Ogni scenario riparte
con un server pulito; le variabili d'ambiente decidono la situazione:

| Variabile | Cosa simula |
|---|---|
| `PRELOAD` | una formazione già salvata per la giornata corrente |
| `PREV` | una formazione salvata in una giornata precedente (ripristino) |
| `LOCKED` | le prime due partite della giornata già iniziate |
| `CLOSED` | giornata finita |
| `NOCLUB` | rose senza squadra di Serie A |
| `ADMIN` | l'account è amministratore |
| `FORCE_P0007` | il database rifiuta qualsiasi salvataggio |
