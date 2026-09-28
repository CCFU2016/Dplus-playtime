/* Direct+ wallet: the member's TenneT account: the weekly imbalance invoice, the day TenneT debits it, and how long the
   security stays committed after the member stops (docs/wallet-model.md §5 and §6.2). Each member pays its own
   invoices, as if it were its own BRP.
   Sources: SC 2026 art. 10.26, 10.27 and 10.29 (reference/tennet/systeemcode-elektriciteit_wetten-overheid_…txt); ACM
   draft ACM/25/196985 art. 10.8(9)-(10), amended 10.26(5)-(6) and 10.27(13)-(14), explanatory paras 15-17. */
const WalletTennet = ((Engine, Dates, Brp) => {
  'use strict';

  const DEFAULT_LAG_WEEKS = 4; // ACM draft para 15: "Tussen het moment van levering en facturatie zitten vier weken."

  // The stress end of component B (stressB)
  const STRESS_SEED = 20260926;
  const STRESS_RUNS = 10000;
  const STRESS_QUANTILE = 0.95;

  // After the member stops (exitTail)
  const EXIT_IMBALANCE_DAYS = 28; // the last imbalance invoice, about four weeks after delivery (ACM draft para 15)
  const EXIT_SMART_MONTHS = 6; // smart-meter and telemetry reconciliation (para 17)
  const EXIT_PROFILE_MONTHS = 21; // profile reconciliation (para 16)

  // ---------- Dutch working days ----------
  // TenneT's deadlines count Dutch working days, not ECC's T2 days. The holidays are those of the Algemene termijnenwet
  // (art. 3): New Year's Day, Easter Monday, King's Day (27 April, or 26 April when that is a Sunday), 5 May, Ascension
  // Day, Whit Monday, Christmas Day and Boxing Day. To be confirmed with TenneT (open question W7).

  /** Easter Sunday of `year`: the anonymous Gregorian algorithm, with its customary variable names. */
  function easter(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }

  const holidaysByYear = new Map();

  /** The Dutch public holidays of `year`, as { isoDate: name }. */
  function holidays(year) {
    if (!holidaysByYear.has(year)) {
      const easterSunday = easter(year);
      const afterEaster = (days) => Engine.iso(Dates.addDays(easterSunday, days));
      let kingsDay = new Date(Date.UTC(year, 3, 27));
      if (kingsDay.getUTCDay() === 0) kingsDay = new Date(Date.UTC(year, 3, 26));
      holidaysByYear.set(year, {
        [`${year}-01-01`]: 'Nieuwjaarsdag',
        [afterEaster(1)]: 'Tweede Paasdag',
        [Engine.iso(kingsDay)]: 'Koningsdag',
        [`${year}-05-05`]: 'Bevrijdingsdag',
        [afterEaster(39)]: 'Hemelvaartsdag',
        [afterEaster(50)]: 'Tweede Pinksterdag',
        [`${year}-12-25`]: 'Eerste Kerstdag',
        [`${year}-12-26`]: 'Tweede Kerstdag',
      });
    }
    return holidaysByYear.get(year);
  }

  function isWorkday(date) {
    const weekday = date.getUTCDay();
    return weekday !== 0 && weekday !== 6 && !holidays(date.getUTCFullYear())[Engine.iso(date)];
  }

  function workdayOnOrAfter(date) {
    let day = date;
    while (!isWorkday(day)) day = Dates.addDays(day, 1);
    return day;
  }

  // ---------- the weekly imbalance invoice ----------

  /**
   * The day TenneT debits the weekly imbalance invoice for the delivery week that starts on `weekStart` (a Monday).
   * The debit day is in TenneT's billing terms, not in the texts (open question W7). ASSUMPTION: the first working
   * day on or after the end of the delivery week plus `lagWeeks`.
   */
  function imbalanceDebit(weekStart, lagWeeks = DEFAULT_LAG_WEEKS) {
    const due = Dates.addDays(Engine.parse(weekStart), 7 + 7 * lagWeeks);
    return Engine.iso(workdayOnOrAfter(due));
  }

  /**
   * The weekly imbalance invoice as a normal distribution (wallet-model §6.2). A normal model understates the tails of
   * NL imbalance prices, and the page says so.
   *   volume       MWh a week that the imbalance is measured against (traded, nominated or produced)
   *   share        the imbalance as a share of that volume
   *   bias         −1 always long … +1 always short: short pays the imbalance price, long receives it (art. 10.29)
   *   price        the typical imbalance price, €/MWh
   *   state2Share, state2Gap  the share of periods with dual pricing (regulation state 2), and the gap between the
   *                short and long prices then, €/MWh (art. 10.29(4))
   *   cv           σ of the invoice as a multiple of the imbalance value
   *   shortVolume  MWh a week that is always short, such as an aggregator's non-delivery
   * Returns { volume, delta, mean, sd, B }: MWh a week, € per MWh of dual pricing, and € a week. B is component B of
   * the draft when every weekly invoice follows this distribution: the mean plus two standard deviations.
   */
  function weekly({ volume, share, bias = 0, price, state2Share = 0, state2Gap = 0, cv = 0.5, shortVolume = 0 }) {
    const imbalance = volume * share;
    const delta = state2Share * state2Gap;
    const mean = imbalance * (bias * price + ((1 - Math.abs(bias)) * delta) / 2) + shortVolume * price;
    const sd = cv * (imbalance + shortVolume) * price;
    return { volume: imbalance + shortVolume, delta, mean, sd, B: mean + Brp.RULES.draft.sigmaB * sd };
  }

  /** A seeded pseudo-random generator (mulberry32) of numbers in [0, 1), so the stress end is reproducible. */
  function mulberry32(seed) {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * The stress end of component B: its 95th percentile over simulated ten-week windows of weekly invoices, each drawn
   * from N(mean, sd). Seeded, so the same inputs always give the same amount. sigma: as for WalletBrp.stats().
   */
  function stressB(mean, sd, { sigma, seed = STRESS_SEED } = {}) {
    const random = mulberry32(seed);
    const normal = () => {
      // Box-Muller
      const u = 1 - random();
      const v = random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const outcomes = [];
    for (let run = 0; run < STRESS_RUNS; run++) {
      const invoices = Array.from({ length: Brp.RULES.draft.weeksB }, () => mean + sd * normal());
      outcomes.push(Brp.componentB(invoices, sigma));
    }
    outcomes.sort((a, b) => a - b);
    return outcomes[Math.min(STRESS_RUNS - 1, Math.floor(STRESS_QUANTILE * STRESS_RUNS))];
  }

  // ---------- after the member stops ----------

  /**
   * When the security is released after the member stops on `stop` (draft art. 10.8(10c); proposal BR-2024-2077
   * p.2): once the last invoices are settled. `profile` and `smart` say whether the member's connections have those
   * reconciliations. Returns ISO dates: { imbalance, smart?, profile?, released }.
   */
  function exitTail(stop, { profile = false, smart = false } = {}) {
    const date = Engine.parse(stop);
    const monthsLater = (months) =>
      Engine.iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate())));
    const tail = { imbalance: Engine.iso(Dates.addDays(date, EXIT_IMBALANCE_DAYS)) };
    if (smart) tail.smart = monthsLater(EXIT_SMART_MONTHS);
    if (profile) tail.profile = monthsLater(EXIT_PROFILE_MONTHS);
    const released = Object.values(tail).reduce((latest, day) => (day > latest ? day : latest));
    return { ...tail, released };
  }

  return { isWorkday, imbalanceDebit, weekly, mulberry32, stressB, exitTail };
})(
  typeof LimitEngine !== 'undefined' ? LimitEngine : require('../engine.js'),
  typeof WalletDates !== 'undefined' ? WalletDates : require('./dates.js'),
  typeof WalletBrp !== 'undefined' ? WalletBrp : require('./brp.js'),
);
if (typeof module !== 'undefined') module.exports = WalletTennet;
