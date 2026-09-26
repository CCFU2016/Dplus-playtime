/* Direct+ wallet: the TenneT account: imbalance and reconciliation invoices, their dates, and the account/security check
   (docs/wallet-model.md §5, §6.2). Each member pays its own invoices, as if it were its own BRP (Niki, 26 Sep 2026).
   Sources: SC 2026 art. 10.26, 10.27, 10.29 (reference/tennet/systeemcode-elektriciteit_wetten-overheid_…txt);
   ACM draft ACM/25/196985 art. 10.8(9)-(10), amended 10.26(5)-(6) and 10.27(13)-(14), explanatory paras 15-17. */
var WalletTennet = (function () {
  'use strict';
  var DAY = 86400000;
  function parse(iso) { var p = iso.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function add(d, n) { return new Date(d.getTime() + n * DAY); }

  /* ---------- imbalance price (SC 2026 art. 10.29) ----------
     prices = { up (opregelen), down (afregelen), mid (middenprijs) } for one settlement period; v = imbalance in MWh,
     + short ("afnemen": the BRP pays), − long ("invoeden": TenneT pays). Returns the signed amount, + = the BRP pays.
     It is the full imbalance price, not a spread against day-ahead; negative prices flip the flow by themselves. */
  function price(state, side, p) {
    if (state === -1) return p.down;                                                   // para 2: afregelen, both sides
    if (state === 1) return p.up;                                                      // para 3: opregelen, both sides
    if (state === 0) return p.mid;                                                     // para 5: middenprijs, both sides
    if (state === 2) return side === 'short' ? Math.max(p.mid, p.up) : Math.min(p.mid, p.down);   // para 4a-4d
    throw new Error('Unknown regulation state ' + state);
  }
  function periodAmount(v, state, p) { return v * price(state, v > 0 ? 'short' : 'long', p); }

  /* ---------- Dutch working days ----------
     TenneT's deadlines count Dutch working days, not ECC's T2 days. Holidays as in the Algemene termijnenwet (art. 3):
     New Year's Day, Easter Monday, King's Day (27 April, 26 April when that is a Sunday), 5 May, Ascension Day,
     Whit Monday, Christmas Day and Boxing Day. To be confirmed with TenneT (Q11). */
  function easter(y) {                                   // anonymous Gregorian algorithm
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(y, month - 1, day));
  }
  var holidayCache = {};
  function holidays(y) {
    if (holidayCache[y]) return holidayCache[y];
    var e = easter(y), king = new Date(Date.UTC(y, 3, 27)), h = {};
    if (king.getUTCDay() === 0) king = new Date(Date.UTC(y, 3, 26));
    h[y + '-01-01'] = "Nieuwjaarsdag"; h[iso(add(e, 1))] = 'Tweede Paasdag'; h[iso(king)] = 'Koningsdag';
    h[y + '-05-05'] = 'Bevrijdingsdag'; h[iso(add(e, 39))] = 'Hemelvaartsdag'; h[iso(add(e, 50))] = 'Tweede Pinksterdag';
    h[y + '-12-25'] = 'Eerste Kerstdag'; h[y + '-12-26'] = 'Tweede Kerstdag';
    return (holidayCache[y] = h);
  }
  function isWorkday(d) { var w = d.getUTCDay(); return w !== 0 && w !== 6 && !holidays(d.getUTCFullYear())[iso(d)]; }
  function onOrAfterWorkday(d) { while (!isWorkday(d)) d = add(d, 1); return d; }
  function workdaysBetween(a, b) { var n = 0; for (var x = add(a, 1); x < b; x = add(x, 1)) if (isWorkday(x)) n++; return n; }
  function nthWorkday(y, m0, n) { var d = new Date(Date.UTC(y, m0, 1)), k = 0; for (;;) { if (isWorkday(d) && ++k === n) return d; d = add(d, 1); } }

  /* ---------- reconciliation dates ----------
     month: 'YYYY-MM', the reconciliation month M. version 'current' | 'draft' (default: the draft for statements from
     1 January 2027, when its 10.26(5) takes effect; ACM draft Artikel II B).
     Profile (10.26): TenneT states the amount by the 10th working day of M+5 (para 4). Payment on the first Tuesday after;
       current para 5: the Tuesday after that "tenzij tussen bedoelde moment en de eerste dinsdag niet meer dan drie
       werkdagen zijn gelegen" applies; the draft drops that exception. Payout on the Wednesday after that Tuesday (para 6).
       A Tuesday or Wednesday that is not a working day moves to the next working day (para 8; para 7 in the draft).
     Smart-meter and telemetry (10.27): paid and paid out on the first working day of M+6 (paras 13-14). */
  function monthShift(month, k) { var y = +month.slice(0, 4), m = +month.slice(5, 7) - 1 + k; return { y: y + Math.floor(m / 12), m0: ((m % 12) + 12) % 12 }; }
  function paymentDates(statement, version) {
    var s = typeof statement === 'string' ? parse(statement) : statement;
    var v = version || (iso(s) >= '2027-01-01' ? 'draft' : 'current');
    var tue = add(s, ((2 - s.getUTCDay() + 7) % 7) || 7);
    if (v === 'current' && workdaysBetween(s, tue) <= 3) tue = add(tue, 7);
    return { version: v, statement: iso(s), pay: iso(onOrAfterWorkday(tue)), payout: iso(onOrAfterWorkday(add(tue, 1))) };
  }
  function profileDates(month, version) {
    var t = monthShift(month, 5), r = paymentDates(nthWorkday(t.y, t.m0, 10), version);
    r.month = month;
    return r;
  }
  function smartDates(month) {
    var t = monthShift(month, 6), d = nthWorkday(t.y, t.m0, 1);
    return { month: month, pay: iso(d), payout: iso(d) };
  }
  /* Weekly imbalance invoice for the delivery week starting weekStart (a Monday). ACM draft para 15: "Tussen het moment
     van levering en facturatie zitten vier weken." The debit day is in TenneT's billing terms, not in the pack (Q11):
     ASSUMPTION, the first working day on or after the end of the delivery week + lagWeeks (default 4). */
  function imbalanceDebit(weekStart, lagWeeks) {
    return iso(onOrAfterWorkday(add(parse(weekStart), 7 + 7 * (lagWeeks == null ? 4 : lagWeeks))));
  }

  /* ---------- account vs security ----------
     Draft art. 10.8(10): enough balance for the weekly and monthly settlements (a), and enough security after them (b).
     INTERPRETATION, processing debits in date order: balance before a debit ≥ max(invoice, 0), and
     balance after it + guarantee ≥ security. Returns the smallest opening balance that passes, and the binding event.
     invoices: [{ date, amount }] (+ the BRP pays, − TenneT pays); security: € or a function of the date.
     rule 'current': invoice cash and security are additive (the deposit tops the guarantee up to the security). */
  function accountNeed(invoices, security, guarantee, rule) {
    var sec = typeof security === 'function' ? security : function () { return security; };
    var g = guarantee || 0, ev = invoices.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var cum = 0, need = 0, why = null;
    var consider = function (v, what) { if (v > need + 1e-9) { need = v; why = what; } };
    if (rule === 'current') {
      var peak = 0;
      ev.forEach(function (e) { if (cum + Math.max(e.amount, 0) > peak) { peak = cum + Math.max(e.amount, 0); why = { date: e.date, check: 'invoice' }; } cum += e.amount; });
      var dep = Math.max(sec(ev.length ? ev[0].date : null) - g, 0);
      return { need: peak + dep, invoices: peak, deposit: dep, binding: why };
    }
    consider(sec(ev.length ? ev[0].date : null) - g, { date: ev.length ? ev[0].date : null, check: 'security at the start' });
    ev.forEach(function (e) {
      consider(cum + Math.max(e.amount, 0), { date: e.date, check: 'balance before the debit' });
      cum += e.amount;
      consider(cum + sec(e.date) - g, { date: e.date, check: 'security after the debit' });
    });
    return { need: need, binding: why };
  }

  /* ---------- weekly imbalance model (wallet-model §6.2) ----------
     o = { weeklyVolume (MWh traded, nominated or produced a week), share, bias (−1 long … +1 short), price (typical
     imbalance price €/MWh), statePrice2Share, stateGap2 (€/MWh), cv }. A normal model: it understates NL imbalance-price
     tails, and says so on the page. */
  function weekly(o) {
    var V = o.weeklyVolume * o.share, delta = (o.statePrice2Share || 0) * (o.stateGap2 || 0), b = o.bias || 0;
    var mu = V * (b * o.price + (1 - Math.abs(b)) * delta / 2), sigma = (o.cv == null ? 0.5 : o.cv) * V * o.price;
    return { volume: V, delta: delta, mu: mu, sigma: sigma, B: mu + 2 * sigma };
  }
  // Seeded pseudo-random numbers (mulberry32) and standard normals (Box-Muller), so the stress end is reproducible.
  // Math.imul is ES2015; the fallback keeps the module ES5.
  var imul = Math.imul || function (a, b) {
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return (al * bl + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
  };
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = imul(a ^ (a >>> 15), 1 | a);
      t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* Stress end of B: the q-quantile of B = mean + 2σ over `runs` simulated windows of ten weekly invoices N(mu, sigma).
     sigmaType 'population' (default) or 'sample'. */
  function stressB(mu, sigma, o) {
    o = o || {};
    var rnd = mulberry32(o.seed == null ? 20260926 : o.seed), runs = o.runs || 10000, n = 10, q = o.q == null ? 0.95 : o.q, bs = [];
    var normal = function () { var u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    for (var r = 0; r < runs; r++) {
      var w = [], mean = 0, ss = 0, i;
      for (i = 0; i < n; i++) { w.push(mu + sigma * normal()); mean += w[i]; }
      mean /= n;
      for (i = 0; i < n; i++) ss += (w[i] - mean) * (w[i] - mean);
      bs.push(mean + 2 * Math.sqrt(ss / (o.sigmaType === 'sample' ? n - 1 : n)));
    }
    bs.sort(function (a, b) { return a - b; });
    return bs[Math.min(runs - 1, Math.floor(q * runs))];
  }

  /* ---------- exit tail (draft art. 10.8(10c); proposal BR-2024-2077 p.2) ----------
     After the member stops on date `stop`, security and cash stay committed until the last invoices are settled:
     imbalance about four weeks after the last delivery (ACM draft para 15), profile reconciliation up to 21 months
     (para 16), smart-meter and telemetry reconciliation six months (para 17). has = { profile, smart }. */
  function exitTail(stop, has) {
    var d = parse(stop), addMonths = function (k) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, d.getUTCDate())); };
    var out = { imbalance: iso(add(d, 28)) };
    if (has && has.smart) out.smart = iso(addMonths(6));
    if (has && has.profile) out.profile = iso(addMonths(21));
    var last = out.imbalance; Object.keys(out).forEach(function (k) { if (out[k] > last) last = out[k]; });
    out.released = last;
    return out;
  }

  return { price: price, periodAmount: periodAmount, holidays: holidays, isWorkday: isWorkday, paymentDates: paymentDates, profileDates: profileDates,
           smartDates: smartDates, imbalanceDebit: imbalanceDebit, accountNeed: accountNeed, weekly: weekly,
           mulberry32: mulberry32, stressB: stressB, exitTail: exitTail };
})();
if (typeof module !== 'undefined') module.exports = WalletTennet;
