/* Direct+ limit engine: ECC's dynamic limit rules for direct clearing participants (DCP), per market.
   Implemented: EPEX continuous (EPEX_CONTINUOUS_EUR) and the day-ahead auction (EPEX_AUCTION_EUR).
   Ported from ECC's DCP Simulation Tool v1.3.5 (clsCalcForMarket, Output.bas) and checked against ECC's client deck
   (July 2025). One deliberate difference from the tool: after a weekend or holiday, the next business day's auction
   is back at the full limit, as in ECC's client deck (the lower of two readings, see dayMarketLimits()). */
const LimitEngine = (() => {
  'use strict';

  // Weekday non-business days in ECC's calendar (weekends are never business days).
  const HOLIDAYS = {
    '2026-01-01': "New Year's Day",
    '2026-04-03': 'Good Friday',
    '2026-04-06': 'Easter Monday',
    '2026-05-01': 'Labour Day',
    '2026-12-25': 'Christmas Day',
    '2027-01-01': "New Year's Day",
    '2027-03-26': 'Good Friday',
    '2027-03-29': 'Easter Monday',
  };
  const MIN_DATE = '2026-01-01';
  const MAX_DATE = '2027-12-24';
  const DAY_MS = 86400000;

  // Collateral searches start at €1 million and double up to €10 trillion; above that a target is out of reach.
  const SEARCH_START = 1e6;
  const SEARCH_LIMIT = 1e13;
  const TOLERANCE = 1e-6; // how far (€) a limit may fall short of its target and still meet it

  /* Market definitions, copied from ECC's market table (reference/ecc/markets_table.csv; tests/markets.test.js checks
     them against it).
       reset        'business day': one limit period per business day, running over weekends and holidays;
                    'day': the limit resets every calendar day
       auction      the table's Auction Flag
       ownCalendar  the market has its own trading-day calendar (the table's "separate TD calendar")
     A market's rules follow from these fields; only the markets listed here are implemented. */
  const MARKETS = {
    EPEX_CONTINUOUS_EUR: { reset: 'business day', auction: 0, ownCalendar: false, currency: 'EUR' },
    EPEX_AUCTION_EUR: { reset: 'day', auction: 0, ownCalendar: false, currency: 'EUR' },
  };
  // The two markets of the original two-market form (p.cont, p.da).
  const CONT = 'EPEX_CONTINUOUS_EUR';
  const DA = 'EPEX_AUCTION_EUR';
  const TWO_MARKET_NAMES = { [CONT]: 'cont', [DA]: 'da' };

  const sum = (values) => values.reduce((total, value) => total + value, 0);

  // ---------- calendar (dates are UTC midnights) ----------

  function parse(isoDate) {
    const [year, month, day] = isoDate.split('-');
    return new Date(Date.UTC(+year, +month - 1, +day));
  }
  const iso = (date) => date.toISOString().slice(0, 10);
  const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
  const daysBetween = (from, to) => Math.round((to - from) / DAY_MS);

  function isWeekend(date) {
    const weekday = date.getUTCDay();
    return weekday === 0 || weekday === 6;
  }
  const isBD = (date) => !isWeekend(date) && !HOLIDAYS[iso(date)];

  function nextBD(date) {
    let day = addDays(date, 1);
    while (!isBD(day)) day = addDays(day, 1);
    return day;
  }
  function prevBD(date) {
    let day = addDays(date, -1);
    while (!isBD(day)) day = addDays(day, -1);
    return day;
  }
  const holidayName = (date) => HOLIDAYS[iso(date)] || (isWeekend(date) ? 'Weekend' : '');

  /** The business days of the week (Monday to Friday) that holds `anchorIso`. */
  function weekDays(anchorIso) {
    const anchor = parse(anchorIso);
    const monday = addDays(anchor, -((anchor.getUTCDay() + 6) % 7));
    return [0, 1, 2, 3, 4].map((i) => addDays(monday, i)).filter(isBD);
  }

  /** `isoDate` when it is a business day, else the next business day. */
  function snapToBD(isoDate) {
    const date = parse(isoDate);
    return isBD(date) ? date : nextBD(date);
  }

  // ---------- base limits ----------

  /* One market's base limit from one business day's 16:00 to the next, `gap` calendar days later: at16(gap) is the
     limit that goes live at 16:00, reserve(gap) what ECC reserves for the period. */
  function baseRule(def, { bd, nbd }) {
    if (def.reset === 'business day') {
      // No reset on non-business days, so the 16:00 base limit must last the whole gap.
      const lasting = (gap) => bd + (gap - 1) * nbd;
      return { at16: lasting, reserve: lasting };
    }
    // Resets every calendar day; a gap of several days takes max(BD, NBD) for each day.
    const perDay = Math.max(bd, nbd);
    return {
      at16: (gap) => (gap === 1 ? bd : perDay),
      reserve: (gap) => (gap === 1 ? bd : gap * perDay),
    };
  }

  /** p.markets with their definitions: { id, def, bd, share (the key as a fraction), rule }. */
  function resolve(list) {
    const seen = new Set();
    return list.map((spec) => {
      const def = MARKETS[spec.id];
      if (!def) throw new Error(`Market not implemented: ${spec.id}`);
      if (seen.has(spec.id)) throw new Error(`Market listed twice: ${spec.id}`);
      seen.add(spec.id);
      return { id: spec.id, def, bd: spec.bd, share: spec.key / 100, rule: baseRule(def, spec) };
    });
  }

  /** One market's base limit requirement: today's base limit and the one granted at the next business day's 16:00. */
  function requirementOf(market, gap1, gap2) {
    return market.rule.reserve(gap1) + market.rule.reserve(gap2);
  }

  /** The base limit requirement of calculation day `date`, over all markets. */
  function reserveAt(date, markets) {
    const next1 = nextBD(date);
    const next2 = nextBD(next1);
    const gap1 = daysBetween(date, next1);
    const gap2 = daysBetween(next1, next2);
    return sum(markets.map((market) => requirementOf(market, gap1, gap2)));
  }

  // ---------- one calculation day ----------

  /* A business-day market (continuous): one limit period until the next business day. The evening calculation adds
     the market's share of the free collateral; next morning, settlement refills it with yesterday's purchases. */
  function businessDayMarketLimits(market, { blr, gap1, free, refill }) {
    const l16 = market.rule.at16(gap1);
    const l18 = l16 + free * market.share;
    return { blr, share: free * market.share, l16, l18, l09: l18 + refill * market.share, resetDays: 1 };
  }

  /* A day market (the auctions): its share of the free collateral is spread over every auction day until the next
     business day, t + 1 … nextBD(t). */
  function dayMarketLimits(market, { t, C, markets, next1, blr, gap1, free, refill }) {
    const l16 = market.rule.at16(gap1);
    const l18 = l16 + (free * market.share) / gap1;
    let l09 = l18 + refill * market.share;
    let carry = null;
    let level = null;
    if (gap1 > 1) {
      // The next business day's auction after a weekend or holiday (shown with those auctions unused). ECC's client
      // deck puts it back at the full limit, where the simulation tool gives only the one-day share. ECC's example
      // (one market) fits two readings, which differ slightly with two markets and weekend base limits; we show the
      // lower one:
      //   carry: the unused weekend or holiday limit, base limits included, comes back
      //   level: the normal weekday level (the next business day's reserve, nothing unpaid)
      carry = l18 * gap1 + refill * market.share;
      level = market.bd + Math.max(C - reserveAt(next1, markets), 0) * market.share;
      l09 = Math.min(carry, level);
    }
    const auctions = [];
    for (let i = 1; i <= gap1; i++) {
      const date = addDays(t, i);
      const settled = i === gap1;
      auctions.push({
        date: iso(date),
        limit: settled ? l09 : l18,
        settled,
        bd: isBD(date),
        note: holidayName(date),
        rollover: settled && gap1 > 1,
        carry: settled ? carry : null,
        level: settled ? level : null,
      });
    }
    return { blr, share: free * market.share, l16, l18, l09, resetDays: gap1, auctions };
  }

  /* One calculation day t (an ECC business day), for any list of markets.
     p = { C, OR, markets: [{ id, bd, nbd, key }] }: collateral, open risk and base limits in €, keys in % adding up
     to 100. */
  function calc(t, p) {
    const markets = resolve(p.markets);
    const next1 = nextBD(t);
    const next2 = nextBD(next1);
    const gap1 = daysBetween(t, next1);
    const gap2 = daysBetween(next1, next2);
    // Base limit requirement: today's base limit and the one granted at the next business day's 16:00.
    const requirements = markets.map((market) => requirementOf(market, gap1, gap2));
    const blr = sum(requirements);
    const excess = p.C - blr - p.OR; // negative when the collateral falls short
    // Floored at zero as in ECC's deck (p.8); ECC's tool does not floor it (docs/open-questions.md).
    const free = Math.max(excess, 0);
    // Next morning, yesterday's settled purchases come back; a shortfall is refilled first.
    const refill = Math.max(p.OR - Math.max(-excess, 0), 0);
    const results = {};
    markets.forEach((market, i) => {
      const figures = { t, C: p.C, markets, next1, blr: requirements[i], gap1, free, refill };
      results[market.id] =
        market.def.reset === 'business day'
          ? businessDayMarketLimits(market, figures)
          : dayMarketLimits(market, figures);
    });
    return {
      date: iso(t),
      nextBD: iso(next1),
      secondBD: iso(next2),
      gap1,
      gap2,
      blr,
      excess,
      free,
      refill,
      markets: results,
      baseUncovered: p.C < blr,
    };
  }

  // ---------- the two-market form: p = { C, OR, cont: { bd, nbd, key }, da: { bd, nbd, key } } ----------

  const fromTwoMarkets = ({ C, OR, cont, da }) => ({
    C,
    OR,
    markets: [
      { id: CONT, bd: cont.bd, nbd: cont.nbd, key: cont.key },
      { id: DA, bd: da.bd, nbd: da.nbd, key: da.key },
    ],
  });
  const targetsFromTwoMarkets = ({ cont, contMeasure, da, daNonBD }) => ({
    [CONT]: { limit: cont, measure: contMeasure },
    [DA]: { limit: da, nonBD: daNonBD },
  });
  function toTwoMarkets(r) {
    const c = r.markets[CONT];
    const a = r.markets[DA];
    return {
      date: r.date,
      nextBD: r.nextBD,
      secondBD: r.secondBD,
      gap1: r.gap1,
      gap2: r.gap2,
      blrC: c.blr,
      blrA: a.blr,
      blr: r.blr,
      excess: r.excess,
      free: r.free,
      refill: r.refill,
      shareC: c.share,
      shareA: a.share,
      cont: { l16: c.l16, l18: c.l18, l09: c.l09 },
      da: { l16: a.l16, l18: a.l18, l09: a.l09, resetDays: a.resetDays, auctions: a.auctions },
      baseUncovered: r.baseUncovered,
    };
  }

  /** One calculation day: with p.markets, calc()'s result; with p.cont and p.da, the two-market result. */
  const day = (t, p) => (p.markets ? calc(t, p) : toTwoMarkets(calc(t, fromTwoMarkets(p))));

  /** Every business day of the week that holds `anchorIso`. */
  const week = (anchorIso, p) => weekDays(anchorIso).map((t) => day(t, p));

  // ---------- sizing ----------
  /* Targets per market id:
       { <id>: { limit: €, measure: 'l18' | 'l09' } }  business-day markets: the limit that evening or next morning
       { <id>: { limit: €, nonBD: bool } }             day markets: the limit at every auction (nonBD: the weekend and
                                                       holiday auctions too)
     The two-market form takes { cont: €, contMeasure: 'l18' | 'l09', da: €, daNonBD: bool }.
     A market's limits depend only on the collateral and its own key, never on the other markets' keys. */

  /** Calls visit(limit, date) for each limit of market `id` in day result `r` that `target` applies to. */
  function eachTargetLimit(r, id, target, visit) {
    const result = r.markets[id];
    if (!result.auctions) {
      visit(result[target.measure], r.date);
      return;
    }
    for (const auction of result.auctions) {
      if (target.nonBD || auction.bd) visit(auction.limit, auction.date);
    }
  }

  /** Whether collateral C covers the base limits and meets every target on every day in `days`. */
  function meetsTargets(C, days, p, targets) {
    const params = { C, OR: p.OR, markets: p.markets };
    for (const t of days) {
      const r = calc(t, params);
      if (r.baseUncovered) return false;
      for (const [id, target] of Object.entries(targets)) {
        if (!(target.limit > 0) || !r.markets[id]) continue;
        let short = false;
        eachTargetLimit(r, id, target, (limit) => {
          if (limit < target.limit - TOLERANCE) short = true;
        });
        if (short) return false;
      }
    }
    return true;
  }

  /** The smallest collateral (whole €) that meets the targets on every day in `days`, or null when none does. */
  function solve(days, p, targets) {
    if (!p.markets) return solve(days, fromTwoMarkets(p), targetsFromTwoMarkets(targets));
    let hi = SEARCH_START;
    while (!meetsTargets(hi, days, p, targets)) {
      hi *= 2;
      if (hi > SEARCH_LIMIT) return null;
    }
    if (meetsTargets(0, days, p, targets)) return 0;
    let lo = 0;
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      if (meetsTargets(mid, days, p, targets)) hi = mid;
      else lo = mid;
    }
    const rounded = Math.round(hi);
    return meetsTargets(rounded, days, p, targets) ? rounded : Math.ceil(hi);
  }

  /* Which day and market bind at collateral C: the smallest headroom against a target, as { h, market, date }, with
     `calc` (the calculation day) for auctions. market is the market id or 'base'; with the two-market form, 'cont',
     'da' or 'base'. */
  function binding(C, days, p, targets) {
    const twoMarkets = !p.markets;
    const markets = twoMarkets ? fromTwoMarkets(p).markets : p.markets;
    const byId = twoMarkets ? targetsFromTwoMarkets(targets) : targets;
    const params = { C, OR: p.OR, markets };
    let best = null;
    for (const t of days) {
      const r = calc(t, params);
      for (const { id } of markets) {
        const target = byId[id];
        if (!target || !(target.limit > 0)) continue;
        const market = twoMarkets ? TWO_MARKET_NAMES[id] : id;
        eachTargetLimit(r, id, target, (limit, date) => {
          const h = limit - target.limit;
          if (!best || h < best.h)
            best = r.markets[id].auctions ? { h, market, date, calc: r.date } : { h, market, date };
        });
      }
      const h = C - r.blr;
      if (!best || h < best.h) best = { h, market: 'base', date: r.date };
    }
    return best;
  }

  /** The smallest whole-% key with which market `id` meets its target at collateral C (Infinity if 100% is not
   *  enough). */
  function minKey(C, days, p, targets, id) {
    const target = targets[id];
    if (!target || !(target.limit > 0)) return 0;
    const withKey = (key) => ({
      OR: p.OR,
      markets: p.markets.map((spec) => (spec.id === id ? { id: spec.id, bd: spec.bd, nbd: spec.nbd, key } : spec)),
    });
    const meetsAt = (key) => meetsTargets(C, days, withKey(key), { [id]: target });
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

  /* The split closest to the member's own: markets below their minimum key are raised to it, and the others give the
     excess back in proportion to their spare share (largest remainder, ties to the earlier market). With two markets
     this is the nearest split. */
  function nearestSplit(own, minKeys) {
    const raised = own.map((key, i) => Math.max(key, minKeys[i]));
    const excess = sum(raised) - 100;
    if (excess <= 0) return raised;
    const spare = raised.map((key, i) => key - minKeys[i]);
    const totalSpare = sum(spare);
    const exact = spare.map((s) => (s * excess) / totalSpare);
    const take = exact.map((x) => Math.floor(x));
    let left = excess - sum(take);
    const byRemainder = exact.map((_, i) => i).sort((a, b) => exact[b] - take[b] - (exact[a] - take[a]) || a - b);
    for (const i of byRemainder) {
      if (left > 0 && take[i] < spare[i]) {
        take[i]++;
        left--;
      }
    }
    return raised.map((key, i) => key - take[i]);
  }

  /* The split (whole %) that needs the least collateral, and that collateral; null when no split reaches the targets.
     Because each market's limits depend only on its own key, collateral C works with some split exactly when the
     markets' minimum keys at C add up to 100% or less. Bisect on C, then place the leftover % as close to the member's
     own split (p's keys) as possible.
     Returns { keys: { <id>: % }, C }, or { key: continuous %, C } with the two-market form. */
  function cheapestKey(days, p, targets) {
    if (!p.markets) {
      const q = fromTwoMarkets(p);
      q.markets[1].key = 100 - q.markets[0].key;
      const found = cheapestKey(days, q, targetsFromTwoMarkets(targets));
      return found && { key: found.keys[CONT], C: found.C };
    }
    const own = p.markets.map((spec) => spec.key);
    if (sum(own) !== 100) throw new Error('Keys must add up to 100');
    // The minimum key of each market at collateral C, or null when no split works with C.
    const minKeysAt = (C) => {
      if (!meetsTargets(C, days, p, {})) return null; // the base limits are not covered
      const keys = p.markets.map((spec) => minKey(C, days, p, targets, spec.id));
      return sum(keys) <= 100 ? keys : null;
    };
    let hi = SEARCH_START;
    while (!minKeysAt(hi)) {
      hi *= 2;
      if (hi > SEARCH_LIMIT) return null;
    }
    let C = 0;
    if (!minKeysAt(0)) {
      let lo = 0;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (minKeysAt(mid)) hi = mid;
        else lo = mid;
      }
      C = hi;
    }
    const keys = nearestSplit(own, minKeysAt(C));
    return { keys: Object.fromEntries(p.markets.map((spec, i) => [spec.id, keys[i]])), C };
  }

  return {
    day,
    week,
    weekDays,
    snapToBD,
    solve,
    binding,
    cheapestKey,
    parse,
    iso,
    isBD,
    nextBD,
    prevBD,
    holidayName,
    HOLIDAYS,
    MARKETS,
    MIN_DATE,
    MAX_DATE,
  };
})();
if (typeof module !== 'undefined') module.exports = LimitEngine;
