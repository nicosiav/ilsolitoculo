// Finto Supabase per il sito della lega: le tabelle sono costruite dal file di
// giornata vero, con le stesse regole di import_round().
//   XLS=/percorso/giornata.xls node server.js
const http = require('http'), fs = require('fs'), url = require('url'), path = require('path');
const G = require('../../src/giornata.js');
// Schiera Formazione è una sezione del sito: le sue tabelle (rosa, giornata di
// Serie A, partite, formazioni…) le serve il finto Supabase di Schiera.
const SCH = require('../../../schiera-formazione/test/mock/server.js');

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
// Le giornate prima di quella del file: voti e formazioni inventati (sempre gli stessi) partendo
// da quelli veri, così le statistiche hanno più di una giornata. NOSTORICO per farne a meno.
if (!process.env.NOSTORICO) {
  const h = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const sposta = (nome, r) => ((h(nome) + r * 13) % 7 - 3) * 0.5;
  for (let r = 1; r < dati.giornata; r++) {
    const voti = dati.voti.map(v => ({ round: r, team_id: idOf(v.squadra), nome: v.nome, ruolo: v.ruolo, voto: v.voto,
      fantavoto: v.voto ? Math.max(3, v.fantavoto + sposta(v.nome, r)) : v.fantavoto }));
    player_votes.push(...voti);
    dati.squadre_giornata.forEach(t => {
      const fv = n => (voti.find(v => v.nome === n && v.team_id === idOf(t.squadra)) || {}).fantavoto;
      const formazione = t.formazione.map(x => Object.assign({}, x, x.giocato ? { fantavoto: fv(x.nome) } : {}));
      const schierati = t.schierati.map(x => Object.assign({}, x, x.voto ? { fantavoto: fv(x.nome) } : {}));
      const punteggio = formazione.filter(x => x.giocato).reduce((a, x) => a + x.fantavoto, 0);
      round_teams.push({ round: r, team_id: idOf(t.squadra), modulo: t.modulo, punteggio, somma_voti: null, fattore_campo: null,
        bonus_modulo: null, totale: null, gol_fatti: null, gol_subiti: null, avversario: null, in_casa: null,
        sostituzioni: t.sostituzioni, marcatori: [], formazione, schierati });
    });
  }
}
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

// medie di Fantacalcio.it: vuote finché l'amministratore non le carica (FC=file.xlsx per partire già carichi)
const fc_stats = [], fc_stats_meta = [];
const FC = process.env.FC;
if (FC) {
  require('../../src/fantacalcio.js').leggi(new Uint8Array(fs.readFileSync(FC)), path.basename(FC)).then(r => {
    r.righe.forEach((x, i) => fc_stats.push(Object.assign({ id: i + 1 }, x)));
    fc_stats_meta.push({ aggiornate_at: new Date().toISOString(), file: path.basename(FC), stagione: r.stagione, righe: r.righe.length });
  });
}

// mercato (db/11_mercato.sql): il LISTONE del file e le operazioni. NOMERCATO = script non eseguito
let listoneId = 0;
const listone = (dati.listone || []).map(x => ({ id: ++listoneId, ruolo: x.ruolo, nome: x.nome, club: x.squadra || null, origine: 'file' }));
const market_ops = [];
let modello = null;                         // il modello .xls caricato dal sito (dopo un'operazione)
const MODELLO = process.env.FORMAZIONI || '/home/claude/Formazioni.xls';
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const creditiDi = id => {
  const ts = team_season.find(t => t.team_id === id);
  if (!ts || ts.crediti == null) return null;
  return ts.crediti - market_ops.filter(o => o.team_id === id && !o.annullata_at && !o.riportata_at)
    .reduce((a, o) => a + o.costo_svincolo + o.costo_acquisto, 0);
};
const errore = (res, code, message) => json(res, 400, { code, message });

const TAB = { teams, rounds, matches, round_teams, standings, team_season, scorers, roster_costs, players, player_votes, player_stats, albo, fc_stats, fc_stats_meta, listone, market_ops };

// filtri PostgREST minimi: eq, lt, is, in
function filtra(righe, q) {
  return righe.filter(r => Object.keys(q).every(k => {
    if (['select', 'order', 'limit', 'offset'].includes(k)) return true;
    const v = String(q[k]);
    if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
    if (v === 'is.null') return r[k] === null || r[k] === undefined;
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
  const pezzi = [];
  req.on('data', c => pezzi.push(c));
  req.on('end', () => {
    const p = u.pathname, q = u.query;
    const grezzo = Buffer.concat(pezzi), body = grezzo.toString('utf8');
    let b = {}; try { b = body && !p.startsWith('/storage/') ? JSON.parse(body) : {}; } catch (e) { b = {}; }
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
    // profilo con la squadra, e la rosa di una squadra: come li chiede Schiera
    if (p === '/rest/v1/profiles' || (p === '/rest/v1/players' && (q.team_id || String(q.select || '').includes('teams(')))) {
      if (SCH.gestisci(req, res, p, q, b) !== false) return;
    }
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
    if (p === '/rest/v1/rpc/import_fc_stats') {
      if (!process.env.ADMIN) return json(res, 400, { code: 'P0005', message: "Solo l'amministratore può caricare le medie" });
      if (process.env.NOFC) return json(res, 404, { code: 'PGRST202', message: 'Could not find the function public.import_fc_stats(p) in the schema cache' });
      fc_stats.length = 0; fc_stats_meta.length = 0;
      (b.p.righe || []).forEach((x, i) => fc_stats.push(Object.assign({ id: i + 1 }, x)));
      fc_stats_meta.push({ aggiornate_at: new Date().toISOString(), file: b.p.file, stagione: b.p.stagione, righe: fc_stats.length });
      fs.writeFileSync('/tmp/import_fc.json', JSON.stringify({ file: b.p.file, stagione: b.p.stagione, righe: fc_stats.length }));
      return json(res, 200, { righe: fc_stats.length, aggiornate_at: new Date().toISOString() });
    }
    if (m && process.env.NOFC && ['fc_stats', 'fc_stats_meta'].includes(m[1])) {
      return json(res, 404, { code: 'PGRST205', message: "Could not find the table 'public." + m[1] + "' in the schema cache" });
    }
    // ---- mercato
    if (process.env.NOMERCATO && (p.startsWith('/rest/v1/rpc/mercato_') || (m && ['listone', 'market_ops'].includes(m[1])))) {
      return json(res, 404, m && !p.includes('/rpc/') ? { code: 'PGRST205', message: "Could not find the table 'public." + m[1] + "' in the schema cache" }
        : { code: 'PGRST202', message: 'Could not find the function in the schema cache' });
    }
    if (p.startsWith('/storage/v1/object/modelli/')) {
      if (req.method === 'POST' || req.method === 'PUT') {
        modello = grezzo; fs.writeFileSync('/tmp/modello_mercato.xls', grezzo); fs.writeFileSync('/tmp/upload.flag', '1');
        return json(res, 200, { Key: 'modelli/formazioni.xls' });
      }
      res.writeHead(200, { 'content-type': 'application/vnd.ms-excel', 'access-control-allow-origin': '*' });
      return res.end(modello || fs.readFileSync(MODELLO));
    }
    if (p === '/rest/v1/rpc/mercato_crediti') {
      return json(res, 200, teams.map(t => ({ team_id: t.id, crediti: creditiDi(t.id), dal_file: (team_season.find(x => x.team_id === t.id) || {}).crediti, round: dati.giornata,
        in_sospeso: market_ops.filter(o => o.team_id === t.id && !o.annullata_at && !o.riportata_at).length })));
    }
    if (p === '/rest/v1/rpc/mercato_sostituisci') {
      if (!process.env.ADMIN) return errore(res, 'P0005', "Solo l'amministratore può fare operazioni di mercato");
      const pe = players.find(x => x.id === b.p_esce), li = listone.find(x => x.id === b.p_entra);
      if (!pe || pe.slot == null) return errore(res, 'P0010', 'Il giocatore da svincolare non è più in rosa');
      if (!li) return errore(res, 'P0011', 'Il giocatore da prendere non è più fra gli svincolati');
      if (li.ruolo !== pe.role) return errore(res, 'P0012', `Ruoli diversi: ${pe.name} è ${pe.role}, ${li.nome} è ${li.ruolo}`);
      if (b.p_costo_acquisto < 0) return errore(res, 'P0013', "Il costo dell'acquisto non può essere negativo");
      const cr = creditiDi(pe.team_id), tot = (b.p_costo_svincolo || 0) + (b.p_costo_acquisto || 0);
      if (cr != null && cr - tot < 0) return errore(res, 'P0014', `Crediti insufficienti: ne ha ${cr}, l'operazione ne costa ${tot}`);
      const rc = roster_costs.find(x => x.team_id === pe.team_id && x.slot === pe.slot);
      const slot = pe.slot;
      pe.slot = null; pe.fuori_rosa_at = new Date().toISOString();
      const nuovo = { id: 'pl-nuovo-' + (market_ops.length + 1), team_id: pe.team_id, slot, role: pe.role, name: li.nome, club: li.club };
      players.push(nuovo);
      listone.splice(listone.indexOf(li), 1);
      listone.push({ id: ++listoneId, ruolo: pe.role, nome: pe.name, club: pe.club, origine: 'svincolo' });
      if (rc) Object.assign(rc, { nome: li.nome, costo: b.p_costo_acquisto, valore: null });
      const op = { id: market_ops.length + 1, at: new Date().toISOString(), team_id: pe.team_id, slot, ruolo: pe.role,
        esce_id: pe.id, esce_nome: pe.name, esce_club: pe.club, esce_costo: rc && norm(rc.nome) === norm(li.nome) ? b.p_costo_acquisto : (rc ? rc.costo : null), esce_valore: null,
        entra_id: nuovo.id, entra_nome: li.nome, entra_club: li.club, costo_svincolo: b.p_costo_svincolo || 0, costo_acquisto: b.p_costo_acquisto || 0,
        crediti_prima: cr, crediti_dopo: cr == null ? null : cr - tot, note: b.p_note || null,
        formazioni: process.env.PRELOAD && pe.team_id === 'team-Valerio' ? [{ team_id: pe.team_id, matchday: 7, pos: 12 }] : [],
        modello_at: null, riportata_at: null, riportata_round: null, annullata_at: null };
      market_ops.unshift(op);
      fs.writeFileSync('/tmp/mercato_op.json', JSON.stringify(op));
      return json(res, 200, { id: op.id, entra_id: nuovo.id, crediti_prima: cr, crediti_dopo: op.crediti_dopo, formazioni: op.formazioni });
    }
    if (p === '/rest/v1/rpc/mercato_annulla') {
      if (!process.env.ADMIN) return errore(res, 'P0005', "Solo l'amministratore");
      const o = market_ops.find(x => x.id === b.p_op);
      if (!o || o.annullata_at) return errore(res, 'P0015', 'Operazione non trovata o già annullata');
      if (market_ops.some(x => x.id > o.id && !x.annullata_at)) return errore(res, 'P0015', "Si può annullare solo l'ultima operazione");
      if (o.riportata_at) return errore(res, 'P0015', "È già nel file di giornata: per tornare indietro fai l'operazione inversa");
      players.splice(players.findIndex(x => x.id === o.entra_id), 1);
      const pe = players.find(x => x.id === o.esce_id); pe.slot = o.slot; pe.fuori_rosa_at = null;
      const li = listone.findIndex(x => norm(x.nome) === norm(o.esce_nome)); if (li >= 0) listone.splice(li, 1);
      listone.push({ id: ++listoneId, ruolo: o.ruolo, nome: o.entra_nome, club: o.entra_club, origine: 'file' });
      const rc = roster_costs.find(x => x.team_id === o.team_id && x.slot === o.slot); if (rc) Object.assign(rc, { nome: o.esce_nome, costo: o.esce_costo });
      o.annullata_at = new Date().toISOString();
      return json(res, 200, { id: o.id, formazioni: o.formazioni });
    }
    if (p === '/rest/v1/rpc/mercato_modello') {
      const o = market_ops.find(x => x.id === b.p_op); if (o) o.modello_at = b.p_ok ? new Date().toISOString() : null;
      return json(res, 200, null);
    }
    if (p === '/rest/v1/rpc/mercato_dal_file') {
      if (!process.env.ADMIN) return errore(res, 'P0005', "Solo l'amministratore");
      fs.writeFileSync('/tmp/mercato_dal_file.json', JSON.stringify({ round: b.p_round, rose: (b.p_rose || []).length, listone: (b.p_listone || []).length }));
      if ((b.p_listone || []).length) {
        listone.length = 0;
        b.p_listone.forEach(x => listone.push({ id: ++listoneId, ruolo: x.ruolo, nome: x.nome, club: x.squadra || null, origine: 'file' }));
      }
      let riportate = 0;
      market_ops.filter(o => !o.annullata_at && !o.riportata_at).forEach(o => {
        if ((b.p_rose || []).some(r => idOf(r.squadra) === o.team_id && r.slot === o.slot && norm(r.nome) === norm(o.entra_nome))) {
          o.riportata_at = new Date().toISOString(); o.riportata_round = b.p_round; riportate++;
        } else if (!listone.some(l => norm(l.nome) === norm(o.esce_nome))) {
          listone.push({ id: ++listoneId, ruolo: o.ruolo, nome: o.esce_nome, club: o.esce_club, origine: 'svincolo' });
        }
      });
      const differenze = [];
      (b.p_rose || []).forEach(r => {
        const t = idOf(r.squadra), sul = players.find(x => x.team_id === t && x.slot === r.slot);
        if (t && norm(sul && sul.name) !== norm(r.nome)) {
          const op = market_ops.find(o => !o.annullata_at && !o.riportata_at && o.team_id === t && o.slot === r.slot);
          differenze.push({ team_id: t, slot: r.slot, nel_file: r.nome, sul_sito: sul ? sul.name : null, operazione: op ? op.id : null });
        }
      });
      return json(res, 200, { listone: listone.length, riportate, in_sospeso: market_ops.filter(o => !o.annullata_at && !o.riportata_at).length, differenze });
    }
    if (m && TAB[m[1]]) {
      let righe = filtra(TAB[m[1]], q);
      if (m[1] === 'market_ops' && q.order === 'id') righe = righe.slice().sort((x, y) => x.id - y.id);
      if (q.offset) righe = righe.slice(+q.offset);
      if (q.limit) righe = righe.slice(0, +q.limit);
      return json(res, 200, righe);
    }
    if (SCH.gestisci(req, res, p, q, b) !== false) return;
    json(res, 404, { message: 'non trovato: ' + p });
  });
}).listen(8899, 'localhost', () => console.log('finto Supabase (sito) su 8899 — giornata', dati.giornata));
