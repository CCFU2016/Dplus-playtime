// wallet.js: the combined result per member, the presets and the settings list (docs/wallet-model.md §7, §8, §11.1).
const C = require('../../src/wallet/wallet.js');
const T = require('./assert.js')('wallet');

// The worked example (§8.5): financial trader, week of 5 Oct 2026, rule in force, all cash. Direct+ members put up
// their marginal BRP collateral, with no minimum (Niki, 26 Sep 2026): a flat trader without connections adds nothing.
const ft = C.compute(C.preset('trader'));
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

// On your own as a BRP (for comparison): the minimum and the 50 MW floors apply.
let s = C.preset('trader'); s.brpBasis = 'standalone';
let sa = C.compute(s);
T.money(sa.expected.total, 325994.25, 'on your own as a BRP: expected (1,200 MWh reading: 2 × 1,200 × €80)');
T.money(sa.stress.total, 755883.25, 'on your own as a BRP: stress');
T.money(sa.expected.brp.draft.security, 96000, 'on your own as a BRP, the draft gives the €96,000 minimum');
s.reading = 'flat';
T.money(C.compute(s).expected.total, 229994.25, 'on your own as a BRP, flat €96,000 reading');
// Marginal amounts from members with volume or connections.
const ag = C.compute(C.preset('aggregator')).expected.brp, as = C.compute(C.preset('asset')).expected.brp;
T.money(ag.security, 150 * 80 * 2, 'aggregator: 150 MWh a day with one counterparty, 2 × A, no floors');
T.money(as.security, 90 * 80 + 26 * 24 * 80, 'asset: A + B = 90 × 80 + 26 MW × 24 × 80');
// A marginal share is never below €0, even when the draft's components are negative.
s = C.preset('asset'); s.week = '2027-10-04'; s.bias = -1; s.cv = 0.1; s.imbShare = 0.5;
let neg = C.compute(s).expected.brp;
T.ok(neg.draft.sum < 0 && neg.security === 0, 'a member whose imbalance earns money adds €0, not a negative amount');

// Choices move the right parts.
s = C.preset('trader'); s.reading = 'flat';
T.money(C.compute(s).expected.total, 133994.25, 'the 50 MW reading does not affect the marginal basis');
T.ok(ft.expected.parts.every(p => p.form === 'Cash' && p.formRule === 'Cash only') && !ft.expected.parts.some(p => p.id === 'fund'), 'Direct+ accepts cash only: every part is cash, no default fund');
s = C.preset('trader'); s.week = '2027-03-22';
let r = C.compute(s);
T.eq([r.expected.brp.rule, r.expected.ecc.binding.date, r.expected.ecc.binding.gap], ['draft', '2027-03-25', 5], 'Easter 2027: the draft, and Thursday before the five-day holiday sets the amount');
s.rule = 'current';
T.eq(C.compute(s).expected.brp.rule, 'current', 'the rule can be overridden (Q3: both options)');
s = C.preset('trader'); s.splitMode = 'mine'; s.key = 60;
T.ok(C.compute(s).expected.ecc.C > 125745, 'your own split needs more than the cheapest one');
s = C.preset('trader'); s.aucLimitPrice = null;
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

// The prospect questionnaire: default answers give exactly each preset; answers move the right settings.
Object.keys(C.PRESETS).forEach(id => {
  const s = C.fromAnswers(C.defaultAnswers(id)), p = C.preset(id);
  T.eq(Object.keys(p).filter(k => String(p[k]) !== String(s[k])), [], id + ': default answers reproduce the preset');
});
let a = C.defaultAnswers('trader'); a.markets = 'continuous';
let q = C.fromAnswers(a);
T.eq([q.aucBuy, q.aucSell, q.contBuy], [0, 0, 240], 'continuous only: no auction volumes');
a = C.defaultAnswers('trader'); a.contBuy = 120;
T.eq([C.fromAnswers(a).restingCont, C.fromAnswers(a).eveningCont], [5000, 2500], 'resting orders and evening buying scale with continuous buying');
T.eq(C.strategyVolumes('aggregator', 'flat'), { cont: { buy: 25, sell: 25 }, auc: { buy: 60, sell: 60 } }, 'a flat strategy splits volumes evenly');
T.eq(C.strategyVolumes('trader', 'buyer'), { cont: { buy: 432, sell: 48 }, auc: { buy: 180, sell: 20 } }, 'a buyer strategy buys 90%');
a = C.defaultAnswers('asset'); a.connections = [{ mw: 30, metering: 'telemetry' }, { mw: 12, metering: 'profile' }];
q = C.fromAnswers(a);
T.eq([q.connectionsMW, q.smartSd, q.profileSd], ['30, 12', 300, 120], 'connections: capacities, and reconciliation spread by metering type');
a = C.defaultAnswers('trader'); a.carry = 'none';
T.money(C.compute(C.fromAnswers(a)).expected.settlement.float, 0, 'no positions held over 16:00: no float');

T.done();
