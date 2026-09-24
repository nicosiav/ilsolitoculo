// Estrae le rose dal file .xls della lega: serve al finto Supabase.
//   node rose.js "Formazioni.xls" > rose.json
const fs = require('fs');
const X = require('../../src/engine.js');
const wb = X.load(new Uint8Array(fs.readFileSync(process.argv[2] || 'Formazioni.xls')));
const out = {};
for (const n of wb.sheetNames) {
  out[n] = wb.roster(n).filter(p => p.name).map(p => ({ slot: p.row + 1, role: p.role, name: p.name }));
}
process.stdout.write(JSON.stringify(out));
