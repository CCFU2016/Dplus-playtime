// ECC's own worked examples (DCP client deck, July 2025, p.8 continuous and p.10 auction). These must always pass.
// Reproduce ECC client deck p.8 (continuous) and p.10 (auction): 10€ collateral, BD = NBD = 1€.
const E = require('../src/engine.js');
const days = ['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09']; // Mon..Fri
const expo = [0, 5, 9, 3, 2];
let fails = 0;
const eq = (a, b, what) => { if (Math.abs(a - b) > 1e-9) { fails++; console.log('FAIL', what, 'got', a, 'want', b); } };
const expC = { l16: [1,1,1,1,3], l18: [9,4,1,4,7], l09: [9,9,9,7,9] };
const expA = { l16: [1,1,1,1,1], l18: [9,4,1,4,7/3], next: [9,9,9,7,9] };
days.forEach((d, i) => {
  const c = E.day(E.parse(d), { C:10, OR:expo[i], cont:{bd:1,nbd:1,key:100}, da:{bd:0,nbd:0,key:0} });
  eq(c.cont.l16, expC.l16[i], d+' cont 16:00'); eq(c.cont.l18, expC.l18[i], d+' cont 18:00'); eq(c.cont.l09, expC.l09[i], d+' cont next morning');
  const a = E.day(E.parse(d), { C:10, OR:expo[i], cont:{bd:0,nbd:0,key:0}, da:{bd:1,nbd:1,key:100} });
  eq(a.da.l16, expA.l16[i], d+' DA 16:00'); eq(a.da.l18, expA.l18[i], d+' DA 18:00');
  const last = a.da.auctions[a.da.auctions.length - 1];
  eq(last.limit, expA.next[i], d+' DA next business day auction');
});
if (fails) process.exitCode = 1;
console.log(fails ? fails + ' failures' : 'ECC examples p.8 and p.10 reproduced exactly (incl. Monday = 9)');
// The deck example: Friday 2026-10-02, 500k, 100k unpaid, 20k/10k, 10k/10k, 60/40
const f = E.day(E.parse('2026-10-02'), { C:500000, OR:100000, cont:{bd:20000,nbd:10000,key:60}, da:{bd:10000,nbd:10000,key:40} });
console.log('Deck Friday: DA auctions', f.da.auctions.map(a => a.date.slice(5)+':'+Math.round(a.limit)).join(' '), '| cont l18/l09', f.cont.l18, f.cont.l09);
