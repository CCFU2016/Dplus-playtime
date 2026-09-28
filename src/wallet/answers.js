/* Direct+ wallet: the prospect questionnaire (src/wallet/prospect.html). Its plain answers map onto the settings of
   settings.js, and with each member type's default answers they give exactly its preset (docs/wallet-model.md §12). */
const WalletAnswers = ((Settings) => {
  'use strict';

  const { BASE, LEVELS, PRESETS, preset } = Settings;

  const NATURAL_STRATEGY = { trader: 'flat', aggregator: 'seller', asset: 'seller' };
  const STRATEGY_SPLIT = { flat: [0.5, 0.5], seller: [0.1, 0.9], buyer: [0.9, 0.1] }; // shares of the volume: buy, sell
  const DEFAULT_BALANCE = { trader: 'tight', aggregator: 'normal', asset: 'forecast' };
  const DEFAULT_LEAN = { trader: 'neither', aggregator: 'short', asset: 'long' };
  const NO_ASSETS = { production: false, consumption: false };
  const RECONCILIATION_SD_PER_MW = 10; // ASSUMPTION: σ of the monthly reconciliation invoice, € per MW connected
  const STRESS_AVERAGE_FACTOR = 1.5; // ASSUMPTION: the stress average price, as a multiple of the typical price

  /** How closely a portfolio can match its positions: production (solar, wind) usually needs a forecast. */
  function suggestBalance(type, portfolio) {
    const assets = portfolio || NO_ASSETS;
    if (assets.production) return 'forecast';
    if (assets.consumption) return 'normal';
    return DEFAULT_BALANCE[type];
  }

  /** Buy and sell volumes (MWh a day) that a trading strategy suggests, from the member type's preset: its own
   *  strategy keeps the preset's volumes, another one splits the same total. */
  function strategyVolumes(type, strategy) {
    const own = PRESETS[type].values;
    const split = (buy, sell) => {
      if (strategy === NATURAL_STRATEGY[type]) return { buy: Math.round(buy), sell: Math.round(sell) };
      const [buyShare, sellShare] = STRATEGY_SPLIT[strategy];
      const total = buy + sell;
      return { buy: Math.round(buyShare * total), sell: Math.round(sellShare * total) };
    };
    return {
      cont: split(own.contBuy || 0, own.contSell || 0),
      auc: split(own.aucBuy || 0, own.aucSell || 0),
    };
  }

  /** The questionnaire's starting answers for a member type. */
  function defaultAnswers(type) {
    const own = PRESETS[type].values;
    const strategy = NATURAL_STRATEGY[type];
    const volumes = strategyVolumes(type, strategy);
    const assetOwner = type === 'asset';
    return {
      type,
      markets: 'both',
      weekend: 'yes',
      tough: false,
      strategy,
      contBuy: volumes.cont.buy,
      contSell: volumes.cont.sell,
      aucBuy: volumes.auc.buy,
      aucSell: volumes.auc.sell,
      carry: 'some',
      netting: type === 'trader' ? 'mixed' : null,
      nominatedIn: own.nominatedIn || 0,
      nonDelivery: own.nonDelivery || 0,
      price: BASE.price,
      stressPrice: BASE.stressPrice,
      aucLimitPrice: own.aucLimitPrice ?? BASE.aucLimitPrice,
      portfolio: { production: assetOwner, consumption: assetOwner },
      capacityMW: assetOwner ? 30 : 0, // the asset preset's 30 MW connection
      sites: assetOwner ? 1 : 0,
      balance: DEFAULT_BALANCE[type],
      lean: DEFAULT_LEAN[type],
      replenish: 'none',
      collateral: 'static',
      week: BASE.week,
    };
  }

  /* The connections a portfolio brings into the Direct+ BRP: the capacity split over equal sites (ASSUMPTION), metered
     by telemetry or smart meter (reconciliation D; new connections are not profile-metered after cSMA, open question
     W9). A portfolio that both produces and consumes (solar with a battery, say) buys and sells in different
     settlement periods. */
  function portfolioSettings(answers) {
    const portfolio = answers.portfolio || NO_ASSETS;
    const hasAssets = portfolio.production || portfolio.consumption;
    const capacity = hasAssets ? +answers.capacityMW || 0 : 0;
    const sites = hasAssets && capacity > 0 ? Math.max(1, Math.round(+answers.sites || 1)) : 0;
    const siteMW = Math.round((capacity / sites) * 10) / 10;
    return {
      connectionsMW: Array(sites).fill(siteMW).join(', '),
      profileMean: 0,
      smartMean: 0,
      profileSd: 0,
      smartSd: RECONCILIATION_SD_PER_MW * capacity,
      shiftShare: portfolio.production && portfolio.consumption ? 1 : 0,
    };
  }

  /** The settings that a set of answers gives: the member type's preset, with the answers on top. */
  function fromAnswers(answers) {
    const { type } = answers;
    const own = PRESETS[type].values;
    const settings = preset(type);
    const continuous = answers.markets !== 'auctions';
    const auctions = answers.markets !== 'continuous';
    const volume = (traded, value) => (traded ? +value || 0 : 0);
    settings.contBuy = volume(continuous, answers.contBuy);
    settings.contSell = volume(continuous, answers.contSell);
    settings.aucBuy = volume(auctions, answers.aucBuy);
    settings.aucSell = volume(auctions, answers.aucSell);
    // Orders resting over 16:00 and evening buying scale with continuous buying (the preset's ratio).
    const scale = own.contBuy ? settings.contBuy / own.contBuy : 0;
    settings.restingCont = (own.restingCont || 0) * scale;
    settings.eveningCont = (own.eveningCont || 0) * scale;
    settings.weekend = [true, 'yes', 'both'].includes(answers.weekend);
    settings.aucLimitPrice =
      answers.aucLimitPrice == null || answers.aucLimitPrice === '' ? null : +answers.aucLimitPrice;
    settings.price = +answers.price;
    settings.stressPrice = +answers.stressPrice;
    settings.stressAvgPrice = STRESS_AVERAGE_FACTOR * settings.price; // averages move less than spot prices
    settings.carryShare = LEVELS.carryShare[answers.carry] || 0;
    if (type === 'trader' && Object.hasOwn(LEVELS.s, answers.netting)) settings.s = LEVELS.s[answers.netting];
    const aggregator = type === 'aggregator';
    settings.nominatedIn = aggregator ? +answers.nominatedIn || 0 : 0;
    settings.nonDelivery = aggregator ? +answers.nonDelivery || 0 : 0;
    settings.imbShare = LEVELS.imbShare[answers.balance];
    settings.bias = LEVELS.bias[answers.lean];
    Object.assign(settings, portfolioSettings(answers));
    settings.replenish = answers.replenish;
    settings.collateralMode = answers.collateral === 'daily' ? 'daily' : 'static';
    if (answers.week) settings.week = answers.week;
    return settings;
  }

  return { suggestBalance, strategyVolumes, defaultAnswers, fromAnswers };
})(typeof WalletSettings !== 'undefined' ? WalletSettings : require('./settings.js'));
if (typeof module !== 'undefined') module.exports = WalletAnswers;
