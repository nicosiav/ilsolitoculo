(function () {
  'use strict';
  const X = window.XlsFormazione;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const MODULES = ['3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-3-2', '5-4-1'];
  const BENCH_ROLES = ['P', 'D', 'D', 'C', 'C', 'A', 'A'];
  const ROLE = { P: 'Portiere', D: 'Difensore', C: 'Centrocampista', A: 'Attaccante' };
  const ROLES_PL = { P: 'Portieri', D: 'Difensori', C: 'Centrocampisti', A: 'Attaccanti' };
  const LS_KEY = 'schiera-formazione:v1';

  const S = {
    mode: 'file',            // 'online' (database) oppure 'file' (.xls scelto a mano)
    bytes: null, fileName: '', wb: null, sheet: null, roster: [],
    module: '3-4-3', free: false,
    starters: Array(11).fill(null), bench: Array(7).fill(null), extra: Array(4).fill(null),
    profile: null, team: null, matchday: null, closed: false, savedAt: null,
    fixtures: [],            // partite della giornata: da qui i blocchi partita per partita
    rounds: []               // giornate della lega: servono a scrivere "Giornata 4 (6ª di Serie A)"
  };
  const online = () => S.mode === 'online';
  const loaded = () => online() ? !!S.team : !!S.wb;
  const canEdit = () => loaded() && !(online() && S.closed);
  const isAdmin = () => !!(S.profile && S.profile.role === 'admin');
  const SBok = () => !!(window.SB && window.SB.configured());

  // ------------------------------------------------------------ storage
  function prefs() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; } }
  function setPrefs(p) { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch (e) { /* non disponibile */ } }

  // ------------------------------------------------------------ download (visualizzatore claude.ai)
  const inViewer = !!(window.claude && typeof window.claude.use === 'function');
  const dlP = inViewer ? Promise.resolve(window.claude.use('downloads')).catch(() => null) : Promise.resolve(null);

  // ------------------------------------------------------------ modello
  const counts = mod => { const [d, c, a] = mod.split('-').map(Number); return { D: d, C: c, A: a }; };
  const starterRoles = () => { const k = counts(S.module); return ['P', ...Array(k.D).fill('D'), ...Array(k.C).fill('C'), ...Array(k.A).fill('A')]; };
  const benchRole = i => S.free ? null : BENCH_ROLES[i];
  const slotRole = (z, i) => z === 's' ? starterRoles()[i] : z === 'b' ? benchRole(i) : null;
  const slotNum = (z, i) => z === 's' ? i + 1 : z === 'b' ? 12 + i : 19 + i;
  const arr = z => z === 's' ? S.starters : z === 'b' ? S.bench : S.extra;
  const P = row => S.roster[row];
  const placeOf = row => { for (const z of ['s', 'b', 'e']) { const i = arr(z).indexOf(row); if (i >= 0) return { z, i }; } return null; };
  const fits = (z, i, row) => row == null || !slotRole(z, i) || P(row).role === slotRole(z, i);
  const zoneName = z => z === 's' ? 'Titolare' : z === 'b' ? 'Riserva' : 'Panchina extra';

  // -------------------------------------------- blocco partita per partita
  // Ogni giocatore si blocca quando la sua squadra di Serie A scende in campo.
  // Chi non ha una squadra nota si blocca alla prima partita della giornata.
  // È il database ad applicare la regola: qui serve solo a non far fare buchi nell'acqua.
  const ms = d => +new Date(d);
  function firstKickoff() {
    return S.fixtures.length ? Math.min.apply(null, S.fixtures.map(f => ms(f.kickoff))) : null;
  }
  function clubKickoff(club) {
    const k = S.fixtures.filter(f => f.home === club || f.away === club).map(f => ms(f.kickoff));
    return k.length ? Math.min.apply(null, k) : null;
  }
  function lockAt(row) {
    if (!online() || !S.fixtures.length) return null;
    const p = P(row);
    if (!p || !p.id) return null;
    // squadra ignota: prudenza, si blocca con la prima partita della giornata.
    // squadra che questa giornata riposa: nessun blocco.
    return p.club ? clubKickoff(p.club) : firstKickoff();
  }
  const isLocked = row => { const t = lockAt(row); return t != null && t <= Date.now(); };
  const lockedRows = () => S.roster.filter(p => p.name && isLocked(p.row)).map(p => p.row);
  function nextLock() {
    const t = S.roster.filter(p => p.name).map(p => lockAt(p.row)).filter(x => x != null && x > Date.now());
    return t.length ? Math.min.apply(null, t) : null;
  }

  // Dove si trova ogni giocatore bloccato: deve restare lì (anche fuori formazione)
  function lockMap() {
    const m = new Map();
    if (!online()) return m;
    S.roster.forEach(p => {
      if (!p.name || !isLocked(p.row)) return;
      const pl = placeOf(p.row);
      m.set(p.row, pl ? pl.z + pl.i : '-');
    });
    return m;
  }
  const snapshot = () => ({ s: S.starters.slice(), b: S.bench.slice(), e: S.extra.slice(), module: S.module, free: S.free });
  function restoreSnap(x) {
    S.starters = x.s; S.bench = x.b; S.extra = x.e; S.module = x.module; S.free = x.free;
    $('#freeToggle').checked = S.free;
  }
  // Esegue la modifica e la annulla se ha spostato qualcuno già sceso in campo
  function guarded(fn) {
    if (!online() || !S.fixtures.length) { fn(); return true; }
    const before = lockMap(), snap = snapshot();
    fn();
    const after = lockMap();
    const bad = [];
    before.forEach((v, r) => { if (after.get(r) !== v) bad.push(P(r).name); });
    if (bad.length) {
      restoreSnap(snap);
      toast(bad.join(', ') + ': partita già iniziata, non si può spostare');
      return false;
    }
    return true;
  }

  function assign(z, i, row) {
    const a = arr(z), cur = a[i];
    if (cur === row) return;
    const prev = placeOf(row);
    a[i] = row;
    if (prev) arr(prev.z)[prev.i] = (cur != null && fits(prev.z, prev.i, cur)) ? cur : null;
  }

  function autoPlace(row) {
    const role = P(row).role, roles = starterRoles();
    for (let i = 0; i < 11; i++) if (S.starters[i] == null && roles[i] === role) { S.starters[i] = row; return { z: 's', i }; }
    for (let i = 0; i < 7; i++) if (S.bench[i] == null && (!benchRole(i) || benchRole(i) === role)) { S.bench[i] = row; return { z: 'b', i }; }
    for (let i = 0; i < 4; i++) if (S.extra[i] == null) { S.extra[i] = row; return { z: 'e', i }; }
    return null;
  }
  function placeSecondary(row) {
    const role = P(row).role;
    for (let i = 0; i < 7; i++) if (S.bench[i] == null && (!benchRole(i) || benchRole(i) === role)) { S.bench[i] = row; return true; }
    for (let i = 0; i < 4; i++) if (S.extra[i] == null) { S.extra[i] = row; return true; }
    return false;
  }

  function setModule(mod) {
    if (mod === S.module) return;
    const oldRoles = starterRoles(), old = S.starters.slice();
    S.module = mod;
    const roles = starterRoles();
    const pools = { P: [], D: [], C: [], A: [] };
    old.forEach((r, i) => { if (r != null) pools[oldRoles[i]].push(r); });
    S.starters = roles.map(ro => pools[ro].length ? pools[ro].shift() : null);
    const left = [].concat(pools.P, pools.D, pools.C, pools.A);
    const moved = [], out = [];
    left.forEach(r => (placeSecondary(r) ? moved : out).push(P(r).name));
    if (moved.length) toast(moved.join(', ') + ' in panchina');
    else if (out.length) toast(out.join(', ') + ' tolto dai titolari');
  }

  function setFree(free) {
    if (free === S.free) return;
    S.free = free;
    if (!free) {
      const list = S.bench.filter(r => r != null);
      S.bench = Array(7).fill(null);
      const out = [];
      list.forEach(r => {
        const i = BENCH_ROLES.findIndex((ro, k) => ro === P(r).role && S.bench[k] == null);
        if (i >= 0) S.bench[i] = r;
        else {
          const e = S.extra.indexOf(null);
          if (e >= 0) S.extra[e] = r; else out.push(P(r).name);
        }
      });
      if (out.length) toast(out.join(', ') + ' tolto dalle riserve');
    }
    const p = prefs(); p.free = free; setPrefs(p);
  }

  function numbers() {
    const n = Array(31).fill(null);
    S.starters.forEach((r, i) => { if (r != null) n[r] = i + 1; });
    S.bench.forEach((r, i) => { if (r != null) n[r] = 12 + i; });
    S.extra.forEach((r, i) => { if (r != null) n[r] = 19 + i; });
    return n;
  }

  // posizioni {numero -> riga} -> schieramento
  function applyPositions(pos) {
    const st = [];
    for (let k = 1; k <= 11; k++) st.push(pos.has(k) ? pos.get(k) : null);
    const c = { D: 0, C: 0, A: 0 };
    st.slice(1).forEach(r => { if (r != null && c[P(r).role] !== undefined) c[P(r).role]++; });
    const exact = c.D + '-' + c.C + '-' + c.A;
    let mod = MODULES.includes(exact) ? exact : MODULES.find(m => { const k = counts(m); return k.D >= c.D && k.C >= c.C && k.A >= c.A; }) || S.module;
    S.module = mod;
    S.starters = Array(11).fill(null); S.bench = Array(7).fill(null); S.extra = Array(4).fill(null);
    const roles = starterRoles();
    const left = [];
    st.forEach(r => {
      if (r == null) return;
      const i = roles.findIndex((ro, k) => ro === P(r).role && S.starters[k] == null);
      if (i >= 0) S.starters[i] = r; else left.push(r);
    });
    const bn = [];
    for (let k = 12; k <= 18; k++) bn.push(pos.has(k) ? pos.get(k) : null);
    if (!S.free && !bn.every((r, i) => r == null || P(r).role === BENCH_ROLES[i])) S.free = true;
    S.bench = bn;
    for (let k = 19; k <= 22; k++) S.extra[k - 19] = pos.has(k) ? pos.get(k) : null;
    left.forEach(r => placeSecondary(r));
  }

  // ------------------------------------------------------------ file
  async function handleFile(file) {
    if (!file) return;
    clearNotices();
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const wb = X.load(buf);
      if (!wb.sheetNames.length) throw new X.XlsError('Nel file non trovo fogli formazione (colonna A numerata 1–31, ruoli in colonna B, nomi in C).');
      S.bytes = buf; S.wb = wb; S.fileName = file.name || 'Formazioni.xls';
      if (!/\.xls$/i.test(S.fileName)) S.fileName = S.fileName.replace(/\.[^.]*$/, '') + '.xls';
      const p = prefs();
      const sel = $('#sheetSel');
      sel.innerHTML = wb.sheetNames.map(n => `<option>${esc(n)}</option>`).join('');
      const pick = wb.sheetNames.includes(p.lastSheet) ? p.lastSheet : (wb.sheetNames.length === 1 ? wb.sheetNames[0] : null);
      if (pick) sel.value = pick;
      $('#fileName').textContent = S.fileName;
      $('#fileMeta').textContent = wb.sheetNames.length + ' squadre nel file';
      $('#uploadCard').hidden = true;
      $('#fileBar').hidden = false;
      $('#menuWrap').hidden = false;
      if (pick) loadSheet(pick); else chooseTeam(wb.sheetNames);
    } catch (e) {
      console.error(e);
      notice(e instanceof X.XlsError ? e.message : 'Non riesco a leggere il file: ' + (e && e.message || e), 'error');
    }
    $('#fileInput').value = '';
  }

  // Primo utilizzo su questo telefono: chiedi quale squadra schierare (poi resta memorizzata)
  function chooseTeam(names) {
    const el = sheet(`
      <div class="sheet-h"><div><h4>Qual è la tua squadra?</h4><p>Te lo chiedo solo la prima volta: puoi cambiarla dal menu “Squadra”.</p></div></div>
      <div class="sheet-b">${names.map(n => `<button type="button" class="row" data-team="${esc(n)}"><span class="badge any">·</span><span class="who">${esc(n)}</span><span class="chev">›</span></button>`).join('')}</div>`, { modal: true });
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-team]');
      if (!b) return;
      const n = b.dataset.team;
      closeSheet();
      $('#sheetSel').value = n;
      const p = prefs(); p.lastSheet = n; setPrefs(p);
      loadSheet(n);
    });
  }

  function loadSheet(name) {
    S.sheet = name;
    S.roster = S.wb.roster(name);
    const p = prefs();
    S.free = !!p.free;
    $('#freeToggle').checked = S.free;
    S.starters = Array(11).fill(null); S.bench = Array(7).fill(null); S.extra = Array(4).fill(null);
    clearNotices();
    const pos = new Map();
    S.roster.forEach(pl => { if (pl.number != null && pl.name && Number.isInteger(pl.number) && pl.number >= 1 && pl.number <= 22 && !pos.has(pl.number)) pos.set(pl.number, pl.row); });
    const saved = p.sheets && p.sheets[name];
    if (pos.size) {
      applyPositions(pos);
      notice('Ho caricato la formazione già scritta nel file (' + pos.size + ' giocatori).');
    } else {
      if (saved && saved.module) S.module = saved.module;
      if (saved && saved.names) {
        const when = new Date(saved.at || Date.now()).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
        notice('Vuoi ripartire dalla formazione salvata il ' + when + '?', '', 'Ripristina', restoreSaved);
      }
    }
    $('#restoreBtn').hidden = !(saved && saved.names);
    render();
  }

  function restoreSaved() {
    const saved = (prefs().sheets || {})[S.sheet];
    if (!saved || !saved.names) return;
    const byName = new Map(S.roster.filter(p => p.name).map(p => [p.name + '|' + p.role, p.row]));
    const pos = new Map(); const missing = [];
    Object.entries(saved.names).forEach(([num, key]) => {
      if (byName.has(key)) pos.set(+num, byName.get(key)); else missing.push(key.split('|')[0]);
    });
    if (saved.module) S.module = saved.module;
    if (typeof saved.free === 'boolean') { S.free = saved.free; $('#freeToggle').checked = S.free; }
    applyPositions(pos);
    clearNotices();
    if (missing.length) notice('Non più in rosa: ' + missing.join(', ') + '. Sostituiscili prima di salvare.');
    else toast('Formazione ripristinata');
    render();
  }

  // ------------------------------------------------------------ render
  function render() {
    const ready = loaded();
    const locked = online() && S.closed;
    // moduli
    $('#modules').innerHTML = MODULES.map(m => `<button type="button" class="chip" data-mod="${m}" aria-pressed="${m === S.module}" ${ready && !locked ? '' : 'disabled'}>${m}</button>`).join('');
    // campo
    const roles = starterRoles();
    const lines = ['A', 'C', 'D', 'P'].map(ro => {
      const idx = roles.map((r, i) => r === ro ? i : -1).filter(i => i >= 0);
      return `<div class="line">${idx.map(i => slotHtml(i, ro)).join('')}</div>`;
    }).join('');
    $('#pitch').innerHTML = '<div class="goal-top"></div>' + lines;
    // riserve
    $('#bench').innerHTML = S.bench.map((r, i) => rowHtml('b', i, r)).join('');
    $('#extra').innerHTML = S.extra.map((r, i) => rowHtml('e', i, r)).join('');
    $('#benchHint').textContent = S.free ? "12–18 · entrano in quest'ordine" : "12–18 · P, D, D, C, C, A, A";
    // non schierati
    const free = S.roster.filter(p => p.name && !placeOf(p.row));
    $('#poolWrap').hidden = !ready || !free.length;
    $('#pool').innerHTML = ['P', 'D', 'C', 'A'].map(ro => {
      const l = free.filter(p => p.role === ro);
      if (!l.length) return '';
      return `<div class="pool-group">${l.map(p => {
        const lk = isLocked(p.row);
        return `<button type="button" class="pchip${lk ? ' locked' : ''}" data-add="${p.row}" data-r="${p.role}" ${lk ? 'disabled title="Partita già iniziata"' : ''}><span class="badge">${p.role}</span>${esc(p.name)}${lk ? '<span class="lk" aria-label="bloccato">●</span>' : ''}</button>`;
      }).join('')}</div>`;
    }).join('');
    // barra
    const n = S.starters.filter(x => x != null).length + S.bench.filter(x => x != null).length + S.extra.filter(x => x != null).length;
    const st = S.starters.filter(x => x != null).length;
    $('#count').textContent = n + '/22';
    $('#countLbl').textContent = st === 11 ? 'schierati' : 'titolari ' + st + '/11';
    $('#saveBtn').disabled = !ready || n === 0 || locked;
    $('#saveBtn').textContent = online() ? 'Salva formazione' : 'Salva file Excel';
    $('#editor').style.opacity = ready ? '' : '.55';
    $('#sub').textContent = ready ? (S.sheet || '') + ' · ' + S.module : 'formazione dal file .xls della lega';
    if (online()) renderOnlineBar();
    document.querySelectorAll('#editor button').forEach(b => { if (locked) b.disabled = true; });
  }

  // ---------------------------------------------------------- modalità online
  function fmtDate(d) {
    return new Date(d).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function timeLeft(deadline) {
    const ms = new Date(deadline) - new Date();
    if (ms <= 0) return null;
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60;
    if (h >= 24) return Math.floor(h / 24) + ' giorni';
    return h ? h + ' ore e ' + m + ' min' : m + ' min';
  }
  // Le giornate hanno due numeri: quello della lega e quello di Serie A.
  // La 1ª di lega è la 3ª di Serie A (regolamento, punto 5.1).
  function legaDi(serieA) {
    const r = S.rounds.find(x => x.serie_a === serieA);
    if (r) return r.id;
    return serieA >= 3 && serieA <= 22 ? serieA - 2 : null;
  }
  function nomeGiornata(md) {
    if (!md) return '';
    const lega = legaDi(md.id);
    return lega == null ? (md.label || 'Giornata ' + md.id)
      : 'Giornata ' + lega + ' (' + md.id + '\u00aa di Serie A)';
  }

  function fmtHour(d) {
    return new Date(d).toLocaleString('it-IT', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  // La giornata resta aperta fino alla fine dell'ultima partita
  const closeTime = md => (md && (md.closes_at || md.deadline)) || null;

  function renderOnlineBar() {
    const md = S.matchday;
    const el = $('#fileMeta');
    $('#fileName').textContent = (S.team ? S.team.name : '') + (md ? ' · ' + nomeGiornata(md) : '');
    $('#teamField').hidden = true;
    if (!md) { el.textContent = 'nessuna giornata aperta'; el.style.color = 'var(--role-a)'; return; }
    const resta = timeLeft(closeTime(md));
    if (!resta) { el.textContent = 'giornata finita il ' + fmtDate(closeTime(md)); el.style.color = 'var(--role-a)'; return; }
    if (!S.fixtures.length) {
      el.textContent = 'si chiude ' + fmtDate(closeTime(md)) + ' · mancano ' + resta;
      el.style.color = '';
      return;
    }
    const nx = nextLock(), n = lockedRows().length;
    el.textContent = nx
      ? 'prossimo blocco ' + fmtHour(nx) + ' · fra ' + timeLeft(nx) + (n ? ' · ' + n + ' bloccati' : '')
      : 'tutti in campo · si chiude ' + fmtHour(closeTime(md));
    el.style.color = !nx || nx - Date.now() < 3600000 ? 'var(--role-a)' : '';
  }

  // Ricontrolla i blocchi ogni mezzo minuto: scattano da soli al calcio d'inizio
  let tick;
  function startTicker() {
    clearInterval(tick);
    if (!online()) return;
    let prima = lockedRows().join(',');
    tick = setInterval(() => {
      if (!online()) { clearInterval(tick); return; }
      const ora = lockedRows().join(',');
      const finita = S.matchday && !timeLeft(closeTime(S.matchday));
      if (ora !== prima || (finita && !S.closed)) {
        prima = ora;
        if (finita) S.closed = true;
        render();
      } else if (!S.closed) renderOnlineBar();
    }, 30000);
  }

  function rosterFromDb(players) {
    const out = [];
    for (let i = 0; i < 31; i++) out.push({ row: i, id: null, role: '', name: '', club: '', number: null });
    players.forEach(p => {
      const i = p.slot - 1;
      if (i >= 0 && i < 31) out[i] = { row: i, id: p.id, role: String(p.role || '').toUpperCase(), name: p.name || '', club: p.club || '', number: null };
    });
    return out;
  }

  async function startOnline() {
    clearNotices();
    const uid = (SB.user() || {}).id || ((await SB.me()) || {}).id;
    const prof = (await SB.select('profiles', 'select=display_name,role,team_id,teams(name,sheet_name)&id=eq.' + uid))[0];
    if (!prof) throw new SB.SbError('Profilo non trovato: scrivi all\u2019amministratore.', 'no_profile');
    S.profile = prof;
    S.team = prof.teams ? Object.assign({ id: prof.team_id }, prof.teams) : null;
    if (!S.team) throw new SB.SbError('Questo account non è ancora collegato a una squadra: scrivi all\u2019amministratore.', 'no_team');
    S.sheet = S.team.sheet_name || S.team.name;
    S.mode = 'online';
    const mds = await SB.select('matchdays', 'select=id,label,deadline,first_kickoff,last_kickoff,closes_at&is_current=is.true&limit=1');
    S.matchday = mds[0] || null;
    S.closed = !!(S.matchday && new Date(closeTime(S.matchday)) <= new Date());
    S.fixtures = S.matchday
      ? await SB.select('fixtures', 'select=id,home,away,kickoff,status&matchday=eq.' + S.matchday.id + '&order=kickoff')
      : [];
    // se il database della stagione c'è, da lì arriva la numerazione della lega
    try { S.rounds = await SB.select('rounds', 'select=id,serie_a&order=id'); } catch (e) { S.rounds = []; }
    const players = await SB.select('players', 'select=id,slot,role,name,club&team_id=eq.' + S.team.id + '&order=slot');
    S.roster = rosterFromDb(players);
    S.starters = Array(11).fill(null); S.bench = Array(7).fill(null); S.extra = Array(4).fill(null);
    S.savedAt = null;
    if (S.matchday) {
      const l = (await SB.select('lineups', 'select=id,module,bench_free,updated_at,lineup_slots(pos,player_id)&team_id=eq.' + S.team.id + '&matchday=eq.' + S.matchday.id))[0];
      if (l) {
        const byId = new Map(S.roster.filter(p => p.id).map(p => [p.id, p.row]));
        const pos = new Map();
        (l.lineup_slots || []).forEach(sl => { if (byId.has(sl.player_id)) pos.set(sl.pos, byId.get(sl.player_id)); });
        if (l.module) S.module = l.module;
        S.free = !!l.bench_free;
        applyPositions(pos);
        S.savedAt = l.updated_at;
      }
    }
    $('#loginCard').hidden = true;
    $('#uploadCard').hidden = true;
    $('#fileBar').hidden = false;
    $('#menuWrap').hidden = false;
    $('#onlineMenu').hidden = false;
    $('#adminMenu').hidden = !isAdmin();
    $('#restoreBtn').hidden = false;
    $('#freeToggle').checked = S.free;
    if (!S.matchday) notice('Nessuna giornata aperta: l\u2019amministratore deve aggiornare il calendario.');
    else if (S.closed) notice('Giornata finita il ' + fmtDate(closeTime(S.matchday)) + ': la formazione non si può più cambiare.');
    else {
      if (S.savedAt) notice('Formazione salvata il ' + fmtDate(S.savedAt) + '. Puoi cambiarla finché la tua squadra non scende in campo.');
      const bloccati = lockedRows().filter(r => placeOf(r));
      if (bloccati.length) notice(bloccati.length === 1
        ? P(bloccati[0]).name + ' è già sceso in campo: resta dov\u2019è.'
        : bloccati.length + ' giocatori sono già scesi in campo: restano dove sono.');
      const senza = S.roster.filter(p => p.name && !p.club).length;
      if (senza && S.fixtures.length && isAdmin())
        notice(senza + ' giocatori senza squadra di Serie A: si bloccano tutti alla prima partita della giornata.', '', 'Sistema', clubsSheet);
    }
    startTicker();
    render();
  }

  async function saveOnline() {
    const slots = [];
    S.starters.forEach((r, i) => { if (r != null && P(r).id) slots.push({ pos: i + 1, player_id: P(r).id }); });
    S.bench.forEach((r, i) => { if (r != null && P(r).id) slots.push({ pos: 12 + i, player_id: P(r).id }); });
    S.extra.forEach((r, i) => { if (r != null && P(r).id) slots.push({ pos: 19 + i, player_id: P(r).id }); });
    return SB.rpc('save_lineup', {
      p_matchday: S.matchday.id, p_module: S.module, p_bench_free: S.free, p_slots: slots
    });
  }

  function changesText(ch) {
    if (!ch) return [];
    const out = [];
    (ch.entrati || []).forEach(x => out.push('↑ ' + x.nome + ' (posto ' + x.pos + ')'));
    (ch.usciti || []).forEach(x => out.push('↓ ' + x.nome));
    (ch.spostati || []).forEach(x => out.push('⇄ ' + x.nome + ': ' + x.da + ' → ' + x.a));
    if (ch.modulo) out.push('Modulo: ' + (ch.modulo.da || '—') + ' → ' + ch.modulo.a);
    return out;
  }

  function showSaved(res) {
    const list = changesText(res && res.changes);
    const snap = (res && res.snapshot) || [];
    const line = k => {
      const x = snap.find(v => v.pos === k);
      return `<div class="xr"><span class="n">${k}</span><span class="badge" data-r="${esc(x ? x.ruolo : '')}">${esc(x ? x.ruolo : '·')}</span><span>${esc(x ? x.nome : '—')}</span></div>`;
    };
    const el = sheet(`
      <div class="sheet-h"><div style="display:flex;gap:12px;align-items:center"><span class="done-mark" aria-hidden="true">✓</span>
        <div><h4>Formazione salvata</h4><p>${esc(S.team.name)} · ${esc(nomeGiornata(S.matchday))} · ${esc(S.module)}</p></div></div></div>
      <div class="sheet-b">
        <p style="margin:12px 16px 0">${res.action === 'creata' ? 'Registrata adesso.' : 'Ho aggiornato quella di prima.'} L\u2019amministratore la vede online: non devi inviare niente.</p>
        ${list.length ? `<div class="xl">${list.map(t => `<div class="xr" style="grid-template-columns:1fr">${esc(t)}</div>`).join('')}</div>` : ''}
        <div class="xl" aria-label="Formazione salvata">
          <div class="xh">Titolari</div>${[1,2,3,4,5,6,7,8,9,10,11].map(line).join('')}
          <div class="xh">Riserve</div>${[12,13,14,15,16,17,18].map(line).join('')}
          <div class="xh">Panchina extra</div>${[19,20,21,22].map(line).join('')}
        </div>
      </div>
      <div class="sheet-f"><button type="button" class="btn btn-ghost" data-act="export">Esporta .xls</button><button type="button" class="btn btn-primary" data-act="close">Fatto</button></div>`);
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') closeSheet();
      if (b.dataset.act === 'export') { closeSheet(); exportXls(); }
    });
  }

  // Export .xls: prende il modello della lega da Supabase e ci scrive la formazione
  async function exportXls() {
    try {
      toast('Preparo il file…');
      const tpl = await SB.download('modelli', 'formazioni.xls');
      const wb = X.load(tpl);
      if (!wb.sheetNames.includes(S.sheet)) throw new X.XlsError('Nel modello non c\u2019è il foglio "' + S.sheet + '".');
      const tplRoster = wb.roster(S.sheet);
      const diff = S.roster.filter(p => p.name && tplRoster[p.row] && tplRoster[p.row].name !== p.name);
      const nums = Array(31).fill(null);
      S.starters.forEach((r, i) => { if (r != null) nums[r] = i + 1; });
      S.bench.forEach((r, i) => { if (r != null) nums[r] = 12 + i; });
      S.extra.forEach((r, i) => { if (r != null) nums[r] = 19 + i; });
      const res = wb.build(S.sheet, nums);
      const d = await deliver(res.bytes, outName());
      if (diff.length) notice('Attenzione: nel modello ' + diff.length + ' giocatori hanno un nome diverso dalla rosa nel database. L\u2019amministratore dovrebbe aggiornare il modello.');
      SB.rpc('log_export', { p_matchday: S.matchday.id }).catch(() => {});
      showResult(res, d);
    } catch (e) {
      console.error(e);
      notice(e && e.message ? e.message : 'Export non riuscito.', 'error');
    }
  }

  async function showLog() {
    try {
      const rows = await SB.select('lineup_log', 'select=at,action,changes&team_id=eq.' + S.team.id + '&matchday=eq.' + S.matchday.id + '&order=at.desc&limit=30');
      const body = rows.length ? rows.map(r => {
        const list = changesText(r.changes);
        return `<div class="xr" style="grid-template-columns:1fr"><div><b>${esc(fmtDate(r.at))}</b> · ${esc(r.action)}<div class="muted small">${list.length ? esc(list.join(' · ')) : 'nessun dettaglio'}</div></div></div>`;
      }).join('') : '<p class="muted" style="padding:12px 16px">Ancora nessuna modifica per questa giornata.</p>';
      sheet(`<div class="sheet-h"><div><h4>Storico modifiche</h4><p>${esc(S.team.name)} · ${esc(nomeGiornata(S.matchday))}</p></div></div>
        <div class="sheet-b"><div class="xl">${body}</div></div>
        <div class="sheet-f"><button type="button" class="btn btn-primary" onclick="this.closest('.scrim').remove()">Chiudi</button></div>`);
    } catch (e) { notice(e.message || 'Non riesco a leggere lo storico.', 'error'); }
  }


  // Riprende l'ultima formazione salvata: se per questa giornata non c'e', va a
  // pescare la piu' recente fra le giornate precedenti.
  async function restoreOnline() {
    try {
      const md = S.matchday;
      const q = 'select=matchday,module,bench_free,updated_at,lineup_slots(pos,player_id,players(name,role))'
        + '&team_id=eq.' + S.team.id + (md ? '&matchday=lt.' + md.id : '') + '&order=matchday.desc&limit=1';
      const l = (await SB.select('lineups', q))[0];
      if (!l) { toast('Non ho formazioni precedenti da riprendere'); return; }
      const byId = new Map(S.roster.filter(p => p.id).map(p => [p.id, p.row]));
      const byName = new Map(S.roster.filter(p => p.name).map(p => [X.norm(p.name) + '|' + p.role, p.row]));
      const pos = new Map(), persi = [];
      (l.lineup_slots || []).slice().sort((a, b) => a.pos - b.pos).forEach(sl => {
        const pl = sl.players || {};
        const row = byId.has(sl.player_id) ? byId.get(sl.player_id)
          : byName.get(X.norm(pl.name || '') + '|' + String(pl.role || '').toUpperCase());
        if (row === undefined) persi.push(pl.name || '?'); else pos.set(sl.pos, row);
      });
      const ok = guarded(() => {
        if (l.module) S.module = l.module;
        S.free = !!l.bench_free;
        applyPositions(pos);
      });
      $('#freeToggle').checked = S.free;
      if (ok) {
        clearNotices();
        notice('Ripresa la formazione della giornata ' + l.matchday + ', salvata il ' + fmtDate(l.updated_at) + '.'
          + (persi.length ? ' Non più in rosa: ' + persi.join(', ') + '.' : ' Controllala e salvala.'));
      }
      render();
    } catch (e) { notice(e.message || 'Non riesco a riprendere la formazione.', 'error'); }
  }

  // ------------------------------------------- formazioni di tutta la lega
  async function showAll() {
    if (!S.matchday) { notice('Nessuna giornata da mostrare.'); return; }
    let mds = [];
    try { mds = await SB.select('matchdays', 'select=id,label&order=id.desc'); }
    catch (e) { mds = [{ id: S.matchday.id, label: S.matchday.label }]; }
    const opts = mds.map(m => `<option value="${m.id}" ${m.id === S.matchday.id ? 'selected' : ''}>${esc(nomeGiornata(m))}</option>`).join('');
    const el = sheet(`
      <div class="sheet-h"><div style="width:100%">
        <h4>Formazioni di giornata</h4>
        <p>Quelle di tutte le squadre della lega.</p>
        <select id="mdPick" style="margin-top:8px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2);color:inherit">${opts}</select>
      </div></div>
      <div class="sheet-b" id="allBody"><p class="muted" style="padding:12px 16px">Carico…</p></div>
      <div class="sheet-f"><button type="button" class="btn btn-primary" data-act="close">Chiudi</button></div>`);
    el.addEventListener('click', ev => { if (ev.target.closest('[data-act="close"]')) closeSheet(); });
    el.querySelector('#mdPick').addEventListener('change', ev => fill(+ev.target.value));
    fill(S.matchday.id);

    async function fill(md) {
      const body = el.querySelector('#allBody');
      body.innerHTML = '<p class="muted" style="padding:12px 16px">Carico…</p>';
      try {
        const [teams, rows] = await Promise.all([
          SB.select('teams', 'select=id,name&order=name'),
          SB.select('lineups', 'select=team_id,module,updated_at,lineup_slots(pos,players(name,role,club))&matchday=eq.' + md)
        ]);
        const byTeam = new Map(rows.map(r => [r.team_id, r]));
        body.innerHTML = teams.map(t => {
          const l = byTeam.get(t.id);
          const mia = S.team && t.id === S.team.id;
          if (!l) return `<div class="xr" style="grid-template-columns:1fr auto"><span>${esc(t.name)}${mia ? ' · tu' : ''}</span><span class="muted">non ancora schierata</span></div>`;
          const slots = (l.lineup_slots || []).slice().sort((a, b) => a.pos - b.pos);
          const line = k => {
            const x = slots.find(v => v.pos === k), p = x && x.players;
            return `<div class="xr"><span class="n">${k}</span><span class="badge" data-r="${esc(p ? p.role : '')}">${esc(p ? p.role : '·')}</span><span>${esc(p ? p.name : '—')}</span></div>`;
          };
          return `<details class="team-block"${mia ? ' open' : ''}>
            <summary><b>${esc(t.name)}</b>${mia ? ' · tu' : ''} <span class="muted small">${esc(l.module || '')} · ${esc(fmtDate(l.updated_at))}</span></summary>
            <div class="xl"><div class="xh">Titolari</div>${[1,2,3,4,5,6,7,8,9,10,11].map(line).join('')}
              <div class="xh">Riserve</div>${[12,13,14,15,16,17,18].map(line).join('')}
              <div class="xh">Panchina extra</div>${[19,20,21,22].map(line).join('')}</div></details>`;
        }).join('');
      } catch (e) {
        body.innerHTML = `<p class="muted" style="padding:12px 16px">${esc(e.message || 'Non riesco a leggere le formazioni.')}</p>`;
      }
    }
  }

  // --------------------------------------------------- amministrazione
  // Aggiorna le rose di tutte le squadre leggendo il file Excel della lega
  // (dopo il mercato) e tiene allineato il modello usato per l'export.
  async function importRosters(file) {
    if (!file) return;
    let wb, buf;
    try { buf = new Uint8Array(await file.arrayBuffer()); wb = X.load(buf); }
    catch (e) { notice(e.message || 'Non riesco a leggere il file.', 'error'); return; }
    // se il file ha un foglio "listone" (Ruolo | Nome | Squadra) porta con sé anche
    // la squadra di Serie A: è quella che fa scattare il blocco partita per partita
    let clubs; try { clubs = wb.clubs(); } catch (e) { clubs = new Map(); }
    const clubOf = p => clubs.get(X.norm(p.name) + '|' + p.role) || clubs.get(X.norm(p.name)) || '';
    const teams = await SB.select('teams', 'select=id,name,sheet_name');
    const known = new Set(teams.map(t => t.sheet_name || t.name));
    const fogli = wb.sheetNames.filter(n => known.has(n));
    const ignorati = wb.sheetNames.filter(n => !known.has(n));
    if (!fogli.length) { notice('Nel file non trovo nessuna delle squadre della lega.', 'error'); return; }
    const el = sheet(`
      <div class="sheet-h"><div><h4>Aggiornare le rose?</h4><p>${esc(file.name)}</p></div></div>
      <div class="sheet-b"><div class="xl">${fogli.map(n => {
        const r = wb.roster(n).filter(p => p.name);
        const c = r.filter(p => clubOf(p)).length;
        return `<div class="xr" style="grid-template-columns:1fr auto"><span>${esc(n)}</span><span class="muted">${r.length} giocatori${c ? ' · ' + c + ' con squadra' : ''}</span></div>`;
      }).join('')}</div>
      ${ignorati.length ? `<p class="muted small" style="margin:8px 16px 0">Fogli ignorati: ${esc(ignorati.join(', '))}</p>` : ''}
      <p class="muted small" style="margin:8px 16px 0">Le rose nel database vengono allineate a questo file e il file diventa il modello per gli export. Le formazioni già salvate restano, ma un giocatore ceduto sparisce dai posti in cui era schierato.</p></div>
      <div class="sheet-f"><button type="button" class="btn btn-ghost" data-act="close">Annulla</button><button type="button" class="btn btn-primary" data-act="go">Aggiorna</button></div>`);
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') { closeSheet(); return; }
      b.disabled = true; b.textContent = 'Aggiorno…';
      const esiti = [];
      try {
        for (const n of fogli) {
          const rows = wb.roster(n).filter(p => p.name).map(p => ({ slot: p.row + 1, role: p.role, name: p.name, club: clubOf(p) }));
          esiti.push(await SB.rpc('import_players', { p_sheet: n, p_players: rows }));
        }
        try { await SB.upload('modelli', 'formazioni.xls', new Blob([buf]), 'application/vnd.ms-excel'); }
        catch (e) { console.error(e); esiti.push({ squadra: 'modello .xls', errore: e.message }); }
        closeSheet();
        const tot = esiti.reduce((a, x) => ({ nuovi: a.nuovi + (x.nuovi || 0), aggiornati: a.aggiornati + (x.aggiornati || 0), rimossi: a.rimossi + (x.rimossi || 0) }), { nuovi: 0, aggiornati: 0, rimossi: 0 });
        await startOnline();
        notice('Rose aggiornate: ' + tot.nuovi + ' nuovi, ' + tot.aggiornati + ' confermati, ' + tot.rimossi + ' rimossi.');
      } catch (e) {
        console.error(e);
        closeSheet();
        notice(e.message || 'Aggiornamento non riuscito.', 'error');
      }
    });
  }

  // Ricarica il calendario della Serie A (Edge Function "sync-calendario")
  function syncCalendar() {
    const el = sheet(`
      <div class="sheet-h"><div><h4>Aggiorna il calendario</h4><p>Scarico partite e orari della Serie A: da lì nascono le giornate e i blocchi.</p></div></div>
      <div class="sheet-b"><div style="padding:12px 16px;display:grid;gap:10px">
        <label style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" id="calClubs" checked>
          <span>Abbina anche la squadra di Serie A dei giocatori in rosa <span class="muted small">(serve al blocco partita per partita)</span></span></label>
        <p class="muted small" style="margin:0">Succede già ogni notte da solo. Usalo dopo il mercato o se gli orari sono cambiati.</p>
      </div></div>
      <div class="sheet-f"><button type="button" class="btn btn-ghost" data-act="close">Annulla</button><button type="button" class="btn btn-primary" data-act="go">Aggiorna</button></div>`);
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') { closeSheet(); return; }
      const clubs = el.querySelector('#calClubs').checked;
      b.disabled = true; b.textContent = 'Scarico…';
      try {
        const r = await SB.fn('sync-calendario', clubs ? 'squadre=1' : '');
        if (r && r.errore) throw new Error(r.errore);
        closeSheet();
        await startOnline();
        const sq = r && r.squadre;
        notice('Calendario aggiornato: ' + (r.partite || 0) + ' partite, giornata corrente ' + (r.corrente || '?') + '.'
          + (sq && sq.aggiornati != null ? ' Squadre dei giocatori: ' + sq.aggiornati + ' aggiornate, ' + (sq.da_sistemare || 0) + ' da sistemare.' : '')
          + (sq && sq.errore ? ' ' + sq.errore : '')
          + (r.da_controllare ? ' Da controllare in club_aliases: ' + r.da_controllare + '.' : ''));
      } catch (e) {
        closeSheet();
        notice(e.message || 'Aggiornamento del calendario non riuscito.', 'error');
      }
    });
  }

  // Squadra di Serie A di ogni giocatore: chi non ce l'ha si blocca alla prima partita
  async function clubsSheet() {
    let players, clubs;
    try {
      players = await SB.select('players', 'select=id,name,role,club,team_id,teams(name)&order=name');
      clubs = clubList();
      if (!clubs.length) {
        const f = await SB.select('fixtures', 'select=home,away&order=matchday.desc&limit=20');
        clubs = [...new Set([].concat.apply([], f.map(x => [x.home, x.away])))].sort();
      }
    } catch (e) { notice(e.message || 'Non riesco a leggere le rose.', 'error'); return; }
    const opts = c => clubs.map(x => `<option ${x === c ? 'selected' : ''}>${esc(x)}</option>`).join('');
    const riga = p => `<div class="xr" style="grid-template-columns:auto 1fr auto;gap:8px">
        <span class="badge" data-r="${esc(p.role)}">${esc(p.role)}</span>
        <span style="min-width:0"><span style="display:block;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span><span class="muted small">${esc(p.teams ? p.teams.name : '')}</span></span>
        <select data-pid="${p.id}" style="padding:6px 8px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2);color:inherit"><option value=""${p.club ? '' : ' selected'}>—</option>${opts(p.club)}</select>
      </div>`;
    const senza = players.filter(p => !p.club);
    const el = sheet(`
      <div class="sheet-h"><div><h4>Squadre dei giocatori</h4><p>${senza.length ? senza.length + ' senza squadra su ' + players.length : 'tutti abbinati (' + players.length + ')'}</p></div></div>
      <div class="sheet-b">
        <p class="muted small" style="margin:12px 16px 0">Chi non ha una squadra si blocca alla prima partita della giornata invece che alla sua.</p>
        <div class="xl" id="clubList">${(senza.length ? senza : players).map(riga).join('')}</div>
        ${senza.length ? '<div style="padding:8px 16px"><button type="button" class="btn btn-ghost" data-act="tutti">Mostra tutti</button></div>' : ''}
      </div>
      <div class="sheet-f"><button type="button" class="btn btn-ghost" data-act="close">Chiudi</button><button type="button" class="btn btn-primary" data-act="go">Salva</button></div>`);
    const prima = new Map(players.map(p => [p.id, p.club || '']));
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') { closeSheet(); return; }
      if (b.dataset.act === 'tutti') {
        el.querySelector('#clubList').innerHTML = players.map(riga).join('');
        b.remove();
        return;
      }
      const items = [];
      el.querySelectorAll('[data-pid]').forEach(sel => {
        if ((sel.value || '') !== (prima.get(sel.dataset.pid) || '')) items.push({ player_id: sel.dataset.pid, club: sel.value });
      });
      if (!items.length) { closeSheet(); toast('Niente da cambiare'); return; }
      b.disabled = true; b.textContent = 'Salvo…';
      try {
        const r = await SB.rpc('set_player_clubs', { p_items: items });
        closeSheet();
        await startOnline();
        notice('Squadre aggiornate: ' + (r && r.aggiornati != null ? r.aggiornati : items.length) + '.');
      } catch (e) { closeSheet(); notice(e.message || 'Salvataggio non riuscito.', 'error'); }
    });
  }

  const clubList = () => [...new Set([].concat.apply([], S.fixtures.map(f => [f.home, f.away])))].filter(Boolean).sort();

  function askMatchday() {
    const md = S.matchday;
    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    const val = md ? new Date(new Date(md.deadline) - new Date().getTimezoneOffset() * 60000) : now;
    const el = sheet(`
      <div class="sheet-h"><div><h4>Giornata corrente</h4><p>Di norma arriva dal calendario. Qui la imposti a mano: le formazioni si bloccano tutte alla scadenza indicata.</p></div></div>
      <div class="sheet-b"><div style="padding:12px 16px;display:grid;gap:10px">
        <label class="small muted" for="mdId">Numero</label>
        <input id="mdId" type="number" min="1" max="38" value="${md ? md.id : 1}" style="padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)">
        <label class="small muted" for="mdLabel">Etichetta</label>
        <input id="mdLabel" type="text" value="${esc(md && md.label || '')}" placeholder="Giornata" style="padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)">
        <label class="small muted" for="mdDeadline">Scadenza</label>
        <input id="mdDeadline" type="datetime-local" value="${val.toISOString().slice(0, 16)}" style="padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)">
      </div></div>
      <div class="sheet-f"><button type="button" class="btn btn-ghost" data-act="close">Annulla</button><button type="button" class="btn btn-primary" data-act="go">Salva</button></div>`);
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') { closeSheet(); return; }
      const id = +el.querySelector('#mdId').value;
      const dl = el.querySelector('#mdDeadline').value;
      if (!id || !dl) { toast('Servono numero e scadenza'); return; }
      try {
        await SB.rpc('set_current_matchday', { p_id: id, p_label: el.querySelector('#mdLabel').value, p_deadline: new Date(dl).toISOString() });
        closeSheet();
        await startOnline();
        toast('Giornata aggiornata');
      } catch (e) { notice(e.message || 'Non riesco a cambiare la giornata.', 'error'); }
    });
  }

  // ------------------------------------------------------------- accesso
  function showLogin(msg) {
    S.mode = 'file';
    $('#loginCard').hidden = false;
    $('#uploadCard').hidden = true;
    $('#fileBar').hidden = true;
    $('#menuWrap').hidden = true;
    if (msg) notice(msg);
    render();
  }

  async function doLogin(ev) {
    ev.preventDefault();
    const btn = $('#loginBtn');
    btn.disabled = true; btn.textContent = 'Entro…';
    try {
      await SB.signIn($('#email').value, $('#password').value);
      $('#password').value = '';
      await startOnline();
    } catch (e) {
      console.error(e);
      notice(e.message || 'Accesso non riuscito.', 'error');
      if (e.code === 'no_team' || e.code === 'no_profile') await SB.signOut();
    }
    btn.disabled = false; btn.textContent = 'Entra';
  }

  async function doRecover() {
    const email = $('#email').value.trim();
    if (!email) { notice('Scrivi prima la tua email, poi tocca di nuovo.'); return; }
    try {
      await SB.recover(email, location.origin + location.pathname);
      notice('Ti ho mandato un\u2019email con il link per reimpostare la password.');
    } catch (e) { notice(e.message || 'Invio non riuscito.', 'error'); }
  }

  function askNewPassword() {
    const el = sheet(`
      <div class="sheet-h"><div><h4>Nuova password</h4><p>Scegline una di almeno 8 caratteri.</p></div></div>
      <div class="sheet-b"><div style="padding:12px 16px"><input id="newPwd" type="password" autocomplete="new-password" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)"></div></div>
      <div class="sheet-f"><button type="button" class="btn btn-primary" data-act="set">Salva password</button></div>`, { modal: true });
    el.addEventListener('click', async ev => {
      if (!ev.target.closest('[data-act="set"]')) return;
      const pwd = el.querySelector('#newPwd').value;
      if (!pwd || pwd.length < 8) { toast('Almeno 8 caratteri'); return; }
      try { await SB.setPassword(pwd); closeSheet(); toast('Password aggiornata'); await startOnline(); }
      catch (e) { notice(e.message || 'Non riesco a cambiare la password.', 'error'); }
    });
  }

  function slotHtml(i, ro) {
    const r = S.starters[i];
    const dis = canEdit() ? '' : 'disabled';
    if (r == null) return `<button type="button" class="slot empty" data-z="s" data-i="${i}" data-r="${ro}" ${dis} aria-label="${i + 1}: scegli ${ROLE[ro]}"><span class="token">${ro}</span><span class="nm">${i + 1} · ${ROLE[ro].slice(0, 3)}.</span></button>`;
    const lk = isLocked(r);
    return `<button type="button" class="slot${lk ? ' locked' : ''}" data-z="s" data-i="${i}" data-r="${ro}" ${lk ? 'disabled' : dis} aria-label="${i + 1}: ${esc(P(r).name)}${lk ? ', partita già iniziata' : ''}"><span class="token">${lk ? '●' : i + 1}</span><span class="nm">${esc(P(r).name)}</span></button>`;
  }
  function rowHtml(z, i, r) {
    const ro = slotRole(z, i);
    const num = slotNum(z, i);
    const dis = canEdit() ? '' : 'disabled';
    if (r == null) {
      const badge = ro ? `<span class="badge" data-r="${ro}">${ro}</span>` : `<span class="badge any">·</span>`;
      const label = ro ? 'Scegli ' + ROLE[ro].toLowerCase() : 'Scegli giocatore';
      return `<button type="button" class="row empty" data-z="${z}" data-i="${i}" ${dis}><span class="num">${num}</span>${badge}<span class="who">${label}</span><span class="chev">›</span></button>`;
    }
    const p = P(r), lk = isLocked(r);
    return `<button type="button" class="row${lk ? ' locked' : ''}" data-z="${z}" data-i="${i}" ${lk ? 'disabled' : dis}><span class="num">${num}</span><span class="badge" data-r="${p.role}">${p.role}</span><span class="who">${esc(p.name)}</span>${lk ? '<span class="tag">in campo</span>' : '<span class="chev">›</span>'}</button>`;
  }

  function flash(pl) {
    if (!pl) return;
    const el = document.querySelector(`[data-z="${pl.z}"][data-i="${pl.i}"]`);
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }

  // ------------------------------------------------------------ picker
  function openPicker(z, i) {
    const ro = slotRole(z, i), num = slotNum(z, i), cur = arr(z)[i];
    const cands = S.roster.filter(p => p.name && (!ro || p.role === ro));
    const order = p => { const pl = placeOf(p.row); return pl ? (pl.z === z && pl.i === i ? 0 : 2) : 1; };
    cands.sort((a, b) => order(a) - order(b) || 'PDCA'.indexOf(a.role) - 'PDCA'.indexOf(b.role) || a.row - b.row);
    const rows = cands.map(p => {
      const pl = placeOf(p.row);
      const here = pl && pl.z === z && pl.i === i;
      const lk = isLocked(p.row);
      const tag = lk ? `<span class="tag">in campo${p.club ? ' · ' + esc(p.club) : ''}</span>`
        : here ? '<span class="tag here">qui</span>'
        : pl ? `<span class="tag">${zoneName(pl.z)} ${slotNum(pl.z, pl.i)} · scambia</span>` : '';
      return `<button type="button" class="row${lk ? ' locked' : ''}" data-pick="${p.row}" ${lk ? 'disabled' : ''}><span class="badge" data-r="${p.role}">${p.role}</span><span class="who">${esc(p.name)}</span>${tag}</button>`;
    }).join('') || '<p class="muted" style="padding:12px 16px">Nessun giocatore disponibile per questo ruolo.</p>';
    const title = `${num} · ${ro ? ROLE[ro] : 'Qualsiasi ruolo'}`;
    const sub = z === 's' ? 'Titolare' : z === 'b' ? 'Riserva — entra in ordine di numero' : 'Panchina extra';
    const el = sheet(`
      <div class="sheet-h"><div><h4>${esc(title)}</h4><p>${sub}</p></div></div>
      <div class="sheet-b">${rows}</div>
      <div class="sheet-f">${cur != null && !isLocked(cur) ? '<button type="button" class="btn btn-ghost" data-act="clear">Svuota posto</button>' : ''}<button type="button" class="btn btn-primary" data-act="close">Chiudi</button></div>`);
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-pick],[data-act]');
      if (!b) return;
      if (b.dataset.act === 'clear') { guarded(() => { arr(z)[i] = null; }); closeSheet(); render(); return; }
      if (b.dataset.act === 'close') { closeSheet(); return; }
      guarded(() => assign(z, i, +b.dataset.pick));
      closeSheet(); render(); flash({ z, i });
    });
  }

  function sheet(html, opts) {
    closeSheet();
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    if (opts && opts.modal) scrim.dataset.modal = '1';
    scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    scrim.addEventListener('click', ev => { if (ev.target === scrim && !scrim.dataset.modal) closeSheet(); });
    $('#layer').appendChild(scrim);
    const f = scrim.querySelector('button');
    if (f) f.focus({ preventScroll: true });
    return scrim.firstElementChild;
  }
  function closeSheet() { $('#layer').innerHTML = ''; }

  // ------------------------------------------------------------ avvisi
  function clearNotices() { $('#notices').innerHTML = ''; }
  function notice(text, kind, actLabel, act) {
    const d = document.createElement('div');
    d.className = 'notice' + (kind === 'error' ? ' error' : '');
    d.innerHTML = `<span>${esc(text)}</span>`;
    if (actLabel) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = actLabel;
      b.addEventListener('click', () => { d.remove(); act(); });
      d.appendChild(b);
    } else {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = 'OK'; b.setAttribute('aria-label', 'Chiudi avviso');
      b.addEventListener('click', () => d.remove());
      d.appendChild(b);
    }
    $('#notices').appendChild(d);
  }
  let toastT;
  function toast(t) {
    document.querySelectorAll('.toast').forEach(x => x.remove());
    const d = document.createElement('div');
    d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = t;
    document.body.appendChild(d);
    clearTimeout(toastT); toastT = setTimeout(() => d.remove(), 2600);
  }

  // ------------------------------------------------------------ salvataggio
  function issues() {
    const out = [];
    const ms = S.starters.filter(x => x == null).length;
    const mb = S.bench.filter(x => x == null).length;
    const me = S.extra.filter(x => x == null).length;
    if (ms) out.push(`Mancano ${ms} titolar${ms === 1 ? 'e' : 'i'}: come con la macro, la classifica dei numeri scala e le prime riserve diventano titolari.`);
    if (mb || me) out.push(`Posti vuoti in panchina (${mb + me}): come con la macro, verranno occupati dai primi giocatori non schierati della rosa.`);
    return out;
  }

  function onSave() {
    const list = issues();
    if (!list.length) return doSave();
    const el = sheet(`
      <div class="sheet-h"><div><h4>Formazione incompleta</h4><p>Puoi completarla o salvarla così com'è.</p></div></div>
      <div class="sheet-note">${list.map(t => `<div class="notice"><span>${esc(t)}</span></div>`).join('')}</div>
      <div class="sheet-f"><button type="button" class="btn btn-ghost" data-act="save">Salva comunque</button><button type="button" class="btn btn-primary" data-act="close">Completa</button></div>`);
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      closeSheet();
      if (b.dataset.act === 'save') doSave();
    });
  }

  async function doSave() {
    if (online()) {
      const btn = $('#saveBtn');
      btn.disabled = true;
      try {
        const res = await saveOnline();
        S.savedAt = new Date().toISOString();
        clearNotices();
        showSaved(res);
      } catch (e) {
        console.error(e);
        notice(e && e.message ? e.message : 'Salvataggio non riuscito.', 'error');
        if (e && e.code === 'P0002') { S.closed = true; }
      }
      render();
      return;
    }
    let res;
    try { res = S.wb.build(S.sheet, numbers()); }
    catch (e) { console.error(e); notice(e instanceof X.XlsError ? e.message : 'Errore durante la scrittura del file: ' + (e && e.message || e), 'error'); return; }
    // ricorda la formazione (per ripartire la prossima giornata)
    const p = prefs();
    p.lastSheet = S.sheet;
    p.sheets = p.sheets || {};
    const names = {};
    numbers().forEach((n, r) => { if (n != null) names[n] = P(r).name + '|' + P(r).role; });
    p.sheets[S.sheet] = { module: S.module, free: S.free, names, at: Date.now() };
    setPrefs(p);
    $('#restoreBtn').hidden = false;

    const how = await deliver(res.bytes, outName());
    showResult(res, how);
  }

  // Nome del file salvato: formazioni_AAAAMMGG_Squadra.xls (data di oggi, squadra schierata)
  function outName() {
    const d = new Date();
    const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const team = String(S.sheet || 'squadra').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_') || 'squadra';
    return 'formazioni_' + ymd + '_' + team + '.xls';
  }

  async function deliver(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/vnd.ms-excel' });
    if (inViewer) {
      const dl = await dlP;
      if (!dl) return { how: 'unavailable', blob };
      try { await dl.save({ filename: name, data: blob }); return { how: 'xls', name }; }
      catch (e) {
        const code = e && e.code;
        if (code === 'rejected_extension' || code === 'extension_not_enabled') {
          const zname = name.replace(/\.xls$/i, '') + '.zip';
          try { await dl.save({ filename: zname, data: new Blob([makeZip(name, bytes)], { type: 'application/zip' }) }); return { how: 'zip', name: zname }; }
          catch (e2) { return { how: 'fail', code: e2 && e2.code, blob }; }
        }
        return { how: 'fail', code, blob };
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
    return { how: 'direct', name, blob };
  }

  function showResult(res, d) {
    const mod = res.modulo.every(x => x != null) ? res.modulo.join('-') : S.module;
    const sh = res.shown; // I5:I29
    const lu = res.lineup; // H31:I52
    const line = (k) => `<div class="xr"><span class="n">${k}</span><span class="badge" data-r="${esc(lu[k - 1].role)}">${esc(lu[k - 1].role || '·')}</span><span>${esc(lu[k - 1].name || '—')}</span></div>`;
    let head, body;
    if (d.how === 'xls' || d.how === 'direct') {
      head = 'File salvato';
      body = `<b>${esc(d.name)}</b> è nei download: invialo all'amministratore (WhatsApp, e-mail…).`;
    } else if (d.how === 'zip') {
      head = 'File salvato (in .zip)';
      body = `Da qui Claude non può scaricare file .xls, quindi ho salvato <b>${esc(d.name)}</b>: aprilo, tocca “Estrai” e invia all'amministratore il file .xls che contiene. Con la versione offline dell'app il .xls si scarica direttamente.`;
    } else if (d.how === 'fail' && d.code === 'declined') {
      head = 'Salvataggio annullato';
      body = 'Il file non è stato salvato. Tocca di nuovo “Salva file Excel” quando vuoi.';
    } else {
      head = 'Salvataggio non disponibile qui';
      body = 'Questa pagina non può scaricare file in questo visualizzatore. Usa la versione offline dell’app.';
    }
    const ok = d.how === 'xls' || d.how === 'direct' || d.how === 'zip';
    const canShare = d.blob && navigator.canShare && (() => { try { return navigator.canShare({ files: [new File([d.blob], d.name || outName(), { type: 'application/vnd.ms-excel' })] }); } catch (e) { return false; } })();
    const el = sheet(`
      <div class="sheet-h"><div style="display:flex;gap:12px;align-items:center">${ok ? '<span class="done-mark" aria-hidden="true">✓</span>' : ''}<div><h4>${head}</h4><p>${esc(S.sheet)} · modulo ${esc(mod)}</p></div></div></div>
      <div class="sheet-b">
        <p style="margin:12px 16px 0">${body}</p>
        <div class="xl" aria-label="Formazione come appare in Excel">
          <div class="xh">Titolari</div>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(line).join('')}
          <div class="xh">Riserve</div>${[12, 13, 14, 15, 16, 17, 18].map(line).join('')}
          <div class="xh">Panchina extra</div>${[19, 20, 21, 22].map(line).join('')}
        </div>
        <p class="muted small" style="margin:8px 16px 0">È quello che vedrai in Excel nelle celle I5:I29 dopo la macro (${esc(sh[0] || '—')}, ${esc(sh[1] || '—')}, …).</p>
      </div>
      <div class="sheet-f">${canShare ? '<button type="button" class="btn btn-ghost" data-act="share">Condividi</button>' : ''}<button type="button" class="btn btn-primary" data-act="close">Fatto</button></div>`);
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') closeSheet();
      if (b.dataset.act === 'share') {
        try { await navigator.share({ files: [new File([d.blob], d.name || outName(), { type: 'application/vnd.ms-excel' })], title: d.name || outName() }); }
        catch (e) { /* annullato */ }
      }
    });
  }

  // ------------------------------------------------------------ zip (solo "store")
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function makeZip(name, data) {
    const nm = new TextEncoder().encode(name);
    const crc = crc32(data), d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const out = new Uint8Array(30 + nm.length + data.length + 46 + nm.length + 22);
    const v = new DataView(out.buffer);
    let p = 0;
    const u16 = x => { v.setUint16(p, x, true); p += 2; }, u32 = x => { v.setUint32(p, x, true); p += 4; };
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(time); u16(date); u32(crc); u32(data.length); u32(data.length); u16(nm.length); u16(0);
    out.set(nm, p); p += nm.length; out.set(data, p); p += data.length;
    const cd = p;
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(time); u16(date); u32(crc); u32(data.length); u32(data.length); u16(nm.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(0);
    out.set(nm, p); p += nm.length;
    const cdSize = p - cd;
    u32(0x06054b50); u16(0); u16(0); u16(1); u16(1); u32(cdSize); u32(cd); u16(0);
    return out;
  }

  // ------------------------------------------------------------ eventi
  $('#loginForm').addEventListener('submit', doLogin);
  $('#recoverBtn').addEventListener('click', doRecover);
  $('#fileModeBtn').addEventListener('click', () => { $('#loginCard').hidden = true; $('#uploadCard').hidden = false; });
  $('#logoutBtn').addEventListener('click', async () => {
    toggleMenu(false);
    await SB.signOut();
    S.mode = 'file'; S.team = null; S.wb = null; S.roster = [];
    S.starters = Array(11).fill(null); S.bench = Array(7).fill(null); S.extra = Array(4).fill(null);
    clearNotices();
    showLogin();
  });
  $('#exportBtn').addEventListener('click', () => { toggleMenu(false); exportXls(); });
  $('#rosterBtn').addEventListener('click', () => { toggleMenu(false); $('#adminFile').click(); });
  $('#adminFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; importRosters(f); });
  $('#matchdayBtn').addEventListener('click', () => { toggleMenu(false); askMatchday(); });
  $('#calBtn').addEventListener('click', () => { toggleMenu(false); syncCalendar(); });
  $('#clubBtn').addEventListener('click', () => { toggleMenu(false); clubsSheet(); });
  $('#allBtn').addEventListener('click', () => { toggleMenu(false); showAll(); });
  $('#logBtn').addEventListener('click', () => { toggleMenu(false); showLog(); });
  $('#pickBtn').addEventListener('click', () => $('#fileInput').click());
  $('#changeFileBtn2').addEventListener('click', () => { toggleMenu(false); $('#fileInput').click(); });
  $('#fileInput').addEventListener('change', e => handleFile(e.target.files[0]));
  const up = $('#uploadCard');
  ['dragenter', 'dragover'].forEach(t => up.addEventListener(t, e => { e.preventDefault(); up.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(t => up.addEventListener(t, e => { e.preventDefault(); up.classList.remove('drag'); }));
  up.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
  $('#sheetSel').addEventListener('change', e => { const p = prefs(); p.lastSheet = e.target.value; setPrefs(p); loadSheet(e.target.value); });

  $('#modules').addEventListener('click', e => { const b = e.target.closest('[data-mod]'); if (!b) return; guarded(() => setModule(b.dataset.mod)); render(); });
  $('#editor').addEventListener('click', e => {
    const s = e.target.closest('[data-z]');
    if (s && canEdit()) { openPicker(s.dataset.z, +s.dataset.i); return; }
    const a = e.target.closest('[data-add]');
    if (a && canEdit()) {
      const row = +a.dataset.add;
      if (isLocked(row)) { toast(P(row).name + ': la partita è già iniziata'); return; }
      const pl = autoPlace(row);
      if (!pl) { toast('Nessun posto libero per un ' + ROLE[P(row).role].toLowerCase()); return; }
      render(); flash(pl);
    }
  });
  $('#saveBtn').addEventListener('click', onSave);

  function toggleMenu(open) {
    const pop = $('#menuPop');
    pop.hidden = open === undefined ? !pop.hidden : !open;
    $('#menuBtn').setAttribute('aria-expanded', String(!pop.hidden));
  }
  $('#menuBtn').addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener('click', e => { if (!e.target.closest('#menuWrap')) toggleMenu(false); });
  $('#freeToggle').addEventListener('change', e => {
    if (!guarded(() => setFree(e.target.checked))) e.target.checked = S.free;
    render();
  });
  $('#restoreBtn').addEventListener('click', () => { toggleMenu(false); online() ? restoreOnline() : restoreSaved(); });
  $('#clearBtn').addEventListener('click', () => {
    toggleMenu(false);
    // chi è già sceso in campo resta al suo posto
    ['s', 'b', 'e'].forEach(z => { const a = arr(z); a.forEach((r, i) => { if (r != null && !isLocked(r)) a[i] = null; }); });
    render();
    toast(lockedRows().some(r => placeOf(r)) ? 'Svuotata, tranne chi è già in campo' : 'Formazione svuotata');
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!document.querySelector('.scrim[data-modal]')) closeSheet(); toggleMenu(false); } });

  // ------------------------------------------------------------ app installata (GitHub Pages)
  // File condiviso da un'altra app (es. WhatsApp → Condividi → Schiera): lo passa il service worker.
  async function receiveShared() {
    const q = new URLSearchParams(location.search);
    if (!q.has('condiviso')) return;
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignora */ }
    try {
      const c = await caches.open('schiera-condivisi');
      const key = new URL('file-condiviso', document.baseURI).href;
      const r = await c.match(key);
      if (!r) { notice('Il file condiviso non è arrivato: caricalo con “Scegli il file .xls”.'); return; }
      const name = decodeURIComponent(r.headers.get('x-nome') || 'Formazioni.xls');
      const blob = await r.blob();
      await c.delete(key);
      handleFile(new File([blob], name));
    } catch (e) { console.error(e); }
  }
  receiveShared();
  if ('launchQueue' in window) {
    try { window.launchQueue.setConsumer(async p => { if (p.files && p.files.length) handleFile(await p.files[0].getFile()); }); } catch (e) { /* ignora */ }
  }
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installEvt = e;
    document.querySelectorAll('.install-btn').forEach(b => { b.hidden = false; });
  });
  document.querySelectorAll('.install-btn').forEach(b => b.addEventListener('click', async () => {
    toggleMenu(false);
    if (!installEvt) return;
    installEvt.prompt();
    try { await installEvt.userChoice; } catch (e) { /* ignora */ }
    installEvt = null;
    document.querySelectorAll('.install-btn').forEach(x => { x.hidden = true; });
  }));
  window.addEventListener('appinstalled', () => toast('App installata'));

  // Avvio: se il database è configurato si entra con l'account, altrimenti resta la modalità file
  (async function start() {
    if (!SBok()) { $('#loginCard').hidden = true; $('#uploadCard').hidden = false; render(); return; }
    const hash = SB.adoptFromHash();
    try {
      if (hash && hash.type === 'recovery') { $('#loginCard').hidden = true; askNewPassword(); render(); return; }
      if (SB.session()) { await startOnline(); return; }
    } catch (e) {
      console.error(e);
      await SB.signOut();
      showLogin(e && e.message ? e.message : 'Devi entrare di nuovo.');
      return;
    }
    showLogin();
  })();

  render();
})();
