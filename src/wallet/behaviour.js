/* Direct+ wallet: trading behaviour → per-day flows, auction order exposure, continuous target.
   Sources: ECC Risk Management Services Manual v056, §3.10 (auctions) and §3.11 (continuous).
   Formulas and their sources: docs/wallet-model.md §2.2, §2.3 and §6. No DOM, no engine. */
var WalletBehaviour = (function () {
  'use strict';
  function clamp(p, lo, hi) { return Math.min(Math.max(p, lo), hi); }

  /* Continuous target for one limit period, from its trades in time order (wallet-model §2.2).
     trades: [{ mwh: + buy / − sell, price }]. Manual §3.11: buys at positive and sells at negative prices use limit,
     the others give it back.
       G = risk-bearing value, P = running peak of the cumulative net position,
       T = max(G × (1 − s), P) + resting   (s: ASSUMPTION, default 0) */
  function contTarget(trades, s, resting) {
    var G = 0, pos = 0, P = 0;
    trades.forEach(function (t) {
      var v = t.mwh * t.price;              // what the trade costs the member; negative when it pays the member
      if (v > 0) G += v;
      pos += v;
      if (pos > P) P = pos;
    });
    return { G: G, P: P, T: Math.max(G * (1 - (s || 0)), P) + (resting || 0) };
  }

  /* Exposure of one auction order (Manual §3.10, p.24): "the maximum value of (price*quantity) for the complete order.
     Only orders with a positive exposure are applied against the limit."
     curve: [{ mwh: + buy / − sell, price }]; price null means no limit price.
     px: { maxMarket, minMarket, minReal, maxReal }. The Realistic Price Range (p.25) applies only when both minReal and
     maxReal are set; it caps prices to [minReal, maxReal]. No built-in values (Q9).
     INTERPRETATION: a sell without a limit price counts at the minimum price; the manual only mentions the maximum. */
  function orderExposure(curve, px) {
    var range = px.minReal != null && px.maxReal != null, best = 0;
    if (range && !(px.minReal < px.maxReal)) throw new Error('Realistic price range: the minimum must be below the maximum');
    curve.forEach(function (c) {
      var p = c.price;
      if (p == null) {
        p = c.mwh > 0 ? (range ? px.maxReal : px.maxMarket) : (range ? px.minReal : px.minMarket);
        if (p == null) throw new Error('Set the market ' + (c.mwh > 0 ? 'maximum' : 'minimum') + ' price for orders without a limit price (Q9)');
      }
      if (range) p = clamp(p, px.minReal, px.maxReal);
      var e = p * c.mwh;
      if (e > best) best = e;
    });
    return best;
  }

  /* Parametric flows for one trading day (16:00 the day before to 16:00), wallet-model §6.1.
     b = { weekend, price, negShare, negPrice, cont: { buy, sell }, auc: { buy, sell, limitPrice }, lossShare }
       volumes in MWh a day, prices in €/MWh; limitPrice null means no limit price (priced by px as in orderExposure).
     f multiplies every price (1 = expected; stress price ÷ typical price = stress). traded: an ECC business day, or
     weekend and holiday trading is on.
     Returns values in €: cont.risk (risk-bearing value for the continuous target), auc.exposure (auction target),
     tradeNet (buys − sells at one price per market) and net (what settlement collects for the day's trades: tradeNet
     plus the stress loss share, wallet-model §3; a loss is buying that has not been sold back at the same price). */
  function dayFlows(b, f, traded, px) {
    var z = { traded: false, cont: { buyValue: 0, sellValue: 0, risk: 0 }, auc: { buyValue: 0, sellValue: 0, exposure: 0 }, tradeNet: 0, net: 0 };
    if (!traded) return z;
    var p = b.price * f, pn = (b.negPrice || 0) * f, sh = b.negShare || 0;
    var avg = (1 - sh) * p + sh * pn;                          // average price over positive and negative hours
    var c = b.cont || { buy: 0, sell: 0 }, a = b.auc || { buy: 0, sell: 0, limitPrice: null };
    var cont = { buyValue: c.buy * avg, sellValue: c.sell * avg, risk: c.buy * (1 - sh) * p + c.sell * sh * Math.abs(pn) };
    var lim = a.limitPrice == null ? null : a.limitPrice * f;
    var auc = { buyValue: a.buy * avg, sellValue: a.sell * avg, exposure: a.buy > 0 ? orderExposure([{ mwh: a.buy, price: lim }], px || {}) : 0 };
    var tradeNet = cont.buyValue - cont.sellValue + auc.buyValue - auc.sellValue;
    return { traded: true, cont: cont, auc: auc, tradeNet: tradeNet, net: tradeNet + (b.lossShare || 0) * (c.buy + a.buy) * p };
  }

  return { contTarget: contTarget, orderExposure: orderExposure, dayFlows: dayFlows };
})();
if (typeof module !== 'undefined') module.exports = WalletBehaviour;
