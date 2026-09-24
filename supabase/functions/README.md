# Funzioni sul server (Supabase Edge Functions)

## `sync-calendario`

Scarica il calendario della Serie A da [football-data.org](https://www.football-data.org/)
e lo scrive nella tabella `fixtures`. Da lì il database ricava le giornate
(prima partita, ultima partita, chiusura) e il blocco partita per partita:
ogni giocatore si blocca quando la sua squadra scende in campo.

### Una volta sola

1. Registra una chiave gratuita su https://www.football-data.org/client/register
   (piano *Free tier*: Serie A inclusa, 10 richieste al minuto).
2. Nel progetto Supabase, **Edge Functions → Secrets**, aggiungi:

   | Segreto | Valore |
   |---|---|
   | `FOOTBALL_DATA_TOKEN` | la chiave ricevuta per email |
   | `CRON_SECRET` | una parola d'ordine a tua scelta (serve alla schedulazione) |

   La chiave resta sul server: nel sito pubblicato non finisce mai.
3. Pubblica la funzione (serve la [CLI di Supabase](https://supabase.com/docs/guides/cli)):

   ```bash
   supabase login
   supabase link --project-ref <PROGETTO>
   supabase functions deploy sync-calendario
   ```

   In alternativa, dal sito: **Edge Functions → Deploy a new function**, nome
   `sync-calendario`, e incolla il contenuto di `sync-calendario/index.ts`.
4. Esegui `db/07_cron.sql` dopo aver sostituito `<PROGETTO>` e `<CRON_SECRET>`:
   da quel momento il calendario si aggiorna ogni notte e la giornata corrente
   si sposta da sola ogni ora.

### Come si usa

Dall'app, come amministratore: **Opzioni → Aggiorna il calendario**.

A mano:

```bash
# solo calendario
curl -X POST "https://<PROGETTO>.supabase.co/functions/v1/sync-calendario" \
     -H "x-cron-secret: <CRON_SECRET>"

# calendario + squadra di Serie A di ogni giocatore in rosa
curl -X POST "https://<PROGETTO>.supabase.co/functions/v1/sync-calendario?squadre=1" \
     -H "x-cron-secret: <CRON_SECRET>"

# una stagione diversa da quella in corso
curl -X POST "https://<PROGETTO>.supabase.co/functions/v1/sync-calendario?stagione=2026" \
     -H "x-cron-secret: <CRON_SECRET>"
```

Risposta tipica:

```json
{ "partite": 380, "giornate": 38, "corrente": 5, "da_controllare": null,
  "squadre": { "abbinati": 228, "aggiornati": 12, "da_sistemare": 3,
               "elenco": ["Stankovic F. (non trovato)"] } }
```

- `da_controllare`: squadre del calendario che non compaiono in nessuna rosa.
  Di solito basta aggiungere l'alias giusto in `club_aliases`.
- `da_sistemare`: giocatori a cui non è stato possibile assegnare una squadra.
  Si correggono dall'app: **Opzioni → Squadre dei giocatori**.

Chi non ha una squadra assegnata si blocca all'inizio della giornata, non
alla sua partita: conviene sistemarli.
