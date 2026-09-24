-- Il Solito Culo — aggiornamenti automatici
-- Da eseguire dopo 06_calendario.sql, una volta pubblicata la funzione
-- "sync-calendario" (vedi supabase/functions/README.md).
--
-- Due lavori pianificati:
--   1. ogni ora  -> refresh_matchdays(): sposta da sola la giornata corrente
--                   appena finisce l'ultima partita di quella precedente;
--   2. ogni notte-> chiama la funzione che riscarica il calendario da
--                   football-data.org (orari spostati, recuperi, rinvii).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) La giornata corrente si sposta da sola ---------------------------------
select cron.unschedule('giornata-corrente') where exists (
  select 1 from cron.job where jobname = 'giornata-corrente');

select cron.schedule('giornata-corrente', '5 * * * *', $$ select public.refresh_matchdays(); $$);

-- 2) Calendario da football-data.org ---------------------------------------
-- PRIMA di eseguire: sostituisci <PROGETTO> con il riferimento del progetto
-- (es. digonsptxuawnehebotw) e <CRON_SECRET> con lo stesso valore messo nei
-- segreti della Edge Function.

select cron.unschedule('calendario-serie-a') where exists (
  select 1 from cron.job where jobname = 'calendario-serie-a');

select cron.schedule('calendario-serie-a', '20 3 * * *', $$
  select net.http_post(
    url     := 'https://<PROGETTO>.supabase.co/functions/v1/sync-calendario',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
$$);

-- Controlli -----------------------------------------------------------------
-- select jobid, jobname, schedule, active from cron.job;
-- select * from cron.job_run_details order by start_time desc limit 10;
-- select * from net._http_response order by created desc limit 5;   -- esito delle chiamate
