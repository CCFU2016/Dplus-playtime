// ecc-link.js: limit targets, base limits, the per-day solver and the split search, and the worked example end to end
// (docs/wallet-model.md §2 and §8.1).
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/engine.js');
const B = require('../../src/wallet/behaviour.js');
const S = require('../../src/wallet/settlement.js');
const L = require('../../src/wallet/ecc-link.js');
const { mulberry32 } = require('../../src/wallet/tennet-account.js');
const { PARAMS, SOLVES } = require('../engine/cases.js');
const { assertMoney } = require('../helpers.js');
const { WORKED_EXAMPLE_PLAN } = require('./fixtures.js');

const DECK = SOLVES.find((one) => one.name === 'week-oct5-cont150-da100');
const DECK_WEEK = E.weekDays(DECK.week);

/** A search with constant open risk and targets, as the engine's solve() assumes. */
function constant(days, p, tgt) {
  return {
    days,
    key: p.cont.key,
    measure: tgt.contMeasure,
    bl: { cont: { bd: p.cont.bd, nbd: p.cont.nbd }, da: { bd: p.da.bd, nbd: p.da.nbd } },
    OR: () => p.OR,
    cont: () => tgt.cont,
    auc: (date, auction) => (tgt.daNonBD || auction.bd ? tgt.da : 0),
  };
}

test('continuous targets (Manual §3.11): selling back does not give back the limit a buy used', () => {
  const monday = E.parse('2026-10-05');
  const plan = (buy, sell) => ({ price: 80, negShare: 0, cont: { buy, sell }, auc: { buy: 0, sell: 0 } });
  const target = (p, s, resting) => L.targets([monday], () => B.dayFlows(p, 1, true), s, resting).cont['2026-10-05'];
  // The brief's test: buy 1,000 MWh at €80 and sell it back the same day, s = 0: €80,000, not 0.
  assertMoney(target(plan(1000, 1000), 0, 0), 80000, 'buy and sell back, s = 0');
  assertMoney(
    target(plan(1000, 500), 0.5, 1000),
    41000,
    's = 0.5 halves the buys, never below the net buying, + resting',
  );
});

test("with constant open risk and targets, the solver returns exactly the engine's answer", () => {
  for (const { name, week, params, tgt } of SOLVES) {
    const days = E.weekDays(week);
    const p = PARAMS[params];
    const search = constant(days, p, tgt);
    assert.equal(L.solve(search, p.cont.key), E.solve(days, p, tgt), `${name}: solve`);
    assert.deepEqual(L.cheapest(search), E.cheapestKey(days, p, tgt), `${name}: cheapest`);
  }
});

test('and so it does on 150 random weeks, days and settings', () => {
  const random = mulberry32(99);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const businessDays = [];
  for (let day = E.parse('2026-01-01'); E.iso(day) <= '2027-12-17'; day = new Date(day.getTime() + 864e5)) {
    if (E.isBD(day)) businessDays.push(day);
  }
  const amounts = [0, 1, 5000, 10000, 20000];
  for (let i = 0; i < 150; i++) {
    const week = E.weekDays(E.iso(pick(businessDays)));
    const days = random() < 0.3 ? [pick(week)] : week;
    const key = Math.floor(random() * 101);
    const p = {
      OR: pick([0, 30000, 100000]),
      cont: { bd: pick(amounts), nbd: pick(amounts), key },
      da: { bd: pick(amounts), nbd: pick(amounts), key: 100 - key },
    };
    const tgt = {
      cont: pick([0, 50000, 150000]),
      contMeasure: pick(['l18', 'l09']),
      da: pick([0, 20000, 100000]),
      daNonBD: random() < 0.5,
    };
    const search = constant(days, p, tgt);
    assert.equal(L.solve(search, key), E.solve(days, p, tgt), `case ${i}: solve`);
    if (i % 5 === 0) assert.deepEqual(L.cheapest(search), E.cheapestKey(days, p, tgt), `case ${i}: cheapest`);
  }
});

test('the deck example: the cheapest split with open risk on every day, or only on the binding day', () => {
  const at = (OR) => constant(DECK_WEEK, { ...PARAMS.deck, OR }, DECK.tgt);
  assert.deepEqual(L.cheapest(at(0)), { key: 33, C: 502986 }, 'no open risk: €502,986 at 33/67');
  assert.deepEqual(L.cheapest(at(100000)), { key: 33, C: 602986 }, '€100k open risk: €602,986 at 33/67');
  const split = { ...PARAMS.deck, cont: { ...PARAMS.deck.cont, key: 33 }, da: { ...PARAMS.deck.da, key: 67 } };
  const binding = E.binding(602986, DECK_WEEK, split, DECK.tgt);
  const bindingDay = binding.calc || binding.date;
  const onBindingDay = { ...at(0), OR: (day) => (day === bindingDay ? 100000 : 0) };
  assert.equal(L.solve(onBindingDay, 33), 602986, `open risk only on the binding day (${bindingDay}) needs as much`);
});

test('the worked example end to end: a financial trader, week of 5 Oct 2026 (§8.1–8.2)', () => {
  function example(priceFactor, lossShare, updateHour) {
    const plan = { ...WORKED_EXAMPLE_PLAN, lossShare };
    const flowOf = () => B.dayFlows(plan, priceFactor, true); // it trades every day, weekends too
    const windows = S.windows(DECK_WEEK.map(E.iso), flowOf);
    const openRisk = Object.fromEntries(windows.map((window) => [window.close, window.OR]));
    const targets = L.targets(DECK_WEEK, flowOf, 0, 10000 * priceFactor);
    const search = {
      days: DECK_WEEK,
      key: 60,
      measure: 'l18',
      OR: (day) => openRisk[day],
      cont: (day) => targets.cont[day],
      auc: (day) => targets.auc[day],
      bl: L.baseLimits({ restingCont: 10000 * priceFactor, eveningCont: 5000 * priceFactor, updateHour }),
    };
    return { targets, windows, cheapest: L.cheapest(search), cash: S.cashPath(windows, 'none').need };
  }
  const typical = example(1, 0, 18);
  assertMoney(typical.targets.cont['2026-10-05'], 28480, 'typical: the Monday continuous target');
  assertMoney(typical.targets.cont['2026-10-09'], 65440, 'typical: the Friday continuous target (three days)');
  assertMoney(typical.targets.auc['2026-10-10'], 15000, 'typical: the Saturday auction target');
  assert.deepEqual(typical.cheapest, { key: 53, C: 125745 }, 'typical: €125,745 at 53/47');
  assertMoney(typical.cash, 0, 'typical: no settlement cash (a flat trader)');
  const stress = example(250 / 80, 0.05, 19);
  assert.deepEqual(
    stress.windows.map((window) => window.net),
    [12750, 4250, 4250, 4250, 4250],
    'stress: the window amounts',
  );
  assertMoney(stress.cash, 29750, 'stress: settlement cash');
  assert.deepEqual(stress.cheapest, { key: 52, C: 406594 }, 'stress: €406,594 at 52/48');
});

test('base limits: a later update stretches the evening buying (§2.4), and values set by hand win', () => {
  const limits = L.baseLimits({
    restingCont: 10000,
    eveningCont: 5000,
    updateHour: 19,
    restingAuc: 2000,
    override: { da: { nbd: 7000 } },
  });
  assert.deepEqual(limits, { cont: { bd: 17500, nbd: 0 }, da: { bd: 2000, nbd: 7000 } });
  assert.deepEqual(
    L.marketParams(limits, 60),
    { cont: { bd: 17500, nbd: 0, key: 60 }, da: { bd: 2000, nbd: 7000, key: 40 } },
    "the engine's parameters: auctions get the rest of the split",
  );
});
