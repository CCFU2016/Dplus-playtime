/* Direct+ limit engine — ECC direct clearing (DCP) dynamic limit rules, per market.
   Implemented: EPEX continuous (EPEX_CONTINUOUS_EUR) and day-ahead (EPEX_AUCTION_EUR).
   Ported from ECC's DCP Simulation Tool v1.3.5 (clsCalcForMarket, Output.bas)
   and checked against ECC's client deck (July 2025). One deliberate difference
   from the tool: after a weekend or holiday, the next business day's auction is back
   at the full limit, as in ECC's client deck (the lower of two readings, see calc()). */
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

  /* Market definitions, copied from ECC's market table (reference/ecc/markets_table.csv;
     tests/markets.test.js checks them against it).
       reset        'business day': one limit period per business day, running over weekends and holidays;
                    'day': the limit resets every calendar day.
       auction      the table's Auction Flag.
       ownCalendar  the market has its own trading-day calendar (the table's "separate TD calendar").
     A market's rules follow from these fields; only the markets listed here are implemented. */
  var MARKETS = {
    EPEX_CONTINUOUS_EUR: { reset: 'business day', auction: 0, ownCalendar: false, currency: 'EUR' },
    EPEX_AUCTION_EUR:    { reset: 'day',          auction: 0, ownCalendar: false, currency: 'EUR' }
  };
  // The two markets of the original two-market API (p.cont, p.da).
  var CONT = 'EPEX_CONTINUOUS_EUR', DA = 'EPEX_AUCTION_EUR';

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

  /* Base limit from one business day's 16:00 to the next, g calendar days later:
     bl(g) is the limit that goes live at 16:00, res(g) what ECC reserves for the period. */
  function baseRule(def, s) {
    if (def.reset === 'business day') {
      // No reset on non-business days, so the 16:00 base limit must last g days.
      var bl = function (g) { return s.bd + (g - 1) * s.nbd; };
      return { bl: bl, res: bl };
    }
    // Resets every calendar day; multi-day gaps use max(BD, NBD) per day.
    var mx = Math.max(s.bd, s.nbd);
    return { bl: function (g) { return g === 1 ? s.bd : mx; }, res: function (g) { return g === 1 ? s.bd : g * mx; } };
  }
  function resolve(list) {
    var seen = {};
    return list.map(function (s) {
      var def = MARKETS[s.id];
      if (!def) throw new Error('Market not implemented: ' + s.id);
      if (seen[s.id]) throw new Error('Market listed twice: ' + s.id);
      seen[s.id] = true;
      return { id: s.id, def: def, bd: s.bd, k: s.key / 100, rule: baseRule(def, s) };
    });
  }
  // Base limit requirement at calculation day d, all markets.
  function reserveAt(d, ms) {
    var n1 = nextBD(d), n2 = nextBD(n1), x = gap(d, n1), y = gap(n1, n2), sum = 0;
    ms.forEach(function (m) { sum += m.rule.res(x) + m.rule.res(y); });
    return sum;
  }

  /* One calculation day t (an ECC business day), any list of markets.
     p = { C, OR, markets: [{ id, bd, nbd, key }] }  (keys in %, summing to 100) */
  function calc(t, p) {
    var ms = resolve(p.markets);
    var nb1 = nextBD(t), nb2 = nextBD(nb1);
    var g1 = gap(t, nb1), g2 = gap(nb1, nb2);
    // Base limit requirement: today's base limit + the one granted at the next business day's 16:00.
    var blr = 0;
    ms.forEach(function (m) { m.blr = m.rule.res(g1) + m.rule.res(g2); blr += m.blr; });
    var excess = p.C - blr - p.OR;          // can be negative (shortfall)
    var free = Math.max(excess, 0);
    // Next morning: yesterday's settled purchases come back; a shortfall is refilled first.
    var refill = Math.max(p.OR - Math.max(-excess, 0), 0);
    var out = {};
    ms.forEach(function (m) {
      var l16 = m.rule.bl(g1), r = { blr: m.blr, share: free * m.k, l16: l16 };
      if (m.def.reset === 'business day') {
        r.l18 = l16 + free * m.k; r.l09 = r.l18 + refill * m.k; r.resetDays = 1;
      } else {
        var l18 = l16 + free * m.k / g1, l09 = l18 + refill * m.k, carry = null, level = null;
        if (g1 > 1) {
          // Next business day's auction after a weekend or holiday (shown with those auctions unused).
          // ECC's client deck puts it back at the full limit, where the simulation tool gives only
          // the one-day share. ECC's example (one market) fits two readings, which differ slightly
          // with two markets and weekend base limits; we show the lower one:
          //  carry: the unused weekend/holiday limit, base limits included, comes back
          //  level: the normal weekday level (next business day's reserve, nothing unpaid)
          carry = l18 * g1 + refill * m.k;
          level = m.bd + Math.max(p.C - reserveAt(nb1, ms), 0) * m.k;
          l09 = Math.min(carry, level);
        }
        // Auctions covered by this calculation: days t+1 .. nb1.
        var auctions = [];
        for (var i = 1; i <= g1; i++) {
          var d = add(t, i), settled = (i === g1);
          auctions.push({ date: iso(d), limit: settled ? l09 : l18, settled: settled, bd: isBD(d), note: holidayName(d),
                          rollover: settled && g1 > 1, carry: settled ? carry : null, level: settled ? level : null });
        }
        r.l18 = l18; r.l09 = l09; r.resetDays = g1; r.auctions = auctions;
      }
      out[m.id] = r;
    });
    return {
      date: iso(t), nextBD: iso(nb1), secondBD: iso(nb2), gap1: g1, gap2: g2,
      blr: blr, excess: excess, free: free, refill: refill,
      markets: out, baseUncovered: p.C < blr
    };
  }

  // Two-market API: p = { C, OR, cont: {bd, nbd, key}, da: {bd, nbd, key} }, as before calc().
  function fromLegacy(p) {
    return { C: p.C, OR: p.OR, markets: [{ id: CONT, bd: p.cont.bd, nbd: p.cont.nbd, key: p.cont.key },
                                         { id: DA, bd: p.da.bd, nbd: p.da.nbd, key: p.da.key }] };
  }
  function tgtFromLegacy(tgt) {
    var t = {};
    t[CONT] = { limit: tgt.cont, measure: tgt.contMeasure };
    t[DA] = { limit: tgt.da, nonBD: tgt.daNonBD };
    return t;
  }
  function toLegacy(r) {
    var c = r.markets[CONT], a = r.markets[DA];
    return {
      date: r.date, nextBD: r.nextBD, secondBD: r.secondBD, gap1: r.gap1, gap2: r.gap2,
      blrC: c.blr, blrA: a.blr, blr: r.blr, excess: r.excess, free: r.free, refill: r.refill,
      shareC: c.share, shareA: a.share,
      cont: { l16: c.l16, l18: c.l18, l09: c.l09 },
      da: { l16: a.l16, l18: a.l18, l09: a.l09, resetDays: a.resetDays, auctions: a.auctions },
      baseUncovered: r.baseUncovered
    };
  }

  // p with `markets` returns calc()'s result; p with `cont`/`da` returns the two-market result.
  function day(t, p) { return p.markets ? calc(t, p) : toLegacy(calc(t, fromLegacy(p))); }

  function weekDays(anchorIso) {
    var a = parse(anchorIso), w = a.getUTCDay(), mon = add(a, -((w + 6) % 7)), out = [];
    for (var i = 0; i < 5; i++) { var d = add(mon, i); if (isBD(d)) out.push(d); }
    return out;
  }
  function snapToBD(isoDate) { var d = parse(isoDate); return isBD(d) ? d : nextBD(d); }

  function week(anchorIso, p) { return weekDays(anchorIso).map(function (d) { return day(d, p); }); }

  /* Sizing. Targets per market id:
       tgt = { <id>: { limit: €, measure: 'l18'|'l09' } }   business-day markets (limit in that evening/morning)
       tgt = { <id>: { limit: €, nonBD: bool } }            day markets (limit at every auction; nonBD: weekend/holiday ones too)
     The two-market API takes tgt = { cont: €, contMeasure: 'l18'|'l09', da: €, daNonBD: bool }.
     A market's limits depend only on collateral and its own key, never on other markets' keys. */
  function targetChecks(r, id, tg, visit) {
    var rm = r.markets[id];
    if (!rm.auctions) { visit(rm[tg.measure], r.date); return; }
    rm.auctions.forEach(function (au) { if (tg.nonBD || au.bd) visit(au.limit, au.date); });
  }
  function meetsN(C, days, p, tgt) {
    var q = { C: C, OR: p.OR, markets: p.markets };
    for (var i = 0; i < days.length; i++) {
      var r = calc(days[i], q), ok = !r.baseUncovered;
      for (var id in tgt) {
        if (!ok) break;
        var lim = tgt[id].limit;
        if (lim > 0 && r.markets[id]) targetChecks(r, id, tgt[id], function (v) { if (v < lim - 1e-6) ok = false; });
      }
      if (!ok) return false;
    }
    return true;
  }
  // Smallest collateral (whole €) meeting the targets on every day in `days`; null if unreachable.
  function solve(days, p, tgt) {
    if (!p.markets) { p = fromLegacy(p); tgt = tgtFromLegacy(tgt); }
    var hi = 1e6;
    while (!meetsN(hi, days, p, tgt)) { hi *= 2; if (hi > 1e13) return null; }
    var lo = 0;
    if (meetsN(0, days, p, tgt)) return 0;
    while (hi - lo > 0.5) { var mid = (lo + hi) / 2; if (meetsN(mid, days, p, tgt)) hi = mid; else lo = mid; }
    var r = Math.round(hi);
    return meetsN(r, days, p, tgt) ? r : Math.ceil(hi);
  }
  // Which day/market is binding at collateral C (smallest headroom vs target).
  // market is the market id, or 'base' (with the two-market API: 'cont', 'da' or 'base').
  function binding(C, days, p, tgt) {
    var legacy = !p.markets;
    if (legacy) { p = fromLegacy(p); tgt = tgtFromLegacy(tgt); }
    var q = { C: C, OR: p.OR, markets: p.markets }, best = null;
    days.forEach(function (d) {
      var r = calc(d, q);
      p.markets.forEach(function (s) {
        var tg = tgt[s.id];
        if (!tg || !(tg.limit > 0)) return;
        var name = legacy ? (s.id === CONT ? 'cont' : 'da') : s.id;
        targetChecks(r, s.id, tg, function (v, date) {
          var h = v - tg.limit;
          if (!best || h < best.h) best = r.markets[s.id].auctions ? { h: h, market: name, date: date, calc: r.date } : { h: h, market: name, date: date };
        });
      });
      var hb = C - r.blr;
      if (!best || hb < best.h) best = { h: hb, market: 'base', date: r.date };
    });
    return best;
  }
  // Smallest whole-% key with which market `id` meets its target at collateral C (Infinity if 100% is not enough).
  function minKey(C, days, p, tgt, id) {
    if (!tgt[id] || !(tgt[id].limit > 0)) return 0;
    var t = {}; t[id] = tgt[id];
    var at = function (k) {
      return meetsN(C, days, { OR: p.OR, markets: p.markets.map(function (s) { return s.id === id ? { id: s.id, bd: s.bd, nbd: s.nbd, key: k } : s; }) }, t);
    };
    if (!at(100)) return Infinity;
    if (at(0)) return 0;
    var lo = 0, hi = 100;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (at(mid)) hi = mid; else lo = mid; }
    return hi;
  }
  /* Split (whole %) that needs the least collateral, and that collateral; null if unreachable.
     Because each market's limits depend only on its own key, collateral C works with some split exactly
     when the markets' minimum keys at C add up to 100% or less. Bisect on C, then place the leftover %
     as close to the member's current split (p's keys) as possible.
     Returns { keys: { <id>: % }, C }, or { key: continuous %, C } with the two-market API. */
  function cheapestKey(days, p, tgt) {
    var legacy = !p.markets;
    if (legacy) { p = fromLegacy(p); p.markets[1].key = 100 - p.markets[0].key; tgt = tgtFromLegacy(tgt); }
    var u = p.markets.map(function (s) { return s.key; });
    if (u.reduce(function (a, b) { return a + b; }, 0) !== 100) throw new Error('Keys must add up to 100');
    var need = function (C) {
      if (!meetsN(C, days, p, {})) return null;   // base limits not covered
      var ks = p.markets.map(function (s) { return minKey(C, days, p, tgt, s.id); });
      return ks.reduce(function (a, b) { return a + b; }, 0) <= 100 ? ks : null;
    };
    var hi = 1e6;
    while (!need(hi)) { hi *= 2; if (hi > 1e13) return null; }
    var C = 0;
    if (!need(0)) {
      var lo = 0;
      while (hi - lo > 1) { var mid = Math.floor((lo + hi) / 2); if (need(mid)) hi = mid; else lo = mid; }
      C = hi;
    }
    // Raise markets below their minimum; the others give it back in proportion to their spare share
    // (largest remainder, ties to the earlier market). With two markets this is the nearest split.
    var kmin = need(C), k = u.map(function (x, i) { return Math.max(x, kmin[i]); });
    var spare = k.map(function (x, i) { return x - kmin[i]; }), tot = spare.reduce(function (a, b) { return a + b; }, 0);
    var excess = k.reduce(function (a, b) { return a + b; }, 0) - 100;
    if (excess > 0) {
      var raw = spare.map(function (s) { return s * excess / tot; }), take = raw.map(Math.floor);
      var left = excess - take.reduce(function (a, b) { return a + b; }, 0);
      raw.map(function (r, i) { return i; })
        .sort(function (a, b) { return (raw[b] - take[b]) - (raw[a] - take[a]) || a - b; })
        .forEach(function (i) { if (left > 0 && take[i] < spare[i]) { take[i]++; left--; } });
      k = k.map(function (x, i) { return x - take[i]; });
    }
    if (legacy) return { key: k[0], C: C };
    var keys = {};
    p.markets.forEach(function (s, i) { keys[s.id] = k[i]; });
    return { keys: keys, C: C };
  }

  return { day: day, week: week, weekDays: weekDays, snapToBD: snapToBD, solve: solve, binding: binding,
           cheapestKey: cheapestKey, parse: parse, iso: iso, isBD: isBD, nextBD: nextBD, prevBD: prevBD,
           holidayName: holidayName, HOLIDAYS: HOLIDAYS, MARKETS: MARKETS, MIN_DATE: MIN_DATE, MAX_DATE: MAX_DATE };
})();
if (typeof module !== 'undefined') module.exports = LimitEngine;
