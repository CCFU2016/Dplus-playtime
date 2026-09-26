// tennet-account.js: imbalance prices, Dutch working-day dates, the account/security check, the imbalance model and
// its seeded Monte Carlo (docs/wallet-model.md §5, §6.2).
const W = require('../../src/wallet/tennet-account.js');
const T = require('./assert.js')('tennet-account');

// Imbalance price per regulation state (SC 2026 art. 10.29). The brief's case: state 2, mid 100, up 120, down 60.
let p = { mid: 100, up: 120, down: 60 };
T.money(W.price(2, 'short', p), 120, 'state 2: short pays max(mid, up) = 120');
T.money(W.price(2, 'long', p), 60, 'state 2: long receives min(mid, down) = 60');
T.money(W.price(2, 'short', { mid: 150, up: 120, down: 60 }), 150, 'state 2 with mid 150: short pays 150');
T.money(W.price(2, 'long', { mid: 40, up: 120, down: 60 }), 40, 'state 2 with mid 40: long receives 40');
T.eq([-1, 1, 0].map(s => [W.price(s, 'short', p), W.price(s, 'long', p)]), [[60, 60], [120, 120], [100, 100]], 'states −1, +1, 0: one price for both sides');
T.money(W.periodAmount(2, 1, p), 240, '2 MWh short in state +1: the BRP pays 240');
T.money(W.periodAmount(-2, 1, p), -240, '2 MWh long in state +1: TenneT pays 240');
T.money(W.periodAmount(2, -1, { mid: -10, up: 0, down: -50 }), -100, 'short at a negative price: TenneT pays');
T.throws(() => W.price(3, 'short', p), 'an unknown regulation state');

// Dutch working days (to be confirmed, Q11), and the Tuesday/Wednesday dates of art. 10.26(5)-(6), with the shift to
// the next working day of para 8 (para 7 in the draft).
T.ok(!W.isWorkday(new Date(Date.UTC(2026, 4, 5))) && !W.isWorkday(new Date(Date.UTC(2027, 3, 27))), 'Bevrijdingsdag 2026 and Koningsdag 2027 are not working days');
T.ok(W.isWorkday(new Date(Date.UTC(2026, 3, 3))), 'Good Friday is a Dutch working day (unlike the ECC calendar)');
let d = W.profileDates('2025-11', 'current');
T.eq([d.statement, d.pay, d.payout], ['2026-04-15', '2026-04-28', '2026-04-29'], 'current: three working days before the first Tuesday, so the Tuesday after');
d = W.profileDates('2025-11', 'draft');
T.eq([d.pay, d.payout], ['2026-04-21', '2026-04-22'], 'draft: the first Tuesday, no exception');
d = W.profileDates('2026-11', 'current');
T.eq([d.statement, d.pay, d.payout], ['2027-04-14', '2027-04-28', '2027-04-28'], 'current: Tuesday 27 Apr 2027 is Koningsdag, so payment moves to Wednesday');
d = W.profileDates('2023-07', 'current');
T.eq([d.pay, d.payout], ['2023-12-27', '2023-12-27'], 'current: Tuesday 26 Dec 2023 is Boxing Day, so payment moves to Wednesday');
d = W.paymentDates('2026-04-30', 'draft');
T.eq([d.pay, d.payout], ['2026-05-06', '2026-05-06'], 'draft: Tuesday 5 May 2026 is Bevrijdingsdag, so payment moves to Wednesday');
d = W.paymentDates('2027-04-21', 'draft');
T.eq([d.pay, d.payout], ['2027-04-28', '2027-04-28'], 'draft: Tuesday 27 Apr 2027 is Koningsdag, so payment moves to Wednesday');
T.eq(W.profileDates('2026-11').version, 'draft', 'a statement from 2027 follows the draft by default');
T.eq(W.smartDates('2026-01'), { month: '2026-01', pay: '2026-07-01', payout: '2026-07-01' }, 'smart-meter and telemetry: first working day of M+6');
T.eq(W.smartDates('2026-12').pay, '2027-06-01', 'smart-meter and telemetry across a year end');
T.eq(W.imbalanceDebit('2026-10-05'), '2026-11-09', 'weekly imbalance: four weeks after the delivery week (ASSUMPTION for the debit day)');

// Account vs security (draft art. 10.8(10), INTERPRETATION), in date order, with and without a guarantee, with a credit.
const inv = [{ date: '2026-11-17', amount: 2000 }, { date: '2026-11-03', amount: 1000 }, { date: '2026-11-10', amount: -500 }];
let a = W.accountNeed(inv, 96000, 96000);
T.money(a.need, 2500, 'guarantee covers the security: the balance only has to cover the invoices (credit counted)');
T.eq(a.binding, { date: '2026-11-17', check: 'balance before the debit' }, 'with a guarantee, the last debit binds');
a = W.accountNeed(inv, 96000, 0);
T.money(a.need, 98500, 'no guarantee: the security stays in the account after every debit');
T.eq(a.binding, { date: '2026-11-17', check: 'security after the debit' }, 'without a guarantee, the security after the last debit binds');
T.money(W.accountNeed(inv, 96000, 96000, 'current').need, 2500, 'current rule (additive), guarantee: same total');
T.money(W.accountNeed(inv, 96000, 0, 'current').need, 98500, 'current rule (additive), deposit: same total');
a = W.accountNeed([{ date: '2026-11-03', amount: -3000 }, { date: '2026-11-10', amount: 2000 }], 96000, 0);
T.money(a.need, 96000, 'a credit first: the opening security binds');
a = W.accountNeed(inv, d8 => d8 >= '2026-11-10' ? 120000 : 96000, 96000);
T.money(a.need, 26500, 'security rising to €120,000 from 10 Nov: after the last debit, 2,500 + 120,000 − 96,000');

// The weekly imbalance model (financial trader, §8.3) and the seeded Monte Carlo snapshot for B's stress end.
const w = W.weekly({ weeklyVolume: 680 * 7, share: 0.005, bias: 0, price: 80, statePrice2Share: 0.05, stateGap2: 150, cv: 0.5 });
T.money(w.mu, 89.25, 'FT weekly mean invoice');
T.money(w.sigma, 952, 'FT weekly σ');
T.money(w.B, 1993.25, 'FT expected B');
const biased = W.weekly({ weeklyVolume: 1000, share: 0.1, bias: 0.5, price: 100, statePrice2Share: 0.1, stateGap2: 200, cv: 1 });
T.money(biased.mu, 100 * (0.5 * 100 + 0.5 * 20 / 2), 'a short bias pays the imbalance price on its share');
T.money(W.stressB(89.25, 952), 2713.011640773227, 'Monte Carlo snapshot: FT stress B (seed 20260926)');
T.money(W.stressB(10000, 3000), 18268.156431008072, 'Monte Carlo snapshot: μ 10,000, σ 3,000');
T.ok(W.stressB(10000, 3000, { seed: 1 }) !== W.stressB(10000, 3000), 'a different seed gives a different draw');
const r = W.mulberry32(42), first = [r(), r(), r()];
T.eq(first.map(x => x.toFixed(10)), ['0.6011037519', '0.4482905590', '0.8524657935'], 'mulberry32 sequence for seed 42');

// Exit tail.
T.eq(W.exitTail('2026-10-31', { profile: true, smart: true }), { imbalance: '2026-11-28', smart: '2027-05-01', profile: '2028-07-31', released: '2028-07-31' }, 'exit tail with profile and smart-meter connections');
T.eq(W.exitTail('2026-10-31').released, '2026-11-28', 'exit tail without connections: about four weeks');

T.done();
