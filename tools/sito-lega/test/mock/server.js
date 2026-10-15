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
const roster_costs = dati.rose.map(r => ({ team_id: idOf(r.squadra), slot: r.slot, nome: r.nome, costo: r.costo, valore: r.valore, anno: r.anno }));
const penale = (costo, anno) => anno >= 1 && anno <= 3 && costo != null ? Math.round(costo / (anno + 2)) : null;
// il ruolo viene dalla riga di ROSE: P 1–4, D 5–14, C 15–24, A 25–31
const ruoloDi = slot => slot <= 4 ? 'P' : slot <= 14 ? 'D' : slot <= 24 ? 'C' : 'A';
const players = dati.rose.map(r => ({ id: 'pl-' + idOf(r.squadra) + '-' + r.slot, team_id: idOf(r.squadra), slot: r.slot, name: r.nome, club: null,
  role: ruoloDi(r.slot) }));
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

// mercato (db/11 e 13): il LISTONE del file e le operazioni composte (movimenti).
// NOMERCATO = 11 non eseguito, NOOP13 = 13 non eseguito
let listoneId = 0;
const listone = (dati.listone || []).map(x => ({ id: ++listoneId, ruolo: x.ruolo, nome: x.nome, club: x.squadra || null, origine: 'file' }));
const market_ops = [];
const rosa_limiti = [
  { ruolo: 'T', minimo: 22, massimo: 29, riga_da: 1, riga_a: 31 }, { ruolo: 'P', minimo: 3, massimo: 4, riga_da: 1, riga_a: 4 },
  { ruolo: 'D', minimo: 7, massimo: 10, riga_da: 5, riga_a: 14 }, { ruolo: 'C', minimo: 7, massimo: 10, riga_da: 15, riga_a: 24 },
  { ruolo: 'A', minimo: 5, massimo: 7, riga_da: 25, riga_a: 31 }];
let modello = null;                         // il modello .xls caricato dal sito (dopo un'operazione)
const MODELLO = process.env.FORMAZIONI || '/home/claude/Formazioni.xls';
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aperte = () => market_ops.filter(o => !o.annullata_at && !o.riportata_at);
// quanto spende ogni squadra nelle operazioni non ancora nel file (come mercato_spesa)
const spesaDi = (id, ops) => (ops || aperte()).reduce((a, o) => a + o.market_moves.reduce((b, v) =>
  b + ((v.tipo === 'svincolo' || v.tipo === 'crediti') && v.team_da === id ? v.costo : 0)
    + (v.tipo === 'acquisto' && v.team_a === id ? v.costo : 0) - (v.tipo === 'crediti' && v.team_a === id ? v.costo : 0), 0), 0);
const creditiDi = id => {
  const ts = team_season.find(t => t.team_id === id);
  return !ts || ts.crediti == null ? null : ts.crediti - spesaDi(id);
};
const RUOLI_PL = { T: 'giocatori', P: 'portieri', D: 'difensori', C: 'centrocampisti', A: 'attaccanti' };
const nomeSq = id => (teams.find(t => t.id === id) || {}).name;
const errore = (res, code, message) => json(res, 400, { code, message });

const TAB = { teams, rounds, matches, round_teams, standings, team_season, scorers, roster_costs, players, player_votes, player_stats, albo, fc_stats, fc_stats_meta, listone, market_ops, rosa_limiti };

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
    if (process.env.NOOP13 && (['/rest/v1/rpc/mercato_operazione', '/rest/v1/rpc/mercato_riportata'].includes(p) || (m && m[1] === 'rosa_limiti'))) {
      return json(res, 404, m && !p.includes('/rpc/') ? { code: 'PGRST205', message: "Could not find the table 'public." + m[1] + "' in the schema cache" }
        : { code: 'PGRST202', message: 'Could not find the function in the schema cache' });
    }
    if (process.env.NOOP13 && m && m[1] === 'roster_costs' && String(q.select || '').includes('anno')) {
      return json(res, 400, { code: '42703', message: 'column roster_costs.anno does not exist' });
    }
    if (process.env.NOOP13 && m && m[1] === 'market_ops' && String(q.select || '').includes('market_moves')) {
      return json(res, 400, { code: 'PGRST200', message: "Could not find a relationship between 'market_ops' and 'market_moves' in the schema cache" });
    }
    if (p === '/rest/v1/rpc/mercato_crediti') {
      return json(res, 200, teams.map(t => ({ team_id: t.id, crediti: creditiDi(t.id), dal_file: (team_season.find(x => x.team_id === t.id) || {}).crediti, round: dati.giornata,
        in_sospeso: aperte().filter(o => o.market_moves.some(v => v.team_da === t.id || v.team_a === t.id)).length })));
    }
    if (p === '/rest/v1/rpc/mercato_operazione') {
      if (!process.env.ADMIN) return errore(res, 'P0005', "Solo l'amministratore può fare operazioni di mercato");
      const op = b.p || {}, mov = [];
      fs.writeFileSync('/tmp/mercato_richiesta.json', JSON.stringify(op));
      const rc = pl => roster_costs.find(x => x.team_id === pl.team_id && x.slot === pl.slot && norm(x.nome) === norm(pl.name)) || {};
      for (const e of op.svincoli || []) {
        const pl = players.find(x => x.id === e.player_id);
        if (!pl || pl.slot == null) return errore(res, 'P0010', 'Un giocatore da svincolare non è più in rosa');
        mov.push({ tipo: 'svincolo', pl, ruolo: pl.role, nome: pl.name, club: pl.club, team_da: pl.team_id, slot_da: pl.slot, da_id: pl.id,
          costo: Math.round(e.costo != null ? e.costo : (rc(pl).valore || 0)), costo_prima: rc(pl).costo, valore_prima: rc(pl).valore, anno: rc(pl).anno });
      }
      for (const e of op.cessioni || []) {
        const pl = players.find(x => x.id === e.player_id);
        if (!pl || pl.slot == null) return errore(res, 'P0010', 'Un giocatore da cedere non è più in rosa');
        if (!teams.some(t => t.id === e.team_id)) return errore(res, 'P0016', `Cessione di ${pl.name}: squadra di arrivo non trovata`);
        if (e.team_id === pl.team_id) return errore(res, 'P0016', `${pl.name} è già di quella squadra`);
        const c = rc(pl), costo = e.costo != null ? e.costo : (c.costo != null ? c.costo : 0);
        const val = penale(costo, c.anno);
        mov.push({ tipo: 'cessione', pl, ruolo: pl.role, nome: pl.name, club: pl.club, team_da: pl.team_id, team_a: e.team_id, slot_da: pl.slot, da_id: pl.id,
          costo, valore: val != null ? val : (costo === c.costo ? c.valore : null), costo_prima: c.costo, valore_prima: c.valore, anno: c.anno });
      }
      for (const e of op.acquisti || []) {
        const li = listone.find(x => x.id === e.listone_id);
        if (!li) return errore(res, 'P0011', 'Un giocatore da prendere non è più fra gli svincolati');
        if (!teams.some(t => t.id === e.team_id)) return errore(res, 'P0016', `Acquisto di ${li.nome}: squadra non trovata`);
        if ((e.costo || 0) < 0) return errore(res, 'P0013', `Il costo dell'acquisto di ${li.nome} non può essere negativo`);
        const costo = Math.round(e.costo || 0);
        mov.push({ tipo: 'acquisto', li, ruolo: li.ruolo, nome: li.nome, club: li.club, team_a: e.team_id, costo, valore: penale(costo, 1), anno: 1 });
      }
      for (const e of op.crediti || []) {
        if (!e.da || !e.a || e.da === e.a || !(e.crediti > 0)) return errore(res, 'P0016', 'Passaggio di crediti non valido: servono due squadre diverse e almeno un credito');
        mov.push({ tipo: 'crediti', team_da: e.da, team_a: e.a, costo: Math.round(e.crediti) });
      }
      if (!mov.length) return errore(res, 'P0016', "L'operazione è vuota");
      const visti = new Set(), doppi = [];
      mov.filter(v => v.pl || v.li).forEach(v => { const k = v.pl ? v.pl.id : 'l' + v.li.id; if (visti.has(k)) doppi.push(v.nome); visti.add(k); });
      if (doppi.length) return errore(res, 'P0016', 'Nella stessa operazione due volte: ' + doppi.join(', '));
      // limiti delle rose alla fine
      const delta = {};
      const d = (t, r, n) => { delta[t] = delta[t] || { P: 0, D: 0, C: 0, A: 0 }; delta[t][r] += n; };
      mov.forEach(v => { if (v.tipo === 'svincolo' || v.tipo === 'cessione') d(v.team_da, v.ruolo, -1); if (v.tipo === 'acquisto' || v.tipo === 'cessione') d(v.team_a, v.ruolo, 1); });
      const fuori = Object.keys(delta).sort((x, y) => nomeSq(x).localeCompare(nomeSq(y))).map(t => {
        const n = { P: 0, D: 0, C: 0, A: 0 };
        players.filter(x => x.team_id === t && x.slot != null).forEach(x => n[x.role]++);
        Object.keys(n).forEach(r => { n[r] += delta[t][r]; });
        n.T = n.P + n.D + n.C + n.A;
        const pr = ['T', 'P', 'D', 'C', 'A'].map(r => { const l = rosa_limiti.find(y => y.ruolo === r);
          return n[r] < l.minimo ? `${RUOLI_PL[r]} ${n[r]} (minimo ${l.minimo})` : n[r] > l.massimo ? `${RUOLI_PL[r]} ${n[r]} (massimo ${l.massimo})` : null; }).filter(Boolean);
        return pr.length ? nomeSq(t) + ': ' + pr.join(', ') : null;
      }).filter(Boolean);
      if (fuori.length) return errore(res, 'P0017', 'Limiti della rosa: ' + fuori.join('; '));
      // crediti
      const tocca = [...new Set(mov.map(v => v.team_da).concat(mov.map(v => v.team_a)).filter(Boolean))].sort((x, y) => nomeSq(x).localeCompare(nomeSq(y)));
      const finta = [{ market_moves: mov }];
      const crediti = tocca.map(t => { const pr = creditiDi(t); return { team_id: t, prima: pr, dopo: pr == null ? null : pr - spesaDi(t, finta) }; });
      const neg = crediti.filter(c => c.dopo != null && c.dopo < 0);
      if (neg.length) return errore(res, 'P0014', 'Crediti insufficienti: ' + neg.map(c => `${nomeSq(c.team_id)} ne ha ${c.prima}, l'operazione gliene toglie ${c.prima - c.dopo}`).join('; '));
      // fatto: chi esce, poi chi entra
      const id = market_ops.length + 1, ora = new Date().toISOString(), formazioni = [];
      mov.forEach((v, i) => { v.n = i + 1; });
      mov.filter(v => v.tipo === 'svincolo' || v.tipo === 'cessione').forEach(v => {
        v.pl.slot = null; v.pl.fuori_rosa_at = ora;
        const k = roster_costs.findIndex(x => x.team_id === v.team_da && x.slot === v.slot_da); if (k >= 0) roster_costs.splice(k, 1);
        v.formazioni = process.env.PRELOAD && v.team_da === 'team-Valerio' ? [{ team_id: v.team_da, matchday: 7, pos: 12, nome: v.nome }] : [];
        formazioni.push(...v.formazioni);
        if (v.tipo === 'svincolo') listone.push({ id: ++listoneId, ruolo: v.ruolo, nome: v.nome, club: v.club, origine: 'svincolo' });
      });
      mov.filter(v => v.tipo === 'acquisto' || v.tipo === 'cessione').forEach(v => {
        const l = rosa_limiti.find(y => y.ruolo === v.ruolo);
        const libero = s => !players.some(x => x.team_id === v.team_a && x.slot === s);
        const via = mov.find(w => (w.tipo === 'svincolo' || w.tipo === 'cessione') && w.team_da === v.team_a && w.ruolo === v.ruolo && libero(w.slot_da));
        let slot = via ? via.slot_da : null;
        for (let s = l.riga_da; slot == null && s <= l.riga_a; s++) if (libero(s)) slot = s;
        const nuovo = { id: 'pl-nuovo-' + id + '-' + v.n, team_id: v.team_a, slot, role: v.ruolo, name: v.nome, club: v.club || null };
        players.push(nuovo);
        roster_costs.push({ team_id: v.team_a, slot, nome: v.nome, costo: v.costo, valore: v.valore != null ? v.valore : null, anno: v.anno || null });
        if (v.tipo === 'acquisto') listone.splice(listone.indexOf(v.li), 1);
        v.slot_a = slot; v.a_id = nuovo.id;
      });
      const moves = mov.map(v => ({ id: id * 100 + v.n, op_id: id, n: v.n, tipo: v.tipo, ruolo: v.ruolo || null, nome: v.nome || null, club: v.club || null,
        team_da: v.team_da || null, team_a: v.team_a || null, slot_da: v.slot_da != null ? v.slot_da : null, slot_a: v.slot_a != null ? v.slot_a : null,
        da_id: v.da_id || null, a_id: v.a_id || null, costo: v.costo, valore: v.valore != null ? v.valore : null,
        costo_prima: v.costo_prima != null ? v.costo_prima : null, valore_prima: v.valore_prima != null ? v.valore_prima : null, anno: v.anno || null,
        formazioni: v.formazioni || null }));
      const o = { id, at: ora, tipo: 'composta', crediti, note: op.note || null, formazioni: formazioni.length ? formazioni : null,
        modello_at: null, riportata_at: null, riportata_round: null, annullata_at: null, market_moves: moves };
      market_ops.unshift(o);
      fs.writeFileSync('/tmp/mercato_op.json', JSON.stringify(o));
      return json(res, 200, { id, movimenti: moves.length, crediti, formazioni,
        righe: moves.map(v => ({ n: v.n, tipo: v.tipo, nome: v.nome, team_da: v.team_da, team_a: v.team_a, slot_da: v.slot_da, slot_a: v.slot_a })) });
    }
    if (p === '/rest/v1/rpc/mercato_annulla') {
      if (!process.env.ADMIN) return errore(res, 'P0005', "Solo l'amministratore può annullare le operazioni");
      const o = market_ops.find(x => x.id === b.p_op);
      if (!o || o.annullata_at) return errore(res, 'P0015', 'Operazione non trovata o già annullata');
      if (market_ops.some(x => x.id > o.id && !x.annullata_at)) return errore(res, 'P0015', "Si può annullare solo l'ultima operazione");
      if (o.riportata_at) return errore(res, 'P0015', "È già nel file di giornata: per tornare indietro fai l'operazione inversa");
      const mv = o.market_moves;
      mv.filter(v => v.tipo === 'acquisto' || v.tipo === 'cessione').forEach(v => {
        const k = players.findIndex(x => x.id === v.a_id); if (k >= 0) players.splice(k, 1);
        const c = roster_costs.findIndex(x => x.team_id === v.team_a && x.slot === v.slot_a); if (c >= 0) roster_costs.splice(c, 1);
        if (v.tipo === 'acquisto') listone.push({ id: ++listoneId, ruolo: v.ruolo, nome: v.nome, club: v.club, origine: 'file' });
      });
      mv.filter(v => v.tipo === 'svincolo' || v.tipo === 'cessione').forEach(v => {
        const pl = players.find(x => x.id === v.da_id); pl.slot = v.slot_da; pl.fuori_rosa_at = null;
        roster_costs.push({ team_id: v.team_da, slot: v.slot_da, nome: v.nome, costo: v.costo_prima, valore: v.valore_prima, anno: v.anno });
        if (v.tipo === 'svincolo') { const k = listone.findIndex(x => norm(x.nome) === norm(v.nome)); if (k >= 0) listone.splice(k, 1); }
      });
      o.annullata_at = new Date().toISOString();
      return json(res, 200, { id: o.id, formazioni: o.formazioni, rimessi: 0 });
    }
    if (p === '/rest/v1/rpc/mercato_riportata') {
      if (!process.env.ADMIN) return errore(res, 'P0005', "Solo l'amministratore");
      const o = market_ops.find(x => x.id === b.p_op);
      if (!o || o.annullata_at) return errore(res, 'P0015', 'Operazione non trovata o annullata');
      o.riportata_at = o.riportata_at || new Date().toISOString(); o.riportata_round = o.riportata_round || dati.giornata;
      return json(res, 200, { id: o.id });
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
      const rose = b.p_rose || [];
      const nelFile = (t, s, n) => rose.some(r => idOf(r.squadra) === t && r.slot === s && norm(r.nome) === norm(n));
      let riportate = 0;
      aperte().forEach(o => {
        const mv = o.market_moves;
        if (rose.length && mv.some(v => v.tipo !== 'crediti') &&
            mv.filter(v => v.tipo === 'acquisto' || v.tipo === 'cessione').every(v => nelFile(v.team_a, v.slot_a, v.nome)) &&
            !mv.filter(v => v.tipo === 'svincolo' || v.tipo === 'cessione').some(v => nelFile(v.team_da, v.slot_da, v.nome))) {
          o.riportata_at = new Date().toISOString(); o.riportata_round = b.p_round; riportate++;
        }
      });
      // l'anno di contratto dal file; le righe di chi è entrato con operazioni non ancora nel file restano quelle
      rose.forEach(r => { const x = roster_costs.find(c => c.team_id === idOf(r.squadra) && c.slot === r.slot && norm(c.nome) === norm(r.nome)); if (x) x.anno = r.anno; });
      aperte().forEach(o => o.market_moves.filter(v => (v.tipo === 'acquisto' || v.tipo === 'cessione') && players.some(x => x.id === v.a_id && x.slot === v.slot_a)).forEach(v => {
        const k = roster_costs.findIndex(c => c.team_id === v.team_a && c.slot === v.slot_a); if (k >= 0) roster_costs.splice(k, 1);
        roster_costs.push({ team_id: v.team_a, slot: v.slot_a, nome: v.nome, costo: v.costo, valore: v.valore, anno: v.anno });
      }));
      aperte().forEach(o => o.market_moves.filter(v => v.tipo === 'svincolo').forEach(v => {
        if (!listone.some(l => norm(l.nome) === norm(v.nome)) && !players.some(x => x.slot != null && norm(x.name) === norm(v.nome)))
          listone.push({ id: ++listoneId, ruolo: v.ruolo, nome: v.nome, club: v.club, origine: 'svincolo' });
      }));
      const differenze = [];
      rose.forEach(r => {
        const t = idOf(r.squadra), sul = players.find(x => x.team_id === t && x.slot === r.slot);
        if (t && norm(sul && sul.name) !== norm(r.nome)) {
          const op = aperte().find(o => o.market_moves.some(v => (v.team_a === t && v.slot_a === r.slot) || (v.team_da === t && v.slot_da === r.slot)));
          differenze.push({ team_id: t, slot: r.slot, nel_file: r.nome, sul_sito: sul ? sul.name : null, operazione: op ? op.id : null });
        }
      });
      // posti occupati sul sito e vuoti nel file
      players.filter(x => x.slot != null && !rose.some(r => idOf(r.squadra) === x.team_id && r.slot === x.slot)).forEach(x => {
        const op = aperte().find(o => o.market_moves.some(v => v.team_a === x.team_id && v.slot_a === x.slot));
        differenze.push({ team_id: x.team_id, slot: x.slot, nel_file: null, sul_sito: x.name, operazione: op ? op.id : null });
      });
      return json(res, 200, { listone: listone.length, riportate, in_sospeso: aperte().length, differenze });
    }
    if (m && TAB[m[1]]) {
      let righe = filtra(TAB[m[1]], q);
      if (m[1] === 'market_ops' && q.order === 'id') righe = righe.slice().sort((x, y) => x.id - y.id);
      if (m[1] === 'roster_costs' && process.env.NOOP13) righe = righe.map(r => { const c = Object.assign({}, r); delete c.anno; return c; });
      if (q.offset) righe = righe.slice(+q.offset);
      if (q.limit) righe = righe.slice(0, +q.limit);
      return json(res, 200, righe);
    }
    if (SCH.gestisci(req, res, p, q, b) !== false) return;
    json(res, 404, { message: 'non trovato: ' + p });
  });
}).listen(8899, 'localhost', () => console.log('finto Supabase (sito) su 8899 — giornata', dati.giornata));
