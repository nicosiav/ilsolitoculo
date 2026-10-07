/* Il Solito Culo — calcoli per le statistiche (funzioni pure, provabili con Node).
 * Formazione ideale, punti per reparto, serie di risultati, record della lega,
 * distribuzione dei punteggi di giornata, posizioni in classifica nel tempo. */
(function (root) {
  'use strict';

  // i moduli ammessi dal regolamento (difensori, centrocampisti, attaccanti)
  const MODULI = [[3, 4, 3], [3, 5, 2], [4, 3, 3], [4, 4, 2], [4, 5, 1], [5, 3, 2], [5, 4, 1]];
  const num = v => (v == null || v === '' || isNaN(+v) ? null : +v);
  const somma = a => a.reduce((s, x) => s + x, 0);
  const tonda = v => Math.round(v * 100) / 100;

  // Chi ha preso un voto: voto > 0 e fantavoto presente (s.v. = non conta)
  const haVoto = v => num(v.voto) != null && num(v.voto) > 0 && num(v.fantavoto) != null;

  // La formazione migliore possibile con chi ha giocato: un portiere e il modulo
  // che dà più punti. Se in un reparto mancano giocatori, quei posti valgono zero.
  function formazioneIdeale(giocatori) {
    const conVoto = (giocatori || []).filter(haVoto);
    const per = r => conVoto.filter(g => String(g.ruolo).toUpperCase() === r)
      .sort((a, b) => num(b.fantavoto) - num(a.fantavoto));
    const P = per('P'), D = per('D'), C = per('C'), A = per('A');
    let meglio = null;
    MODULI.forEach(([d, c, a]) => {
      const scelti = [].concat(P.slice(0, 1), D.slice(0, d), C.slice(0, c), A.slice(0, a));
      const totale = tonda(somma(scelti.map(g => num(g.fantavoto))));
      const mancano = 11 - scelti.length;
      if (!meglio || totale > meglio.totale || (totale === meglio.totale && mancano < meglio.mancano)) {
        meglio = { totale, modulo: d + '-' + c + '-' + a, scelti, mancano };
      }
    });
    return meglio || { totale: 0, modulo: '', scelti: [], mancano: 11 };
  }

  // Quanto ha fatto davvero la formazione: la somma dei fantavoti di chi è entrato
  function effettivo(rt) {
    if (!rt) return null;
    if (num(rt.punteggio) != null) return num(rt.punteggio);
    const f = (rt.formazione || []).filter(x => x.giocato && num(x.fantavoto) != null);
    return f.length ? tonda(somma(f.map(x => num(x.fantavoto)))) : null;
  }

  // Formazione ideale squadra per squadra, giornata per giornata.
  // voti: righe di player_votes; tabellini: righe di round_teams
  function idealePerGiornata(voti, tabellini) {
    const out = [];
    const chiave = (r, t) => r + '|' + t;
    const perSquadra = new Map();
    (voti || []).forEach(v => {
      const k = chiave(v.round, v.team_id);
      if (!perSquadra.has(k)) perSquadra.set(k, []);
      perSquadra.get(k).push(v);
    });
    (tabellini || []).forEach(rt => {
      const vv = perSquadra.get(chiave(rt.round, rt.team_id));
      const fatto = effettivo(rt);
      if (!vv || fatto == null) return;
      const id = formazioneIdeale(vv);
      if (!id.scelti.length) return;
      const lasciati = Math.max(0, tonda(id.totale - fatto));
      out.push({
        round: rt.round, team_id: rt.team_id, fatto, ideale: id.totale, modulo_ideale: id.modulo,
        lasciati, efficienza: id.totale > 0 ? Math.min(1, fatto / id.totale) : null,
        migliori_fuori: id.scelti.filter(g => !(rt.formazione || []).some(x => x.giocato && x.nome === g.nome))
          .map(g => ({ nome: g.nome, ruolo: g.ruolo, fantavoto: num(g.fantavoto) }))
      });
    });
    return out.sort((a, b) => a.round - b.round);
  }

  // Punti portati da ogni reparto (fantavoti di chi è entrato), media a giornata
  function reparti(tabellini) {
    const per = new Map();      // team_id -> { P: [..per giornata], ... }
    (tabellini || []).forEach(rt => {
      const f = (rt.formazione || []).filter(x => x.giocato && num(x.fantavoto) != null);
      if (!f.length) return;
      if (!per.has(rt.team_id)) per.set(rt.team_id, { P: [], D: [], C: [], A: [] });
      const t = per.get(rt.team_id);
      ['P', 'D', 'C', 'A'].forEach(r => t[r].push(somma(f.filter(x => String(x.ruolo).toUpperCase() === r).map(x => num(x.fantavoto)))));
    });
    const media = a => (a.length ? tonda(somma(a) / a.length) : null);
    const squadre = new Map();
    per.forEach((t, id) => squadre.set(id, { P: media(t.P), D: media(t.D), C: media(t.C), A: media(t.A), giornate: t.P.length }));
    const lega = {};
    ['P', 'D', 'C', 'A'].forEach(r => {
      const v = [...squadre.values()].map(s => s[r]).filter(x => x != null);
      lega[r] = v.length ? tonda(somma(v) / v.length) : null;
    });
    return { squadre, lega };
  }

  // Risultati di una squadra in ordine di giornata: v / n / p
  function risultati(matches, teamId) {
    return (matches || []).filter(m => m.gol_casa != null && (m.casa === teamId || m.fuori === teamId))
      .sort((a, b) => a.round - b.round)
      .map(m => {
        const casa = m.casa === teamId;
        const gf = casa ? m.gol_casa : m.gol_fuori, gs = casa ? m.gol_fuori : m.gol_casa;
        return { round: m.round, avversario: casa ? m.fuori : m.casa, casa, gf, gs, esito: gf > gs ? 'v' : gf === gs ? 'n' : 'p' };
      });
  }

  // Serie più lunghe e serie in corso
  function serie(esiti) {
    const lunga = ok => {
      let best = 0, cur = 0, fine = null;
      esiti.forEach((e, i) => { cur = ok(e) ? cur + 1 : 0; if (cur > best) { best = cur; fine = i; } });
      return { n: best, fine };
    };
    let inCorso = 0;
    const ult = esiti[esiti.length - 1];
    for (let i = esiti.length - 1; i >= 0 && esiti[i] === ult; i--) inCorso++;
    return {
      vittorie: lunga(e => e === 'v').n,
      imbattuto: lunga(e => e !== 'p').n,
      senza_vittorie: lunga(e => e !== 'v').n,
      sconfitte: lunga(e => e === 'p').n,
      in_corso: ult ? { esito: ult, n: inCorso } : null
    };
  }

  const mediana = a => {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y), k = Math.floor(s.length / 2);
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  };

  // Punteggi di giornata (Coppa di Lega) per giornata: minimo, massimo, mediana, media
  function distribuzione(punteggi) {
    const per = new Map();
    (punteggi || []).forEach(p => {
      const v = num(p.valore);
      if (v == null) return;
      if (!per.has(p.round)) per.set(p.round, []);
      per.get(p.round).push({ team_id: p.team_id, v });
    });
    return [...per.keys()].sort((a, b) => a - b).map(r => {
      const vv = per.get(r).map(x => x.v);
      return { round: r, min: Math.min.apply(null, vv), max: Math.max.apply(null, vv), mediana: tonda(mediana(vv)),
        media: tonda(somma(vv) / vv.length), squadre: per.get(r) };
    });
  }

  // Record e curiosità della stagione
  function record(matches, punteggi) {
    const giocate = (matches || []).filter(m => m.gol_casa != null && m.casa && m.fuori);
    const pt = new Map((punteggi || []).filter(p => num(p.valore) != null).map(p => [p.round + '|' + p.team_id, num(p.valore)]));
    const righe = (punteggi || []).filter(p => num(p.valore) != null).map(p => ({ round: p.round, team_id: p.team_id, v: num(p.valore) }));
    const maxBy = (a, f) => a.reduce((m, x) => (m == null || f(x) > f(m) ? x : m), null);
    const minBy = (a, f) => a.reduce((m, x) => (m == null || f(x) < f(m) ? x : m), null);
    const lati = [];
    giocate.forEach(m => {
      [[m.casa, m.gol_casa, m.gol_fuori, m.fuori], [m.fuori, m.gol_fuori, m.gol_casa, m.casa]].forEach(([t, gf, gs, avv]) => {
        const v = pt.get(m.round + '|' + t);
        lati.push({ round: m.round, team_id: t, avversario: avv, gf, gs, v });
      });
    });
    const conPunti = lati.filter(x => x.v != null);
    const sconfitte = conPunti.filter(x => x.gf < x.gs), vittorie = conPunti.filter(x => x.gf > x.gs);
    return {
      piu_alto: maxBy(righe, x => x.v),
      piu_basso: minBy(righe, x => x.v),
      vittoria_larga: maxBy(giocate, m => Math.abs(m.gol_casa - m.gol_fuori) * 100 + m.gol_casa + m.gol_fuori),
      piu_gol: maxBy(giocate, m => m.gol_casa + m.gol_fuori),
      sconfitta_beffa: maxBy(sconfitte, x => x.v),       // ha perso facendo tanti punti
      vittoria_fortuna: minBy(vittorie, x => x.v)          // ha vinto facendo pochi punti
    };
  }

  // Posizione in campionato giornata per giornata: dalla classifica fotografata se c'è,
  // altrimenti ricostruita da punti, differenza reti e gol fatti.
  function posizioni(matches, teamIds, fotografie) {
    const giornate = [...new Set((matches || []).filter(m => m.gol_casa != null).map(m => m.round))].sort((a, b) => a - b);
    const tot = new Map(teamIds.map(id => [id, { p: 0, dr: 0, gf: 0 }]));
    const out = new Map(teamIds.map(id => [id, []]));
    giornate.forEach(r => {
      (matches || []).filter(m => m.round === r && m.gol_casa != null).forEach(m => {
        const a = tot.get(m.casa), b = tot.get(m.fuori);
        if (a) { a.p += m.gol_casa > m.gol_fuori ? 3 : m.gol_casa === m.gol_fuori ? 1 : 0; a.dr += m.gol_casa - m.gol_fuori; a.gf += m.gol_casa; }
        if (b) { b.p += m.gol_fuori > m.gol_casa ? 3 : m.gol_casa === m.gol_fuori ? 1 : 0; b.dr += m.gol_fuori - m.gol_casa; b.gf += m.gol_fuori; }
      });
      const foto = (fotografie || []).filter(f => f.round === r && f.pos != null);
      const ord = teamIds.slice().sort((x, y) => {
        const a = tot.get(x), b = tot.get(y);
        return b.p - a.p || b.dr - a.dr || b.gf - a.gf;
      });
      teamIds.forEach(id => {
        const f = foto.find(x => x.team_id === id);
        out.get(id).push({ x: r, y: f ? f.pos : ord.indexOf(id) + 1 });
      });
    });
    return out;
  }

  const api = { MODULI, formazioneIdeale, effettivo, idealePerGiornata, reparti, risultati, serie, distribuzione, record, posizioni, mediana };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calcoli = api;
})(typeof window !== 'undefined' ? window : globalThis);
