/* Direct+ wallet: date helpers shared by the wallet modules. Dates are UTC midnights, as in the engine; its parse()
   and iso() convert them to and from ISO strings. */
const WalletDates = (() => {
  'use strict';

  const DAY_MS = 86400000;

  const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
  const daysBetween = (from, to) => Math.round((to - from) / DAY_MS);

  /** The Monday of the week that holds `date`. */
  const mondayOf = (date) => addDays(date, -((date.getUTCDay() + 6) % 7));

  /** Orders ISO dates or date-times ('2026-10-05 18:00'), for sort(). */
  const compareIso = (a, b) => Number(a > b) - Number(a < b);

  /** Every date from `from` to `to`, both included. */
  function* eachDay(from, to) {
    for (let day = from; day <= to; day = addDays(day, 1)) yield day;
  }

  return { DAY_MS, addDays, daysBetween, mondayOf, compareIso, eachDay };
})();
if (typeof module !== 'undefined') module.exports = WalletDates;
