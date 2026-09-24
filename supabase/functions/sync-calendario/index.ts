// Il Solito Culo — calendario di Serie A
//
// Prende le partite da football-data.org e le scrive nel database: da lì
// nascono le giornate (prima partita, ultima partita, chiusura) e il blocco
// partita per partita dei giocatori.
//
// Chi può chiamarla: l'amministratore della lega (con il suo accesso) oppure
// la schedulazione notturna (intestazione "x-cron-secret").
//
//   POST /functions/v1/sync-calendario            -> aggiorna il calendario
//   POST /functions/v1/sync-calendario?squadre=1  -> aggiorna anche la squadra
//                                                    di Serie A dei giocatori
//   ...&stagione=2026                             -> stagione diversa da quella in corso
//
// Segreti richiesti (Project Settings -> Edge Functions -> Secrets):
//   FOOTBALL_DATA_TOKEN   chiave gratuita di football-data.org
//   CRON_SECRET           parola d'ordine per la schedulazione (facoltativa)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono già presenti.

const API = 'https://api.football-data.org/v4';
const COMP = 'SA'; // Serie A

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const env = (k: string) => Deno.env.get(k) || '';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---------------------------------------------------------------- Supabase
const SUPA = env('SUPABASE_URL').replace(/\/+$/, '');
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');

async function rpc(fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function rest(path: string) {
  const res = await fetch(`${SUPA}/rest/v1/${path}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  if (!res.ok) throw new Error(`${path}: ${await res.text()}`);
  return res.json();
}

// Chi sta chiamando: la schedulazione o un amministratore della lega?
async function authorize(req: Request): Promise<string | null> {
  const secret = env('CRON_SECRET');
  if (secret && req.headers.get('x-cron-secret') === secret) return null;

  const auth = req.headers.get('Authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return 'Serve il tuo accesso alla lega.';
  const token = auth.slice(7);
  if (token === SERVICE) return null;

  const who = await fetch(`${SUPA}/auth/v1/user`, {
    headers: { apikey: env('SUPABASE_ANON_KEY') || SERVICE, Authorization: `Bearer ${token}` },
  });
  if (!who.ok) return 'Accesso non valido: entra di nuovo nell’app.';
  const user = await who.json();
  const rows = await rest(`profiles?select=role&id=eq.${user.id}`);
  if (!rows.length || rows[0].role !== 'admin') return 'Solo l’amministratore può aggiornare il calendario.';
  return null;
}

// ------------------------------------------------------------ football-data
async function fd(path: string) {
  const token = env('FOOTBALL_DATA_TOKEN');
  if (!token) throw new Error('Manca il segreto FOOTBALL_DATA_TOKEN.');
  const res = await fetch(API + path, { headers: { 'X-Auth-Token': token } });
  if (res.status === 429) throw new Error('football-data.org: troppe richieste, riprova tra un minuto.');
  if (res.status === 403) throw new Error('football-data.org: la chiave gratuita non dà accesso a questi dati.');
  if (!res.ok) throw new Error(`football-data.org ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

type Match = {
  id: number; matchday: number | null; utcDate: string; status: string; stage?: string;
  homeTeam: { name?: string; shortName?: string }; awayTeam: { name?: string; shortName?: string };
};

async function calendario(stagione: string) {
  const q = stagione ? `?season=${encodeURIComponent(stagione)}` : '';
  const data = await fd(`/competitions/${COMP}/matches${q}`);
  const matches: Match[] = data.matches || [];
  return matches
    .filter(m => m.matchday && m.utcDate && (!m.stage || m.stage === 'REGULAR_SEASON'))
    .map(m => ({
      id: m.id,
      matchday: m.matchday,
      home: m.homeTeam?.name || m.homeTeam?.shortName || '',
      home_short: m.homeTeam?.shortName || '',
      away: m.awayTeam?.name || m.awayTeam?.shortName || '',
      away_short: m.awayTeam?.shortName || '',
      kickoff: m.utcDate,
      status: m.status || null,
    }));
}

// -------------------------------------------- abbinamento giocatori ↔ club
// I nomi del fantacalcio sono cognome più, se serve, l'iniziale del nome
// ("Gonzalez N."); l'API dà il nome per esteso ("Nicolás González").
const plain = (s: string) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['`’\-\.]/g, ' ').replace(/\s+/g, ' ').trim();

function split(fanta: string) {
  const m = /^(.*?)[\s,]+([a-z])$/.exec(plain(fanta));
  return m ? { cognome: m[1].trim(), iniziale: m[2] } : { cognome: plain(fanta), iniziale: '' };
}

async function squadre() {
  const data = await fd(`/competitions/${COMP}/teams`);
  const teams = data.teams || [];
  const rosa: { club: string; nome: string; iniziale: string }[] = [];
  let conSquadra = 0;
  for (const t of teams) {
    const club: string = t.shortName || t.name || '';
    const squad = t.squad || [];
    if (squad.length) conSquadra++;
    for (const p of squad) {
      const nome = plain(p.name || [p.firstName, p.lastName].filter(Boolean).join(' '));
      if (!nome) continue;
      rosa.push({ club, nome, iniziale: nome.split(' ')[0].slice(0, 1) });
    }
  }
  return { rosa, teams: teams.length, conSquadra };
}

function abbina(nomeFanta: string, rosa: { club: string; nome: string; iniziale: string }[]) {
  const { cognome, iniziale } = split(nomeFanta);
  if (!cognome) return { club: '', motivo: 'vuoto' };
  let cand = rosa.filter(p => p.nome === cognome || p.nome.endsWith(' ' + cognome));
  if (!cand.length) cand = rosa.filter(p => p.nome.includes(' ' + cognome + ' ') || p.nome.startsWith(cognome + ' '));
  if (iniziale) {
    const stretti = cand.filter(p => p.iniziale === iniziale);
    if (stretti.length) cand = stretti;
  }
  const club = [...new Set(cand.map(p => p.club))];
  if (club.length === 1) return { club: club[0], motivo: '' };
  if (club.length > 1) return { club: '', motivo: 'più squadre: ' + club.join(', ') };
  return { club: '', motivo: 'non trovato' };
}

// ------------------------------------------------------------------- avvio
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST' && req.method !== 'GET') return json({ errore: 'Metodo non ammesso' }, 405);

  try {
    const vietato = await authorize(req);
    if (vietato) return json({ errore: vietato }, 403);

    const url = new URL(req.url);
    const stagione = url.searchParams.get('stagione') || url.searchParams.get('season') || '';
    const conSquadre = ['1', 'true', 'si', 'sì'].includes((url.searchParams.get('squadre') || '').toLowerCase());

    const partite = await calendario(stagione);
    if (!partite.length) return json({ errore: 'Il calendario è arrivato vuoto.' }, 502);
    const esito = await rpc('import_fixtures', { p_matches: partite });

    const out: Record<string, unknown> = {
      partite: partite.length,
      giornate: esito?.giornate?.giornate ?? null,
      corrente: esito?.giornate?.corrente ?? null,
      da_controllare: esito?.da_controllare ?? null,
    };

    if (conSquadre) {
      const { rosa, teams, conSquadra } = await squadre();
      if (!rosa.length) {
        out.squadre = { errore: `Nessuna rosa disponibile (${teams} squadre, ${conSquadra} con rosa).` };
      } else {
        const players = await rest('players?select=id,name,role,club&order=name');
        const items: { player_id: string; club: string }[] = [];
        const dubbi: string[] = [];
        for (const p of players) {
          const { club, motivo } = abbina(p.name, rosa);
          if (club) items.push({ player_id: p.id, club });
          else dubbi.push(`${p.name} (${motivo})`);
        }
        const res = items.length ? await rpc('set_player_clubs', { p_items: items }) : { aggiornati: 0 };
        out.squadre = {
          abbinati: items.length,
          aggiornati: res?.aggiornati ?? 0,
          da_sistemare: dubbi.length,
          elenco: dubbi.slice(0, 60),
        };
      }
    }

    return json(out);
  } catch (e) {
    return json({ errore: e instanceof Error ? e.message : String(e) }, 500);
  }
});
