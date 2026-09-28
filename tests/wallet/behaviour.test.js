// behaviour.js: auction order exposure and the daily flows of a trading plan (docs/wallet-model.md §2, §6).
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../src/wallet/behaviour.js');
const { assertMoney } = require('../helpers.js');
const { WORKED_EXAMPLE_PLAN: plan } = require('./fixtures.js');

test('auction order exposure (Manual §3.10): the largest price × quantity, only if positive', () => {
  const noRange = { maxMarket: 4000, minMarket: -500 }; // test values only: the page has no built-in prices
  const range = { ...noRange, minReal: -20, maxReal: 500 };
  const exposure = (mwh, price, prices = noRange) => B.orderExposure([{ mwh, price }], prices);
  assertMoney(
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
  assertMoney(exposure(100, null), 400000, 'a buy without limit price, at the market maximum');
  assertMoney(exposure(100, null, range), 50000, 'a buy without limit price, at the maximum realistic price');
  assertMoney(exposure(100, 3000, range), 50000, 'a buy above the realistic range is capped');
  assertMoney(exposure(-100, -50), 5000, 'a sell at a negative price has positive exposure');
  assertMoney(exposure(-100, -50, range), 2000, 'a sell below the minimum realistic price counts only down to it');
  assertMoney(exposure(-100, 60), 0, 'a sell at a positive price has no exposure');
  assertMoney(exposure(-100, null), 50000, 'a sell without limit price, at the market minimum (INTERPRETATION)');
  assert.throws(() => exposure(100, null, {}), Error, 'no market maximum set for an order without limit price');
  assert.throws(() => exposure(100, 50, { minReal: 10, maxReal: 5 }), Error, 'a realistic range with min ≥ max');
});

test('the daily flows of the worked example (docs/wallet-model.md §8)', () => {
  const typical = B.dayFlows(plan, 1, true);
  assertMoney(typical.cont.risk, 18480, 'continuous value that uses limit, per day');
  assertMoney(typical.auc.exposure, 15000, 'auction exposure per day');
  assertMoney(typical.tradeNet, 0, 'flat: buys and sells net to zero');
  assertMoney(typical.net, 0.05 * 340 * 80, 'the net includes the loss share of gross buys');
  const stress = B.dayFlows(plan, 250 / 80, true);
  assertMoney(stress.cont.risk, 57750, 'stress: continuous value that uses limit, per day');
  assertMoney(stress.net, 4250, 'stress: 5% of 340 MWh × €250');
  const idle = B.dayFlows(plan, 1, false);
  assert.ok(!idle.traded && idle.net === 0 && idle.auc.exposure === 0, 'no trading on a day that is not traded');
});

test('a day with only negative prices: buying earns money, so the day nets to a credit', () => {
  const negative = { price: 80, negShare: 1, negPrice: -30, cont: { buy: 100, sell: 0 }, auc: { buy: 0, sell: 0 } };
  const flows = B.dayFlows(negative, 1, true);
  assertMoney(flows.tradeNet, -3000, 'buying 100 MWh at −€30 is a credit of €3,000');
  assertMoney(flows.cont.risk, 0, 'buying at negative prices uses no limit');
});
