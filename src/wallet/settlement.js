/* Direct+ wallet: ECC settlement through the connected account (docs/wallet-model.md §3).
   Sources: ECC, "Linking a Connected Bank Settlement Account with ECC" 2025/2026, p.3: "all trades conducted before
   4 PM CET are settled in the next morning", one MT101 "at the end of the business day (6 PM CET) with value date the
   next business day", received "before 8 AM (EUR)"; ECC DCP Payments page: one net payment per DCP member.
   Business days come from the engine's ECC (T2) calendar. */
const WalletSettlement = ((Engine, Dates) => {
  'use strict';

  const FUNDING_TIME = '18:00'; // the member funds each window by 18:00 on its closing day
  const RECEIPT_TIME = '08:00'; // ECC receives the money before 08:00 on the value date
  const TOP_UP_TIME = '12:00'; // when the member tops the wallet up again (an assumption, for the timeline only)

  const toDate = (day) => (typeof day === 'string' ? Engine.parse(day) : day);

  /** The booking window that closes on business day `close` at 16:00: the trading days (each 16:00 to 16:00, labelled
   *  by the day it ends) after the previous business day, up to and including `close`. */
  function bookingWindow(close) {
    const closeDate = toDate(close);
    if (!Engine.isBD(closeDate)) throw new Error(`${Engine.iso(closeDate)} is not an ECC business day`);
    const from = Engine.prevBD(closeDate);
    const days = [...Dates.eachDay(Dates.addDays(from, 1), closeDate)].map(Engine.iso);
    const closeIso = Engine.iso(closeDate);
    const valueDate = Engine.iso(Engine.nextBD(closeDate));
    return {
      close: closeIso,
      from: Engine.iso(from),
      days,
      fundBy: `${closeIso} ${FUNDING_TIME}`,
      valueDate,
      receivedBy: `${valueDate} ${RECEIPT_TIME}`,
    };
  }

  /**
   * The windows closing on each of closeDays, with their amounts.
   *   flowOf(isoDay)  → { net }: what one trading day's trades cost (WalletBehaviour.dayFlows)
   *   extras(window)  → € of fees and other cash items in the same collection (optional)
   * OR, the open risk for the engine's evening calculation, is the window's net buying, never below 0. Fees and other
   * items are paid in the same collection but are not open risk.
   */
  function windows(closeDays, flowOf, extras) {
    return closeDays.map((close) => {
      const window = bookingWindow(close);
      const tradeNet = window.days.reduce((sum, day) => sum + flowOf(day).net, 0);
      const net = tradeNet + (extras ? extras(window) : 0);
      return { ...window, tradeNet, net, OR: Math.max(tradeNet, 0) };
    });
  }

  /**
   * The cash the member must have in the connected account (wallet-model §3): the peak, over the windows, of what has
   * been funded minus what came back and what the member topped up. A positive net must be in the account by 18:00 on
   * the window's closing day; a credit (negative net) arrives on its value date.
   *   replenish  'none'   no top-ups within the period (the default, and the cautious ASSUMPTION)
   *              'daily'  each morning's collection is topped up the same business day
   *              'weekly' the collections are topped up on the first day of each new week
   * Returns { need, path }, where path lists every movement in time order with the balance after it.
   */
  function cashPath(ws, replenish) {
    const events = [];
    for (const w of ws) {
      if (w.net > 0) {
        events.push({ at: `${w.close} ${FUNDING_TIME}`, kind: 'fund', amount: w.net });
        events.push({ at: `${w.valueDate} ${RECEIPT_TIME}`, kind: 'collect', amount: w.net });
      } else if (w.net < 0) {
        events.push({ at: `${w.valueDate} ${RECEIPT_TIME}`, kind: 'credit', amount: -w.net });
      }
    }
    events.sort((a, b) => Dates.compareIso(a.at, b.at));

    const path = [];
    let need = 0;
    let level = 0; // funded and not yet covered by a top-up or a credit
    let collected = 0; // collected since the last top-up
    let week = null;
    const topUp = (day, amount) => {
      level -= amount;
      path.push({ at: `${day} ${TOP_UP_TIME}`, kind: 'top-up', amount, level });
    };

    for (const event of events) {
      const day = event.at.slice(0, 10);
      // Weekly: the first movement of a new week tops up what was collected before it, at midday.
      let weeklyTopUp = 0;
      if (replenish === 'weekly') {
        const monday = Engine.iso(Dates.mondayOf(Engine.parse(day)));
        if (week !== null && monday !== week && collected > 0) {
          weeklyTopUp = collected;
          collected = 0;
        }
        week = monday;
      }
      const topUpFirst = event.at >= `${day} ${TOP_UP_TIME}`;
      if (weeklyTopUp && topUpFirst) topUp(day, weeklyTopUp);

      if (event.kind === 'fund') {
        level += event.amount;
        need = Math.max(need, level);
      } else if (event.kind === 'credit') {
        level -= event.amount;
      } else {
        collected += event.amount;
      }
      path.push({ at: event.at, kind: event.kind, amount: event.amount, level });

      if (weeklyTopUp && !topUpFirst) topUp(day, weeklyTopUp);
      if (event.kind === 'collect' && replenish === 'daily') {
        topUp(day, event.amount);
        collected = 0;
      }
    }
    return { need, path };
  }

  return { bookingWindow, windows, cashPath };
})(
  typeof LimitEngine !== 'undefined' ? LimitEngine : require('../engine.js'),
  typeof WalletDates !== 'undefined' ? WalletDates : require('./dates.js'),
);
if (typeof module !== 'undefined') module.exports = WalletSettlement;
