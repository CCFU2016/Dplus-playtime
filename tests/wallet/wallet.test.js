// wallet.js: the combined result per member, the presets and the settings list (docs/wallet-model.md §7, §8, §11.1).
const C = require('../../src/wallet/wallet.js');
// The worked example (§8) is a larger desk than today's trader preset: the preset's volumes before it was resized to
// about 150 MWh a day (26 Sep 2026). Everything else is the preset.
// It also keeps the €80 normal price and the loss rule of that time: 5% of gross buys lost every business day in a tough week, and no bad days.
const LARGE_DESK = { contBuy: 240, contSell: 240, aucBuy: 100, aucSell: 100, restingCont: 10000, eveningCont: 5000, s: 0, lossShare: 0.05, badDays: 0, badDaysStress: 0, price: 80, stressAvgPrice: 120 };
const desk = () => Object.assign(C.preset('trader'), LARGE_DESK);
const T = require('./assert.js')('wallet');

// The worked example (§8.5): financial trader, week of 5 Oct 2026, rule in force, all cash. Direct+ members put up
// their marginal BRP collateral, with no minimum (Niki, 26 Sep 2026): a flat trader without connections adds nothing.
const ft = C.compute(desk());
T.money(ft.expected.total, 133994.25, 'financial trader: expected total');
T.money(ft.stress.total, 467883.25, 'financial trader: stress total');
T.eq(ft.expected.parts.map(p => [p.id, Math.round(p.value * 100) / 100]), [['ecc', 125745], ['settlement', 8160], ['brp', 0], ['invoices', 89.25]], 'financial trader: expected parts');
T.eq(ft.stress.parts.map(p => [p.id, Math.round(p.value * 100) / 100]), [['ecc', 406594], ['settlement', 55250], ['brp', 0], ['invoices', 6039.25]], 'financial trader: stress parts');
// Settlement: ECC nets each business day, but purchases sold only after the 16:00 cut are paid one collection before
// the sale comes back. The trader carries 30% of a day's buys: a float of 0.3 × 340 MWh × €80, and × €250 in stress.
T.money(ft.expected.settlement.float, 8160, 'financial trader: settlement float (expected)');
T.money(ft.stress.settlement.float, 25500, 'financial trader: settlement float (stress)');
T.money(ft.stress.settlement.flows, 29750, 'financial trader: stress loss share on top of the float');
T.eq([ft.expected.ecc.key, ft.expected.ecc.binding.date], [53, '2026-10-09'], 'financial trader: 53/47, the Friday calculation sets the amount');
T.eq([ft.expected.brp.rule, ft.expected.brp.basis], ['current', 'marginal'], 'October 2026: the rule in force, marginal collateral');
T.money(ft.expected.brp.draft.security, 7973, 'financial trader: under the draft, 4B = 4 × 1,993.25 and no minimum');
T.money(ft.expected.segments.trading + ft.expected.segments.brp + ft.expected.segments.available, ft.expected.total, 'segments add up to the total');
T.ok(!ft.expected.ecc.overCap && C.compute(Object.assign(desk(), { cap: 100000 })).expected.ecc.overCap, 'collateral above the cap limit is flagged');
T.ok(!JSON.stringify(ft).includes('efaultFund') && !JSON.stringify(ft).includes('guarantee'), 'no default fund or guarantee in the result');

// On your own as a BRP (for comparison): the minimum and the 50 MW floors apply.
let s = desk(); s.brpBasis = 'standalone';
let sa = C.compute(s);
T.money(sa.expected.total, 325994.25, 'on your own as a BRP: expected (1,200 MWh reading: 2 × 1,200 × €80)');
T.money(sa.stress.total, 755883.25, 'on your own as a BRP: stress');
T.money(sa.expected.brp.draft.security, 96000, 'on your own as a BRP, the draft gives the €96,000 minimum');
s.reading = 'flat';
T.money(C.compute(s).expected.total, 229994.25, 'on your own as a BRP, flat €96,000 reading');
// Marginal amounts from members with volume or connections.
const ag = C.compute(C.preset('aggregator')).expected.brp, as = C.compute(C.preset('asset')).expected.brp;
T.money(ag.security, 150 * 100 * 2, 'aggregator: 150 MWh a day with one counterparty, 2 × A at €100, no floors');
T.money(as.security, 90 * 100 + 26 * 24 * 100, 'asset: A + B = 90 × 100 + 26 MW × 24 × 100');
// A marginal share is never below €0, even when the draft's components are negative.
s = C.preset('asset'); s.week = '2027-10-04'; s.bias = -1; s.cv = 0.1; s.imbShare = 0.5;
let neg = C.compute(s).expected.brp;
T.ok(neg.draft.sum < 0 && neg.security === 0, 'a member whose imbalance earns money adds €0, not a negative amount');

// Choices move the right parts.
s = desk(); s.reading = 'flat';
T.money(C.compute(s).expected.total, 133994.25, 'the 50 MW reading does not affect the marginal basis');
T.ok(ft.expected.parts.every(p => p.form === 'Cash' && p.formRule === 'Cash only') && !ft.expected.parts.some(p => p.id === 'fund'), 'Direct+ accepts cash only: every part is cash, no default fund');
s = desk(); s.week = '2027-03-22';
let r = C.compute(s);
T.eq([r.expected.brp.rule, r.expected.ecc.binding.date, r.expected.ecc.binding.gap], ['draft', '2027-03-25', 5], 'Easter 2027: the draft, and Thursday before the five-day holiday sets the amount');
s.rule = 'current';
T.eq(C.compute(s).expected.brp.rule, 'current', 'the rule can be overridden (Q3: both options)');
s = desk(); s.splitMode = 'mine'; s.key = 60;
T.ok(C.compute(s).expected.ecc.C > 125745, 'your own split needs more than the cheapest one');
s = desk(); s.aucLimitPrice = null;
T.throws(() => C.compute(s), 'auction buys without a limit price and no market maximum set');
s.aucMaxPrice = 4000;
T.ok(C.compute(s).expected.ecc.C > 1000000, 'orders without a limit price at a €4,000 market maximum need far more collateral');

// Every preset gives a finite total, and the sensitivities move the way they should.
Object.keys(C.PRESETS).forEach(id => {
  const x = C.compute(C.preset(id));
  T.ok(isFinite(x.expected.total) && isFinite(x.stress.total) && x.stress.total >= x.expected.total, id + ': finite totals, stress ≥ expected');
  const sv = {}; x.sensitivity.forEach(v => { sv[v.id] = v.total; });
  T.ok(sv['vol+'] >= x.expected.total && sv['vol-'] <= x.expected.total && sv.imb >= x.expected.total, id + ': sensitivities move in the right direction');
});

// The settings list covers every setting, and presets only use known settings.
const keys = new Set(); C.GROUPS.forEach(g => g.fields.forEach(fl => keys.add(fl.key)));
T.eq(Object.keys(C.BASE).filter(k => k !== 'week' && !keys.has(k)), [], 'every setting appears on the settings page');
Object.keys(C.PRESETS).forEach(id => T.eq(Object.keys(C.PRESETS[id].values).filter(k => !(k in C.BASE)), [], id + ': preset uses known settings only'));
T.ok(ft.assumptions.length > 30 && ft.assumptions.every(a => a.src && a.tag !== 'input'), 'assumptions list: every non-input setting with a source');

// Static vs daily-optimised collateral (Niki, 26 Sep 2026). Static: one amount all week, set by the Friday calculation.
// Daily: each calculation day on its own, with its own cheapest split; the wallet needs the peak only around the weekend.
T.eq([ft.expected.ecc.mode, ft.expected.weekdayTotal], ['static', ft.expected.total], 'static collateral: one amount all week');
s = desk(); s.collateralMode = 'daily';
const dl = C.compute(s).expected;
T.eq(dl.ecc.perDay.map(x => [x.date.slice(5), x.C, x.key]), [['10-05', 58681, 47], ['10-06', 58681, 47], ['10-07', 58681, 47], ['10-08', 58681, 47], ['10-09', 125745, 53]], 'daily collateral: €58,681 Monday to Thursday, €125,745 on Friday');
T.eq([dl.ecc.weekday, dl.ecc.peak], [58681, 125745], 'daily collateral: weekday level and weekend peak');
T.money(dl.weekdayTotal, 58681 + 8160 + 89.25, 'daily collateral: the wallet needs €66,930 during the week');
T.money(dl.total, ft.expected.total, 'daily collateral: the peak around the weekend is the static amount here');
T.ok(dl.ecc.perDay.every(x => x.C <= ft.expected.ecc.C), 'no day needs more than the static amount');

// The prospect questionnaire: default answers give exactly each preset; answers move the right settings.
Object.keys(C.PRESETS).forEach(id => {
  const s = C.fromAnswers(C.defaultAnswers(id)), p = C.preset(id);
  T.eq(Object.keys(p).filter(k => String(p[k]) !== String(s[k])), [], id + ': default answers reproduce the preset');
});
let a = C.defaultAnswers('trader'); a.markets = 'continuous';
let q = C.fromAnswers(a);
T.eq([q.aucBuy, q.aucSell, q.contBuy], [0, 0, 60], 'continuous only: no auction volumes');
a = C.defaultAnswers('trader'); a.contBuy = 120;
T.eq([C.fromAnswers(a).restingCont, C.fromAnswers(a).eveningCont], [5000, 2500], 'resting orders and evening buying scale with continuous buying');
T.eq(C.strategyVolumes('aggregator', 'flat'), { cont: { buy: 25, sell: 25 }, auc: { buy: 60, sell: 60 } }, 'a flat strategy splits volumes evenly');
T.eq(C.strategyVolumes('trader', 'buyer'), { cont: { buy: 108, sell: 12 }, auc: { buy: 27, sell: 3 } }, 'a buyer strategy buys 90%');
a = C.defaultAnswers('asset'); a.capacityMW = 45; a.sites = 3;
q = C.fromAnswers(a);
T.eq([q.connectionsMW, q.smartSd, q.shiftShare], ['15, 15, 15', 450, 1], 'portfolio: equal sites, reconciliation spread from capacity, production with consumption shifts between periods');
a = C.defaultAnswers('trader'); a.portfolio = { production: true, consumption: false }; a.capacityMW = 20; a.sites = 1;
q = C.fromAnswers(a);
T.eq([q.connectionsMW, q.shiftShare], ['20', 0], 'a trader with 20 MW of production: one site, no shifting');
a.portfolio = { production: false, consumption: false };
T.eq(C.fromAnswers(a).connectionsMW, '', 'no assets ticked: capacity is ignored');
T.eq([C.suggestBalance('trader', { production: true }), C.suggestBalance('asset', { consumption: true }), C.suggestBalance('trader', {})], ['forecast', 'normal', 'tight'], 'the portfolio suggests how closely positions are matched');
a = C.defaultAnswers('trader'); a.weekend = 'no';
T.eq([C.fromAnswers(a).weekend, C.fromAnswers(Object.assign(a, { weekend: 'both' })).weekend], [false, true], 'weekend answers: no, and "show me both" maps to trading at weekends (the page runs both)');
a = C.defaultAnswers('trader'); a.carry = 'none';
T.money(C.compute(C.fromAnswers(a)).expected.settlement.float, 0, 'no positions held over 16:00: no float');

// The presets compare like with like: each moves about 150 MWh a day, and no wallet is an outlier.
const vol = id => { const v = C.preset(id); return v.contBuy + v.contSell + v.aucBuy + v.aucSell; };
T.eq(['trader', 'aggregator', 'asset'].map(vol), [150, 170, 130], 'presets: MWh a day traded');
T.eq([C.preset('trader').s, C.preset('aggregator').s, C.preset('asset').s], [0.34, 0, 0], 'the trader assumes its largest open position is 66% of its buys');
const na = C.defaultAnswers('trader');
T.eq([na.netting, C.fromAnswers(na).s], ['mixed', 0.34], 'trader answers: buys and sells mixed by default, largest open position 66%');
const nt = ['block', 'mixed', 'flat'].map(n => C.compute(C.fromAnswers(Object.assign(C.defaultAnswers('trader'), { netting: n }))).expected.total);
T.ok(nt[0] > nt[1] && nt[1] > nt[2], 'more offsetting, less wallet: ' + nt.map(Math.round).join(' / '));
T.eq(C.fromAnswers(Object.assign(C.defaultAnswers('asset'), { netting: 'flat' })).s, 0, 'the netting answer only applies to traders');
const tot = ['trader', 'aggregator', 'asset'].map(id => C.compute(C.preset(id)).expected.total);
T.ok(Math.max.apply(null, tot) <= 3 * Math.min.apply(null, tot), 'the three presets are within a factor of 3: ' + tot.map(Math.round).join(' / '));
// Collateral carried over from the limit calculator: that amount, with its split and base limits; flagged when short.
const own = C.compute(C.preset('trader')).expected.ecc;
const carried = extra => C.compute(Object.assign(C.preset('trader'), { eccCollateral: own.C, splitMode: 'mine', key: own.key,
  blContBD: own.baseLimits.cont.bd, blContNBD: own.baseLimits.cont.nbd, blAucBD: own.baseLimits.da.bd, blAucNBD: own.baseLimits.da.nbd }, extra || {})).expected.ecc;
let cr = carried();
T.ok(Math.abs(cr.C - own.C) < 0.5 && Math.abs(cr.fixed.need - own.C) < 0.5 && !cr.fixed.short, 'the wallet\'s own setup carried back: same amount, not short');
cr = carried({ eccCollateral: own.C - 5000 });
T.ok(cr.C === own.C - 5000 && cr.fixed.short, '€5,000 less than the trading needs is flagged as short');
cr = carried({ key: 100 });
T.ok(cr.fixed.need === null && cr.fixed.short, 'a split that cannot reach the auction targets is short, not an error');
cr = carried({ blContBD: 50000 });
T.ok(cr.baseLimits.cont.bd === 50000 && cr.fixed.need > own.C, 'carried base limits are used: a larger one needs more collateral');
T.eq(C.compute(C.preset('trader')).expected.ecc.fixed, null, 'without a carried amount nothing is fixed');
// Bad days (Direct+ decision, 26 Sep 2026): room for 1 bad day (normal) or 2 (tough): open position × €100/MWh.
const bt = C.compute(C.preset('trader'));
T.money(bt.expected.settlement.openMWh, 0.66 * 60 + 15, 'trader: open position = 66% of 60 MWh M7 buys + 15 MWh auction buys');
T.money(bt.expected.settlement.badDay, 54.6 * 100, 'trader, normal week: one bad day, 54.6 MWh × €100 = €5,460');
T.money(bt.stress.settlement.badDay, 2 * 54.6 * 100, 'trader, tough week: two bad days, €10,920');
T.money(bt.stress.settlement.flows, 0, 'no loss every day any more in a tough week');
const ba = C.compute(C.preset('asset')).expected.settlement;
T.money(ba.badDay, 20 * 100, 'asset owner: 20 MWh bought (battery, consumption) also has a bad day, €2,000');
T.money(C.compute(Object.assign(C.preset('trader'), { contBuy: 0, aucBuy: 0 })).expected.settlement.badDay, 0, 'no buying, no bad-day loss');
T.done();
