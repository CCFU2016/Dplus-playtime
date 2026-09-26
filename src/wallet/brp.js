/* Direct+ wallet: BRP security for TenneT, art. 10.8 in force and as drafted (docs/wallet-model.md §4).
   Each member is treated as its own BRP (Direct+ decision, 26 Sep 2026; wallet-model §4.4).
   Sources: reference/tennet/systeemcode-elektriciteit_wetten-overheid_art-10.8-10.26-10.27-10.29_2026-09-26.txt (SC 2026),
   reference/tennet/acm-25-196985_gecorrigeerd-ontwerpbesluit_2026-08-25.pdf (ACM draft). */
var WalletBrp = (function () {
  'use strict';

  var RULES = {
    current: {
      label: 'Systeemcode elektriciteit 2026, art. 10.8 (in force)',
      priceFloor: { value: 40, src: 'SC 2026 art. 10.8(4) and (12): "met een ondergrens van € 40 per MWh"' },
      volumeFloorMW: { value: 50, src: 'SC 2026 art. 10.8(3), (6) and (11): "met een ondergrens van 50 MW"' },
      hours: { value: 24, src: 'SC 2026 art. 10.8(11): "vermenigvuldigd met 24"' },
      priceMonths: { value: 3, src: 'SC 2026 art. 10.8(4) and (12): "over een periode van drie maanden"' },
      volumeWeeks: { value: 6, src: 'SC 2026 art. 10.8(5) and (6): "in de zes voorafgaande weken"' },
      classes: { value: [[2, 10, 2], [11, 25, 11], [26, 50, 26]], src: 'SC 2026 art. 10.8(8)-(9): classes 2-10, 11-25, 26-50 MW, each counted at "de laagste capaciteit van die klasse"; above 50 MW actual capacity, (10)' },
      nemo: { value: 100000, src: 'SC 2026 art. 10.8(14)' },
      flatMinimum: { value: 96000, src: 'TenneT BRP recognition page (not retrieved); INTERPRETATION "flat €96,000"' }
    },
    draft: {
      label: 'ACM draft decision ACM/25/196985 of 25 Aug 2026, art. 10.8 (from 1 Jan 2027 once final)',
      from: { value: '2027-01-01', src: 'ACM draft, Artikel II B' },
      weights: { value: { A: 3, B: 4, C: 6, D: 6 }, src: 'ACM draft art. 10.8(7): "de som 3A + 4B + 6C + 6D"' },
      minimum: { value: 96000, src: 'ACM draft art. 10.8(7): "een minimumbedrag van € 96.000,-"' },
      nemo: { value: 100000, src: 'ACM draft art. 10.8(8)' },
      weeksB: { value: 10, src: 'ACM draft art. 10.8(3a): "referentieperiode van tien weken"' },
      sigmaB: { value: 2, src: 'ACM draft art. 10.8(3b): "twee maal de standaarddeviatie"' },
      monthsCD: { value: 12, src: 'ACM draft art. 10.8(4a) and (5a): "referentieperiode van twaalf maanden"' },
      sigmaCD: { value: 0.5, src: 'ACM draft art. 10.8(4b) and (5b): "een half maal de standaarddeviatie"' },
      months: { value: 2, src: 'ACM draft art. 10.8(2): "over een periode van twee maanden"' },
      missing: { value: 0, src: 'ACM draft art. 10.8(6): "een fictieve factuur van € 0,-"' }
    }
  };
  var C = RULES.current, D = RULES.draft;

  // Rule in force on a date (ISO), unless overridden ('current' | 'draft'). Direct+ decision: offer both (Q3).
  function ruleFor(iso, override) { return override || (iso >= D.from.value ? 'draft' : 'current'); }

  /* Net transaction volume on one day (MWh). byCp = { counterparty: [net MWh per settlement period] }, + bought.
     INTERPRETATION settings (wallet-model §4.3):
       perPeriod 'i' |Σ over the day's periods| (default) or 'ii' Σ over the periods of |net|;
       counterparties 'max' the largest single counterparty (default: "met enige andere" / "met een andere") or 'total'
       all counterparties netted together. */
  function dayVolume(byCp, perPeriod, counterparties) {
    var read = function (v) {
      var s = 0, a = 0;
      v.forEach(function (x) { s += x; a += Math.abs(x); });
      return perPeriod === 'ii' ? a : Math.abs(s);
    };
    var cps = Object.keys(byCp);
    if (counterparties === 'total') {
      var n = 0, tot = [];
      cps.forEach(function (cp) { n = Math.max(n, byCp[cp].length); });
      for (var t = 0; t < n; t++) { tot[t] = 0; cps.forEach(function (cp) { tot[t] += byCp[cp][t] || 0; }); }
      return read(tot);
    }
    var best = 0;
    cps.forEach(function (cp) { best = Math.max(best, read(byCp[cp])); });
    return best;
  }

  /* Capacity counted for B under the current rule (MW), art. 10.8(8)-(10). mw: capacities of the large connections.
     INTERPRETATION settings: under 2 MW counts nothing (no class); a capacity between two classes (e.g. 10.5 MW) rounds
     'down' to the lower class (default) or 'up' to the higher one. */
  function countedCapacity(mw, between) {
    var cls = C.classes.value, total = 0;
    mw.forEach(function (m) {
      if (m > 50) { total += m; return; }
      if (m < 2) return;
      for (var i = 0; i < cls.length; i++) {
        if (m >= cls[i][0] && m <= cls[i][1]) { total += cls[i][2]; return; }
        var next = cls[i + 1];
        if (next && m > cls[i][1] && m < next[0]) { total += between === 'up' ? next[2] : cls[i][2]; return; }
      }
    });
    return total;
  }

  /* Current rule (SC 2026 art. 10.8). o = {
       price3m,                              average market price over three months (€/MWh), floored at €40
       kind: 'first' | 'up' | 'down',        which paragraph sets A: (3) first time, (5) TenneT's request, (6) the BRP's request
       expected,                             expected highest daily net volume (MWh), for 'first'
       daily,                                the last six weeks of daily highs (MWh), for 'up' and 'down'
       capacityMW,                           counted capacity of large connections (countedCapacity)
       reading: '1200' | 'flat',             INTERPRETATION of the 50 MW floor (wallet-model §4.1); default '1200'
       floors,                               false: no volume floors and no minimum (a Direct+ member's marginal share)
       nemo }
     '1200': the 50 MW floor is 50 × 24 = 1,200 MWh, on A (first and down) and on B. 'flat': no volume floors, and a
     €96,000 minimum on the total. The €40 price floor always applies: it sets the price of the BRP's own calculation. */
  function current(o) {
    if (o.nemo) return { rule: 'current', nemo: true, security: C.nemo.value };
    var floor = o.reading === 'flat' || o.floors === false ? 0 : C.volumeFloorMW.value * C.hours.value;
    var price = Math.max(o.price3m, C.priceFloor.value), daily = o.daily || [], V;
    if (o.kind === 'up') V = Math.max.apply(null, daily.length ? daily : [0]);
    else if (o.kind === 'down') V = Math.max(daily.reduce(function (s, x) { return s + x; }, 0) / (daily.length || 1), floor);
    else V = Math.max(o.expected || 0, floor);
    var A = V * price, B = Math.max((o.capacityMW || 0) * C.hours.value, floor) * price;
    var security = 2 * A >= B ? 2 * A : A + B;
    if (o.reading === 'flat' && o.floors !== false) security = Math.max(security, C.flatMinimum.value);
    return { rule: 'current', volume: V, price: price, A: A, B: B, twoA: 2 * A >= B, security: security };
  }

  /* Mean and standard deviation over a fixed window of invoices, € (signed: positive means the BRP pays).
     Missing weeks or months count as €0 (ACM draft art. 10.8(6)); values beyond n are ignored (the oldest first).
     sigma 'population' (default) or 'sample': an INTERPRETATION. */
  function stats(values, n, sigma) {
    var v = values.slice(-n), i;
    while (v.length < n) v.unshift(D.missing.value);
    var mean = 0; for (i = 0; i < n; i++) mean += v[i]; mean /= n;
    var ss = 0; for (i = 0; i < n; i++) ss += (v[i] - mean) * (v[i] - mean);
    return { mean: mean, sd: Math.sqrt(ss / (sigma === 'sample' ? n - 1 : n)) };
  }
  // Draft components from invoice histories (oldest first). Components are not floored (proposal p.8).
  function componentB(weekly, sigma) { var s = stats(weekly, D.weeksB.value, sigma); return s.mean + D.sigmaB.value * s.sd; }
  function componentCD(monthly, sigma) { var s = stats(monthly, D.monthsCD.value, sigma); return s.mean + D.sigmaCD.value * s.sd; }

  /* Draft rule (ACM draft art. 10.8). o = { A | (volume2m, price2m), weekly | B, profile | C, smart | D, sigma, nemo,
     minimum }. Components come from invoice histories, or are given directly (B, C, D: the parametric model).
       A = realised highest daily net volume over two months × average day-ahead reference price over two months;
       minimum: apply the €96,000 per member (default true; wallet-model §4.4). */
  function draft(o) {
    if (o.nemo) return { rule: 'draft', nemo: true, security: D.nemo.value };
    var w = D.weights.value;
    var A = o.A != null ? o.A : (o.volume2m || 0) * (o.price2m || 0);
    var B = o.B != null ? o.B : componentB(o.weekly || [], o.sigma);
    var Cc = o.C != null ? o.C : componentCD(o.profile || [], o.sigma), Dc = o.D != null ? o.D : componentCD(o.smart || [], o.sigma);
    var sum = w.A * A + w.B * B + w.C * Cc + w.D * Dc;
    return { rule: 'draft', A: A, B: B, C: Cc, D: Dc, sum: sum, security: o.minimum === false ? sum : Math.max(sum, D.minimum.value) };
  }

  /* Draft-rule series for a new member, months 1-18 (wallet-model §4.2). Delivery starts at the beginning of month 1 and
     TenneT recalculates at the start of each month (ASSUMPTION: the day in the month is not in the texts).
       A: realised volume exists from month 2;
       B: the first weekly invoice about four weeks after delivery (ACM draft para 15);
       C: month M's profile reconciliation is paid in month M+5 (SC 2026 art. 10.26(4)-(5));
       D: month M's smart-meter/telemetry reconciliation on the first working day of month M+6 (art. 10.27(13)).
     s = { A, weekly, weeklySd, profile, profileSd, smart, smartSd, sigma, minimum, lagWeeks }: mean (and standard
     deviation) of one invoice in steady state, €. With k real invoices of mean μ and deviation σ in a window of n, and
     the rest €0, the component is taken at its expected mean and spread: p·μ + f·√(p(σ² + μ²) − (p·μ)²), p = k/n.
     With σ = 0 this is exactly the constant-invoice window (stats() on k copies and n − k zeros). */
  function expectedComponent(k, n, mean, sd, factor, sigma) {
    var p = Math.min(k, n) / n, v = Math.max(0, p * (sd * sd + mean * mean) - p * mean * p * mean);
    if (sigma === 'sample') v = v * n / (n - 1);
    return p * mean + factor * Math.sqrt(v);
  }
  function rampUp(s, months) {
    var out = [], lag = s.lagWeeks == null ? 4 : s.lagWeeks, peak = null;
    for (var m = 1; m <= (months || 18); m++) {
      var weeks = Math.floor((m - 1) * 52 / 12), kB = Math.max(0, weeks - lag);
      var kC = Math.max(0, m - 6), kD = Math.max(0, m - 7);
      var r = draft({ A: m >= 2 ? s.A || 0 : 0,
                      B: expectedComponent(kB, D.weeksB.value, s.weekly || 0, s.weeklySd || 0, D.sigmaB.value, s.sigma),
                      C: expectedComponent(kC, D.monthsCD.value, s.profile || 0, s.profileSd || 0, D.sigmaCD.value, s.sigma),
                      D: expectedComponent(kD, D.monthsCD.value, s.smart || 0, s.smartSd || 0, D.sigmaCD.value, s.sigma),
                      minimum: s.minimum });
      r.month = m; r.invoices = { B: Math.min(kB, 10), C: Math.min(kC, 12), D: Math.min(kD, 12) };
      out.push(r);
      if (!peak || r.security > peak.security) peak = r;
    }
    return { months: out, peak: peak };
  }

  return { RULES: RULES, ruleFor: ruleFor, dayVolume: dayVolume, countedCapacity: countedCapacity, current: current,
           stats: stats, componentB: componentB, componentCD: componentCD, draft: draft, rampUp: rampUp };
})();
if (typeof module !== 'undefined') module.exports = WalletBrp;
