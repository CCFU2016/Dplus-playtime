// tennet-account.js: Dutch working days, the imbalance debit day, the weekly imbalance model and its seeded Monte
// Carlo, and the exit tail (docs/wallet-model.md §5, §6.2).
const W = require('../../src/wallet/tennet-account.js');
const T = require('./assert.js')('tennet-account');

// Dutch working days (to be confirmed with TenneT) and the weekly imbalance debit (ASSUMPTION for the day).
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
T.ok(
  !W.isWorkday(utc(2026, 5, 5)) && !W.isWorkday(utc(2027, 4, 27)),
  'Bevrijdingsdag 2026 and Koningsdag 2027 are not working days',
);
T.ok(W.isWorkday(utc(2026, 4, 3)), 'Good Friday is a Dutch working day (unlike the ECC calendar)');
T.eq(W.imbalanceDebit('2026-10-05'), '2026-11-09', 'weekly imbalance: four weeks after the delivery week');
T.eq(W.imbalanceDebit('2026-03-23'), '2026-04-28', 'Koningsdag (Monday 27 Apr 2026) moves the debit to the Tuesday');
T.eq(W.imbalanceDebit('2027-02-22'), '2027-03-30', 'Easter Monday 2027 moves the debit to the Tuesday');
T.eq(W.imbalanceDebit('2026-10-05', 2), '2026-10-26', 'a two-week lag');

// The weekly imbalance model (financial trader, §8.3) and the seeded Monte Carlo snapshot for B's stress end.
const ft = W.weekly({ volume: 680 * 7, share: 0.005, bias: 0, price: 80, state2Share: 0.05, state2Gap: 150, cv: 0.5 });
T.money(ft.mean, 89.25, 'FT weekly mean invoice');
T.money(ft.sd, 952, 'FT weekly σ');
T.money(ft.B, 1993.25, 'FT expected B');
const biased = W.weekly({ volume: 1000, share: 0.1, bias: 0.5, price: 100, state2Share: 0.1, state2Gap: 200, cv: 1 });
T.money(biased.mean, 100 * (0.5 * 100 + (0.5 * 20) / 2), 'a short bias pays the imbalance price on its share');
const short = W.weekly({ volume: 0, share: 0, price: 100, shortVolume: 10 });
T.eq(
  [short.volume, short.mean, short.sd],
  [10, 1000, 500],
  'imbalance that is always short (non-delivery) pays the full price',
);
T.money(W.stressB(89.25, 952), 2713.011640773227, 'Monte Carlo snapshot: FT stress B (seed 20260926)');
T.money(W.stressB(10000, 3000), 18268.156431008072, 'Monte Carlo snapshot: μ 10,000, σ 3,000');
T.ok(W.stressB(10000, 3000, { seed: 1 }) !== W.stressB(10000, 3000), 'a different seed gives a different draw');
const r = W.mulberry32(42);
T.eq(
  [r(), r(), r()].map((x) => x.toFixed(10)),
  ['0.6011037519', '0.4482905590', '0.8524657935'],
  'mulberry32 sequence for seed 42',
);

// Exit tail.
T.eq(
  W.exitTail('2026-10-31', { profile: true, smart: true }),
  { imbalance: '2026-11-28', smart: '2027-05-01', profile: '2028-07-31', released: '2028-07-31' },
  'exit tail with profile and smart-meter connections',
);
T.eq(W.exitTail('2026-10-31').released, '2026-11-28', 'exit tail without connections: about four weeks');

T.done();
