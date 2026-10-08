// Test del motore .xls (Node 18+). Il file della lega non è nella repo: passalo come argomento.
//   node tools/schiera-formazione/test/engine.test.js "percorso/Formazioni.xls" [Foglio]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const E = require(path.join(__dirname, '..', 'src', 'engine.js'));
const I = E._internals;

const file = process.argv[2];
if (!file) { console.error('Uso: node engine.test.js <file.xls> [foglio]'); process.exit(2); }
const u8 = new Uint8Array(fs.readFileSync(file));

// 1) rilettura + riscrittura senza modifiche = file identico byte per byte
const book = I.openWorkbook(u8);
for (const s of book.sheets) {
  const m = I.buildSheet(book, s);
  const out = I.serialize(book, m, false);
  assert.ok(Buffer.from(out).equals(Buffer.from(book.wb)), 'stream diverso per il foglio ' + s.name);
}
assert.ok(Buffer.from(I.cfbReplaceStream(book.cfb, book.ent, book.wb)).equals(Buffer.from(u8)), 'contenitore CFB diverso');
console.log('ok  round-trip identico su', book.sheets.length, 'fogli');

// 2) il valutatore di formule riproduce tutti i valori memorizzati da Excel
book.sheets.forEach((s, i) => book.models.set(i, I.buildSheet(book, s)));
let tot = 0, bad = 0;
book.sheets.forEach((s, i) => {
  const m = book.models.get(i);
  for (const b of m.blocks) for (const c of b.cells) {
    if (c.sid !== I.SID.FORMULA) continue;
    let v; try { v = I.evaluate(m, c); } catch (e) { continue; }
    tot++;
    const cv = I.cellValue(m, c.row, c.col);
    const eq = (v.t === cv.t && (v.t === 'n' ? Math.abs(v.v - cv.v) < 1e-9 : v.v === cv.v)) || (v.t === 's' && v.v === '' && cv.t === 's' && cv.v === '');
    if (!eq) { bad++; console.log('  diverso:', s.name, c.row, c.col, v, cv); }
  }
});
assert.strictEqual(bad, 0);
console.log('ok  formule ricalcolate uguali ai valori di Excel:', tot);

// 3) schieramento completo sul foglio scelto, poi rilettura
const wb = E.load(u8);
const sheet = process.argv[3] || wb.sheetNames[0];
const roster = wb.roster(sheet);
const byRole = r => roster.filter(p => p.name && p.role === r).map(p => p.row);
const P = byRole('P'), D = byRole('D'), C = byRole('C'), A = byRole('A');
const order = [P[0], D[0], D[1], D[2], C[0], C[1], C[2], C[3], A[0], A[1], A[2], P[1], D[3], D[4], C[4], C[5], A[3], A[4]].filter(x => x !== undefined);
const nums = Array(31).fill(null);
order.forEach((row, i) => { nums[row] = i + 1; });
const res = wb.build(sheet, nums);
const again = E.load(res.bytes).roster(sheet);
order.forEach((row, i) => assert.strictEqual(again[row].number, i + 1));
assert.strictEqual(res.lineup[0].name, roster[order[0]].name);
assert.deepStrictEqual(res.modulo, [3, 4, 3]);
console.log('ok  formazione scritta e riletta sul foglio', sheet, '(modulo', res.modulo.join('-') + ')');

// 4) tutte le squadre in un solo file: metà schierate, metà con il foglio vuoto
const voci = wb.sheetNames.map((name, k) => {
  const ro = wb.roster(name);
  const per = r => ro.filter(p => p.name && p.role === r).map(p => p.row);
  const p4 = per('P'), d4 = per('D'), c4 = per('C'), a4 = per('A');
  const ord = [p4[0], d4[0], d4[1], d4[2], d4[3], c4[0], c4[1], c4[2], a4[0], a4[1], a4[2]].filter(x => x !== undefined);
  const n = Array(31).fill(null);
  ord.forEach((row, i) => { n[row] = i + 1; });
  return { name, numbers: n, vuoto: k % 2 === 1, ord };
});
const tutte = wb.buildMany(voci);
const riletto = E.load(tutte.bytes);
voci.forEach(v => {
  const ro = riletto.roster(v.name);
  if (v.vuoto) {
    assert.ok(ro.every(p => p.number == null), 'colonna D non vuota nel foglio ' + v.name);
  } else {
    v.ord.forEach((row, i) => assert.strictEqual(ro[row].number, i + 1, v.name));
  }
});
const f0 = tutte.fogli.find(f => !f.vuoto), f1 = tutte.fogli.find(f => f.vuoto);
assert.deepStrictEqual(f0.modulo, [4, 3, 3]);
assert.ok(f1.lineup.every(x => !x.name), 'formazione "finta" nel foglio vuoto ' + f1.name);
// i fogli non toccati restano identici
const b1 = I.openWorkbook(u8), b2 = I.openWorkbook(tutte.bytes);
b1.sheets.filter(s => !voci.some(v => v.name === s.name)).forEach(s => {
  // (i record INDEX hanno posizioni assolute: cambiano se un foglio prima cambia lunghezza)
  const recA = b1.recs.slice(s.start, s.end + 1).filter(r => r.sid !== I.SID.INDEX).map(r => Buffer.from(r.data).toString('hex')).join('|');
  const s2 = b2.sheets.find(x => x.name === s.name);
  const recB = b2.recs.slice(s2.start, s2.end + 1).filter(r => r.sid !== I.SID.INDEX).map(r => Buffer.from(r.data).toString('hex')).join('|');
  assert.strictEqual(recA, recB, 'foglio cambiato: ' + s.name);
});
console.log('ok  tutte le formazioni in un file:', voci.filter(v => !v.vuoto).length, 'schierate,', voci.filter(v => v.vuoto).length, 'vuote');

// 5) mercato: nel modello cambia il foglio ROSE (nome, costo, crediti) e il LISTONE;
//    il foglio squadra prende il nome nuovo (formula su ROSE) e il resto del file non cambia
if (wb.allSheets.includes('ROSE') && wb.allSheets.includes('LISTONE')) {
  const g = wb.grid('ROSE');
  let col = -1;
  for (let b = 0; b < 12 && col < 0; b++) if (E.norm(g.str(0, b * 3)) === E.norm(sheet)) col = b * 3;
  const ro = wb.roster(sheet);
  const chi = ro.find(p => p.name && g.str(p.row + 1, col) === p.name);
  if (col >= 0 && chi) {
    const L = wb.grid('LISTONE');
    const nuovo = L.str(1, 1);
    const bytes = wb.modifica([
      { foglio: 'ROSE', r: chi.row + 1, c: col, v: nuovo }, { foglio: 'ROSE', r: chi.row + 1, c: col + 1, v: 7 },
      { foglio: 'ROSE', r: chi.row + 1, c: col + 2, v: null }, { foglio: 'ROSE', r: 0, c: col + 1, v: 41 },
      { foglio: 'LISTONE', r: 1, c: 1, v: chi.name }
    ], [sheet]);
    const w2 = E.load(bytes);
    assert.strictEqual(w2.roster(sheet)[chi.row].name, nuovo, 'il foglio squadra non ha preso il nome nuovo');
    assert.strictEqual(w2.grid('ROSE').num(0, col + 1), 41);
    assert.strictEqual(w2.grid('LISTONE').str(1, 1), chi.name);
    const c2 = I.openWorkbook(bytes);
    b1.sheets.filter(s => !['ROSE', 'LISTONE', sheet].includes(s.name)).forEach(s => {
      // (i record INDEX contengono posizioni assolute nel file: si spostano se ROSE cambia lunghezza)
      const firma = (bk, x) => bk.recs.slice(x.start, x.end + 1).filter(r => r.sid !== I.SID.INDEX).map(r => Buffer.from(r.data).toString('hex')).join('|');
      assert.strictEqual(firma(b1, s), firma(c2, c2.sheets.find(x => x.name === s.name)), 'foglio cambiato: ' + s.name);
    });
    // dal modello aggiornato si scarica ancora una formazione
    const n = Array(31).fill(null); n[chi.row] = 1;
    assert.strictEqual(w2.build(sheet, n).lineup[0].name, nuovo);
    console.log('ok  mercato nel modello:', chi.name, '→', nuovo, 'nel foglio', sheet);
  }
}
