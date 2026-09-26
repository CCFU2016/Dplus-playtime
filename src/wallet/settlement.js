/* Direct+ wallet: ECC settlement through the connected account (docs/wallet-model.md §3).
   Sources: ECC, "Linking a Connected Bank Settlement Account with ECC" 2025/2026, p.3: "all trades conducted before
   4 PM CET are settled in the next morning", one MT101 "at the end of the business day (6 PM CET) with value date the
   next business day", received "before 8 AM (EUR)"; ECC DCP Payments page: one net payment per DCP member.
   Business days come from the engine's ECC (T2) calendar. */
var WalletSettlement = (function (E) {
  'use strict';
  var DAY = 86400000;
  function add(d, n) { return new Date(d.getTime() + n * DAY); }
  function toDate(d) { return typeof d === 'string' ? E.parse(d) : d; }

  /* Booking window closing on business day D at 16:00. It holds the trading days (each 16:00 to 16:00, labelled by
     the day it ends) after the previous business day, up to and including D. */
  function bookingWindow(D) {
    D = toDate(D);
    if (!E.isBD(D)) throw new Error(E.iso(D) + ' is not an ECC business day');
    var from = E.prevBD(D), days = [];
    for (var x = add(from, 1); x <= D; x = add(x, 1)) days.push(E.iso(x));
    var value = E.iso(E.nextBD(D));
    return { close: E.iso(D), from: E.iso(from), days: days, fundBy: E.iso(D) + ' 18:00', valueDate: value, receivedBy: value + ' 08:00' };
  }

  /* Windows closing on each of closeDays, with their amounts. flowOf(isoDay) → { net } for one trading day: what its
     trades cost (WalletBehaviour.dayFlows); extras(window) → fees, clearing-fund and cash-collateral items (optional).
     OR(D) = max(net of the window's trades, 0): purchases not yet paid, for the engine's evening calculation. Fees and
     collateral items are paid in the same collection but are not open risk. */
  function windows(closeDays, flowOf, extras) {
    return closeDays.map(function (D) {
      var w = bookingWindow(D), trade = 0;
      w.days.forEach(function (d) { trade += flowOf(d).net; });
      w.tradeNet = trade;
      w.net = trade + (extras ? extras(w) : 0);
      w.OR = Math.max(trade, 0);
      return w;
    });
  }

  /* Cash the member must have in the connected account (wallet-model §3): the peak, over the horizon, of what has been
     funded minus what came back and what the member topped up. Positive nets must be in the account at their D 18:00
     deadline; credits (negative nets) arrive on their value date. replenish (ASSUMPTION, default 'none'):
       'daily'  each morning's collection is topped up the same business day;
       'weekly' collections are topped up on the first business day of each week. */
  function cashPath(ws, replenish) {
    var ev = [];
    ws.forEach(function (w) {
      if (w.net > 0) {
        ev.push({ at: w.close + ' 18:00', kind: 'fund', amount: w.net, window: w.close });
        ev.push({ at: w.valueDate + ' 08:00', kind: 'collect', amount: w.net, window: w.close });
      } else if (w.net < 0) ev.push({ at: w.valueDate + ' 08:00', kind: 'credit', amount: -w.net, window: w.close });
    });
    ev.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
    var need = 0, level = 0, sinceTopUp = 0, lastWeek = null, path = [];
    ev.forEach(function (e) {
      var day = e.at.slice(0, 10);
      if (replenish === 'weekly') {
        var d = E.parse(day), mon = E.iso(add(d, -((d.getUTCDay() + 6) % 7)));
        if (lastWeek !== null && mon !== lastWeek && sinceTopUp > 0) { path.push({ at: day + ' 12:00', kind: 'top-up', amount: sinceTopUp, level: level -= sinceTopUp }); sinceTopUp = 0; }
        lastWeek = mon;
      }
      if (e.kind === 'fund') { level += e.amount; need = Math.max(need, level); }
      else if (e.kind === 'credit') level -= e.amount;
      else if (e.kind === 'collect') {
        sinceTopUp += e.amount;
        if (replenish === 'daily') { path.push({ at: e.at, kind: 'collect', amount: e.amount, level: level }); path.push({ at: day + ' 12:00', kind: 'top-up', amount: e.amount, level: level -= e.amount }); sinceTopUp = 0; return; }
      }
      path.push({ at: e.at, kind: e.kind, amount: e.amount, level: level });
    });
    return { need: need, path: path };
  }

  return { bookingWindow: bookingWindow, windows: windows, cashPath: cashPath };
})(typeof LimitEngine !== 'undefined' ? LimitEngine : require('../engine.js'));
if (typeof module !== 'undefined') module.exports = WalletSettlement;
