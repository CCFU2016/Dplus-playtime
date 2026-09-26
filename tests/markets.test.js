// Market definitions and the N-market API.
//  1. Each market in the engine matches its row in ECC's market table (reference/ecc/markets_table.csv).
//  2. The markets form ({ markets: [...] }) gives the same numbers as the two-market form (cont/da) on every golden case.
//  3. cheapestKey with three markets: no whole-% split needs less collateral than the one it finds.
const fs = require('fs'), path = require('path');
const E = require('../src/engine.js');
const { PARAMS, SOLVES } = require('./golden_cases.js');
let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; if (fails <= 20) console.log('FAIL', what); } };

// 1. Definitions against ECC's table
const lines = fs.readFileSync(path.join(__dirname, '../reference/ecc/markets_table.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
const table = {};
lines.forEach(l => { const c = l.split(','); table[c[1]] = { reset: c[2], auction: +c[4], currency: c[5], ownCalendar: c[7] === '1' }; });
for (const [id, def] of Object.entries(E.MARKETS)) {
  const row = table[id];
  check(row && ['reset', 'auction', 'currency', 'ownCalendar'].every(f => row[f] === def[f]), id + ' matches markets_table.csv');
}

// 2. Markets form = two-market form
const CONT = 'EPEX_CONTINUOUS_EUR', DA = 'EPEX_AUCTION_EUR';
const asMarkets = p => ({ C: p.C, OR: p.OR, markets: [{ id: CONT, ...p.cont }, { id: DA, ...p.da }] });
const tgtAsMarkets = t => ({ [CONT]: { limit: t.cont, measure: t.contMeasure }, [DA]: { limit: t.da, nonBD: t.daNonBD } });
let nDays = 0;
for (const [name, p] of Object.entries(PARAMS)) {
  for (let d = E.parse(E.MIN_DATE); E.iso(d) <= '2027-12-17'; d = new Date(d.getTime() + 864e5)) {
    if (!E.isBD(d)) continue;
    const a = E.day(d, p), b = E.day(d, asMarkets(p)), c = b.markets[CONT], x = b.markets[DA];
    check(a.blr === b.blr && a.excess === b.excess && a.refill === b.refill && a.baseUncovered === b.baseUncovered &&
          a.blrC === c.blr && a.shareC === c.share && a.cont.l16 === c.l16 && a.cont.l18 === c.l18 && a.cont.l09 === c.l09 &&
          a.blrA === x.blr && a.shareA === x.share && a.da.l18 === x.l18 && a.da.l09 === x.l09 &&
          JSON.stringify(a.da.auctions) === JSON.stringify(x.auctions), name + ' ' + E.iso(d));
    nDays++;
  }
}
for (const s of SOLVES) {
  const days = E.weekDays(s.week), p = PARAMS[s.params], pm = asMarkets(p), tm = tgtAsMarkets(s.tgt);
  check(E.solve(days, p, s.tgt) === E.solve(days, pm, tm), s.name + ' solve');
  const a = E.cheapestKey(days, p, s.tgt), b = E.cheapestKey(days, pm, tm);
  check(a.C === b.C && a.key === b.keys[CONT] && 100 - a.key === b.keys[DA], s.name + ' cheapestKey');
}

// 3. Three markets. There is no third market yet, so a stand-in with the day-ahead auction's rules is
// registered for this check only (HUPX_AUCTION_EUR has those rules in ECC's table).
E.MARKETS.HUPX_AUCTION_EUR = { reset: 'day', auction: 0, ownCalendar: false, currency: 'EUR' };
const three = [
  { week: '2026-10-05', OR: 100000, bl: [[20000, 10000], [10000, 10000], [5000, 0]], keys: [60, 30, 10],
    tgt: { [CONT]: { limit: 150000, measure: 'l18' }, [DA]: { limit: 100000, nonBD: true }, HUPX_AUCTION_EUR: { limit: 40000, nonBD: false } } },
  { week: '2026-12-21', OR: 30000, bl: [[15000, 5000], [5000, 5000], [10000, 10000]], keys: [0, 50, 50],
    tgt: { [CONT]: { limit: 80000, measure: 'l09' }, [DA]: { limit: 0, nonBD: true }, HUPX_AUCTION_EUR: { limit: 60000, nonBD: true } } },
];
three.forEach((t, n) => {
  const ids = [CONT, DA, 'HUPX_AUCTION_EUR'], days = E.weekDays(t.week);
  const p = ks => ({ OR: t.OR, markets: ids.map((id, i) => ({ id, bd: t.bl[i][0], nbd: t.bl[i][1], key: ks[i] })) });
  const r = E.cheapestKey(days, p(t.keys), t.tgt), ks = ids.map(id => r.keys[id]);
  check(ks.reduce((a, b) => a + b, 0) === 100, 'three markets #' + n + ': keys add up to 100');
  check(E.solve(days, p(ks), t.tgt) === r.C, 'three markets #' + n + ': the split found needs exactly ' + r.C);
  // No split may meet the targets with €1 less. binding()'s smallest headroom is negative exactly when
  // a split falls short; in the rounding band around zero, confirm with solve().
  let beaten = null;
  for (let a = 0; a <= 100 && !beaten; a++) for (let b = 0; a + b <= 100 && !beaten; b++) {
    const q = p([a, b, 100 - a - b]), h = E.binding(r.C - 1, days, q, t.tgt).h;
    if (h >= 0 || (h > -1e-6 && E.solve(days, q, t.tgt) <= r.C - 1)) beaten = [a, b, 100 - a - b];
  }
  check(!beaten, 'three markets #' + n + ': split ' + beaten + ' needs less than ' + r.C);
});

if (fails) process.exitCode = 1;
console.log(fails ? fails + ' failures' : 'markets: definitions match ECC\'s table; markets form = two-market form on ' + nDays + ' days and ' +
  SOLVES.length + ' sizings; three-market cheapest split confirmed against all 5,151 splits (' + three.length + ' cases)');
