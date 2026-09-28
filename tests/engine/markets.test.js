// The market definitions and the markets form of the engine's API:
//   1. each market in the engine matches its row in ECC's market table (reference/ecc/markets_table.csv);
//   2. the markets form ({ markets: [...] }) gives the same numbers as the two-market form (cont, da);
//   3. cheapestKey with three markets: no whole-% split needs less collateral than the one it finds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../../src/engine.js');
const { PARAMS, SOLVES } = require('./cases.js');

const CONT = 'EPEX_CONTINUOUS_EUR';
const DA = 'EPEX_AUCTION_EUR';
const HUPX = 'HUPX_AUCTION_EUR';
const DAY_MS = 864e5;

const asMarkets = (p) => ({
  C: p.C,
  OR: p.OR,
  markets: [
    { id: CONT, ...p.cont },
    { id: DA, ...p.da },
  ],
});
const targetsAsMarkets = (t) => ({
  [CONT]: { limit: t.cont, measure: t.contMeasure },
  [DA]: { limit: t.da, nonBD: t.daNonBD },
});

test("each market matches its row in ECC's market table", () => {
  const csv = fs.readFileSync(path.join(__dirname, '../../reference/ecc/markets_table.csv'), 'utf8');
  const table = {};
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const cells = line.split(',');
    table[cells[1]] = { reset: cells[2], auction: +cells[4], currency: cells[5], ownCalendar: cells[7] === '1' };
  }
  for (const [id, definition] of Object.entries(E.MARKETS)) {
    assert.ok(table[id], `${id} is in the table`);
    for (const field of ['reset', 'auction', 'currency', 'ownCalendar']) {
      assert.equal(definition[field], table[id][field], `${id}: ${field}`);
    }
  }
});

test('the markets form gives the same limits as the two-market form, every business day', () => {
  for (const [name, params] of Object.entries(PARAMS)) {
    for (let day = E.parse(E.MIN_DATE); E.iso(day) <= '2027-12-17'; day = new Date(day.getTime() + DAY_MS)) {
      if (!E.isBD(day)) continue;
      const two = E.day(day, params);
      const many = E.day(day, asMarkets(params));
      const [c, a] = [many.markets[CONT], many.markets[DA]];
      assert.deepEqual(
        [two.blr, two.excess, two.refill, two.baseUncovered, two.blrC, two.shareC, two.cont, two.blrA, two.shareA],
        [
          many.blr,
          many.excess,
          many.refill,
          many.baseUncovered,
          c.blr,
          c.share,
          { l16: c.l16, l18: c.l18, l09: c.l09 },
          a.blr,
          a.share,
        ],
        `${name} ${E.iso(day)}`,
      );
      assert.deepEqual(
        [two.da.l18, two.da.l09, two.da.auctions],
        [a.l18, a.l09, a.auctions],
        `${name} ${E.iso(day)} auctions`,
      );
    }
  }
});

test('the markets form sizes the same as the two-market form', () => {
  for (const { name, week, params, tgt } of SOLVES) {
    const days = E.weekDays(week);
    const p = PARAMS[params];
    assert.equal(E.solve(days, p, tgt), E.solve(days, asMarkets(p), targetsAsMarkets(tgt)), `${name}: solve`);
    const two = E.cheapestKey(days, p, tgt);
    const many = E.cheapestKey(days, asMarkets(p), targetsAsMarkets(tgt));
    assert.deepEqual([two.C, two.key, 100 - two.key], [many.C, many.keys[CONT], many.keys[DA]], `${name}: cheapestKey`);
  }
});

const THREE_MARKETS = [
  {
    week: '2026-10-05',
    OR: 100000,
    baseLimits: [
      [20000, 10000],
      [10000, 10000],
      [5000, 0],
    ],
    keys: [60, 30, 10],
    targets: {
      [CONT]: { limit: 150000, measure: 'l18' },
      [DA]: { limit: 100000, nonBD: true },
      [HUPX]: { limit: 40000, nonBD: false },
    },
  },
  {
    week: '2026-12-21',
    OR: 30000,
    baseLimits: [
      [15000, 5000],
      [5000, 5000],
      [10000, 10000],
    ],
    keys: [0, 50, 50],
    targets: {
      [CONT]: { limit: 80000, measure: 'l09' },
      [DA]: { limit: 0, nonBD: true },
      [HUPX]: { limit: 60000, nonBD: true },
    },
  },
];

test('with three markets, no whole-% split needs less collateral than the cheapest one found', () => {
  // There is no third market yet, so a stand-in with the day-ahead auction's rules is registered for this test only
  // (HUPX_AUCTION_EUR has those rules in ECC's table).
  E.MARKETS[HUPX] = { reset: 'day', auction: 0, ownCalendar: false, currency: 'EUR' };
  try {
    THREE_MARKETS.forEach((one, n) => {
      const ids = [CONT, DA, HUPX];
      const days = E.weekDays(one.week);
      const params = (keys) => ({
        OR: one.OR,
        markets: ids.map((id, i) => ({ id, bd: one.baseLimits[i][0], nbd: one.baseLimits[i][1], key: keys[i] })),
      });
      const found = E.cheapestKey(days, params(one.keys), one.targets);
      const keys = ids.map((id) => found.keys[id]);
      assert.equal(keys[0] + keys[1] + keys[2], 100, `case ${n}: the keys add up to 100`);
      assert.equal(
        E.solve(days, params(keys), one.targets),
        found.C,
        `case ${n}: the split found needs exactly ${found.C}`,
      );
      // No split may meet the targets with €1 less. binding()'s smallest headroom is negative exactly when a split
      // falls short; in the rounding band around zero, solve() confirms.
      for (let a = 0; a <= 100; a++) {
        for (let b = 0; a + b <= 100; b++) {
          const split = [a, b, 100 - a - b];
          const { h } = E.binding(found.C - 1, days, params(split), one.targets);
          const cheaper = h >= 0 || (h > -1e-6 && E.solve(days, params(split), one.targets) <= found.C - 1);
          assert.ok(!cheaper, `case ${n}: split ${split} needs less than ${found.C}`);
        }
      }
    });
  } finally {
    delete E.MARKETS[HUPX];
  }
});
