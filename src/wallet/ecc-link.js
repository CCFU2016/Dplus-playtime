/* Direct+ wallet: from behaviour to ECC collateral (docs/wallet-model.md §2).
   Uses only the engine's public API (day, nextBD, iso, parse). The engine's own solve() holds open risk and targets
   constant for all days; this solver takes both per calculation day. */
var WalletEccLink = (function (E) {
  'use strict';
  var DAY = 86400000;
  function add(d, n) { return new Date(d.getTime() + n * DAY); }

  /* Base limits (wallet-model §2.4; ECC deck p.2 and p.4). o = { restingCont, eveningCont, updateHour, restingAuc,
     restingAucWeekend, override }. eveningCont is the net buying expected between 16:00 and an 18:00 update; the update
     hour is an ASSUMPTION (18, stress 19). Continuous has no weekend reset, so its non-business-day base limit is 0. */
  function baseLimits(o) {
    var bl = {
      cont: { bd: (o.restingCont || 0) + (o.eveningCont || 0) * ((o.updateHour || 18) - 16) / 2, nbd: 0 },
      da: { bd: o.restingAuc || 0, nbd: o.restingAucWeekend || 0 }
    };
    var ov = o.override || {};
    ['cont', 'da'].forEach(function (m) { if (ov[m]) { if (ov[m].bd != null) bl[m].bd = ov[m].bd; if (ov[m].nbd != null) bl[m].nbd = ov[m].nbd; } });
    return bl;
  }

  /* Targets per calculation day (wallet-model §2.2, §2.3). The limit set on calculation day D serves the trading days
     after D up to and including nextBD(D) (each 16:00 to 16:00). flowOf(isoDay) → WalletBehaviour.dayFlows result.
       continuous: max(G × (1 − s), P) + resting, where P is the peak of the daily cumulative net value (a lower bound
                   on the intraday peak, since only daily totals exist in parametric mode);
       auctions:   each auction date's order exposure. */
  function targets(calcDays, flowOf, s, restingCont) {
    var cont = {}, auc = {};
    calcDays.forEach(function (D) {
      var nb = E.nextBD(D), G = 0, pos = 0, P = 0;
      for (var x = add(D, 1); x <= nb; x = add(x, 1)) {
        var f = flowOf(E.iso(x));
        G += f.cont.risk;
        pos += f.cont.buyValue - f.cont.sellValue;
        if (pos > P) P = pos;
        auc[E.iso(x)] = f.auc.exposure;
      }
      cont[E.iso(D)] = Math.max(G * (1 - (s || 0)), P) + (restingCont || 0);
    });
    return { cont: cont, auc: auc };
  }

  /* ctx = { days: [Date], OR: iso → €, cont: iso → €, auc: (iso, auction) → €, bl: baseLimits(), measure: 'l18'|'l09' }
     The engine's meets() logic with per-day open risk and targets: base limits covered, the continuous measure,
     every auction. measure is an ASSUMPTION ('l18' by default, wallet-model §2.2). */
  function meets(C, k, ctx) {
    for (var i = 0; i < ctx.days.length; i++) {
      var D = ctx.days[i], d = E.iso(D);
      var r = E.day(D, { C: C, OR: ctx.OR(d), cont: { bd: ctx.bl.cont.bd, nbd: ctx.bl.cont.nbd, key: k }, da: { bd: ctx.bl.da.bd, nbd: ctx.bl.da.nbd, key: 100 - k } });
      if (r.baseUncovered) return false;
      var tc = ctx.cont(d);
      if (tc > 0 && r.cont[ctx.measure || 'l18'] < tc - 1e-6) return false;
      for (var j = 0; j < r.da.auctions.length; j++) {
        var au = r.da.auctions[j], ta = ctx.auc(au.date, au);
        if (ta > 0 && au.limit < ta - 1e-6) return false;
      }
    }
    return true;
  }
  // Smallest whole euro of collateral meeting ctx with continuous key k; null if out of reach. Same search bounds as the
  // engine's solve(), which it matches when open risk and targets are constant (tests/wallet/ecc-link.test.js).
  function solve(ctx, k) {
    var hi = 1e6;
    while (!meets(hi, k, ctx)) { hi *= 2; if (hi > 1e13) return null; }
    if (meets(0, k, ctx)) return 0;
    var lo = 0;
    while (hi - lo > 1) { var mid = Math.floor((lo + hi) / 2); if (meets(mid, k, ctx)) hi = mid; else lo = mid; }
    return hi;
  }
  // The split (continuous %) needing the least collateral: every split from 0 to 100, ties to the member's own (ctx.key).
  function cheapest(ctx) {
    var best = null, u = ctx.key == null ? 50 : ctx.key;
    for (var k = 0; k <= 100; k++) {
      var C = solve(ctx, k);
      if (C === null) continue;
      if (!best || C < best.C - 0.5 || (Math.abs(C - best.C) <= 0.5 && Math.abs(k - u) < Math.abs(best.key - u))) best = { key: k, C: C };
    }
    return best;
  }

  return { baseLimits: baseLimits, targets: targets, meets: meets, solve: solve, cheapest: cheapest };
})(typeof LimitEngine !== 'undefined' ? LimitEngine : require('../engine.js'));
if (typeof module !== 'undefined') module.exports = WalletEccLink;
