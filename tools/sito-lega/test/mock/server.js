// Finto Supabase per il sito della lega: le tabelle sono costruite dal file di
// giornata vero, con le stesse regole di import_round().
//   XLS=/percorso/giornata.xls node server.js
const http = require('http'), fs = require('fs'), url = require('url'), path = require('path');
const G = require('../../src/giornata.js');

const XLS = process.env.XLS || '/root/.claude/uploads/01e16dca-3147-5c65-b05b-ee8683976523/8977fb44-03_Campionato_-_Terza_Giornata.xls';
const dati = G.parse(new Uint8Array(fs.readFileSync(XLS)), path.basename(XLS));

const teams = dati.squadre.map((n, i) => ({ id: 'team-' + n, name: n, sheet_name: n }));
const idOf = n => { const k = String(n || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); const t = teams.find(x => x.name.toUpperCase().replace(/[^A-Z0-9]/g, '') === k); return t ? t.id : null; };

const giornate = {};
dati.calendario.forEach(m => {
  const r = giornate[m.giornata] || (giornate[m.giornata] = { id: m.giornata, serie_a: m.giornata + 2, fase: m.giornata <= 14 ? 'regolare' : 'orologio', label: 'Giornata ' + m.giornata, giocata: false, caricata_at: null });
  if (m.giocata) r.giocata = true;
});
const rounds = Object.values(giornate).sort((a, b) => a.id - b.id);
const cur = rounds.filter(r => r.giocata).pop();
if (cur) { cur.caricata_at = new Date().toISOString(); cur.file = dati.file; }

const slotOf = {};
const matches = dati.calendario.map(m => {
  slotOf[m.giornata] = (slotOf[m.giornata] || 0) + 1;
  const t = dati.squadre_giornata.find(x => idOf(x.squadra) === idOf(m.casa)) || {};
  const f = dati.squadre_giornata.find(x => idOf(x.squadra) === idOf(m.fuori)) || {};
  const q = m.giornata === dati.giornata;
  return {
    round: m.giornata, competizione: 'campionato', slot: slotOf[m.giornata],
    casa: idOf(m.casa), fuori: idOf(m.fuori), pos_casa: m.pos_casa, pos_fuori: m.pos_fuori,
    gol_casa: m.gol_casa, gol_fuori: m.gol_fuori,
    punti_casa: q ? t.punteggio : null, punti_fuori: q ? f.punteggio : null,
    totale_casa: q ? t.totale : null, totale_fuori: q ? f.totale : null,
    modulo_casa: q ? t.modulo : null, modulo_fuori: q ? f.modulo : null
  };
});

const round_teams = dati.squadre_giornata.map(t => ({
  round: dati.giornata, team_id: idOf(t.squadra), modulo: t.modulo, punteggio: t.punteggio,
  somma_voti: t.somma_voti, fattore_campo: t.fattore_campo, bonus_modulo: t.bonus_modulo,
  totale: t.totale, gol_fatti: t.gol_fatti, gol_subiti: t.gol_subiti,
  avversario: idOf(t.avversario), in_casa: t.in_casa, sostituzioni: t.sostituzioni,
  marcatori: t.marcatori, formazione: t.formazione, schierati: t.schierati
}));

const standings = [];
const push = (tipo, righe) => (righe || []).forEach((e, i) => {
  const id = idOf(e.squadra);
  if (id) standings.push({ round: dati.giornata, tipo, team_id: id, pos: i + 1, valore: e.punti != null ? e.punti : (e.totale != null ? e.totale : e.valore), dati: e });
});
push('campionato', dati.classifica);
push('super_standard', dati.superclassifica.campionato_standard);
push('super_corretta', dati.superclassifica.campionato_corretta);
push('coppa_lega', dati.superclassifica.coppa_lega);
push('sfigometro', dati.superclassifica.sfigometro);
push('gol_totali', dati.superclassifica.gol_totali);
push('gol_sfruttati', dati.superclassifica.gol_sfruttati);
push('coppa', dati.coppa && dati.coppa.quarti);
((dati.coppa_lega && dati.coppa_lega.settimanali && dati.coppa_lega.settimanali.righe) || []).forEach(r => {
  Object.keys(r.per_giornata).forEach(g => standings.push({ round: +g, tipo: 'cdl_giornata', team_id: idOf(r.squadra), pos: null, valore: r.per_giornata[g], dati: null }));
});

const team_season = dati.crediti.map(c => {
  const gr = dati.gol_reali.find(g => idOf(g.squadra) === idOf(c.squadra)) || {};
  return { round: dati.giornata, team_id: idOf(c.squadra), crediti: c.crediti, gol_totali: gr.totali, gol_sfruttati: gr.sfruttati };
});
const scorers = [].concat.apply([], dati.gol_reali.map(g => g.giocatori.map(p =>
  ({ round: dati.giornata, team_id: idOf(g.squadra), nome: p.nome, gol: p.totali, gol_sfruttati: p.sfruttati }))))
  .sort((a, b) => b.gol - a.gol);
const roster_costs = dati.rose.map(r => ({ team_id: idOf(r.squadra), slot: r.slot, nome: r.nome, costo: r.costo, valore: r.valore }));
const players = dati.rose.map(r => ({ id: 'pl-' + idOf(r.squadra) + '-' + r.slot, team_id: idOf(r.squadra), slot: r.slot, name: r.nome, club: null,
  role: (dati.voti.find(v => v.nome === r.nome && idOf(v.squadra) === idOf(r.squadra)) || {}).ruolo || 'C' }));
const player_votes = dati.voti.map(v => ({ round: dati.giornata, team_id: idOf(v.squadra), nome: v.nome, ruolo: v.ruolo, voto: v.voto, fantavoto: v.fantavoto }));
const player_stats = (() => {
  const m = new Map();
  player_votes.forEach(v => {
    const k = v.team_id + '|' + v.nome;
    const o = m.get(k) || { team_id: v.team_id, squadra: (teams.find(t => t.id === v.team_id) || {}).name, nome: v.nome, ruolo: v.ruolo, presenze: 0, sv: 0, sf: 0, miglior_fantavoto: null };
    if (v.voto) { o.presenze++; o.sv += v.voto; o.sf += v.fantavoto; o.miglior_fantavoto = Math.max(o.miglior_fantavoto || 0, v.fantavoto); }
    m.set(k, o);
  });
  return [...m.values()].map(o => ({
    team_id: o.team_id, squadra: o.squadra, nome: o.nome, ruolo: o.ruolo, presenze: o.presenze,
    media: o.presenze ? Math.round(o.sv / o.presenze * 100) / 100 : null,
    fantamedia: o.presenze ? Math.round(o.sf / o.presenze * 100) / 100 : null,
    miglior_fantavoto: o.miglior_fantavoto
  }));
})();
const albo = dati.albo.map(a => ({ stagione: a.stagione, campionato: a.campionato, coppa: a.coppa, coppa_lega: a.coppa_lega, supercoppa: a.supercoppa }))
  .sort((a, b) => b.stagione.localeCompare(a.stagione));

const TAB = { teams, rounds, matches, round_teams, standings, team_season, scorers, roster_costs, players, player_votes, player_stats, albo };

// filtri PostgREST minimi: eq, lt, is, in
function filtra(righe, q) {
  return righe.filter(r => Object.keys(q).every(k => {
    if (['select', 'order', 'limit', 'offset'].includes(k)) return true;
    const v = String(q[k]);
    const m = /^(eq|lt|gt|neq|is)\.(.*)$/.exec(v);
    if (!m) return true;
    const val = m[2] === 'true' ? true : m[2] === 'false' ? false : m[2];
    const campo = r[k];
    if (m[1] === 'eq') return String(campo) === String(val);
    if (m[1] === 'neq') return String(campo) !== String(val);
    if (m[1] === 'lt') return +campo < +val;
    if (m[1] === 'gt') return +campo > +val;
    if (m[1] === 'is') return String(campo) === String(val);
    return true;
  }));
}

const json = (res, code, obj) => {
  res.writeHead(code, {
    'content-type': 'application/json', 'access-control-allow-origin': '*',
    'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-max-age': '600', 'access-control-expose-headers': '*'
  });
  res.end(JSON.stringify(obj));
};

http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const p = u.pathname, q = u.query;
    let b = {}; try { b = body ? JSON.parse(body) : {}; } catch (e) { b = {}; }
    if (req.method === 'OPTIONS') return json(res, 200, {});
    if (p === '/auth/v1/token') {
      if (q.grant_type === 'password') {
        if (b.password !== 'giusta') return json(res, 400, { error_code: 'invalid_credentials', message: 'Invalid login credentials' });
        return json(res, 200, { access_token: 'tok', refresh_token: 'ref', expires_in: 3600, user: { id: 'u1', email: b.email } });
      }
      return json(res, 200, { access_token: 'tok2', refresh_token: 'ref', expires_in: 3600, user: { id: 'u1' } });
    }
    if (p === '/auth/v1/user') return json(res, 200, { id: 'u1', email: 'valerio@test.it' });
    if (p === '/auth/v1/logout') return json(res, 204, {});
    if (p === '/auth/v1/recover') return json(res, 200, {});
    if (p === '/rest/v1/profiles') return json(res, 200, [{ display_name: 'Valerio', role: process.env.ADMIN ? 'admin' : 'player', team_id: 'team-Valerio' }]);
    if (p === '/rest/v1/rpc/import_round') {
      fs.writeFileSync('/tmp/import_round.json', JSON.stringify({ giornata: b.p && b.p.giornata, partite: (b.p && b.p.calendario || []).length }));
      return json(res, 200, {
        giornata: b.p.giornata, serie_a: b.p.serie_a, partite: (b.p.calendario || []).length,
        voti: (b.p.voti || []).length, squadre: (b.p.squadre_giornata || []).length, classifiche: 64,
        differenze: process.env.DIFF ? [{ squadra: 'Valerio', nell_app: ['Meret', 'Couto'], nel_file: ['Milinkovic-Savic V.', 'Couto'] }] : []
      });
    }
    const m = /^\/rest\/v1\/(\w+)$/.exec(p);
    // NOSTAGIONE: simula il database senza le tabelle di 08_stagione.sql
    if (m && process.env.NOSTAGIONE && ['rounds', 'matches', 'standings', 'round_teams', 'team_season',
        'scorers', 'roster_costs', 'player_votes', 'player_stats', 'albo'].includes(m[1])) {
      return json(res, 404, { code: 'PGRST205', message: "Could not find the table 'public." + m[1] + "' in the schema cache" });
    }
    if (m && TAB[m[1]]) {
      let righe = filtra(TAB[m[1]], q);
      if (q.limit) righe = righe.slice(0, +q.limit);
      return json(res, 200, righe);
    }
    json(res, 404, { message: 'non trovato: ' + p });
  });
}).listen(8899, 'localhost', () => console.log('finto Supabase (sito) su 8899 — giornata', dati.giornata));
