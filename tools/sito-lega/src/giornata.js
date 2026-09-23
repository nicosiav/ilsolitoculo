/* Lettura del file .xls di giornata della lega ("03 Campionato - Terza Giornata.xls").
 *
 * Da un solo file escono tutti i dati del sito: voti dei giocatori, risultati e
 * calendario, formazioni realmente schierate con subentri e marcatori,
 * classifiche, superclassifica, gol reali, rose e crediti.
 *
 * Nessuna libreria: legge i fogli con il motore .xls già usato da Schiera.
 * I fogli non vengono cercati per posizione fissa ma per intestazione, così il
 * file può cambiare qualche riga senza rompere tutto.
 */
(function (root) {
  'use strict';

  const X = root.XlsFormazione || (typeof require === 'function' ? require('../../schiera-formazione/src/engine.js') : null);

  class GiornataError extends Error {}

  const NOSPACE = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
  const txt = v => (typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : ''));

  // I fogli squadra del file: quelli con la rosa numerata 1..31
  function teamSheets(wb) {
    return wb.sheetNames.slice();
  }

  // ------------------------------------------------------------------ voti
  // Foglio "voti": ID | SQUADRA | RUOLO | NOME | V | FV
  function readVoti(wb) {
    if (!wb.has('voti')) return [];
    const g = wb.grid('voti');
    const out = [];
    for (let r = 1; r < 600; r++) {
      const id = g.num(r, 0);
      if (id == null) break;
      const nome = g.str(r, 3);
      if (!nome) continue;
      out.push({
        squadra: g.str(r, 1),
        ruolo: g.str(r, 2).toUpperCase(),
        nome,
        voto: g.num(r, 4),
        fantavoto: g.num(r, 5)
      });
    }
    return out;
  }

  // ------------------------------------------------------------- calendario
  // Blocchi "GIORNATA n" con 4 partite: casa | trasferta | gol | gol.
  // Nella fase a orologio, finché la classifica non è definitiva, al posto dei
  // nomi ci sono le posizioni (1..8): le teniamo come sono.
  function readCalendario(wb) {
    if (!wb.has('CALENDARIO')) return [];
    const g = wb.grid('CALENDARIO');
    const out = [];
    g.findAll(/^GIORNATA$/i, 0, 60, 0, 24).forEach(({ r, c }) => {
      const n = g.num(r, c + 2);
      if (n == null) return;
      for (let k = 3; k <= 6; k++) {
        const casa = g.get(r + k, c), fuori = g.get(r + k, c + 1);
        if (casa == null && fuori == null) continue;
        const gc = g.num(r + k, c + 2), gf = g.num(r + k, c + 3);
        out.push({
          giornata: n,
          casa: typeof casa === 'number' ? null : txt(casa),
          fuori: typeof fuori === 'number' ? null : txt(fuori),
          pos_casa: typeof casa === 'number' ? casa : null,
          pos_fuori: typeof fuori === 'number' ? fuori : null,
          gol_casa: gc, gol_fuori: gf,
          giocata: gc != null && gf != null
        });
      }
    });
    out.sort((a, b) => a.giornata - b.giornata);
    return out;
  }

  // -------------------------------------------------- foglio di una squadra
  // Restituisce formazione risultante, punteggi, sostituzioni e marcatori.
  function readTeamSheet(wb, name) {
    const g = wb.grid(name);

    // rosa + numeri schierati + voti (colonne A..G)
    const rosa = [];
    for (let r = 0; r < 31; r++) {
      const nome = g.str(r, 2);
      rosa.push({
        slot: r + 1,
        ruolo: g.str(r, 1).toUpperCase(),
        nome,
        numero: g.num(r, 3),
        voto: g.num(r, 5),
        fantavoto: g.num(r, 6)
      });
    }

    // blocco del risultato: "Nome | Voto | Fantavoto" con i 18 posti in ordine
    const head = g.find(/^Nome$/i, 0, 12, 6, 14);
    const formazione = [];
    let totali = null;
    if (head) {
      const c = head.c;                     // colonna dei nomi
      for (let k = 1; k <= 24; k++) {
        const r = head.r + k;
        const et = g.str(r, c);
        if (/^totale$/i.test(et)) {
          totali = { voti: g.num(r, c + 1), fantavoti: g.num(r, c + 2), avversario: g.num(r, c + 3) };
          break;
        }
        if (!et) continue;
        formazione.push({
          pos: formazione.length + 1,
          ruolo: g.str(r, c - 1).toUpperCase(),
          nome: et,
          voto: g.num(r, c + 1),
          fantavoto: g.num(r, c + 2),
          giocato: g.num(r, c + 2) != null
        });
      }
    }

    // riquadro della partita: l'etichetta "Coppa di Lega" con i due valori a fianco
    const partita = { casa: null, fuori: null };
    const lab = g.find(/^Coppa di Lega$/i, 0, 14, 10, 20);
    if (lab) {
      const c = lab.c, r = lab.r;
      const nomi = [g.str(r - 1, c + 1), g.str(r - 1, c + 2)];
      const leggi = re => { const x = g.find(re, r - 1, r + 12, c, c + 1); return x ? [g.num(x.r, c + 1), g.num(x.r, c + 2)] : [null, null]; };
      const cdl = [g.num(r, c + 1), g.num(r, c + 2)];
      const campo = leggi(/^Fattore campo$/i);
      const modulo = leggi(/^Modulo$/i);
      const totale = leggi(/^Totale$/i);
      const risultato = leggi(/^RISULTATO$/i);
      partita.casa = { squadra: nomi[0], punteggio: cdl[0], fattore_campo: campo[0], bonus_modulo: modulo[0], totale: totale[0], gol: risultato[0] };
      partita.fuori = { squadra: nomi[1], punteggio: cdl[1], fattore_campo: campo[1], bonus_modulo: modulo[1], totale: totale[1], gol: risultato[1] };
    }

    // sostituzioni per reparto
    const sost = {};
    const sl = g.find(/^Sostituzioni$/i, 0, 30, 10, 20);
    if (sl) {
      const mappa = { 'portieri:': 'P', 'difensori:': 'D', 'centrocampisti:': 'C', 'attaccanti:': 'A', 'totale:': 'tot' };
      for (let k = 1; k <= 8; k++) {
        const et = g.str(sl.r + k, sl.c).toLowerCase();
        const key = mappa[et];
        if (key) sost[key] = g.num(sl.r + k, sl.c + 1);
      }
    }

    // marcatori: una riga con i nomi separati da virgola, oppure un nome per riga
    const marcatori = [];
    const ml = g.find(/^Marcatori$/i, 0, 40, 10, 20);
    if (ml) {
      for (let k = 1; k <= 12; k++) {
        const v = g.str(ml.r + k, ml.c);
        if (!v) { if (k > 1) break; else continue; }
        v.split(',').forEach(x => { if (x.trim()) marcatori.push(x.trim()); });
      }
    }

    const modulo = (() => {
      const m = g.find(/^Modulo$/i, 0, 4, 6, 14);
      if (!m) return '';
      const a = g.num(m.r + 1, m.c - 1), b = g.num(m.r + 1, m.c), c = g.num(m.r + 1, m.c + 1);
      return [a, b, c].every(x => x != null) ? [a, b, c].join('-') : '';
    })();

    return { squadra: name, rosa, formazione, totali, partita, sostituzioni: sost, marcatori, modulo };
  }

  // ------------------------------------------------------------- classifiche
  function readClassifiche(wb) {
    const out = { giornata: null, campionato: [], coppa_lega: null, sfigometro: null, cannonieri: [] };
    if (!wb.has('CLASSIFICHE')) return out;
    const g = wb.grid('CLASSIFICHE');

    const camp = g.find(/^CAMPIONATO$/i, 0, 6, 0, 3);
    if (camp) {
      out.giornata = g.num(camp.r, camp.c + 4);
      for (let k = 3; k <= 12; k++) {
        const nome = g.str(camp.r + k, 0);
        if (!nome) continue;
        if (g.num(camp.r + k, 3) == null) continue;
        out.campionato.push({
          squadra: nome,
          punti: g.num(camp.r + k, 1), mi: g.num(camp.r + k, 2),
          g: g.num(camp.r + k, 3), v: g.num(camp.r + k, 4), n: g.num(camp.r + k, 5), p: g.num(camp.r + k, 6),
          gf: g.num(camp.r + k, 7), gs: g.num(camp.r + k, 8), dr: g.num(camp.r + k, 9),
          casa: { g: g.num(camp.r + k, 10), v: g.num(camp.r + k, 11), n: g.num(camp.r + k, 12), p: g.num(camp.r + k, 13), gf: g.num(camp.r + k, 14), gs: g.num(camp.r + k, 15) },
          fuori: { g: g.num(camp.r + k, 16), v: g.num(camp.r + k, 17), n: g.num(camp.r + k, 18), p: g.num(camp.r + k, 19), gf: g.num(camp.r + k, 20), gs: g.num(camp.r + k, 21) }
        });
      }
    }

    // Coppa di Lega e Sfigometro: due tabelle uguali (settimanali + totali)
    const serie = (titolo) => {
      const h = g.find(titolo, 0, 120, 0, 2);
      if (!h) return null;
      const blocco = (re) => {
        const b = g.find(re, h.r, h.r + 20, 0, 2);
        if (!b) return null;
        const giornate = [];
        for (let c = 7; c < 30; c++) { const n = g.num(b.r, c); if (n == null) break; giornate.push({ n, c }); }
        const righe = [];
        for (let k = 1; k <= 12; k++) {
          const squadra = g.str(b.r + k, 5);
          if (!squadra) continue;
          const per = {};
          giornate.forEach(({ n, c }) => { const v = g.num(b.r + k, c); if (v != null) per[n] = v; });
          righe.push({ squadra, per_giornata: per });
        }
        const ordine = [];
        for (let k = 1; k <= 12; k++) {
          const squadra = g.str(b.r + k, 0);
          const v = g.num(b.r + k, 1);
          if (squadra && v != null) ordine.push({ squadra, valore: v });
        }
        return { righe, ordine };
      };
      return { settimanali: blocco(/^SETTIMANALI$/i), totali: blocco(/^TOTALI$/i) };
    };
    out.coppa_lega = serie(/^COPPA DI LEGA$/i);
    out.sfigometro = serie(/^SFIGOMETRO$/i);

    // cannonieri: "n | Nome (SG)" ripetuto su più colonne
    const can = g.find(/^CLASSIFICA CANNONIERI/i, 0, 200, 0, 2);
    if (can) {
      let gol = null;
      for (let r = can.r + 1; r < can.r + 80; r++) {
        const n = g.num(r, 0);
        if (n != null) gol = n;
        if (gol == null) continue;
        for (let c = 1; c < 16; c++) {
          const v = g.str(r, c);
          const m = /^(.+?)\s*\(([A-Z0-9]{2})\)$/.exec(v);
          if (m) out.cannonieri.push({ nome: m[1].trim(), sigla: m[2], gol });
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------- superclassifica
  function readSuperclassifica(wb) {
    const out = {};
    if (!wb.has('SUPERCLASSIFICA')) return out;
    const g = wb.grid('SUPERCLASSIFICA');
    const semplice = (re, cols) => {
      const h = g.find(re, 0, 80, 0, 2);
      if (!h) return [];
      const righe = [];
      for (let k = 1; k <= 12; k++) {
        const squadra = g.str(h.r + k, 0);
        if (!squadra) { if (righe.length) break; else continue; }
        const o = { squadra };
        Object.keys(cols).forEach(nome => { o[nome] = g.num(h.r + k, cols[nome]); });
        righe.push(o);
      }
      return righe;
    };
    const corretta = () => {
      const h = g.find(/^CLASSIFICA CAMPIONATO\s*.CORRETTA/i, 0, 20, 0, 12);
      if (!h) return [];
      const righe = [];
      for (let k = 1; k <= 12; k++) {
        const squadra = g.str(h.r + k, h.c);
        const v = g.num(h.r + k, h.c + 1);
        if (!squadra || v == null) { if (righe.length) break; else continue; }
        righe.push({ squadra, totale: v });
      }
      return righe;
    };
    out.campionato_standard = semplice(/^CLASSIFICA CAMPIONATO\s*.STANDARD/i, { punti: 1, bonus: 2, totale: 3 });
    out.campionato_corretta = corretta();
    const conPremio = { totale: 1, media: 2, arrotondato: 3, premio: 4, definitivo: 5 };
    out.coppa_lega = semplice(/^CLASSIFICA COPPA DI LEGA$/i, conPremio);
    out.sfigometro = semplice(/^CLASSIFICA SFIGOMETRO$/i, conPremio);
    out.gol_totali = semplice(/^CLASSIFICA GOL REALI FATTI TOTALI/i, conPremio);
    out.gol_sfruttati = semplice(/^CLASSIFICA GOL REALI FATTI SFRUTTATI/i, conPremio);
    return out;
  }

  // --------------------------------------------------------------- gol reali
  // 8 blocchi da 3 colonne: riga 1 squadra | sfruttati | totali, poi i giocatori.
  function readGolReali(wb) {
    if (!wb.has('GOL REALI')) return [];
    const g = wb.grid('GOL REALI');
    const out = [];
    for (let b = 0; b < 12; b++) {
      const c = b * 3;
      const squadra = g.str(0, c);
      if (!squadra) break;
      const giocatori = [];
      for (let r = 1; r < 60; r++) {
        const nome = g.str(r, c);
        if (!nome) continue;
        const sf = g.num(r, c + 1), tt = g.num(r, c + 2);
        if (sf != null || tt != null) giocatori.push({ nome, sfruttati: sf || 0, totali: tt || 0 });
      }
      out.push({ squadra, sfruttati: g.num(0, c + 1), totali: g.num(0, c + 2), giocatori });
    }
    return out;
  }

  // ------------------------------------------------------------ rose e crediti
  function readRose(wb) {
    if (!wb.has('ROSE')) return { rose: [], crediti: [] };
    const g = wb.grid('ROSE');
    const rose = [], crediti = [];
    for (let b = 0; b < 12; b++) {
      const c = b * 3;
      const squadra = g.str(0, c);
      if (!squadra) break;
      crediti.push({ squadra, crediti: g.num(0, c + 1) });
      for (let r = 1; r <= 31; r++) {
        const nome = g.str(r, c);
        if (!nome) continue;
        rose.push({ squadra, slot: r, nome, costo: g.num(r, c + 1), valore: g.num(r, c + 2) });
      }
    }
    return { rose, crediti };
  }

  // ------------------------------------------------------------------- coppa
  function readCoppa(wb) {
    if (!wb.has('COPPA')) return null;
    const g = wb.grid('COPPA');
    const blocco = (re) => {
      const h = g.find(re, 0, 40, 0, 16);
      if (!h) return [];
      const righe = [];
      for (let k = 1; k <= 12; k++) {
        const squadra = g.str(h.r + k, h.c);
        const valore = g.num(h.r + k, h.c + 1);
        const punti = g.num(h.r + k, h.c + 2);
        if (!squadra || punti == null) { if (righe.length) break; else continue; }
        righe.push({ squadra, valore, punti });
      }
      return righe;
    };
    const quarti = [];
    const q = g.find(/^COPPA$/i, 0, 30, 10, 20);
    if (q) {
      for (let k = 1; k <= 12; k++) {
        const squadra = g.str(q.r + k, q.c), punti = g.num(q.r + k, q.c + 1);
        if (!squadra || punti == null) { if (quarti.length) break; else continue; }
        quarti.push({ squadra, punti });
      }
    }
    return {
      campionato: blocco(/^CAMPIONATO$/i),
      coppa_lega: blocco(/^COPPA DI LEGA$/i),
      gol_reali: blocco(/^GOL REALI$/i),
      crediti: blocco(/^CREDITI RESIDUI$/i),
      quarti
    };
  }

  // ---------------------------------------------------------------- albo d'oro
  function readAlbo(wb) {
    if (!wb.has("ALBO D'ORO")) return [];
    const g = wb.grid("ALBO D'ORO");
    const h = g.find(/^CAMPIONATO$/i, 0, 12, 0, 8);
    if (!h) return [];
    const out = [];
    for (let r = h.r + 1; r < h.r + 60; r++) {
      const st = g.str(r, h.c - 1);
      if (!/^\d{4}\/\d{2}$/.test(st)) continue;
      out.push({
        stagione: st,
        campionato: g.str(r, h.c),
        coppa: g.str(r, h.c + 1),
        coppa_lega: g.str(r, h.c + 2),
        supercoppa: g.str(r, h.c + 3)
      });
    }
    return out;
  }

  // --------------------------------------------------------------------- tutto
  function parse(bytes, fileName) {
    const wb = X.load(bytes);
    if (!wb.has('CLASSIFICHE') && !wb.has('CALENDARIO')) {
      throw new GiornataError('Questo non sembra il file di giornata della lega: mancano i fogli CALENDARIO e CLASSIFICHE.');
    }
    const classifiche = readClassifiche(wb);
    const calendario = readCalendario(wb);
    const squadre = teamSheets(wb);
    const giocate = calendario.filter(m => m.giocata).map(m => m.giornata);
    const giornata = classifiche.giornata != null ? classifiche.giornata
      : (giocate.length ? Math.max.apply(null, giocate) : null);
    if (giornata == null) throw new GiornataError('Non riesco a capire a quale giornata si riferisce il file.');

    const fogli = squadre.map(n => readTeamSheet(wb, n));
    const rose = readRose(wb);

    // una riga per squadra con il suo risultato di giornata
    const squadre_giornata = fogli.map(f => {
      const p = f.partita || {};
      const io = p.casa && NOSPACE(p.casa.squadra) === NOSPACE(f.squadra) ? p.casa
        : p.fuori && NOSPACE(p.fuori.squadra) === NOSPACE(f.squadra) ? p.fuori : null;
      const avv = io === p.casa ? p.fuori : p.casa;
      return {
        squadra: f.squadra,
        modulo: f.modulo,
        in_casa: io === p.casa,
        avversario: avv ? avv.squadra : null,
        punteggio: io ? io.punteggio : (f.totali ? f.totali.fantavoti : null),
        somma_voti: f.totali ? f.totali.voti : null,
        fattore_campo: io ? io.fattore_campo : null,
        bonus_modulo: io ? io.bonus_modulo : null,
        totale: io ? io.totale : null,
        gol_fatti: io ? io.gol : null,
        gol_subiti: avv ? avv.gol : null,
        sostituzioni: f.sostituzioni,
        marcatori: f.marcatori,
        formazione: f.formazione,
        schierati: f.rosa.filter(x => x.numero != null && x.nome)
          .sort((a, b) => a.numero - b.numero)
          .map(x => ({ pos: x.numero, slot: x.slot, ruolo: x.ruolo, nome: x.nome, voto: x.voto, fantavoto: x.fantavoto }))
      };
    });

    const voti = readVoti(wb).length ? readVoti(wb) : [].concat.apply([], fogli.map(f =>
      f.rosa.filter(x => x.nome).map(x => ({ squadra: f.squadra, ruolo: x.ruolo, nome: x.nome, voto: x.voto, fantavoto: x.fantavoto }))));

    return {
      file: fileName || '',
      giornata,
      serie_a: giornata + 2,          // la 1ª di lega è la 3ª di Serie A
      squadre,
      calendario,
      squadre_giornata,
      voti,
      rose: rose.rose,
      crediti: rose.crediti,
      classifica: classifiche.campionato,
      coppa_lega: classifiche.coppa_lega,
      sfigometro: classifiche.sfigometro,
      cannonieri: classifiche.cannonieri,
      superclassifica: readSuperclassifica(wb),
      gol_reali: readGolReali(wb),
      coppa: readCoppa(wb),
      albo: readAlbo(wb)
    };
  }

  const api = { parse, GiornataError, _parts: { readVoti, readCalendario, readTeamSheet, readClassifiche, readSuperclassifica, readGolReali, readRose, readCoppa, readAlbo } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Giornata = api;
})(typeof window !== 'undefined' ? window : globalThis);
