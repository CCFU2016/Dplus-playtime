// Inputs for the snapshot test. Every business day in the engine's calendar range is run
// for each parameter set, plus a few sizing (collateral) searches.
const PARAMS = {
  deck:        { C: 500000, OR: 100000, cont: { bd: 20000, nbd: 10000, key: 60 }, da: { bd: 10000, nbd: 10000, key: 40 } },
  eccExample:  { C: 10, OR: 2, cont: { bd: 1, nbd: 1, key: 50 }, da: { bd: 1, nbd: 1, key: 50 } },
  contOnly:    { C: 250000, OR: 40000, cont: { bd: 15000, nbd: 5000, key: 100 }, da: { bd: 0, nbd: 0, key: 0 } },
  daOnly:      { C: 120000, OR: 30000, cont: { bd: 0, nbd: 0, key: 0 }, da: { bd: 5000, nbd: 0, key: 100 } },
  shortCollat: { C: 60000, OR: 55000, cont: { bd: 20000, nbd: 10000, key: 60 }, da: { bd: 10000, nbd: 10000, key: 40 } },
};
const SOLVES = [
  { name: 'week-oct5-cont150-da100', week: '2026-10-05', params: 'deck', tgt: { cont: 150000, contMeasure: 'l18', da: 100000, daNonBD: true } },
  { name: 'week-dec21-cont150-da100', week: '2026-12-21', params: 'deck', tgt: { cont: 150000, contMeasure: 'l18', da: 100000, daNonBD: true } },
  { name: 'week-oct5-cont100-l09-da50-bdonly', week: '2026-10-05', params: 'deck', tgt: { cont: 100000, contMeasure: 'l09', da: 50000, daNonBD: false } },
];
module.exports = { PARAMS, SOLVES };
