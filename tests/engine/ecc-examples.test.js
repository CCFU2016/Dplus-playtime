// ECC's own worked examples, from its DCP client deck (July 2025): p.8 (continuous) and p.10 (auction), with €10 of
// collateral and base limits of €1. They must always pass: if a change breaks them, the change is wrong, not the test.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/engine.js');
const { assertNear } = require('../helpers.js');

const WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']; // Monday to Friday
const OPEN_RISK = [0, 5, 9, 3, 2]; // each day's unsettled purchases

test('deck p.8: the continuous limit at 16:00, from 18:00 and the next morning', () => {
  const want = { l16: [1, 1, 1, 1, 3], l18: [9, 4, 1, 4, 7], l09: [9, 9, 9, 7, 9] };
  WEEK.forEach((day, i) => {
    const params = { C: 10, OR: OPEN_RISK[i], cont: { bd: 1, nbd: 1, key: 100 }, da: { bd: 0, nbd: 0, key: 0 } };
    const { cont } = E.day(E.parse(day), params);
    assertNear(cont.l16, want.l16[i], `${day} 16:00`);
    assertNear(cont.l18, want.l18[i], `${day} from 18:00`);
    assertNear(cont.l09, want.l09[i], `${day} next morning`);
  });
});

test("deck p.10: the auction limit, and the next business day's auction (Monday back at 9)", () => {
  const want = { l16: [1, 1, 1, 1, 1], l18: [9, 4, 1, 4, 7 / 3], next: [9, 9, 9, 7, 9] };
  WEEK.forEach((day, i) => {
    const params = { C: 10, OR: OPEN_RISK[i], cont: { bd: 0, nbd: 0, key: 0 }, da: { bd: 1, nbd: 1, key: 100 } };
    const { da } = E.day(E.parse(day), params);
    assertNear(da.l16, want.l16[i], `${day} 16:00`);
    assertNear(da.l18, want.l18[i], `${day} from 18:00`);
    assertNear(da.auctions[da.auctions.length - 1].limit, want.next[i], `${day} next business day's auction`);
  });
});

test('the deck example on a Friday: €500k collateral, €100k unsettled, 60/40', () => {
  const params = {
    C: 500000,
    OR: 100000,
    cont: { bd: 20000, nbd: 10000, key: 60 },
    da: { bd: 10000, nbd: 10000, key: 40 },
  };
  const friday = E.day(E.parse('2026-10-02'), params);
  const auctions = friday.da.auctions.map((auction) => [auction.date, Math.round(auction.limit)]);
  assertNear(friday.cont.l18, 220000, 'M7 from 18:00');
  assertNear(friday.cont.l09, 280000, 'M7 after settlement');
  assert.deepEqual(
    auctions,
    [
      ['2026-10-03', 50000],
      ['2026-10-04', 50000],
      ['2026-10-05', 186000],
    ],
    'MATS: a share for Saturday and Sunday, the full limit again on Monday',
  );
});
