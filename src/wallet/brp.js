/* Direct+ wallet: BRP security for TenneT under art. 10.8, the rule in force and the ACM draft (docs/wallet-model.md §4).
   Each member is treated as its own BRP (wallet-model §4.4).
   Sources: reference/tennet/systeemcode-elektriciteit_wetten-overheid_art-10.8-10.26-10.27-10.29_2026-09-26.txt
   (SC 2026) and reference/tennet/acm-25-196985_gecorrigeerd-ontwerpbesluit_2026-08-25.pdf (ACM draft). */
const WalletBrp = (() => {
  'use strict';

  const RULES = {
    // Systeemcode elektriciteit 2026, art. 10.8: the rule in force
    current: {
      priceFloor: 40, // art. 10.8(4) and (12): "met een ondergrens van € 40 per MWh"
      volumeFloorMW: 50, // art. 10.8(3), (6) and (11): "met een ondergrens van 50 MW"
      hours: 24, // art. 10.8(11): "vermenigvuldigd met 24"
      // art. 10.8(8)-(9): each class counts at "de laagste capaciteit van die klasse"; above 50 MW the actual capacity
      // counts, art. 10.8(10)
      classes: [
        { from: 2, to: 10 },
        { from: 11, to: 25 },
        { from: 26, to: 50 },
      ],
      flatMinimum: 96000, // on TenneT's BRP page only: INTERPRETATION, a flat minimum (open question W8)
    },
    // ACM draft decision ACM/25/196985 of 25 Aug 2026, art. 10.8: in force from 1 January 2027 once final
    draft: {
      from: '2027-01-01', // Artikel II B
      weights: { A: 3, B: 4, C: 6, D: 6 }, // art. 10.8(7): "de som 3A + 4B + 6C + 6D"
      minimum: 96000, // art. 10.8(7): "een minimumbedrag van € 96.000,-"
      weeksB: 10, // art. 10.8(3a): "referentieperiode van tien weken"
      sigmaB: 2, // art. 10.8(3b): "twee maal de standaarddeviatie"
      monthsCD: 12, // art. 10.8(4a) and (5a): "referentieperiode van twaalf maanden"
      sigmaCD: 0.5, // art. 10.8(4b) and (5b): "een half maal de standaarddeviatie"
      missing: 0, // art. 10.8(6): "een fictieve factuur van € 0,-"
    },
  };

  // The draft rule for a new member, month by month (rampUp).
  const RAMP_MONTHS = 18;
  const DEFAULT_LAG_WEEKS = 4; // the first weekly invoice about four weeks after delivery (ACM draft para 15)
  const PROFILE_LAG_MONTHS = 5; // month M's profile reconciliation is paid in month M + 5 (SC 2026 art. 10.26(4)-(5))
  const SMART_LAG_MONTHS = 6; // month M's smart-meter reconciliation on the first working day of M + 6 (art. 10.27(13))

  /** The rule for a week that starts on `iso`: 'current' or 'draft' as chosen, or by date when `choice` is 'auto'. */
  function ruleFor(iso, choice = 'auto') {
    if (choice !== 'auto') return choice;
    return iso >= RULES.draft.from ? 'draft' : 'current';
  }

  /* One connection's capacity as the current rule counts it (art. 10.8(8)-(10)). INTERPRETATION: under 2 MW counts
     nothing, and a capacity between two classes (e.g. 10.5 MW) counts in the lower class ('down', the default) or in
     the higher one ('up'). */
  function countedMW(mw, between) {
    const { classes } = RULES.current;
    for (const [i, cls] of classes.entries()) {
      if (mw < cls.from) {
        if (i === 0) return 0;
        return between === 'up' ? cls.from : classes[i - 1].from;
      }
      if (mw <= cls.to) return cls.from;
    }
    return mw;
  }

  /** Counted capacity (MW) of the large connections, for component B of the current rule. */
  function countedCapacity(capacities, between = 'down') {
    let total = 0;
    for (const mw of capacities) total += countedMW(mw, between);
    return total;
  }

  /**
   * The rule in force (SC 2026 art. 10.8) for an expected highest daily net volume.
   *   volume      the expected highest daily net volume, MWh
   *   price3m     the average market price over three months, €/MWh; the €40 floor always applies
   *   capacityMW  the counted capacity of the large connections (countedCapacity())
   *   reading     INTERPRETATION of the 50 MW floor (wallet-model §4.1): '1200' (default), 50 MW × 24 h = 1,200 MWh on
   *               both A and B; or 'flat', no volume floors and a €96,000 minimum on the total
   *   floors      false for a Direct+ member's marginal collateral: no volume floors and no minimum, never below €0
   * A is set as for a first recognition (para 3). Aup and Adown are A as TenneT recalculates it at its own request
   * (para 5: the highest daily volume, with no floor) and at the BRP's (para 6: the average daily volume, with the
   * floor). With one expected volume for every day, Adown is A again.
   */
  function current({ volume, price3m, capacityMW = 0, reading = '1200', floors = true }) {
    const { priceFloor, volumeFloorMW, hours, flatMinimum } = RULES.current;
    const flat = reading === 'flat';
    const volumeFloor = flat || !floors ? 0 : volumeFloorMW * hours;
    const price = Math.max(price3m, priceFloor);
    const flooredVolume = Math.max(volume || 0, volumeFloor);
    const A = flooredVolume * price;
    const B = Math.max(capacityMW * hours, volumeFloor) * price;
    const twoA = 2 * A >= B;
    let security = twoA ? 2 * A : A + B;
    if (!floors) security = Math.max(security, 0);
    else if (flat) security = Math.max(security, flatMinimum);
    return { rule: 'current', volume: flooredVolume, price, A, B, twoA, security, Aup: volume * price, Adown: A };
  }

  /**
   * Mean and standard deviation over the last `n` invoices (oldest first), € (+ the BRP pays). Missing invoices count
   * as €0 (ACM draft art. 10.8(6)). sigma: 'population' (the default) or 'sample', an INTERPRETATION.
   */
  function stats(values, n, sigma) {
    const window = values.slice(-n);
    while (window.length < n) window.unshift(RULES.draft.missing);
    let mean = 0;
    for (const value of window) mean += value;
    mean /= n;
    let squares = 0;
    for (const value of window) squares += (value - mean) * (value - mean);
    return { mean, sd: Math.sqrt(squares / (sigma === 'sample' ? n - 1 : n)) };
  }

  /** Component B of the draft from the weekly imbalance invoices (oldest first): mean + 2σ over ten weeks. Components
   *  are not floored (proposal p.8). */
  function componentB(weekly, sigma) {
    const { mean, sd } = stats(weekly, RULES.draft.weeksB, sigma);
    return mean + RULES.draft.sigmaB * sd;
  }

  /**
   * The ACM draft (art. 10.8(7)): 3A + 4B + 6C + 6D, with a €96,000 minimum. All amounts in €.
   *   A        the highest daily net volume over two months × the average day-ahead price over two months
   *   B, C, D  the imbalance, profile reconciliation and smart-meter reconciliation components
   *   minimum  false for a Direct+ member's marginal collateral: no minimum, and never below €0 (ASSUMPTION)
   */
  function draft({ A = 0, B = 0, C = 0, D = 0, minimum = true }) {
    const { weights } = RULES.draft;
    const sum = weights.A * A + weights.B * B + weights.C * C + weights.D * D;
    return { rule: 'draft', A, B, C, D, sum, security: Math.max(sum, minimum ? RULES.draft.minimum : 0) };
  }

  /* A component while its window fills up: `count` real invoices of mean μ and deviation σ among `n` (the rest count
     €0), taken at its expected mean and spread: p·μ + factor·√(p(σ² + μ²) − (p·μ)²), with p = count / n. With σ = 0
     this is exactly stats() on `count` copies of μ and n − count zeros. */
  function expectedComponent(count, n, mean, sd, factor, sigma) {
    const p = count / n;
    let variance = Math.max(0, p * (sd * sd + mean * mean) - p * mean * p * mean);
    if (sigma === 'sample') variance = (variance * n) / (n - 1);
    return p * mean + factor * Math.sqrt(variance);
  }

  /**
   * The draft rule for a new member, months 1 to 18 (wallet-model §4.2). Delivery starts at the beginning of month 1,
   * and TenneT recalculates at the start of each month (ASSUMPTION: the texts do not give the day).
   *   A                              from month 2, when there is a realised volume
   *   weekly, weeklySd               mean and σ of one weekly imbalance invoice, the first about lagWeeks after delivery
   *   profile, profileSd, smart, smartSd   the same for one monthly reconciliation invoice
   *   sigma, minimum                 as for stats() and draft()
   * Returns { months, peak }: each month's draft() with its month number and the real invoices in each window.
   */
  function rampUp({
    A = 0,
    weekly = 0,
    weeklySd = 0,
    profile = 0,
    profileSd = 0,
    smart = 0,
    smartSd = 0,
    sigma,
    minimum = true,
    lagWeeks = DEFAULT_LAG_WEEKS,
  }) {
    const { weeksB, sigmaB, monthsCD, sigmaCD } = RULES.draft;
    const months = [];
    let peak = null;
    for (let month = 1; month <= RAMP_MONTHS; month++) {
      const delivered = month - 1; // whole months delivered before this month's recalculation
      const deliveredWeeks = Math.floor((delivered * 52) / 12);
      const invoices = {
        B: Math.min(Math.max(0, deliveredWeeks - lagWeeks), weeksB),
        C: Math.min(Math.max(0, delivered - PROFILE_LAG_MONTHS), monthsCD),
        D: Math.min(Math.max(0, delivered - SMART_LAG_MONTHS), monthsCD),
      };
      const security = draft({
        A: delivered > 0 ? A : 0,
        B: expectedComponent(invoices.B, weeksB, weekly, weeklySd, sigmaB, sigma),
        C: expectedComponent(invoices.C, monthsCD, profile, profileSd, sigmaCD, sigma),
        D: expectedComponent(invoices.D, monthsCD, smart, smartSd, sigmaCD, sigma),
        minimum,
      });
      const row = { ...security, month, invoices };
      months.push(row);
      if (!peak || row.security > peak.security) peak = row;
    }
    return { months, peak };
  }

  return { RULES, ruleFor, countedCapacity, current, stats, componentB, draft, rampUp };
})();
if (typeof module !== 'undefined') module.exports = WalletBrp;
