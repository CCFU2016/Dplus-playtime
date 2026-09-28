// settlement.js: booking windows, value dates, open risk and the cash path (docs/wallet-model.md §3).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/wallet/settlement.js');
const { assertMoney } = require('../helpers.js');

const WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
const NEXT_WEEK = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
const perDay = (net) => () => ({ tradeNet: net, net });
const withNets = (nets) => Object.entries(nets).map(([close, net]) => ({ ...S.bookingWindow(close), net }));

test('the value date is the next ECC business day (brief, Phase 2)', () => {
  const valueDate = (close) => S.bookingWindow(close).valueDate;
  assert.equal(valueDate('2026-10-02'), '2026-10-05', 'Fri 2 Oct 2026 → Mon 5 Oct');
  assert.equal(valueDate('2026-10-05'), '2026-10-06', 'Mon 5 Oct 2026 → Tue 6 Oct');
  assert.equal(valueDate('2027-03-25'), '2027-03-30', 'Thu 25 Mar 2027 → Tue 30 Mar (Good Friday, Easter Monday)');
  assert.equal(valueDate('2027-03-30'), '2027-03-31', 'Tue 30 Mar 2027 → Wed 31 Mar');
});

test('a booking window holds the trading days since the last business day', () => {
  const easter = S.bookingWindow('2027-03-30');
  assert.deepEqual(
    easter.days,
    ['2027-03-26', '2027-03-27', '2027-03-28', '2027-03-29', '2027-03-30'],
    'Tue 30 Mar 2027: five days',
  );
  assert.deepEqual(
    [easter.fundBy, easter.receivedBy],
    ['2027-03-30 18:00', '2027-03-31 08:00'],
    'fund by 18:00, received by 08:00',
  );
  assert.deepEqual(
    S.bookingWindow('2026-10-05').days,
    ['2026-10-03', '2026-10-04', '2026-10-05'],
    'a Monday: three days',
  );
  assert.throws(() => S.bookingWindow('2026-10-03'), Error, 'a window closing on a Saturday');
});

test("open risk is the window's net buying; fees count in the amount, never in the open risk", () => {
  const [monday, tuesday] = S.windows(['2026-10-05', '2026-10-06'], perDay(1000));
  assertMoney(monday.OR, 3000, 'Monday covers three days');
  assertMoney(tuesday.OR, 1000, 'Tuesday covers one day');
  // A negative-price day: the day's buying is a credit, so the window pays the member and adds no open risk.
  const credit = S.windows(['2026-10-06'], perDay(-3000));
  assertMoney(credit[0].net, -3000, 'negative-price day: the window is a credit');
  assertMoney(credit[0].OR, 0, 'negative-price day: no open risk');
  assertMoney(S.cashPath(credit, 'none').need, 0, 'negative-price day: no cash needed');
  const [withFees] = S.windows(['2026-10-06'], perDay(-3000), () => 500);
  assertMoney(withFees.net, -2500, 'extras are added to the net amount');
  assertMoney(withFees.OR, 0, 'extras never enter open risk');
});

test('the cash path: the stress week of the worked example (§8.2)', () => {
  const stress = withNets({
    '2026-10-05': 12750,
    '2026-10-06': 4250,
    '2026-10-07': 4250,
    '2026-10-08': 4250,
    '2026-10-09': 4250,
  });
  assertMoney(S.cashPath(stress, 'none').need, 29750, 'no top-ups: the peak cumulative outflow');
  assertMoney(S.cashPath(stress, 'daily').need, 12750, 'daily top-ups: the largest single amount');
  assertMoney(S.cashPath(stress, 'weekly').need, 29750, 'weekly top-ups: none inside one week');
});

test('the cash path over two weeks, and the order of a weekly top-up', () => {
  // €1,000 a trading day (Monday windows €3,000). Weekly: the first week's collections (€6,000 by Fri 9 Oct) are
  // topped up on Mon 12 Oct, so the peak is 7,000 − 6,000 + 7,000 = €8,000.
  const windows = S.windows([...WEEK, ...NEXT_WEEK], perDay(1000));
  assertMoney(S.cashPath(windows, 'none').need, 14000, 'no top-ups');
  assertMoney(S.cashPath(windows, 'daily').need, 3000, 'daily top-ups');
  assertMoney(S.cashPath(windows, 'weekly').need, 8000, 'weekly top-ups');
  // The weekly top-up comes at midday on the first day of the new week: after that morning's collection and before its
  // funding, and every row shows the balance after it.
  const { path } = S.cashPath(windows, 'weekly');
  assert.deepEqual(
    path
      .filter((row) => row.at.startsWith('2026-10-12'))
      .map((row) => [row.at.slice(11), row.kind, row.amount, row.level]),
    [
      ['08:00', 'collect', 1000, 7000],
      ['12:00', 'top-up', 6000, 1000],
      ['18:00', 'fund', 3000, 4000],
    ],
    'Monday 12 Oct, in time order',
  );
  assert.ok(
    path.every((row, i) => i === 0 || path[i - 1].at <= row.at),
    'the whole path is in time order',
  );
});

test('a credit arrives on its value date and lowers the need', () => {
  // Mon +10,000, Tue −3,000 (arrives Wed 08:00), Wed +5,000.
  const windows = withNets({ '2026-10-05': 10000, '2026-10-06': -3000, '2026-10-07': 5000 });
  assertMoney(S.cashPath(windows, 'none').need, 12000, 'no top-ups');
  assertMoney(S.cashPath(windows, 'daily').need, 10000, 'daily top-ups');
});
