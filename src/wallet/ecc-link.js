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
     its target, and so does every auction. `markets` narrows the targets checked to 'cont', 'auc' or neither; the base
     limits are always checked. The engine's meetsTargets(), with open risk and targets per day. */
  function meetsTargets(C, key, search, markets = ['cont', 'auc']) {
    const params = marketParams(search.bl, key);
    for (const day of search.days) {
      const date = Engine.iso(day);
      const limits = Engine.day(day, { C, OR: search.OR(date), ...params });
      if (limits.baseUncovered) return false;
      if (markets.includes('cont')) {
        const contTarget = search.cont(date);
        if (contTarget > 0 && limits.cont[search.measure || 'l18'] < contTarget - TOLERANCE) return false;
      }
      if (markets.includes('auc')) {
        for (const auction of limits.da.auctions) {
          const target = search.auc(auction.date, auction);
          if (target > 0 && auction.limit < target - TOLERANCE) return false;
        }
      }
    }
    return true;
  }

  /* The smallest whole euro C for which works(C) holds, or null when none does below the search limit. The engine's
     search: double from €1 million until works() holds, then bisect. More collateral never lowers a limit, so works()
     holds for every amount above one for which it holds. */
  function smallestAmount(works) {
    let hi = SEARCH_START;
    while (!works(hi)) {
      hi *= 2;
      if (hi > SEARCH_LIMIT) return null;
    }
    if (works(0)) return 0;
    let lo = 0;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (works(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
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
  const solve = (search, key) => smallestAmount((C) => meetsTargets(C, key, search));

  /** The smallest whole % with which market `id` ('cont' or 'auc') meets its targets at collateral C, or Infinity when
   *  100% is not enough. The auctions get the % that continuous leaves. The engine's minKey(). */
  function minKey(C, search, id) {
    const meetsAt = (share) => meetsTargets(C, id === 'cont' ? share : 100 - share, search, [id]);
    if (!meetsAt(100)) return Infinity;
    if (meetsAt(0)) return 0;
    let lo = 0;
    let hi = 100;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (meetsAt(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /**
   * The split (continuous %) that needs the least collateral, and that collateral: { key, C }, or null when no split
   * reaches the targets. As in the engine's cheapestKey(), each market's limits depend only on the collateral and its
   * own share, and grow with both. So the smallest continuous share that meets the continuous targets leaves the
   * auctions the most, and collateral C works with some split exactly when it works with that one. Search on C once;
   * then, of the splits that work, take the one closest to the member's own (search.key), the lower on a tie. The same
   * answer as trying every split with solve() (tests/wallet/ecc-link.test.js).
   */
  function cheapest(search) {
    const works = (C) => {
      const key = minKey(C, search, 'cont');
      return key <= 100 && meetsTargets(C, key, search);
    };
    const C = smallestAmount(works);
    if (C === null) return null;
    const from = minKey(C, search, 'cont');
    const to = 100 - minKey(C, search, 'auc');
    const preferred = search.key ?? DEFAULT_KEY;
    const distance = (key) => Math.abs(key - preferred);
    let key = from;
    for (let other = from + 1; other <= to; other++) if (distance(other) < distance(key)) key = other;
    return { key, C };
  }

  return { baseLimits, targets, marketParams, solve, cheapest };
})(
  typeof LimitEngine !== 'undefined' ? LimitEngine : require('../engine.js'),
  typeof WalletDates !== 'undefined' ? WalletDates : require('./dates.js'),
);
if (typeof module !== 'undefined') module.exports = WalletEccLink;
