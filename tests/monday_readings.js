// Monday's day-ahead auction after a weekend: three readings, on the deck example and on ECC's p.10 example.
const E = require('../src/engine.js');
function readings(C, OR, cBD, cNBD, aBD, aNBD, kc, fri, mon) {
  const p = { C, OR, cont: { bd: cBD, nbd: cNBD, key: kc }, da: { bd: aBD, nbd: aNBD, key: 100 - kc } };
  const f = E.day(E.parse(fri), p), m = E.day(E.parse(mon), { ...p, OR: 0 });
  const ka = (100 - kc) / 100, g = f.gap1;
  const tool = f.da.l18 + f.refill * ka;                 // ECC simulation tool: Monday's own third + payment
  const carry = f.da.l18 * g + f.refill * ka;            // unused Sat/Sun limit (incl. their base limits) carried over
  const level = aBD + Math.max(C - m.blr, 0) * ka;       // back to the normal weekday level
  return { friBLR: f.blr, friDAshare: f.shareA, perAuction: f.da.l18, tool, carry, level, weekday: level };
}
console.log('Deck example 500k/100k, 20k/10k, 10k/10k, 60/40:', readings(500000, 100000, 20000, 10000, 10000, 10000, 60, '2026-10-09', '2026-10-12'));
console.log('ECC p.10 (one market, 10€, BD=NBD=1, Friday exposure 2):', readings(10, 2, 0, 0, 1, 1, 0, '2026-10-09', '2026-10-12'));
console.log('Deck example at 50/50 split:', readings(500000, 100000, 20000, 10000, 10000, 10000, 50, '2026-10-09', '2026-10-12'));
console.log('Deck example, continuous weekend base limit 0:', readings(500000, 100000, 20000, 0, 10000, 10000, 60, '2026-10-09', '2026-10-12'));
