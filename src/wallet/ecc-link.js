/* Direct+ wallet: from the trading plan to ECC collateral (docs/wallet-model.md §2).
   Uses only the engine's public API. The engine's own solve() holds open risk and targets constant for all days; this
   solver takes both per calculation day. */
const WalletEccLink = ((Engine, Dates) => {
  'use strict';

  const BOOKING_CUT_HOUR = 16;
  const EVENING_BUYING_HOURS = 2; // eveningCont is the net buying from the 16:00 cut to an 18:00 update
  const DEFAULT_UPDATE_HOUR = 18;
  const SEARCH_START = 1e6; // the engine's solve() starts its search at €1 million ...
  const SEARCH_LIMIT = 1e13; // ... and gives up above €10 trillion
  const TOLERANCE = 1e-6; // how far (€) a limit may fall short of its target and still meet it
  const SAME_AMOUNT = 0.5; // two amounts within 50 cents need the same collateral
  const DEFAULT_KEY = 50;

  /**
   * Base limits (wallet-model §2.4; ECC deck p.2 and p.4) from the orders that rest over the 16:00 cut:
   *   restingCont, restingAuc, restingAucWeekend  € of continuous, auction and weekend auction orders
   *   eveningCont  net continuous buying between 16:00 and an 18:00 update, €; a later update stretches it
   *   updateHour   when ECC's evening update comes (ASSUMPTION: 18, and 19 in the stress case)
   *   override     { cont: { bd, nbd }, da: { bd, nbd } }: values set by hand, which win
   * Continuous has no weekend reset, so its non-business-day base limit is 0.
   */
  function baseLimits({ restingCont, eveningCont, updateHour, restingAuc, restingAucWeekend, override = {} }) {
    const buyingHours = (updateHour || DEFAULT_UPDATE_HOUR) - BOOKING_CUT_HOUR;
    const limits = {
      cont: { bd: (restingCont || 0) + ((eveningCont || 0) * buyingHours) / EVENING_BUYING_HOURS, nbd: 0 },
      da: { bd: restingAuc || 0, nbd: restingAucWeekend || 0 },
    };
    for (const market of ['cont', 'da']) {
      const given = override[market] || {};
      if (given.bd != null) limits[market].bd = given.bd;
      if (given.nbd != null) limits[market].nbd = given.nbd;
    }
    return limits;
  }

  /**
   * Limit targets per calculation day (wallet-model §2.2, §2.3). The limit set on calculation day D serves the trading
   * days after D up to and including the next business day (each 16:00 to 16:00).
   *   flowOf(isoDay)  → WalletBehaviour.dayFlows() for that trading day
   *   s               share of the buys already sold again when the open position is largest (ASSUMPTION, default 0)
   * Continuous, per calculation day: max(G × (1 − s), P) + restingCont, where G is the value that uses limit and P the
   * peak of the cumulative net value by day (a lower bound on the intraday peak: the plan has only daily totals).
   * Auctions, per auction day: that day's order exposure.
   */
  function targets(calcDays, flowOf, s, restingCont) {
    const cont = {};
    const auc = {};
    for (const calcDay of calcDays) {
      let risk = 0;
      let position = 0;
      let peak = 0;
      for (const day of Dates.eachDay(Dates.addDays(calcDay, 1), Engine.nextBD(calcDay))) {
        const flows = flowOf(Engine.iso(day));
        risk += flows.cont.risk;
        position += flows.cont.buyValue - flows.cont.sellValue;
        if (position > peak) peak = position;
        auc[Engine.iso(day)] = flows.auc.exposure;
      }
      cont[Engine.iso(calcDay)] = Math.max(risk * (1 - (s || 0)), peak) + (restingCont || 0);
    }
    return { cont, auc };
  }

  /** The engine's market parameters for base limits `bl` and continuous share `key`; auctions get the rest. */
  const marketParams = (bl, key) => ({
    cont: { bd: bl.cont.bd, nbd: bl.cont.nbd, key },
    da: { bd: bl.da.bd, nbd: bl.da.nbd, key: 100 - key },
  });

  /* Whether collateral C with continuous share `key` meets the targets on every calculation day: the base limits are
     covered, the continuous limit (the evening limit 'l18' or the limit after settlement 'l09', an ASSUMPTION) holds
     its target, and so does every auction. The engine's meets(), with open risk and targets per day. */
  function meetsTargets(C, key, search) {
    const params = marketParams(search.bl, key);
    for (const day of search.days) {
      const date = Engine.iso(day);
      const limits = Engine.day(day, { C, OR: search.OR(date), ...params });
      if (limits.baseUncovered) return false;
      const contTarget = search.cont(date);
      if (contTarget > 0 && limits.cont[search.measure || 'l18'] < contTarget - TOLERANCE) return false;
      for (const auction of limits.da.auctions) {
        const target = search.auc(auction.date, auction);
        if (target > 0 && auction.limit < target - TOLERANCE) return false;
      }
    }
    return true;
  }

  /**
   * The smallest whole euro of collateral that meets the targets with continuous share `key`, or null when no amount
   * does. search = {
   *   days     the calculation days (Dates)
   *   bl       base limits (baseLimits())
   *   measure  'l18' | 'l09', the continuous limit that must hold the target
   *   OR(iso)  open risk on that calculation day, €
   *   cont(iso), auc(iso, auction)  the targets, €
   *   key      the member's own split, preferred on ties by cheapest() }
   * Same search bounds as the engine's solve(), which it matches when open risk and targets are constant
   * (tests/wallet/ecc-link.test.js).
   */
  function solve(search, key) {
    let hi = SEARCH_START;
    while (!meetsTargets(hi, key, search)) {
      hi *= 2;
      if (hi > SEARCH_LIMIT) return null;
    }
    if (meetsTargets(0, key, search)) return 0;
    let lo = 0;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (meetsTargets(mid, key, search)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /** The split (continuous %) that needs the least collateral, trying every split from 0 to 100; on a tie, the one
   *  closest to the member's own (search.key). Returns { key, C }, or null when no split reaches the targets. */
  function cheapest(search) {
    const preferred = search.key ?? DEFAULT_KEY;
    const distance = (key) => Math.abs(key - preferred);
    let best = null;
    for (let key = 0; key <= 100; key++) {
      const C = solve(search, key);
      if (C === null) continue;
      const cheaper = !best || C < best.C - SAME_AMOUNT;
      const asCheapButCloser = best && Math.abs(C - best.C) <= SAME_AMOUNT && distance(key) < distance(best.key);
      if (cheaper || asCheapButCloser) best = { key, C };
    }
    return best;
  }

  return { baseLimits, targets, marketParams, solve, cheapest };
})(
  typeof LimitEngine !== 'undefined' ? LimitEngine : require('../engine.js'),
  typeof WalletDates !== 'undefined' ? WalletDates : require('./dates.js'),
);
if (typeof module !== 'undefined') module.exports = WalletEccLink;
