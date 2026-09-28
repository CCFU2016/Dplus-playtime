// tennet-account.js: Dutch working days, the imbalance debit day, the weekly imbalance model and its seeded Monte
// Carlo, and the exit tail (docs/wallet-model.md §5, §6.2).
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../src/wallet/tennet-account.js');
const { assertMoney } = require('../helpers.js');

const utc = (year, month, day) => new Date(Date.UTC(year, month - 1, day));

test('Dutch working days (to be confirmed with TenneT)', () => {
  assert.ok(!W.isWorkday(utc(2026, 5, 5)), 'Bevrijdingsdag 2026 is not a working day');
  assert.ok(!W.isWorkday(utc(2027, 4, 27)), 'Koningsdag 2027 is not a working day');
  assert.ok(W.isWorkday(utc(2026, 4, 3)), 'Good Friday is a Dutch working day (unlike the ECC calendar)');
});

test('the weekly imbalance invoice is debited four weeks after the delivery week (ASSUMPTION for the day)', () => {
  assert.equal(W.imbalanceDebit('2026-10-05'), '2026-11-09', 'four weeks after the delivery week');
  assert.equal(W.imbalanceDebit('2026-03-23'), '2026-04-28', 'Koningsdag (Monday 27 Apr 2026) moves it to the Tuesday');
  assert.equal(W.imbalanceDebit('2027-02-22'), '2027-03-30', 'Easter Monday 2027 moves it to the Tuesday');
  assert.equal(W.imbalanceDebit('2026-10-05', 2), '2026-10-26', 'a two-week lag');
});

test('the weekly imbalance model (the financial trader, §8.3)', () => {
  const trader = W.weekly({
    volume: 680 * 7,
    share: 0.005,
    bias: 0,
    price: 80,
    state2Share: 0.05,
    state2Gap: 150,
    cv: 0.5,
  });
  assertMoney(trader.mean, 89.25, 'the mean weekly invoice');
  assertMoney(trader.sd, 952, 'its σ');
  assertMoney(trader.B, 1993.25, 'the expected B');
  const biased = W.weekly({ volume: 1000, share: 0.1, bias: 0.5, price: 100, state2Share: 0.1, state2Gap: 200, cv: 1 });
  assertMoney(biased.mean, 100 * (0.5 * 100 + (0.5 * 20) / 2), 'a short bias pays the imbalance price on its share');
  const short = W.weekly({ volume: 0, share: 0, price: 100, shortVolume: 10 });
  assert.deepEqual(
    [short.volume, short.mean, short.sd],
    [10, 1000, 500],
    'imbalance that is always short pays the full price',
  );
});

test('the stress end of B is a seeded Monte Carlo: the same inputs give the same amount', () => {
  assertMoney(W.stressB(89.25, 952), 2713.011640773227, 'the financial trader (seed 20260926)');
  assertMoney(W.stressB(10000, 3000), 18268.156431008072, 'μ 10,000, σ 3,000');
  assert.notEqual(
    W.stressB(10000, 3000, { seed: 1 }),
    W.stressB(10000, 3000),
    'a different seed gives a different draw',
  );
  const random = W.mulberry32(42);
  assert.deepEqual(
    [random(), random(), random()].map((x) => x.toFixed(10)),
    ['0.6011037519', '0.4482905590', '0.8524657935'],
    'the mulberry32 sequence for seed 42',
  );
});

test('after the member stops, the security stays committed until the last invoices are settled', () => {
  assert.deepEqual(
    W.exitTail('2026-10-31', { profile: true, smart: true }),
    { imbalance: '2026-11-28', smart: '2027-05-01', profile: '2028-07-31', released: '2028-07-31' },
    'with profile and smart-meter connections',
  );
  assert.equal(W.exitTail('2026-10-31').released, '2026-11-28', 'without connections: about four weeks');
});
