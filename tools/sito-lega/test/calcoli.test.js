// Prove dei calcoli delle statistiche e della lettura dell'Excel di Fantacalcio.it (Node 18+).
//   node tools/sito-lega/test/calcoli.test.js "03 Campionato - Terza Giornata.xls" [/tmp/fc_stats.xlsx]
// Il file di giornata non è nella repo; il file di Fantacalcio.it finto lo crea test/mock/fantacalcio_finto.py.
const fs = require('fs'), path = require('path'), assert = require('assert');
const G = require('../src/giornata.js'), C = require('../src/calcoli.js'), F = require('../src/fantacalcio.js');

const xls = process.argv[2];
if (!xls) { console.error('Uso: node calcoli.test.js <giornata.xls> [fc_stats.xlsx]'); process.exit(2); }
const d = G.parse(new Uint8Array(fs.readFileSync(xls)), path.basename(xls));

// 1) formazione ideale: mai meno di quanto fatto davvero, un portiere, un modulo ammesso
const voti = d.voti.map(v => ({ round: d.giornata, team_id: v.squadra, nome: v.nome, ruolo: v.ruolo, voto: v.voto, fantavoto: v.fantavoto }));
const rt = d.squadre_giornata.map(t => ({ round: d.giornata, team_id: t.squadra, punteggio: t.punteggio, formazione: t.formazione }));
const ide = C.idealePerGiornata(voti, rt);
assert.strictEqual(ide.length, d.squadre_giornata.length);
ide.forEach(x => {
  assert.ok(x.ideale >= x.fatto - 1e-9, x.team_id + ': ideale sotto il fatto');
  assert.ok(C.MODULI.some(m => m.join('-') === x.modulo_ideale), x.modulo_ideale);
});
const prova = C.formazioneIdeale([
  { ruolo: 'P', voto: 6, fantavoto: 5 }, { ruolo: 'P', voto: 7, fantavoto: 7 },
  ...[8, 7, 6, 6, 5].map(f => ({ ruolo: 'D', voto: 6, fantavoto: f })),
  ...[9, 7, 6, 6, 6].map(f => ({ ruolo: 'C', voto: 6, fantavoto: f })),
  ...[12, 9, 4].map(f => ({ ruolo: 'A', voto: 6, fantavoto: f })),
  { ruolo: 'A', voto: 0, fantavoto: 20 }          // senza voto: non conta
]);
assert.strictEqual(prova.totale, 7 + 8 + 7 + 6 + 9 + 7 + 6 + 6 + 6 + 12 + 9);   // 3-5-2
assert.strictEqual(prova.modulo, '3-5-2');
console.log('ok  formazione ideale:', ide.map(x => x.team_id + ' +' + x.lasciati).join(', '));

// 2) reparti: la somma dei reparti è il punteggio
const rep = C.reparti(rt);
rt.forEach(t => {
  const r = rep.squadre.get(t.team_id);
  assert.ok(Math.abs(r.P + r.D + r.C + r.A - t.punteggio) < 1e-6, t.team_id);
});
console.log('ok  reparti: la somma torna con il punteggio di ogni squadra');

// 3) serie, record, distribuzione, posizioni
assert.deepStrictEqual(C.serie(['v', 'v', 'n', 'p', 'v', 'v', 'v']), { vittorie: 3, imbattuto: 3, senza_vittorie: 2, sconfitte: 1, in_corso: { esito: 'v', n: 3 } });
const ids = d.squadre;
const matches = d.calendario.map(m => ({ round: m.giornata, casa: m.casa, fuori: m.fuori, gol_casa: m.gol_casa, gol_fuori: m.gol_fuori }));
const cdl = [];
((d.coppa_lega && d.coppa_lega.settimanali && d.coppa_lega.settimanali.righe) || []).forEach(r =>
  Object.keys(r.per_giornata).forEach(g => cdl.push({ round: +g, team_id: r.squadra, valore: r.per_giornata[g] })));
const rec = C.record(matches, cdl);
assert.ok(rec.piu_alto.v >= rec.piu_basso.v && rec.vittoria_larga && rec.piu_gol);
const dist = C.distribuzione(cdl);
dist.forEach(x => assert.ok(x.min <= x.mediana && x.mediana <= x.max));
const pos = C.posizioni(matches, ids, []);
const ultima = Math.max(...matches.filter(m => m.gol_casa != null).map(m => m.round));
const posFinali = ids.map(id => pos.get(id).find(p => p.x === ultima).y).sort((a, b) => a - b);
assert.deepStrictEqual(posFinali, ids.map((_, i) => i + 1));
console.log('ok  serie, record (più alto ' + rec.piu_alto.v + ', più basso ' + rec.piu_basso.v + '), distribuzione su', dist.length, 'giornate, posizioni');

// 4) l'Excel di Fantacalcio.it (finto, stessa forma del vero)
const fc = process.argv[3];
if (fc && fs.existsSync(fc)) {
  F.leggi(new Uint8Array(fs.readFileSync(fc)), path.basename(fc)).then(r => {
    assert.ok(r.righe.length > 100 && r.stagione);
    const x = r.righe[0];
    ['nome', 'squadra', 'ruolo', 'pv', 'mv', 'fm'].forEach(k => assert.ok(x[k] !== undefined, k));
    const gioc = d.rose.map((p, i) => ({ id: i, name: p.nome, role: '' }));
    const ab = F.abbina(gioc, r.righe);
    assert.ok(ab.trovati.size >= gioc.filter(g => g.name).length * 0.9);
    // nomi con accenti e iniziali scritti in modo diverso
    const ab2 = F.abbina([{ id: 1, name: 'Konè M.', role: 'C' }, { id: 2, name: 'Paz', role: 'C' }],
      [{ nome: 'Kone M.', ruolo: 'C', squadra: 'Roma' }, { nome: 'Paz N.', ruolo: 'C', squadra: 'Como' }]);
    assert.strictEqual(ab2.trovati.size, 2);
    console.log('ok  Excel di Fantacalcio.it:', r.righe.length, 'giocatori, stagione', r.stagione, '·', ab.trovati.size, 'abbinati');
  }).catch(e => { console.error(e); process.exit(1); });
}
