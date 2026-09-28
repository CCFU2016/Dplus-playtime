// brp.js: BRP security under the current and draft art. 10.8 (docs/wallet-model.md §4). The cases of the first three
// tests are the brief's Phase 3 table, checked by hand: if the code disagrees, recheck both before changing either.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../src/wallet/brp.js');
const { assertMoney } = require('../helpers.js');

const alternating = (a, b, n) => Array.from({ length: n }, (_, i) => (i % 2 ? b : a));

test('the draft rule: 3A + 4B + 6C + 6D, with the €96,000 minimum (the brief’s table)', () => {
  // A = 300 × €80; invoices alternating 2,000 / 8,000; C = D = 0; population σ.
  const positive = R.draft({ A: 300 * 80, B: R.componentB(alternating(2000, 8000, 10)) });
  assertMoney(positive.B, 11000, 'positive B: B = 5,000 + 2 × 3,000');
  assertMoney(positive.security, 116000, 'positive B: 72,000 + 44,000');
  assertMoney(R.stats(alternating(2000, 8000, 10), 10, 'sample').sd, 3162.2777, 'sample σ = 3,162.2777');
  const sample = R.draft({ A: 300 * 80, B: R.componentB(alternating(2000, 8000, 10), 'sample') });
  assertMoney(sample.B, 11324.5553, 'sample σ: B = 11,324.5553');
  assertMoney(sample.security, 117298.2213, 'sample σ: total €117,298.22');
  const negative = R.draft({ A: 400 * 80, B: R.componentB(alternating(-1500, -2500, 10)) });
  assertMoney(negative.B, -1000, 'negative B: B = −2,000 + 2 × 500');
  assertMoney(negative.sum, 92000, 'negative B: 3A + 4B = 92,000');
  assertMoney(negative.security, 96000, 'negative B: the €96,000 minimum');
});

test('the draft rule while the invoice window fills: missing invoices count as €0 (the brief’s table)', () => {
  const two = R.stats([2000, 8000], 10);
  assertMoney(two.mean, 1000, 'two invoices: mean');
  assertMoney(two.sd, 2408.3189, 'two invoices: σ 2,408.32');
  assertMoney(R.componentB([2000, 8000]), 5816.6378, 'two invoices: B = 5,816.64');
  assertMoney(R.componentB(Array(7).fill(10000)), 16165.1514, 'seven invoices of 10,000: B = 16,165.15');
});

test('the rule in force: 2A or A + B, with the price floor and the 50 MW floor (the brief’s table)', () => {
  const small = R.current({ volume: 500, price3m: 80 });
  assertMoney(small.A, 96000, '1,200 MWh reading: A = 1,200 × 80');
  assertMoney(small.security, 192000, '1,200 MWh reading: 2A');
  const cheap = R.current({ volume: 1200, price3m: 35 });
  assertMoney(cheap.A, 48000, 'price floor: A = 1,200 × 40');
  assertMoney(cheap.security, 96000, 'price floor: €96,000');
  // Large connections: A = €50,000, B = €150,000, so 2A < B and the security is A + B.
  const large = R.current({ volume: 50000 / 80, price3m: 80, capacityMW: 150000 / 80 / 24, reading: 'flat' });
  assertMoney(large.A, 50000, 'large connections: A = €50,000');
  assertMoney(large.B, 150000, 'large connections: B = €150,000');
  assert.ok(!large.twoA, 'large connections: 2A < B');
  assertMoney(large.security, 200000, 'large connections: A + B = €200,000');
  assertMoney(R.countedCapacity([30, 30, 30]), 78, 'three 30 MW connections count 78 MW');
});

test('the rule in force: capacity classes and floors (INTERPRETATION settings)', () => {
  assertMoney(
    R.countedCapacity([1.5, 2, 10, 11, 25, 26, 50, 60]),
    0 + 2 + 2 + 11 + 11 + 26 + 26 + 60,
    'each class at its lowest value, above 50 MW actual, under 2 MW nothing',
  );
  assertMoney(R.countedCapacity([10.5]), 2, 'between classes: the lower one by default');
  assertMoney(R.countedCapacity([10.5], 'up'), 11, 'between classes: the higher one when set');
  assertMoney(R.current({ volume: 0, price3m: 80 }).B, 1200 * 80, 'B has a 50 MW floor even with no connections');
  assertMoney(
    R.current({ volume: 0, price3m: 80, reading: 'flat' }).security,
    96000,
    'flat reading: a €96,000 minimum',
  );
  // Recalculated A: TenneT's request (para 5) has no volume floor, the BRP's own request (para 6) has it.
  const low = R.current({ volume: 300, price3m: 80 });
  assert.deepEqual(
    [low.Aup, low.Adown, low.A],
    [300 * 80, 1200 * 80, 1200 * 80],
    'A_up has no volume floor; A_down has it',
  );
});

test("a Direct+ member's marginal collateral: no floors and no minimum, never below €0 (ASSUMPTION)", () => {
  const current = R.current({ volume: 300, price3m: 80, floors: false });
  assert.deepEqual([current.A, current.B, current.security], [24000, 0, 48000], 'the rule in force: 2 × 300 × €80');
  assertMoney(
    R.current({ volume: 0, price3m: 80, floors: false }).security,
    0,
    'the rule in force: no volume, nothing',
  );
  const draft = R.draft({ A: 1000, B: -5000, minimum: false });
  assert.deepEqual(
    [draft.sum, draft.security],
    [-17000, 0],
    'the draft: a negative sum puts up €0, not a negative amount',
  );
});

test('the rule by date, or as chosen', () => {
  assert.deepEqual(
    [R.ruleFor('2026-12-31'), R.ruleFor('2027-01-01'), R.ruleFor('2027-06-01', 'current')],
    ['current', 'draft', 'current'],
  );
});

test('the draft rule for a new member, month by month', () => {
  // A constant weekly invoice of €10,000, no reconciliation, A = 0.
  const ramp = R.rampUp({ A: 0, weekly: 10000, minimum: false });
  assert.deepEqual(
    ramp.months.slice(0, 6).map((m) => m.invoices.B),
    [0, 0, 4, 9, 10, 10],
    'real invoices in the window, months 1-6',
  );
  assertMoney(
    ramp.peak.B,
    10000 * (0.9 + 2 * 0.3),
    'the monthly recalculation peaks at 9 of 10 invoices (1.5× steady state)',
  );
  const reconciled = R.rampUp({ A: 0, profile: 1000, smart: 1000, minimum: false }).months;
  assert.deepEqual(
    [reconciled[5].invoices.C, reconciled[6].invoices.C, reconciled[6].invoices.D, reconciled[7].invoices.D],
    [0, 1, 0, 1],
    'the first C invoice counts from month 7, the first D from month 8 (paid in months 6 and 7)',
  );
  assertMoney(R.rampUp({ A: 0, weekly: 1000 }).peak.security, 96000, 'small invoices stay at the €96,000 minimum');
  // A member whose imbalance earns money: while the window fills, the €0 stand-ins spread it, so B = mean + 2σ is
  // positive; once the window is full, the sum is negative and the marginal amount is €0.
  const earning = R.rampUp({ A: 0, weekly: -1000, minimum: false }).months;
  assert.ok(
    earning.every((m) => m.security >= 0),
    'marginal: never below €0',
  );
  assert.equal(earning[earning.length - 1].security, 0, 'marginal: €0 with a full window');
});
