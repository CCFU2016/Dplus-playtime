/* Direct+ wallet: the open-position buffer (docs/wallet-model.md §4.5). A trader who ends every quarter-hour flat adds
   nothing under TenneT's formula, yet it can leave a position open, and the Direct+ BRP is then settled at TenneT's
   imbalance price. ECC's limits don't catch it: a sale uses no limit (ECC manual §3.11). So Direct+ members also cover
   what they may leave open: option 1 of the paper "Covering open-position risk in the Direct+ BRP" (draft, 26 Sep 2026).
     S = E_cap × T × P_stress
     E_cap     the most energy a day Direct+ lets the member leave open (MWh a day), monitored and enforced
     T         the days at risk before Direct+ can act: one (Direct+ decision, 29 Sep 2026; the paper has three)
     P_stress  a high percentile of TenneT's imbalance prices in 2025, averaged per day: the top end of the price an
               open short pays, or max(0, −bottom end) of the price an open long receives, whichever is larger
   Per day, not per quarter-hour: a position open for a day spreads over its quarter-hours, which averages out single
   spikes (2025: the worst quarter-hour was about €5,500/MWh, the worst day €286). */
const WalletOpenPosition = (() => {
  'use strict';

  /* TenneT's final imbalance prices for 2025 (its settlement-price export), averaged over each local day's
     quarter-hours, €/MWh: percentiles over the 365 days, linear between days (numpy's default). A short BRP pays the
     shortage price, `short` is its top end; a long BRP receives the surplus price, `long` is the mirror percentile of
     its bottom end (the 1st for the 99th). tests/wallet/open-position.test.js recomputes them from
     reference/tennet/tennet_imbalance-prices-2025_daily-averages_2026-09-29.csv. */
  const PERCENTILES = [
    { id: 'p90', label: '90th percentile', short: 146.24, long: 20.16 },
    { id: 'p95', label: '95th percentile', short: 178.06, long: 8.13 },
    { id: 'p97.5', label: '97.5th percentile', short: 204.2, long: -4.6 },
    { id: 'p98', label: '98th percentile', short: 220.63, long: -7.53 },
    { id: 'p99', label: '99th percentile', short: 255.86, long: -37.78 },
    { id: 'p99.5', label: '99.5th percentile', short: 274.73, long: -46.54 },
    { id: 'max', label: 'The worst day', short: 286.42, long: -70.44 },
  ];
  const DEFAULT_PERCENTILE = 'p99';

  /** The stress price at percentile `id`, €/MWh: what an open short pays or an open long loses, whichever is more;
   *  with its source in words for the pages. */
  function stressPrice(id = DEFAULT_PERCENTILE) {
    const level = PERCENTILES.find((one) => one.id === id);
    if (!level) throw new Error(`No imbalance price percentile "${id}" for the open-position buffer`);
    const longLoss = Math.max(0, -level.long);
    return {
      ...level,
      longLoss,
      price: Math.max(level.short, longLoss),
      side: level.short >= longLoss ? 'short' : 'long',
      description:
        id === 'max' ? "2025's worst day for imbalance prices" : `the ${level.label} of 2025's daily imbalance prices`,
    };
  }

  /** The buffer for `cap` MWh a day left open, `days` days at risk, at percentile `percentile`: amount = S, €. */
  function buffer({ cap = 0, days = 1, percentile = DEFAULT_PERCENTILE }) {
    const stress = stressPrice(percentile);
    return { cap, days, ...stress, amount: cap * days * stress.price };
  }

  return { PERCENTILES, DEFAULT_PERCENTILE, stressPrice, buffer };
})();
if (typeof module !== 'undefined') module.exports = WalletOpenPosition;
