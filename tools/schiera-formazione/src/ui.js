(function () {
  'use strict';
  const X = window.XlsFormazione;
  // Dentro il sito della lega Schiera è una sezione come le altre: cerca i suoi
  // elementi solo sotto la sua radice, così gli id non si pestano i piedi.
  const EMBED = !!window.SCHIERA_EMBED;
  const ROOT = (EMBED && document.getElementById('schiera-app')) || document;
  const $ = s => ROOT.querySelector(s);
  const on = (sel, ev, fn) => { const e = $(sel); if (e) e.addEventListener(ev, fn); };
  const show = (sel, v) => { const e = $(sel); if (e) e.hidden = !v; };
  const avvisaSito = () => { try { if (window.Schiera && window.Schiera.onCambio) window.Schiera.onCambio(); } catch (e) { /* ignora */ } };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const MODULES = ['3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-3-2', '5-4-1'];
  const BENCH_ROLES = ['P', 'D', 'D', 'C', 'C', 'A', 'A'];
  const ROLE = { P: 'Portiere', D: 'Difensore', C: 'Centrocampista', A: 'Attaccante' };
  const ROLES_PL = { P: 'Portieri', D: 'Difensori', C: 'Centrocampisti', A: 'Attaccanti' };
  const LS_KEY = 'schiera-formazione:v1';

  const S = {
    mode: EMBED ? 'online' : 'file',            // 'online' (database) oppure 'file' (.xls scelto a mano)
    bytes: null, fileName: '', wb: null, sheet: null, roster: [],
    module: '3-4-3', free: false,
    starters: Array(11).fill(null), bench: Array(7).fill(null), extra: Array(4).fill(null),
    profile: null, team: null, matchday: null, closed: false, savedAt: null, vuoti: [],
    fixtures: [],            // partite della giornata: da qui i blocchi partita per partita
    rounds: [],              // giornate della lega: servono a scrivere "Giornata 4 (6ª di Serie A)"
    base: new Map(),         // la formazione salvata (riga -> numero): le regole sui bloccati si contano da qui
    baseMod: null,           // e il suo modulo
    mioTeam: null,           // la squadra dell'account
    adm: false,              // l'amministratore sta modificando la formazione di un'altra squadra
    mia: null,               // intanto, lo stato della propria (serve al sito: salvata, conto alla rovescia)
    teams: [],               // tutte le squadre (per l'amministratore)
    modifiche: [],           // modifiche dell'amministratore a questa formazione (pubbliche)
    muto: false              // durante le prove (posto valido o no?) niente avvisi
  };
  const online = () => S.mode === 'online';
  const loaded = () => online() ? !!S.team : !!S.wb;
  const isAdmin = () => !!(S.profile && S.profile.role === 'admin');
  // formazione ferma per chi gioca: giornata finita o scadenza passata (l'amministratore no)
  const ferma = () => online() && !S.adm && (S.closed || scaduta());
  const canEdit = () => loaded() && !ferma();
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
  // Ogni giocatore si blocca 30 minuti prima della partita della sua squadra di Serie A.
  // Chi non ha una squadra nota si blocca 30 minuti prima della prima partita della
  // giornata; chi gioca una partita rinviata o un recupero lontano resta libero fino
  // alla scadenza della formazione completa (domenica 12.00, mercoledì 20.00).
  // È il database ad applicare le regole: qui servono a non far fare buchi nell'acqua.
  const LOCK_MS = 30 * 60000;
  const ms = d => +new Date(d);
  const valida = f => !/^(POSTPONED|CANCELLED)$/.test(f.status || '');
  function firstKickoff() {
    if (S.matchday && S.matchday.first_kickoff) return ms(S.matchday.first_kickoff);
    const k = S.fixtures.filter(valida).map(f => ms(f.kickoff));
    return k.length ? Math.min.apply(null, k) : null;
  }
  function clubKickoff(club) {
    const k = S.fixtures.filter(f => valida(f) && (f.home === club || f.away === club)).map(f => ms(f.kickoff));
    return k.length ? Math.min.apply(null, k) : null;
  }
  // quando si blocca un giocatore della rosa (oggetto di S.roster)
  function lockOf(p) {
    if (!online() || !S.fixtures.length || !p || !p.id) return null;
    // squadra ignota: prudenza, si blocca con la prima partita della giornata.
    // squadra che questa giornata riposa: nessun blocco.
    const k = p.club ? clubKickoff(p.club) : firstKickoff();
    return k == null ? null : k - LOCK_MS;
  }
  const lockAt = row => lockOf(P(row));
  // "giocato": la sua partita è iniziata o inizia fra meno di mezz'ora
  const giocatoP = p => { const t = lockOf(p); return t != null && t <= Date.now(); };
  const giocato = row => giocatoP(P(row));
  // bloccato davvero: per l'amministratore che modifica un'altra squadra non vale
  const isLocked = row => !S.adm && giocato(row);
  const lockedRows = () => S.roster.filter(p => p.name && isLocked(p.row)).map(p => p.row);
  function nextLock(roster) {
    const t = (roster || S.roster).filter(p => p.name).map(lockOf).filter(x => x != null && x > Date.now());
    return t.length ? Math.min.apply(null, t) : null;
  }
  // scadenza della formazione completa (dal calendario, o scelta dall'amministratore)
  const scadOf = md => md && md.scadenza ? ms(md.scadenza) : null;
  function scaduta() { const t = scadOf(S.matchday); return online() && t != null && t <= Date.now(); }

  // ----------------------------------------- le regole sui giocatori bloccati
  // Le stesse del database (db/12_scadenze.sql), contate sulla formazione salvata:
  //  - chi è bloccato resta dov'è (anche fuori formazione);
  //  - un panchinaro bloccato (12–22) tiene fermi i giocatori del suo reparto messi prima
  //    di lui: restano gli stessi (si possono scambiare fra loro) e i titolari di quel
  //    reparto restano tanti quanti erano.
  function numMap() {
    const m = new Map();
    S.starters.forEach((r, i) => { if (r != null) m.set(r, i + 1); });
    S.bench.forEach((r, i) => { if (r != null) m.set(r, 12 + i); });
    S.extra.forEach((r, i) => { if (r != null) m.set(r, 19 + i); });
    return m;
  }
  function problema(base, ora) {
    if (!online() || S.adm || !S.fixtures.length) return null;
    for (const p of S.roster) {
      if (p.name && isLocked(p.row) && base.get(p.row) !== ora.get(p.row)) return { tipo: 'blocco', row: p.row };
    }
    const panca = [...base.entries()].filter(([r, n]) => n >= 12 && isLocked(r)).sort((a, b) => a[1] - b[1]);
    // nel modulo: quanti titolari ha il reparto (il portiere è sempre uno)
    const nelModulo = (mod, ro) => ro === 'P' || !mod || !MODULES.includes(mod) ? null : counts(mod)[ro];
    for (const [r, n] of panca) {
      const ro = P(r).role;
      const davanti = m => [...m.entries()].filter(([x, k]) => k < n && P(x).role === ro).map(([x]) => x).sort((a, b) => a - b).join(',');
      const titolari = m => [...m.entries()].filter(([x, k]) => k <= 11 && P(x).role === ro).length;
      const mb = nelModulo(S.baseMod, ro), mo = nelModulo(S.module, ro);
      if (davanti(base) !== davanti(ora) || titolari(base) !== titolari(ora) || (mb != null && mb !== mo))
        return { tipo: 'reparto', row: r, num: n, ruolo: ro, titolari: mb != null ? mb : titolari(base) };
    }
    return null;
  }
  const elenco = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1] : a.join('');
  const REPARTO = { P: 'in porta', D: 'in difesa', C: 'a centrocampo', A: 'in attacco' };
  const QUELLI = { P: 'i portieri', D: 'i difensori', C: 'i centrocampisti', A: 'gli attaccanti' };
  function testoProblema(x) {
    if (x.tipo === 'blocco') return P(x.row).name + ' è già bloccato (partita al via fra meno di 30 minuti o iniziata): resta dov’è';
    return P(x.row).name + ' (posto ' + x.num + ') è già bloccato: ' + QUELLI[x.ruolo] +
      ' messi prima di lui restano gli stessi, solo scambiati fra loro, e i titolari ' + REPARTO[x.ruolo] + ' restano ' + x.titolari;
  }

  const snapshot = () => ({ s: S.starters.slice(), b: S.bench.slice(), e: S.extra.slice(), module: S.module, free: S.free });
  function restoreSnap(x) {
    S.starters = x.s; S.bench = x.b; S.extra = x.e; S.module = x.module; S.free = x.free;
    $('#freeToggle').checked = S.free;
  }
  // Prova una modifica senza tenerla: ritorna il problema che creerebbe (o null)
  function prova(fn) {
    if (!online() || S.adm || !S.fixtures.length) return null;
    const snap = snapshot(), prima = problema(S.base, numMap());
    S.muto = true;
    try { fn(); } finally { S.muto = false; }
    const dopo = problema(S.base, numMap());
    restoreSnap(snap);
    return prima ? null : dopo;
  }
  // Esegue la modifica e la annulla se rompe le regole sui bloccati
  function guarded(fn) {
    if (!online() || S.adm || !S.fixtures.length) { fn(); return true; }
    const snap = snapshot(), prima = problema(S.base, numMap());
    fn();
    const dopo = problema(S.base, numMap());
    if (dopo && !prima) {
      restoreSnap(snap);
      toast(testoProblema(dopo));
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
  // come autoPlace, ma salta i posti che romperebbero le regole sui bloccati
  function autoPlaceOk(row) {
    const role = P(row).role, roles = starterRoles();
    const posti = [];
    for (let i = 0; i < 11; i++) if (S.starters[i] == null && roles[i] === role) posti.push({ z: 's', i });
    for (let i = 0; i < 7; i++) if (S.bench[i] == null && (!benchRole(i) || benchRole(i) === role)) posti.push({ z: 'b', i });
    for (let i = 0; i < 4; i++) if (S.extra[i] == null) posti.push({ z: 'e', i });
    if (!posti.length) return { pl: null };
    let primo = null;
    for (const x of posti) {
      const no = prova(() => { arr(x.z)[x.i] = row; });
      if (!no) { arr(x.z)[x.i] = row; return { pl: x }; }
      if (!primo) primo = no;
    }
    return { pl: null, no: primo };
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
    if (S.muto) return;
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
      if (out.length && !S.muto) toast(out.join(', ') + ' tolto dalle riserve');
    }
    if (S.muto) return;
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
    // con un posto vuoto (giocatore svincolato) i conti non tornano: se il modulo salvato
    // li contiene ancora, resta quello e il buco cade sul ruolo di chi manca
    const entra = m => { const k = counts(m); return k.D >= c.D && k.C >= c.C && k.A >= c.A; };
    let mod = MODULES.includes(exact) ? exact : (MODULES.includes(S.module) && entra(S.module)) ? S.module : MODULES.find(entra) || S.module;
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
      show('#uploadCard', false);
      show('#fileBar', true);
      show('#menuWrap', true);
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
    const locked = ferma();
    // moduli: quelli che sposterebbero un bloccato (o il numero dei titolari di un
    // reparto con un panchinaro bloccato) non si possono scegliere
    $('#modules').innerHTML = MODULES.map(m => {
      const no = ready && !locked && m !== S.module ? prova(() => setModule(m)) : null;
      return `<button type="button" class="chip${no ? ' no' : ''}" data-mod="${m}" aria-pressed="${m === S.module}" ${ready && !locked && !no ? '' : 'disabled'}${no ? ` title="${esc(testoProblema(no))}"` : ''}>${m}</button>`;
    }).join('');
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
        const lk = isLocked(p.row), gi = !lk && S.adm && giocato(p.row);
        return `<button type="button" class="pchip${lk ? ' locked' : ''}${gi ? ' giocato' : ''}" data-add="${p.row}" data-r="${p.role}" ${lk ? 'disabled title="Bloccato: la sua partita è iniziata o inizia fra meno di 30 minuti"' : ''}><span class="badge">${p.role}</span>${esc(p.name)}${lk || gi ? '<span class="lk" aria-label="bloccato">●</span>' : ''}</button>`;
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
    if ($('#sub')) $('#sub').textContent = ready ? (S.sheet || '') + ' · ' + S.module : 'formazione dal file .xls della lega';
    if (online()) renderOnlineBar();
    ROOT.querySelectorAll('#editor button').forEach(b => { if (locked) b.disabled = true; });
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

  // ------------------------------------------------ conto alla rovescia
  // Ogni giocatore si blocca 30 minuti prima della sua partita; alla scadenza della
  // formazione completa (domenica 12.00, mercoledì 20.00) si blocca tutto. Il conto
  // segue l'evento più vicino. È sempre quello della propria squadra, anche mentre
  // l'amministratore modifica la formazione di un'altra.
  const mioRoster = () => (S.adm && S.mia ? S.mia.roster : S.roster);
  function scadenza() {
    const md = S.matchday;
    if (!online() || !md) return { fase: 'nessuna' };
    const chiude = closeTime(md) ? ms(closeTime(md)) : null;
    const ora = Date.now();
    if (S.closed || (chiude && chiude <= ora)) return { fase: 'chiusa', t: chiude, testo: 'Giornata chiusa', breve: '' };
    const scad = scadOf(md);
    if (scad != null && scad <= ora) return { fase: 'scaduta', t: scad, testo: 'Formazioni chiuse', breve: '' };
    const roster = mioRoster().filter(p => p.name);
    const nx = nextLock(roster);
    const gia = roster.filter(giocatoP).length;
    if (nx && (scad == null || nx < scad)) {
      return { fase: gia ? 'blocchi' : 'prima', t: nx, scad, gia,
        chi: roster.filter(p => lockOf(p) === nx).map(p => p.name),
        testo: gia ? 'Il prossimo dei tuoi si blocca fra' : 'Il primo dei tuoi si blocca fra',
        breve: gia ? 'prossimo blocco' : 'primo blocco' };
    }
    if (scad != null) return { fase: 'scadenza', t: scad, scad, gia, testo: 'Formazione completa entro', breve: 'scadenza' };
    return { fase: 'incampo', t: chiude, gia, testo: 'Tutti i tuoi sono bloccati · si chiude fra', breve: 'chiusura' };
  }
  // millisecondi -> giorni, ore, minuti, secondi
  function pezzi(t) {
    const d = Math.max(0, Math.floor((t - Date.now()) / 1000));
    return { g: Math.floor(d / 86400), h: Math.floor(d / 3600) % 24, m: Math.floor(d / 60) % 60, s: d % 60 };
  }
  const due = n => String(n).padStart(2, '0');

  function renderConto() {
    const box = $('#conto');
    if (!box) return;
    const sc = scadenza();
    // mentre l'amministratore modifica un'altra squadra il conto non c'entra
    if (!online() || sc.fase === 'nessuna' || S.adm) { box.hidden = true; return; }
    box.hidden = false;
    box.dataset.fase = sc.fase;
    $('#contoLbl').textContent = sc.testo;
    if (sc.fase === 'chiusa' || sc.fase === 'scaduta' || !sc.t) {
      $('#contoNum').innerHTML = '';
      $('#contoSub').textContent = !sc.t ? ''
        : sc.fase === 'scaduta' ? 'scadenza ' + fmtDate(sc.t) + ': la formazione non si cambia più. Per una modifica scrivi all’amministratore.'
        : 'finita ' + fmtDate(sc.t) + ': la formazione non si può più cambiare';
      return;
    }
    const p = pezzi(sc.t);
    const cella = (n, et) => `<span><b>${n}</b><i>${et}</i></span>`;
    $('#contoNum').innerHTML = (p.g ? cella(p.g, p.g === 1 ? 'giorno' : 'giorni') : '')
      + cella(due(p.h), 'ore') + cella(due(p.m), 'min') + cella(due(p.s), 'sec');
    const gia = sc.gia ? sc.gia + ' dei tuoi già bloccati · ' : '';
    const entro = sc.scad ? 'formazione completa entro ' + fmtDate(sc.scad) : '';
    $('#contoSub').textContent = sc.fase === 'prima' || sc.fase === 'blocchi'
      ? fmtHour(sc.t) + ' · ' + (sc.chi.length > 2 ? sc.chi.slice(0, 2).join(', ') + ' e altri' : sc.chi.join(', ')) +
        ' (30 minuti prima della partita)' + (entro ? ' · ' + entro : '')
      : sc.fase === 'scadenza' ? gia + 'poi la formazione non si cambia più'
      : gia + 'si chiude ' + fmtDate(closeTime(S.matchday));
  }

  function renderOnlineBar() {
    const md = S.matchday;
    const el = $('#fileMeta');
    $('#fileName').textContent = (S.team ? S.team.name : '') + (md ? ' · ' + nomeGiornata(md) : '');
    // l'amministratore sceglie qui di quale squadra modificare la formazione
    show('#teamField', isAdmin() && S.teams.length > 1);
    el.style.color = '';
    if (!md) { el.textContent = 'nessuna giornata aperta'; el.style.color = 'var(--role-a)'; }
    else if (S.adm) { el.textContent = '✎ Modifica dell’amministratore: blocchi e scadenze non valgono'; el.style.color = 'var(--warn-ink)'; }
    else if (S.vuoti.length) { el.textContent = '⚠ Formazione da rifare: ' + (S.vuoti.length === 1 ? 'un posto vuoto' : S.vuoti.length + ' posti vuoti'); el.style.color = 'var(--warn-ink)'; }
    else el.textContent = (S.savedAt ? '✓ Formazione salvata ' + fmtDate(S.savedAt) : 'Formazione non ancora salvata')
      + (S.modifiche.length ? ' · modificata dall’amministratore' : '');
    renderConto();
  }

  // Ogni secondo: il conto alla rovescia; e se nel frattempo si è arrivati a mezz'ora
  // da una partita, o alla scadenza, i giocatori si bloccano da soli.
  let tick;
  function startTicker() {
    clearInterval(tick);
    if (!online()) return;
    const stato = () => lockedRows().join(',') + '|' + scaduta() + '|' + mioRoster().filter(giocatoP).length;
    let prima = stato();
    tick = setInterval(() => {
      if (!online() || !S.team) { clearInterval(tick); return; }
      const ora = stato();
      const finita = S.matchday && !timeLeft(closeTime(S.matchday));
      if (ora !== prima || (finita && !S.closed)) {
        const scadutaOra = !prima.includes('|true|') && ora.includes('|true|');
        prima = ora;
        if (finita) S.closed = true;
        if (scadutaOra && !S.adm) { closeSheet(); notice(testoScaduta(), 'warn'); }
        render();
        avvisaSito();
      } else renderConto();
    }, 1000);
  }
  const testoScaduta = () => 'Scadenza passata (' + fmtDate(scadOf(S.matchday)) + '): la formazione non si può più cambiare. Per una modifica scrivi all’amministratore.';

  function rosterFromDb(players) {
    const out = [];
    for (let i = 0; i < 31; i++) out.push({ row: i, id: null, role: '', name: '', club: '', number: null });
    players.forEach(p => {
      const i = p.slot - 1;
      if (i >= 0 && i < 31) out[i] = { row: i, id: p.id, role: String(p.role || '').toUpperCase(), name: p.name || '', club: p.club || '', number: null };
    });
    return out;
  }

  // la giornata corrente; se il database non ha ancora le scadenze (db/12_scadenze.sql)
  // si legge senza
  async function giornataCorrente() {
    const base = 'id,label,deadline,first_kickoff,last_kickoff,closes_at';
    try { return (await SB.select('matchdays', 'select=' + base + ',scadenza,scadenza_auto,scadenza_admin&is_current=is.true&limit=1'))[0] || null; }
    catch (e) { return (await SB.select('matchdays', 'select=' + base + '&is_current=is.true&limit=1'))[0] || null; }
  }

  // Entra: profilo, giornata, calendario; poi la formazione della propria squadra
  // (o, per l'amministratore, di quella indicata)
  async function startOnline(teamId) {
    clearNotices();
    const uid = (SB.user() || {}).id || ((await SB.me()) || {}).id;
    const prof = (await SB.select('profiles', 'select=display_name,role,team_id,teams(name,sheet_name)&id=eq.' + uid))[0];
    if (!prof) throw new SB.SbError('Profilo non trovato: scrivi all’amministratore.', 'no_profile');
    S.profile = prof;
    S.mioTeam = prof.teams ? Object.assign({ id: prof.team_id }, prof.teams) : null;
    if (!S.mioTeam && !isAdmin()) throw new SB.SbError('Questo account non è ancora collegato a una squadra: scrivi all’amministratore.', 'no_team');
    S.mode = 'online';
    S.matchday = await giornataCorrente();
    S.closed = !!(S.matchday && new Date(closeTime(S.matchday)) <= new Date());
    S.fixtures = S.matchday
      ? await SB.select('fixtures', 'select=id,home,away,kickoff,status&matchday=eq.' + S.matchday.id + '&order=kickoff')
      : [];
    // se il database della stagione c'è, da lì arriva la numerazione della lega
    try { S.rounds = await SB.select('rounds', 'select=id,serie_a&order=id'); } catch (e) { S.rounds = []; }
    S.teams = [];
    if (isAdmin()) {
      try { S.teams = await SB.select('teams', 'select=id,name,sheet_name&order=name'); } catch (e) { S.teams = []; }
      riempiSquadre();
    }
    if (!S.mioTeam) throw new SB.SbError('Questo account non è ancora collegato a una squadra: scrivi all’amministratore.', 'no_team');
    S.mia = null;
    await caricaSquadra(teamId && teamId !== S.mioTeam.id ? teamId : S.mioTeam.id, true);
  }

  // il menu "Formazione di" per l'amministratore: la sua squadra e, sotto, le altre
  function riempiSquadre() {
    const sel = $('#sheetSel');
    if (!sel || !S.mioTeam) return;
    const lbl = $('#teamField label');
    if (lbl) lbl.textContent = 'Formazione di';
    const altre = S.teams.filter(t => t.id !== S.mioTeam.id);
    sel.innerHTML = `<option value="${esc(S.mioTeam.id)}">${esc(S.mioTeam.name)} (la tua)</option>` +
      (altre.length ? `<optgroup label="Come amministratore">${altre.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</optgroup>` : '');
  }

  // Carica rosa e formazione di una squadra. La propria: con blocchi e scadenze. Un'altra
  // (solo l'amministratore): senza, e quando salva la modifica diventa pubblica.
  async function caricaSquadra(teamId, inizio) {
    const mia = !S.mioTeam || teamId === S.mioTeam.id;
    if (!mia && !isAdmin()) return;
    if (!mia && !S.adm) S.mia = { roster: S.roster, savedAt: S.savedAt, vuoti: S.vuoti };   // la propria, per il sito
    if (mia) S.mia = null;
    S.adm = !mia;
    S.team = mia ? S.mioTeam : S.teams.find(t => t.id === teamId);
    if (!S.team) { S.adm = false; S.team = S.mioTeam; }
    S.sheet = S.team.sheet_name || S.team.name;
    if ($('#sheetSel') && isAdmin()) $('#sheetSel').value = S.team.id;
    if (!inizio) { clearNotices(); closeSheet(); }
    const players = await SB.select('players', 'select=id,slot,role,name,club&team_id=eq.' + S.team.id + '&slot=not.is.null&order=slot');
    S.roster = rosterFromDb(players);
    S.starters = Array(11).fill(null); S.bench = Array(7).fill(null); S.extra = Array(4).fill(null);
    S.savedAt = null; S.vuoti = []; S.modifiche = []; S.lineupId = null;
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
        S.lineupId = l.id;
        // posti rimasti vuoti perché il giocatore non è più in rosa (mercato): da rifare
        try { S.vuoti = await SB.select('lineup_vuoti', 'select=pos,nome,ruolo,motivo&lineup_id=eq.' + l.id + '&order=pos'); }
        catch (e) { S.vuoti = []; }
      }
      S.modifiche = await modificheAdmin(S.team.id, S.matchday.id);
    }
    S.base = numMap(); S.baseMod = S.module;
    show('#uploadCard', false);
    show('#fileBar', true);
    show('#onlineTools', true);
    show('#restoreBtn', true);
    $('#freeToggle').checked = S.free;
    avvisiSquadra();
    startTicker();
    render();
    avvisaSito();
  }

  // le modifiche dell'amministratore a una formazione (pubbliche); senza db/12 nessuna
  async function modificheAdmin(teamId, md) {
    try {
      return await SB.select('lineup_log', 'select=at,changes,nota,autore&team_id=eq.' + teamId + '&matchday=eq.' + md + '&da_admin=is.true&order=at.desc');
    } catch (e) { return []; }
  }
  function testoModifica(m, tua) {
    const list = changesText(m.changes);
    const t = (tua ? 'L’amministratore' : 'Modifica dell’amministratore') + (m.autore ? ' (' + m.autore + ')' : '') +
      (tua ? ' ha modificato la tua formazione il ' : ' del ') + fmtDate(m.at) + (list.length ? ': ' + list.join(' · ') : '');
    return t.replace(/\.$/, '') + '.' + (m.nota ? ' Nota: «' + m.nota + '».' : '');
  }

  function avvisiSquadra() {
    if (!S.matchday) { notice('Nessuna giornata aperta: l’amministratore deve aggiornare il calendario.'); return; }
    if (S.adm) {
      notice('Stai modificando la formazione di ' + S.team.name + ' come amministratore: blocchi e scadenze non valgono. Quando salvi, la modifica compare a tutti sulla pagina della sua formazione, con il tuo nome e una nota.',
        'warn', 'Torna alla tua', () => caricaSquadra(S.mioTeam.id));
      if (S.modifiche.length) notice(testoModifica(S.modifiche[0], false));
      return;
    }
    if (S.modifiche.length) {
      notice(testoModifica(S.modifiche[0], true) + (S.modifiche.length > 1 ? ' (' + S.modifiche.length + ' modifiche in tutto: le trovi in Storico modifiche)' : ''), 'warn');
    }
    if (S.closed) { notice('Giornata finita il ' + fmtDate(closeTime(S.matchday)) + ': la formazione non si può più cambiare.'); return; }
    if (scaduta()) return;            // lo dice il riquadro della scadenza, in cima
    const scad = scadOf(S.matchday);
    if (S.vuoti.length) notice(testoVuoti(), 'warn');
    else if (S.savedAt) notice('Formazione salvata il ' + fmtDate(S.savedAt) + '. Puoi cambiarla ' + (scad ? 'fino a ' + fmtDate(scad) : 'finché la giornata è aperta') + ': ogni giocatore si blocca 30 minuti prima della sua partita.');
    // chi è già bloccato, in un avviso solo: e, se è in panchina, chi del suo reparto lo
    // precede (e non è a sua volta bloccato) resta fermo
    const bloccati = lockedRows().filter(r => placeOf(r)).sort((x, y) => S.base.get(x) - S.base.get(y));
    if (bloccati.length) {
      const nomi = elenco(bloccati.map(r => P(r).name));
      let t = nomi + (bloccati.length === 1 ? ' è già bloccato e resta dov\u2019è' : ' sono già bloccati e restano dove sono') +
        ' (la partita è iniziata o inizia fra meno di 30 minuti).';
      [...S.base.entries()].filter(([r, n]) => n >= 12 && isLocked(r)).sort((x, y) => x[1] - y[1]).forEach(([r, n]) => {
        const ro = P(r).role;
        const liberi = [...S.base.entries()].filter(([x, k]) => k < n && P(x).role === ro && !isLocked(x)).sort((x, y) => x[1] - y[1]).map(([x]) => P(x).name);
        if (!liberi.length) return;
        const tit = ro !== 'P' && MODULES.includes(S.baseMod) ? counts(S.baseMod)[ro] : null;
        t += ' ' + P(r).name + ' è in ' + (n >= 19 ? 'panchina extra' : 'panchina') + ' (' + n + '): ' + elenco(liberi) +
          (liberi.length === 1 ? ', messo prima di lui, non si può togliere' : ', messi prima di lui, si possono solo scambiare fra loro') +
          (tit != null ? ' e i titolari ' + REPARTO[ro] + ' restano ' + tit : '') + '.';
      });
      notice(t);
    }
    const senza = S.roster.filter(p => p.name && !p.club).length;
    if (senza && S.fixtures.length && isAdmin())
      notice(senza + ' giocatori senza squadra di Serie A: si bloccano tutti 30 minuti prima della prima partita della giornata.', '', 'Sistema', clubsSheet);
  }

  // "La tua formazione ha un posto vuoto: Contini è stato svincolato."
  const PERCHE = { svincolato: 'è stato svincolato', ceduto: 'è stato ceduto a un’altra squadra', 'fuori rosa': 'non è più in rosa', annullata: 'non è più in rosa (operazione di mercato annullata)' };
  function testoVuoti() {
    const n = S.vuoti.length;
    const chi = S.vuoti.map(v => v.nome + ' ' + (PERCHE[v.motivo] || PERCHE['fuori rosa'])).join('; ');
    return (n === 1 ? 'La tua formazione ha un posto vuoto: ' : 'La tua formazione ha ' + n + ' posti vuoti: ') + chi +
      '. Completala e salvala di nuovo, poi scarica il file .xls e mandalo all\u2019amministratore.';
  }

  async function saveOnline(nota) {
    const slots = [];
    S.starters.forEach((r, i) => { if (r != null && P(r).id) slots.push({ pos: i + 1, player_id: P(r).id }); });
    S.bench.forEach((r, i) => { if (r != null && P(r).id) slots.push({ pos: 12 + i, player_id: P(r).id }); });
    S.extra.forEach((r, i) => { if (r != null && P(r).id) slots.push({ pos: 19 + i, player_id: P(r).id }); });
    // l'amministratore che modifica un'altra squadra: senza blocchi, con la nota pubblica
    if (S.adm) return SB.rpc('admin_save_lineup', {
      p_team: S.team.id, p_matchday: S.matchday.id, p_module: S.module, p_bench_free: S.free, p_slots: slots, p_nota: nota || null
    });
    return SB.rpc('save_lineup', {
      p_matchday: S.matchday.id, p_module: S.module, p_bench_free: S.free, p_slots: slots
    });
  }

  // prima di salvare la formazione di un'altra squadra: la nota che vedranno tutti
  function chiediNota(fatto) {
    const el = sheet(`
      <div class="sheet-h"><div><h4>Modifica dell\u2019amministratore</h4><p>${esc(S.team.name)} · ${esc(nomeGiornata(S.matchday))}</p></div></div>
      <div class="sheet-b"><div style="padding:12px 16px;display:grid;gap:10px">
        <p style="margin:0">La modifica compare a tutti sulla pagina della formazione di <b>${esc(S.team.name)}</b>, con il tuo nome e questa nota; ${esc(S.team.name)} la vede anche in Schiera.</p>
        <label class="small muted" for="admNota">Nota (facoltativa)</label>
        <textarea id="admNota" rows="3" maxlength="300" placeholder="Es.: formazione comunicata su WhatsApp alle 11.40" style="padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);color:inherit;font:inherit;resize:vertical"></textarea>
      </div></div>
      <div class="sheet-f"><button type="button" class="btn btn-ghost" data-act="close">Annulla</button><button type="button" class="btn btn-primary" data-act="go">Salva la modifica</button></div>`);
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      const nota = el.querySelector('#admNota').value.trim();
      closeSheet();
      if (b.dataset.act === 'go') fatto(nota);
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
        <div><h4>${res.da_admin ? 'Modifica salvata' : 'Formazione salvata'}</h4><p>${esc(S.team.name)} · ${esc(nomeGiornata(S.matchday))} · ${esc(S.module)}</p></div></div></div>
      <div class="sheet-b">
        <p style="margin:12px 16px 0">${res.da_admin
          ? `Modifica dell\u2019amministratore registrata: la vedono tutti nella pagina Formazioni, ${esc(S.team.name)} anche in Schiera.`
          : (res.action === 'creata' ? 'Registrata adesso.' : 'Ho aggiornato quella di prima.') + ' <b>Ora scarica il file .xls e mandalo all\u2019amministratore</b>, come sempre (WhatsApp o e-mail).'}</p>
        ${list.length ? `<div class="xl">${list.map(t => `<div class="xr" style="grid-template-columns:1fr">${esc(t)}</div>`).join('')}</div>` : ''}
        <div class="xl" aria-label="Formazione salvata">
          <div class="xh">Titolari</div>${[1,2,3,4,5,6,7,8,9,10,11].map(line).join('')}
          <div class="xh">Riserve</div>${[12,13,14,15,16,17,18].map(line).join('')}
          <div class="xh">Panchina extra</div>${[19,20,21,22].map(line).join('')}
        </div>
      </div>
      <div class="sheet-f"><button type="button" class="btn btn-ghost" data-act="close">Dopo</button><button type="button" class="btn btn-primary" data-act="export">Scarica il file .xls</button></div>`);
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
      if (!S.adm) SB.rpc('log_export', { p_matchday: S.matchday.id }).catch(() => {});
      showResult(res, d);
    } catch (e) {
      console.error(e);
      notice(e && e.message ? e.message : 'Export non riuscito.', 'error');
    }
  }

  async function showLog() {
    try {
      const q = '&team_id=eq.' + S.team.id + '&matchday=eq.' + S.matchday.id + '&order=at.desc&limit=30';
      let rows;
      try { rows = await SB.select('lineup_log', 'select=at,action,changes,da_admin,autore,nota' + q); }
      catch (e) { rows = await SB.select('lineup_log', 'select=at,action,changes' + q); }
      const body = rows.length ? rows.map(r => {
        const list = changesText(r.changes);
        const chi = r.da_admin ? ` · <b class="adm">dall\u2019amministratore${r.autore ? ' (' + esc(r.autore) + ')' : ''}</b>` : '';
        return `<div class="xr${r.da_admin ? ' da-admin' : ''}" style="grid-template-columns:1fr"><div><b>${esc(fmtDate(r.at))}</b> · ${esc(r.action)}${chi}<div class="muted small">${list.length ? esc(list.join(' · ')) : 'nessun dettaglio'}${r.nota ? '<br>Nota: «' + esc(r.nota) + '»' : ''}</div></div></div>`;
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
      players = await SB.select('players', 'select=id,name,role,club,team_id,teams(name)&slot=not.is.null&order=name');
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

  // La scadenza della formazione completa della giornata corrente: di norma dal calendario
  // (domenica 12.00, mercoledì 20.00); qui l'amministratore la sposta per una giornata.
  function askScadenza() {
    const md = S.matchday;
    if (!md) { notice('Nessuna giornata aperta: prima aggiorna il calendario.'); return; }
    if (!('scadenza' in md)) { notice('Nel database mancano le scadenze: esegui db/12_scadenze.sql nel SQL Editor di Supabase.', 'error'); return; }
    const loc = t => new Date(ms(t) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const auto = md.scadenza_auto, scelta = md.scadenza_admin;
    const el = sheet(`
      <div class="sheet-h"><div><h4>Scadenza delle formazioni</h4><p>${esc(nomeGiornata(md))}</p></div></div>
      <div class="sheet-b"><div style="padding:12px 16px;display:grid;gap:10px">
        <p style="margin:0">Dopo la scadenza nessuno può più cambiare la formazione (tu sì, come amministratore). Prima, ogni giocatore si blocca 30 minuti prima della sua partita.</p>
        <p class="small muted" style="margin:0">Dal calendario: <b>${auto ? esc(fmtDate(auto)) : '—'}</b> (domenica alle 12 nei turni del weekend, mercoledì alle 20 in quelli infrasettimanali)${scelta ? `<br>Adesso vale quella scelta da te: <b>${esc(fmtDate(scelta))}</b>` : ''}</p>
        <label class="small muted" for="scadVal">Scadenza di questa giornata</label>
        <input id="scadVal" type="datetime-local" value="${md.scadenza ? loc(md.scadenza) : ''}" style="padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)">
      </div></div>
      <div class="sheet-f">${scelta ? '<button type="button" class="btn btn-ghost" data-act="auto">Torna a quella del calendario</button>' : '<button type="button" class="btn btn-ghost" data-act="close">Annulla</button>'}<button type="button" class="btn btn-primary" data-act="go">Salva</button></div>`);
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') { closeSheet(); return; }
      const v = el.querySelector('#scadVal').value;
      if (b.dataset.act === 'go' && !v) { toast('Scegli giorno e ora'); return; }
      b.disabled = true;
      try {
        const r = await SB.rpc('set_scadenza', { p_matchday: md.id, p_scadenza: b.dataset.act === 'auto' ? null : new Date(v).toISOString() });
        closeSheet();
        await startOnline(S.adm ? S.team.id : null);
        notice('Scadenza di ' + nomeGiornata(md) + ': ' + (r && r.scadenza ? fmtDate(r.scadenza) : '—') + (b.dataset.act === 'auto' ? ' (dal calendario).' : '.'));
      } catch (e) { b.disabled = false; notice(e.message || 'Non riesco a cambiare la scadenza.', 'error'); }
    });
  }

  // Per l'amministratore: di quale squadra modificare la formazione
  function scegliSquadra() {
    if (!isAdmin()) return;
    const altre = S.teams.filter(t => !S.mioTeam || t.id !== S.mioTeam.id);
    if (!altre.length) { notice('Non trovo le altre squadre della lega.', 'error'); return; }
    const el = sheet(`
      <div class="sheet-h"><div><h4>Modifica una formazione</h4><p>Come amministratore: blocchi e scadenze non valgono, la modifica diventa pubblica.</p></div></div>
      <div class="sheet-b">${altre.map(t => `<button type="button" class="row" data-sq="${esc(t.id)}"><span class="badge any">·</span><span class="who">${esc(t.name)}</span><span class="chev">›</span></button>`).join('')}</div>
      <div class="sheet-f"><button type="button" class="btn btn-primary" data-act="close">Chiudi</button></div>`);
    el.addEventListener('click', ev => {
      if (ev.target.closest('[data-act="close"]')) { closeSheet(); return; }
      const b = ev.target.closest('[data-sq]');
      if (b) { closeSheet(); caricaSquadra(b.dataset.sq).catch(e => notice(e.message || 'Non riesco a caricare la squadra.', 'error')); }
    });
  }

  // ------------------------------------------------------------- nuova password
  // dal link dell'email (obbligatoria) oppure dal menu "Cambia password" (si può annullare)
  function askNewPassword(fatto, opts) {
    const libera = !!(opts && opts.annullabile);
    const el = sheet(`
      <div class="sheet-h"><div><h4>${libera ? 'Cambia password' : 'Nuova password'}</h4><p>Scegline una di almeno 8 caratteri.</p></div></div>
      <div class="sheet-b"><div style="padding:12px 16px"><input id="newPwd" type="password" autocomplete="new-password" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)"></div></div>
      <div class="sheet-f">${libera ? '<button type="button" class="btn btn-ghost" data-act="close">Annulla</button>' : ''}<button type="button" class="btn btn-primary" data-act="set">Salva password</button></div>`, libera ? {} : { modal: true });
    el.addEventListener('click', async ev => {
      if (ev.target.closest('[data-act="close"]')) { closeSheet(); return; }
      if (!ev.target.closest('[data-act="set"]')) return;
      const pwd = el.querySelector('#newPwd').value;
      if (!pwd || pwd.length < 8) { toast('Almeno 8 caratteri'); return; }
      try { await SB.setPassword(pwd); closeSheet(); toast('Password aggiornata'); if (fatto) await fatto(); else if (!libera) await startOnline(); }
      catch (e) { notice(e.message || 'Non riesco a cambiare la password.', 'error'); }
    });
  }

  function slotHtml(i, ro) {
    const r = S.starters[i];
    const dis = canEdit() ? '' : 'disabled';
    if (r == null) return `<button type="button" class="slot empty" data-z="s" data-i="${i}" data-r="${ro}" ${dis} aria-label="${i + 1}: scegli ${ROLE[ro]}"><span class="token">${ro}</span><span class="nm">${i + 1} · ${ROLE[ro].slice(0, 3)}.</span></button>`;
    const lk = isLocked(r), gi = !lk && S.adm && giocato(r);
    return `<button type="button" class="slot${lk ? ' locked' : ''}${gi ? ' giocato' : ''}" data-z="s" data-i="${i}" data-r="${ro}" ${lk ? 'disabled' : dis} aria-label="${i + 1}: ${esc(P(r).name)}${lk || gi ? ', bloccato' : ''}"><span class="token">${lk ? '●' : i + 1}</span><span class="nm">${esc(P(r).name)}</span></button>`;
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
    const p = P(r), lk = isLocked(r), gi = !lk && S.adm && giocato(r);
    return `<button type="button" class="row${lk ? ' locked' : ''}${gi ? ' giocato' : ''}" data-z="${z}" data-i="${i}" ${lk ? 'disabled' : dis}><span class="num">${num}</span><span class="badge" data-r="${p.role}">${p.role}</span><span class="who">${esc(p.name)}</span>${lk ? '<span class="tag">bloccato</span>' : gi ? '<span class="tag">già bloccato</span>' : '<span class="chev">›</span>'}</button>`;
  }

  function flash(pl) {
    if (!pl) return;
    const el = $(`[data-z="${pl.z}"][data-i="${pl.i}"]`);
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }

  // ------------------------------------------------------------ picker
  function openPicker(z, i) {
    const ro = slotRole(z, i), num = slotNum(z, i), cur = arr(z)[i];
    const cands = S.roster.filter(p => p.name && (!ro || p.role === ro));
    const order = p => { const pl = placeOf(p.row); return pl ? (pl.z === z && pl.i === i ? 0 : 2) : 1; };
    cands.sort((a, b) => order(a) - order(b) || 'PDCA'.indexOf(a.role) - 'PDCA'.indexOf(b.role) || a.row - b.row);
    // chi è libero ma non può andare qui: un panchinaro bloccato lo tiene fermo (o tiene
    // fermo chi c'è adesso in questo posto)
    const info = cands.map(p => {
      const pl = placeOf(p.row);
      const here = !!(pl && pl.z === z && pl.i === i);
      const lk = isLocked(p.row);
      return { p, pl, here, lk, gi: !lk && S.adm && giocato(p.row), no: !lk && !here ? prova(() => assign(z, i, p.row)) : null };
    });
    const rows = info.map(({ p, pl, here, lk, gi, no }) => {
      const tag = lk ? `<span class="tag">bloccato${p.club ? ' · ' + esc(p.club) : ''}</span>`
        : no ? `<span class="tag">fermo per ${esc(P(no.row).name)}</span>`
        : here ? '<span class="tag here">qui</span>'
        : pl ? `<span class="tag">${zoneName(pl.z)} ${slotNum(pl.z, pl.i)} · scambia${gi ? ' · già bloccato' : ''}</span>`
        : gi ? '<span class="tag">già bloccato</span>' : '';
      return `<button type="button" class="row${lk || no ? ' locked' : ''}" data-pick="${p.row}" ${lk || no ? 'disabled' : ''}${no ? ` title="${esc(testoProblema(no))}"` : ''}><span class="badge" data-r="${p.role}">${p.role}</span><span class="who">${esc(p.name)}</span>${tag}</button>`;
    }).join('') || '<p class="muted" style="padding:12px 16px">Nessun giocatore disponibile per questo ruolo.</p>';
    // la spiegazione, se qualcuno è fermo per un panchinaro bloccato
    const fermo = (info.find(x => x.no && x.no.tipo === 'reparto') || {}).no;
    const spiega = fermo ? `<p class="muted small spiega">${esc(testoProblema(fermo))}.</p>` : '';
    const svuota = cur != null && !isLocked(cur) && !prova(() => { arr(z)[i] = null; });
    const title = `${num} · ${ro ? ROLE[ro] : 'Qualsiasi ruolo'}`;
    const sub = z === 's' ? 'Titolare' : z === 'b' ? 'Riserva — entra in ordine di numero' : 'Panchina extra';
    const el = sheet(`
      <div class="sheet-h"><div><h4>${esc(title)}</h4><p>${sub}</p></div></div>
      <div class="sheet-b">${spiega}${rows}</div>
      <div class="sheet-f">${svuota ? '<button type="button" class="btn btn-ghost" data-act="clear">Svuota posto</button>' : ''}<button type="button" class="btn btn-primary" data-act="close">Chiudi</button></div>`);
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
    $('#schLayer').appendChild(scrim);
    const f = scrim.querySelector('button');
    if (f) f.focus({ preventScroll: true });
    return scrim.firstElementChild;
  }
  function closeSheet() { $('#schLayer').innerHTML = ''; }

  // ------------------------------------------------------------ avvisi
  function clearNotices() { $('#schNotices').innerHTML = ''; }
  function notice(text, kind, actLabel, act) {
    const d = document.createElement('div');
    d.className = 'notice' + (kind === 'error' ? ' error' : kind === 'warn' ? ' forte' : '');
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
    $('#schNotices').appendChild(d);
  }
  let toastT;
  function toast(t) {
    if (S.muto) return;
    document.querySelectorAll('.toast').forEach(x => x.remove());
    const d = document.createElement('div');
    d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = t;
    document.body.appendChild(d);
    clearTimeout(toastT); toastT = setTimeout(() => d.remove(), Math.max(2600, Math.min(7000, t.length * 55)));
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

  async function doSave(nota) {
    if (online()) {
      if (S.adm && nota === undefined) { chiediNota(n => doSave(n)); return; }
      const btn = $('#saveBtn');
      btn.disabled = true;
      try {
        const res = await saveOnline(nota);
        S.savedAt = new Date().toISOString();
        S.vuoti = [];          // salvata di nuovo: il database toglie l'avviso
        S.base = numMap(); S.baseMod = S.module;     // da qui si contano le regole sui bloccati
        if (res && res.da_admin) S.modifiche.unshift({ at: S.savedAt, changes: res.changes, nota: nota || null, autore: S.profile && S.profile.display_name });
        clearNotices();
        showSaved(res);
        avvisaSito();
      } catch (e) {
        console.error(e);
        notice(e && e.message ? e.message : 'Salvataggio non riuscito.', 'error');
        if (e && e.code === 'P0002') { S.closed = true; }
        // la scadenza è passata (o l'amministratore l'ha anticipata): da qui è chiusa
        if (e && e.code === 'P0008' && S.matchday) { S.matchday.scadenza = new Date().toISOString(); }
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
    show('#restoreBtn', true);

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
      head = 'File scaricato';
      body = `<b>${esc(d.name)}</b> è nella cartella dei download (Download, oppure File → Download sull’iPhone). Mandalo all'amministratore come sempre: WhatsApp o e-mail.`;
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
      <div class="sheet-f"><button type="button" class="btn btn-primary" data-act="close">Fatto</button></div>`);
    // niente "Condividi": la condivisione di un .xls dal browser funziona solo in pochi casi
    // (Chrome la rifiuta per questo tipo di file, Firefox non ce l'ha, le app di chat la bloccano)
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') closeSheet();
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
  on('#exportBtn', 'click', () => exportXls());
  on('#adminFile', 'change', e => { const f = e.target.files[0]; e.target.value = ''; importRosters(f); });
  // dentro il sito le formazioni di tutti stanno in Giornata → Formazioni
  on('#allBtn', 'click', () => { if (EMBED) location.hash = '#/giornata/formazioni'; else showAll(); });
  on('#logBtn', 'click', () => showLog());
  on('#pickBtn', 'click', () => $('#fileInput').click());
  on('#changeFileBtn2', 'click', () => { toggleMenu(false); $('#fileInput').click(); });
  on('#fileInput', 'change', e => handleFile(e.target.files[0]));
  const up = $('#uploadCard');
  if (up) {
    ['dragenter', 'dragover'].forEach(t => up.addEventListener(t, e => { e.preventDefault(); up.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(t => up.addEventListener(t, e => { e.preventDefault(); up.classList.remove('drag'); }));
    up.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
  }
  on('#sheetSel', 'change', e => {
    // online: l'amministratore sceglie di quale squadra modificare la formazione
    if (online()) { caricaSquadra(e.target.value).catch(err => notice(err.message || 'Non riesco a caricare la squadra.', 'error')); return; }
    const p = prefs(); p.lastSheet = e.target.value; setPrefs(p); loadSheet(e.target.value);
  });

  on('#modules', 'click', e => { const b = e.target.closest('[data-mod]'); if (!b) return; guarded(() => setModule(b.dataset.mod)); render(); });
  on('#editor', 'click', e => {
    const s = e.target.closest('[data-z]');
    if (s && canEdit()) { openPicker(s.dataset.z, +s.dataset.i); return; }
    const a = e.target.closest('[data-add]');
    if (a && canEdit()) {
      const row = +a.dataset.add;
      if (isLocked(row)) { toast(P(row).name + ' è già bloccato: la sua partita è iniziata o inizia fra meno di 30 minuti'); return; }
      const { pl, no } = autoPlaceOk(row);
      if (!pl) { toast(no ? testoProblema(no) : 'Nessun posto libero per un ' + ROLE[P(row).role].toLowerCase()); return; }
      render(); flash(pl);
    }
  });
  on('#saveBtn', 'click', onSave);

  // menu "Opzioni": c'è solo nella versione a sé
  function toggleMenu(open) {
    const pop = $('#menuPop');
    if (!pop) return;
    pop.hidden = open === undefined ? !pop.hidden : !open;
    $('#menuBtn').setAttribute('aria-expanded', String(!pop.hidden));
  }
  on('#menuBtn', 'click', e => { e.stopPropagation(); toggleMenu(); });
  if ($('#menuWrap')) document.addEventListener('click', e => { if (!e.target.closest('#menuWrap')) toggleMenu(false); });
  on('#freeToggle', 'change', e => {
    if (!guarded(() => setFree(e.target.checked))) e.target.checked = S.free;
    render();
  });
  on('#restoreBtn', 'click', () => { online() ? restoreOnline() : restoreSaved(); });
  on('#clearBtn', 'click', () => {
    // chi è già bloccato resta al suo posto, e con lui chi del suo reparto lo precede
    let restano = 0;
    ['s', 'b', 'e'].forEach(z => {
      // arr(z) ogni volta: le prove rimettono a posto la formazione con array nuovi
      for (let i = 0; i < arr(z).length; i++) {
        const r = arr(z)[i];
        if (r == null) continue;
        if (isLocked(r) || prova(() => { arr(z)[i] = null; })) { restano++; continue; }
        arr(z)[i] = null;
      }
    });
    render();
    toast(restano ? 'Svuotata, tranne chi è già bloccato e chi lo precede nel reparto' : 'Formazione svuotata');
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!ROOT.querySelector('.scrim[data-modal]')) closeSheet(); toggleMenu(false); } });

  // ------------------------------------------------------------ dentro il sito
  // Il sito della lega fa entrare, cambia sezione ed esce; Schiera gli dice
  // quando cambia qualcosa (giornata, formazione salvata) con onCambio.
  function reset() {
    clearInterval(tick);
    S.team = null; S.profile = null; S.matchday = null; S.fixtures = []; S.roster = []; S.savedAt = null; S.vuoti = []; S.closed = false;
    S.mioTeam = null; S.adm = false; S.mia = null; S.teams = []; S.modifiche = []; S.base = new Map();
    S.starters = Array(11).fill(null); S.bench = Array(7).fill(null); S.extra = Array(4).fill(null);
    closeSheet(); clearNotices();
    show('#fileBar', false); show('#onlineTools', false); show('#restoreBtn', false);
    render();
  }
  let avvio = null;
  window.Schiera = {
    onCambio: null,
    // carica rosa, giornata e formazione salvata dell'account con cui si è entrati
    avvia() {
      avvio = (async () => {
        try { await startOnline(); return true; }
        catch (e) {
          console.error(e);
          reset();
          notice(e && e.message ? e.message : 'Non riesco a caricare la tua rosa.', 'error');
          avvisaSito();
          return false;
        }
      })();
      return avvio;
    },
    pronta: () => !!S.team,
    mostra(si) {
      show('#app', si); show('#bar', si);
      if (si && !S.team && !avvio && window.SB && SB.session()) window.Schiera.avvia();
      if (si) renderConto();
    },
    esci() { avvio = null; reset(); avvisaSito(); },
    scadenza,
    pezzi,
    // sempre della propria squadra, anche mentre l'amministratore ne modifica un'altra
    salvata: () => !!(S.adm ? S.mia && S.mia.savedAt : S.savedAt),
    // formazione salvata con posti rimasti vuoti (giocatore svincolato): da rifare
    daRifare: () => !!(S.adm ? S.mia && S.mia.vuoti.length : S.vuoti.length),
    // per il sito: scaricare un file con lo stesso meccanismo dell'export (anche nel visore)
    scarica: (bytes, nome) => deliver(bytes, nome),
    giornata: () => S.matchday ? nomeGiornata(S.matchday) : '',
    admin: {
      rose: () => $('#adminFile').click(),
      calendario: () => syncCalendar(),
      squadre: () => clubsSheet(),
      giornata: () => askMatchday(),
      scadenza: async () => { if (avvio) await avvio; askScadenza(); },
      formazione: async () => { if (avvio) await avvio; scegliSquadra(); },
      // dalla pagina Formazioni del sito: modifica la formazione di quella squadra
      modifica: async teamId => { if (avvio) await avvio; if (S.team) await caricaSquadra(teamId); }
    },
    nuovaPassword: (fatto, opts) => askNewPassword(fatto, opts)
  };

  // Avvio. Nella versione a sé (offline) si lavora sul file .xls; dentro il sito
  // si aspetta che il sito faccia entrare l'utente.
  if (EMBED) { show('#app', false); show('#bar', false); }
  else show('#uploadCard', true);
  render();
})();
