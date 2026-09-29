/* Direct+ wallet: the open-position buffer (docs/wallet-model.md §4.5). A trader who ends every quarter-hour flat adds
   nothing under TenneT's formula, yet it can leave a position open, and the Direct+ BRP is then settled at TenneT's
   imbalance price. ECC's limits don't catch it: a sale uses no limit (ECC manual §3.11). So Direct+ members also cover
   what they may leave open: option 1 of the paper "Covering open-position risk in the Direct+ BRP" (draft, 26 Sep 2026).
     S = E_cap × T × P_stress
     E_cap     the most energy a day Direct+ lets the member leave open (MWh a day), monitored and enforced
     T         the days at risk before Direct+ can act: one (Direct+ decision, 29 Sep 2026; the paper has three)
     P_stress  a high percentile of the day's imbalance price in 2025, or of its spread over the day-ahead price
               (MEASURES): the top end for an open short, max(0, −bottom end) for an open long, whichever is larger
   Per day, not per quarter-hour: a position open for a day spreads over its quarter-hours, which averages out single
   spikes (2025: the worst quarter-hour's imbalance price was about €5,500/MWh, the worst day's €286). */
const WalletOpenPosition = (() => {
  'use strict';

  /* What the stress price measures, with the words the pages use:
       price   the imbalance price, at which TenneT settles what is left open
       spread  the imbalance price minus the day-ahead price: what an open short loses beyond the day-ahead price it
               sold at, or an open long below the price it bought at, as long as the trade's own money stays in the
               wallet until TenneT settles (the paper's option 3). It assumes the position was traded at day-ahead. */
  const MEASURES = {
    price: {
      label: 'The imbalance price',
      name: 'the imbalance price',
      of: "2025's daily imbalance prices",
      short: 'what an open short pays',
      long: 'what an open long loses',
    },
    spread: {
      label: 'The spread between the imbalance and day-ahead prices',
      name: 'the spread over day-ahead',
      of: "2025's daily spread between the imbalance and day-ahead prices",
      short: 'what an open short loses over the day-ahead price it sold at',
      long: 'what an open long loses under the day-ahead price it bought at',
    },
  };

  /* 2025 per local day, €/MWh: TenneT's final imbalance prices (its settlement-price export) averaged over the day's
     quarter-hours, and their spread over ENTSO-E's NL day-ahead price in the same quarter-hours. Percentiles over the
     365 days, linear between days (numpy's default). A short BRP pays the shortage price, so `short` is the top end; a
     long BRP receives the surplus price, so `long` is the mirror percentile of the bottom end (the 1st for the 99th).
     tests/wallet/open-position.test.js recomputes them from
     reference/tennet/tennet-entsoe_imbalance-and-day-ahead-prices-2025_daily-averages_2026-09-29.csv. */
  const TABLE = [
    // id, label, price: short, long, spread: short, long
    ['p90', '90th percentile', 146.24, 20.16, 48.82, -49.99],
    ['p95', '95th percentile', 178.06, 8.13, 75.94, -58.39],
    ['p97.5', '97.5th percentile', 204.2, -4.6, 109.71, -70.95],
    ['p98', '98th percentile', 220.63, -7.53, 120.1, -74.77],
    ['p99', '99th percentile', 255.86, -37.78, 162.62, -87.89],
    ['p99.5', '99.5th percentile', 274.73, -46.54, 183.87, -95.11],
    ['max', 'Worst day', 286.42, -70.44, 210.52, -142.72],
  ];
  const PERCENTILES = TABLE.map(([id, label, priceShort, priceLong, spreadShort, spreadLong]) => ({
    id,
    label,
    price: { short: priceShort, long: priceLong },
    spread: { short: spreadShort, long: spreadLong },
  }));
  const DEFAULT_PERCENTILE = 'p99';
  const DEFAULT_MEASURE = 'price';

  /** The stress price at percentile `id` of `measure`, €/MWh: what an open short or an open long loses, whichever is
   *  more; with the words for the pages. */
  function stressPrice(id = DEFAULT_PERCENTILE, measure = DEFAULT_MEASURE) {
    const level = PERCENTILES.find((one) => one.id === id);
    if (!level) throw new Error(`No percentile "${id}" for the open-position buffer`);
    const words = MEASURES[measure];
    if (!words) throw new Error(`No stress price measure "${measure}" for the open-position buffer`);
    const { short, long } = level[measure];
    const longLoss = Math.max(0, -long);
    const side = short >= longLoss ? 'short' : 'long';
    return {
      id,
      label: level.label,
      measure,
      measureName: words.name,
      short,
      long,
      longLoss,
      price: Math.max(short, longLoss),
      side,
      description: `the ${level.label.toLowerCase()} of ${words.of}`,
      loses: words[side],
    };
  }

  /** The buffer for `cap` MWh a day left open, `days` days at risk, at percentile `percentile` of `measure`: amount =
   *  S, €. */
  function buffer({ cap = 0, days = 1, percentile = DEFAULT_PERCENTILE, measure = DEFAULT_MEASURE }) {
    const stress = stressPrice(percentile, measure);
    return { cap, days, ...stress, amount: cap * days * stress.price };
  }

  return { MEASURES, PERCENTILES, DEFAULT_PERCENTILE, DEFAULT_MEASURE, stressPrice, buffer };
})();
if (typeof module !== 'undefined') module.exports = WalletOpenPosition;
