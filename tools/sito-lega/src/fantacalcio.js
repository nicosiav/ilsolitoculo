/* Il Solito Culo — le statistiche di Serie A scaricate da Fantacalcio.it.
 * L'amministratore scarica l'Excel dalla pagina "Statistiche Serie A" e lo carica
 * dal sito: qui lo leggiamo (.xlsx, o .xls 97-2003) e abbiniamo le righe ai
 * giocatori delle rose. Niente scaricamenti automatici: le condizioni d'uso di
 * Fantacalcio.it non li permettono. */
(function (root) {
  'use strict';

  class FcError extends Error {}

  // ------------------------------------------------------------ zip (xlsx)
  const rd16 = (d, o) => d[o] | (d[o + 1] << 8);
  const rd32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new FcError('Questo browser non sa aprire i file .xlsx: aggiornalo, o salva il file come .xls.');
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }

  async function leggiZip(u8) {
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (rd32(u8, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new FcError('Il file non sembra un Excel .xlsx valido.');
    const n = rd16(u8, eocd + 10);
    let p = rd32(u8, eocd + 16);
    const voci = new Map();
    for (let k = 0; k < n; k++) {
      if (rd32(u8, p) !== 0x02014b50) throw new FcError('Indice del file .xlsx non valido.');
      const metodo = rd16(u8, p + 10), compresso = rd32(u8, p + 20);
      const ln = rd16(u8, p + 28), le = rd16(u8, p + 30), lc = rd16(u8, p + 32), off = rd32(u8, p + 42);
      const nome = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + ln));
      voci.set(nome, { metodo, compresso, off });
      p += 46 + ln + le + lc;
    }
    return async nome => {
      const v = voci.get(nome);
      if (!v) return null;
      const inizio = v.off + 30 + rd16(u8, v.off + 26) + rd16(u8, v.off + 28);
      const dati = u8.subarray(inizio, inizio + v.compresso);
      const raw = v.metodo === 0 ? dati : v.metodo === 8 ? await inflate(dati) : null;
      if (!raw) throw new FcError('Compressione del file .xlsx non supportata.');
      return new TextDecoder().decode(raw);
    };
  }

  const xml = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, c) => String.fromCharCode(+c)).replace(/&#x([0-9a-f]+);/gi, (m, c) => String.fromCharCode(parseInt(c, 16))).replace(/&amp;/g, '&');
  const testi = frammento => (frammento.match(/<t(?:\s[^>]*)?>[\s\S]*?<\/t>|<t\s*\/>/g) || [])
    .map(t => xml(t.replace(/^<t(?:\s[^>]*)?>|<\/t>$/g, '').replace(/^<t\s*\/>$/, ''))).join('');
  const colonna = ref => { let c = 0; for (const ch of ref.replace(/\d+/g, '')) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };

  async function righeXlsx(u8) {
    const leggi = await leggiZip(u8);
    const condivise = [];
    const ss = await leggi('xl/sharedStrings.xml');
    if (ss) (ss.match(/<si>[\s\S]*?<\/si>|<si\/>/g) || []).forEach(si => condivise.push(testi(si)));
    // il primo foglio della cartella di lavoro
    let percorso = 'xl/worksheets/sheet1.xml', foglio = '';
    const wb = await leggi('xl/workbook.xml'), rels = await leggi('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const primo = /<sheet\b[^>]*>/.exec(wb);
      if (primo) {
        const nome = /name="([^"]*)"/.exec(primo[0]), rid = /r:id="([^"]*)"/.exec(primo[0]);
        foglio = nome ? xml(nome[1]) : '';
        const rel = rid ? new RegExp('<Relationship\\b[^>]*Id="' + rid[1] + '"[^>]*>').exec(rels) : null;
        const t = rel ? /Target="([^"]*)"/.exec(rel[0]) : null;
        if (t) percorso = t[1].startsWith('/') ? t[1].slice(1) : 'xl/' + t[1].replace(/^\.\//, '');
      }
    }
    const sh = await leggi(percorso);
    if (!sh) throw new FcError('Nel file .xlsx non trovo il foglio con le statistiche.');
    const righe = [];
    (sh.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) || []).forEach(r => {
      const riga = [];
      (r.match(/<c\b[^>]*\/>|<c\b[\s\S]*?<\/c>/g) || []).forEach(c => {
        const ref = /\br="([A-Z]+)\d+"/.exec(c);
        const tipo = (/\bt="([^"]*)"/.exec(c) || [])[1];
        const v = (/<v>([\s\S]*?)<\/v>/.exec(c) || [])[1];
        let val = null;
        if (tipo === 's') val = v != null ? condivise[+v] : null;
        else if (tipo === 'inlineStr') val = testi(c);
        else if (tipo === 'str' || tipo === 'e') val = v != null ? xml(v) : null;
        else if (tipo === 'b') val = v === '1';
        else val = v != null ? +v : null;
        riga[ref ? colonna(ref[1]) : riga.length] = val;
      });
      righe.push(riga);
    });
    return { righe, foglio };
  }

  // .xls 97-2003: lo legge il motore di Schiera
  function righeXls(u8) {
    const X = root.XlsFormazione || (typeof require === 'function' ? require('../../schiera-formazione/src/engine.js') : null);
    if (!X) throw new FcError('Non riesco a leggere i file .xls.');
    const wb = X.load(u8);
    const foglio = wb.allSheets[0];
    const g = wb.grid(foglio);
    const righe = [];
    let vuote = 0;
    for (let r = 0; r < 3000 && vuote < 30; r++) {
      const riga = [];
      for (let c = 0; c < 30; c++) riga.push(g.get(r, c));
      if (riga.every(v => v == null || v === '')) vuote++; else vuote = 0;
      righe.push(riga);
    }
    return { righe, foglio };
  }

  // ------------------------------------------------------------ intestazioni
  const pulita = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  const COLONNE = {
    id: ['id', 'cod', 'codice'], ruolo: ['r', 'ruolo'], ruolo_m: ['rm', 'ruolo mantra'],
    nome: ['nome', 'calciatore', 'giocatore'], squadra: ['squadra', 'sq', 'club'],
    pv: ['pv', 'pg', 'partite a voto', 'presenze'], mv: ['mv', 'media voto', 'media'],
    fm: ['fm', 'fantamedia', 'mf', 'fmv'], gf: ['gf', 'gol fatti', 'gol'], gs: ['gs', 'gol subiti'],
    rp: ['rp', 'rigori parati'], rc: ['rc', 'rigori calciati'], r_piu: ['r+', 'rigori segnati'],
    r_meno: ['r-', 'rigori sbagliati'], ass: ['ass', 'assist'], amm: ['amm', 'ammonizioni'],
    esp: ['esp', 'espulsioni'], au: ['au', 'autogol', 'autoreti']
  };
  const numero = v => {
    if (v == null || v === '' || v === '-') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const n = +String(v).replace(',', '.');
    return isFinite(n) ? n : null;
  };

  function interpreta(righe, foglio, nomeFile) {
    let h = -1, mappa = null;
    for (let r = 0; r < Math.min(righe.length, 15) && h < 0; r++) {
      const celle = (righe[r] || []).map(pulita);
      if (celle.includes('nome') && (celle.includes('mv') || celle.includes('fm') || celle.includes('fantamedia'))) {
        h = r;
        mappa = {};
        Object.keys(COLONNE).forEach(k => {
          const i = celle.findIndex(c => COLONNE[k].includes(c));
          if (i >= 0) mappa[k] = i;
        });
      }
    }
    if (h < 0 || mappa.mv == null || mappa.fm == null || mappa.squadra == null) {
      throw new FcError('Non riconosco il file: serve l’Excel della pagina "Statistiche Serie A" di Fantacalcio.it (colonne Nome, Squadra, Mv, Fm).');
    }
    // la riga del titolo dice la stagione ("Statistiche Fantacalcio Stagione 2026/27")
    let stagione = '';
    for (let r = 0; r < h; r++) (righe[r] || []).forEach(v => {
      const m = /(\d{4})\s*\/\s*(\d{2,4})/.exec(String(v || ''));
      if (m && !stagione) stagione = m[1] + '/' + m[2].slice(-2);
    });
    if (!stagione) { const m = /(\d{4})[_-](\d{2,4})/.exec(nomeFile || ''); if (m) stagione = m[1] + '/' + m[2].slice(-2); }
    const out = [];
    for (let r = h + 1; r < righe.length; r++) {
      const riga = righe[r] || [];
      const nome = String(riga[mappa.nome] == null ? '' : riga[mappa.nome]).trim();
      if (!nome) continue;
      const x = { nome, squadra: String(riga[mappa.squadra] == null ? '' : riga[mappa.squadra]).trim() };
      x.ruolo = mappa.ruolo != null ? String(riga[mappa.ruolo] || '').trim().toUpperCase().slice(0, 1) : '';
      x.ruolo_m = mappa.ruolo_m != null ? String(riga[mappa.ruolo_m] || '').trim() : '';
      ['id', 'pv', 'mv', 'fm', 'gf', 'gs', 'rp', 'rc', 'r_piu', 'r_meno', 'ass', 'amm', 'esp', 'au'].forEach(k => {
        x[k] = mappa[k] != null ? numero(riga[mappa[k]]) : null;
      });
      if (x.mv == null && x.fm == null && x.pv == null) continue;
      out.push(x);
    }
    if (!out.length) throw new FcError('Nel file non ci sono giocatori.');
    return { righe: out, stagione, foglio };
  }

  async function leggi(u8, nomeFile) {
    if (u8[0] === 0x50 && u8[1] === 0x4B) { const r = await righeXlsx(u8); return interpreta(r.righe, r.foglio, nomeFile); }
    if (u8[0] === 0xD0 && u8[1] === 0xCF) { const r = righeXls(u8); return interpreta(r.righe, r.foglio, nomeFile); }
    throw new FcError('Formato non riconosciuto: carica l’Excel (.xlsx o .xls) scaricato da Fantacalcio.it.');
  }

  // ------------------------------------------------------------ abbinamenti
  const chiave = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cognome = s => chiave(String(s || '').replace(/\s+[A-Z][a-z]?\.?$/, '').replace(/\s+[A-Z]\.$/, ''));

  // giocatori: [{id, name, role, club}] delle rose; righe: quelle del file.
  // Ritorna Map(id giocatore -> riga) e l'elenco di chi non è stato trovato.
  function abbina(giocatori, righe) {
    const perNome = new Map(), perCognome = new Map();
    (righe || []).forEach(x => {
      const k = chiave(x.nome), c = cognome(x.nome);
      if (!perNome.has(k)) perNome.set(k, []);
      perNome.get(k).push(x);
      if (!perCognome.has(c)) perCognome.set(c, []);
      perCognome.get(c).push(x);
    });
    const scegli = (cand, g) => {
      if (!cand || !cand.length) return null;
      if (cand.length === 1) return cand[0];
      let c = cand.filter(x => !x.ruolo || !g.role || x.ruolo === String(g.role).toUpperCase());
      if (c.length > 1 && g.club) { const cc = c.filter(x => chiave(x.squadra) === chiave(g.club)); if (cc.length) c = cc; }
      return c.length === 1 ? c[0] : null;
    };
    const trovati = new Map(), mancano = [];
    (giocatori || []).forEach(g => {
      if (!g.name) return;
      let x = scegli(perNome.get(chiave(g.name)), g);
      if (!x) {
        const c = (perCognome.get(cognome(g.name)) || []).filter(y => !y.ruolo || !g.role || y.ruolo === String(g.role).toUpperCase());
        x = scegli(c, g);
      }
      if (x) trovati.set(g.id, x); else mancano.push(g);
    });
    return { trovati, mancano };
  }

  const api = { leggi, abbina, chiave, FcError, _parti: { leggiZip, righeXlsx, interpreta } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Fantacalcio = api;
})(typeof window !== 'undefined' ? window : globalThis);
