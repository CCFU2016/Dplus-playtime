// A diagnostic, not a test: three readings of Monday's day-ahead auction after a weekend (the open Monday question in
// docs/open-questions.md), on the deck example and on ECC's p.10 example.
// usage: node scripts/diagnostics/monday-readings.js
const E = require('../../src/engine.js');

const FRIDAY = '2026-10-09';
const MONDAY = '2026-10-12';

function readings({ C, OR, cont, da }) {
  const params = { C, OR, cont, da };
  const friday = E.day(E.parse(FRIDAY), params);
  const monday = E.day(E.parse(MONDAY), { ...params, OR: 0 });
  const share = da.key / 100;
  const level = da.bd + Math.max(C - monday.blr, 0) * share; // back to the normal weekday level
  return {
    friBLR: friday.blr,
    friDAshare: friday.shareA,
    perAuction: friday.da.l18,
    tool: friday.da.l18 + friday.refill * share, // ECC's simulation tool: Monday's own share and the payment
    carry: friday.da.l18 * friday.gap1 + friday.refill * share, // the unused weekend limit (base limits too) carried over
    level,
    weekday: level,
  };
}

const deck = {
  C: 500000,
  OR: 100000,
  cont: { bd: 20000, nbd: 10000, key: 60 },
  da: { bd: 10000, nbd: 10000, key: 40 },
};
console.log('Deck example 500k/100k, 20k/10k, 10k/10k, 60/40:', readings(deck));
console.log(
  'ECC p.10 (one market, 10€, BD=NBD=1, Friday exposure 2):',
  readings({ C: 10, OR: 2, cont: { bd: 0, nbd: 0, key: 0 }, da: { bd: 1, nbd: 1, key: 100 } }),
);
console.log(
  'Deck example at 50/50 split:',
  readings({ ...deck, cont: { ...deck.cont, key: 50 }, da: { ...deck.da, key: 50 } }),
);
console.log('Deck example, continuous weekend base limit 0:', readings({ ...deck, cont: { ...deck.cont, nbd: 0 } }));
