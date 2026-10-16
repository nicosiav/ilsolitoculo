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
// anni di contratto dal divisore della formula del secondo numero (la penale) in ROSE
{
  const conAnno = d.rose.filter(r => r.anno);
  assert.ok(conAnno.length === d.rose.length, 'anni di contratto: ' + conAnno.length + ' di ' + d.rose.length);
  conAnno.forEach(r => assert.strictEqual(Math.round(r.costo / (r.anno + 2)), r.valore, 'penale di ' + r.nome));
  const per = [1, 2, 3].map(a => conAnno.filter(r => r.anno === a).length);
  console.log('ok  anni di contratto: 1° ' + per[0] + ', 2° ' + per[1] + ', 3° ' + per[2] + '; penale = costo / (anno + 2) per tutti');
}
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
assert.ok(rec.piu_alto.length && rec.piu_basso.length && rec.piu_alto[0].v >= rec.piu_basso[0].v && rec.vittoria_larga.length && rec.piu_gol.length);
// a pari merito: tutti, con lo stesso valore
['piu_alto', 'piu_basso', 'piu_gol', 'sconfitta_beffa', 'vittoria_fortuna'].forEach(k => {
  const vv = rec[k].map(x => k === 'piu_gol' ? x.gol_casa + x.gol_fuori : x.v);
  assert.ok(vv.every(v => v === vv[0]), k + ': valori diversi fra i pari merito');
});
{
  const finti = [{ round: 1, casa: 'a', fuori: 'b', gol_casa: 2, gol_fuori: 0 }, { round: 2, casa: 'c', fuori: 'd', gol_casa: 3, gol_fuori: 1 },
    { round: 2, casa: 'a', fuori: 'c', gol_casa: 1, gol_fuori: 1 }];
  const pf = [{ round: 1, team_id: 'a', valore: 80 }, { round: 2, team_id: 'c', valore: 80 }, { round: 1, team_id: 'b', valore: 60 }];
  const r2 = C.record(finti, pf);
  assert.deepStrictEqual(r2.piu_alto.map(x => x.team_id), ['a', 'c'], 'pari merito sul punteggio più alto');
  assert.deepStrictEqual(r2.vittoria_larga.map(x => x.round), [1, 2], 'pari merito sullo scarto (2–0 e 3–1)');
  assert.deepStrictEqual(r2.piu_gol.map(x => x.casa), ['c'], 'più gol: 3–1');
  // le prime quattro giornate vere: Giuseppe (1ª–3ª) e Colombrita (2ª–4ª) 3 partite senza perdere
  const R = [['MarcoI', 2, 3, 'Giovanni'], ['Valerio', 2, 2, 'MarcoII'], ['Sebi', 2, 4, 'Massimo'], ['Colombrita', 1, 2, 'Giuseppe'],
    ['MarcoII', 1, 4, 'MarcoI'], ['Giuseppe', 1, 0, 'Giovanni'], ['Massimo', 1, 2, 'Valerio'], ['Sebi', 0, 5, 'Colombrita'],
    ['MarcoI', 1, 2, 'Sebi'], ['Giovanni', 4, 0, 'Massimo'], ['Valerio', 1, 4, 'Giuseppe'], ['Colombrita', 2, 2, 'MarcoII'],
    ['MarcoI', 3, 1, 'Valerio'], ['MarcoII', 3, 2, 'Giovanni'], ['Giuseppe', 1, 4, 'Sebi'], ['Massimo', 1, 2, 'Colombrita']]
    .map((x, i) => ({ round: Math.floor(i / 4) + 1, casa: x[0], gol_casa: x[1], gol_fuori: x[2], fuori: x[3] }));
  const sq = ['Massimo', 'Giovanni', 'Colombrita', 'Giuseppe', 'MarcoI', 'MarcoII', 'Valerio', 'Sebi'];
  const sr = C.serieRecord(R, sq);
  assert.deepStrictEqual(sr.imbattuto, { n: 3, squadre: ['Colombrita', 'Giuseppe'] }, 'senza perdere a pari merito');
  assert.deepStrictEqual(sr.vittorie, { n: 3, squadre: ['Giuseppe'] }, 'vittorie di fila');
}
const dist = C.distribuzione(cdl);
dist.forEach(x => assert.ok(x.min <= x.mediana && x.mediana <= x.max));
const pos = C.posizioni(matches, ids, []);
const ultima = Math.max(...matches.filter(m => m.gol_casa != null).map(m => m.round));
const posFinali = ids.map(id => pos.get(id).find(p => p.x === ultima).y).sort((a, b) => a - b);
assert.deepStrictEqual(posFinali, ids.map((_, i) => i + 1));
console.log('ok  serie, record (più alto ' + rec.piu_alto[0].v + ', più basso ' + rec.piu_basso[0].v + ', pari merito), distribuzione su', dist.length, 'giornate, posizioni');

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
