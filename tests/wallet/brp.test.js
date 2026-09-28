// brp.js: BRP security under the current and draft art. 10.8 (docs/wallet-model.md §4). The first ten cases are the
// brief's Phase 3 table, checked by hand; if the code disagrees, recheck both before changing either.
const R = require('../../src/wallet/brp.js');
const T = require('./assert.js')('brp');
const alternating = (a, b, n) => Array.from({ length: n }, (_, i) => (i % 2 ? b : a));

// Draft, positive B: A = 300 × €80; invoices alternating 2,000 / 8,000; C = D = 0; population σ.
let r = R.draft({ A: 300 * 80, B: R.componentB(alternating(2000, 8000, 10)) });
T.money(r.B, 11000, 'draft positive B: B = 5,000 + 2 × 3,000');
T.money(r.security, 116000, 'draft positive B: 72,000 + 44,000');
// Draft, sample σ.
T.money(R.stats(alternating(2000, 8000, 10), 10, 'sample').sd, 3162.2777, 'sample σ = 3,162.2777');
r = R.draft({ A: 300 * 80, B: R.componentB(alternating(2000, 8000, 10), 'sample') });
T.money(r.B, 11324.5553, 'sample σ: B = 11,324.5553');
T.money(r.security, 117298.2213, 'sample σ: total €117,298.22');
// Draft, negative B: the €96,000 minimum applies.
r = R.draft({ A: 400 * 80, B: R.componentB(alternating(-1500, -2500, 10)) });
T.money(r.B, -1000, 'draft negative B: B = −2,000 + 2 × 500');
T.money(r.sum, 92000, 'draft negative B: 3A + 4B = 92,000');
T.money(r.security, 96000, 'draft negative B: the €96,000 minimum');
// Draft ramp-up (1) and (2): missing invoices count as €0.
const s = R.stats([2000, 8000], 10);
T.money(s.mean, 1000, 'ramp-up (1): mean');
T.money(s.sd, 2408.3189, 'ramp-up (1): σ 2,408.32');
T.money(R.componentB([2000, 8000]), 5816.6378, 'ramp-up (1): B = 5,816.64');
T.money(R.componentB(Array(7).fill(10000)), 16165.1514, 'ramp-up (2): B = 16,165.15 (steady state 10,000)');
// Current, 1,200 MWh reading: expected 500 MWh a day, three-month average €80.
r = R.current({ volume: 500, price3m: 80 });
T.money(r.A, 96000, 'current 1,200 MWh reading: A = 1,200 × 80');
T.money(r.security, 192000, 'current 1,200 MWh reading: 2A');
// Current, price floor: 1,200 MWh at an average of €35.
r = R.current({ volume: 1200, price3m: 35 });
T.money(r.A, 48000, 'current price floor: A = 1,200 × 40');
T.money(r.security, 96000, 'current price floor: €96,000');
// Current, large connections: A = €50,000, B = €150,000, so 2A < B and the security is A + B.
r = R.current({ volume: 50000 / 80, price3m: 80, capacityMW: 150000 / 80 / 24, reading: 'flat' });
T.money(r.A, 50000, 'large connections: A = €50,000');
T.money(r.B, 150000, 'large connections: B = €150,000');
T.ok(!r.twoA, 'large connections: 2A < B');
T.money(r.security, 200000, 'large connections: A + B = €200,000');
// Current, capacity classes: three connections of 30 MW count 78 MW.
T.money(R.countedCapacity([30, 30, 30]), 78, 'three 30 MW connections count 78 MW');

// Beyond the table: classes and edge cases (INTERPRETATION settings).
T.money(
  R.countedCapacity([1.5, 2, 10, 11, 25, 26, 50, 60]),
  0 + 2 + 2 + 11 + 11 + 26 + 26 + 60,
  'each class at its lowest value, above 50 MW actual, under 2 MW nothing',
);
T.money(R.countedCapacity([10.5]), 2, 'between classes rounds down by default');
T.money(R.countedCapacity([10.5], 'up'), 11, 'between classes rounds up when set');
T.money(R.current({ volume: 0, price3m: 80 }).B, 1200 * 80, 'current B has a 50 MW floor even with no connections');
T.money(
  R.current({ volume: 0, price3m: 80, reading: 'flat' }).security,
  96000,
  'flat reading: €96,000 minimum on the total',
);
// Recalculated A: TenneT's request (para 5) has no volume floor, the BRP's own request (para 6) has it.
r = R.current({ volume: 300, price3m: 80 });
T.eq(
  [r.Aup, r.Adown, r.A],
  [300 * 80, 1200 * 80, 1200 * 80],
  'A_up has no volume floor; A_down has the 1,200 MWh floor, as A',
);

// A Direct+ member's marginal collateral: no floors and no minimum, never below €0 (ASSUMPTION).
r = R.current({ volume: 300, price3m: 80, floors: false });
T.eq([r.A, r.B, r.security], [24000, 0, 48000], 'marginal, current rule: 2 × 300 × €80, no 50 MW floors');
T.money(
  R.current({ volume: 0, price3m: 80, floors: false }).security,
  0,
  'marginal, current rule: no volume, nothing to put up',
);
r = R.draft({ A: 1000, B: -5000, minimum: false });
T.eq([r.sum, r.security], [-17000, 0], 'marginal, draft: a negative sum puts up €0, not a negative amount');

// Rule selector: by date, or chosen.
T.eq(
  [R.ruleFor('2026-12-31'), R.ruleFor('2027-01-01'), R.ruleFor('2027-06-01', 'current')],
  ['current', 'draft', 'current'],
  'rule by date, or chosen',
);

// Ramp-up for a new member (draft): constant weekly invoice €10,000, no reconciliation, A = 0.
const ramp = R.rampUp({ A: 0, weekly: 10000, minimum: false });
T.eq(
  ramp.months.slice(0, 6).map((m) => m.invoices.B),
  [0, 0, 4, 9, 10, 10],
  'ramp-up: real invoices in the ten-week window, months 1-6',
);
T.money(
  ramp.peak.B,
  10000 * (0.9 + 2 * 0.3),
  'ramp-up: monthly recalculation peaks at 9 of 10 invoices (1.5× steady state)',
);
const rc = R.rampUp({ A: 0, profile: 1000, smart: 1000, minimum: false });
T.eq(
  [rc.months[5].invoices.C, rc.months[6].invoices.C, rc.months[6].invoices.D, rc.months[7].invoices.D],
  [0, 1, 0, 1],
  'ramp-up: first C invoice counted from month 7, first D from month 8 (paid in months 6 and 7)',
);
T.money(
  R.rampUp({ A: 0, weekly: 1000 }).peak.security,
  96000,
  'ramp-up with small invoices stays at the €96,000 minimum',
);
// A member whose imbalance earns money: while the window fills, the €0 stand-ins spread it, so B = mean + 2σ is
// positive; once the window is full, the sum is negative and the marginal amount is €0.
const earning = R.rampUp({ A: 0, weekly: -1000, minimum: false }).months;
T.ok(
  earning.every((m) => m.security >= 0) && earning.at(-1).security === 0,
  'ramp-up, marginal: never below €0, and €0 with a full window',
);

T.done();
