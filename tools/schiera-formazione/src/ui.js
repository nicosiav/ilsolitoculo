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
    bytes: null, fileName: '', wb: null, sheet: null, roster: [],
    module: '3-4-3', free: false,
    starters: Array(11).fill(null), bench: Array(7).fill(null), extra: Array(4).fill(null)
  };

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
    const ready = !!S.wb;
    // moduli
    $('#modules').innerHTML = MODULES.map(m => `<button type="button" class="chip" data-mod="${m}" aria-pressed="${m === S.module}" ${ready ? '' : 'disabled'}>${m}</button>`).join('');
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
      return `<div class="pool-group">${l.map(p => `<button type="button" class="pchip" data-add="${p.row}" data-r="${p.role}"><span class="badge">${p.role}</span>${esc(p.name)}</button>`).join('')}</div>`;
    }).join('');
    // barra
    const n = S.starters.filter(x => x != null).length + S.bench.filter(x => x != null).length + S.extra.filter(x => x != null).length;
    const st = S.starters.filter(x => x != null).length;
    $('#count').textContent = n + '/22';
    $('#countLbl').textContent = st === 11 ? 'schierati' : 'titolari ' + st + '/11';
    $('#saveBtn').disabled = !ready || n === 0;
    $('#editor').style.opacity = ready ? '' : '.55';
    $('#sub').textContent = ready ? S.sheet + ' · ' + S.module : 'formazione dal file .xls della lega';
  }

  function slotHtml(i, ro) {
    const r = S.starters[i];
    const dis = S.wb ? '' : 'disabled';
    if (r == null) return `<button type="button" class="slot empty" data-z="s" data-i="${i}" data-r="${ro}" ${dis} aria-label="${i + 1}: scegli ${ROLE[ro]}"><span class="token">${ro}</span><span class="nm">${i + 1} · ${ROLE[ro].slice(0, 3)}.</span></button>`;
    return `<button type="button" class="slot" data-z="s" data-i="${i}" data-r="${ro}" aria-label="${i + 1}: ${esc(P(r).name)}"><span class="token">${i + 1}</span><span class="nm">${esc(P(r).name)}</span></button>`;
  }
  function rowHtml(z, i, r) {
    const ro = slotRole(z, i);
    const num = slotNum(z, i);
    const dis = S.wb ? '' : 'disabled';
    if (r == null) {
      const badge = ro ? `<span class="badge" data-r="${ro}">${ro}</span>` : `<span class="badge any">·</span>`;
      const label = ro ? 'Scegli ' + ROLE[ro].toLowerCase() : 'Scegli giocatore';
      return `<button type="button" class="row empty" data-z="${z}" data-i="${i}" ${dis}><span class="num">${num}</span>${badge}<span class="who">${label}</span><span class="chev">›</span></button>`;
    }
    const p = P(r);
    return `<button type="button" class="row" data-z="${z}" data-i="${i}"><span class="num">${num}</span><span class="badge" data-r="${p.role}">${p.role}</span><span class="who">${esc(p.name)}</span><span class="chev">›</span></button>`;
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
      const tag = here ? '<span class="tag here">qui</span>' : pl ? `<span class="tag">${zoneName(pl.z)} ${slotNum(pl.z, pl.i)} · scambia</span>` : '';
      return `<button type="button" class="row" data-pick="${p.row}"><span class="badge" data-r="${p.role}">${p.role}</span><span class="who">${esc(p.name)}</span>${tag}</button>`;
    }).join('') || '<p class="muted" style="padding:12px 16px">Nessun giocatore disponibile per questo ruolo.</p>';
    const title = `${num} · ${ro ? ROLE[ro] : 'Qualsiasi ruolo'}`;
    const sub = z === 's' ? 'Titolare' : z === 'b' ? 'Riserva — entra in ordine di numero' : 'Panchina extra';
    const el = sheet(`
      <div class="sheet-h"><div><h4>${esc(title)}</h4><p>${sub}</p></div></div>
      <div class="sheet-b">${rows}</div>
      <div class="sheet-f">${cur != null ? '<button type="button" class="btn btn-ghost" data-act="clear">Svuota posto</button>' : ''}<button type="button" class="btn btn-primary" data-act="close">Chiudi</button></div>`);
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-pick],[data-act]');
      if (!b) return;
      if (b.dataset.act === 'clear') { arr(z)[i] = null; closeSheet(); render(); return; }
      if (b.dataset.act === 'close') { closeSheet(); return; }
      assign(z, i, +b.dataset.pick);
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
  $('#pickBtn').addEventListener('click', () => $('#fileInput').click());
  $('#changeFileBtn2').addEventListener('click', () => { toggleMenu(false); $('#fileInput').click(); });
  $('#fileInput').addEventListener('change', e => handleFile(e.target.files[0]));
  const up = $('#uploadCard');
  ['dragenter', 'dragover'].forEach(t => up.addEventListener(t, e => { e.preventDefault(); up.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(t => up.addEventListener(t, e => { e.preventDefault(); up.classList.remove('drag'); }));
  up.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
  $('#sheetSel').addEventListener('change', e => { const p = prefs(); p.lastSheet = e.target.value; setPrefs(p); loadSheet(e.target.value); });

  $('#modules').addEventListener('click', e => { const b = e.target.closest('[data-mod]'); if (!b) return; setModule(b.dataset.mod); render(); });
  $('#editor').addEventListener('click', e => {
    const s = e.target.closest('[data-z]');
    if (s && S.wb) { openPicker(s.dataset.z, +s.dataset.i); return; }
    const a = e.target.closest('[data-add]');
    if (a && S.wb) {
      const row = +a.dataset.add;
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
  $('#freeToggle').addEventListener('change', e => { setFree(e.target.checked); render(); });
  $('#restoreBtn').addEventListener('click', () => { toggleMenu(false); restoreSaved(); });
  $('#clearBtn').addEventListener('click', () => {
    toggleMenu(false);
    S.starters = Array(11).fill(null); S.bench = Array(7).fill(null); S.extra = Array(4).fill(null);
    render(); toast('Formazione svuotata');
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

  render();
})();
