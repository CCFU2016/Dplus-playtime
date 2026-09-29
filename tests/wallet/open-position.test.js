// open-position.js: the open-position buffer and its 2025 price percentiles (docs/wallet-model.md §4.5).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const O = require('../../src/wallet/open-position.js');
const { assertMoney } = require('../helpers.js');

const PRICES = path.join(
  __dirname,
  '../../reference/tennet/tennet-entsoe_imbalance-and-day-ahead-prices-2025_daily-averages_2026-09-29.csv',
);

/** The p-th percentile of `values`, linear between neighbours (numpy's default). */
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  return sorted[low] + (sorted[Math.ceil(rank)] - sorted[low]) * (rank - low);
}

test("the percentiles are those of 2025's daily imbalance prices and their spreads over day-ahead", () => {
  const [header, ...lines] = fs.readFileSync(PRICES, 'utf8').trim().split(/\r?\n/); // as exported: Windows line ends
  const COLUMNS = ['price_short', 'price_long', 'isp_count', 'price_da', 'spread_short', 'spread_long'];
  assert.equal(header, ['date', ...COLUMNS.map((name) => (name === 'isp_count' ? name : `${name}_eur_mwh`))].join(','));
  const days = lines.map((line) => {
    const cells = line.split(',').slice(1).map(Number);
    return Object.fromEntries(COLUMNS.map((name, i) => [name, cells[i]]));
  });
  assert.equal(days.length, 365, 'every day of 2025');
  assert.equal(
    days.reduce((total, day) => total + day.isp_count, 0),
    35040,
    'every quarter-hour, DST days included',
  );
  for (const day of days) {
    assert.ok(Math.abs(day.price_short - day.price_da - day.spread_short) < 0.0002, 'spread = shortage − day-ahead');
    assert.ok(Math.abs(day.price_long - day.price_da - day.spread_long) < 0.0002, 'spread = surplus − day-ahead');
  }
  const column = (name) => days.map((day) => day[name]);
  for (const level of O.PERCENTILES) {
    const p = level.id === 'max' ? 100 : Number(level.id.slice(1));
    for (const measure of ['price', 'spread']) {
      assertMoney(level[measure].short, percentile(column(`${measure}_short`), p), `${level.id} ${measure}: top end`);
      assertMoney(
        level[measure].long,
        percentile(column(`${measure}_long`), 100 - p),
        `${level.id} ${measure}: bottom`,
      );
    }
  }
});

test('the buffer: the largest open position × days at risk × the larger of what a short and a long lose', () => {
  const both = (mwh) => ({ short: mwh, long: mwh });
  const p99 = O.buffer({ largest: both(50.3), days: 1, percentile: 'p99' });
  assert.deepEqual(
    [p99.measure, p99.side, p99.position, p99.short, p99.longLoss, p99.price, p99.fromPlan],
    ['price', 'short', 50.3, 255.86, 37.78, 255.86, false],
  );
  assertMoney(p99.security, 50.3 * 255.86, '50.3 MWh × 1 day × €255.86');
  assertMoney(
    O.buffer({ largest: both(20), days: 3, percentile: 'max' }).security,
    20 * 3 * 286.42,
    'worst day, 3 days',
  );
  assert.equal(O.stressPrice('p90').longLoss, 0, 'at p90 a long still receives money (€20.16): it loses nothing');
  const spread = O.buffer({ largest: both(20), days: 1, percentile: 'p99', measure: 'spread' });
  assert.deepEqual([spread.side, spread.price], ['short', 162.62], 'the spread over day-ahead: €162.62 at p99');
  assertMoney(spread.security, 3252.4, '20 MWh × 1 day × €162.62');
  const p90 = O.stressPrice('p90', 'spread');
  assert.deepEqual(
    [p90.side, p90.price],
    ['long', 49.99],
    'spread p90: an open long bought at day-ahead loses more (€49.99) than a short (€48.82)',
  );
  assert.deepEqual([O.stressPrice().id, O.stressPrice().measure], ['p99', 'price'], 'by default: p99 of the price');
  assert.equal(O.buffer({}).security, 0, 'nothing open, nothing to cover');

  // Each side on its own: a large long loses less than a small short, as a long only loses at negative prices.
  const longer = O.buffer({ largest: { short: 10, long: 90 } });
  assert.deepEqual([longer.side, longer.position], ['long', 90], '90 × €37.78 = €3,400 against 10 × €255.86 = €2,559');

  // What the plan leaves open (a member without assets) when it is more: + an open short, − an open long.
  const seller = O.buffer({ largest: { short: 90.34, long: 10.26 }, planned: 110 });
  assert.deepEqual(
    [seller.side, seller.position, seller.fromPlan],
    ['short', 110, true],
    'selling 110 more: short 110',
  );
  assertMoney(seller.security, 110 * 255.86, '110 MWh × €255.86');
  const buyerOnSpread = O.buffer({ largest: { short: 10.26, long: 90.34 }, planned: -110, measure: 'spread' });
  assert.deepEqual(
    [buyerOnSpread.side, buyerOnSpread.position, buyerOnSpread.loses],
    ['long', 110, 'what an open long loses under the day-ahead price it bought at'],
    'buying 110 more, on the spread: long 110 × €87.89',
  );
  assertMoney(buyerOnSpread.security, 110 * 87.89, '€9,667.90');
  assert.throws(() => O.stressPrice('p42'), /No percentile "p42"/);
  assert.throws(() => O.stressPrice('p99', 'vwap'), /No stress price measure "vwap"/);
});
