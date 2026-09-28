// The trading plan of the worked example (docs/wallet-model.md §8): a financial trader that buys and sells 240 MWh a
// day on M7 and 100 MWh in the auctions, at a typical price of €80/MWh.
const WORKED_EXAMPLE_PLAN = Object.freeze({
  price: 80,
  negShare: 0.05,
  negPrice: -20,
  cont: { buy: 240, sell: 240 },
  auc: { buy: 100, sell: 100, limitPrice: 150 },
  lossShare: 0.05,
});

module.exports = { WORKED_EXAMPLE_PLAN };
