/* Direct+ limit engine — ECC direct clearing (DCP) dynamic limit rules for
   EPEX continuous (EPEX_CONTINUOUS_EUR) and day-ahead (EPEX_AUCTION_EUR).
   Ported from ECC's DCP Simulation Tool v1.3.5 (clsCalcForMarket, Output.bas)
   and checked against ECC's client deck (July 2025). One deliberate difference
   from the tool: after a weekend or holiday, the next business day's auction is back
   at the full limit, as in ECC's client deck (the lower of two readings, see day()). */
var LimitEngine = (function () {
  'use strict';
  // Weekday non-business days in ECC's calendar (weekends are never business days).
  var HOLIDAYS = {
    '2026-01-01': "New Year's Day", '2026-04-03': 'Good Friday', '2026-04-06': 'Easter Monday',
    '2026-05-01': 'Labour Day', '2026-12-25': 'Christmas Day',
    '2027-01-01': "New Year's Day", '2027-03-26': 'Good Friday', '2027-03-29': 'Easter Monday'
  };
  var MIN_DATE = '2026-01-01', MAX_DATE = '2027-12-24';
  var DAY = 86400000;

  function parse(iso) { var p = iso.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function add(d, n) { return new Date(d.getTime() + n * DAY); }
  function isBD(d) { var w = d.getUTCDay(); return w !== 0 && w !== 6 && !HOLIDAYS[iso(d)]; }
  function nextBD(d) { var x = add(d, 1); while (!isBD(x)) x = add(x, 1); return x; }
  function prevBD(d) { var x = add(d, -1); while (!isBD(x)) x = add(x, -1); return x; }
  function gap(a, b) { return Math.round((b - a) / DAY); }
  function holidayName(d) {
    if (HOLIDAYS[iso(d)]) return HOLIDAYS[iso(d)];
    var w = d.getUTCDay(); return (w === 0 || w === 6) ? 'Weekend' : '';
  }

  /* One calculation day t (an ECC business day).
     p = { C, OR, cont: {bd, nbd, key}, da: {bd, nbd, key} }  (keys in %) */
  function day(t, p) {
    var nb1 = nextBD(t), nb2 = nextBD(nb1);
    var g1 = gap(t, nb1), g2 = gap(nb1, nb2);
    var kc = p.cont.key / 100, ka = p.da.key / 100;
    // Continuous: no reset on non-business days, so today's 16:00 base limit must last g1 days.
    var blC = function (g) { return p.cont.bd + (g - 1) * p.cont.nbd; };
    // Day-ahead: resets every calendar day; multi-day gaps use max(BD, NBD) per day.
    var mx = Math.max(p.da.bd, p.da.nbd);
    var blA = function (g) { return g === 1 ? p.da.bd : mx; };
    var sumA = function (g) { return g === 1 ? p.da.bd : g * mx; };
    // Base limit requirement: today's base limit + the one granted at the next business day's 16:00.
    var blrC = blC(g1) + blC(g2);
    var blrA = sumA(g1) + sumA(g2);
    var blr = blrC + blrA;
    var excess = p.C - blr - p.OR;          // can be negative (shortfall)
    var free = Math.max(excess, 0);
    // Next morning: yesterday's settled purchases come back; a shortfall is refilled first.
    var refill = Math.max(p.OR - Math.max(-excess, 0), 0);
    var c16 = blC(g1), c18 = c16 + free * kc, c09 = c18 + refill * kc;
    var a16 = blA(g1), a18 = a16 + free * ka / g1;
    var a09 = a18 + refill * ka, carry = null, level = null;
    if (g1 > 1) {
      // Next business day's auction after a weekend or holiday (shown with those auctions unused).
      // ECC's client deck puts it back at the full limit, where the simulation tool gives only
      // the one-day share. ECC's example (one market) fits two readings, which differ slightly
      // with two markets and weekend base limits; we show the lower one:
      //  carry: the unused weekend/holiday limit, base limits included, comes back
      //  level: the normal weekday level (next business day's reserve, nothing unpaid)
      var reserveAt = function (d) { var n1 = nextBD(d), n2 = nextBD(n1), x = gap(d, n1), y = gap(n1, n2); return blC(x) + blC(y) + sumA(x) + sumA(y); };
      carry = a18 * g1 + refill * ka;
      level = p.da.bd + Math.max(p.C - reserveAt(nb1), 0) * ka;
      a09 = Math.min(carry, level);
    }
    // Day-ahead auctions covered by this calculation: days t+1 .. nb1.
    var auctions = [];
    for (var i = 1; i <= g1; i++) {
      var d = add(t, i), settled = (i === g1);
      auctions.push({ date: iso(d), limit: settled ? a09 : a18, settled: settled, bd: isBD(d), note: holidayName(d),
                      rollover: settled && g1 > 1, carry: settled ? carry : null, level: settled ? level : null });
    }
    return {
      date: iso(t), nextBD: iso(nb1), secondBD: iso(nb2), gap1: g1, gap2: g2,
      blrC: blrC, blrA: blrA, blr: blr, excess: excess, free: free, refill: refill,
      shareC: free * kc, shareA: free * ka,
      cont: { l16: c16, l18: c18, l09: c09 },
      da: { l16: a16, l18: a18, l09: a09, resetDays: g1, auctions: auctions },
      baseUncovered: p.C < blr
    };
  }

  function weekDays(anchorIso) {
    var a = parse(anchorIso), w = a.getUTCDay(), mon = add(a, -((w + 6) % 7)), out = [];
    for (var i = 0; i < 5; i++) { var d = add(mon, i); if (isBD(d)) out.push(d); }
    return out;
  }
  function snapToBD(isoDate) { var d = parse(isoDate); return isBD(d) ? d : nextBD(d); }

  function week(anchorIso, p) { return weekDays(anchorIso).map(function (d) { return day(d, p); }); }

  /* Inverse: smallest collateral meeting the targets on every day in `days`.
     tgt = { cont: €, contMeasure: 'l18'|'l09', da: €, daNonBD: bool } */
  function meets(C, days, p, tgt) {
    var q = { C: C, OR: p.OR, cont: p.cont, da: p.da };
    for (var i = 0; i < days.length; i++) {
      var r = day(days[i], q);
      if (r.baseUncovered) return false;
      if (tgt.cont > 0 && r.cont[tgt.contMeasure] < tgt.cont - 1e-6) return false;
      if (tgt.da > 0) {
        for (var j = 0; j < r.da.auctions.length; j++) {
          var au = r.da.auctions[j];
          if (!tgt.daNonBD && !au.bd) continue;
          if (au.limit < tgt.da - 1e-6) return false;
        }
      }
    }
    return true;
  }
  function solve(days, p, tgt) {
    var hi = 1e6;
    while (!meets(hi, days, p, tgt)) { hi *= 2; if (hi > 1e13) return null; }
    var lo = 0;
    if (meets(0, days, p, tgt)) return 0;
    while (hi - lo > 0.5) { var mid = (lo + hi) / 2; if (meets(mid, days, p, tgt)) hi = mid; else lo = mid; }
    var r = Math.round(hi);
    return meets(r, days, p, tgt) ? r : Math.ceil(hi);
  }
  // Which day/market is binding at collateral C (smallest headroom vs target).
  function binding(C, days, p, tgt) {
    var q = { C: C, OR: p.OR, cont: p.cont, da: p.da }, best = null;
    days.forEach(function (d) {
      var r = day(d, q);
      if (tgt.cont > 0) {
        var h = r.cont[tgt.contMeasure] - tgt.cont;
        if (!best || h < best.h) best = { h: h, market: 'cont', date: r.date };
      }
      if (tgt.da > 0) r.da.auctions.forEach(function (au) {
        if (!tgt.daNonBD && !au.bd) return;
        var h2 = au.limit - tgt.da;
        if (!best || h2 < best.h) best = { h: h2, market: 'da', date: au.date, calc: r.date };
      });
      var hb = C - r.blr;
      if (!best || hb < best.h) best = { h: hb, market: 'base', date: r.date };
    });
    return best;
  }
  function cheapestKey(days, p, tgt) {
    var best = null;
    for (var k = 0; k <= 100; k++) {
      var q = { OR: p.OR, cont: { bd: p.cont.bd, nbd: p.cont.nbd, key: k }, da: { bd: p.da.bd, nbd: p.da.nbd, key: 100 - k } };
      var C = solve(days, q, tgt);
      if (C === null) continue;
      if (!best || C < best.C - 0.5 || (Math.abs(C - best.C) <= 0.5 && Math.abs(k - p.cont.key) < Math.abs(best.key - p.cont.key))) best = { key: k, C: C };
    }
    return best;
  }

  return { day: day, week: week, weekDays: weekDays, snapToBD: snapToBD, solve: solve, binding: binding,
           cheapestKey: cheapestKey, parse: parse, iso: iso, isBD: isBD, nextBD: nextBD, prevBD: prevBD,
           holidayName: holidayName, HOLIDAYS: HOLIDAYS, MIN_DATE: MIN_DATE, MAX_DATE: MAX_DATE };
})();
if (typeof module !== 'undefined') module.exports = LimitEngine;
