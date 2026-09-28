// behaviour.js: auction order exposure and the daily flows of a trading plan (docs/wallet-model.md §2, §6).
const B = require('../../src/wallet/behaviour.js');
const { WORKED_EXAMPLE_PLAN: plan } = require('./fixtures.js');
const T = require('./assert.js')('behaviour');

// Auction order exposure (Manual §3.10): the largest price × quantity on the curve, only if positive.
const noRange = { maxMarket: 4000, minMarket: -500 }; // test values only: the page has no built-in prices
const range = { maxMarket: 4000, minMarket: -500, minReal: -20, maxReal: 500 };
T.money(
  B.orderExposure(
    [
      { mwh: 100, price: 150 },
      { mwh: 150, price: 80 },
    ],
    noRange,
  ),
  15000,
  'buy curve: max of p × q',
);
T.money(B.orderExposure([{ mwh: 100, price: null }], noRange), 400000, 'buy without limit price at the market maximum');
T.money(
  B.orderExposure([{ mwh: 100, price: null }], range),
  50000,
  'buy without limit price at the maximum realistic price',
);
T.money(B.orderExposure([{ mwh: 100, price: 3000 }], range), 50000, 'buy above the realistic range is capped');
T.money(B.orderExposure([{ mwh: -100, price: -50 }], noRange), 5000, 'sell at a negative price has positive exposure');
T.money(
  B.orderExposure([{ mwh: -100, price: -50 }], range),
  2000,
  'sell below the minimum realistic price counts only down to it',
);
T.money(B.orderExposure([{ mwh: -100, price: 60 }], noRange), 0, 'sell at a positive price has no exposure');
T.money(
  B.orderExposure([{ mwh: -100, price: null }], noRange),
  50000,
  'sell without limit price at the market minimum (INTERPRETATION)',
);
T.throws(
  () => B.orderExposure([{ mwh: 100, price: null }], {}),
  'no market maximum set for an order without limit price',
);
T.throws(
  () => B.orderExposure([{ mwh: 100, price: 50 }], { minReal: 10, maxReal: 5 }),
  'realistic range with min ≥ max',
);

// Daily flows: the financial-trader example (docs/wallet-model.md §8).
let f = B.dayFlows(plan, 1, true);
T.money(f.cont.risk, 18480, 'FT continuous risk-bearing value per day');
T.money(f.auc.exposure, 15000, 'FT auction exposure per day');
T.money(f.tradeNet, 0, 'FT flat: buys and sells net to zero');
T.money(f.net, 0.05 * 340 * 80, 'FT net includes the loss share of gross buys');
f = B.dayFlows(plan, 250 / 80, true);
T.money(f.cont.risk, 57750, 'FT stress risk-bearing value per day');
T.money(f.net, 4250, 'FT stress: 5% of 340 MWh × €250');
f = B.dayFlows(plan, 1, false);
T.ok(!f.traded && f.net === 0 && f.auc.exposure === 0, 'no trading on a day that is not traded');
// A day with only negative prices: buying earns money, so the day nets to a credit.
f = B.dayFlows(
  { price: 80, negShare: 1, negPrice: -30, cont: { buy: 100, sell: 0 }, auc: { buy: 0, sell: 0 } },
  1,
  true,
);
T.money(f.tradeNet, -3000, 'buying 100 MWh at −€30 is a credit of €3,000');
T.money(f.cont.risk, 0, 'buying at negative prices uses no limit');

T.done();
