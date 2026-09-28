/* Direct+ wallet: from a trading plan to what each trading day costs and how much ECC limit it uses.
   Sources: ECC Risk Management Services Manual v056, §3.10 (auctions) and §3.11 (continuous).
   The formulas are explained in docs/wallet-model.md §2 and §6. */
const WalletBehaviour = (() => {
  'use strict';

  const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

  /**
   * Exposure of one auction order (Manual §3.10, p.24): "the maximum value of (price*quantity) for the complete order.
   * Only orders with a positive exposure are applied against the limit."
   *   curve   [{ mwh: + buy / − sell, price }]; a price of null means the order has no limit price
   *   prices  { maxMarket, minMarket, minReal, maxReal }. The realistic price range (p.25) applies only when both of its
   *           ends are set, and caps prices to it. None of these has a built-in value.
   * INTERPRETATION: a sell without a limit price counts at the minimum price; the manual only mentions the maximum.
   */
  function orderExposure(curve, { maxMarket, minMarket, minReal, maxReal }) {
    const ranged = minReal != null && maxReal != null;
    if (ranged && !(minReal < maxReal)) throw new Error('Realistic price range: the minimum must be below the maximum');
    let exposure = 0;
    for (const { mwh, price: limit } of curve) {
      const buy = mwh > 0;
      let price = limit;
      if (price == null) {
        if (ranged) price = buy ? maxReal : minReal;
        else price = buy ? maxMarket : minMarket;
        if (price == null) {
          throw new Error(`Set the market ${buy ? 'maximum' : 'minimum'} price for orders without a limit price`);
        }
      }
      if (ranged) price = clamp(price, minReal, maxReal);
      const value = price * mwh;
      if (value > exposure) exposure = value;
    }
    return exposure;
  }

  const noTrading = () => ({
    traded: false,
    cont: { buyValue: 0, sellValue: 0, risk: 0 },
    auc: { buyValue: 0, sellValue: 0, exposure: 0 },
    tradeNet: 0,
    net: 0,
  });

  /**
   * What one trading day (16:00 the day before to 16:00) costs, from the plan's daily volumes (wallet-model §6.1).
   *   plan         { price, negShare, negPrice, cont: { buy, sell }, auc: { buy, sell, limitPrice }, lossShare }
   *                volumes in MWh a day, prices in €/MWh
   *   priceFactor  multiplies every price: 1 for the expected case, stress price ÷ typical price for the stress end
   *   traded       whether the member trades that day (an ECC business day, or weekend trading is on)
   *   prices       market price bounds for auction orders without a limit price, as for orderExposure()
   * Returns values in €: cont.risk (the value that uses continuous limit), auc.exposure (the auction limit an order
   * needs), tradeNet (buys − sells, one price per market) and net (what settlement collects: tradeNet plus the loss
   * share, an optional stress assumption for buying not sold back at the same price).
   */
  function dayFlows(plan, priceFactor, traded, prices = {}) {
    if (!traded) return noTrading();
    const price = plan.price * priceFactor;
    const negPrice = (plan.negPrice || 0) * priceFactor;
    const negShare = plan.negShare || 0;
    const avgPrice = (1 - negShare) * price + negShare * negPrice; // over the positive and negative hours
    const cont = plan.cont || { buy: 0, sell: 0 };
    const auc = plan.auc || { buy: 0, sell: 0, limitPrice: null };

    // Buys at positive prices and sells at negative prices use limit; the others give it back (Manual §3.11).
    const continuous = {
      buyValue: cont.buy * avgPrice,
      sellValue: cont.sell * avgPrice,
      risk: cont.buy * (1 - negShare) * price + cont.sell * negShare * Math.abs(negPrice),
    };
    const limitPrice = auc.limitPrice == null ? null : auc.limitPrice * priceFactor;
    const auctions = {
      buyValue: auc.buy * avgPrice,
      sellValue: auc.sell * avgPrice,
      exposure: auc.buy > 0 ? orderExposure([{ mwh: auc.buy, price: limitPrice }], prices) : 0,
    };
    const tradeNet = continuous.buyValue - continuous.sellValue + auctions.buyValue - auctions.sellValue;
    const loss = (plan.lossShare || 0) * (cont.buy + auc.buy) * price;
    return { traded: true, cont: continuous, auc: auctions, tradeNet, net: tradeNet + loss };
  }

  return { orderExposure, dayFlows };
})();
if (typeof module !== 'undefined') module.exports = WalletBehaviour;
