// ecc-link.js: limit targets, base limits, the per-day solver and the split search, and the worked example end to end
// (docs/wallet-model.md §2 and §8.1).
const E = require('../../src/engine.js');
const B = require('../../src/wallet/behaviour.js');
const S = require('../../src/wallet/settlement.js');
const L = require('../../src/wallet/ecc-link.js');
const { mulberry32 } = require('../../src/wallet/tennet-account.js');
const { PARAMS, SOLVES } = require('../golden_cases.js');
const { WORKED_EXAMPLE_PLAN } = require('./fixtures.js');
const T = require('./assert.js')('ecc-link');

// 1. Continuous targets (Manual §3.11). The brief's test: buy 1,000 MWh at €80 and sell it back the same day, s = 0:
// the target is €80,000, not 0, because the sale does not give back the limit that the buy used.
const monday = E.parse('2026-10-05');
const plan = (buy, sell) => ({ price: 80, negShare: 0, cont: { buy, sell }, auc: { buy: 0, sell: 0 } });
const contTarget = (p, s, resting) => L.targets([monday], () => B.dayFlows(p, 1, true), s, resting).cont['2026-10-05'];
T.money(contTarget(plan(1000, 1000), 0, 0), 80000, 'buy and sell back, s = 0: target €80,000');
T.money(
  contTarget(plan(1000, 500), 0.5, 1000),
  41000,
  's = 0.5 halves the buys, but never below the net buying: 40,000 + resting 1,000',
);

// 2. With constant open risk and targets, the solver returns exactly what the engine returns.
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
SOLVES.forEach((s) => {
  const days = E.weekDays(s.week);
  const p = PARAMS[s.params];
  const ctx = constant(days, p, s.tgt);
  T.eq(L.solve(ctx, p.cont.key), E.solve(days, p, s.tgt), s.name + ': solve = E.solve');
  T.eq(L.cheapest(ctx), E.cheapestKey(days, p, s.tgt), s.name + ': cheapest = E.cheapestKey');
});
const random = mulberry32(99);
const pick = (list) => list[Math.floor(random() * list.length)];
const businessDays = [];
for (let d = E.parse('2026-01-01'); E.iso(d) <= '2027-12-17'; d = new Date(d.getTime() + 864e5)) {
  if (E.isBD(d)) businessDays.push(d);
}
let same = 0;
let compared = 0;
for (let i = 0; i < 150; i++) {
  const week = E.weekDays(E.iso(pick(businessDays)));
  const days = random() < 0.3 ? [pick(week)] : week;
  const key = Math.floor(random() * 101);
  const amounts = [0, 1, 5000, 10000, 20000];
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
  const ctx = constant(days, p, tgt);
  compared++;
  if (L.solve(ctx, key) === E.solve(days, p, tgt)) same++;
  if (i % 5 === 0) {
    compared++;
    if (JSON.stringify(L.cheapest(ctx)) === JSON.stringify(E.cheapestKey(days, p, tgt))) same++;
  }
}
T.eq(same, compared, `random constant-OR cases: solve and cheapest match the engine (${compared} comparisons)`);

// 3. The deck example: the cheapest split at OR 0 and at €100k (inputs of week-oct5-cont150-da100).
const s0 = SOLVES.find((s) => s.name === 'week-oct5-cont150-da100');
const wk = E.weekDays(s0.week);
T.eq(
  L.cheapest(constant(wk, { ...PARAMS.deck, OR: 0 }, s0.tgt)),
  { key: 33, C: 502986 },
  'deck example at OR 0: €502,986 at 33/67',
);
T.eq(
  L.cheapest(constant(wk, { ...PARAMS.deck, OR: 100000 }, s0.tgt)),
  { key: 33, C: 602986 },
  'deck example at OR €100k: €602,986 at 33/67',
);
// Open risk per day: open risk on the binding day only needs as much as open risk on every day.
const bind = E.binding(
  602986,
  wk,
  { ...PARAMS.deck, cont: { ...PARAMS.deck.cont, key: 33 }, da: { ...PARAMS.deck.da, key: 67 } },
  s0.tgt,
);
const bindingDay = bind.calc || bind.date;
const perDay = { ...constant(wk, { ...PARAMS.deck, OR: 0 }, s0.tgt), OR: (d) => (d === bindingDay ? 100000 : 0) };
T.eq(L.solve(perDay, 33), 602986, `OR only on the binding day (${bindingDay}) needs €602,986 at 33/67`);

// 4. The worked example end to end: financial trader, week of 5 Oct 2026 (§8.1–8.2).
function example(priceFactor, lossShare, updateHour) {
  const p = { ...WORKED_EXAMPLE_PLAN, lossShare };
  const flowOf = () => B.dayFlows(p, priceFactor, true); // it trades every day, weekends too
  const windows = S.windows(wk.map(E.iso), flowOf);
  const openRisk = Object.fromEntries(windows.map((w) => [w.close, w.OR]));
  const targets = L.targets(wk, flowOf, 0, 10000 * priceFactor);
  const search = {
    days: wk,
    key: 60,
    measure: 'l18',
    OR: (d) => openRisk[d],
    cont: (d) => targets.cont[d],
    auc: (d) => targets.auc[d],
    bl: L.baseLimits({ restingCont: 10000 * priceFactor, eveningCont: 5000 * priceFactor, updateHour }),
  };
  return { targets, windows, best: L.cheapest(search), cash: S.cashPath(windows, 'none').need };
}
const typical = example(1, 0, 18);
T.money(typical.targets.cont['2026-10-05'], 28480, 'typical: Monday continuous target');
T.money(typical.targets.cont['2026-10-09'], 65440, 'typical: Friday continuous target (three days)');
T.money(typical.targets.auc['2026-10-10'], 15000, 'typical: Saturday auction target');
T.eq(typical.best, { key: 53, C: 125745 }, 'typical: €125,745 at 53/47');
T.money(typical.cash, 0, 'typical: no settlement cash (flat trader)');
const stress = example(250 / 80, 0.05, 19);
T.eq(
  stress.windows.map((w) => w.net),
  [12750, 4250, 4250, 4250, 4250],
  'stress: window amounts',
);
T.money(stress.cash, 29750, 'stress: settlement cash');
T.eq(stress.best, { key: 52, C: 406594 }, 'stress: €406,594 at 52/48');

// 5. Base limits: a later update stretches the evening buying (§2.4), and values set by hand win.
const bl = L.baseLimits({
  restingCont: 10000,
  eveningCont: 5000,
  updateHour: 19,
  restingAuc: 2000,
  override: { da: { nbd: 7000 } },
});
T.eq(
  bl,
  { cont: { bd: 17500, nbd: 0 }, da: { bd: 2000, nbd: 7000 } },
  'base limits from the plan, with a value set by hand',
);
T.eq(
  L.marketParams(bl, 60),
  { cont: { bd: 17500, nbd: 0, key: 60 }, da: { bd: 2000, nbd: 7000, key: 40 } },
  'engine parameters: auctions get the rest of the split',
);

T.done();
