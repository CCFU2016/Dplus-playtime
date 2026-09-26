// ecc-link.js: the per-day solver, the split search, the collateral form, and the worked example end to end
// (docs/wallet-model.md §2 and §8.1).
const E = require('../../src/engine.js');
const B = require('../../src/wallet/behaviour.js');
const S = require('../../src/wallet/settlement.js');
const L = require('../../src/wallet/ecc-link.js');
const { PARAMS, SOLVES } = require('../golden_cases.js');
const T = require('./assert.js')('ecc-link');

// A context with constant open risk and targets, as the engine's solve() assumes.
function constant(days, p, tgt) {
  return {
    days, key: p.cont.key, measure: tgt.contMeasure,
    bl: { cont: { bd: p.cont.bd, nbd: p.cont.nbd }, da: { bd: p.da.bd, nbd: p.da.nbd } },
    OR: () => p.OR, cont: () => tgt.cont, auc: (date, au) => (tgt.daNonBD || au.bd) ? tgt.da : 0
  };
}
// 1. With constant OR and targets it returns exactly what the engine returns.
SOLVES.forEach(s => {
  const days = E.weekDays(s.week), p = PARAMS[s.params], ctx = constant(days, p, s.tgt);
  T.eq(L.solve(ctx, p.cont.key), E.solve(days, p, s.tgt), s.name + ': solve = E.solve');
  T.eq(L.cheapest(ctx), E.cheapestKey(days, p, s.tgt), s.name + ': cheapest = E.cheapestKey');
});
let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];
const bds = []; for (let d = E.parse('2026-01-01'); E.iso(d) <= '2027-12-17'; d = new Date(d.getTime() + 864e5)) if (E.isBD(d)) bds.push(d);
let same = 0, n = 0;
for (let i = 0; i < 150; i++) {
  const all = E.weekDays(E.iso(pick(bds))), days = rnd() < 0.3 ? [pick(all)] : all, kc = Math.floor(rnd() * 101), v = [0, 1, 5000, 10000, 20000];
  const p = { OR: pick([0, 30000, 100000]), cont: { bd: pick(v), nbd: pick(v), key: kc }, da: { bd: pick(v), nbd: pick(v), key: 100 - kc } };
  const tgt = { cont: pick([0, 50000, 150000]), contMeasure: pick(['l18', 'l09']), da: pick([0, 20000, 100000]), daNonBD: rnd() < 0.5 };
  const ctx = constant(days, p, tgt);
  n += 2;
  if (L.solve(ctx, kc) === E.solve(days, p, tgt)) same++;
  if (i % 5 === 0) { if (JSON.stringify(L.cheapest(ctx)) === JSON.stringify(E.cheapestKey(days, p, tgt))) same++; } else n--;
}
T.eq(same, n, 'random constant-OR cases: solve and cheapest match the engine (' + n + ' comparisons)');

// 2. The deck example: cheapest split at OR 0 vs €100k (inputs of week-oct5-cont150-da100).
const s0 = SOLVES.find(s => s.name === 'week-oct5-cont150-da100'), wk = E.weekDays(s0.week);
T.eq(L.cheapest(constant(wk, { ...PARAMS.deck, OR: 0 }, s0.tgt)), { key: 33, C: 502986 }, 'deck example at OR 0: €502,986 at 33/67');
T.eq(L.cheapest(constant(wk, { ...PARAMS.deck, OR: 100000 }, s0.tgt)), { key: 33, C: 602986 }, 'deck example at OR €100k: €602,986 at 33/67');
// Per-day OR: open risk only on the binding day needs as much as open risk on every day.
const bind = E.binding(602986, wk, { ...PARAMS.deck, cont: { ...PARAMS.deck.cont, key: 33 }, da: { ...PARAMS.deck.da, key: 67 } }, s0.tgt);
const perDay = constant(wk, { ...PARAMS.deck, OR: 0 }, s0.tgt);
perDay.OR = d => d === (bind.calc || bind.date) ? 100000 : 0;
T.eq(L.solve(perDay, 33), 602986, 'OR only on the binding day (' + (bind.calc || bind.date) + ') needs €602,986 at 33/67');

// 3. The worked example end to end: financial trader, week of 5 Oct 2026 (§8.1–8.2).
const ft = { weekend: true, price: 80, negShare: 0.05, negPrice: -20, cont: { buy: 240, sell: 240 }, auc: { buy: 100, sell: 100, limitPrice: 150 }, lossShare: 0.05 };
function example(f, lossShare, hour) {
  const b = { ...ft, lossShare }, flow = d => B.dayFlows(b, f, E.isBD(E.parse(d)) || b.weekend);
  const ws = S.windows(wk.map(E.iso), flow), OR = {};
  ws.forEach(w => { OR[w.close] = w.OR; });
  const tg = L.targets(wk, flow, 0, 10000 * f);
  const ctx = { days: wk, key: 60, measure: 'l18', OR: d => OR[d], cont: d => tg.cont[d], auc: d => tg.auc[d],
                bl: L.baseLimits({ restingCont: 10000 * f, eveningCont: 5000 * f, updateHour: hour }) };
  return { tg, ws, best: L.cheapest(ctx), cash: S.cashPath(ws, 'none').need };
}
const typ = example(1, 0, 18);
T.money(typ.tg.cont['2026-10-05'], 28480, 'typical: Monday continuous target');
T.money(typ.tg.cont['2026-10-09'], 65440, 'typical: Friday continuous target (three days)');
T.money(typ.tg.auc['2026-10-10'], 15000, 'typical: Saturday auction target');
T.eq(typ.best, { key: 53, C: 125745 }, 'typical: €125,745 at 53/47');
T.money(typ.cash, 0, 'typical: no settlement cash (flat trader)');
const st = example(250 / 80, 0.05, 19);
T.eq(st.ws.map(w => w.net), [12750, 4250, 4250, 4250, 4250], 'stress: window amounts');
T.money(st.cash, 29750, 'stress: settlement cash');
T.eq(st.best, { key: 52, C: 406594 }, 'stress: €406,594 at 52/48');

// 4. Collateral form (ECC DCP Risk Management page).
let fm = L.form(50e6, true);
T.money(fm.guarantee, 45e6, 'ECC\'s example: €50m with the most guarantee → €45m guarantee');
T.money(fm.cash, 5e6, 'ECC\'s example: … and €5m cash');
fm = L.form(125745, true);
T.money(fm.defaultFund, 5029.8, 'default fund: 4% of the guarantee');
T.eq([L.form(125745, false).guarantee, L.form(125745, false).defaultFund], [0, 0], 'all cash: no guarantee, no default fund');
T.ok(L.form(4e6, false, 3e6).overCap && !L.form(2e6, false, 3e6).overCap, 'collateral above the cap limit is flagged');
// Base limits: the update hour stretches the evening buying (§2.4); overrides win.
const bl = L.baseLimits({ restingCont: 10000, eveningCont: 5000, updateHour: 19, restingAuc: 2000, override: { da: { nbd: 7000 } } });
T.eq(bl, { cont: { bd: 17500, nbd: 0 }, da: { bd: 2000, nbd: 7000 } }, 'base limits from behaviour, with an override');

T.done();
