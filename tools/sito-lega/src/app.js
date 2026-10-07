/* Il Solito Culo — il sito della lega.
 * Rose, calendario, classifiche, statistiche, coppe, playoff, albo d'oro.
 * I dati arrivano dal database (Supabase), alimentato dal file .xls di giornata. */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROLE = { P: 'Portieri', D: 'Difensori', C: 'Centrocampisti', A: 'Attaccanti' };
  const LS = 'ilsolitoculo:v1';
  const n1 = v => (v == null || v === '' ? '—' : (Math.round(v * 100) / 100).toString().replace('.', ','));
  const nz = v => (v == null ? 0 : +v);

  const S = {
    profile: null, team: null, teams: [], rounds: [], matches: [], md: null,
    cache: {}, sezione: '', sotto: '', pronta: false, mancanti: []
  };

  const prefs = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } };
  const setPrefs = p => { try { localStorage.setItem(LS, JSON.stringify(p)); } catch (e) { /* ok */ } };

  const teamById = id => S.teams.find(t => t.id === id) || null;
  // "MarcoI" si legge male: sullo schermo diventa "Marco I"
  const bel = n => String(n || '').replace(/([a-zà-ÿ])(I+)$/, '$1 $2');
  const teamName = id => { const t = teamById(id); return t ? bel(t.name) : '\u2014'; };
  const isMe = id => !!(S.team && id === S.team.id);
  const isAdmin = () => !!(S.profile && S.profile.role === 'admin');
  const giocate = () => S.rounds.filter(r => r.giocata);
  const ultima = () => { const g = giocate(); return g.length ? g[g.length - 1] : null; };

  // ------------------------------------------------------------------ dati
  async function carica(chiave, fn) {
    if (S.cache[chiave] === undefined) S.cache[chiave] = await fn();
    return S.cache[chiave];
  }

  // Se il database della stagione non è ancora stato creato, il sito non deve
  // piantarsi: segna la tabella mancante e va avanti con quello che c'è.
  const NON_CE = e => !!(e && (e.code === 'PGRST205' || e.code === '42P01' ||
    /schema cache|does not exist|non trovat/i.test(e.message || '')));

  async function forse(tabella, query) {
    try {
      return await SB.select(tabella, query);
    } catch (e) {
      if (!NON_CE(e)) throw e;
      if (S.mancanti.indexOf(tabella) < 0) S.mancanti.push(tabella);
      return [];
    }
  }

  async function caricaBase() {
    const uid = (SB.user() || {}).id || ((await SB.me()) || {}).id;
    const prof = (await SB.select('profiles', 'select=display_name,role,team_id&id=eq.' + uid))[0];
    if (!prof) throw new SB.SbError('Profilo non trovato: scrivi all’amministratore.', 'no_profile');
    S.profile = prof;
    S.teams = await SB.select('teams', 'select=id,name,sheet_name&order=name');
    S.team = S.teams.find(t => t.id === prof.team_id) || null;
    S.mancanti = [];
    S.rounds = await forse('rounds', 'select=id,serie_a,fase,label,giocata,caricata_at&order=id');
    S.matches = await forse('matches', 'select=round,slot,casa,fuori,pos_casa,pos_fuori,gol_casa,gol_fuori,punti_casa,punti_fuori,totale_casa,totale_fuori,modulo_casa,modulo_fuori&competizione=eq.campionato&order=round,slot');
    // la giornata di Serie A in corso (quella in cui si schiera)
    try { S.md = (await SB.select('matchdays', 'select=id,label&is_current=is.true&limit=1'))[0] || null; } catch (e) { S.md = null; }
    S.cache = {};
    S.pronta = true;
  }

  const classifiche = tipo => carica('st:' + tipo, () =>
    forse('standings', 'select=round,team_id,pos,valore,dati&tipo=eq.' + tipo + '&order=round,pos'));
  const tabellini = round => carica('rt:' + round, () =>
    forse('round_teams', 'select=*&round=eq.' + round));
  const rose = () => carica('players', () =>
    forse('players', 'select=id,team_id,slot,role,name,club&order=team_id,slot'));
  const costi = () => carica('costi', () => forse('roster_costs', 'select=team_id,slot,nome,costo,valore'));
  const statGiocatori = () => carica('pstats', () => forse('player_stats', 'select=*'));
  const marcatori = () => carica('scorers', async () => {
    const u = ultima();
    return u ? forse('scorers', 'select=team_id,nome,gol,gol_sfruttati&round=eq.' + u.id + '&order=gol.desc') : [];
  });
  const stagione = () => carica('season', async () => {
    const u = ultima();
    return u ? forse('team_season', 'select=team_id,crediti,gol_totali,gol_sfruttati&round=eq.' + u.id) : [];
  });
  const alboDoro = () => carica('albo', () => forse('albo', 'select=*&order=stagione.desc'));

  // Tutte le righe, a pagine da 1000 (Supabase non ne dà di più per volta)
  async function tutte(tabella, query, prova) {
    const out = [];
    for (let off = 0; off < 60000; off += 1000) {
      const q = query + '&limit=1000&offset=' + off;
      const pag = prova ? await SB.select(tabella, q) : await forse(tabella, q);
      out.push.apply(out, pag);
      if (pag.length < 1000) break;
    }
    return out;
  }
  const votiTutti = () => carica('voti', () => tutte('player_votes', 'select=round,team_id,nome,ruolo,voto,fantavoto&order=round,team_id,nome'));
  const tabelliniTutti = () => carica('rt', () => tutte('round_teams', 'select=round,team_id,punteggio,formazione&order=round,team_id'));
  // le formazioni salvate in Schiera per una giornata di Serie A: sempre fresche
  async function salvate(serieA) {
    if (!serieA) return [];
    try {
      return await SB.select('lineups', 'select=team_id,module,updated_at,lineup_slots(pos,players(name,role,club,slot))&matchday=eq.' + serieA);
    } catch (e) { console.error(e); return []; }
  }
  // medie di Serie A di Fantacalcio.it (db/10_fantacalcio.sql); se le tabelle non ci sono, niente
  const fc = () => carica('fc', async () => {
    try {
      const meta = (await SB.select('fc_stats_meta', 'select=aggiornate_at,file,stagione,righe'))[0] || null;
      const righe = meta ? await tutte('fc_stats', 'select=nome,squadra,ruolo,pv,mv,fm,gf,ass&order=id', true) : [];
      return { meta, righe };
    } catch (e) {
      return { meta: null, righe: [], manca: NON_CE(e) };
    }
  });

  // la giornata di lega in corso: quella della giornata di Serie A in cui si schiera
  function roundCorrente() {
    const r = S.md ? S.rounds.find(x => x.serie_a === S.md.id) : null;
    return r || S.rounds.find(x => !x.giocata) || ultima();
  }
  const quando = ts => ts ? new Date(ts).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  // ------------------------------------------------- calcoli fatti in casa
  // Punti accumulati giornata per giornata (3 vittoria, 1 pareggio): serve al grafico.
  function andamento() {
    const per = new Map(S.teams.map(t => [t.id, []]));
    const tot = new Map(S.teams.map(t => [t.id, 0]));
    giocate().forEach(r => {
      S.matches.filter(m => m.round === r.id && m.gol_casa != null).forEach(m => {
        const a = m.gol_casa, b = m.gol_fuori;
        if (m.casa) tot.set(m.casa, nz(tot.get(m.casa)) + (a > b ? 3 : a === b ? 1 : 0));
        if (m.fuori) tot.set(m.fuori, nz(tot.get(m.fuori)) + (b > a ? 3 : a === b ? 1 : 0));
      });
      S.teams.forEach(t => per.get(t.id).push({ x: r.id, y: tot.get(t.id) }));
    });
    return per;
  }

  function partiteDi(teamId) {
    return S.matches.filter(m => m.casa === teamId || m.fuori === teamId);
  }

  // ------------------------------------------------------------- grafici
  // Una linea in evidenza (la squadra scelta) e le altre come sfondo grigio:
  // niente spaghetti di otto colori su uno schermo da telefono.
  function grafico(serie, opts) {
    opts = opts || {};
    const W = 360, H = opts.h || 190, ML = 24, MR = 64, MT = 12, MB = 22;
    const punti = [].concat.apply([], serie.map(s => s.punti));
    if (punti.length < 2) return '<p class="empty">Servono almeno due giornate per il grafico.</p>';
    const xs = punti.map(p => p.x), ys = punti.map(p => p.y);
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    let y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (opts.dominio) { y0 = opts.dominio[0]; y1 = opts.dominio[1]; }
    if (opts.inverti) { const t = y0; y0 = y1; y1 = t; }
    if (y0 === y1) { y1 = y0 + 1; }
    const X = v => ML + (W - ML - MR) * (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0));
    const Y = v => MT + (H - MT - MB) * (1 - (v - y0) / (y1 - y0));
    const path = s => s.punti.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');

    const griglia = [];
    const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    const passo = opts.passo || passoBello(Math.max(1, hi - lo));
    for (let v = Math.ceil(lo / passo - 1e-9) * passo; v <= hi + 1e-9; v += passo) {
      griglia.push(`<line x1="${ML}" x2="${W - MR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1"/>` +
        `<text x="${ML - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${n1(v)}</text>`);
    }
    const assex = [];
    for (let v = x0; v <= x1; v++) {
      if (x1 - x0 > 9 && v % 2 === 0) continue;
      assex.push(`<text x="${X(v).toFixed(1)}" y="${H - 6}" text-anchor="middle">${v}</text>`);
    }
    const sfondo = serie.filter(s => !s.evidenzia).map(s =>
      `<path d="${path(s)}" fill="none" stroke="var(--chart-mute)" stroke-width="1.5" stroke-opacity=".38" stroke-linejoin="round"/>`).join('');
    const inEvidenza = serie.filter(s => s.evidenzia).sort((a, b) => (b.colore === 'mute') - (a.colore === 'mute'));
    const colore = s => (s.colore === 'b' ? 'var(--chart-b)' : s.colore === 'mute' ? 'var(--chart-mute)' : 'var(--chart-accent)');
    const usate = [];
    const top = inEvidenza.map(s => {
      const ult = s.punti[s.punti.length - 1];
      let y = Y(ult.y) + 4;
      while (usate.some(v => Math.abs(v - y) < 11)) y += 11;   // etichette che non si accavallano
      usate.push(y);
      // la linea di riferimento (media della lega) è grigia e senza punti
      const punti = s.colore === 'mute' ? '' : s.punti.map(p => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="4.5" fill="${colore(s)}" stroke="var(--surface)" stroke-width="2"/>`).join('');
      return `<path d="${path(s)}" fill="none" stroke="${colore(s)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` + punti +
        `<text class="lbl" x="${(X(ult.x) + 8).toFixed(1)}" y="${y.toFixed(1)}">${esc(s.et || bel(s.nome))}</text>`;
    }).join('');
    const legenda = inEvidenza.length > 1
      ? `<div class="legend">${inEvidenza.map(s => `<span class="${s.colore === 'b' ? 'b' : s.colore === 'mute' ? 'm' : ''}"><i></i>${esc(bel(s.nome))}</span>`).join('')}</div>`
      : '';
    const dati = JSON.stringify(inEvidenza.map(s => ({ n: bel(s.nome), p: s.punti.map(p => [p.x, p.y]) })));
    return `${legenda}<div class="chart-wrap" data-tip="${esc(dati)}">
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.alt || 'Andamento')}">
        ${griglia.join('')}${assex.join('')}${sfondo}${top}
      </svg><div class="tip" hidden></div></div>`;
  }

  // ---------------------------------------------------------------- pezzi
  const tile = (v, et, cls) => `<div class="tile ${cls || ''}"><b>${esc(v)}</b><span>${esc(et)}</span></div>`;

  function rigaPartita(m, opts) {
    const casa = m.casa ? teamName(m.casa) : (m.pos_casa ? m.pos_casa + 'º in classifica' : '—');
    const fuori = m.fuori ? teamName(m.fuori) : (m.pos_fuori ? m.pos_fuori + 'º in classifica' : '—');
    const g = m.gol_casa != null;
    const cls = !g ? '' : m.gol_casa > m.gol_fuori ? 'win-h' : m.gol_casa < m.gol_fuori ? 'win-a' : '';
    const pts = g && m.totale_casa != null ? `<span class="pts">${n1(m.totale_casa)} · ${n1(m.totale_fuori)}</span>` : '';
    const punteggio = g ? `${m.gol_casa}<span aria-hidden="true">–</span>${m.gol_fuori}` : (opts && opts.ora ? '—' : 'da giocare');
    const tocco = g ? 'data-match="' + m.round + ':' + m.slot + '"'
      : (m.casa && m.fuori && !(opts && opts.fisso) ? 'data-formazioni="' + m.round + ':' + m.slot + '"' : 'disabled');
    return `<button type="button" class="match ${cls}" ${tocco}>
      <span class="t">${esc(casa)}</span>
      <span><span class="score">${punteggio}</span>${pts}</span>
      <span class="t a">${esc(fuori)}</span></button>`;
  }

  // ------------------------------------------------------------------ Home
  async function home() {
    const u = ultima();
    if (!u) {
      return `<div class="card"><h2>Ancora nessuna giornata</h2>
        <p class="muted">Quando l’amministratore carica il primo file di giornata, qui compaiono risultati, classifiche e statistiche.</p></div>`;
    }
    const camp = (await classifiche('campionato')).filter(r => r.round === u.id);
    const mia = S.team ? camp.find(r => r.team_id === S.team.id) : null;
    const mieP = S.team ? partiteDi(S.team.id) : [];
    const ultimaP = mieP.filter(m => m.round === u.id)[0];
    const prossima = mieP.filter(m => m.gol_casa == null)[0];
    const cdl = (await classifiche('coppa_lega')).filter(r => r.round === u.id);
    const cdlMia = S.team ? cdl.find(r => r.team_id === S.team.id) : null;

    const tiles = mia ? `<div class="tiles">
      ${tile(mia.pos + 'º', 'in campionato')}
      ${tile(n1(mia.valore), 'punti')}
      ${tile((mia.dati && mia.dati.gf) + '-' + (mia.dati && mia.dati.gs), 'gol fatti-subiti')}
      ${tile(cdlMia ? n1(cdlMia.dati && cdlMia.dati.media) : '—', 'media a giornata')}
    </div>` : '';

    const serie = andamento();
    const grafiche = S.teams.map(t => ({ nome: t.name, evidenzia: isMe(t.id), punti: serie.get(t.id) || [] }));

    return `<div class="stack">
      <div class="card">
        <div class="sec-h"><h2>${esc(S.team ? bel(S.team.name) : 'La lega')}</h2><span>${esc(u.label || 'Giornata ' + u.id)} · ${giocate().length}/20</span></div>
        ${tiles}
        ${ultimaP ? '<div>' + rigaPartita(ultimaP) + '</div>' : ''}
        ${prossima ? `<p class="small muted" style="margin:0">Prossima: <b>${esc(prossima.casa ? teamName(prossima.casa) : 'da definire')}</b> – <b>${esc(prossima.fuori ? teamName(prossima.fuori) : 'da definire')}</b> (giornata ${prossima.round}, ${prossima.round + 2}ª di Serie A)</p>` : ''}
      </div>

      <div class="card">
        <div class="sec-h"><h3>Giornata ${u.id}</h3><span>${u.serie_a ? u.serie_a + 'ª di Serie A' : ''}</span></div>
        <div>${S.matches.filter(m => m.round === u.id).map(m => rigaPartita(m)).join('')}</div>
      </div>

      <div class="card">
        <div class="sec-h"><h3>Andamento</h3><span>punti accumulati</span></div>
        ${grafico(grafiche, { alt: 'Punti accumulati giornata per giornata' })}
        <p class="small muted" style="margin:0">In evidenza ${esc(S.team ? bel(S.team.name) : 'la tua squadra')}; in grigio le altre sette.</p>
      </div>

      <div class="card">
        <div class="sec-h"><h3>Classifica</h3><a class="linkish" href="#/classifiche">tutte le classifiche</a></div>
        ${tabellaCampionato(camp, true)}
      </div>
    </div>`;
  }

  // -------------------------------------------------------------- classifiche
  function tabellaCampionato(righe, breve) {
    if (!righe.length) return '<p class="empty">Ancora nessuna classifica.</p>';
    const th = breve ? ['', 'Squadra', 'P.ti', 'G', 'DR'] : ['', 'Squadra', 'P.ti', 'M.I.', 'G', 'V', 'N', 'P', 'GF', 'GS', 'DR'];
    return `<div class="scroll-x"><table class="tbl"><thead><tr>${th.map((h, i) => `<th class="${i < 2 ? 'l' : ''}">${h}</th>`).join('')}</tr></thead><tbody>
      ${righe.map(r => {
        const d = r.dati || {};
        const celle = breve
          ? [n1(r.valore), d.g, (d.dr > 0 ? '+' : '') + nz(d.dr)]
          : [n1(r.valore), (d.mi > 0 ? '+' : '') + nz(d.mi), d.g, d.v, d.n, d.p, d.gf, d.gs, (d.dr > 0 ? '+' : '') + nz(d.dr)];
        return `<tr class="${isMe(r.team_id) ? 'me' : ''}"><td class="pos">${r.pos}</td><td class="l nm">${esc(teamName(r.team_id))}</td>${celle.map(c => `<td>${esc(c == null ? '—' : c)}</td>`).join('')}</tr>`;
      }).join('')}
    </tbody></table></div>`;
  }

  function tabellaSemplice(righe, colonne) {
    if (!righe.length) return '<p class="empty">Ancora niente da mostrare.</p>';
    return `<div class="scroll-x"><table class="tbl"><thead><tr><th class="l"></th><th class="l">Squadra</th>${colonne.map(c => `<th>${esc(c.et)}</th>`).join('')}</tr></thead><tbody>
      ${righe.map(r => `<tr class="${isMe(r.team_id) ? 'me' : ''}"><td class="pos">${r.pos}</td><td class="l nm">${esc(teamName(r.team_id))}</td>
        ${colonne.map(c => `<td>${esc(c.val(r))}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>`;
  }

  // le schede di Classifiche: le classifiche del regolamento, la Coppa e i playoff
  const CLASSIFICHE = [
    { id: 'campionato', et: 'Campionato', tipo: 'campionato' },
    { id: 'corretta', et: 'Corretta', tipo: 'super_corretta' },
    { id: 'coppa-di-lega', et: 'Coppa di Lega', tipo: 'coppa_lega' },
    { id: 'sfigometro', et: 'Sfigometro', tipo: 'sfigometro' },
    { id: 'gol-reali', et: 'Gol reali', tipo: 'gol_totali' },
    { id: 'coppa', et: 'Coppa', tipo: 'coppa' },
    { id: 'playoff', et: 'Playoff', tipo: null }
  ];

  async function sezioneClassifiche() {
    const u = ultima();
    const vecchia = { super_corretta: 'corretta', coppa_lega: 'coppa-di-lega', gol_totali: 'gol-reali' };
    let quale = S.sotto || vecchia[prefs().classifica] || prefs().classifica || 'campionato';
    if (!CLASSIFICHE.some(c => c.id === quale)) quale = 'campionato';
    if (S.sotto) { const p = prefs(); p.classifica = quale; setPrefs(p); }
    const testa = schede('classifiche', CLASSIFICHE.map(c => ({ id: c.id, et: c.et })), quale);
    if (quale === 'playoff') return `<div class="stack">${testa}${await vistaPlayoff()}</div>`;
    if (!u) return `<div class="stack">${testa}<div class="card"><p class="empty">Ancora nessuna giornata caricata.</p></div></div>`;
    const solo = async tipo => (await classifiche(tipo)).filter(r => r.round === u.id);
    let corpo = '', nota = '', dopo = '';
    if (quale === 'campionato') {
      corpo = tabellaCampionato(await solo('campionato'));
      nota = 'M.I. è la media inglese: punti in più o in meno rispetto a un pareggio a partita.';
      dopo = graficoPunti();
    } else if (quale === 'corretta') {
      const std = await solo('super_standard'), corr = await solo('super_corretta');
      const bonus = new Map(std.map(r => [r.team_id, r.dati || {}]));
      corpo = tabellaSemplice(corr, [
        { et: 'Punti', val: r => n1((bonus.get(r.team_id) || {}).punti) },
        { et: 'Bonus', val: r => n1((bonus.get(r.team_id) || {}).bonus) },
        { et: 'Totale', val: r => n1(r.valore) }
      ]);
      nota = 'Alla classifica del campionato si sommano i punti delle quattro classifiche della superclassifica (Coppa di Lega, sfigometro, gol reali totali e sfruttati).';
    } else if (quale === 'coppa') {
      const q = await solo('coppa');
      corpo = tabellaSemplice(q, [{ et: 'Punti', val: r => n1(r.valore) }]) +
        `<div class="sec-h" style="margin-top:6px"><h3>Accoppiamenti dei quarti</h3><span>gara unica in casa del meglio piazzato</span></div>` + accoppiamenti(q);
      nota = 'La classifica parallela somma campionato, Coppa di Lega, gol reali e crediti residui: determina gli accoppiamenti dei quarti (alla 23ª di Serie A). Semifinali A–B e C–D, poi la finale, in campo neutro o andata e ritorno a seconda di quante giornate liberano i playoff.';
      dopo = `<div class="card">
        <div class="sec-h"><h3>Supercoppa</h3><span>38ª di Serie A</span></div>
        <p class="small muted" style="margin:0">Finale fra il vincente del Campionato e il vincente della Coppa di Lega. Se i playoff liberano tre giornate si gioca anche la semifinale fra vincente della Coppa e vincente della Coppa di Lega.</p>
      </div>`;
    } else {
      const tipo = CLASSIFICHE.find(c => c.id === quale).tipo;
      const r = await solo(tipo);
      corpo = tabellaSemplice(r, [
        { et: 'Totale', val: x => n1((x.dati || {}).totale) },
        { et: 'Media', val: x => n1((x.dati || {}).media) },
        { et: 'Premio', val: x => n1((x.dati || {}).premio) },
        { et: 'Punti', val: x => n1(x.valore) }
      ]);
      nota = tipo === 'sfigometro' ? 'Lo sfigometro somma i punteggi degli avversari: più sei in alto, più ti è andata storta.'
        : tipo === 'gol_totali' ? 'Gol realmente segnati dai giocatori in rosa, schierati o no.'
        : 'Somma dei punteggi di giornata, senza fattore campo e senza bonus del modulo avversario.';
    }
    return `<div class="stack">
      ${testa}
      <div class="card">
        <div class="sec-h"><h2>${esc(CLASSIFICHE.find(c => c.id === quale).et)}</h2><span>dopo la ${u.id}ª</span></div>
        ${corpo}
        <p class="small muted" style="margin:0">${esc(nota)}</p>
      </div>
      ${dopo}
    </div>`;
  }

  function graficoPunti() {
    const serie = andamento();
    const scelta = prefs().graficoSquadra || (S.team && S.team.id);
    const g = S.teams.map(t => ({ nome: t.name, evidenzia: t.id === scelta, punti: serie.get(t.id) || [] }));
    return `<div class="card">
      <div class="sec-h"><h3>Andamento</h3><span>punti accumulati</span></div>
      <div class="chips" id="serieChips">${S.teams.map(t => `<button type="button" class="chip" data-serie="${t.id}" aria-pressed="${t.id === scelta}">${esc(bel(t.name))}</button>`).join('')}</div>
      ${grafico(g, { alt: 'Punti accumulati giornata per giornata' })}
    </div>`;
  }

  function accoppiamenti(q) {
    if (q.length < 8) return '';
    const p = i => teamName((q[i - 1] || {}).team_id);
    const coppie = [['A', 1, 8], ['B', 4, 5], ['C', 2, 7], ['D', 3, 6]];
    return `<div style="margin-top:6px">${coppie.map(([l, a, b]) =>
      `<div class="match"><span class="t">${esc(p(a))}</span><span class="score">${l}</span><span class="t a">${esc(p(b))}</span></div>`).join('')}</div>`;
  }

  // ------------------------------------------------------------------ giornata
  // Schede dentro una sezione: link, così il tasto "indietro" del telefono funziona
  function schede(sez, voci, attiva, cls) {
    return `<nav class="chips schede ${cls || ''}" aria-label="Schede">${voci.map(v =>
      `<a class="chip" href="#/${sez}${v.id ? '/' + v.id : ''}" ${v.id === attiva ? 'aria-current="page"' : ''}>${esc(v.et)}</a>`).join('')}</nav>`;
  }

  async function sezioneGiornata() {
    const tab = S.sotto === 'formazioni' ? 'formazioni' : '';
    const u = ultima(), corr = roundCorrente();
    const base = tab ? (corr || u) : (u || corr);
    const sel = S.giornataScelta || (base ? base.id : 1);
    const r = S.rounds.find(x => x.id === sel) || { id: sel };
    const prec = S.rounds.filter(x => x.id < sel).pop();
    const succ = S.rounds.filter(x => x.id > sel)[0];
    const inCorso = corr && corr.id === sel && !r.giocata;
    const corpo = tab ? await formazioniGiornata(r) : partiteGiornata(r);
    return `<div class="stack">
      ${schede('giornata', [{ id: '', et: 'Partite' }, { id: 'formazioni', et: 'Formazioni' }], tab, 'larghe')}
      <div class="card">
        <div class="sec-h">
          <h2>Giornata ${sel}</h2>
          <span>${r.serie_a ? r.serie_a + 'ª di Serie A' : ''}${r.fase === 'orologio' ? ' · fase a orologio' : ''}${inCorso ? ' · in corso' : ''}</span>
        </div>
        <div class="chips passo">
          <button type="button" class="chip" data-gio="${prec ? prec.id : ''}" ${prec ? '' : 'disabled'}>‹ precedente</button>
          <button type="button" class="chip" data-gio="${succ ? succ.id : ''}" ${succ ? '' : 'disabled'}>successiva ›</button>
        </div>
        ${corpo}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Tutte le giornate</h3><span>20 giornate</span></div>
        <div class="chips">${S.rounds.map(x => `<button type="button" class="chip" data-gio="${x.id}" aria-pressed="${x.id === sel}">${x.id}${x.giocata ? '' : '·'}</button>`).join('')}</div>
        <p class="small muted" style="margin:0">1–14 stagione regolare, 15–20 fase a orologio. Il puntino segna le giornate non ancora giocate.</p>
      </div>
    </div>`;
  }

  function partiteGiornata(r) {
    const ms = S.matches.filter(m => m.round === r.id);
    if (!ms.length) return '<p class="empty">Nessuna partita.</p>';
    return `<div>${ms.map(m => rigaPartita(m)).join('')}</div>
      <p class="small muted" style="margin:0">${r.giocata ? 'Tocca una partita per il tabellino con voti, subentri e marcatori.' : 'Tocca una partita per le formazioni salvate in Schiera.'}</p>`;
  }

  // l'ordine delle squadre: la tua per prima, poi le coppie delle partite
  function ordineSquadre(round) {
    const ids = [];
    S.matches.filter(m => m.round === round).forEach(m => [m.casa, m.fuori].forEach(id => { if (id && !ids.includes(id)) ids.push(id); }));
    S.teams.forEach(t => { if (!ids.includes(t.id)) ids.push(t.id); });
    if (S.team) { const i = ids.indexOf(S.team.id); if (i > 0) { ids.splice(i, 1); ids.unshift(S.team.id); } }
    return ids;
  }

  // una formazione salvata in Schiera: titolari, panchina, panchina extra
  function elencoSalvata(l) {
    const slots = (l.lineup_slots || []).slice().sort((a, b) => a.pos - b.pos);
    const riga = x => {
      const p = x.players || {};
      return `<div class="prow fr"><span class="num">${x.pos}</span><span class="badge" data-r="${esc(p.role || '')}">${esc(p.role || '·')}</span>
        <span class="who"><b>${esc(p.name || '—')}</b>${p.club ? `<span>${esc(p.club)}</span>` : ''}</span><span class="val"></span></div>`;
    };
    const gruppo = (et, a, b) => {
      const g = slots.filter(x => x.pos >= a && x.pos <= b);
      return g.length ? `<div class="group-h">${et}</div><div class="plist">${g.map(riga).join('')}</div>` : '';
    };
    return gruppo('Titolari', 1, 11) + gruppo('Panchina', 12, 18) + gruppo('Panchina extra', 19, 22);
  }

  // una formazione di una giornata giocata: chi era schierato, con il fantavoto, e chi è entrato
  function elencoGiocata(t) {
    const entrati = new Set((t.formazione || []).filter(x => x.giocato).map(x => x.nome));
    const sch = (t.schierati || []).slice().sort((a, b) => a.pos - b.pos);
    if (!sch.length) {
      return `<div class="plist">${(t.formazione || []).map(x => `<div class="prow fr"><span class="num">${x.pos}</span><span class="badge" data-r="${esc(x.ruolo)}">${esc(x.ruolo)}</span>
        <span class="who"><b>${esc(x.nome)}</b></span>
        <span class="val"><b>${x.giocato ? n1(x.fantavoto) : '—'}</b></span></div>`).join('')}</div>`;
    }
    const riga = x => {
      const dentro = entrati.has(x.nome);
      const nota = x.pos <= 11 ? (dentro ? '' : 'non entrato') : (dentro ? 'entrato' : '');
      return `<div class="prow fr ${dentro ? '' : 'fuori'}"><span class="num">${x.pos}</span><span class="badge" data-r="${esc(x.ruolo)}">${esc(x.ruolo)}</span>
        <span class="who"><b>${esc(x.nome)}</b>${nota ? `<span>${nota}</span>` : ''}</span>
        <span class="val"><b>${x.fantavoto != null && (x.voto || x.fantavoto) ? n1(x.fantavoto) : 's.v.'}</b>${x.voto ? `<span>voto ${n1(x.voto)}</span>` : ''}</span></div>`;
    };
    const gruppo = (et, a, b) => {
      const g = sch.filter(x => x.pos >= a && x.pos <= b);
      return g.length ? `<div class="group-h">${et}</div><div class="plist">${g.map(riga).join('')}</div>` : '';
    };
    return gruppo('Titolari', 1, 11) + gruppo('Panchina', 12, 18) + gruppo('Panchina extra', 19, 22);
  }

  async function formazioniGiornata(r) {
    const ids = ordineSquadre(r.id);
    const rt = r.giocata ? await tabellini(r.id) : [];
    const ln = (!r.giocata || !rt.length) ? await salvate(r.serie_a) : [];
    const blocchi = ids.map(id => {
      const t = rt.find(x => x.team_id === id);
      const l = ln.find(x => x.team_id === id);
      const mio = isMe(id) ? ' open' : '';
      if (t) {
        return `<details class="form-sq"${mio}><summary><b>${esc(teamName(id))}</b><span>${esc(t.modulo || '')} · ${n1(t.punteggio)} punti</span></summary>${elencoGiocata(t)}</details>`;
      }
      if (l) {
        return `<details class="form-sq"${mio}><summary><b>${esc(teamName(id))}</b><span>${esc(l.module || '')} · salvata ${esc(quando(l.updated_at))}</span></summary>${elencoSalvata(l)}</details>`;
      }
      return `<div class="form-sq vuota"><b>${esc(teamName(id))}</b><span>${r.giocata ? 'nessuna formazione' : 'non ancora schierata'}</span></div>`;
    }).join('');
    const salvateN = ln.length;
    const nota = rt.length ? 'Le formazioni come risultano dal file di giornata: fantavoto, chi è entrato e chi no.'
      : r.giocata ? 'Per questa giornata il file non è stato caricato: qui ci sono le formazioni salvate in Schiera.'
      : `Le formazioni salvate in Schiera: ${salvateN} su ${S.teams.length}. Si vedono tutte, sempre, e cambiano finché i giocatori non scendono in campo.`;
    const admin = isAdmin() && r.serie_a
      ? `<button type="button" class="btn" data-tutte="${r.serie_a}">Scarica tutte in un file .xls</button>` : '';
    return `<div class="forms">${blocchi}</div><p class="small muted" style="margin:0">${esc(nota)}</p>${admin}`;
  }

  // la partita di una giornata non ancora giocata: le due formazioni salvate
  async function apriFormazioni(round, slot) {
    const m = S.matches.find(x => x.round === round && x.slot === slot);
    const r = S.rounds.find(x => x.id === round);
    if (!m || !r) return;
    const ln = await salvate(r.serie_a);
    const col = id => {
      const l = ln.find(x => x.team_id === id);
      return `<div><div class="sec-h" style="margin-bottom:4px"><h3>${esc(teamName(id))}</h3><span>${l ? esc((l.module || '') + ' · salvata ' + quando(l.updated_at)) : 'non ancora schierata'}</span></div>
        ${l ? elencoSalvata(l) : '<p class="empty">Ancora nessuna formazione salvata.</p>'}</div>`;
    };
    sheet(`<div class="sheet-h"><div><h4>${esc(teamName(m.casa))} – ${esc(teamName(m.fuori))}</h4>
        <p>Giornata ${round}${r.serie_a ? ' · ' + r.serie_a + 'ª di Serie A' : ''} · formazioni salvate in Schiera</p></div></div>
      <div class="sheet-b stack">${col(m.casa)}<hr style="border:0;border-top:1px solid var(--line);margin:0">${col(m.fuori)}</div>
      <div class="sheet-f"><button type="button" class="btn btn-primary" data-act="close">Chiudi</button></div>`);
  }

  // Per l'amministratore: tutte le formazioni salvate in un solo file .xls, come quelli
  // che scarica ognuno (stesso modello della lega), un foglio per squadra.
  async function scaricaTutte(serieA) {
    const r = S.rounds.find(x => x.serie_a === serieA) || {};
    const ln = await salvate(serieA);
    const ids = ordineSquadre(r.id);
    const mancano = ids.filter(id => !ln.some(l => l.team_id === id));
    const el = sheet(`<div class="sheet-h"><div><h4>Tutte le formazioni</h4><p>Giornata ${r.id || ''} · ${serieA}ª di Serie A · un file .xls, un foglio per squadra</p></div></div>
      <div class="sheet-b"><div class="plist">${ids.map(id => {
        const l = ln.find(x => x.team_id === id);
        return `<div class="prow" style="grid-template-columns:20px 1fr auto"><span class="esito ${l ? 'v' : 'p'}" aria-hidden="true">${l ? '✓' : '✕'}</span>
          <span class="who"><b>${esc(teamName(id))}</b><span>${l ? esc((l.module || '') + ' · salvata ' + quando(l.updated_at)) : 'non ha salvato la formazione'}</span></span>
          <span class="val"></span></div>`;
      }).join('')}</div>
      <p class="small ${mancano.length ? '' : 'muted'}" style="margin:10px 0 0">${mancano.length
        ? `<b>Mancano ${mancano.length}:</b> ${esc(mancano.map(teamName).join(', '))}. Nel file il loro foglio resta senza formazione (colonna D vuota).`
        : 'Ci sono tutte.'}</p></div>
      <div class="sheet-f"><button type="button" class="btn btn-ghost" data-act="close">Annulla</button><button type="button" class="btn btn-primary" data-act="go">Scarica il file .xls</button></div>`);
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act="go"]');
      if (!b) return;
      b.disabled = true; b.innerHTML = '<span class="spin"></span> Preparo…';
      try {
        const X = window.XlsFormazione;
        const wb = X.load(await SB.download('modelli', 'formazioni.xls'));
        const senzaFoglio = [];
        let nomiDiversi = 0;
        const voci = [];
        S.teams.forEach(t => {
          const foglio = wb.sheetNames.includes(t.sheet_name) ? t.sheet_name : wb.sheetNames.includes(t.name) ? t.name : null;
          if (!foglio) { senzaFoglio.push(bel(t.name)); return; }
          const l = ln.find(x => x.team_id === t.id);
          if (!l) { voci.push({ name: foglio, vuoto: true }); return; }
          const nums = Array(31).fill(null);
          const modello = wb.roster(foglio);
          (l.lineup_slots || []).forEach(x => {
            const p = x.players || {};
            if (p.slot >= 1 && p.slot <= 31) {
              nums[p.slot - 1] = x.pos;
              if (modello[p.slot - 1] && p.name && modello[p.slot - 1].name !== p.name) nomiDiversi++;
            }
          });
          voci.push({ name: foglio, numbers: nums });
        });
        const res = wb.buildMany(voci);
        const d = new Date();
        const nome = 'formazioni_' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '_tutte.xls';
        if (window.Schiera && Schiera.scarica) await Schiera.scarica(res.bytes, nome);
        else {
          const url = URL.createObjectURL(new Blob([res.bytes], { type: 'application/vnd.ms-excel' }));
          const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
        }
        closeSheet();
        const fatte = res.fogli.filter(f => !f.vuoto).length;
        notice(`Scaricato ${nome}: ${fatte} formazion${fatte === 1 ? 'e' : 'i'}` +
          (mancano.length ? `, foglio vuoto per ${mancano.map(teamName).join(', ')}` : '') + '.' +
          (senzaFoglio.length ? ` Nel modello mancano i fogli di ${senzaFoglio.join(', ')}.` : '') +
          (nomiDiversi ? ` Attenzione: ${nomiDiversi} giocatori hanno nel modello un nome diverso dalla rosa: aggiorna il modello con "Aggiorna le rose da un .xls".` : ''));
      } catch (e) {
        console.error(e);
        closeSheet();
        notice(e && e.message ? e.message : 'Non sono riuscito a preparare il file.', 'error');
      }
    });
  }

  // tabellino di una partita
  async function apriPartita(round, slot) {
    const m = S.matches.find(x => x.round === round && x.slot === slot);
    if (!m) return;
    const rt = await tabellini(round);
    const box = id => rt.find(x => x.team_id === id);
    const a = box(m.casa), b = box(m.fuori);
    const colonna = (t, mm) => {
      if (!t) return '<p class="empty">Nessun tabellino.</p>';
      const inCampo = (t.formazione || []).filter(x => x.giocato);
      const fuori = (t.formazione || []).filter(x => !x.giocato);
      const s = t.sostituzioni || {};
      return `<div>
        <div class="sec-h" style="margin-bottom:6px"><h3>${esc(teamName(t.team_id))}</h3><span>${esc(t.modulo || '')}</span></div>
        <div class="tiles" style="grid-template-columns:repeat(4,1fr)">
          ${tile(n1(t.punteggio), 'punteggio')}
          ${tile(n1(t.fattore_campo), 'campo')}
          ${tile(n1(t.bonus_modulo), 'modulo avv.')}
          ${tile(n1(t.totale), 'totale')}
        </div>
        <div class="plist">${inCampo.map(x => `<div class="prow">
          <span class="badge" data-r="${esc(x.ruolo)}">${esc(x.ruolo)}</span>
          <span class="who"><b>${esc(x.nome)}</b></span>
          <span class="val"><b>${n1(x.fantavoto)}</b><span>voto ${n1(x.voto)}</span></span></div>`).join('')}</div>
        ${fuori.length ? `<div class="group-h">Non entrati</div><p class="small muted" style="margin:0">${esc(fuori.map(x => x.nome).join(', '))}</p>` : ''}
        ${s.tot ? `<p class="small muted" style="margin:8px 0 0">Sostituzioni: ${s.tot} (P ${nz(s.P)} · D ${nz(s.D)} · C ${nz(s.C)} · A ${nz(s.A)})</p>` : ''}
        ${(t.marcatori || []).length ? `<p class="small" style="margin:6px 0 0">⚽ ${esc((t.marcatori || []).join(', '))}</p>` : ''}
      </div>`;
    };
    sheet(`<div class="sheet-h"><div><h4>${esc(teamName(m.casa))} ${m.gol_casa}–${m.gol_fuori} ${esc(teamName(m.fuori))}</h4>
        <p>Giornata ${round} · ${n1(m.totale_casa)} contro ${n1(m.totale_fuori)}</p></div></div>
      <div class="sheet-b stack">${colonna(a, m)}<hr style="border:0;border-top:1px solid var(--line)">${colonna(b, m)}</div>
      <div class="sheet-f"><button type="button" class="btn btn-primary" data-act="close">Chiudi</button></div>`);
  }

  // --------------------------------------------------------------------- rose
  async function vistaRosa(scelta) {
    const [pl, cs, ps, se, f] = await Promise.all([rose(), costi(), statGiocatori(), stagione(), fc()]);
    const t = teamById(scelta);
    const miei = pl.filter(x => x.team_id === scelta);
    const costoDi = new Map(cs.filter(x => x.team_id === scelta).map(x => [x.slot, x]));
    const statDi = new Map(ps.filter(x => x.team_id === scelta).map(x => [x.nome, x]));
    const sea = se.find(x => x.team_id === scelta) || {};
    const spesa = miei.reduce((s, p) => s + nz((costoDi.get(p.slot) || {}).costo), 0);
    // le medie di Serie A (Fantacalcio.it), abbinate per nome
    const serieA = f.righe.length ? window.Fantacalcio.abbina(miei, f.righe).trovati : null;
    const conA = !!serieA;

    const gruppi = ['P', 'D', 'C', 'A'].map(ro => {
      const l = miei.filter(p => p.role === ro);
      if (!l.length) return '';
      return `<div class="group-h">${ROLE[ro]}</div><div class="plist">${l.map(p => {
        const c = costoDi.get(p.slot) || {}, st = statDi.get(p.name) || {};
        const a = conA ? serieA.get(p.id) : null;
        const lega = `<span class="val"><b>${st.fantamedia != null ? n1(st.fantamedia) : '—'}</b><span>${st.presenze ? st.presenze + ' pres · ' + n1(st.media) : 'mai schierato'}</span></span>`;
        const sa = conA ? `<span class="val"><b>${a && a.pv ? n1(a.fm) : '—'}</b><span>${a ? (a.pv ? a.pv + ' pv · ' + n1(a.mv) : 'mai a voto') : 'non trovato'}</span></span>` : '';
        return `<div class="prow${conA ? ' quattro' : ''}">
          <span class="badge" data-r="${esc(p.role)}">${esc(p.role)}</span>
          <span class="who"><b>${esc(p.name)}</b><span>${esc([p.club, c.costo != null ? n1(c.costo) + ' cr' : null].filter(Boolean).join(' · ') || 'squadra da assegnare')}</span></span>
          ${lega}${sa}
        </div>`;
      }).join('')}</div>`;
    }).join('');
    const testata = conA ? `<div class="prow quattro testata"><span></span><span></span><span class="val">Lega</span><span class="val">Serie A</span></div>` : '';
    const data = f.meta && f.meta.aggiornate_at ? new Date(f.meta.aggiornate_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : '';
    const fonte = conA
      ? `<p class="small muted" style="margin:0"><b>Lega</b>: fantamedia, presenze e media voto nelle giornate della lega. <b>Serie A</b>: fantamedia (FM), partite a voto (pv) e media voto di tutto il campionato${data ? ', aggiornate al ' + esc(data) : ''}. Fonte: <a href="https://www.fantacalcio.it/statistiche-serie-a" target="_blank" rel="noopener">Fantacalcio.it</a>.</p>`
      : `<p class="small muted" style="margin:0">Fantamedia e presenze sono calcolate sulle giornate caricate.${isAdmin() ? (f.manca
          ? ' Per mostrare anche le medie di Serie A esegui db/10_fantacalcio.sql nel SQL Editor di Supabase, poi caricale dal menu.'
          : ' Le medie di Serie A di Fantacalcio.it le carichi dal menu: "Carica le medie di Fantacalcio.it".') : ''}</p>`;

    return `<div class="card">
        <div class="sec-h"><h2>${esc(t ? bel(t.name) : '')}</h2><span>${miei.length} giocatori</span></div>
        <div class="tiles q4">
          ${tile(sea.crediti != null ? sea.crediti : '—', 'crediti residui')}
          ${tile(n1(spesa), 'spesi in rosa')}
          ${tile(sea.gol_totali != null ? sea.gol_totali : '—', 'gol reali')}
          ${tile(sea.gol_sfruttati != null ? sea.gol_sfruttati : '—', 'gol sfruttati')}
        </div>
        ${gruppi ? testata + gruppi : '<p class="empty">Rosa non ancora caricata.</p>'}
        ${fonte}
      </div>`;
  }

  // Per l'amministratore: l'Excel delle statistiche di Serie A scaricato da Fantacalcio.it
  async function caricaFc(file) {
    if (!file) return;
    let dati;
    try {
      dati = await window.Fantacalcio.leggi(new Uint8Array(await file.arrayBuffer()), file.name);
    } catch (e) {
      console.error(e);
      notice(e && e.message ? e.message : 'Non riesco a leggere il file.', 'error');
      return;
    }
    const pl = await rose();
    const ab = window.Fantacalcio.abbina(pl, dati.righe);
    const conVoto = dati.righe.filter(x => x.pv).length;
    const el = sheet(`<div class="sheet-h"><div><h4>Medie di Serie A</h4><p>${esc(file.name)}${dati.stagione ? ' · stagione ' + esc(dati.stagione) : ''}</p></div></div>
      <div class="sheet-b">
        <div class="tiles q3" style="margin-top:12px">
          ${tile(dati.righe.length, 'giocatori nel file')}
          ${tile(conVoto, 'con almeno un voto')}
          ${tile(ab.trovati.size, 'trovati, su ' + pl.length + ' delle rose')}
        </div>
        ${ab.mancano.length ? `<div class="group-h">Non trovati nel file (${ab.mancano.length})</div>
          <p class="small" style="margin:0">${esc(ab.mancano.slice(0, 20).map(g => g.name + ' (' + teamName(g.team_id) + ')').join(', '))}${ab.mancano.length > 20 ? '…' : ''}</p>
          <p class="small muted" style="margin:6px 0 0">Di solito sono giocatori ceduti all'estero o scritti in modo diverso: in Rose avranno "non trovato".</p>` : ''}
        <p class="small muted" style="margin:12px 0 0">Le medie compaiono in Rose accanto a quelle della lega, con la fonte e la data di oggi. Il caricamento sostituisce quello precedente.</p>
      </div>
      <div class="sheet-f"><button type="button" class="btn btn-ghost" data-act="close">Annulla</button><button type="button" class="btn btn-primary" data-act="go">Carica</button></div>`);
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act="go"]');
      if (!b) return;
      b.disabled = true; b.innerHTML = '<span class="spin"></span> Carico…';
      try {
        const res = await SB.rpc('import_fc_stats', { p: { file: file.name, stagione: dati.stagione, righe: dati.righe } });
        closeSheet();
        delete S.cache.fc;
        notice('Medie di Serie A caricate: ' + res.righe + ' giocatori. Le trovi in Squadre → Rosa.');
        render();
      } catch (e) {
        console.error(e);
        closeSheet();
        notice(NON_CE(e) ? 'Manca la tabella delle medie: esegui db/10_fantacalcio.sql nel SQL Editor di Supabase, poi riprova.'
          : (e && e.message ? e.message : 'Caricamento non riuscito.'), 'error');
      }
    });
  }

  // -------------------------------------------------------- statistiche di lega
  const nomeConGiornata = (id, r) => teamName(id) + (r ? ' · ' + r + 'ª giornata' : '');
  const lista = (righe, mappa) => `<div class="plist">${righe.map((r, i) => {
    const m = mappa(r, i);
    return `<div class="prow"><span class="pos muted" style="text-align:right">${m.pos != null ? m.pos : i + 1}</span>
      <span class="who"><b>${esc(m.titolo)}</b><span>${esc(m.sotto)}</span></span>
      <span class="val"><b>${esc(m.valore)}</b>${m.nota ? `<span>${esc(m.nota)}</span>` : ''}</span></div>`;
  }).join('')}</div>`;

  async function vistaStatLega() {
    const u = ultima();
    if (!u) return '<div class="card"><p class="empty">Ancora nessuna giornata caricata.</p></div>';
    const [ps, sc, rtU, cdl, rt, voti] = await Promise.all([statGiocatori(), marcatori(), tabellini(u.id),
      classifiche('cdl_giornata'), tabelliniTutti(), votiTutti()]);
    const C = window.Calcoli;
    const maxPres = Math.max.apply(null, [1].concat(ps.map(p => nz(p.presenze))));
    const conPres = ps.filter(p => nz(p.presenze) >= Math.max(1, Math.ceil(maxPres / 2)));
    const perFanta = conPres.slice().sort((a, b) => nz(b.fantamedia) - nz(a.fantamedia)).slice(0, 10);
    const perVoto = conPres.slice().sort((a, b) => nz(b.media) - nz(a.media)).slice(0, 10);
    const bomber = sc.filter(x => nz(x.gol) > 0).slice(0, 15);
    const prestazioni = [].concat.apply([], rtU.map(t => (t.formazione || []).filter(x => x.giocato)
      .map(x => ({ nome: x.nome, squadra: teamName(t.team_id), fantavoto: x.fantavoto, voto: x.voto }))))
      .sort((a, b) => nz(b.fantavoto) - nz(a.fantavoto)).slice(0, 8);
    const squadre = rtU.slice().sort((a, b) => nz(b.punteggio) - nz(a.punteggio));

    // record e curiosità
    const rec = C.record(S.matches, cdl);
    const serie = S.teams.map(t => ({ id: t.id, s: C.serie(C.risultati(S.matches, t.id).map(r => r.esito)) }));
    const migliore = k => serie.reduce((m, x) => (x.s[k] > (m ? m.s[k] : 0) ? x : m), null);
    const vit = migliore('vittorie'), imb = migliore('imbattuto');
    const partita = m => `${teamName(m.casa)} ${m.gol_casa}–${m.gol_fuori} ${teamName(m.fuori)}`;
    const voci = [
      rec.piu_alto && { titolo: 'Punteggio più alto', sotto: nomeConGiornata(rec.piu_alto.team_id, rec.piu_alto.round), valore: n1(rec.piu_alto.v) },
      rec.piu_basso && { titolo: 'Punteggio più basso', sotto: nomeConGiornata(rec.piu_basso.team_id, rec.piu_basso.round), valore: n1(rec.piu_basso.v) },
      rec.vittoria_larga && { titolo: 'Vittoria più larga', sotto: partita(rec.vittoria_larga) + ' · ' + rec.vittoria_larga.round + 'ª', valore: Math.abs(rec.vittoria_larga.gol_casa - rec.vittoria_larga.gol_fuori) + ' gol', nota: 'di scarto' },
      rec.piu_gol && { titolo: 'Partita con più gol', sotto: partita(rec.piu_gol) + ' · ' + rec.piu_gol.round + 'ª', valore: (rec.piu_gol.gol_casa + rec.piu_gol.gol_fuori) + ' gol' },
      rec.sconfitta_beffa && { titolo: 'Sconfitta più beffarda', sotto: teamName(rec.sconfitta_beffa.team_id) + ' ' + rec.sconfitta_beffa.gf + '–' + rec.sconfitta_beffa.gs + ' con ' + teamName(rec.sconfitta_beffa.avversario) + ' · ' + rec.sconfitta_beffa.round + 'ª', valore: n1(rec.sconfitta_beffa.v), nota: 'punti, e ha perso' },
      rec.vittoria_fortuna && { titolo: 'Vittoria più fortunata', sotto: teamName(rec.vittoria_fortuna.team_id) + ' ' + rec.vittoria_fortuna.gf + '–' + rec.vittoria_fortuna.gs + ' con ' + teamName(rec.vittoria_fortuna.avversario) + ' · ' + rec.vittoria_fortuna.round + 'ª', valore: n1(rec.vittoria_fortuna.v), nota: 'punti, e ha vinto' },
      vit && vit.s.vittorie > 1 && { titolo: 'Più vittorie di fila', sotto: teamName(vit.id), valore: vit.s.vittorie },
      imb && imb.s.imbattuto > 1 && { titolo: 'Più partite senza perdere', sotto: teamName(imb.id), valore: imb.s.imbattuto }
    ].filter(Boolean);

    // punteggi di ogni giornata
    const dist = C.distribuzione(cdl);
    const mioId = S.team ? S.team.id : null;

    // formazione ideale: punti lasciati in panchina da ogni squadra
    const ide = C.idealePerGiornata(voti, rt);
    const perSq = S.teams.map(t => {
      const x = ide.filter(i => i.team_id === t.id);
      return { id: t.id, lasciati: x.reduce((s, i) => s + i.lasciati, 0), eff: x.length ? x.reduce((s, i) => s + i.efficienza, 0) / x.length : null, n: x.length };
    }).filter(x => x.n).sort((a, b) => b.lasciati - a.lasciati);
    const giornateIde = [...new Set(ide.map(i => i.round))].length;

    return `
      <div class="card">
        <div class="sec-h"><h2>Record e curiosità</h2><span>dopo la ${u.id}ª</span></div>
        ${voci.length ? `<div class="plist">${voci.map(v => `<div class="prow" style="grid-template-columns:1fr auto">
          <span class="who"><b>${esc(v.titolo)}</b><span>${esc(v.sotto)}</span></span>
          <span class="val"><b>${esc(v.valore)}</b>${v.nota ? `<span>${esc(v.nota)}</span>` : ''}</span></div>`).join('')}</div>`
          : '<p class="empty">Servono più giornate.</p>'}
        <p class="small muted" style="margin:0">Punteggi di giornata della Coppa di Lega: la somma dei fantavoti, senza fattore campo e bonus del modulo.</p>
      </div>
      <div class="card">
        <div class="sec-h"><h3>I punteggi di ogni giornata</h3><span>dal più basso al più alto</span></div>
        ${intervalli(dist, mioId, S.team ? S.team.name : '')}
        ${numeri(['Giornata', 'Più basso', 'Mediana', 'Più alto'].concat(S.team ? [bel(S.team.name)] : []),
          dist.map(d => [d.round, n1(d.min), n1(d.mediana), n1(d.max)].concat(S.team ? [n1((d.squadre.find(x => x.team_id === mioId) || {}).v)] : [])))}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Punti lasciati in panchina</h3><span>formazione ideale</span></div>
        ${perSq.length ? barre(perSq.map(x => ({ et: teamName(x.id), v: x.lasciati, mio: isMe(x.id), nota: x.eff != null ? Math.round(x.eff * 100) + '% del massimo' : '' })))
          : '<p class="empty">Servono i voti di almeno una giornata caricata.</p>'}
        <p class="small muted" style="margin:0">Per ogni giornata: quanti punti in più avresti fatto schierando i migliori della rosa (un portiere e il modulo migliore fra quelli ammessi), rispetto ai fantavoti di chi è entrato davvero. Somma su ${giornateIde} giornat${giornateIde === 1 ? 'a' : 'e'} con il file caricato; la percentuale dice quanto del massimo possibile è stato raccolto.</p>
      </div>
      <div class="card">
        <div class="sec-h"><h3>Cannonieri</h3><span>gol reali in stagione</span></div>
        ${bomber.length ? lista(bomber, r => ({ titolo: r.nome, sotto: teamName(r.team_id), valore: r.gol, nota: r.gol_sfruttati + ' sfruttati' }))
          : '<p class="empty">Nessun gol registrato.</p>'}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Migliori fantamedie</h3><span>almeno metà delle giornate</span></div>
        ${perFanta.length ? lista(perFanta, r => ({ titolo: r.nome, sotto: bel(r.squadra) + ' · ' + r.presenze + ' presenze', valore: n1(r.fantamedia), nota: 'voto ' + n1(r.media) }))
          : '<p class="empty">Servono più giornate.</p>'}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Migliori medie voto</h3><span>senza bonus</span></div>
        ${perVoto.length ? lista(perVoto, r => ({ titolo: r.nome, sotto: bel(r.squadra), valore: n1(r.media), nota: n1(r.fantamedia) + ' di fantamedia' }))
          : '<p class="empty">Servono più giornate.</p>'}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Prestazioni della ${u.id}ª</h3><span>fantavoto più alto</span></div>
        ${prestazioni.length ? lista(prestazioni, r => ({ titolo: r.nome, sotto: r.squadra, valore: n1(r.fantavoto), nota: 'voto ' + n1(r.voto) }))
          : '<p class="empty">Nessun voto per questa giornata.</p>'}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Punteggi della ${u.id}ª</h3><span>Coppa di Lega</span></div>
        ${barre(squadre.map(t => ({ et: teamName(t.team_id), v: nz(t.punteggio), mio: isMe(t.team_id) })))}
      </div>`;
  }

  // Barre orizzontali: una misura sola, etichette sempre scritte accanto al valore.
  function barre(righe) {
    if (!righe.length) return '<p class="empty">Niente da mostrare.</p>';
    const max = Math.max.apply(null, righe.map(r => r.v)) || 1;
    return `<div class="plist">${righe.map(r => `<div class="prow" style="grid-template-columns:minmax(0,1fr) auto">
      <span class="who"><b>${esc(r.et)}</b>
        <span style="display:block;height:8px;border-radius:4px;margin-top:5px;background:${r.mio ? 'var(--chart-accent)' : 'var(--chart-mute)'};width:${Math.max(3, Math.round(r.v / max * 100))}%"></span></span>
      <span class="val"><b>${n1(r.v)}</b>${r.nota ? `<span>${esc(r.nota)}</span>` : ''}</span></div>`).join('')}</div>`;
  }


  // Colonne: una misura per giornata (es. punti lasciati in panchina). Un colore solo,
  // estremità arrotondata in cima, etichetta solo sul valore più alto.
  const passoBello = max => [1, 2, 5, 10, 20, 25, 50, 100].find(p => max / p <= 4) || 200;
  function colonne(righe, opts) {
    opts = opts || {};
    if (!righe.length) return '<p class="empty">Niente da mostrare.</p>';
    const W = 360, H = opts.h || 170, ML = 28, MR = 8, MT = 18, MB = 22;
    const vmax = Math.max.apply(null, righe.map(r => r.v));
    const passo = passoBello(Math.max(vmax, 1));
    const top = Math.max(passo, Math.ceil(vmax / passo) * passo);
    const Y = v => MT + (H - MT - MB) * (1 - v / top);
    const band = (W - ML - MR) / righe.length;
    const bw = Math.min(24, band * 0.62);
    const griglia = [];
    for (let v = 0; v <= top + 1e-9; v += passo) {
      griglia.push(`<line x1="${ML}" x2="${W - MR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1"/>` +
        `<text x="${ML - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${n1(v)}</text>`);
    }
    const imax = righe.findIndex(r => r.v === vmax);
    const barre = righe.map((r, i) => {
      const x = ML + band * i + (band - bw) / 2, y = Y(Math.max(0, r.v)), b = Y(0);
      const h = b - y, rr = Math.min(4, h, bw / 2);
      const forma = h <= 0.5 ? '' : `<path d="M${x.toFixed(1)} ${b.toFixed(1)} V${(y + rr).toFixed(1)} Q${x.toFixed(1)} ${y.toFixed(1)} ${(x + rr).toFixed(1)} ${y.toFixed(1)} H${(x + bw - rr).toFixed(1)} Q${(x + bw).toFixed(1)} ${y.toFixed(1)} ${(x + bw).toFixed(1)} ${(y + rr).toFixed(1)} V${b.toFixed(1)} Z" fill="var(--chart-accent)"/>`;
      const et = (righe.length <= 12 || i % 2 === 0) ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(r.x)}</text>` : '';
      const val = i === imax && r.v > 0 ? `<text class="lbl" x="${(x + bw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle">${n1(r.v)}</text>` : '';
      return `<g data-tt="${esc(r.tt || (opts.et || '') + ' ' + r.x + ': ' + n1(r.v))}" tabindex="0"><rect x="${(ML + band * i).toFixed(1)}" y="${MT}" width="${band.toFixed(1)}" height="${H - MT - MB}" fill="transparent"/>${forma}</g>${et}${val}`;
    }).join('');
    return `<div class="chart-wrap tt"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.alt || '')}">
      <line x1="${ML}" x2="${W - MR}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1"/>
      ${griglia.join('')}${barre}</svg><div class="tip" hidden></div></div>`;
  }

  // Punteggi di ogni giornata: dal più basso al più alto (baffo), la mediana (punto grigio)
  // e la squadra scelta (punto colorato).
  function intervalli(dist, mioId, nomeMio) {
    if (!dist.length) return '<p class="empty">Ancora nessun punteggio.</p>';
    const W = 360, H = 210, ML = 28, MR = 8, MT = 10, MB = 22;
    const tutti = [].concat.apply([], dist.map(d => [d.min, d.max]));
    const lo = Math.floor(Math.min.apply(null, tutti) / 5) * 5, hi = Math.ceil(Math.max.apply(null, tutti) / 5) * 5;
    const Y = v => MT + (H - MT - MB) * (1 - (v - lo) / Math.max(1, hi - lo));
    const band = (W - ML - MR) / dist.length;
    const passo = passoBello(hi - lo);
    const griglia = [];
    for (let v = Math.ceil(lo / passo) * passo; v <= hi + 1e-9; v += passo) {
      griglia.push(`<line x1="${ML}" x2="${W - MR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1"/>` +
        `<text x="${ML - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${v}</text>`);
    }
    const segni = dist.map((d, i) => {
      const cx = ML + band * (i + 0.5);
      const mio = d.squadre.find(x => x.team_id === mioId);
      const tt = `Giornata ${d.round}\npiù alto ${n1(d.max)} · mediana ${n1(d.mediana)} · più basso ${n1(d.min)}` + (mio ? `\n${bel(nomeMio)}: ${n1(mio.v)}` : '');
      const et = (dist.length <= 12 || i % 2 === 0) ? `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${d.round}</text>` : '';
      return `<g data-tt="${esc(tt)}" tabindex="0"><rect x="${(ML + band * i).toFixed(1)}" y="${MT}" width="${band.toFixed(1)}" height="${H - MT - MB}" fill="transparent"/>
        <line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${Y(d.max).toFixed(1)}" y2="${Y(d.min).toFixed(1)}" stroke="var(--chart-mute)" stroke-width="2" stroke-linecap="round"/>
        <circle cx="${cx.toFixed(1)}" cy="${Y(d.mediana).toFixed(1)}" r="4" fill="var(--chart-mute)" stroke="var(--surface)" stroke-width="2"/>
        ${mio ? `<circle cx="${cx.toFixed(1)}" cy="${Y(mio.v).toFixed(1)}" r="5" fill="var(--chart-accent)" stroke="var(--surface)" stroke-width="2"/>` : ''}</g>${et}`;
    }).join('');
    return `<div class="legend"><span class="dot"><i></i>${esc(bel(nomeMio || ''))}</span><span class="dot m"><i></i>mediana della lega</span><span class="baffo"><i></i>dal più basso al più alto</span></div>
      <div class="chart-wrap tt"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Punteggi di ogni giornata">${griglia.join('')}${segni}</svg><div class="tip" hidden></div></div>`;
  }

  // Due barre per riga: la squadra (colore) e la media della lega (grigio)
  function coppie(righe, nome) {
    const max = Math.max.apply(null, [1].concat(righe.map(r => Math.max(nz(r.a), nz(r.b)))));
    const w = v => Math.max(2, Math.round(nz(v) / max * 100));
    return `<div class="legend"><span><i></i>${esc(bel(nome))}</span><span class="m"><i></i>media della lega</span></div>
      <div class="plist">${righe.map(r => `<div class="prow">
        <span class="badge" data-r="${esc(r.ruolo)}">${esc(r.ruolo)}</span>
        <span class="who"><b>${esc(r.et)}</b><span class="coppia"><i class="a" style="width:${w(r.a)}%"></i><i class="m" style="width:${w(r.b)}%"></i></span></span>
        <span class="val"><b>${n1(r.a)}</b><span>lega ${n1(r.b)}</span></span></div>`).join('')}</div>`;
  }

  // la tabella con i numeri del grafico, per chi non vuole (o non può) leggere il disegno
  const numeri = (intest, righe) => `<details class="numeri"><summary>Vedi i numeri</summary><div class="scroll-x"><table class="tbl">
    <thead><tr>${intest.map((h, i) => `<th class="${i ? '' : 'l'}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${righe.map(r => `<tr>${r.map((c, i) => `<td class="${i ? '' : 'l'}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;

  // ------------------------------------------------------------------ playoff
  async function vistaPlayoff() {
    const u = ultima();
    const camp = u ? (await classifiche('campionato')).filter(r => r.round === u.id) : [];
    const p = i => camp[i - 1] ? teamName(camp[i - 1].team_id) : i + 'º classificato';
    const riga = (a, b) => `<div class="match"><span class="t">${esc(p(a))}</span><span class="score">vs</span><span class="t a">${esc(p(b))}</span></div>`;
    const tab = (intestazioni, righe) => `<div class="scroll-x"><table class="tbl"><thead><tr>${intestazioni.map(h => `<th class="l">${esc(h)}</th>`).join('')}</tr></thead><tbody>
      ${righe.map(r => `<tr>${r.map((c, i) => `<td class="l"${i === 0 ? ' style="font-weight:600"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

    return `<div class="card">
        <div class="sec-h"><h2>Playoff</h2><span>dalla 24ª di Serie A</span></div>
        <p class="small muted" style="margin:0">Quattro turni a eliminazione diretta. Il tabellone nasce dalla classifica finale delle 20 giornate a scontri diretti: chi è più in alto parte avvantaggiato, e resta avvantaggiato a ogni turno.</p>
      </div>

      <div class="card">
        <div class="sec-h"><h3>Primo turno</h3><span>andata in casa del peggio piazzato</span></div>
        <div>${[[4, 1], [3, 2], [8, 5], [7, 6]].map(([a, b]) => riga(a, b)).join('')}</div>
        <p class="small muted" style="margin:0">Accoppiamenti 4–1, 3–2, 8–5, 7–6 sulla classifica di oggi: cambieranno fino alla 20ª giornata.</p>
      </div>

      <div class="card">
        <div class="sec-h"><h3>Il vantaggio di chi gioca in casa</h3><span>si somma al punteggio</span></div>
        ${tab(['Partita', 'Vantaggio di chi è in casa'], [
          ['Andata', '2'],
          ['Ritorno', '(differenza punti + 3) ÷ 2, mai meno di 2']
        ])}
        <p class="small muted" style="margin:0">La differenza punti è quella fra le due squadre nella classifica finale del campionato. Esempio: con 7 punti di distacco, al ritorno chi è in casa parte da (7 + 3) ÷ 2 = <b>5</b>; con 0 punti di distacco il vantaggio resta 2.</p>
      </div>

      <div class="card">
        <div class="sec-h"><h3>Come finisce il doppio confronto</h3><span>niente supplementari né rigori</span></div>
        ${tab(['Esito', 'Cosa succede'], [
          ['Passa chi è meglio piazzato', 'Passa il turno, niente bella'],
          ['Perfetta parità<div class="muted small">1–1 e 1–1, 2–1 e 1–2, 2–2 e 1–1…</div>', 'Bella in campo neutro'],
          ['Passa chi è peggio piazzato', 'Bella in casa sua, se il distacco in classifica è di <b>almeno 3 punti</b>.<div class="muted small">Sotto i 3 punti passa il turno direttamente.</div>']
        ])}
      </div>

      <div class="card">
        <div class="sec-h"><h3>La bella</h3><span>quando chi passa era peggio piazzato</span></div>
        ${tab(['Come è andato il doppio confronto', 'Vantaggio nella bella', 'Punti recuperati'], [
          ['Due vittorie', '6', 'tutto il distacco'],
          ['Una vittoria e un pareggio', '4', '3/4 del distacco'],
          ['Una vittoria e una sconfitta', '2', 'metà del distacco'],
          ['Due pareggi', '2', 'metà del distacco']
        ])}
        <p class="small muted" style="margin:0">I punti recuperati riducono il distacco in classifica verso chi è stato eliminato, fino a un massimo di <b>8</b>: servono al vantaggio dei turni successivi.</p>
      </div>

      <div class="card">
        <div class="sec-h"><h3>Le giornate</h3><span>24ª–35ª di Serie A</span></div>
        <p class="small muted" style="margin:0">Ogni turno occupa due giornate più una per l'eventuale bella (24–26, 27–29, 30–32, 33–35). Se una bella non serve, quella giornata va alla Coppa: è così che semifinali e finale di Coppa possono passare da gara secca ad andata e ritorno.</p>
      </div>

      ${camp.length ? `<div class="card"><div class="sec-h"><h3>Classifica attuale</h3><span>dopo la ${u.id}ª</span></div>${tabellaCampionato(camp, true)}
        <p class="small muted" style="margin:0">Il tabellone sopra usa questa classifica: diventerà definitivo dopo la 20ª giornata.</p></div>` : ''}`;
  }

  // ------------------------------------------------------------------- albo
  async function vistaAlbo() {
    const a = await alboDoro();
    const conta = {};
    a.forEach(r => ['campionato', 'coppa', 'coppa_lega', 'supercoppa'].forEach(k => {
      const v = r[k];
      if (!v) return;
      conta[v] = conta[v] || { n: 0, campionato: 0 };
      conta[v].n++;
      if (k === 'campionato') conta[v].campionato++;
    }));
    const bacheca = Object.keys(conta).map(k => ({ nome: k, n: conta[k].n, c: conta[k].campionato }))
      .sort((x, y) => y.c - x.c || y.n - x.n).slice(0, 12);
    return `<div class="stack">
      <div class="card">
        <div class="sec-h"><h2>Bacheca</h2><span>trofei di sempre</span></div>
        <div class="plist">${bacheca.map((b, i) => `<div class="prow" style="grid-template-columns:20px 1fr auto">
          <span class="pos muted">${i + 1}</span>
          <span class="who"><b>${esc(b.nome)}</b><span>${b.c} campionat${b.c === 1 ? 'o' : 'i'}</span></span>
          <span class="val"><b>${b.n}</b><span>trofei</span></span></div>`).join('')}</div>
      </div>
      <div class="card">
        <div class="sec-h"><h2>Albo d’oro</h2><span>${a.length} stagioni</span></div>
        <div class="scroll-x"><table class="tbl"><thead><tr><th class="l">Stagione</th><th class="l">Campionato</th><th class="l">Coppa</th><th class="l">C. di Lega</th><th class="l">Supercoppa</th></tr></thead><tbody>
          ${a.map(r => `<tr><td class="l nm">${esc(r.stagione)}</td><td class="l">${esc(r.campionato || '')}</td><td class="l">${esc(r.coppa || '')}</td><td class="l">${esc(r.coppa_lega || '')}</td><td class="l">${esc(r.supercoppa || '')}</td></tr>`).join('')}
        </tbody></table></div>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------ premi
  function vistaPremi() {
    const riga = (a, b) => `<div class="prow" style="grid-template-columns:1fr auto"><span class="who"><b>${esc(a)}</b></span><span class="val"><b>${esc(b)}</b></span></div>`;
    return `<div class="stack">
      <div class="card">
        <div class="sec-h"><h2>Montepremi</h2><span>25 euro a squadra · 200 euro in totale</span></div>
        <div class="group-h">Campionato</div>
        <div class="plist">${riga('1º dopo le 20 giornate', '5 €')}${riga('1º classificato', '70 €')}${riga('2º classificato', '40 €')}${riga('3º classificato', '20 €')}${riga('4º classificato', '10 €')}</div>
        <div class="group-h">Coppa di Lega</div>
        <div class="plist">${riga('1º classificato', '20–25 €')}${riga('2º classificato', '10–15 €')}${riga('3º classificato', '5 €')}</div>
        <div class="group-h">Coppa e Supercoppa</div>
        <div class="plist">${riga('Coppa, 1º', '5–10 €')}${riga('Coppa, 2º', '0–5 €')}${riga('Supercoppa', '5 €')}</div>
        <p class="small muted" style="margin:0">Gli importi di Coppa e Coppa di Lega dipendono da come si sviluppa il calendario: più turni si giocano con andata e ritorno, più pesa la Coppa.</p>
      </div>
      <div class="card">
        <div class="sec-h"><h2>Crediti per la prossima stagione</h2><span>si portano al mercato</span></div>
        <div class="plist">
          ${riga('Campionato: 1º stagione regolare', '5')}${riga('Campionato: 1º / 2º / 3º / 4º', '15 / 8 / 4 / 2')}
          ${riga('Coppa di Lega: 1º / 2º / 3º / 4º', '10 / 6 / 3 / 1')}
          ${riga('Coppa: 1º / 2º', '4 / 1')}${riga('Supercoppa: 1º', '1')}
        </div>
      </div>
      <div class="card">
        <div class="sec-h"><h2>Come si fanno i gol</h2><span>dal punteggio al risultato</span></div>
        <p class="small muted" style="margin:0">Il punteggio di giornata è la somma dei fantavoti, più 2 se giochi in casa, più il bonus che ti lascia il modulo dell’avversario
        (3-4-3 +1,5 · 4-3-3 +1 · 3-5-2 +0,5 · 4-4-2 0 · 5-3-2 −0,5 · 4-5-1 −1 · 5-4-1 −1,5).
        Sotto 66 nessun gol, poi un gol ogni 6 punti: 66–71,5 uno, 72–77,5 due, e così via.</p>
      </div>
    </div>`;
  }

  // ----------------------------------------------------------- caricamento xls
  async function caricaGiornata(file) {
    if (!file) return;
    let dati;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      dati = Giornata.parse(bytes, file.name);
    } catch (e) {
      console.error(e);
      notice(e && e.message ? e.message : 'Non riesco a leggere il file.', 'error');
      return;
    }
    const giocate = dati.calendario.filter(m => m.giocata).length;
    const el = sheet(`<div class="sheet-h"><div><h4>Caricare la giornata ${dati.giornata}?</h4><p>${esc(file.name)}</p></div></div>
      <div class="sheet-b">
        <div class="tiles" style="margin-top:12px">
          ${tile(dati.giornata, 'giornata di lega')}
          ${tile(dati.serie_a + 'ª', 'di Serie A')}
          ${tile(giocate, 'partite giocate')}
          ${tile(dati.voti.length, 'voti')}
        </div>
        <div class="plist" style="margin-top:12px">
          ${dati.squadre_giornata.map(t => `<div class="prow" style="grid-template-columns:1fr auto">
            <span class="who"><b>${esc(bel(t.squadra))}</b><span>${esc(t.modulo || '')} · ${t.gol_fatti != null ? t.gol_fatti + '–' + t.gol_subiti + ' con ' + esc(t.avversario || '') : 'senza partita'}</span></span>
            <span class="val"><b>${n1(t.punteggio)}</b><span>punteggio</span></span></div>`).join('')}
        </div>
        <p class="small muted" style="margin:12px 0 0">Vengono aggiornati risultati, classifiche, voti, marcatori, rose e crediti.
        Le formazioni salvate in Schiera restano dove sono: se non coincidono con il file te lo dico.</p>
      </div>
      <div class="sheet-f"><button type="button" class="btn btn-ghost" data-act="close">Annulla</button><button type="button" class="btn btn-primary" data-act="go">Carica</button></div>`);
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') { closeSheet(); return; }
      b.disabled = true; b.innerHTML = '<span class="spin"></span> Carico…';
      try {
        const res = await SB.rpc('import_round', { p: dati });
        closeSheet();
        S.cache = {};
        await caricaBase();
        S.giornataScelta = res.giornata;
        render();
        const diff = res.differenze || [];
        notice('Giornata ' + res.giornata + ' caricata: ' + res.partite + ' partite, ' + res.voti + ' voti, ' + res.classifiche + ' righe di classifica.');
        if (diff.length) mostraDifferenze(diff);
      } catch (e) {
        console.error(e);
        closeSheet();
        notice(NON_CE(e)
          ? 'Manca la parte di database della stagione: esegui db/08_stagione.sql nel SQL Editor di Supabase, poi riprova.'
          : (e && e.message ? e.message : 'Caricamento non riuscito.'), 'error');
      }
    });
  }

  function mostraDifferenze(diff) {
    sheet(`<div class="sheet-h"><div><h4>Formazioni diverse</h4><p>${diff.length} squadr${diff.length === 1 ? 'a' : 'e'}: nel file risulta una formazione diversa da quella salvata nell’app</p></div></div>
      <div class="sheet-b">${diff.map(d => `<div class="group-h">${esc(d.squadra)}</div>
        <p class="small" style="margin:0"><b>Nell’app:</b> ${esc((d.nell_app || []).join(', '))}</p>
        <p class="small" style="margin:4px 0 10px"><b>Nel file:</b> ${esc((d.nel_file || []).join(', '))}</p>`).join('')}
        <p class="small muted">Vale il file: è quello con cui sono stati calcolati i punteggi. La formazione salvata resta nello storico di Schiera.</p></div>
      <div class="sheet-f"><button type="button" class="btn btn-primary" data-act="close">Ho capito</button></div>`);
  }


  // ------------------------------------------------------------- una squadra
  const esitoDi = (m, id) => {
    if (m.gol_casa == null) return null;
    const mio = m.casa === id ? m.gol_casa : m.gol_fuori;
    const suo = m.casa === id ? m.gol_fuori : m.gol_casa;
    return mio > suo ? 'v' : mio === suo ? 'n' : 'p';
  };

  // la forma: gli ultimi risultati, il più recente a destra
  const forma = (ris, n) => `<span class="forma">${ris.slice(-(n || 5)).map(r =>
    `<span class="esito ${r.esito}" title="${esc(teamName(r.avversario) + ' ' + r.gf + '–' + r.gs + ', giornata ' + r.round)}">${r.esito.toUpperCase()}</span>`).join('')}</span>`;
  const inCorso = se => !se.in_corso ? '' : se.in_corso.n + ' ' + ({ v: se.in_corso.n === 1 ? 'vittoria' : 'vittorie', n: se.in_corso.n === 1 ? 'pareggio' : 'pareggi', p: se.in_corso.n === 1 ? 'sconfitta' : 'sconfitte' })[se.in_corso.esito] + ' di fila';

  // ---------------------------------------------------- una squadra: panoramica
  async function vistaSquadra(id) {
    const u = ultima();
    const t = teamById(id);
    if (!u || !t) return '<div class="card"><p class="empty">Ancora nessuna giornata caricata.</p></div>';
    const [camp, cdl, sfiga, ps] = await Promise.all([
      classifiche('campionato'), classifiche('coppa_lega'), classifiche('sfigometro'), statGiocatori()
    ]);
    const mia = camp.filter(r => r.round === u.id).find(r => r.team_id === id) || {};
    const c = cdl.filter(r => r.round === u.id).find(r => r.team_id === id) || {};
    const sf = sfiga.filter(r => r.round === u.id).find(r => r.team_id === id) || {};
    const d = mia.dati || {};
    const mie = partiteDi(id).filter(m => m.gol_casa != null);
    const ris = window.Calcoli.risultati(S.matches, id);
    const se = window.Calcoli.serie(ris.map(r => r.esito));
    const migliori = ps.filter(p => p.team_id === id && nz(p.presenze) > 0)
      .sort((a, b) => nz(b.fantamedia) - nz(a.fantamedia)).slice(0, 6);
    const prossima = partiteDi(id).filter(m => m.gol_casa == null)[0];

    return `<div class="card">
        <div class="sec-h"><h2>${esc(bel(t.name))}</h2><span>dopo la ${u.id}ª</span></div>
        <div class="tiles">
          ${tile(mia.pos ? mia.pos + 'º' : '—', 'in campionato')}
          ${tile(n1(mia.valore), 'punti')}
          ${tile(nz(d.gf) + '-' + nz(d.gs), 'gol')}
          ${tile(n1((c.dati || {}).media), 'media a giornata')}
          ${tile(c.pos ? c.pos + 'º' : '—', 'in Coppa di Lega')}
          ${tile(sf.pos ? sf.pos + 'º' : '—', 'nello sfigometro')}
        </div>
        ${ris.length ? `<div class="riga-forma"><span class="small muted">Ultime partite</span>${forma(ris, 5)}<span class="small muted">${esc(inCorso(se))}</span></div>` : ''}
        ${prossima ? `<p class="small muted" style="margin:0">Prossima: <b>${esc(prossima.casa ? teamName(prossima.casa) : 'da definire')}</b> – <b>${esc(prossima.fuori ? teamName(prossima.fuori) : 'da definire')}</b> (giornata ${prossima.round})</p>` : ''}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Le partite</h3><span>${mie.length} giocate</span></div>
        <div class="plist">${mie.map(m => {
          const e = esitoDi(m, id);
          const avv = m.casa === id ? m.fuori : m.casa;
          const mio = m.casa === id ? m.gol_casa : m.gol_fuori, suo = m.casa === id ? m.gol_fuori : m.gol_casa;
          return `<div class="prow" style="grid-template-columns:20px 1fr auto">
            <span class="esito ${e}">${e.toUpperCase()}</span>
            <span class="who"><b>${esc(teamName(avv))}</b><span>giornata ${m.round} · ${m.casa === id ? 'in casa' : 'in trasferta'}</span></span>
            <span class="val"><b>${mio}–${suo}</b><span>${n1(m.casa === id ? m.totale_casa : m.totale_fuori)}</span></span></div>`;
        }).join('')}</div>
      </div>
      <div class="card">
        <div class="sec-h"><h3>I migliori della rosa</h3><span>per fantamedia</span></div>
        <div class="plist">${migliori.map(p => `<div class="prow">
          <span class="badge" data-r="${esc(p.ruolo)}">${esc(p.ruolo)}</span>
          <span class="who"><b>${esc(p.nome)}</b><span>${p.presenze} presenz${p.presenze === 1 ? 'a' : 'e'}</span></span>
          <span class="val"><b>${n1(p.fantamedia)}</b><span>voto ${n1(p.media)}</span></span></div>`).join('')}</div>
        <a class="linkish" href="#/squadre/statistiche">tutte le statistiche della squadra</a>
      </div>`;
  }

  // -------------------------------------------------- una squadra: statistiche
  async function vistaStatSquadra(id) {
    const u = ultima();
    const t = teamById(id);
    if (!u || !t) return '<div class="card"><p class="empty">Ancora nessuna giornata caricata.</p></div>';
    const C = window.Calcoli;
    const [cdl, camp, ps, rt, voti] = await Promise.all([classifiche('cdl_giornata'), classifiche('campionato'),
      statGiocatori(), tabelliniTutti(), votiTutti()]);
    const nome = bel(t.name);

    // 1) punteggio di giornata contro la media della lega
    const dist = C.distribuzione(cdl);
    const mie = cdl.filter(r => r.team_id === id && r.valore != null).sort((a, b) => a.round - b.round).map(r => ({ x: r.round, y: +r.valore }));
    const media = dist.map(d => ({ x: d.round, y: d.media }));
    const sopra = mie.filter(p => { const m = media.find(x => x.x === p.x); return m && p.y > m.y; }).length;
    const best = mie.reduce((m, x) => (!m || x.y > m.y ? x : m), null), worst = mie.reduce((m, x) => (!m || x.y < m.y ? x : m), null);
    const mediaMia = mie.length ? mie.reduce((s, x) => s + x.y, 0) / mie.length : null;

    // 2) posizione in classifica giornata per giornata
    const pos = C.posizioni(S.matches, S.teams.map(x => x.id), camp);

    // 3) risultati e serie
    const ris = C.risultati(S.matches, id);
    const se = C.serie(ris.map(r => r.esito));

    // 4) chi porta i punti
    const rep = C.reparti(rt);
    const r4 = rep.squadre.get(id);
    const miei = ps.filter(p => p.team_id === id && nz(p.presenze) > 0);
    const maxP = Math.max.apply(null, [1].concat(miei.map(p => nz(p.presenze))));
    const regolari = miei.filter(p => nz(p.presenze) >= Math.max(1, Math.ceil(maxP / 2)));
    const top = regolari.slice().sort((a, b) => nz(b.fantamedia) - nz(a.fantamedia)).slice(0, 3);
    const flop = regolari.slice().sort((a, b) => nz(a.fantamedia) - nz(b.fantamedia)).filter(p => !top.includes(p)).slice(0, 3);
    const bonus = miei.map(p => Object.assign({}, p, { bonus: p.bonus_netti != null ? +p.bonus_netti : (nz(p.fantamedia) - nz(p.media)) * nz(p.presenze) }))
      .filter(p => p.bonus > 0).sort((a, b) => b.bonus - a.bonus).slice(0, 5);
    const presenze = miei.slice().sort((a, b) => nz(b.presenze) - nz(a.presenze)).slice(0, 5);

    // 5) formazione ideale
    const ide = C.idealePerGiornata(voti.filter(v => v.team_id === id), rt.filter(x => x.team_id === id));
    const lasciati = ide.reduce((s, x) => s + x.lasciati, 0);
    const eff = ide.length ? ide.reduce((s, x) => s + x.efficienza, 0) / ide.length : null;
    const peggio = ide.reduce((m, x) => (!m || x.lasciati > m.lasciati ? x : m), null);
    const ultimaIde = ide[ide.length - 1];

    const persona = (p, val, nota) => `<div class="prow">
      <span class="badge" data-r="${esc(p.ruolo)}">${esc(p.ruolo)}</span>
      <span class="who"><b>${esc(p.nome)}</b><span>${p.presenze} presenz${p.presenze === 1 ? 'a' : 'e'}</span></span>
      <span class="val"><b>${val}</b>${nota ? `<span>${nota}</span>` : ''}</span></div>`;

    return `<div class="card">
        <div class="sec-h"><h2>Punteggio di giornata</h2><span>${esc(nome)} contro la media</span></div>
        <div class="tiles q4">
          ${tile(n1(mediaMia), 'media a giornata')}
          ${tile(best ? n1(best.y) : '—', best ? 'il più alto, ' + best.x + 'ª' : 'il più alto')}
          ${tile(worst ? n1(worst.y) : '—', worst ? 'il più basso, ' + worst.x + 'ª' : 'il più basso')}
          ${tile(sopra + '/' + mie.length, 'sopra la media')}
        </div>
        ${grafico([{ nome: t.name, evidenzia: true, punti: mie }, { nome: 'Media lega', et: 'Lega', evidenzia: true, colore: 'mute', punti: media }], { alt: 'Punteggio di ogni giornata contro la media della lega' })}
        ${numeri(['Giornata', nome, 'Media lega'], mie.map(p => [p.x, n1(p.y), n1((media.find(x => x.x === p.x) || {}).y)]))}
      </div>
      <div class="card">
        <div class="sec-h"><h3>In classifica</h3><span>posizione dopo ogni giornata</span></div>
        ${grafico(S.teams.map(x => ({ nome: x.name, evidenzia: x.id === id, punti: pos.get(x.id) || [] })), { inverti: true, dominio: [1, S.teams.length], passo: 1, alt: 'Posizione in campionato giornata per giornata' })}
        <p class="small muted" style="margin:0">In alto il primo posto. In evidenza ${esc(nome)}; in grigio le altre.</p>
        ${numeri(['Giornata', nome], (pos.get(id) || []).map(p => [p.x, p.y + 'º']))}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Risultati</h3><span>${ris.length} partite</span></div>
        ${ris.length ? `<div class="riga-forma">${forma(ris, 20)}</div>` : '<p class="empty">Nessuna partita giocata.</p>'}
        <div class="tiles q4">
          ${tile(se.vittorie, 'vittorie di fila, al massimo')}
          ${tile(se.imbattuto, 'partite senza perdere')}
          ${tile(se.senza_vittorie, 'partite senza vincere')}
          ${tile(se.in_corso ? se.in_corso.n : '—', se.in_corso ? inCorso(se) + ', ora' : 'serie in corso')}
        </div>
      </div>
      <div class="card">
        <div class="sec-h"><h3>Chi porta i punti</h3><span>fantapunti a giornata per reparto</span></div>
        ${r4 ? coppie([['P', 'Portiere'], ['D', 'Difesa'], ['C', 'Centrocampo'], ['A', 'Attacco']].map(([k, et]) => ({ ruolo: k, et, a: r4[k], b: rep.lega[k] })), t.name)
          + `<p class="small muted" style="margin:0">Somma dei fantavoti di chi è entrato, reparto per reparto, in media su ${r4.giornate} giornat${r4.giornate === 1 ? 'a' : 'e'} con il file caricato.</p>`
          : '<p class="empty">Servono le formazioni di almeno una giornata caricata.</p>'}
        ${top.length ? `<div class="group-h">I migliori</div><div class="plist">${top.map(p => persona(p, n1(p.fantamedia), 'voto ' + n1(p.media))).join('')}</div>` : ''}
        ${flop.length ? `<div class="group-h">I meno brillanti</div><div class="plist">${flop.map(p => persona(p, n1(p.fantamedia), 'voto ' + n1(p.media))).join('')}</div>` : ''}
        ${bonus.length ? `<div class="group-h">Più bonus</div><div class="plist">${bonus.map(p => persona(p, '+' + n1(p.bonus), 'fantavoto meno voto')).join('')}</div>` : ''}
        ${presenze.length ? `<div class="group-h">Più presenze</div><div class="plist">${presenze.map(p => persona(p, p.presenze, 'presenze')).join('')}</div>` : ''}
        <p class="small muted" style="margin:0">Fantamedie di chi ha giocato almeno metà delle giornate del più presente della rosa.</p>
      </div>
      <div class="card">
        <div class="sec-h"><h3>Formazione ideale</h3><span>punti lasciati in panchina</span></div>
        ${ide.length ? `<div class="tiles q3">
            ${tile(n1(lasciati), 'punti lasciati in tutto')}
            ${tile(eff != null ? Math.round(eff * 100) + '%' : '—', 'del massimo raccolto')}
            ${tile(peggio ? n1(peggio.lasciati) : '—', peggio ? 'il massimo, ' + peggio.round + 'ª' : 'il massimo')}
          </div>
          ${colonne(ide.map(x => ({ x: x.round, v: x.lasciati, tt: 'Giornata ' + x.round + '\nfatti ' + n1(x.fatto) + ' · ideale ' + n1(x.ideale) + ' (' + x.modulo_ideale + ')\nlasciati in panchina ' + n1(x.lasciati) })), { alt: 'Punti lasciati in panchina, giornata per giornata' })}
          ${ultimaIde && ultimaIde.migliori_fuori.length ? `<p class="small" style="margin:0">Nella ${ultimaIde.round}ª, nella formazione ideale (${esc(ultimaIde.modulo_ideale)}) c'erano anche: ${esc(ultimaIde.migliori_fuori.map(g => g.nome + ' ' + n1(g.fantavoto)).join(', '))}.</p>` : ''}
          ${numeri(['Giornata', 'Fatti', 'Ideale', 'Modulo', 'Lasciati'], ide.map(x => [x.round, n1(x.fatto), n1(x.ideale), x.modulo_ideale, n1(x.lasciati)]))}`
          : '<p class="empty">Servono i voti di almeno una giornata caricata.</p>'}
        <p class="small muted" style="margin:0">La formazione ideale prende i migliori di chi ha giocato: un portiere e il modulo che dà più punti fra quelli ammessi. Il confronto è con i fantavoti di chi è entrato davvero, senza fattore campo e bonus del modulo.</p>
      </div>`;
  }

  // ------------------------------------------------- una squadra: testa a testa
  async function vistaConfronto(a) {
    const u = ultima();
    if (!u) return '<div class="card"><p class="empty">Ancora nessuna giornata caricata.</p></div>';
    const b = S.confrontoB && S.confrontoB !== a ? S.confrontoB : (S.teams.find(t => t.id !== a) || {}).id;
    const ta = teamById(a), tb = teamById(b);
    const [perGiornata, camp] = await Promise.all([classifiche('cdl_giornata'), classifiche('campionato')]);
    const pg = id => perGiornata.filter(r => r.team_id === id).sort((x, y) => x.round - y.round).map(r => ({ x: r.round, y: +r.valore }));
    const serieA = pg(a), serieB = pg(b);
    const scontri = S.matches.filter(m => m.gol_casa != null &&
      ((m.casa === a && m.fuori === b) || (m.casa === b && m.fuori === a)));
    const vinte = id => scontri.filter(m => esitoDi(m, id) === 'v').length;
    const pari = scontri.filter(m => esitoDi(m, a) === 'n').length;
    const media = s => (s.length ? s.reduce((x, p) => x + p.y, 0) / s.length : null);
    const meglio = () => {
      let na = 0, nb = 0;
      serieA.forEach((p, i) => { const q = serieB[i]; if (!q) return; if (p.y > q.y) na++; else if (q.y > p.y) nb++; });
      return na + '–' + nb;
    };
    const sel = `<select data-conf="b" style="padding:9px 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);color:inherit;flex:1;min-width:0">
      ${S.teams.filter(t => t.id !== a).map(t => `<option value="${t.id}" ${t.id === b ? 'selected' : ''}>${esc(bel(t.name))}</option>`).join('')}</select>`;

    return `<div class="card">
        <div class="sec-h"><h2>Testa a testa</h2><span>dopo la ${u.id}ª</span></div>
        <div style="display:flex;gap:8px;align-items:center"><b style="flex:1;min-width:0">${esc(bel(ta ? ta.name : ''))}</b><span class="muted">contro</span>${sel}</div>
        <div class="tiles q4">
          ${tile(vinte(a) + '–' + pari + '–' + vinte(b), 'scontri diretti')}
          ${tile(n1(media(serieA)), 'media ' + bel(ta ? ta.name : ''))}
          ${tile(n1(media(serieB)), 'media ' + bel(tb ? tb.name : ''))}
          ${tile(meglio(), 'giornate vinte')}
        </div>
      </div>
      <div class="card">
        <div class="sec-h"><h3>Punteggi a confronto</h3><span>giornata per giornata</span></div>
        ${grafico([
          { nome: ta ? ta.name : '', evidenzia: true, punti: serieA },
          { nome: tb ? tb.name : '', evidenzia: true, colore: 'b', punti: serieB }
        ], { alt: 'Punteggi di giornata a confronto' })}
        ${numeri(['Giornata', bel(ta ? ta.name : ''), bel(tb ? tb.name : '')], serieA.map(p => [p.x, n1(p.y), n1((serieB.find(q => q.x === p.x) || {}).y)]))}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Precedenti</h3><span>${scontri.length} partit${scontri.length === 1 ? 'a' : 'e'}</span></div>
        ${scontri.length ? '<div>' + scontri.map(m => rigaPartita(m)).join('') + '</div>'
          : '<p class="empty">Non si sono ancora incontrate.</p>'}
      </div>
      <div class="card">
        <div class="sec-h"><h3>In classifica</h3><span>campionato</span></div>
        ${tabellaCampionato(camp.filter(r => r.round === u.id && (r.team_id === a || r.team_id === b)), true)}
      </div>`;
  }

  // ------------------------------------------------------------------ squadre
  async function sezioneSquadre() {
    const tab = ['rosa', 'statistiche', 'confronto'].includes(S.sotto) ? S.sotto : '';
    const id = S.squadraScelta || (S.team && S.team.id) || (S.teams[0] || {}).id;
    const corpo = tab === 'rosa' ? await vistaRosa(id) : tab === 'statistiche' ? await vistaStatSquadra(id)
      : tab === 'confronto' ? await vistaConfronto(id) : await vistaSquadra(id);
    return `<div class="stack">
      ${schede('squadre', [{ id: '', et: 'Sintesi' }, { id: 'rosa', et: 'Rosa' }, { id: 'statistiche', et: 'Statistiche' }, { id: 'confronto', et: 'Confronto' }], tab, 'larghe')}
      <div class="chips scorre" id="sqChips">${S.teams.map(x => `<button type="button" class="chip" data-squadra="${x.id}" aria-pressed="${x.id === id}">${esc(bel(x.name))}</button>`).join('')}</div>
      ${corpo}
    </div>`;
  }

  // --------------------------------------------------------------------- lega
  async function sezioneLega() {
    const tab = ['albo', 'premi'].includes(S.sotto) ? S.sotto : '';
    const corpo = tab === 'albo' ? await vistaAlbo() : tab === 'premi' ? vistaPremi() : await vistaStatLega();
    return `<div class="stack">
      ${schede('lega', [{ id: '', et: 'Statistiche' }, { id: 'albo', et: 'Albo d’oro' }, { id: 'premi', et: 'Premi' }], tab, 'larghe')}
      ${corpo}
    </div>`;
  }

  // ------------------------------------------------------------------ sezioni
  // icone a tratto, 24x24
  const ICONE = {
    home: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z"/>',
    cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    podio: '<path d="M9 20V9.5h6V20M3.5 20v-6H9M15 20v-8.5h5.5V20M2.5 20h19"/>',
    stat: '<path d="M5 20v-7M10 20V6M15 20v-9M20 20V9"/>',
    altro: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    maglia: '<path d="M9 4 4 7l2 4 2-1v10h8V10l2 1 2-4-5-3a3 3 0 0 1-6 0z"/>',
    schiera: '<path d="M9 4 4 7l2 4 2-1v10h8V10l2 1 2-4-5-3a3 3 0 0 1-6 0z"/><path d="M10.5 13.5l1.5 1.5 3-3"/>',
    rose: '<path d="M8 7h12M8 12h12M8 17h12"/><circle cx="4.5" cy="7" r=".9"/><circle cx="4.5" cy="12" r=".9"/><circle cx="4.5" cy="17" r=".9"/>',
    vs: '<path d="M4 8h12l-3-3M20 16H8l3 3"/>',
    coppa: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7l-1-3h-5z"/>',
    tabellone: '<path d="M3 5h5v4h4M3 13h5V9M12 9v7h4M3 19h9v-3M16 12.5h5"/>',
    albo: '<circle cx="12" cy="9" r="5"/><path d="m9 13.5-1.5 6.5L12 18l4.5 2L15 13.5"/>',
    premi: '<circle cx="12" cy="12" r="8"/><path d="M15 9a3.5 3.5 0 1 0 0 6M8 11h5M8 13.5h5"/>',
    via: '<path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"/>'
  };
  const icona = (k, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONE[k]}</svg>`;

  // Sei sezioni. Al telefono quelle con "barra" stanno nella barra in basso (Schiera al
  // centro) e le altre nel pannello "Altro"; sul computer stanno tutte nella barra in alto.
  const SEZIONI = [
    { id: '', et: 'Home', ico: 'home', barra: true, vista: home },
    { id: 'giornata', et: 'Giornata', ico: 'cal', barra: true, vista: sezioneGiornata },
    { id: 'schiera', et: 'Schiera', ico: 'schiera', barra: true, vista: null },
    { id: 'classifiche', et: 'Classifiche', ico: 'podio', barra: true, vista: sezioneClassifiche },
    { id: 'squadre', et: 'Squadre', ico: 'maglia', vista: sezioneSquadre, desc: 'Rosa, statistiche e testa a testa di ogni squadra' },
    { id: 'lega', et: 'Lega', ico: 'stat', vista: sezioneLega, desc: 'Statistiche di lega, record, albo d’oro e premi' }
  ];

  // i vecchi indirizzi (prima del riordino) portano dove sta ora la stessa cosa
  const VECCHIE = {
    calendario: 'giornata', statistiche: 'lega', squadra: 'squadre', rose: 'squadre/rosa', confronto: 'squadre/confronto',
    coppe: 'classifiche/coppa', playoff: 'classifiche/playoff', albo: 'lega/albo', premi: 'lega/premi'
  };
  function leggiIndirizzo() {
    let [a, b] = (location.hash || '').replace(/^#\/?/, '').split('/');
    if (VECCHIE[a]) {
      const nuovo = VECCHIE[a];
      try { history.replaceState(null, '', '#/' + nuovo); } catch (e) { /* ok */ }
      [a, b] = nuovo.split('/');
    }
    S.sezione = a || '';
    S.sotto = b || '';
  }

  // da fare: giornata aperta e formazione non ancora salvata
  const daSchierare = () => {
    const sc = window.Schiera ? Schiera.scadenza() : { fase: 'nessuna' };
    return !!(window.Schiera && Schiera.pronta() && !Schiera.salvata() && !['nessuna', 'chiusa'].includes(sc.fase));
  };

  function navHtml() {
    const qui = SEZIONI.find(s => s.id === S.sezione) || SEZIONI[0];
    const cls = s => s.id === 'schiera' ? 'tb-schiera' : s.barra ? '' : 'solo-pc';
    return SEZIONI.map(s =>
      `<a href="#/${s.id}" ${s === qui ? 'aria-current="page"' : ''} class="${cls(s)}"${s.id === 'schiera' && daSchierare() ? ' data-da-fare' : ''}>${icona(s.ico)}<span>${esc(s.et)}</span></a>`).join('') +
      `<button type="button" id="altroBtn" class="solo-tel" aria-haspopup="dialog" ${qui.barra ? '' : 'aria-current="page"'}>${icona('altro')}<span>${qui.barra ? 'Altro' : esc(qui.et)}</span></button>`;
  }

  // il riquadro verde per andare a schierare: in Home, con il conto alla rovescia
  const due = n => String(n).padStart(2, '0');
  function contoBreve() {
    if (!window.Schiera || !Schiera.pronta()) return '';
    const sc = Schiera.scadenza();
    if (!sc.t || sc.fase === 'chiusa' || sc.fase === 'nessuna') return '';
    const p = Schiera.pezzi(sc.t);
    return (p.g ? p.g + 'g ' : '') + due(p.h) + ':' + due(p.m) + ':' + due(p.s);
  }
  function schieraDentro() {
    const pronta = window.Schiera && Schiera.pronta();
    const sc = pronta ? Schiera.scadenza() : { fase: 'nessuna' };
    let quando = pronta ? Schiera.giornata() : '';
    if (!quando) {
      const r = S.rounds.find(x => !x.giocata);
      quando = r ? `Giornata ${r.id} (${r.serie_a || r.id + 2}ª di Serie A)` : 'per la prossima giornata';
    }
    const stato = !pronta ? '' : sc.fase === 'chiusa' ? 'giornata chiusa'
      : Schiera.salvata() ? '✓ formazione salvata' : 'formazione non ancora salvata';
    const conto = contoBreve();
    return `${icona('schiera')}<span class="t"><b>Schiera la formazione</b><span>${esc(quando)}${stato ? ' · ' + esc(stato) : ''}</span></span>`
      + (conto ? `<span class="conto-mini"><i>${esc(sc.fase === 'prima' ? 'primo fischio' : 'prossimo blocco')}</i><b data-conto>${esc(conto)}</b></span>` : '');
  }
  function aggiornaSchieraSito() {
    if (!S.pronta) return;
    $('#nav').innerHTML = navHtml();
    $('#schieraBig').innerHTML = schieraDentro();
  }
  // ogni secondo, solo il numero del conto alla rovescia
  setInterval(() => {
    const b = document.querySelector('#schieraBig [data-conto]');
    if (b && !$('#schieraBig').hidden) b.textContent = contoBreve();
  }, 1000);

  function apriAltro() {
    const qui = S.sezione;
    const el = sheet(`<div class="sheet-b altro">
      <div class="altro-grid due">${SEZIONI.filter(s => !s.barra).map(s =>
        `<a href="#/${s.id}" ${s.id === qui ? 'aria-current="page"' : ''}>${icona(s.ico)}<span><b>${esc(s.et)}</b><small>${esc(s.desc || '')}</small></span></a>`).join('')}</div>
    </div>`);
    el.addEventListener('click', ev => { if (ev.target.closest('.altro-grid a')) closeSheet(); });
  }

  async function render() {
    const sez = SEZIONI.find(s => s.id === S.sezione) || SEZIONI[0];
    $('#nav').innerHTML = navHtml();
    $('#schieraBig').innerHTML = schieraDentro();
    // il riquadro verde: al telefono solo in Home (c'è il pulsante al centro della
    // barra), sul computer in tutte le sezioni; mai dentro Schiera
    document.body.dataset.sez = sez.id || 'home';
    $('#schieraBig').hidden = sez.id === 'schiera';
    const inSchiera = sez.id === 'schiera';
    document.body.classList.toggle('in-schiera', inSchiera);
    if (window.Schiera) Schiera.mostra(inSchiera);
    $('#view').hidden = inSchiera;
    if (inSchiera) {
      $('#foot').textContent = '';
      window.scrollTo(0, 0);
      return;
    }
    $('#view').innerHTML = '<div class="card"><p class="empty"><span class="spin"></span></p></div>';
    try {
      $('#view').innerHTML = await sez.vista();
    } catch (e) {
      console.error(e);
      $('#view').innerHTML = '<div class="card"><p class="empty">' + esc(e && e.message ? e.message : 'Qualcosa non ha funzionato.') + '</p></div>';
    }
    collegaGrafici();
    // la squadra scelta resta visibile nella riga che scorre
    const scelta = document.querySelector('.chips.scorre [aria-pressed="true"]');
    if (scelta) scelta.parentNode.scrollLeft = scelta.offsetLeft - scelta.parentNode.offsetLeft - 8;
    const u = ultima();
    $('#foot').textContent = u ? 'Dati della giornata ' + u.id + (u.caricata_at ? ' · caricati il ' + new Date(u.caricata_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : '') : '';
  }

  // tocco e passaggio del dito sul grafico
  function collegaGrafici() {
    // colonne e baffi: ogni segno ha il suo riquadro (più grande del segno) con data-tt
    document.querySelectorAll('.chart-wrap.tt').forEach(w => {
      const tip = w.querySelector('.tip');
      let attivo = null;
      const mostra = g => {
        if (attivo) attivo.classList.remove('su');
        attivo = g; g.classList.add('su');
        const r = w.getBoundingClientRect(), b = g.getBoundingClientRect();
        tip.hidden = false; tip.style.opacity = '1';
        tip.style.left = Math.max(70, Math.min(r.width - 70, b.left - r.left + b.width / 2)) + 'px';
        tip.style.top = Math.max(40, b.top - r.top + 24) + 'px';
        tip.innerHTML = g.dataset.tt.split('\n').map((x, i) => i ? esc(x) : '<b>' + esc(x) + '</b>').join('<br>');
      };
      const nascondi = () => { tip.style.opacity = '0'; if (attivo) attivo.classList.remove('su'); attivo = null; };
      const su = ev => {
        const pt = ev.touches ? ev.touches[0] : ev;
        const el = document.elementFromPoint(pt.clientX, pt.clientY);
        const g = el && el.closest && el.closest('[data-tt]');
        if (g && w.contains(g)) mostra(g); else nascondi();
      };
      w.addEventListener('mousemove', su);
      w.addEventListener('touchstart', su, { passive: true });
      w.addEventListener('touchmove', su, { passive: true });
      w.addEventListener('mouseleave', nascondi);
      w.addEventListener('touchend', () => setTimeout(nascondi, 1200));
      w.addEventListener('focusin', ev => { const g = ev.target.closest('[data-tt]'); if (g) mostra(g); });
      w.addEventListener('focusout', nascondi);
    });
    document.querySelectorAll('.chart-wrap:not(.tt)').forEach(w => {
      let serie = [];
      try { serie = JSON.parse(w.dataset.tip || '[]'); } catch (e) { serie = []; }
      const punti = (serie[0] || {}).p || [];
      if (!punti.length) return;
      const tip = w.querySelector('.tip');
      const muovi = ev => {
        const r = w.getBoundingClientRect();
        const x = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width;
        const i = Math.max(0, Math.min(punti.length - 1, Math.round(x * (punti.length - 1))));
        tip.hidden = false;
        tip.style.opacity = '1';
        tip.style.left = (24 / 360 * r.width + (r.width - (24 + 64) / 360 * r.width) * (punti.length === 1 ? .5 : i / (punti.length - 1))) + 'px';
        tip.style.top = (r.height * .55) + 'px';
        tip.innerHTML = 'Giornata ' + punti[i][0] + '<br>' + serie.map(s => {
          const v = (s.p[i] || [])[1];
          return esc(s.n) + ': <b>' + (v == null ? '—' : n1(v)) + '</b>';
        }).join('<br>');
      };
      const via = () => { tip.style.opacity = '0'; };
      w.addEventListener('mousemove', muovi);
      w.addEventListener('touchstart', muovi, { passive: true });
      w.addEventListener('touchmove', muovi, { passive: true });
      w.addEventListener('mouseleave', via);
      w.addEventListener('touchend', via);
    });
  }

  // ------------------------------------------------------------------ modali
  function sheet(html) {
    closeSheet();
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    scrim.addEventListener('click', ev => {
      if (ev.target === scrim || ev.target.closest('[data-act="close"]')) closeSheet();
    });
    $('#layer').appendChild(scrim);
    const f = scrim.querySelector('button');
    if (f) f.focus({ preventScroll: true });
    return scrim.firstElementChild;
  }
  const closeSheet = () => { $('#layer').innerHTML = ''; };

  function notice(text, kind) {
    const d = document.createElement('div');
    d.className = 'notice' + (kind === 'error' ? ' error' : '');
    d.innerHTML = `<span>${esc(text)}</span>`;
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'OK';
    b.addEventListener('click', () => d.remove());
    d.appendChild(b);
    $('#notices').appendChild(d);
  }
  const clearNotices = () => { $('#notices').innerHTML = ''; };
  let toastT;
  function toast(t) {
    document.querySelectorAll('.toast').forEach(x => x.remove());
    const d = document.createElement('div');
    d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = t;
    document.body.appendChild(d);
    clearTimeout(toastT); toastT = setTimeout(() => d.remove(), 2600);
  }

  // ------------------------------------------------------------------ accesso
  function mostraLogin(msg) {
    if (window.Schiera) Schiera.esci();
    document.body.classList.remove('in-schiera');
    $('#view').hidden = false;
    $('#loginCard').hidden = false;
    $('#nav').hidden = true;
    $('#schieraBig').hidden = true;
    $('#userBtn').hidden = true;
    $('#view').innerHTML = '';
    $('#foot').textContent = '';
    if (msg) notice(msg);
  }

  async function entra() {
    await caricaBase();
    $('#loginCard').hidden = true;
    $('#nav').hidden = false;
    $('#schieraBig').hidden = false;
    $('#userBtn').hidden = false;
    $('#userBtn').textContent = S.team ? bel(S.team.name) : 'Account';
    $('#userHead').innerHTML = `<b>${esc(S.profile.display_name || '')}</b><span>${esc(S.team ? bel(S.team.name) : 'senza squadra')}${isAdmin() ? ' · amministratore' : ''}</span>`;
    $('#adminMenu').hidden = !isAdmin();
    $('#sub').textContent = 'stagione 2026/27';
    clearNotices();
    if (window.Schiera) {
      Schiera.onCambio = aggiornaSchieraSito;
      Schiera.avvia();
    }
    await render();
    avvisaTabelleMancanti();
  }

  function avvisaTabelleMancanti() {
    if (!S.mancanti.length) return;
    notice(isAdmin()
      ? 'Il database della stagione non c\u2019è ancora (manca ' + S.mancanti.join(', ') + '). Esegui db/08_stagione.sql nel SQL Editor di Supabase e ricarica: se le tabelle ci sono gi\u00e0, basta "notify pgrst, \'reload schema\';".'
      : 'Il sito è in attesa dei dati della stagione: l\u2019amministratore deve ancora completare l\u2019installazione.');
  }

  // -------------------------------------------------------------------- eventi
  $('#loginForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const b = $('#loginBtn');
    b.disabled = true; b.textContent = 'Entro…';
    try {
      await SB.signIn($('#email').value, $('#password').value);
      $('#password').value = '';
      await entra();
    } catch (e) {
      console.error(e);
      notice(e && e.message ? e.message : 'Accesso non riuscito.', 'error');
      if (e.code === 'no_profile') await SB.signOut();
    }
    b.disabled = false; b.textContent = 'Entra';
  });

  $('#recoverBtn').addEventListener('click', async () => {
    const email = $('#email').value.trim();
    if (!email) { notice('Scrivi prima la tua email, poi tocca di nuovo.'); return; }
    try { await SB.recover(email, location.origin + location.pathname); notice('Ti ho mandato un’email con il link per reimpostare la password.'); }
    catch (e) { notice(e.message || 'Invio non riuscito.', 'error'); }
  });

  const apriMenu = open => {
    const p = $('#userPop');
    p.hidden = open === undefined ? !p.hidden : !open;
    $('#userBtn').setAttribute('aria-expanded', String(!p.hidden));
  };
  $('#userBtn').addEventListener('click', e => { e.stopPropagation(); apriMenu(); });
  document.addEventListener('click', e => { if (!e.target.closest('.top')) apriMenu(false); });
  $('#logoutBtn').addEventListener('click', async () => {
    apriMenu(false);
    await SB.signOut();
    S.profile = null; S.team = null; S.pronta = false;
    mostraLogin();
  });
  $('#adminBtn').addEventListener('click', () => { apriMenu(false); $('#roundFile').click(); });
  // tutte le formazioni della giornata in corso in un file solo
  $('#tutteBtn').addEventListener('click', () => {
    apriMenu(false);
    const r = roundCorrente();
    const sa = (S.md && S.md.id) || (r && r.serie_a);
    if (!sa) { notice('Non c’è una giornata in corso.'); return; }
    if (r) S.giornataScelta = r.id;
    if (location.hash !== '#/giornata/formazioni') location.hash = '#/giornata/formazioni';
    scaricaTutte(sa);
  });
  $('#fcBtn').addEventListener('click', () => { apriMenu(false); $('#fcFile').click(); });
  $('#fcFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; caricaFc(f); });
  // le funzioni da amministratore di Schiera: si aprono nella sezione Schiera
  [['#rosterBtn', 'rose'], ['#calBtn', 'calendario'], ['#clubBtn', 'squadre'], ['#matchdayBtn', 'giornata']].forEach(([id, f]) => {
    $(id).addEventListener('click', () => {
      apriMenu(false);
      if (S.sezione !== 'schiera') location.hash = '#/schiera';
      Schiera.admin[f]();
    });
  });
  $('#pwdBtn').addEventListener('click', () => { apriMenu(false); Schiera.nuovaPassword(null, { annullabile: true }); });
  // l'app sul telefono (Android): il browser la propone, noi mettiamo il pulsante nel menu
  let installa = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installa = e; $('#installBtn').hidden = false; });
  $('#installBtn').addEventListener('click', async () => {
    apriMenu(false);
    if (!installa) return;
    installa.prompt();
    try { await installa.userChoice; } catch (e) { /* ignora */ }
    installa = null; $('#installBtn').hidden = true;
  });
  $('#roundFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; caricaGiornata(f); });
  $('#themeBtn').addEventListener('click', () => {
    apriMenu(false);
    const ora = document.documentElement.getAttribute('data-theme');
    const scuro = ora ? ora === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', scuro ? 'light' : 'dark');
    const p = prefs(); p.tema = scuro ? 'light' : 'dark'; setPrefs(p);
  });

  // tocchi dentro le sezioni
  $('#view').addEventListener('click', ev => {
    const m = ev.target.closest('[data-match]');
    if (m) { const [r, s] = m.dataset.match.split(':').map(Number); apriPartita(r, s); return; }
    const fm = ev.target.closest('[data-formazioni]');
    if (fm) { const [r, s] = fm.dataset.formazioni.split(':').map(Number); apriFormazioni(r, s); return; }
    const tt = ev.target.closest('[data-tutte]');
    if (tt) { scaricaTutte(+tt.dataset.tutte); return; }
    const g = ev.target.closest('[data-gio]');
    if (g && g.dataset.gio) { S.giornataScelta = +g.dataset.gio; render(); return; }
    const sq = ev.target.closest('[data-squadra]');
    if (sq) { S.squadraScelta = sq.dataset.squadra; render(); return; }
    const cf = ev.target.closest('[data-conf]');
    if (cf) return;
    const se = ev.target.closest('[data-serie]');
    if (se) { const p = prefs(); p.graficoSquadra = se.dataset.serie; setPrefs(p); render(); return; }
  });

  $('#view').addEventListener('change', ev => {
    const cf = ev.target.closest('[data-conf]');
    if (!cf) return;
    S.confrontoB = cf.value;
    render();
  });

  $('#nav').addEventListener('click', ev => { if (ev.target.closest('#altroBtn')) apriAltro(); });

  window.addEventListener('hashchange', () => {
    const prima = S.sezione;
    leggiIndirizzo();
    if (S.sezione === 'giornata' && prima !== 'giornata') S.giornataScelta = null;   // si riparte dalla giornata giusta
    if (S.pronta) render();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSheet(); apriMenu(false); } });

  // --------------------------------------------------------------------- avvio
  (async function start() {
    const p = prefs();
    if (p.tema) document.documentElement.setAttribute('data-theme', p.tema);
    leggiIndirizzo();
    if (!window.SB || !SB.configured()) {
      $('#loginCard').hidden = true;
      $('#view').innerHTML = '<div class="card"><h2>Sito non collegato</h2><p class="muted">Manca la configurazione del database della lega.</p></div>';
      return;
    }
    const hash = SB.adoptFromHash ? SB.adoptFromHash() : null;
    try {
      if (hash && hash.type === 'recovery') {
        mostraLogin();
        if (window.Schiera) Schiera.nuovaPassword(() => entra());
        return;
      }
      if (SB.session()) { await entra(); return; }
    } catch (e) {
      console.error(e);
      await SB.signOut();
      mostraLogin(e && e.message ? e.message : 'Devi entrare di nuovo.');
      return;
    }
    mostraLogin();
  })();
})();
