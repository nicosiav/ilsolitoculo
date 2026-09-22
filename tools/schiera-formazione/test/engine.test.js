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
