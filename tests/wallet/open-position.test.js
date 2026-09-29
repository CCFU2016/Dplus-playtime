// open-position.js: the open-position buffer and its 2025 imbalance price percentiles (docs/wallet-model.md §4.5).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const O = require('../../src/wallet/open-position.js');
const { assertMoney } = require('../helpers.js');

const PRICES = path.join(
  __dirname,
  '../../reference/tennet/tennet_imbalance-prices-2025_daily-averages_2026-09-29.csv',
);

/** The p-th percentile of `values`, linear between neighbours (numpy's default). */
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  return sorted[low] + (sorted[Math.ceil(rank)] - sorted[low]) * (rank - low);
}

test("the percentiles are those of TenneT's 2025 daily imbalance prices", () => {
  const [header, ...lines] = fs.readFileSync(PRICES, 'utf8').trim().split(/\r?\n/); // as exported: Windows line ends
  assert.equal(header, 'date,price_short_eur_mwh,price_long_eur_mwh,isp_count');
  const days = lines.map((line) => line.split(','));
  assert.equal(days.length, 365, 'every day of 2025');
  assert.equal(
    days.reduce((total, day) => total + Number(day[3]), 0),
    35040,
    'every quarter-hour, DST days included',
  );
  const short = days.map((day) => Number(day[1]));
  const long = days.map((day) => Number(day[2]));
  for (const level of O.PERCENTILES) {
    const p = level.id === 'max' ? 100 : Number(level.id.slice(1));
    assertMoney(level.short, percentile(short, p), `${level.id}: the top end of the shortage price`);
    assertMoney(level.long, percentile(long, 100 - p), `${level.id}: the bottom end of the surplus price`);
  }
});

test('the buffer: open position × days at risk × the larger of what a short pays and a long loses', () => {
  const p99 = O.buffer({ cap: 20, days: 1, percentile: 'p99' });
  assert.deepEqual([p99.side, p99.short, p99.longLoss, p99.price], ['short', 255.86, 37.78, 255.86]);
  assertMoney(p99.amount, 5117.2, '20 MWh × 1 day × €255.86');
  assertMoney(O.buffer({ cap: 20, days: 3, percentile: 'max' }).amount, 20 * 3 * 286.42, 'the worst day, three days');
  assert.equal(O.stressPrice('p90').longLoss, 0, 'at p90 a long still receives money (€20.16): it loses nothing');
  assert.equal(O.stressPrice().id, O.DEFAULT_PERCENTILE, 'the 99th percentile by default');
  assert.equal(O.buffer({ cap: 0 }).amount, 0, 'nothing left open, no buffer');
  assert.throws(() => O.stressPrice('p42'), /No imbalance price percentile "p42"/);
});
