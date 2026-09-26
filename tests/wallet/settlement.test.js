// settlement.js: booking windows, value dates, open risk, cash path (docs/wallet-model.md §3).
const S = require('../../src/wallet/settlement.js');
const T = require('./assert.js')('settlement');

// Value dates (brief, Phase 2): the value date is the next ECC business day.
const vd = d => S.bookingWindow(d).valueDate;
T.eq(vd('2026-10-02'), '2026-10-05', 'window closing Fri 2 Oct 2026 → Mon 5 Oct');
T.eq(vd('2026-10-05'), '2026-10-06', 'window closing Mon 5 Oct 2026 → Tue 6 Oct');
T.eq(vd('2027-03-25'), '2027-03-30', 'window closing Thu 25 Mar 2027 → Tue 30 Mar (Good Friday, Easter Monday)');
T.eq(vd('2027-03-30'), '2027-03-31', 'window closing Tue 30 Mar 2027 → Wed 31 Mar');
let w = S.bookingWindow('2027-03-30');
T.eq(w.days, ['2027-03-26', '2027-03-27', '2027-03-28', '2027-03-29', '2027-03-30'], 'the Tue 30 Mar 2027 window holds five trading days');
T.eq([w.fundBy, w.receivedBy], ['2027-03-30 18:00', '2027-03-31 08:00'], 'fund by D 18:00, ECC receives before 08:00 on the value date');
T.eq(S.bookingWindow('2026-10-05').days, ['2026-10-03', '2026-10-04', '2026-10-05'], 'a Monday window holds three trading days');
T.throws(() => S.bookingWindow('2026-10-03'), 'a window closing on a Saturday');

// Open risk: a Monday carries three days of net buying.
const flat = () => ({ tradeNet: 1000, net: 1000 });
let ws = S.windows(['2026-10-05', '2026-10-06'], flat);
T.money(ws[0].OR, 3000, 'OR on Monday covers three days');
T.money(ws[1].OR, 1000, 'OR on Tuesday covers one day');

// A negative-price day: the day's buying is a credit, so the window pays the member and adds no open risk.
ws = S.windows(['2026-10-06'], d => ({ tradeNet: -3000, net: -3000 }));
T.money(ws[0].net, -3000, 'negative-price day: the window is a credit');
T.money(ws[0].OR, 0, 'negative-price day: no open risk');
T.money(S.cashPath(ws, 'none').need, 0, 'negative-price day: no cash needed');
// Fees and collateral items count in the net amount, never in the open risk.
ws = S.windows(['2026-10-06'], d => ({ tradeNet: -3000, net: -3000 }), () => 500);
T.money(ws[0].net, -2500, 'extras are added to the net amount');
T.money(ws[0].OR, 0, 'extras never enter open risk');

// Cash path. The stress week of the worked example (§8.2): the peak cumulative outflow without replenishment.
const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
const stress = { '2026-10-05': 12750, '2026-10-06': 4250, '2026-10-07': 4250, '2026-10-08': 4250, '2026-10-09': 4250 };
ws = week.map(d => Object.assign(S.bookingWindow(d), { net: stress[d] }));
T.money(S.cashPath(ws, 'none').need, 29750, 'stress week, no replenishment');
T.money(S.cashPath(ws, 'daily').need, 12750, 'stress week, daily replenishment: the largest single amount');
T.money(S.cashPath(ws, 'weekly').need, 29750, 'stress week, weekly replenishment: no top-up inside one week');
// Two weeks at €1,000 a trading day (Monday windows €3,000). Weekly: the first week's collections (€6,000 by
// Fri 9 Oct) are topped up on Mon 12 Oct, so the peak is 7,000 − 6,000 + 7,000 = €8,000.
const two = week.concat(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
ws = S.windows(two, flat);
T.money(S.cashPath(ws, 'none').need, 14000, 'two weeks, no replenishment');
T.money(S.cashPath(ws, 'daily').need, 3000, 'two weeks, daily replenishment');
T.money(S.cashPath(ws, 'weekly').need, 8000, 'two weeks, weekly replenishment');
// A credit in between: Mon +10,000, Tue −3,000 (arrives Wed 08:00), Wed +5,000.
ws = [['2026-10-05', 10000], ['2026-10-06', -3000], ['2026-10-07', 5000]].map(x => Object.assign(S.bookingWindow(x[0]), { net: x[1] }));
T.money(S.cashPath(ws, 'none').need, 12000, 'credit on its value date reduces the need');
T.money(S.cashPath(ws, 'daily').need, 10000, 'credit with daily replenishment');

T.done();
