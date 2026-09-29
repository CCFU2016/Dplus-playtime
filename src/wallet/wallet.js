/* Direct+ wallet: what one member needs, by purpose and by wallet segment (docs/wallet-model.md). Each member is treated
   as its own BRP, and the wallet pools all members at one connected bank, so nothing nets between members
   (wallet-model §11.1). WalletCalc is the one object the pages use: the calculation, plus the settings (settings.js)
   and the prospect questionnaire (answers.js). */
const WalletCalc = ((Engine, Dates, Behaviour, Settlement, EccLink, Brp, Tennet, OpenPosition, Settings, Answers) => {
  'use strict';

  const SEGMENTS = {
    trading: 'Trading collateral (at ECC)',
    brp: 'BRP collateral',
    available: 'Available balance',
  };

  const SENSITIVITIES = [
    { id: 'vol+', label: 'Volumes +50%', variant: { volMult: 1.5 } },
    { id: 'vol-', label: 'Volumes −50%', variant: { volMult: 0.5 } },
    { id: 'price', label: 'All prices at the stress price', variant: { priceStress: true } },
    { id: 'imb', label: 'Imbalance twice the assumption', variant: { imbMult: 2 } },
  ];

  const RULE_NAMES = { current: 'TenneT rule', draft: 'Draft rule' };

  const UNREACHABLE =
    'The targets cannot be reached with this split: a market with a 0% share only has its base limit.';
  const SAME_AMOUNT = 0.5; // a carried amount within 50 cents of what the trading needs is enough

  /** A setting that may be left blank: null when it is, else a number. */
  const optional = (value) => (value == null || value === '' ? null : +value);

  /** The MW list setting ('30, 15') as numbers, ignoring anything that is not a positive number. */
  const listMW = (value) =>
    String(value || '')
      .split(/[,;\s]+/)
      .filter((part) => part !== '')
      .map(Number)
      .filter((mw) => Number.isFinite(mw) && mw > 0);

  const highestC = (days) => (days.length ? Math.max(...days.map((day) => day.C)) : null);

  /** Whether the open-position buffer, not the rule, sets a BRP result's collateral. */
  const openSets = (brp) => !!brp.open && brp.open.amount > brp[brp.rule].security;

  /** The daily trading plan, as WalletBehaviour.dayFlows() reads it. */
  function tradingPlan(st, stress, volMult) {
    return {
      price: st.price,
      negShare: st.negShare,
      negPrice: st.negPrice,
      cont: { buy: st.contBuy * volMult, sell: st.contSell * volMult },
      auc: { buy: st.aucBuy * volMult, sell: st.aucSell * volMult, limitPrice: optional(st.aucLimitPrice) },
      lossShare: stress ? st.lossShare : 0,
    };
  }

  /**
   * ECC settlement (wallet-model §3): the cash that the daily collections need, and two buffers on top.
   *   float    purchases paid one collection before their sale (bought before the 16:00 cut, sold after it). Each
   *            collection pays the new carried purchases and receives the previous ones, so the amount stays.
   *   bad days room for one bad day's trading loss in a normal week and two in a tough week, not a loss every day
   *            (Direct+ decision). A bad day moves the price against the largest open position: the M7 buys not yet
   *            sold again (1 − s of them) and the auction buys, which stay open until sold or used. Traders only: for
   *            aggregators and asset owners buying is a planned cost that the collections already cover.
   */
  function settlementNeed({ st, days, flowOf, stress, priceFactor, volMult }) {
    const windows = Settlement.windows(days, flowOf, () => st.feesPerWindow || 0);
    const cash = Settlement.cashPath(windows, st.replenish);
    const float = (st.carryShare || 0) * (st.contBuy + st.aucBuy) * volMult * st.price * priceFactor;
    const openMWh = ((1 - (+st.s || 0)) * st.contBuy + st.aucBuy) * volMult;
    const badDays = +(stress ? st.badDaysStress : st.badDays) || 0;
    const badDay = badDays * openMWh * (+st.badMove || 0);
    return {
      windows,
      need: cash.need + float + badDay,
      flows: cash.need,
      float,
      badDay,
      badDays,
      openMWh,
      path: cash.path,
    };
  }

  /**
   * ECC trading collateral (wallet-model §2) for the week's calculation days, at the split chosen (splitMode).
   *   Static collateral is one amount all week. With 'daily' the member changes it every business day (Direct+
   *   decision): less during the week, more before weekends and holidays, each day with its own cheapest split when
   *   that is the choice. ASSUMPTION: a change is in place by that day's evening calculation; how fast the Direct+
   *   platform applies it is open (open question W4).
   *   An amount carried over from the limit calculator (eccCollateral) sits at ECC as it is. What the trading needs is
   *   still worked out, so that the page can say when the amount falls short (fixed.short).
   *   A cap limit (ECC, optional) caps the collateral that counts for limits: collateral needed above it is out of
   *   reach (overCap).
   */
  function eccCollateral({ st, days, flowOf, stress, priceFactor }, windows) {
    const restingCont = st.restingCont * priceFactor;
    const targets = EccLink.targets(days, flowOf, st.s, restingCont);
    const baseLimits = EccLink.baseLimits({
      restingCont,
      eveningCont: st.eveningCont * priceFactor,
      updateHour: +(stress ? st.stressUpdateHour : st.updateHour),
      restingAuc: st.restingAuc * priceFactor,
      restingAucWeekend: st.restingAucWeekend * priceFactor,
      override: {
        cont: { bd: optional(st.blContBD), nbd: optional(st.blContNBD) },
        da: { bd: optional(st.blAucBD), nbd: optional(st.blAucNBD) },
      },
    });
    const openRisk = Object.fromEntries(windows.map((window) => [window.close, window.OR]));
    const key = +st.key;
    const search = {
      days,
      key,
      measure: st.measure,
      bl: baseLimits,
      OR: (date) => openRisk[date],
      cont: (date) => targets.cont[date],
      auc: (date) => targets.auc[date] || 0,
    };
    const carried = optional(st.eccCollateral);
    const found = st.splitMode === 'mine' ? { key, C: EccLink.solve(search, key) } : EccLink.cheapest(search);
    const split = found && found.C !== null ? found : { key, C: null };
    if (split.C === null && carried === null) throw new Error(UNREACHABLE);

    // The calculation day that sets the amount: the one that needs the most collateral on its own.
    let binding = null;
    for (const day of days) {
      const C = EccLink.solve({ ...search, days: [day] }, split.key);
      if (!binding || C > binding.C) {
        binding = { date: Engine.iso(day), C, gap: Dates.daysBetween(day, Engine.nextBD(day)) };
      }
    }

    // Each calculation day on its own. For one day the engine's own search gives the same answer as EccLink.solve().
    const perDay = days.map((day) => {
      const date = Engine.iso(day);
      const next = Engine.nextBD(day);
      let aucTarget = 0;
      for (const auctionDay of Dates.eachDay(Dates.addDays(day, 1), next)) {
        aucTarget = Math.max(aucTarget, targets.auc[Engine.iso(auctionDay)] || 0);
      }
      const params = { OR: openRisk[date], ...EccLink.marketParams(baseLimits, key) };
      const target = {
        cont: targets.cont[date],
        contMeasure: st.measure || 'l18',
        da: aucTarget,
        daNonBD: !!st.weekend,
      };
      const best =
        st.splitMode === 'mine'
          ? { key, C: Engine.solve([day], params, target) }
          : Engine.cheapestKey([day], params, target);
      return { date, gap: Dates.daysBetween(day, next), key: best ? best.key : null, C: best ? best.C : null };
    });
    if (carried === null && perDay.some((one) => one.C === null)) throw new Error(UNREACHABLE);

    const fixed =
      carried === null
        ? null
        : { C: carried, need: split.C, short: split.C === null || split.C > carried + SAME_AMOUNT };
    const daily = !fixed && st.collateralMode === 'daily';
    let C = split.C;
    let weekday = split.C;
    if (fixed) {
      C = carried;
      weekday = carried;
    } else if (daily) {
      C = highestC(perDay);
      weekday = highestC(perDay.filter((one) => one.gap === 1)) ?? C;
    }
    const cap = optional(st.cap);
    return {
      key: split.key,
      C,
      mode: daily ? 'daily' : 'static',
      weekday,
      perDay,
      overCap: cap !== null && C > cap,
      fixed,
      targets,
      baseLimits,
      binding,
    };
  }

  /** The volume (MWh a day) that the imbalance is measured against: the imbBase setting. */
  function imbalanceBase(basis, { buys, sells, nominated }) {
    if (basis === 'nominated') return nominated;
    if (basis === 'production') return Math.max(sells - buys, 0); // the net sold volume
    return buys + sells;
  }

  /** The weekly imbalance invoice (wallet-model §6.2). An aggregator's non-delivery is imbalance that is always short. */
  function weeklyImbalance({ st, volumes, priceFactor, imbMult }) {
    return Tennet.weekly({
      volume: imbalanceBase(st.imbBase, volumes) * 7,
      share: st.imbShare * imbMult,
      bias: st.bias,
      price: st.price * priceFactor,
      state2Share: st.state2Share,
      state2Gap: st.state2Gap,
      cv: st.cv,
      shortVolume: st.nonDelivery * volumes.nominated * 7 * imbMult,
    });
  }

  /* The member's highest daily net volume (MWh) as the BRP rules read it (INTERPRETATION settings, wallet-model §4.3).
     Reading (ii) nets per settlement period, so volume bought and sold in different periods (shiftShare) counts twice.
     'max' takes the largest single counterparty (the exchange, or the BRPs it nominates from); 'total' nets them all. */
  function brpVolume({ st, volumes: { buys, sells, nominated } }) {
    const shift = st.perPeriod === 'ii' ? st.shiftShare : 0;
    const net = (buy, sell) => Math.abs(buy - sell) + 2 * Math.min(buy, sell) * shift;
    return st.counterparties === 'total' ? net(buys + nominated, sells) : Math.max(net(buys, sells), nominated);
  }

  /**
   * BRP collateral on the member's own figures (wallet-model §4). Direct+ members put up their marginal collateral:
   * no minimum and no volume floors, which apply once to the Direct+ BRP (Direct+ decision). They also cover what they
   * may leave open (the open-position buffer, §4.5), and put up whichever of the two is larger: a member whose
   * imbalance already counts in the rule doesn't pay for it twice. 'standalone' is the member as its own BRP, with the
   * minimum and the floors and without the buffer, for comparison.
   */
  function brpCollateral(run, weekly) {
    const { st, days, hot, stress } = run;
    const marginal = st.brpBasis !== 'standalone';
    const volume = brpVolume(run);
    // €40 for now (Direct+ decision), in a tough week too; blank: the market's average price.
    const price = optional(st.brpPrice) ?? (hot ? st.stressAvgPrice : st.price);
    const rule = Brp.ruleFor(Engine.iso(days[0]), st.rule);
    const current = Brp.current({
      volume,
      price3m: price,
      capacityMW: Brp.countedCapacity(listMW(st.connectionsMW), st.between),
      reading: st.reading,
      floors: !marginal,
    });
    const { sigmaCD } = Brp.RULES.draft;
    const draft = Brp.draft({
      A: volume * price,
      B: stress ? Tennet.stressB(weekly.mean, weekly.sd, { sigma: st.sigma }) : weekly.B,
      C: st.profileMean + sigmaCD * st.profileSd, // in steady state: the monthly invoice's mean + ½σ
      D: st.smartMean + sigmaCD * st.smartSd,
      minimum: !marginal,
    });
    const ramp = Brp.rampUp({
      A: volume * price,
      weekly: weekly.mean,
      weeklySd: weekly.sd,
      profile: st.profileMean,
      profileSd: st.profileSd,
      smart: st.smartMean,
      smartSd: st.smartSd,
      sigma: st.sigma,
      minimum: !marginal,
      lagWeeks: +st.debitLagWeeks,
    });
    const exit = Tennet.exitTail(Engine.iso(Dates.addDays(days[0], 6)), {
      profile: st.profileMean !== 0 || st.profileSd > 0,
      smart: st.smartMean !== 0 || st.smartSd > 0,
    });
    // What the member may leave open, when it may (null otherwise).
    const open =
      marginal && +st.openCap > 0
        ? OpenPosition.buffer({ cap: +st.openCap, days: +st.openDays || 0, percentile: st.openPercentile })
        : null;
    const ruleSecurity = (rule === 'current' ? current : draft).security;
    return {
      basis: marginal ? 'marginal' : 'standalone',
      rule,
      other: rule === 'current' ? 'draft' : 'current',
      current,
      draft,
      open,
      security: open ? Math.max(ruleSecurity, open.amount) : ruleSecurity,
      volume,
      price,
      ramp,
      exit,
    };
  }

  /**
   * One scenario for settings `st`. variant = { stress, priceStress, volMult, imbMult }:
   *   stress       the tough week: stress prices and averages, the stress loss share and update hour, two bad days,
   *                and B at its 95th percentile
   *   priceStress  every price at the stress price, and nothing else (a sensitivity)
   *   volMult, imbMult  scale the volumes or the imbalance (sensitivities)
   */
  function scenario(st, { stress = false, priceStress = false, volMult = 1, imbMult = 1 } = {}) {
    const hot = stress || priceStress;
    const priceFactor = hot ? st.stressPrice / st.price : 1;
    const plan = tradingPlan(st, stress, volMult);
    const prices = {
      maxMarket: optional(st.aucMaxPrice),
      minMarket: optional(st.aucMinPrice),
      minReal: optional(st.realMin),
      maxReal: optional(st.realMax),
    };
    const run = {
      st,
      days: Engine.weekDays(st.week),
      flowOf: (day) => Behaviour.dayFlows(plan, priceFactor, Engine.isBD(Engine.parse(day)) || !!st.weekend, prices),
      stress,
      hot,
      priceFactor,
      volMult,
      imbMult,
      volumes: {
        buys: (st.contBuy + st.aucBuy) * volMult,
        sells: (st.contSell + st.aucSell) * volMult,
        nominated: st.nominatedIn * volMult,
      },
    };

    const settlement = settlementNeed(run);
    const ecc = eccCollateral(run, settlement.windows);
    const weekly = weeklyImbalance(run);
    const brp = brpCollateral(run, weekly);
    // The next imbalance invoice: the weekly mean, or in a tough week the mean plus two standard deviations (as
    // component B reads the invoices).
    const invoice = stress ? weekly.B : Math.max(weekly.mean, 0);
    const debit = Tennet.imbalanceDebit(Engine.iso(run.days[0]), +st.debitLagWeeks);

    const parts = [
      {
        id: 'ecc',
        label: 'ECC trading collateral',
        segment: 'trading',
        value: ecc.C,
        confidence: 'Estimate · ECC rule',
      },
      {
        id: 'settlement',
        label: 'ECC settlement',
        segment: 'available',
        value: settlement.need,
        confidence: 'Estimate · ECC rule',
      },
      {
        id: 'brp',
        label: brp.basis === 'marginal' ? 'BRP collateral (marginal)' : 'BRP security (TenneT)',
        segment: 'brp',
        value: brp.security,
        confidence: `${openSets(brp) ? 'Open-position buffer' : RULE_NAMES[brp.rule]} · Direct+ contract`,
      },
      { id: 'invoices', label: 'Imbalance invoices', segment: 'available', value: invoice, confidence: 'Estimate' },
    ];
    let total = 0;
    const segments = {};
    for (const part of parts) {
      total += part.value;
      segments[part.segment] = (segments[part.segment] || 0) + part.value;
    }
    return {
      total,
      parts,
      segments,
      // With daily collateral: what the wallet needs Monday to Thursday, when only the weekday amount sits at ECC.
      weekdayTotal: total - ecc.C + ecc.weekday,
      ecc,
      settlement,
      brp,
      tennet: { invoice, debit },
    };
  }

  /** Everything the pages show for one set of settings. */
  function compute(st) {
    return {
      settings: st,
      expected: scenario(st),
      stress: scenario(st, { stress: true }),
      sensitivity: SENSITIVITIES.map(({ id, label, variant }) => ({ id, label, total: scenario(st, variant).total })),
      segments: SEGMENTS,
      assumptions: Settings.assumptions(st),
    };
  }

  return {
    SEGMENTS,
    scenario,
    compute,
    openSets,
    GROUPS: Settings.GROUPS,
    BASE: Settings.BASE,
    PRESETS: Settings.PRESETS,
    preset: Settings.preset,
    suggestBalance: Answers.suggestBalance,
    strategyVolumes: Answers.strategyVolumes,
    defaultAnswers: Answers.defaultAnswers,
    fromAnswers: Answers.fromAnswers,
  };
})(
  typeof LimitEngine !== 'undefined' ? LimitEngine : require('../engine.js'),
  typeof WalletDates !== 'undefined' ? WalletDates : require('./dates.js'),
  typeof WalletBehaviour !== 'undefined' ? WalletBehaviour : require('./behaviour.js'),
  typeof WalletSettlement !== 'undefined' ? WalletSettlement : require('./settlement.js'),
  typeof WalletEccLink !== 'undefined' ? WalletEccLink : require('./ecc-link.js'),
  typeof WalletBrp !== 'undefined' ? WalletBrp : require('./brp.js'),
  typeof WalletTennet !== 'undefined' ? WalletTennet : require('./tennet-account.js'),
  typeof WalletOpenPosition !== 'undefined' ? WalletOpenPosition : require('./open-position.js'),
  typeof WalletSettings !== 'undefined' ? WalletSettings : require('./settings.js'),
  typeof WalletAnswers !== 'undefined' ? WalletAnswers : require('./answers.js'),
);
if (typeof module !== 'undefined') module.exports = WalletCalc;
