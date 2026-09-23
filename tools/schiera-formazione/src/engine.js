/* Motore .xls (BIFF8 dentro CFB) per schierare la formazione.
 * Modifica solo le celle necessarie e conserva macro, pulsanti, formati e fogli. */
(function (root) {
  'use strict';

  const FREESECT = 0xFFFFFFFF, ENDOFCHAIN = 0xFFFFFFFE, FATSECT = 0xFFFFFFFD;

  class XlsError extends Error {}

  // ---------------------------------------------------------------- CFB ----
  function readCFB(u8) {
    if (u8.length < 1024) throw new XlsError('Il file è troppo piccolo per essere un .xls.');
    const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    for (let i = 0; i < 8; i++) {
      if (u8[i] !== sig[i]) {
        if (u8[0] === 0x50 && u8[1] === 0x4B) throw new XlsError('Questo è un file .xlsx/.xlsm: serve il file .xls ricevuto dall\u2019amministratore.');
        throw new XlsError('Il file non è un Excel .xls valido.');
      }
    }
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const u32 = o => dv.getUint32(o, true);
    const ss = 1 << dv.getUint16(0x1E, true);
    const mss = 1 << dv.getUint16(0x20, true);
    const csectFat = u32(0x2C), dirStart = u32(0x30), miniCutoff = u32(0x38);
    const miniFatStart = u32(0x3C), difatStart = u32(0x44), csectDifat = u32(0x48);
    const secOff = s => (s + 1) * ss;

    const difat = [];
    for (let i = 0; i < Math.min(csectFat, 109); i++) difat.push(u32(0x4C + i * 4));
    let ds = difatStart, guard = 0;
    while (difat.length < csectFat && ds < 0xFFFFFFFA && guard++ < csectDifat + 2) {
      const per = ss / 4 - 1;
      for (let i = 0; i < per && difat.length < csectFat; i++) difat.push(u32(secOff(ds) + i * 4));
      ds = u32(secOff(ds) + per * 4);
    }
    const fat = [];
    for (const s of difat) for (let i = 0; i < ss / 4; i++) fat.push(u32(secOff(s) + i * 4));

    const chainOf = (start, table) => {
      const out = [];
      let s = start;
      while (s < 0xFFFFFFFA) {
        if (out.length > table.length) throw new XlsError('Struttura del file danneggiata (catena di settori ciclica).');
        out.push(s);
        s = table[s];
        if (s === undefined) throw new XlsError('Struttura del file danneggiata (settore fuori tabella).');
      }
      return out;
    };

    const dirChain = chainOf(dirStart, fat);
    const entries = [];
    for (let k = 0; k < dirChain.length; k++) {
      for (let j = 0; j < ss / 128; j++) {
        const o = secOff(dirChain[k]) + j * 128;
        const nl = dv.getUint16(o + 64, true);
        let name = '';
        for (let c = 0; c < Math.max(0, nl - 2); c += 2) name += String.fromCharCode(dv.getUint16(o + c, true));
        entries.push({ index: entries.length, name, type: u8[o + 66], start: u32(o + 116), size: u32(o + 120), fileOff: o });
      }
    }
    const cfb = { u8, dv, ss, mss, miniCutoff, difat, fat, entries, dirChain, secOff, chainOf };
    cfb.find = name => entries.find(e => e.type === 2 && e.name === name);
    cfb.read = ent => {
      if (ent.size < miniCutoff) {
        const rootEnt = entries[0];
        const miniData = readChain(chainOf(rootEnt.start, fat), rootEnt.size);
        const miniFat = [];
        for (const s of chainOf(miniFatStart, fat)) for (let i = 0; i < ss / 4; i++) miniFat.push(u32(secOff(s) + i * 4));
        const out = new Uint8Array(ent.size);
        let p = 0;
        for (const m of chainOf(ent.start, miniFat)) {
          const n = Math.min(mss, ent.size - p);
          out.set(miniData.subarray(m * mss, m * mss + n), p);
          p += n;
        }
        return out;
      }
      return readChain(chainOf(ent.start, fat), ent.size);
    };
    function readChain(chain, size) {
      const out = new Uint8Array(size);
      let p = 0;
      for (const s of chain) {
        if (p >= size) break;
        const n = Math.min(ss, size - p);
        out.set(u8.subarray(secOff(s), secOff(s) + n), p);
        p += n;
      }
      if (p < size) throw new XlsError('Il file è troncato.');
      return out;
    }
    return cfb;
  }

  // Sostituisce uno stream "grande" lasciando intatto tutto il resto del contenitore.
  function cfbReplaceStream(cfb, ent, data) {
    const { u8, ss, secOff } = cfb;
    if (ent.size < cfb.miniCutoff || data.length < cfb.miniCutoff) throw new XlsError('Stream troppo piccolo: struttura non supportata.');
    const fat = cfb.fat.slice();
    const difat = cfb.difat.slice();
    const oldChain = cfb.chainOf(ent.start, cfb.fat);
    const need = Math.ceil(data.length / ss);
    const chain = oldChain.slice(0, need);
    for (const s of oldChain.slice(need)) fat[s] = FREESECT;
    const taken = new Set(chain);
    const alloc = () => {
      for (;;) {
        for (let i = 0; i < fat.length; i++) {
          if (fat[i] === FREESECT && !taken.has(i)) { taken.add(i); return i; }
        }
        if (difat.length >= 109) throw new XlsError('File troppo grande per essere aggiornato.');
        const base = fat.length;
        for (let i = 0; i < ss / 4; i++) fat.push(FREESECT);
        fat[base] = FATSECT;
        taken.add(base);
        difat.push(base);
      }
    };
    while (chain.length < need) chain.push(alloc());
    for (let i = 0; i < chain.length; i++) fat[chain[i]] = i + 1 < chain.length ? chain[i + 1] : ENDOFCHAIN;

    let maxSec = Math.ceil((u8.length - ss) / ss) - 1;
    for (let i = 0; i < fat.length; i++) if (fat[i] !== FREESECT && i > maxSec) maxSec = i;
    const outLen = Math.max(u8.length, ss + (maxSec + 1) * ss);
    const out = new Uint8Array(outLen);
    out.set(u8);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < chain.length; i++) {
      const o = secOff(chain[i]);
      out.fill(0, o, o + ss);
      out.set(data.subarray(i * ss, Math.min((i + 1) * ss, data.length)), o);
    }
    for (let k = 0; k < difat.length; k++) {
      const o = secOff(difat[k]);
      for (let i = 0; i < ss / 4; i++) dv.setUint32(o + i * 4, fat[k * (ss / 4) + i], true);
    }
    dv.setUint32(0x2C, difat.length, true);
    for (let i = 0; i < 109; i++) dv.setUint32(0x4C + i * 4, i < difat.length ? difat[i] : FREESECT, true);
    dv.setUint32(ent.fileOff + 116, chain[0], true);
    dv.setUint32(ent.fileOff + 120, data.length, true);
    dv.setUint32(ent.fileOff + 124, 0, true);
    return out;
  }

  // --------------------------------------------------------------- BIFF ----
  const SID = {
    BOF: 0x0809, EOF: 0x000A, BOUNDSHEET: 0x0085, SST: 0x00FC, CONTINUE: 0x003C, FILEPASS: 0x002F,
    ROW: 0x0208, DBCELL: 0x00D7, INDEX: 0x020B, DIMENSIONS: 0x0200, DEFCOLWIDTH: 0x0055, COLINFO: 0x007D,
    LABELSST: 0x00FD, NUMBER: 0x0203, RK: 0x027E, MULRK: 0x00BD, BLANK: 0x0201, MULBLANK: 0x00BE,
    FORMULA: 0x0006, STRING: 0x0207, BOOLERR: 0x0205, LABEL: 0x0204, RSTRING: 0x00D6,
    SHRFMLA: 0x04BC, ARRAY: 0x0221, TABLE: 0x0236, UNCALCED: 0x005E
  };
  const CELL_SIDS = new Set([SID.LABELSST, SID.NUMBER, SID.RK, SID.MULRK, SID.BLANK, SID.MULBLANK, SID.FORMULA, SID.BOOLERR, SID.LABEL, SID.RSTRING]);
  const ATTACHED_SIDS = new Set([SID.STRING, SID.SHRFMLA, SID.ARRAY, SID.TABLE, SID.CONTINUE]);

  const rd16 = (d, o) => d[o] | (d[o + 1] << 8);
  const rd32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
  const wr16 = (d, o, v) => { d[o] = v & 255; d[o + 1] = (v >>> 8) & 255; };
  const wr32 = (d, o, v) => { d[o] = v & 255; d[o + 1] = (v >>> 8) & 255; d[o + 2] = (v >>> 16) & 255; d[o + 3] = (v >>> 24) & 255; };
  const rdF64 = (d, o) => new DataView(d.buffer, d.byteOffset + o, 8).getFloat64(0, true);

  function parseRecords(wb) {
    const recs = [];
    let p = 0;
    while (p + 4 <= wb.length) {
      const sid = rd16(wb, p), len = rd16(wb, p + 2);
      if (p + 4 + len > wb.length) break;
      recs.push({ sid, off: p, len, data: wb.subarray(p + 4, p + 4 + len) });
      p += 4 + len;
    }
    return { recs, tail: wb.subarray(p) };
  }

  function decodeRK(rk) {
    let v;
    if (rk & 2) v = (rk >> 2);
    else {
      const b = new DataView(new ArrayBuffer(8));
      b.setUint32(4, rk & 0xFFFFFFFC, true);
      v = b.getFloat64(0, true);
    }
    return (rk & 1) ? v / 100 : v;
  }

  function decodeChars(d, o, cch, high) {
    let s = '';
    if (high) { for (let i = 0; i < cch; i++) s += String.fromCharCode(rd16(d, o + i * 2)); }
    else { for (let i = 0; i < cch; i++) s += String.fromCharCode(d[o + i]); }
    return s;
  }

  // XLUnicodeString (cch a 16 bit) con eventuali formattazioni
  function readXLString(d, o) {
    const cch = rd16(d, o), fl = d[o + 2];
    let p = o + 3;
    let runs = 0, ext = 0;
    if (fl & 8) { runs = rd16(d, p); p += 2; }
    if (fl & 4) { ext = rd32(d, p); p += 4; }
    return decodeChars(d, p, cch, fl & 1);
  }

  function parseSST(recs, i) {
    const segs = [recs[i].data];
    for (let k = i + 1; k < recs.length && recs[k].sid === SID.CONTINUE; k++) segs.push(recs[k].data);
    let si = 0, p = 8;
    const unique = rd32(segs[0], 4);
    const out = [];
    const need = () => { while (si < segs.length && p >= segs[si].length) { si++; p = 0; } if (si >= segs.length) throw new XlsError('Tabella stringhe (SST) troncata.'); };
    const u8 = () => { need(); return segs[si][p++]; };
    const u16 = () => u8() | (u8() << 8);
    const u32 = () => (u16() | (u16() << 16)) >>> 0;
    const skip = n => { while (n > 0) { need(); const k = Math.min(n, segs[si].length - p); p += k; n -= k; } };
    for (let s = 0; s < unique; s++) {
      if (si >= segs.length || (si === segs.length - 1 && p >= segs[si].length)) break;
      const cch = u16();
      let fl = u8();
      let runs = 0, ext = 0;
      if (fl & 8) runs = u16();
      if (fl & 4) ext = u32();
      let str = '', left = cch;
      while (left > 0) {
        if (p >= segs[si].length) { si++; p = 0; if (si >= segs.length) throw new XlsError('SST troncata.'); fl = segs[si][p++]; }
        const d = segs[si];
        const w = (fl & 1) ? 2 : 1;
        const n = Math.min(left, Math.floor((d.length - p) / w));
        str += decodeChars(d, p, n, fl & 1);
        p += n * w; left -= n;
      }
      skip(runs * 4 + ext);
      out.push(str);
    }
    return out;
  }

  // ------------------------------------------------------------ Workbook ----
  function openWorkbook(u8) {
    const cfb = readCFB(u8);
    const ent = cfb.find('Workbook') || cfb.find('Book');
    if (!ent) throw new XlsError('Nel file non c\u2019è una cartella di lavoro Excel.');
    if (ent.name === 'Book') throw new XlsError('Formato Excel 5/95 non supportato: salva il file come Excel 97-2003 (.xls).');
    const wb = cfb.read(ent);
    const { recs, tail } = parseRecords(wb);
    if (!recs.length || recs[0].sid !== SID.BOF || rd16(recs[0].data, 0) !== 0x0600) throw new XlsError('Versione di Excel non supportata (serve .xls 97-2003).');
    let sst = [];
    const sheets = [];
    const supbooks = [];
    let xti = [];
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (r.sid === SID.FILEPASS) throw new XlsError('Il file è protetto da password: non posso modificarlo.');
      if (r.sid === SID.SST) sst = parseSST(recs, i);
      if (r.sid === 0x01AE) supbooks.push({ self: r.data.length === 4 && rd16(r.data, 2) === 0x0401 });
      if (r.sid === 0x0017) {
        const n = rd16(r.data, 0);
        xti = [];
        for (let k = 0; k < n && 2 + k * 6 + 6 <= r.data.length; k++) {
          const o = 2 + k * 6;
          xti.push({ sup: rd16(r.data, o), first: (rd16(r.data, o + 2) << 16) >> 16, last: (rd16(r.data, o + 4) << 16) >> 16 });
        }
      }
      if (r.sid === SID.BOUNDSHEET) {
        const d = r.data;
        const cch = d[6], hi = d[7] & 1;
        sheets.push({ name: decodeChars(d, 8, cch, hi), pos: rd32(d, 0), type: d[5], hidden: d[4] & 3, rec: r });
      }
      if (r.sid === SID.EOF) break;
    }
    const byOff = new Map(recs.map((r, i) => [r.off, i]));
    for (const s of sheets) {
      const i0 = byOff.get(s.pos);
      if (i0 === undefined || recs[i0].sid !== SID.BOF) throw new XlsError('Indice dei fogli non valido nel file.');
      let depth = 0, i = i0;
      for (; i < recs.length; i++) {
        if (recs[i].sid === SID.BOF) depth++;
        else if (recs[i].sid === SID.EOF && --depth === 0) break;
      }
      s.start = i0; s.end = i;
    }
    for (const x of xti) x.self = !!(supbooks[x.sup] && supbooks[x.sup].self);
    return { cfb, ent, wb, recs, tail, sst, sheets, xti, models: new Map() };
  }

  // ---------------------------------------------------------- Sheet model ----
  function cellFromRec(r) {
    const d = r.data;
    const c = { sid: r.sid, data: d, row: rd16(d, 0), col: rd16(d, 2), extra: [] };
    if (r.sid === SID.MULRK || r.sid === SID.MULBLANK) c.colLast = rd16(d, d.length - 2);
    else c.colLast = c.col;
    return c;
  }

  function buildSheet(book, sh) {
    const recs = book.recs;
    // la tabella delle celle: sequenza contigua di ROW / celle (+ record collegati) / DBCELL
    let first = -1, last = -1, depth = 0;
    for (let i = sh.start; i <= sh.end; i++) {
      const s = recs[i].sid;
      if (s === SID.BOF) depth++;
      if (s === SID.EOF) depth--;
      if (depth !== 1) continue;
      if (first < 0) { if (s === SID.ROW || CELL_SIDS.has(s)) first = i; else continue; }
      const prev = recs[i - 1].sid;
      const attached = (s === SID.STRING || s === SID.SHRFMLA || s === SID.ARRAY || s === SID.TABLE) ||
        (s === SID.CONTINUE && (prev === SID.STRING || prev === SID.CONTINUE) && last === i - 1);
      if (s === SID.ROW || s === SID.DBCELL || CELL_SIDS.has(s) || attached) last = i;
      else break;
    }
    if (first < 0) throw new XlsError('Il foglio "' + sh.name + '" è vuoto.');
    const blocks = [];
    let cur = null;
    const open = () => { cur = { rows: [], cells: [], dbOld: null }; blocks.push(cur); };
    for (let i = first; i <= last; i++) {
      const r = recs[i];
      if (r.sid === SID.ROW) {
        if (!cur || cur.cells.length || cur.dbOld) open();
        cur.rows.push({ rw: rd16(r.data, 0), data: r.data.slice() });
      } else if (r.sid === SID.DBCELL) {
        if (!cur || cur.dbOld) throw new XlsError('Struttura del foglio non riconosciuta (DBCELL).');
        cur.dbOld = r;
      } else if (CELL_SIDS.has(r.sid)) {
        if (!cur || cur.dbOld) open();
        cur.cells.push(cellFromRec(r));
      } else if (cur && cur.cells.length) {
        cur.cells[cur.cells.length - 1].extra.push({ sid: r.sid, data: r.data });
      } else {
        throw new XlsError('Record inatteso (0x' + r.sid.toString(16) + ') nella tabella delle celle.');
      }
    }
    const before = recs.slice(sh.start, first);
    const after = recs.slice(last + 1, sh.end + 1);
    const colinfo = before.filter(r => r.sid === SID.COLINFO).map(r => ({ c1: rd16(r.data, 0), c2: rd16(r.data, 2), xf: rd16(r.data, 6) }));
    const model = { book, sh, sheetIndex: book.sheets.indexOf(sh), blocks, before, after, colinfo, dirtyCells: new Map() };
    reindex(model);
    return model;
  }

  function reindex(m) {
    m.idx = new Map();
    m.rowInfo = new Map();
    m.blocks.forEach((b, bi) => {
      b.rows.forEach(r => m.rowInfo.set(r.rw, { block: bi, row: r }));
      b.cells.forEach(c => { for (let k = c.col; k <= c.colLast; k++) m.idx.set(c.row * 256 + k, c); });
    });
  }

  const key = (r, c) => r * 256 + c;

  function cellValue(m, r, c) {
    const k = key(r, c);
    if (m.dirtyCells.has(k)) return m.dirtyCells.get(k);
    const cell = m.idx.get(k);
    if (!cell) return { t: 'blank' };
    const d = cell.data;
    switch (cell.sid) {
      case SID.LABELSST: return { t: 's', v: m.book.sst[rd32(d, 6)] ?? '' };
      case SID.NUMBER: return { t: 'n', v: rdF64(d, 6) };
      case SID.RK: return { t: 'n', v: decodeRK(rd32(d, 6)) };
      case SID.MULRK: return { t: 'n', v: decodeRK(rd32(d, 4 + (c - cell.col) * 6 + 2)) };
      case SID.BOOLERR: return d[7] ? { t: 'e', v: d[6] } : { t: 'b', v: !!d[6] };
      case SID.LABEL: case SID.RSTRING: return { t: 's', v: readXLString(d, 6) };
      case SID.FORMULA: return formulaCached(cell);
      default: return { t: 'blank' };
    }
  }

  function formulaCached(cell) {
    const d = cell.data;
    if (rd16(d, 12) !== 0xFFFF) return { t: 'n', v: rdF64(d, 6) };
    switch (d[6]) {
      case 0: { const s = cell.extra.find(x => x.sid === SID.STRING); return { t: 's', v: s ? readXLString(s.data, 0) : '' }; }
      case 1: return { t: 'b', v: !!d[8] };
      case 2: return { t: 'e', v: d[8] };
      case 3: return { t: 's', v: '' };
      default: return { t: 'blank' };
    }
  }

  function cellXf(m, r, c) {
    const cell = m.idx.get(key(r, c));
    if (cell) {
      if (cell.sid === SID.MULBLANK) return rd16(cell.data, 4 + (c - cell.col) * 2);
      if (cell.sid === SID.MULRK) return rd16(cell.data, 4 + (c - cell.col) * 6);
      return rd16(cell.data, 4);
    }
    const ri = m.rowInfo.get(r);
    if (ri) {
      const fl = rd32(ri.row.data, 12);
      if (fl & 0x80) return (fl >>> 16) & 0x0FFF;
    }
    const ci = m.colinfo.find(x => c >= x.c1 && c <= x.c2);
    return ci ? ci.xf : 15;
  }

  function splitMul(m, cell) {
    const b = m.blocks[m.rowInfo.get(cell.row).block];
    const at = b.cells.indexOf(cell);
    const singles = [];
    for (let k = cell.col; k <= cell.colLast; k++) {
      if (cell.sid === SID.MULBLANK) {
        const d = new Uint8Array(6);
        wr16(d, 0, cell.row); wr16(d, 2, k); wr16(d, 4, rd16(cell.data, 4 + (k - cell.col) * 2));
        singles.push({ sid: SID.BLANK, data: d, row: cell.row, col: k, colLast: k, extra: [] });
      } else {
        const d = new Uint8Array(10);
        wr16(d, 0, cell.row); wr16(d, 2, k); d.set(cell.data.subarray(4 + (k - cell.col) * 6, 10 + (k - cell.col) * 6), 4);
        singles.push({ sid: SID.RK, data: d, row: cell.row, col: k, colLast: k, extra: [] });
      }
    }
    b.cells.splice(at, 1, ...singles);
    for (const s of singles) m.idx.set(key(s.row, s.col), s);
  }

  function encodeStringRecordBody(s) {
    const wide = /[^\x00-\xff]/.test(s);
    const d = new Uint8Array(3 + s.length * (wide ? 2 : 1));
    wr16(d, 0, s.length); d[2] = wide ? 1 : 0;
    for (let i = 0; i < s.length; i++) {
      if (wide) wr16(d, 3 + i * 2, s.charCodeAt(i)); else d[3 + i] = s.charCodeAt(i);
    }
    return d;
  }

  function sstIndex(m, s) {
    if (!m._sstMap) { m._sstMap = new Map(); m.book.sst.forEach((v, i) => { if (!m._sstMap.has(v)) m._sstMap.set(v, i); }); }
    return m._sstMap.get(s);
  }

  // Scrive un valore costante in una cella (come "Incolla valori"), conservando il formato.
  function setValue(m, r, c, val) {
    const k = key(r, c);
    let cell = m.idx.get(k);
    if (cell && (cell.sid === SID.MULBLANK || cell.sid === SID.MULRK)) { splitMul(m, cell); cell = m.idx.get(k); }
    const old = cellValue(m, r, c);
    const xf = cellXf(m, r, c);
    if (cell && cell.sid === SID.FORMULA && cell.extra.some(x => x.sid !== SID.STRING)) throw new XlsError('Cella ' + colName(c) + (r + 1) + ': formula condivisa, non posso sovrascriverla.');
    let rec = null;
    if (val.t === 'n') {
      const v = val.v;
      if (Number.isInteger(v) && v >= -(1 << 29) && v < (1 << 29)) {
        rec = { sid: SID.RK, data: new Uint8Array(10) };
        wr32(rec.data, 6, ((v << 2) | 2) >>> 0);
      } else {
        rec = { sid: SID.NUMBER, data: new Uint8Array(14) };
        new DataView(rec.data.buffer).setFloat64(6, v, true);
      }
    } else if (val.t === 's' && val.v !== '') {
      const i = sstIndex(m, val.v);
      if (i !== undefined) { rec = { sid: SID.LABELSST, data: new Uint8Array(10) }; wr32(rec.data, 6, i); }
      else {
        const body = encodeStringRecordBody(val.v);
        rec = { sid: SID.LABEL, data: new Uint8Array(6 + body.length) };
        rec.data.set(body, 6);
      }
    } else if (cell) {
      rec = { sid: SID.BLANK, data: new Uint8Array(6) };
    }
    const changed = !sameVal(old, val.t === 's' && val.v === '' ? { t: 'blank' } : val);
    if (!rec) { return changed; }
    wr16(rec.data, 0, r); wr16(rec.data, 2, c); wr16(rec.data, 4, xf);
    const nc = { sid: rec.sid, data: rec.data, row: r, col: c, colLast: c, extra: [] };
    const ri = m.rowInfo.get(r);
    let b;
    if (ri) b = m.blocks[ri.block];
    else if (cell) b = m.blocks.find(x => x.cells.includes(cell));
    else b = m.blocks.find(x => x.cells.some(y => y.row === r)) || m.blocks.find(x => x.cells.some(y => y.row > r)) || m.blocks[m.blocks.length - 1];
    if (!b) throw new XlsError('Riga ' + (r + 1) + ' mancante nel foglio.');
    if (cell) b.cells.splice(b.cells.indexOf(cell), 1, nc);
    else {
      let at = b.cells.findIndex(x => x.row > r || (x.row === r && x.col > c));
      if (at < 0) at = b.cells.length;
      b.cells.splice(at, 0, nc);
      if (ri) {
        const rd = ri.row.data;
        if (c < rd16(rd, 2)) wr16(rd, 2, c);
        if (c + 1 > rd16(rd, 4)) wr16(rd, 4, c + 1);
      }
    }
    m.idx.set(k, nc);
    if (changed) m.dirtyCells.set(k, val.t === 's' && val.v === '' ? { t: 'blank' } : val);
    return changed;
  }

  function setFormulaCache(m, r, c, val) {
    const cell = m.idx.get(key(r, c));
    const d = cell.data.slice();
    d.fill(0, 6, 14);
    const extra = cell.extra.filter(x => x.sid !== SID.STRING);
    if (val.t === 'n') new DataView(d.buffer).setFloat64(6, val.v, true);
    else {
      wr16(d, 12, 0xFFFF);
      if (val.t === 's') {
        if (val.v === '') d[6] = 3;
        else { d[6] = 0; extra.push({ sid: SID.STRING, data: encodeStringRecordBody(val.v) }); }
      } else if (val.t === 'b') { d[6] = 1; d[8] = val.v ? 1 : 0; }
      else if (val.t === 'e') { d[6] = 2; d[8] = val.v; }
    }
    cell.data = d;
    cell.extra = extra;
    m.dirtyCells.set(key(r, c), val);
  }

  function sameVal(a, b) {
    const na = a.t === 's' && a.v === '' ? { t: 'blank' } : a;
    const nb = b.t === 's' && b.v === '' ? { t: 'blank' } : b;
    return na.t === nb.t && (na.t === 'blank' || na.v === nb.v);
  }

  function colName(c) { let s = ''; c++; while (c > 0) { const k = (c - 1) % 26; s = String.fromCharCode(65 + k) + s; c = Math.floor((c - 1) / 26); } return s; }

  // ------------------------------------------------------ Formula engine ----
  const FIXED_ARGC = { 2: 1, 3: 1, 24: 1, 25: 1, 26: 1, 27: 2, 38: 1, 129: 1, 346: 2, 31: 3, 32: 1, 33: 1 };
  const ERR = { NULL: 0x00, DIV0: 0x07, VALUE: 0x0F, REF: 0x17, NAME: 0x1D, NUM: 0x24, NA: 0x2A };

  class Unsupported extends Error {}

  function tokenize(rgce, baseRow, baseCol, rel, book) {
    const toks = [];
    let p = 0;
    const loc = (rw, cl) => {
      const rowRel = !!(cl & 0x8000), colRel = !!(cl & 0x4000);
      let r = rw, c = cl & 0x3FFF;
      if (rel) {
        if (rowRel) r = (baseRow + ((rw << 16) >> 16)) & 0xFFFF;
        if (colRel) c = (baseCol + ((c & 0xFF) << 24 >> 24)) & 0xFF;
      }
      return { r, c };
    };
    while (p < rgce.length) {
      const t = rgce[p++];
      const base = t & 0x1F | (t >= 0x20 ? 0x20 : 0);
      const cls = t < 0x20 ? t : (t & 0x9F) | 0x20;
      if (t >= 0x03 && t <= 0x0E) { toks.push({ k: 'op', op: t }); continue; }
      switch (t) {
        case 0x01: toks.push({ k: 'exp', r: rd16(rgce, p), c: rd16(rgce, p + 2) }); p += 4; continue;
        case 0x12: toks.push({ k: 'uplus' }); continue;
        case 0x13: toks.push({ k: 'uminus' }); continue;
        case 0x14: toks.push({ k: 'pct' }); continue;
        case 0x15: continue;
        case 0x16: toks.push({ k: 'lit', v: { t: 'miss' } }); continue;
        case 0x17: { const cch = rgce[p], hi = rgce[p + 1] & 1; toks.push({ k: 'lit', v: { t: 's', v: decodeChars(rgce, p + 2, cch, hi) } }); p += 2 + cch * (hi ? 2 : 1); continue; }
        case 0x19: {
          const g = rgce[p], dat = rd16(rgce, p + 1); p += 3;
          if (g & 0x04) { p += (dat + 1) * 2; throw new Unsupported('CHOOSE'); }
          if (g & 0x10) toks.push({ k: 'attrsum' });
          continue;
        }
        case 0x1C: toks.push({ k: 'lit', v: { t: 'e', v: rgce[p] } }); p += 1; continue;
        case 0x1D: toks.push({ k: 'lit', v: { t: 'b', v: !!rgce[p] } }); p += 1; continue;
        case 0x1E: toks.push({ k: 'lit', v: { t: 'n', v: rd16(rgce, p) } }); p += 2; continue;
        case 0x1F: toks.push({ k: 'lit', v: { t: 'n', v: rdF64(rgce, p) } }); p += 8; continue;
      }
      switch (cls) {
        case 0x21: { const f = rd16(rgce, p); p += 2; if (!(f in FIXED_ARGC)) throw new Unsupported('func ' + f); toks.push({ k: 'fn', f, argc: FIXED_ARGC[f] }); continue; }
        case 0x22: { const argc = rgce[p] & 0x7F, f = rd16(rgce, p + 1); p += 3; if (f & 0x8000) throw new Unsupported('macro fn'); toks.push({ k: 'fn', f, argc }); continue; }
        case 0x24: case 0x2C: { const a = loc(rd16(rgce, p), rd16(rgce, p + 2)); p += 4; if (cls === 0x2C && !rel) throw new Unsupported('refN'); toks.push({ k: 'ref', r1: a.r, c1: a.c, r2: a.r, c2: a.c }); continue; }
        case 0x25: case 0x2D: {
          const a = loc(rd16(rgce, p), rd16(rgce, p + 4)), b = loc(rd16(rgce, p + 2), rd16(rgce, p + 6)); p += 8;
          toks.push({ k: 'area', r1: a.r, c1: a.c, r2: b.r, c2: b.c }); continue;
        }
        case 0x3A: case 0x3B: {
          const x = book && book.xti[rd16(rgce, p)];
          if (!x || !x.self || x.first !== x.last || x.first < 0) throw new Unsupported('3d');
          if (cls === 0x3A) { const a = loc(rd16(rgce, p + 2), rd16(rgce, p + 4)); p += 6; toks.push({ k: 'ref', sheet: x.first, r1: a.r, c1: a.c, r2: a.r, c2: a.c }); }
          else { const a = loc(rd16(rgce, p + 2), rd16(rgce, p + 6)), b = loc(rd16(rgce, p + 4), rd16(rgce, p + 8)); p += 10; toks.push({ k: 'area', sheet: x.first, r1: a.r, c1: a.c, r2: b.r, c2: b.c }); }
          continue;
        }
        case 0x3C: p += 6; toks.push({ k: 'lit', v: { t: 'e', v: ERR.REF } }); continue;
        case 0x3D: p += 10; toks.push({ k: 'lit', v: { t: 'e', v: ERR.REF } }); continue;
        case 0x2A: p += 4; toks.push({ k: 'lit', v: { t: 'e', v: ERR.REF } }); continue;
        case 0x2B: p += 8; toks.push({ k: 'lit', v: { t: 'e', v: ERR.REF } }); continue;
      }
      throw new Unsupported('ptg 0x' + t.toString(16) + (base ? '' : ''));
    }
    return toks;
  }

  function formulaTokens(m, cell) {
    if (cell._toks !== undefined) return cell._toks;
    const d = cell.data;
    const cce = rd16(d, 20);
    const rgce = d.subarray(22, 22 + cce);
    try {
      if (rgce[0] === 0x01 && cce === 5) {
        const ar = rd16(rgce, 1), ac = rd16(rgce, 3);
        const anchor = m.idx.get(key(ar, ac));
        const shr = anchor && anchor.extra.find(x => x.sid === SID.SHRFMLA);
        if (!shr) throw new Unsupported('array/table');
        const sd = shr.data;
        const scce = rd16(sd, 8);
        cell._toks = tokenize(sd.subarray(10, 10 + scce), cell.row, cell.col, true, m.book);
      } else {
        cell._toks = tokenize(rgce, cell.row, cell.col, false, m.book);
      }
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      cell._toks = null;
    }
    return cell._toks;
  }

  // Riferimenti "grezzi" (anche per formule non valutabili), per sapere cosa dipende da cosa.
  function modelOf(book, idx) {
    if (!book.models.has(idx)) book.models.set(idx, buildSheet(book, book.sheets[idx]));
    return book.models.get(idx);
  }

  function formulaRects(m, cell) {
    const toks = formulaTokens(m, cell);
    if (toks) return toks.filter(t => (t.k === 'ref' || t.k === 'area') && (t.sheet === undefined || t.sheet === m.sheetIndex));
    // formula non valutabile: prova a leggere almeno i riferimenti locali
    return null;
  }

  function evaluate(m, cell) {
    const toks = formulaTokens(m, cell);
    if (!toks) throw new Unsupported('tokens');
    const st = [];
    const mod = x => (x.sheet === undefined || x.sheet === m.sheetIndex) ? m : modelOf(m.book, x.sheet);
    const val = x => {
      if (x.k === 'ref') return cellValue(mod(x), x.r1, x.c1);
      if (x.k === 'area') {
        if (x.r1 === x.r2 && x.c1 === x.c2) return cellValue(mod(x), x.r1, x.c1);
        throw new Unsupported('area as value');
      }
      return x;
    };
    const cells = x => {
      if (x.k === 'ref' || x.k === 'area') {
        const mm = mod(x), out = [];
        if ((Math.abs(x.r2 - x.r1) + 1) * (Math.abs(x.c2 - x.c1) + 1) > 100000) throw new Unsupported('area too big');
        for (let r = Math.min(x.r1, x.r2); r <= Math.max(x.r1, x.r2); r++)
          for (let c = Math.min(x.c1, x.c2); c <= Math.max(x.c1, x.c2); c++) out.push(cellValue(mm, r, c));
        return out;
      }
      return null;
    };
    for (const t of toks) {
      if (t.k === 'lit') st.push(t.v);
      else if (t.k === 'ref' || t.k === 'area') st.push(t);
      else if (t.k === 'op') { const b = val(st.pop()), a = val(st.pop()); st.push(binop(t.op, a, b)); }
      else if (t.k === 'uminus') { const a = toNum(val(st.pop())); st.push(a.t === 'e' ? a : { t: 'n', v: -a.v }); }
      else if (t.k === 'uplus') { st.push(val(st.pop())); }
      else if (t.k === 'pct') { const a = toNum(val(st.pop())); st.push(a.t === 'e' ? a : { t: 'n', v: a.v / 100 }); }
      else if (t.k === 'attrsum') { st.push(fnSum([st.pop()], cells, val)); }
      else if (t.k === 'fn') {
        const args = st.splice(st.length - t.argc, t.argc);
        st.push(callFn(t.f, args, cells, val));
      }
    }
    if (st.length !== 1) throw new Unsupported('stack');
    let res = val(st[0]);
    if (res.t === 'blank' || res.t === 'miss') res = { t: 'n', v: 0 };
    return res;
  }

  function toNum(a) {
    switch (a.t) {
      case 'n': return a;
      case 'blank': case 'miss': return { t: 'n', v: 0 };
      case 'b': return { t: 'n', v: a.v ? 1 : 0 };
      case 'e': return a;
      case 's': { const s = a.v.trim(); if (s !== '' && !isNaN(Number(s))) return { t: 'n', v: Number(s) }; return { t: 'e', v: ERR.VALUE }; }
    }
    return { t: 'e', v: ERR.VALUE };
  }
  function toStr(a) {
    if (a.t === 's') return a.v;
    if (a.t === 'n') return String(+a.v.toPrecision(15));
    if (a.t === 'b') return a.v ? 'VERO' : 'FALSO';
    return '';
  }
  function toBool(a) {
    switch (a.t) {
      case 'b': return a;
      case 'n': return { t: 'b', v: a.v !== 0 };
      case 'blank': case 'miss': return { t: 'b', v: false };
      case 'e': return a;
      case 's': { const u = a.v.toUpperCase(); if (u === 'TRUE' || u === 'VERO') return { t: 'b', v: true }; if (u === 'FALSE' || u === 'FALSO') return { t: 'b', v: false }; return { t: 'e', v: ERR.VALUE }; }
    }
    return { t: 'e', v: ERR.VALUE };
  }
  function compare(a, b) {
    if (a.t === 'miss') a = { t: 'blank' };
    if (b.t === 'miss') b = { t: 'blank' };
    if (a.t === 'blank' && b.t === 'blank') return 0;
    const empty = t => t === 'n' ? { t: 'n', v: 0 } : t === 's' ? { t: 's', v: '' } : { t: 'b', v: false };
    if (a.t === 'blank') a = empty(b.t);
    if (b.t === 'blank') b = empty(a.t);
    const rank = { n: 0, s: 1, b: 2 };
    if (a.t !== b.t) return rank[a.t] - rank[b.t];
    if (a.t === 's') { const x = a.v.toLowerCase(), y = b.v.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
    const x = +a.v, y = +b.v;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  function binop(op, a, b) {
    if (a.t === 'e') return a;
    if (b.t === 'e') return b;
    if (op >= 0x09) {
      const c = compare(a, b);
      const r = op === 0x09 ? c < 0 : op === 0x0A ? c <= 0 : op === 0x0B ? c === 0 : op === 0x0C ? c >= 0 : op === 0x0D ? c > 0 : c !== 0;
      return { t: 'b', v: r };
    }
    if (op === 0x08) return { t: 's', v: toStr(a) + toStr(b) };
    const x = toNum(a), y = toNum(b);
    if (x.t === 'e') return x;
    if (y.t === 'e') return y;
    let v;
    switch (op) {
      case 0x03: v = x.v + y.v; break;
      case 0x04: v = x.v - y.v; break;
      case 0x05: v = x.v * y.v; break;
      case 0x06: if (y.v === 0) return { t: 'e', v: ERR.DIV0 }; v = x.v / y.v; break;
      case 0x07: v = Math.pow(x.v, y.v); if (!isFinite(v)) return { t: 'e', v: ERR.NUM }; break;
    }
    return { t: 'n', v };
  }
  function numbersOf(args, cells, val, direct) {
    const out = [];
    for (const a of args) {
      const list = cells(a);
      if (list) { for (const v of list) { if (v.t === 'e') return v; if (v.t === 'n') out.push(v.v); } }
      else {
        const v = val(a);
        if (v.t === 'miss') continue;
        const n = direct ? toNum(v) : v;
        if (n.t === 'e') return n;
        if (n.t === 'n') out.push(n.v);
      }
    }
    return out;
  }
  function fnSum(args, cells, val) { const ns = numbersOf(args, cells, val, true); if (!Array.isArray(ns)) return ns; return { t: 'n', v: ns.reduce((s, x) => s + x, 0) }; }
  function critMatch(crit) {
    let op = '=', rhs = crit;
    if (crit.t === 's') {
      const mm = /^(<=|>=|<>|=|<|>)(.*)$/s.exec(crit.v);
      if (mm) { op = mm[1]; rhs = { t: 's', v: mm[2] }; }
      if (rhs.t === 's' && rhs.v.trim() !== '' && !isNaN(Number(rhs.v))) rhs = { t: 'n', v: Number(rhs.v) };
    }
    if (crit.t === 'blank' || crit.t === 'miss') rhs = { t: 'n', v: 0 };
    return v => {
      if (rhs.t === 's' && op === '=' ) {
        if (rhs.v === '') return v.t === 'blank' || (v.t === 's' && v.v === '');
        if (v.t !== 's') return false;
        const re = new RegExp('^' + rhs.v.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?') + '$', 'is');
        return re.test(v.v);
      }
      if (rhs.t === 's' && op === '<>') { if (rhs.v === '') return !(v.t === 'blank' || (v.t === 's' && v.v === '')); return !(v.t === 's' && v.v.toLowerCase() === rhs.v.toLowerCase()); }
      if (v.t !== rhs.t) return op === '<>';
      const c = compare(v, rhs);
      return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
    };
  }
  function callFn(f, args, cells, val) {
    switch (f) {
      case 1: { // IF
        const c = toBool(val(args[0]));
        if (c.t === 'e') return c;
        if (c.v) { const r = args.length > 1 ? val(args[1]) : { t: 'b', v: true }; return r.t === 'miss' ? { t: 'n', v: 0 } : r; }
        if (args.length < 3) return { t: 'b', v: false };
        const r = val(args[2]); return r.t === 'miss' ? { t: 'n', v: 0 } : r;
      }
      case 4: return fnSum(args, cells, val);
      case 5: { const ns = numbersOf(args, cells, val, true); if (!Array.isArray(ns)) return ns; return ns.length ? { t: 'n', v: ns.reduce((s, x) => s + x, 0) / ns.length } : { t: 'e', v: ERR.DIV0 }; }
      case 6: case 7: { const ns = numbersOf(args, cells, val, true); if (!Array.isArray(ns)) return ns; return { t: 'n', v: ns.length ? (f === 6 ? Math.min(...ns) : Math.max(...ns)) : 0 }; }
      case 0: { let n = 0; for (const a of args) { const l = cells(a); if (l) n += l.filter(v => v.t === 'n').length; else if (val(a).t === 'n') n++; } return { t: 'n', v: n }; }
      case 169: { let n = 0; for (const a of args) { const l = cells(a); if (l) n += l.filter(v => v.t !== 'blank').length; else if (val(a).t !== 'miss') n++; } return { t: 'n', v: n }; }
      case 24: case 25: case 26: {
        const a = toNum(val(args[0])); if (a.t === 'e') return a;
        return { t: 'n', v: f === 24 ? Math.abs(a.v) : f === 25 ? Math.floor(a.v) : Math.sign(a.v) };
      }
      case 27: { const a = toNum(val(args[0])), d = toNum(val(args[1])); if (a.t === 'e') return a; if (d.t === 'e') return d; const k = Math.pow(10, Math.trunc(d.v)); return { t: 'n', v: Math.sign(a.v) * Math.round(Math.abs(a.v) * k + 1e-9) / k }; }
      case 36: case 37: {
        let any = false, all = true, seen = false;
        for (const a of args) {
          const l = cells(a) || [val(a)];
          for (const v of l) { if (v.t === 'blank' || v.t === 'miss' || v.t === 's') continue; const b = toBool(v); if (b.t === 'e') return b; seen = true; any = any || b.v; all = all && b.v; }
        }
        if (!seen) return { t: 'e', v: ERR.VALUE };
        return { t: 'b', v: f === 36 ? all : any };
      }
      case 38: { const b = toBool(val(args[0])); return b.t === 'e' ? b : { t: 'b', v: !b.v }; }
      case 129: { const a = args[0]; const v = (a.k === 'ref' || a.k === 'area') ? val(a) : a; return { t: 'b', v: v.t === 'blank' }; }
      case 346: {
        const list = cells(args[0]); if (!list) return { t: 'e', v: ERR.VALUE };
        const test = critMatch(val(args[1]));
        return { t: 'n', v: list.filter(test).length };
      }
    }
    throw new Unsupported('fn ' + f);
  }

  // Ricalcola le formule del foglio (come farebbe Excel) e aggiorna i valori memorizzati che cambiano.
  function recalc(m) {
    const formulas = [];
    for (const b of m.blocks) for (const c of b.cells) if (c.sid === SID.FORMULA) formulas.push(c);
    const same = (x, y) => {
      if (x.t === 'n' && y.t === 'n') return x.v === y.v || Math.abs(x.v - y.v) <= 1e-12 * Math.max(1, Math.abs(x.v));
      return sameVal(x, y);
    };
    const unsupported = new Set();
    const updated = new Set();
    for (let pass = 0; pass < 25; pass++) {
      let changed = false;
      for (const f of formulas) {
        if (unsupported.has(f)) continue;
        let v;
        try { v = evaluate(m, f); }
        catch (e) { if (!(e instanceof Unsupported)) throw e; unsupported.add(f); continue; }
        if (!same(v, cellValue(m, f.row, f.col))) { setFormulaCache(m, f.row, f.col, v); updated.add(f); changed = true; }
      }
      if (!changed) break;
    }
    return { updated: updated.size, skipped: [...unsupported].map(f => colName(f.col) + (f.row + 1)) };
  }

  // ---------------------------------------------------------- Serialize ----
  function serialize(book, model, addUncalced = true) {
    const { recs, sheets } = book;
    const out = []; // {sid, data, oldOff, tag}
    const push = (sid, data, oldOff, tag) => out.push({ sid, data, oldOff, tag });
    const sh = model ? model.sh : null;
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (sh && i === sh.start) {
        for (const x of model.before) {
          push(x.sid, x.data, x.off);
          if (addUncalced && x.sid === SID.BOF && x === model.before[0] && !model.before.some(y => y.sid === SID.UNCALCED)) push(SID.UNCALCED, new Uint8Array(2), null);
        }
        model.blocks.forEach(b => {
          b.rows.forEach(rw => push(SID.ROW, rw.data, null, { rowOf: b }));
          b.cells.forEach(c => {
            push(c.sid, c.data, null, { cellOf: b, row: c.row });
            c.extra.forEach(x => push(x.sid, x.data, null, { cellOf: b, row: c.row }));
          });
          if (b.dbOld) push(SID.DBCELL, new Uint8Array(4 + 2 * b.rows.length), b.dbOld.off, { dbcell: b });
        });
        for (const x of model.after) push(x.sid, x.data, x.off);
        i = sh.end;
        continue;
      }
      push(r.sid, r.data, r.off);
    }
    // posizioni
    let pos = 0;
    const map = new Map();
    for (const o of out) { o.newOff = pos; if (o.oldOff !== null && o.oldOff !== undefined) map.set(o.oldOff, pos); pos += 4 + o.data.length; }
    const total = pos + book.tail.length;
    const mapOff = old => {
      if (map.has(old)) return map.get(old);
      let best = null;
      for (const [k, v] of map) if (k >= old && (best === null || k < best[0])) best = [k, v];
      if (!best) throw new XlsError('Impossibile ricalcolare gli indici del file.');
      return best[1] - (best[0] - old);
    };
    // DBCELL del foglio modificato
    if (model) {
      model.blocks.filter(b => b.dbOld && b.rows.length).forEach(b => {
        const rowsRecs = out.filter(o => o.tag && o.tag.rowOf === b);
        const cellRecs = out.filter(o => o.tag && o.tag.cellOf === b);
        const db = out.find(o => o.tag && o.tag.dbcell === b);
        const d = db.data;
        const first = rowsRecs[0].newOff;
        wr32(d, 0, db.newOff - first);
        // come Excel: per ogni riga, distanza tra l'inizio delle sue celle e quello della riga precedente
        // (la prima distanza parte dal secondo record ROW; una riga senza celle "inizia" dove inizierebbe)
        let ref = first + 20;
        let cur = rowsRecs[rowsRecs.length - 1].newOff + 4 + rowsRecs[rowsRecs.length - 1].data.length;
        b.rows.forEach((rw, i) => {
          wr16(d, 4 + i * 2, cur - ref);
          ref = cur;
          for (const o of cellRecs) if (o.tag.row === rw.rw) cur += 4 + o.data.length;
        });
      });
    }
    // BOUNDSHEET e INDEX
    const buf = new Uint8Array(total);
    for (const o of out) {
      let d = o.data;
      if (o.sid === SID.BOUNDSHEET) { d = d.slice(); wr32(d, 0, mapOff(rd32(d, 0))); }
      else if (o.sid === SID.INDEX) {
        d = d.slice();
        wr32(d, 12, mapOff(rd32(d, 12)));
        for (let k = 16; k + 4 <= d.length; k += 4) wr32(d, k, mapOff(rd32(d, k)));
      }
      wr16(buf, o.newOff, o.sid); wr16(buf, o.newOff + 2, d.length);
      buf.set(d, o.newOff + 4);
    }
    buf.set(book.tail, pos);
    return buf;
  }

  // ------------------------------------------------------------- Public ----
  const ROLES = ['P', 'D', 'C', 'A'];

  function looksLikeTeamSheet(book, sh) {
    if (sh.type !== 0) return false;
    let ok = 0;
    try {
      const m = buildSheet(book, sh);
      for (let r = 0; r < 31; r++) {
        const a = cellValue(m, r, 0), b = cellValue(m, r, 1);
        if (a.t === 'n' && a.v === r + 1 && b.t === 's' && ROLES.includes(b.v.trim().toUpperCase())) ok++;
      }
      const h = m.idx.get(key(4, 8));
      return ok >= 25 && !!h && h.sid === SID.FORMULA;
    } catch (e) { return false; }
  }

  function load(u8) {
    const book = openWorkbook(u8);
    const teamSheets = book.sheets.filter(s => looksLikeTeamSheet(book, s)).map(s => s.name);
    return {
      sheetNames: teamSheets,
      allSheets: book.sheets.map(s => s.name),
      roster(name) { return readRoster(book, name); },
      clubs() { return readListone(book); },
      has(name) { return book.sheets.some(s => s.name === name); },
      // Lettura libera di un foglio: serve al file di giornata (classifiche, calendario, voti...)
      grid(name) {
        const m = buildSheet(book, sheetByName(book, name));
        const get = (r, c) => { const v = freshValue(m, r, c); return v.t === 'blank' || v.t === 'e' ? null : v.v; };
        return {
          get,
          num(r, c) { const v = get(r, c); return typeof v === 'number' ? v : null; },
          str(r, c) { const v = get(r, c); return typeof v === 'string' ? v.trim() : (v == null || v === false ? '' : String(v)); },
          // cerca un testo nella zona indicata e ritorna {r, c}
          find(re, r0, r1, c0, c1) {
            for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
              const v = get(r, c);
              if (typeof v === 'string' && re.test(v.trim())) return { r, c };
            }
            return null;
          },
          findAll(re, r0, r1, c0, c1) {
            const out = [];
            for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
              const v = get(r, c);
              if (typeof v === 'string' && re.test(v.trim())) out.push({ r, c });
            }
            return out;
          }
        };
      },
      build(name, numbers) { return buildFile(book, name, numbers); },
      _book: book
    };
  }

  function sheetByName(book, name) {
    const sh = book.sheets.find(s => s.name === name);
    if (!sh) throw new XlsError('Foglio "' + name + '" non trovato.');
    return sh;
  }

  // Valore "fresco" di una cella: se è una formula valutabile la ricalcola (utile con file salvati
  // da programmi che non memorizzano i risultati testuali), altrimenti usa il valore memorizzato.
  function freshValue(m, r, c) {
    const cell = m.idx.get(key(r, c));
    if (cell && cell.sid === SID.FORMULA && !m.dirtyCells.has(key(r, c))) {
      try { return evaluate(m, cell); } catch (e) { if (!(e instanceof Unsupported)) throw e; }
    }
    return cellValue(m, r, c);
  }

  function readRoster(book, name) {
    const m = buildSheet(book, sheetByName(book, name));
    const players = [];
    for (let r = 0; r < 31; r++) {
      const a = freshValue(m, r, 0), b = freshValue(m, r, 1), c = freshValue(m, r, 2), d = cellValue(m, r, 3);
      players.push({
        row: r,
        a: a.t === 'n' ? a.v : r + 1,
        role: b.t === 's' ? b.v.trim().toUpperCase() : '',
        name: c.t === 's' ? c.v.trim() : (c.t === 'n' ? String(c.v) : ''),
        number: d.t === 'n' ? d.v : null
      });
    }
    return players;
  }

  // Listone: un foglio con le colonne Ruolo | Nome | Squadra. Serve solo a sapere
  // in che squadra di Serie A gioca chi è in rosa (per il blocco partita per partita).
  // Ritorna una mappa "nome|ruolo" -> squadra, più la chiave "nome" da sola.
  const plainName = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[.'`’-]/g, ' ').replace(/\s+/g, ' ').trim();

  function readListone(book) {
    const out = new Map();
    for (const sh of book.sheets) {
      if (sh.type !== 0) continue;
      let m;
      try { m = buildSheet(book, sh); } catch (e) { continue; }
      let head = -1;
      for (let r = 0; r < 6 && head < 0; r++) {
        const a = cellValue(m, r, 0), b = cellValue(m, r, 1), c = cellValue(m, r, 2);
        if (a.t === 's' && b.t === 's' && c.t === 's' &&
            /ruol/i.test(a.v) && /nom/i.test(b.v) && /squadr/i.test(c.v)) head = r;
      }
      if (head < 0) continue;
      let vuote = 0;
      for (let r = head + 1; vuote < 40 && r < head + 2000; r++) {
        const ro = freshValue(m, r, 0), nm = freshValue(m, r, 1), cl = freshValue(m, r, 2);
        const name = nm.t === 's' ? nm.v.trim() : '';
        const club = cl.t === 's' ? cl.v.trim() : '';
        if (!name || !club) { vuote++; continue; }
        vuote = 0;
        const role = ro.t === 's' ? ro.v.trim().toUpperCase() : '';
        const k = plainName(name);
        out.set(k + '|' + role, club);
        if (!out.has(k)) out.set(k, club);
      }
    }
    return out;
  }

  // numbers: array di 31 elementi (numero o null) per le righe 1..31 della colonna D.
  function buildFile(book, name, numbers) {
    const sh = sheetByName(book, name);
    const m = buildSheet(book, sh);
    // 0) allinea i valori memorizzati delle formule in A1:G31 (se il file li ha persi)
    for (let r = 0; r < 31; r++) for (let c = 0; c < 7; c++) {
      if (c === 3) continue;
      const cell = m.idx.get(key(r, c));
      if (!cell || cell.sid !== SID.FORMULA) continue;
      const f = freshValue(m, r, c);
      if (!sameVal(f, cellValue(m, r, c))) setFormulaCache(m, r, c, f);
    }
    // 1) colonna D
    for (let r = 0; r < 31; r++) {
      const n = numbers[r];
      setValue(m, r, 3, n === null || n === undefined || n === '' ? { t: 'blank' } : { t: 'n', v: +n });
    }
    // 2) replica della macro "Formazioni": ordina A1:G31 per D (vuoti in fondo) poi A,
    //    copia valori B1:C22 -> H31:I52 e F1:G22 -> J31:K52
    const rows = [];
    for (let r = 0; r < 31; r++) {
      const vals = [];
      for (let c = 0; c < 7; c++) vals.push(cellValue(m, r, c));
      rows.push({ r, vals });
    }
    const sortKey = v => v.t === 'blank' ? [4] : v.t === 'n' ? [0, v.v] : v.t === 's' ? [1, v.v.toLowerCase()] : v.t === 'b' ? [2, +v.v] : [3, 0];
    const cmpKeys = (x, y) => {
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if (x[i] === undefined) return -1;
        if (y[i] === undefined) return 1;
        if (x[i] < y[i]) return -1;
        if (x[i] > y[i]) return 1;
      }
      return 0;
    };
    rows.sort((p, q) => cmpKeys(sortKey(p.vals[3]), sortKey(q.vals[3])) || cmpKeys(sortKey(p.vals[0]), sortKey(q.vals[0])) || p.r - q.r);
    const pasteVal = v => (v.t === 'n' || v.t === 's' || v.t === 'b') ? (v.t === 'b' ? { t: 'n', v: +v.v } : v) : { t: 'blank' };
    for (let i = 0; i < 22; i++) {
      const src = rows[i].vals;
      setValue(m, 30 + i, 7, pasteVal(src[1]));
      setValue(m, 30 + i, 8, pasteVal(src[2]));
      setValue(m, 30 + i, 9, pasteVal(src[5]));
      setValue(m, 30 + i, 10, pasteVal(src[6]));
    }
    // 3) aggiorna i valori calcolati delle formule che dipendono dalle celle cambiate
    const rc = recalc(m);
    // 4) serializza
    const wb = serialize(book, m);
    const outFile = cfbReplaceStream(book.cfb, book.ent, wb);
    // 5) verifica: rileggi il file e controlla le celle scritte
    const check = openWorkbook(outFile);
    const m2 = buildSheet(check, sheetByName(check, name));
    for (let r = 0; r < 31; r++) {
      const d = cellValue(m2, r, 3);
      const want = numbers[r];
      if ((want === null || want === undefined || want === '') ? d.t !== 'blank' : !(d.t === 'n' && d.v === +want)) throw new XlsError('Verifica fallita sulla cella D' + (r + 1) + '.');
    }
    for (const s of check.sheets) if (check.recs[s.start].sid !== SID.BOF) throw new XlsError('Verifica fallita sugli indici dei fogli.');
    const lineup = [];
    for (let i = 0; i < 22; i++) {
      const h = cellValue(m2, 30 + i, 7), n = cellValue(m2, 30 + i, 8);
      lineup.push({ pos: i + 1, role: h.t === 's' ? h.v : '', name: n.t === 's' ? n.v : '' });
    }
    const shown = [];
    for (let r = 4; r <= 28; r++) { const v = cellValue(m2, r, 8); shown.push(v.t === 's' ? v.v : v.t === 'n' ? String(v.v) : ''); }
    const modulo = [cellValue(m2, 1, 8), cellValue(m2, 1, 9), cellValue(m2, 1, 10)].map(v => v.t === 'n' ? v.v : null);
    return { bytes: outFile, lineup, shown, modulo, recalc: rc };
  }

  const api = { load, XlsError, norm: plainName, _internals: { readCFB, openWorkbook, buildSheet, serialize, cfbReplaceStream, cellValue, recalc, parseRecords, evaluate, SID } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XlsFormazione = api;
})(typeof window !== 'undefined' ? window : globalThis);
