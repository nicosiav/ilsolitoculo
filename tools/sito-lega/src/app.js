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
    profile: null, team: null, teams: [], rounds: [], matches: [],
    cache: {}, sezione: '', pronta: false
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

  async function caricaBase() {
    const uid = (SB.user() || {}).id || ((await SB.me()) || {}).id;
    const prof = (await SB.select('profiles', 'select=display_name,role,team_id&id=eq.' + uid))[0];
    if (!prof) throw new SB.SbError('Profilo non trovato: scrivi all’amministratore.', 'no_profile');
    S.profile = prof;
    S.teams = await SB.select('teams', 'select=id,name,sheet_name&order=name');
    S.team = S.teams.find(t => t.id === prof.team_id) || null;
    S.rounds = await SB.select('rounds', 'select=id,serie_a,fase,label,giocata,caricata_at&order=id');
    S.matches = await SB.select('matches', 'select=round,slot,casa,fuori,pos_casa,pos_fuori,gol_casa,gol_fuori,punti_casa,punti_fuori,totale_casa,totale_fuori,modulo_casa,modulo_fuori&competizione=eq.campionato&order=round,slot');
    S.cache = {};
    S.pronta = true;
  }

  const classifiche = tipo => carica('st:' + tipo, () =>
    SB.select('standings', 'select=round,team_id,pos,valore,dati&tipo=eq.' + tipo + '&order=round,pos'));
  const tabellini = round => carica('rt:' + round, () =>
    SB.select('round_teams', 'select=*&round=eq.' + round));
  const rose = () => carica('players', () =>
    SB.select('players', 'select=id,team_id,slot,role,name,club&order=team_id,slot'));
  const costi = () => carica('costi', () => SB.select('roster_costs', 'select=team_id,slot,nome,costo,valore'));
  const statGiocatori = () => carica('pstats', () => SB.select('player_stats', 'select=*'));
  const marcatori = () => carica('scorers', async () => {
    const u = ultima();
    return u ? SB.select('scorers', 'select=team_id,nome,gol,gol_sfruttati&round=eq.' + u.id + '&order=gol.desc') : [];
  });
  const stagione = () => carica('season', async () => {
    const u = ultima();
    return u ? SB.select('team_season', 'select=team_id,crediti,gol_totali,gol_sfruttati&round=eq.' + u.id) : [];
  });
  const alboDoro = () => carica('albo', () => SB.select('albo', 'select=*&order=stagione.desc'));

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
    const W = 360, H = opts.h || 190, ML = 24, MR = 52, MT = 12, MB = 22;
    const punti = [].concat.apply([], serie.map(s => s.punti));
    if (punti.length < 2) return '<p class="empty">Servono almeno due giornate per il grafico.</p>';
    const xs = punti.map(p => p.x), ys = punti.map(p => p.y);
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    let y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (opts.inverti) { const t = y0; y0 = y1; y1 = t; }
    if (y0 === y1) { y1 = y0 + 1; }
    const X = v => ML + (W - ML - MR) * (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0));
    const Y = v => MT + (H - MT - MB) * (1 - (v - y0) / (y1 - y0));
    const path = s => s.punti.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');

    const griglia = [];
    const passo = Math.max(1, Math.round(Math.abs(y1 - y0) / 4));
    for (let v = Math.min(y0, y1); v <= Math.max(y0, y1) + 0.001; v += passo) {
      griglia.push(`<line x1="${ML}" x2="${W - MR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1"/>` +
        `<text x="${ML - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`);
    }
    const assex = [];
    for (let v = x0; v <= x1; v++) {
      if (x1 - x0 > 9 && v % 2 === 0) continue;
      assex.push(`<text x="${X(v).toFixed(1)}" y="${H - 6}" text-anchor="middle">${v}</text>`);
    }
    const sfondo = serie.filter(s => !s.evidenzia).map(s =>
      `<path d="${path(s)}" fill="none" stroke="var(--chart-mute)" stroke-width="1.5" stroke-opacity=".38" stroke-linejoin="round"/>`).join('');
    const top = serie.filter(s => s.evidenzia).map(s => {
      const ult = s.punti[s.punti.length - 1];
      return `<path d="${path(s)}" fill="none" stroke="var(--chart-accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
        s.punti.map(p => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="4.5" fill="var(--chart-accent)" stroke="var(--surface)" stroke-width="2"/>`).join('') +
        `<text class="lbl" x="${(X(ult.x) + 8).toFixed(1)}" y="${(Y(ult.y) + 4).toFixed(1)}">${esc(bel(s.nome))}</text>`;
    }).join('');
    const dati = serie.filter(s => s.evidenzia).map(s => s.punti.map(p => `${p.x}:${p.y}`).join(','))[0] || '';
    return `<div class="chart-wrap" data-punti="${esc(dati)}" data-x0="${x0}" data-x1="${x1}">
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
    return `<button type="button" class="match ${cls}" ${g ? 'data-match="' + m.round + ':' + m.slot + '"' : 'disabled'}>
      <span class="t">${esc(casa)}</span>
      <span><span class="score">${punteggio}</span>${pts}</span>
      <span class="t a">${esc(fuori)}</span></button>`;
  }

  // ------------------------------------------------------------------ Home
  async function home() {
    const u = ultima();
    if (!u) {
      return `<div class="card"><h2>Ancora nessuna giornata</h2>
        <p class="muted">Quando l’amministratore carica il primo file di giornata, qui compaiono risultati, classifiche e statistiche.</p>
        <a class="btn btn-primary" href="schiera/" style="text-align:center;text-decoration:none">Vai a Schiera Formazione</a></div>`;
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
        <a class="btn btn-primary" href="schiera/" style="text-align:center;text-decoration:none">Schiera la formazione</a>
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

  async function sezioneClassifiche() {
    const u = ultima();
    if (!u) return '<div class="card"><p class="empty">Ancora nessuna giornata caricata.</p></div>';
    const quale = (prefs().classifica) || 'campionato';
    const solo = async tipo => (await classifiche(tipo)).filter(r => r.round === u.id);
    const voci = [
      { id: 'campionato', et: 'Campionato' },
      { id: 'super_corretta', et: 'Corretta' },
      { id: 'coppa_lega', et: 'Coppa di Lega' },
      { id: 'sfigometro', et: 'Sfigometro' },
      { id: 'gol_totali', et: 'Gol reali' },
      { id: 'coppa', et: 'Coppa' }
    ];
    let corpo = '', nota = '';
    if (quale === 'campionato') {
      corpo = tabellaCampionato(await solo('campionato'));
      nota = 'M.I. è la media inglese: punti in più o in meno rispetto a un pareggio a partita.';
    } else if (quale === 'super_corretta') {
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
      corpo = tabellaSemplice(q, [{ et: 'Punti', val: r => n1(r.valore) }]) + accoppiamenti(q);
      nota = 'La classifica parallela somma campionato, Coppa di Lega, gol reali e crediti residui: determina gli accoppiamenti dei quarti.';
    } else {
      const r = await solo(quale);
      corpo = tabellaSemplice(r, [
        { et: 'Totale', val: x => n1((x.dati || {}).totale) },
        { et: 'Media', val: x => n1((x.dati || {}).media) },
        { et: 'Premio', val: x => n1((x.dati || {}).premio) },
        { et: 'Punti', val: x => n1(x.valore) }
      ]);
      nota = quale === 'sfigometro' ? 'Lo sfigometro somma i punteggi degli avversari: più sei in alto, più ti è andata storta.'
        : quale === 'gol_totali' ? 'Gol realmente segnati dai giocatori in rosa, schierati o no.'
        : 'Somma dei punteggi di giornata, senza fattore campo e senza bonus del modulo avversario.';
    }
    return `<div class="stack">
      <div class="chips" id="classChips">${voci.map(v => `<button type="button" class="chip" data-class="${v.id}" aria-pressed="${v.id === quale}">${esc(v.et)}</button>`).join('')}</div>
      <div class="card">
        <div class="sec-h"><h2>${esc((voci.find(v => v.id === quale) || {}).et)}</h2><span>dopo la ${u.id}ª</span></div>
        ${corpo}
        <p class="small muted" style="margin:0">${esc(nota)}</p>
      </div>
      ${quale === 'campionato' ? graficoPunti() : ''}
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

  // ---------------------------------------------------------------- calendario
  async function sezioneCalendario() {
    const u = ultima();
    const sel = S.giornataScelta || (u ? u.id : 1);
    const r = S.rounds.find(x => x.id === sel) || { id: sel };
    const ms = S.matches.filter(m => m.round === sel);
    const prec = S.rounds.filter(x => x.id < sel).pop();
    const succ = S.rounds.filter(x => x.id > sel)[0];
    return `<div class="stack">
      <div class="card">
        <div class="sec-h">
          <h2>Giornata ${sel}</h2>
          <span>${r.serie_a ? r.serie_a + 'ª di Serie A' : ''} ${r.fase === 'orologio' ? '· fase a orologio' : ''}</span>
        </div>
        <div class="chips" style="justify-content:space-between">
          <button type="button" class="chip" data-gio="${prec ? prec.id : ''}" ${prec ? '' : 'disabled'}>‹ precedente</button>
          <button type="button" class="chip" data-gio="${succ ? succ.id : ''}" ${succ ? '' : 'disabled'}>successiva ›</button>
        </div>
        <div>${ms.length ? ms.map(m => rigaPartita(m)).join('') : '<p class="empty">Nessuna partita.</p>'}</div>
        ${r.giocata ? '<p class="small muted" style="margin:0">Tocca una partita per il tabellino con voti, subentri e marcatori.</p>' : ''}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Tutte le giornate</h3><span>20 giornate</span></div>
        <div class="chips">${S.rounds.map(x => `<button type="button" class="chip" data-gio="${x.id}" aria-pressed="${x.id === sel}">${x.id}${x.giocata ? '' : '·'}</button>`).join('')}</div>
        <p class="small muted" style="margin:0">1–14 stagione regolare, 15–20 fase a orologio. Il puntino segna le giornate non ancora giocate.</p>
      </div>
    </div>`;
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
  async function sezioneRose() {
    const [pl, cs, ps, se] = await Promise.all([rose(), costi(), statGiocatori(), stagione()]);
    const scelta = S.squadraScelta || (S.team && S.team.id) || (S.teams[0] || {}).id;
    const t = teamById(scelta);
    const miei = pl.filter(x => x.team_id === scelta);
    const costoDi = new Map(cs.filter(x => x.team_id === scelta).map(x => [x.slot, x]));
    const statDi = new Map(ps.filter(x => x.team_id === scelta).map(x => [x.nome, x]));
    const sea = se.find(x => x.team_id === scelta) || {};
    const spesa = miei.reduce((s, p) => s + nz((costoDi.get(p.slot) || {}).costo), 0);

    const gruppi = ['P', 'D', 'C', 'A'].map(ro => {
      const l = miei.filter(p => p.role === ro);
      if (!l.length) return '';
      return `<div class="group-h">${ROLE[ro]}</div><div class="plist">${l.map(p => {
        const c = costoDi.get(p.slot) || {}, st = statDi.get(p.name) || {};
        return `<div class="prow">
          <span class="badge" data-r="${esc(p.role)}">${esc(p.role)}</span>
          <span class="who"><b>${esc(p.name)}</b><span>${esc([p.club, c.costo != null ? n1(c.costo) + ' cr' : null].filter(Boolean).join(' · ') || 'squadra da assegnare')}</span></span>
          <span class="val"><b>${st.fantamedia != null ? n1(st.fantamedia) : '—'}</b><span>${st.presenze ? st.presenze + ' pres · ' + n1(st.media) : 'mai schierato'}</span></span>
        </div>`;
      }).join('')}</div>`;
    }).join('');

    return `<div class="stack">
      <div class="chips" id="roseChips">${S.teams.map(x => `<button type="button" class="chip" data-squadra="${x.id}" aria-pressed="${x.id === scelta}">${esc(bel(x.name))}</button>`).join('')}</div>
      <div class="card">
        <div class="sec-h"><h2>${esc(t ? bel(t.name) : '')}</h2><span>${miei.length} giocatori</span></div>
        <div class="tiles">
          ${tile(sea.crediti != null ? sea.crediti : '—', 'crediti residui')}
          ${tile(n1(spesa), 'spesi in rosa')}
          ${tile(sea.gol_totali != null ? sea.gol_totali : '—', 'gol reali')}
          ${tile(sea.gol_sfruttati != null ? sea.gol_sfruttati : '—', 'gol sfruttati')}
        </div>
        ${gruppi || '<p class="empty">Rosa non ancora caricata.</p>'}
        <p class="small muted" style="margin:0">Fantamedia e presenze sono calcolate sulle giornate caricate.</p>
      </div>
    </div>`;
  }

  // -------------------------------------------------------------- statistiche
  async function sezioneStatistiche() {
    const u = ultima();
    if (!u) return '<div class="card"><p class="empty">Ancora nessuna giornata caricata.</p></div>';
    const [ps, sc, rt] = await Promise.all([statGiocatori(), marcatori(), tabellini(u.id)]);
    const maxPres = Math.max.apply(null, [1].concat(ps.map(p => nz(p.presenze))));
    const conPres = ps.filter(p => nz(p.presenze) >= Math.max(1, Math.ceil(maxPres / 2)));
    const perFanta = conPres.slice().sort((a, b) => nz(b.fantamedia) - nz(a.fantamedia)).slice(0, 10);
    const perVoto = conPres.slice().sort((a, b) => nz(b.media) - nz(a.media)).slice(0, 10);
    const bomber = sc.filter(x => nz(x.gol) > 0).slice(0, 15);
    const prestazioni = [].concat.apply([], rt.map(t => (t.formazione || []).filter(x => x.giocato)
      .map(x => ({ nome: x.nome, squadra: teamName(t.team_id), fantavoto: x.fantavoto, voto: x.voto }))))
      .sort((a, b) => nz(b.fantavoto) - nz(a.fantavoto)).slice(0, 8);
    const squadre = rt.slice().sort((a, b) => nz(b.punteggio) - nz(a.punteggio));

    const lista = (righe, mappa) => `<div class="plist">${righe.map((r, i) => {
      const m = mappa(r);
      return `<div class="prow"><span class="pos muted" style="text-align:right">${i + 1}</span>
        <span class="who"><b>${esc(m.titolo)}</b><span>${esc(m.sotto)}</span></span>
        <span class="val"><b>${esc(m.valore)}</b>${m.nota ? `<span>${esc(m.nota)}</span>` : ''}</span></div>`;
    }).join('')}</div>`;

    return `<div class="stack">
      <div class="card">
        <div class="sec-h"><h2>Cannonieri</h2><span>gol reali in stagione</span></div>
        ${bomber.length ? lista(bomber, r => ({ titolo: r.nome, sotto: teamName(r.team_id), valore: r.gol, nota: r.gol_sfruttati + ' sfruttati' }))
          : '<p class="empty">Nessun gol registrato.</p>'}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Migliori fantamedie</h3><span>almeno metà delle giornate</span></div>
        ${perFanta.length ? lista(perFanta, r => ({ titolo: r.nome, sotto: r.squadra + ' · ' + r.presenze + ' presenze', valore: n1(r.fantamedia), nota: 'voto ' + n1(r.media) }))
          : '<p class="empty">Servono più giornate.</p>'}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Migliori medie voto</h3><span>senza bonus</span></div>
        ${perVoto.length ? lista(perVoto, r => ({ titolo: r.nome, sotto: bel(r.squadra), valore: n1(r.media), nota: n1(r.fantamedia) + ' di fantamedia' }))
          : '<p class="empty">Servono pi\u00f9 giornate.</p>'}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Prestazioni della ${u.id}ª</h3><span>fantavoto più alto</span></div>
        ${prestazioni.length ? lista(prestazioni, r => ({ titolo: r.nome, sotto: r.squadra, valore: n1(r.fantavoto), nota: 'voto ' + n1(r.voto) }))
          : '<p class="empty">Nessun voto per questa giornata.</p>'}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Punteggi della ${u.id}ª</h3><span>Coppa di Lega</span></div>
        ${barre(squadre.map(t => ({ et: teamName(t.team_id), v: nz(t.punteggio), mio: isMe(t.team_id) })))}
      </div>
    </div>`;
  }

  // Barre orizzontali: una misura sola, etichette sempre scritte accanto al valore.
  function barre(righe) {
    if (!righe.length) return '<p class="empty">Niente da mostrare.</p>';
    const max = Math.max.apply(null, righe.map(r => r.v)) || 1;
    return `<div class="plist">${righe.map(r => `<div class="prow" style="grid-template-columns:1fr 54px">
      <span class="who"><b>${esc(r.et)}</b>
        <span style="display:block;height:8px;border-radius:4px;margin-top:5px;background:${r.mio ? 'var(--chart-accent)' : 'var(--chart-mute)'};width:${Math.max(3, Math.round(r.v / max * 100))}%"></span></span>
      <span class="val"><b>${n1(r.v)}</b></span></div>`).join('')}</div>`;
  }

  // -------------------------------------------------------------------- coppe
  async function sezioneCoppe() {
    const u = ultima();
    if (!u) return '<div class="card"><p class="empty">Ancora nessuna giornata caricata.</p></div>';
    const q = (await classifiche('coppa')).filter(r => r.round === u.id);
    const cdl = (await classifiche('coppa_lega')).filter(r => r.round === u.id);
    return `<div class="stack">
      <div class="card">
        <div class="sec-h"><h2>Coppa</h2><span>quarti alla 23ª di Serie A</span></div>
        ${tabellaSemplice(q, [{ et: 'Punti', val: r => n1(r.valore) }])}
        <div class="sec-h" style="margin-top:6px"><h3>Accoppiamenti</h3><span>gara unica in casa del meglio piazzato</span></div>
        ${accoppiamenti(q)}
        <p class="small muted" style="margin:0">Semifinali A–B e C–D, poi la finale. In campo neutro o andata e ritorno, a seconda di quante giornate liberano i playoff.</p>
      </div>
      <div class="card">
        <div class="sec-h"><h2>Coppa di Lega</h2><span>somma dei punteggi di giornata</span></div>
        ${tabellaSemplice(cdl, [
          { et: 'Totale', val: r => n1((r.dati || {}).totale) },
          { et: 'Media', val: r => n1((r.dati || {}).media) },
          { et: 'Punti', val: r => n1(r.valore) }
        ])}
        <p class="small muted" style="margin:0">Senza fattore campo e senza il bonus del modulo avversario: conta solo quanto ha fatto la tua formazione.</p>
      </div>
      <div class="card">
        <div class="sec-h"><h3>Supercoppa</h3><span>38ª di Serie A</span></div>
        <p class="small muted" style="margin:0">Finale fra il vincente del Campionato e il vincente della Coppa di Lega. Se i playoff liberano tre giornate si gioca anche la semifinale fra vincente della Coppa e vincente della Coppa di Lega.</p>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------ playoff
  async function sezionePlayoff() {
    const u = ultima();
    const camp = u ? (await classifiche('campionato')).filter(r => r.round === u.id) : [];
    const p = i => camp[i - 1] ? teamName(camp[i - 1].team_id) : i + 'º classificato';
    const turno = (titolo, coppie, nota) => `<div class="card">
      <div class="sec-h"><h3>${esc(titolo)}</h3><span>${esc(nota)}</span></div>
      <div>${coppie.map(([a, b]) => `<div class="match"><span class="t">${esc(p(a))}</span><span class="score">vs</span><span class="t a">${esc(p(b))}</span></div>`).join('')}</div>
    </div>`;
    return `<div class="stack">
      <div class="card">
        <div class="sec-h"><h2>Playoff</h2><span>dalla 24ª di Serie A</span></div>
        <p class="small muted" style="margin:0">Quattro turni a eliminazione diretta, tabellone generato dalla classifica finale delle 20 giornate.
        Andata, ritorno ed eventuale bella: chi è meglio piazzato parte con due gol di vantaggio all’andata.</p>
      </div>
      ${turno('Primo turno', [[4, 1], [3, 2], [8, 5], [7, 6]], 'andata in casa del peggio piazzato')}
      <div class="card">
        <div class="sec-h"><h3>Turni successivi</h3><span>secondo turno, semifinali, finali</span></div>
        <p class="small muted" style="margin:0">Il tabellone si ricostruisce a ogni turno in base ai punti: i vincenti si affrontano fra loro, i perdenti scendono nel tabellone secondario.
        Le giornate 26, 29, 32 e 35 ospitano le belle, oppure i turni di Coppa se le belle non servono.</p>
      </div>
      ${camp.length ? `<div class="card"><div class="sec-h"><h3>Classifica attuale</h3><span>dopo la ${u.id}ª</span></div>${tabellaCampionato(camp, true)}</div>` : ''}
    </div>`;
  }

  // ------------------------------------------------------------------- albo
  async function sezioneAlbo() {
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
  function sezionePremi() {
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
        notice(e && e.message ? e.message : 'Caricamento non riuscito.', 'error');
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

  // ------------------------------------------------------------------ sezioni
  const SEZIONI = [
    { id: '', et: 'Home', vista: home },
    { id: 'rose', et: 'Rose', vista: sezioneRose },
    { id: 'calendario', et: 'Calendario', vista: sezioneCalendario },
    { id: 'classifiche', et: 'Classifiche', vista: sezioneClassifiche },
    { id: 'statistiche', et: 'Statistiche', vista: sezioneStatistiche },
    { id: 'coppe', et: 'Coppe', vista: sezioneCoppe },
    { id: 'playoff', et: 'Playoff', vista: sezionePlayoff },
    { id: 'albo', et: 'Albo d’oro', vista: sezioneAlbo },
    { id: 'premi', et: 'Premi', vista: sezionePremi }
  ];

  function navHtml() {
    return SEZIONI.map(s => `<a href="#/${s.id}" ${s.id === S.sezione ? 'aria-current="page"' : ''}>${esc(s.et)}</a>`).join('') +
      '<a href="schiera/">Schiera ↗</a>';
  }

  async function render() {
    const sez = SEZIONI.find(s => s.id === S.sezione) || SEZIONI[0];
    $('#nav').innerHTML = navHtml();
    $('#view').innerHTML = '<div class="card"><p class="empty"><span class="spin"></span></p></div>';
    try {
      $('#view').innerHTML = await sez.vista();
    } catch (e) {
      console.error(e);
      $('#view').innerHTML = '<div class="card"><p class="empty">' + esc(e && e.message ? e.message : 'Qualcosa non ha funzionato.') + '</p></div>';
    }
    collegaGrafici();
    const u = ultima();
    $('#foot').textContent = u ? 'Dati della giornata ' + u.id + (u.caricata_at ? ' · caricati il ' + new Date(u.caricata_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : '') : '';
  }

  // tocco e passaggio del dito sul grafico
  function collegaGrafici() {
    document.querySelectorAll('.chart-wrap').forEach(w => {
      const punti = (w.dataset.punti || '').split(',').filter(Boolean).map(s => s.split(':').map(Number));
      if (!punti.length) return;
      const tip = w.querySelector('.tip');
      const muovi = ev => {
        const r = w.getBoundingClientRect();
        const x = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width;
        const i = Math.max(0, Math.min(punti.length - 1, Math.round(x * (punti.length - 1))));
        tip.hidden = false;
        tip.style.opacity = '1';
        tip.style.left = (24 / 360 * r.width + (r.width - (24 + 52) / 360 * r.width) * (punti.length === 1 ? .5 : i / (punti.length - 1))) + 'px';
        tip.style.top = (r.height * .55) + 'px';
        tip.innerHTML = 'Giornata ' + punti[i][0] + ' · <b>' + punti[i][1] + '</b> punti';
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
    $('#loginCard').hidden = false;
    $('#nav').hidden = true;
    $('#userBtn').hidden = true;
    $('#view').innerHTML = '';
    $('#foot').textContent = '';
    if (msg) notice(msg);
  }

  async function entra() {
    await caricaBase();
    $('#loginCard').hidden = true;
    $('#nav').hidden = false;
    $('#userBtn').hidden = false;
    $('#userBtn').textContent = S.team ? bel(S.team.name) : 'Account';
    $('#userHead').innerHTML = `<b>${esc(S.profile.display_name || '')}</b><span>${esc(S.team ? bel(S.team.name) : 'senza squadra')}${isAdmin() ? ' · amministratore' : ''}</span>`;
    $('#adminBtn').hidden = !isAdmin();
    $('#sub').textContent = 'stagione 2026/27';
    clearNotices();
    await render();
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
    const g = ev.target.closest('[data-gio]');
    if (g && g.dataset.gio) { S.giornataScelta = +g.dataset.gio; render(); return; }
    const sq = ev.target.closest('[data-squadra]');
    if (sq) { S.squadraScelta = sq.dataset.squadra; render(); return; }
    const cl = ev.target.closest('[data-class]');
    if (cl) { const p = prefs(); p.classifica = cl.dataset.class; setPrefs(p); render(); return; }
    const se = ev.target.closest('[data-serie]');
    if (se) { const p = prefs(); p.graficoSquadra = se.dataset.serie; setPrefs(p); render(); return; }
  });

  window.addEventListener('hashchange', () => {
    S.sezione = (location.hash || '').replace(/^#\/?/, '');
    if (S.pronta) render();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSheet(); apriMenu(false); } });

  // --------------------------------------------------------------------- avvio
  (async function start() {
    const p = prefs();
    if (p.tema) document.documentElement.setAttribute('data-theme', p.tema);
    S.sezione = (location.hash || '').replace(/^#\/?/, '');
    if (!window.SB || !SB.configured()) {
      $('#loginCard').hidden = true;
      $('#view').innerHTML = '<div class="card"><h2>Sito non collegato</h2><p class="muted">Manca la configurazione del database della lega.</p></div>';
      return;
    }
    const hash = SB.adoptFromHash ? SB.adoptFromHash() : null;
    try {
      if (hash && hash.type === 'recovery') { mostraLogin('Apri Schiera Formazione per impostare la nuova password.'); return; }
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
