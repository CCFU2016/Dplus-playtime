// wallet.js: the combined result per member, the presets and the settings list (docs/wallet-model.md §7, §8, §11.1).
const C = require('../../src/wallet/wallet.js');
const T = require('./assert.js')('wallet');

// The worked example (§8.5): financial trader, week of 5 Oct 2026, rule in force, 1,200 MWh reading, all cash.
const ft = C.compute(C.preset('trader'));
T.money(ft.expected.total, 317834.25, 'financial trader: expected total');
T.money(ft.stress.total, 730383.25, 'financial trader: stress total');
T.eq(ft.expected.parts.map(p => [p.id, Math.round(p.value * 100) / 100]), [['ecc', 125745], ['fund', 0], ['settlement', 0], ['brp', 192000], ['invoices', 89.25]], 'financial trader: expected parts');
T.eq(ft.stress.parts.map(p => [p.id, Math.round(p.value * 100) / 100]), [['ecc', 406594], ['fund', 0], ['settlement', 29750], ['brp', 288000], ['invoices', 6039.25]], 'financial trader: stress parts');
T.eq([ft.expected.ecc.key, ft.expected.ecc.binding.date], [53, '2026-10-09'], 'financial trader: 53/47, the Friday calculation sets the amount');
T.eq(ft.expected.brp.rule, 'current', 'October 2026: the rule in force');
T.money(ft.expected.brp.draft.security, 96000, 'financial trader: the draft would give the €96,000 minimum');
T.money(ft.expected.segments.trading + ft.expected.segments.brp + ft.expected.segments.available, ft.expected.total, 'segments add up to the total');

// Choices move the right parts.
let s = C.preset('trader'); s.reading = 'flat';
T.money(C.compute(s).expected.total, 221834.25, 'flat €96,000 reading');
s = C.preset('trader'); s.eccForm = 'guarantee';
T.money(C.compute(s).expected.parts[1].value, 5029.8, 'a guarantee adds a 4% default-fund contribution');
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

T.done();
