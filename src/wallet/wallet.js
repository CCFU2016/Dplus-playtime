/* Direct+ wallet: what one member needs, by purpose and by wallet segment (docs/wallet-model.md).
   Every setting the page shows (its label, unit, kind, tag and source) is listed here, so the Settings view and the
   "Assumptions and sources" list come from one place. Each member is treated as its own BRP, and the wallet pools
   all members at one connected bank, so nothing nets between members (Niki, 26 Sep 2026; wallet-model §11.1). */
var WalletCalc = (function (E, B, S, L, R, W) {
  'use strict';

  // ---------- settings ----------
  // kind: number | share (0-1, shown as %) | bool | select | list (MW, comma-separated) | optional (number or empty)
  // tag: input (the member's plan) | ASSUMPTION | INTERPRETATION | ECC setting (set with ECC; no built-in value)
  function f(key, label, unit, kind, tag, src, extra) {
    var o = { key: key, label: label, unit: unit, kind: kind, tag: tag, src: src };
    for (var k in extra || {}) o[k] = extra[k];
    return o;
  }
  var GROUPS = [
    { id: 'plan', title: 'Trading plan', note: 'Your own plan, NL only. The ECC limits also cover other delivery areas and SEMOpx; those are not included here.', fields: [
      f('contBuy', 'Continuous: buy', 'MWh a day', 'number', 'input', 'EPEX continuous NL (M7)'),
      f('contSell', 'Continuous: sell', 'MWh a day', 'number', 'input', 'EPEX continuous NL (M7)'),
      f('aucBuy', 'Auctions: buy', 'MWh a day', 'number', 'input', 'EPEX day-ahead and intraday auctions NL'),
      f('aucSell', 'Auctions: sell', 'MWh a day', 'number', 'input', 'EPEX day-ahead and intraday auctions NL; sell orders assumed to carry a limit price of €0 or more'),
      f('aucLimitPrice', 'Highest price on auction buy orders', '€/MWh', 'optional', 'input', 'ECC manual §3.10: an order counts at its highest price × quantity; empty means no limit price (then the market maximum, below, applies)'),
      f('nominatedIn', 'Nominated in from other BRPs', 'MWh a day', 'number', 'input', 'Aggregators: flexibility bought bilaterally from assets in other BRPs'),
      f('nonDelivery', 'Non-delivery of nominated flexibility', '%', 'share', 'ASSUMPTION', 'By contract the aggregator carries it, as a short imbalance'),
      f('weekend', 'Trade at weekends and on holidays', '', 'bool', 'input', 'Weekend days lengthen the Friday period (ECC manual §3.11)')
    ] },
    { id: 'prices', title: 'Prices', fields: [
      f('price', 'Typical price', '€/MWh', 'number', 'ASSUMPTION', 'Check against current NL day-ahead data'),
      f('stressPrice', 'Stress price', '€/MWh', 'number', 'ASSUMPTION', 'A spike day; every trading value scales with it at the stress end'),
      f('stressAvgPrice', 'Stress two-to-three-month average price', '€/MWh', 'number', 'ASSUMPTION', 'BRP security uses averages (three months now, two in the draft), not spot prices'),
      f('negShare', 'Hours with negative prices', '%', 'share', 'ASSUMPTION', 'Share of the hours traded'),
      f('negPrice', 'Average price in those hours', '€/MWh', 'number', 'ASSUMPTION', 'Needed to value negative-price hours')
    ] },
    { id: 'ecc', title: 'ECC limits and collateral', note: 'Direct+ accepts cash only: collateral is never a bank guarantee.', fields: [
      f('s', 'Buys already offset by sells when the position peaks', '%', 'share', 'ASSUMPTION', 'Continuous target max(G × (1 − s), peak); 0 is the cautious default (wallet-model §2.2)'),
      f('restingCont', 'Continuous orders resting over 16:00', '€', 'number', 'ASSUMPTION', 'Risk-bearing orders count against the limit (ECC manual §3.11); they need the base limit after 16:00 (ECC deck p.4)'),
      f('eveningCont', 'Net buying between 16:00 and the evening update', '€', 'number', 'ASSUMPTION', 'Covered by the base limit (ECC deck p.2)'),
      f('restingAuc', 'Auction orders resting over 16:00', '€', 'number', 'ASSUMPTION', 'ECC deck p.4: future orders above the base limit are deleted after 16:00'),
      f('restingAucWeekend', 'Weekend auction orders placed on Friday before 16:00', '€', 'number', 'ASSUMPTION', 'Sets the non-business-day auction base limit'),
      f('updateHour', 'Evening update, expected case', '', 'select', 'ASSUMPTION', 'ECC deck p.2: "approximately 18:00-19:00 CET on best effort basis"', { options: [[18, 'Around 18:00'], [19, 'Around 19:00']] }),
      f('stressUpdateHour', 'Evening update, stress case', '', 'select', 'ASSUMPTION', 'ECC deck p.2: best effort, so the late end of the window', { options: [[18, 'Around 18:00'], [19, 'Around 19:00']] }),
      f('measure', 'Limit that must hold the continuous target', '', 'select', 'ASSUMPTION', 'The evening limit applies until settlement (by 10:45 next business day, ECC deck p.3)', { options: [['l18', 'Evening limit (cautious)'], ['l09', 'Limit after settlement']] }),
      f('splitMode', 'Split between continuous and auctions', '', 'select', 'input', 'Set in the Direct+ platform', { options: [['cheapest', 'The split that needs the least collateral'], ['mine', 'My split']] }),
      f('key', 'My split: continuous share', '%', 'number', 'input', 'Auctions get the rest'),
      f('collateralMode', 'Collateral at ECC', '', 'select', 'input', 'Keep one amount all week (sized for the weekend), or change it every business day: less during the week, more before weekends and holidays. Assumed to be in place by that day\'s evening calculation; how fast the Direct+ platform applies changes is open (W4)', { options: [['static', 'Static: the same all week'], ['daily', 'Optimised by day']] }),
      f('cap', 'Cap limit', '€', 'optional', 'ECC setting', 'Set by ECC at KYC, reviewed yearly (ECC DCP risk page); collateral above it does not raise limits'),
      f('aucMaxPrice', 'Market maximum price (orders without a limit price)', '€/MWh', 'optional', 'ECC setting', 'ECC manual §3.10; no built-in value (Q9)'),
      f('aucMinPrice', 'Market minimum price (sells without a limit price)', '€/MWh', 'optional', 'ECC setting', 'INTERPRETATION of ECC manual §3.10 (Q9)'),
      f('realMin', 'Realistic price range: minimum', '€/MWh', 'optional', 'ECC setting', 'ECC manual §3.10 p.25: set by the clearing member; both ends or neither (Q9)'),
      f('realMax', 'Realistic price range: maximum', '€/MWh', 'optional', 'ECC setting', 'ECC manual §3.10 p.25 (Q9)')
    ] },
    { id: 'settlement', title: 'ECC settlement', fields: [
      f('carryShare', 'Purchases paid before their sale', '% of a day\'s buys', 'share', 'ASSUMPTION', 'Positions bought before the 16:00 booking cut and sold after it (e.g. bought day-ahead, sold intraday the next day): ECC collects the purchase one business day before the sale comes back, so this much stays in the wallet as a float (ECC DCP payments page: one net payment per business day)'),
      f('lossShare', 'Stress: net payment per window', '% of gross buys', 'share', 'ASSUMPTION', 'A flat trader nets to €0 at one price; the stress end assumes this loss in every window (wallet-model §3)'),
      f('replenish', 'Topping up the wallet', '', 'select', 'ASSUMPTION', 'How often you replace what ECC collects', { options: [['none', 'Not within the period'], ['daily', 'Every business day'], ['weekly', 'Every Monday']] }),
      f('feesPerWindow', 'Fees per business day', '€', 'number', 'ASSUMPTION', 'ECC, EPEX and Direct+ fees: not set until the price lists are in (Q7)')
    ] },
    { id: 'imbalance', title: 'Imbalance', note: 'A normal model: it understates the tails of NL imbalance prices.', fields: [
      f('imbShare', 'Imbalance', '% of volume', 'share', 'ASSUMPTION', 'Of the volume chosen below'),
      f('imbBase', 'Imbalance measured against', '', 'select', 'ASSUMPTION', 'Traded, nominated or produced volume', { options: [['traded', 'Traded volume'], ['nominated', 'Nominated volume'], ['production', 'Net sold volume (production)']] }),
      f('bias', 'Bias: +1 always short, −1 always long', '', 'number', 'ASSUMPTION', 'Short pays the imbalance price; long receives it (SC 2026 art. 10.29)'),
      f('cv', 'Weekly invoice volatility', '× imbalance value', 'number', 'ASSUMPTION', 'σ of the weekly invoice as a multiple of volume × price (wallet-model §6.2)'),
      f('state2Share', 'Periods with dual pricing (regulation state 2)', '%', 'share', 'ASSUMPTION', 'SC 2026 art. 10.29(4)'),
      f('state2Gap', 'Price gap in those periods', '€/MWh', 'number', 'ASSUMPTION', 'Short price minus long price'),
      f('shiftShare', 'Volume bought and sold in different settlement periods', '%', 'share', 'ASSUMPTION', 'Only used with reading (ii) of the daily net volume, below (batteries, shifting)')
    ] },
    { id: 'connections', title: 'Connections in the Direct+ BRP', fields: [
      f('connectionsMW', 'Large connections', 'MW each, comma-separated', 'list', 'input', 'SC 2026 art. 10.8(8)-(10): counted per class at the class minimum; above 50 MW actual'),
      f('between', 'A capacity between two classes (e.g. 10.5 MW)', '', 'select', 'INTERPRETATION', 'The classes are 2-10, 11-25, 26-50 MW', { options: [['down', 'Counts in the lower class'], ['up', 'Counts in the higher class']] }),
      f('profileMean', 'Profile reconciliation: average monthly invoice', '€', 'number', 'ASSUMPTION', 'Component C of the draft; may be €0 for new connections after cSMA (Q15)'),
      f('profileSd', 'Profile reconciliation: monthly σ', '€', 'number', 'ASSUMPTION', 'Component C of the draft'),
      f('smartMean', 'Smart-meter and telemetry reconciliation: average monthly invoice', '€', 'number', 'ASSUMPTION', 'Component D of the draft'),
      f('smartSd', 'Smart-meter and telemetry reconciliation: monthly σ', '€', 'number', 'ASSUMPTION', 'Component D of the draft')
    ] },
    { id: 'brp', title: 'BRP security', note: 'Direct+ members put up their marginal collateral: the rule applied to their own figures, with no minimum.', fields: [
      f('brpBasis', 'Basis', '', 'select', 'Direct+ contract', 'Direct+ (Niki, 26 Sep 2026): no minimum for members, only the marginal collateral; the €96,000 minimum and the 50 MW floors apply once to the Direct+ BRP. ASSUMPTION: the rule\'s formula on your own figures, never below €0; netting inside the Direct+ portfolio is not modelled', { options: [['marginal', 'Direct+: your marginal collateral'], ['standalone', 'On your own as a BRP (with the minimum), for comparison']] }),
      f('rule', 'Rule', '', 'select', 'input', 'The draft takes effect on 1 January 2027 once ACM decides (ACM draft Artikel II B)', { options: [['auto', 'By date (the draft from 2027)'], ['current', 'Rule in force now'], ['draft', 'ACM draft']] }),
      f('reading', 'The current rule\'s 50 MW floor (on your own as a BRP)', '', 'select', 'INTERPRETATION', 'SC 2026 art. 10.8(3), (6), (11); the €96,000 minimum is on TenneT\'s page only (Q14). Not used for the marginal basis', { options: [['1200', '50 MW × 24 h = 1,200 MWh'], ['flat', 'A flat €96,000 minimum']] }),
      f('perPeriod', 'Daily net volume', '', 'select', 'INTERPRETATION', '"voor alle uren gedurende één kalenderdag" (current) / "één etmaal" (draft)', { options: [['i', '(i) Net over the day'], ['ii', '(ii) Net per settlement period, added up']] }),
      f('counterparties', 'Counterparties', '', 'select', 'INTERPRETATION', '"met enige andere balanceringsverantwoordelijke" (current), "met een andere" (draft)', { options: [['max', 'The largest single counterparty'], ['total', 'All counterparties netted']] }),
      f('sigma', 'Standard deviation', '', 'select', 'INTERPRETATION', 'ACM draft art. 10.8(3)-(5) does not say which', { options: [['population', 'Population'], ['sample', 'Sample']] }),
    ] },
    { id: 'tennet', title: 'TenneT account', fields: [
      f('debitLagWeeks', 'Weekly imbalance invoice after delivery', 'weeks', 'number', 'ASSUMPTION', 'ACM draft para 15: four weeks between delivery and invoicing; the debit day is in TenneT\'s billing terms (Q11)')
    ] }
  ];

  var BASE = {
    week: '2026-10-05',
    contBuy: 0, contSell: 0, aucBuy: 0, aucSell: 0, aucLimitPrice: 150, nominatedIn: 0, nonDelivery: 0, weekend: true,
    price: 80, stressPrice: 250, stressAvgPrice: 120, negShare: 0.05, negPrice: -20,
    s: 0, restingCont: 0, eveningCont: 0, restingAuc: 0, restingAucWeekend: 0, updateHour: 18, stressUpdateHour: 19,
    measure: 'l18', splitMode: 'cheapest', key: 60, collateralMode: 'static', cap: null,
    aucMaxPrice: null, aucMinPrice: null, realMin: null, realMax: null,
    carryShare: 0, lossShare: 0.05, replenish: 'none', feesPerWindow: 0,
    imbShare: 0.005, imbBase: 'traded', bias: 0, cv: 0.5, state2Share: 0.05, state2Gap: 150, shiftShare: 0,
    connectionsMW: '', between: 'down', profileMean: 0, profileSd: 0, smartMean: 0, smartSd: 0,
    brpBasis: 'marginal', rule: 'auto', reading: '1200', perPeriod: 'i', counterparties: 'max', sigma: 'population',
    debitLagWeeks: 4
  };
  // Presets approved by Niki "for now" (26 Sep 2026); wallet-model §7. Shown as assumed on the page.
  var PRESETS = {
    trader: { label: 'Financial trader', note: 'A small desk that ends each day flat.',
      values: { contBuy: 240, contSell: 240, aucBuy: 100, aucSell: 100, aucLimitPrice: 150, restingCont: 10000, eveningCont: 5000, carryShare: 0.3,
                imbShare: 0.005, imbBase: 'traded', bias: 0 } },
    aggregator: { label: 'Aggregator', note: 'Flexibility from assets that stay in other BRPs.',
      values: { contBuy: 10, contSell: 40, aucBuy: 0, aucSell: 120, nominatedIn: 150, nonDelivery: 0.05, restingCont: 2000, eveningCont: 1000,
                imbShare: 0.03, imbBase: 'nominated', bias: 0.3 } },
    asset: { label: 'Asset-controlling party', note: 'A 30 MW solar park with a 10 MW battery.',
      values: { contBuy: 20, contSell: 20, aucBuy: 0, aucSell: 90, restingCont: 2000, eveningCont: 1000, connectionsMW: '30',
                imbShare: 0.05, imbBase: 'production', bias: -0.2, shiftShare: 1, smartMean: 0, smartSd: 300 } }
  };
  function preset(id) {
    var s = {}, k;
    for (k in BASE) s[k] = BASE[k];
    for (k in PRESETS[id].values) s[k] = PRESETS[id].values[k];
    s.member = id;
    return s;
  }

  // ---------- the prospect questionnaire (src/wallet/prospect.html) ----------
  // Plain answers map onto the settings above; with each type's default answers they give exactly its preset.
  var NATURAL = { trader: 'flat', aggregator: 'seller', asset: 'seller' };
  var IMB_BASE = { trader: 'traded', aggregator: 'nominated', asset: 'production' };
  var BALANCE = { tight: 0.005, normal: 0.03, forecast: 0.05 };          // imbalance as a share of volume
  var LEAN = { neither: 0, short: 0.3, long: -0.2 };                      // bias
  var CARRY = { none: 0, some: 0.3, most: 0.7 };                          // purchases paid before their sale
  var RECONCILIATION_SD_PER_MW = 10;                                      // ASSUMPTION: € a month per MW connected
  var ASSETS = ['production', 'consumption'];                             // portfolio answers (Niki: production vs consumption)
  var NO_ASSETS = { production: false, consumption: false };
  // How closely a portfolio can match its positions: production output (solar, wind) usually needs a forecast.
  function suggestBalance(type, portfolio) {
    var pf = portfolio || NO_ASSETS;
    if (pf.production) return 'forecast';
    if (pf.consumption) return 'normal';
    return type === 'trader' ? 'tight' : type === 'aggregator' ? 'normal' : 'forecast';
  }
  // Buy and sell volumes (MWh a day) that a trading strategy suggests, starting from the member type's preset.
  function strategyVolumes(type, strategy) {
    var v = PRESETS[type].values, out = {};
    [['cont', v.contBuy || 0, v.contSell || 0], ['auc', v.aucBuy || 0, v.aucSell || 0]].forEach(function (m) {
      var buy = m[1], sell = m[2], t = buy + sell;
      if (strategy !== NATURAL[type]) {
        if (strategy === 'flat') { buy = t / 2; sell = t / 2; }
        else if (strategy === 'seller') { buy = 0.1 * t; sell = 0.9 * t; }
        else { buy = 0.9 * t; sell = 0.1 * t; }
      }
      out[m[0]] = { buy: Math.round(buy), sell: Math.round(sell) };
    });
    return out;
  }
  function defaultAnswers(type) {
    var v = PRESETS[type].values, vol = strategyVolumes(type, NATURAL[type]);
    return {
      type: type, markets: 'both', weekend: 'yes', tough: false, strategy: NATURAL[type],
      contBuy: vol.cont.buy, contSell: vol.cont.sell, aucBuy: vol.auc.buy, aucSell: vol.auc.sell,
      carry: type === 'trader' ? 'some' : 'none', nominatedIn: v.nominatedIn || 0, nonDelivery: v.nonDelivery || 0,
      price: BASE.price, stressPrice: BASE.stressPrice, aucLimitPrice: v.aucLimitPrice != null ? v.aucLimitPrice : BASE.aucLimitPrice,
      portfolio: type === 'asset' ? { production: true, consumption: true } : { production: false, consumption: false },
      capacityMW: type === 'asset' ? 30 : 0, sites: type === 'asset' ? 1 : 0,
      balance: type === 'trader' ? 'tight' : type === 'aggregator' ? 'normal' : 'forecast',
      lean: type === 'aggregator' ? 'short' : type === 'asset' ? 'long' : 'neither',
      replenish: 'none', collateral: 'static', week: BASE.week
    };
  }
  function fromAnswers(a) {
    var s = preset(a.type), p = PRESETS[a.type].values;
    var useC = a.markets !== 'auctions', useA = a.markets !== 'continuous';
    s.contBuy = useC ? +a.contBuy || 0 : 0; s.contSell = useC ? +a.contSell || 0 : 0;
    s.aucBuy = useA ? +a.aucBuy || 0 : 0; s.aucSell = useA ? +a.aucSell || 0 : 0;
    // Orders resting over 16:00 and evening buying scale with continuous buying (the preset's ratio).
    var scale = p.contBuy ? s.contBuy / p.contBuy : 0;
    s.restingCont = (p.restingCont || 0) * scale; s.eveningCont = (p.eveningCont || 0) * scale;
    s.weekend = a.weekend === true || a.weekend === 'yes' || a.weekend === 'both'; s.aucLimitPrice = a.aucLimitPrice == null || a.aucLimitPrice === '' ? null : +a.aucLimitPrice;
    s.price = +a.price; s.stressPrice = +a.stressPrice; s.stressAvgPrice = 1.5 * s.price;   // ASSUMPTION: averages move less than spot
    s.carryShare = CARRY[a.carry] || 0;
    s.nominatedIn = a.type === 'aggregator' ? +a.nominatedIn || 0 : 0; s.nonDelivery = a.type === 'aggregator' ? +a.nonDelivery || 0 : 0;
    s.imbShare = BALANCE[a.balance]; s.imbBase = IMB_BASE[a.type]; s.bias = LEAN[a.lean];
    // Portfolio: the capacity joining the Direct+ BRP, split over equal sites (ASSUMPTION), metered by telemetry or smart
    // meter (reconciliation D; no profile metering for new connections after cSMA, Q15). A portfolio that both produces
    // and consumes (for example solar with a battery) buys and sells in different settlement periods.
    var pf = a.portfolio || NO_ASSETS, any = ASSETS.some(function (k) { return pf[k]; });
    var cap = any ? +a.capacityMW || 0 : 0, n = any && cap > 0 ? Math.max(1, Math.round(+a.sites || 1)) : 0, sites = [];
    for (var i = 0; i < n; i++) sites.push(Math.round(cap / n * 10) / 10);
    s.connectionsMW = sites.join(', ');
    s.profileMean = 0; s.smartMean = 0; s.profileSd = 0; s.smartSd = RECONCILIATION_SD_PER_MW * cap;
    s.shiftShare = pf.production && pf.consumption ? 1 : 0;
    s.replenish = a.replenish; s.collateralMode = a.collateral === 'daily' ? 'daily' : 'static';
    if (a.week) s.week = a.week;
    return s;
  }

  var SEGMENTS = {
    trading: 'Trading collateral (at ECC)',
    brp: 'BRP collateral',
    available: 'Available balance'
  };
  function num(v) { return v == null || v === '' ? null : +v; }
  function listMW(v) { return String(v || '').split(/[,;\s]+/).filter(function (x) { return x !== ''; }).map(Number).filter(function (x) { return isFinite(x) && x > 0; }); }
  function sunday(isoMonday) { return E.iso(new Date(E.parse(isoMonday).getTime() + 6 * 86400000)); }

  /* One scenario. o = { stress, priceStress, volMult, imbMult }:
       stress       the stress end: stress price, stress average price, stress loss share, stress update time, B at its
                    95th percentile;
       priceStress  prices at the stress price only (a sensitivity);
       volMult, imbMult  scale the volumes or the imbalance (sensitivities). */
  function scenario(st, o) {
    o = o || {};
    var hot = o.stress || o.priceStress, fp = hot ? st.stressPrice / st.price : 1, vm = o.volMult || 1, im = o.imbMult || 1;
    var b = { weekend: st.weekend, price: st.price, negShare: st.negShare, negPrice: st.negPrice,
              cont: { buy: st.contBuy * vm, sell: st.contSell * vm },
              auc: { buy: st.aucBuy * vm, sell: st.aucSell * vm, limitPrice: num(st.aucLimitPrice) },
              lossShare: o.stress ? st.lossShare : 0 };
    var px = { maxMarket: num(st.aucMaxPrice), minMarket: num(st.aucMinPrice), minReal: num(st.realMin), maxReal: num(st.realMax) };
    var flowOf = function (d) { return B.dayFlows(b, fp, E.isBD(E.parse(d)) || !!st.weekend, px); };
    var days = E.weekDays(st.week), isoDays = days.map(E.iso);

    // Part 2: settlement windows and cash
    var ws = S.windows(isoDays, flowOf, function () { return st.feesPerWindow || 0; });
    var cash = S.cashPath(ws, st.replenish);
    // Float: purchases paid one collection before their sale (bought before the 16:00 cut, sold after). In steady state each
    // collection pays the new carried purchases and receives the previous ones, so the amount stays in the wallet.
    var carry = (st.carryShare || 0) * (st.contBuy + st.aucBuy) * vm * st.price * fp;

    // Part 1: ECC collateral
    var tg = L.targets(days, flowOf, st.s, st.restingCont * fp);
    var bl = L.baseLimits({ restingCont: st.restingCont * fp, eveningCont: st.eveningCont * fp, updateHour: +(o.stress ? st.stressUpdateHour : st.updateHour),
                            restingAuc: st.restingAuc * fp, restingAucWeekend: st.restingAucWeekend * fp });
    var OR = {};
    ws.forEach(function (w) { OR[w.close] = w.OR; });
    var ctx = { days: days, key: +st.key, measure: st.measure, bl: bl,
                OR: function (d) { return OR[d]; }, cont: function (d) { return tg.cont[d]; }, auc: function (d) { return tg.auc[d] || 0; } };
    var split = st.splitMode === 'mine' ? { key: +st.key, C: L.solve(ctx, +st.key) } : L.cheapest(ctx);
    if (!split || split.C === null) throw new Error('The targets cannot be reached with this split: a market with a 0% share only has its base limit.');
    var binding = null;
    days.forEach(function (d) {                        // the calculation day that sets the amount
      var one = { days: [d], key: ctx.key, measure: ctx.measure, bl: bl, OR: ctx.OR, cont: ctx.cont, auc: ctx.auc };
      var c = L.solve(one, split.key);
      if (!binding || c > binding.C) binding = { date: E.iso(d), C: c, gap: E.day(d, { C: 0, OR: 0, cont: { bd: 0, nbd: 0, key: 0 }, da: { bd: 0, nbd: 0, key: 0 } }).gap1 };
    });
    // Collateral by calculation day, each day on its own (with its own cheapest split when that is the choice). With
    // 'daily' collateral the member changes it every business day (Niki, 26 Sep 2026): less during the week, more before
    // weekends and holidays. ASSUMPTION: a change is in place by that day's evening calculation; how fast the Direct+
    // platform applies it is open (W4). For one day the engine's own search gives the same answer as ecc-link.js.
    var perDay = days.map(function (d) {
      var iso = E.iso(d), nb = E.nextBD(d), tAuc = 0;
      for (var x = new Date(d.getTime() + 864e5); x <= nb; x = new Date(x.getTime() + 864e5)) tAuc = Math.max(tAuc, tg.auc[E.iso(x)] || 0);
      var p1 = { OR: OR[iso], cont: { bd: bl.cont.bd, nbd: bl.cont.nbd, key: +st.key }, da: { bd: bl.da.bd, nbd: bl.da.nbd, key: 100 - (+st.key) } };
      var t1 = { cont: tg.cont[iso], contMeasure: st.measure || 'l18', da: tAuc, daNonBD: !!st.weekend };
      var r = st.splitMode === 'mine' ? { key: +st.key, C: E.solve([d], p1, t1) } : E.cheapestKey([d], p1, t1);
      return { date: iso, gap: Math.round((nb - d) / 864e5), key: r ? r.key : null, C: r ? r.C : null };
    });
    if (perDay.some(function (x) { return x.C === null; })) throw new Error('The targets cannot be reached with this split: a market with a 0% share only has its base limit.');
    var maxOf = function (f) { var xs = perDay.filter(f).map(function (x) { return x.C; }); return xs.length ? Math.max.apply(null, xs) : null; };
    var daily = st.collateralMode === 'daily';
    var peakC = daily ? maxOf(function () { return true; }) : split.C;
    var weekdayC = daily ? (maxOf(function (x) { return x.gap === 1; }) || peakC) : split.C;
    // Direct+ accepts cash only, no bank guarantees (Niki, 26 Sep 2026): so no default-fund contribution either.
    var form = L.form(peakC, false, num(st.cap));

    // Part 3: BRP security on the member's own figures. Direct+ members put up their marginal collateral: no minimum and
    // no volume floors, which apply once to the Direct+ BRP (Niki, 26 Sep 2026). 'standalone' is the member as its own
    // BRP, with both, for comparison.
    var marginal = st.brpBasis !== 'standalone';
    var bx = (st.contBuy + st.aucBuy) * vm, sx = (st.contSell + st.aucSell) * vm, nom = st.nominatedIn * vm;
    var shift = st.perPeriod === 'ii' ? st.shiftShare : 0;
    var vol = function (buy, sell) { return Math.abs(buy - sell) + 2 * Math.min(buy, sell) * shift; };
    var V = st.counterparties === 'total' ? vol(bx + nom, sx) : Math.max(vol(bx, sx), nom);
    var pAvg = hot ? st.stressAvgPrice : st.price;
    var ruleId = st.rule === 'auto' ? R.ruleFor(isoDays[0]) : st.rule;
    var cur = R.current({ kind: 'first', expected: V, price3m: pAvg, capacityMW: R.countedCapacity(listMW(st.connectionsMW), st.between), reading: st.reading, floors: !marginal });
    var floor = marginal || st.reading === 'flat' ? 0 : 1200, pFl = Math.max(pAvg, 40);
    cur.Aup = V * pFl; cur.Adown = Math.max(V, floor) * pFl;
    var base = st.imbBase === 'nominated' ? nom : st.imbBase === 'production' ? Math.max(sx - bx, 0) : bx + sx;
    var wk = W.weekly({ weeklyVolume: base * 7, share: st.imbShare * im, bias: st.bias, price: st.price * fp, statePrice2Share: st.state2Share,
                        stateGap2: st.state2Gap, cv: st.cv, shortVolume: st.nonDelivery * nom * 7 * im });
    var Bc = o.stress ? W.stressB(wk.mu, wk.sigma, { sigmaType: st.sigma }) : wk.B;
    var Cc = st.profileMean + 0.5 * st.profileSd, Dc = st.smartMean + 0.5 * st.smartSd;
    var dr = R.draft({ A: V * pAvg, B: Bc, C: Cc, D: Dc, minimum: !marginal });
    // ASSUMPTION: a marginal share never goes below €0, even when the draft's components are negative.
    if (marginal) { cur.security = Math.max(cur.security, 0); dr.security = Math.max(dr.security, 0); }
    var byRule = { current: cur, draft: dr };
    var security = byRule[ruleId].security;
    var ramp = R.rampUp({ A: V * pAvg, weekly: wk.mu, weeklySd: wk.sigma, profile: st.profileMean, profileSd: st.profileSd, smart: st.smartMean,
                          smartSd: st.smartSd, sigma: st.sigma, minimum: !marginal, lagWeeks: +st.debitLagWeeks });
    if (marginal) {
      ramp.peak = null;
      ramp.months.forEach(function (mo) { mo.security = Math.max(mo.security, 0); if (!ramp.peak || mo.security > ramp.peak.security) ramp.peak = mo; });
    }
    var exit = W.exitTail(sunday(isoDays[0]), { profile: st.profileMean !== 0 || st.profileSd > 0, smart: st.smartMean !== 0 || st.smartSd > 0 });

    // Part 4: TenneT account
    var invoice = o.stress ? wk.mu + 2 * wk.sigma : Math.max(wk.mu, 0);
    var debit = W.imbalanceDebit(isoDays[0], +st.debitLagWeeks);
    var account = W.accountNeed([{ date: debit, amount: invoice }], security, 0, ruleId === 'current' ? 'current' : undefined);

    var parts = [
      { id: 'ecc', label: 'ECC trading collateral', segment: 'trading', value: peakC, form: 'Cash', formRule: 'Cash only', confidence: 'Estimate · ECC rule' },
      { id: 'settlement', label: 'ECC settlement', segment: 'available', value: cash.need + carry, form: 'Cash', formRule: 'Cash only', confidence: 'Estimate · ECC rule' },
      { id: 'brp', label: marginal ? 'BRP collateral (marginal)' : 'BRP security (TenneT)', segment: 'brp', value: security, form: 'Cash', formRule: 'Cash only', confidence: (ruleId === 'current' ? 'TenneT rule' : 'Draft rule') + ' · Direct+ contract' },
      { id: 'invoices', label: 'Imbalance invoices', segment: 'available', value: invoice, form: 'Cash', formRule: 'Cash only', confidence: 'Estimate' }
    ];
    var total = 0, seg = {};
    parts.forEach(function (p) { total += p.value; seg[p.segment] = (seg[p.segment] || 0) + p.value; });
    return {
      total: total, parts: parts, segments: seg,
      // With daily collateral: what the wallet needs Monday to Thursday, when only the weekday amount sits at ECC.
      weekdayTotal: total - peakC + weekdayC,
      ecc: { key: split.key, C: peakC, mode: daily ? 'daily' : 'static', weekday: weekdayC, peak: peakC, perDay: perDay, form: form, targets: tg, baseLimits: bl, binding: binding, windows: ws },
      settlement: { windows: ws, need: cash.need + carry, flows: cash.need, float: carry, path: cash.path },
      brp: { basis: marginal ? 'marginal' : 'standalone', rule: ruleId, other: ruleId === 'current' ? 'draft' : 'current', current: cur, draft: dr, security: security, volume: V, price: pAvg, weekly: wk, ramp: ramp, exit: exit },
      tennet: { invoice: invoice, debit: debit, account: account, weekly: wk }
    };
  }

  /* Everything the page shows for one set of settings. */
  function compute(st) {
    var exp = scenario(st, {}), str = scenario(st, { stress: true });
    var sens = [
      { id: 'vol+', label: 'Volumes +50%', total: scenario(st, { volMult: 1.5 }).total },
      { id: 'vol-', label: 'Volumes −50%', total: scenario(st, { volMult: 0.5 }).total },
      { id: 'price', label: 'All prices at the stress price', total: scenario(st, { priceStress: true }).total },
      { id: 'imb', label: 'Imbalance twice the assumption', total: scenario(st, { imbMult: 2 }).total }
    ];
    return { settings: st, expected: exp, stress: str, sensitivity: sens, segments: SEGMENTS, assumptions: assumptions(st) };
  }

  function assumptions(st) {
    var out = [];
    GROUPS.forEach(function (g) { g.fields.forEach(function (fl) { if (fl.tag !== 'input') out.push({ group: g.title, key: fl.key, label: fl.label, value: st[fl.key], unit: fl.unit, kind: fl.kind, tag: fl.tag, src: fl.src }); }); });
    return out;
  }

  return { GROUPS: GROUPS, BASE: BASE, PRESETS: PRESETS, SEGMENTS: SEGMENTS, preset: preset, scenario: scenario, compute: compute,
           strategyVolumes: strategyVolumes, defaultAnswers: defaultAnswers, fromAnswers: fromAnswers, suggestBalance: suggestBalance };
})(typeof LimitEngine !== 'undefined' ? LimitEngine : require('../engine.js'),
   typeof WalletBehaviour !== 'undefined' ? WalletBehaviour : require('./behaviour.js'),
   typeof WalletSettlement !== 'undefined' ? WalletSettlement : require('./settlement.js'),
   typeof WalletEccLink !== 'undefined' ? WalletEccLink : require('./ecc-link.js'),
   typeof WalletBrp !== 'undefined' ? WalletBrp : require('./brp.js'),
   typeof WalletTennet !== 'undefined' ? WalletTennet : require('./tennet-account.js'));
if (typeof module !== 'undefined') module.exports = WalletCalc;
