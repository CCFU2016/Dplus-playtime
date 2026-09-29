// wallet.js: the combined result per member, the presets, the settings list and the questionnaire
// (docs/wallet-model.md §7, §8, §11.1 and §12).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/wallet/wallet.js');
const { assertMoney } = require('../helpers.js');

// The worked example (§8) is a larger desk than today's trader preset: the preset's volumes before it was resized to
// about 150 MWh a day (26 Sep 2026); everything else is the preset. It also keeps the €80 normal price (BRP at the
// market averages) and the loss rule of that time: 5% of gross buys lost every business day in a tough week, and no
// bad days. It predates the open-position buffer (29 Sep 2026), so it leaves nothing open.
const LARGE_DESK = {
  openCap: 0,
  contBuy: 240,
  contSell: 240,
  aucBuy: 100,
  aucSell: 100,
  restingCont: 10000,
  eveningCont: 5000,
  s: 0,
  lossShare: 0.05,
  badDays: 0,
  badDaysStress: 0,
  price: 80,
  stressAvgPrice: 120,
  brpPrice: null,
};
const desk = (extra = {}) => ({ ...C.preset('trader'), ...LARGE_DESK, ...extra });
const ft = C.compute(desk());
const MEMBERS = Object.keys(C.PRESETS);

test('the worked example (§8.5): a financial trader, week of 5 Oct 2026', () => {
  // Direct+ members put up their marginal BRP collateral, with no minimum (Direct+ decision, 26 Sep 2026): a flat
  // trader without connections adds nothing.
  assertMoney(ft.expected.total, 133994.25, 'expected total');
  assertMoney(ft.stress.total, 467883.25, 'stress total');
  const parts = (scenario) => scenario.parts.map((part) => [part.id, Math.round(part.value * 100) / 100]);
  assert.deepEqual(
    parts(ft.expected),
    [
      ['ecc', 125745],
      ['settlement', 8160],
      ['brp', 0],
      ['invoices', 89.25],
    ],
    'expected parts',
  );
  assert.deepEqual(
    parts(ft.stress),
    [
      ['ecc', 406594],
      ['settlement', 55250],
      ['brp', 0],
      ['invoices', 6039.25],
    ],
    'stress parts',
  );
  // ECC nets each business day, but purchases sold only after the 16:00 cut are paid one collection before the sale
  // comes back. The trader carries 30% of a day's buys: a float of 0.3 × 340 MWh × €80, and × €250 in stress.
  assertMoney(ft.expected.settlement.float, 8160, 'settlement float (expected)');
  assertMoney(ft.stress.settlement.float, 25500, 'settlement float (stress)');
  assertMoney(ft.stress.settlement.flows, 29750, 'the stress loss share on top of the float');
  assert.deepEqual(
    [ft.expected.ecc.key, ft.expected.ecc.binding.date],
    [53, '2026-10-09'],
    '53/47, set by the Friday calculation',
  );
  assert.deepEqual(
    [ft.expected.brp.rule, ft.expected.brp.basis],
    ['open', 'marginal'],
    'marginal collateral; without assets, the open-position rule in place of the rule in force (nothing left open: €0)',
  );
  assertMoney(ft.expected.brp.draft.security, 7973, 'under the draft, 4B = 4 × 1,993.25 and no minimum');
  const { trading, brp, available } = ft.expected.segments;
  assertMoney(trading + brp + available, ft.expected.total, 'the segments add up to the total');
});

test('Direct+ accepts cash only, and a cap limit is flagged', () => {
  assert.deepEqual(
    ft.expected.parts.map((part) => part.id),
    ['ecc', 'settlement', 'brp', 'invoices'],
    'four parts',
  );
  const result = JSON.stringify(ft);
  assert.ok(!result.includes('efaultFund') && !result.includes('guarantee'), 'no default fund or guarantee');
  assert.ok(!ft.expected.ecc.overCap, 'no cap limit, nothing flagged');
  assert.ok(C.compute(desk({ cap: 100000 })).expected.ecc.overCap, 'collateral above the cap limit is flagged');
});

test('on your own as a BRP (for comparison), the minimum and the 50 MW floors apply', () => {
  const alone = C.compute(desk({ brpBasis: 'standalone' }));
  assertMoney(alone.expected.total, 325994.25, 'expected (1,200 MWh reading: 2 × 1,200 × €80)');
  assertMoney(alone.stress.total, 755883.25, 'stress');
  assertMoney(alone.expected.brp.draft.security, 96000, 'the draft gives the €96,000 minimum');
  assertMoney(
    C.compute(desk({ brpBasis: 'standalone', reading: 'flat' })).expected.total,
    229994.25,
    'the flat €96,000 reading',
  );
  assertMoney(
    C.compute(desk({ reading: 'flat' })).expected.total,
    133994.25,
    'the 50 MW reading does not affect the marginal basis',
  );
});

test('marginal BRP collateral: the rule on the member’s own figures, never below €0', () => {
  const aggregator = C.compute(C.preset('aggregator')).expected.brp;
  const asset = C.compute(C.preset('asset')).expected.brp;
  assertMoney(
    aggregator.security,
    121 * 40 * 2,
    'aggregator: 121 MWh a day with one counterparty, 2 × A at €40, no floors',
  );
  assertMoney(asset.security, 95 * 40 + 26 * 24 * 40, 'asset: A + B = 95 × 40 + 26 MW × 24 × 40 (BRP at €40 for now)');
  const earning = C.compute({ ...C.preset('asset'), week: '2027-10-04', bias: -1, cv: 0.1, imbShare: 0.5 }).expected
    .brp;
  assert.ok(
    earning.draft.sum < 0 && earning.security === 0,
    'a member whose imbalance earns money adds €0, not a negative amount',
  );
});

test('the open-position rule (§4.5): for a member without assets, in place of the rule in force', () => {
  // The trader preset may leave 20 MWh a day open, one day at risk, at the 2025 daily 99th percentile, €255.86/MWh.
  const trader = C.compute(C.preset('trader'));
  const { brp } = trader.expected;
  assert.deepEqual(
    [brp.rule, brp.other, brp.open.cap, brp.open.days, brp.open.id, brp.open.side, brp.open.price],
    ['open', 'draft', 20, 1, 'p99', 'short', 255.86],
    'no assets: the open-position rule, with the draft from 2027 as the other rule',
  );
  assertMoney(brp.current.security, 0, "TenneT's rule in force would have given a flat trader €0");
  assertMoney(brp.security, 20 * 1 * 255.86, 'its BRP collateral: 20 × 1 × €255.86');
  assertMoney(trader.stress.brp.security, 5117.2, 'the same in a tough week');

  // Without assets, what the plan leaves open counts when it is more than the cap: selling 110 MWh a day more than it
  // buys is an open short of 110; buying 110 more is an open long, which loses less than the allowed short.
  const set = (extra) => C.compute({ ...C.preset('trader'), ...extra }).expected.brp;
  assertMoney(set({ contBuy: 11, contSell: 99, aucBuy: 3, aucSell: 25 }).security, 110 * 255.86, 'mainly selling');
  assertMoney(set({ contBuy: 99, contSell: 11, aucBuy: 25, aucSell: 3 }).security, 20 * 255.86, 'mainly buying');
  const connected = set({ connectionsMW: '5' });
  assert.ok(
    connected.rule === 'current' && C.openSets(connected),
    'with assets: the rule in force, and the buffer as the larger of the two',
  );

  // Under the 2027 draft, the imbalance invoices count (4B): the larger of the two, not both.
  const draft = C.compute({ ...C.preset('trader'), week: '2027-10-04' });
  assertMoney(draft.expected.brp.draft.security, 2004.45, 'normal week: 4B is €2,004');
  assertMoney(draft.expected.brp.security, 5117.2, 'normal week: the buffer is larger');
  assert.ok(
    !C.openSets(draft.stress.brp) && draft.stress.brp.security === draft.stress.brp.draft.security,
    'tough week: the draft is larger, and the buffer adds nothing on top',
  );

  assertMoney(set({ openPercentile: 'p98', openDays: 3 }).security, 20 * 3 * 220.63, 'p98, three days at risk');
  assertMoney(set({ openMeasure: 'spread' }).security, 20 * 162.62, 'the spread over day-ahead at p99: €162.62');
  assertMoney(set({ openCap: 0 }).security, 0, 'nothing left open, nothing to cover');
  const alone = set({ brpBasis: 'standalone' });
  assert.ok(
    alone.rule === 'current' && alone.open === null && alone.security === alone.current.security,
    "on your own as a BRP: TenneT's rule, no buffer",
  );
  for (const id of ['aggregator', 'asset']) {
    assert.equal(C.compute(C.preset(id)).expected.brp.open, null, `${id}: nothing left open by default, no buffer`);
  }
});

test('the week, the rule, the split and the auction prices move the right parts', () => {
  const easter = C.compute(desk({ week: '2027-03-22' })).expected;
  assert.deepEqual(
    [easter.brp.rule, easter.ecc.binding.date, easter.ecc.binding.gap],
    ['draft', '2027-03-25', 5],
    'Easter 2027: the draft, and the Thursday before the five-day holiday sets the amount',
  );
  assert.equal(
    C.compute(desk({ week: '2027-03-22', rule: 'current' })).expected.brp.rule,
    'open',
    'the rule in force can be chosen (for a member without assets, the open-position rule in its place)',
  );
  assert.ok(
    C.compute(desk({ splitMode: 'mine', key: 60 })).expected.ecc.C > 125745,
    'your own split needs more than the cheapest',
  );
  assert.throws(
    () => C.compute(desk({ aucLimitPrice: null })),
    Error,
    'auction buys without a limit price and no market maximum',
  );
  const atMaximum = C.compute(desk({ aucLimitPrice: null, aucMaxPrice: 4000 })).expected.ecc.C;
  assert.ok(atMaximum > 1000000, 'orders without a limit price at a €4,000 market maximum need far more collateral');
});

test('every preset gives finite totals, and the sensitivities move the right way', () => {
  for (const id of MEMBERS) {
    const result = C.compute(C.preset(id));
    const { total } = result.expected;
    assert.ok(Number.isFinite(total) && Number.isFinite(result.stress.total), `${id}: finite totals`);
    assert.ok(result.stress.total >= total, `${id}: stress ≥ expected`);
    const moved = Object.fromEntries(result.sensitivity.map((one) => [one.id, one.total]));
    assert.ok(moved['vol+'] >= total && moved['vol-'] <= total && moved.imb >= total, `${id}: sensitivities`);
  }
});

test('the settings list covers every setting, with its source', () => {
  const listed = new Set(C.GROUPS.flatMap((group) => group.fields.map((field) => field.key)));
  assert.deepEqual(
    Object.keys(C.BASE).filter((key) => key !== 'week' && !listed.has(key)),
    [],
    'every setting is listed',
  );
  for (const id of MEMBERS) {
    const unknown = Object.keys(C.PRESETS[id].values).filter((key) => !(key in C.BASE));
    assert.deepEqual(unknown, [], `${id}: the preset uses known settings only`);
  }
  assert.ok(ft.assumptions.length > 30, 'the assumptions list');
  assert.ok(
    ft.assumptions.every((a) => a.src && a.tag !== 'input'),
    'every non-input setting, with a source',
  );
});

test('collateral at ECC: static, or optimised by day', () => {
  // Static: one amount all week, set by the Friday calculation. Daily (Direct+ decision, 26 Sep 2026): each calculation
  // day on its own, with its own cheapest split; the wallet needs the peak only around the weekend.
  assert.deepEqual(
    [ft.expected.ecc.mode, ft.expected.weekdayTotal],
    ['static', ft.expected.total],
    'static: one amount all week',
  );
  const daily = C.compute(desk({ collateralMode: 'daily' })).expected;
  assert.deepEqual(
    daily.ecc.perDay.map((day) => [day.date.slice(5), day.C, day.key]),
    [
      ['10-05', 58681, 47],
      ['10-06', 58681, 47],
      ['10-07', 58681, 47],
      ['10-08', 58681, 47],
      ['10-09', 125745, 53],
    ],
    'daily: €58,681 Monday to Thursday, €125,745 on Friday',
  );
  assert.deepEqual([daily.ecc.weekday, daily.ecc.C], [58681, 125745], 'daily: the weekday level and the weekend peak');
  assertMoney(daily.weekdayTotal, 58681 + 8160 + 89.25, 'daily: the wallet needs €66,930 during the week');
  assertMoney(daily.total, ft.expected.total, 'daily: the peak around the weekend is the static amount here');
  assert.ok(
    daily.ecc.perDay.every((day) => day.C <= ft.expected.ecc.C),
    'no day needs more than the static amount',
  );
});

test('the prospect questionnaire: default answers give each preset, and answers move the right settings', () => {
  const answers = (type, extra = {}) => ({ ...C.defaultAnswers(type), ...extra });
  for (const id of MEMBERS) {
    const settings = C.fromAnswers(C.defaultAnswers(id));
    const preset = C.preset(id);
    const differ = Object.keys(preset).filter((key) => String(preset[key]) !== String(settings[key]));
    assert.deepEqual(differ, [], `${id}: the default answers reproduce the preset`);
  }
  const continuous = C.fromAnswers(answers('trader', { markets: 'continuous' }));
  assert.deepEqual(
    [continuous.aucBuy, continuous.aucSell, continuous.contBuy],
    [0, 0, 55],
    'continuous only: no auction volumes',
  );
  const doubled = C.fromAnswers(answers('trader', { contBuy: 110 }));
  assert.deepEqual(
    [doubled.restingCont, doubled.eveningCont],
    [4600, 2300],
    'resting orders and evening buying scale with buying',
  );
  assert.deepEqual(
    C.strategyVolumes('aggregator', 'flat'),
    { cont: { buy: 20, sell: 20 }, auc: { buy: 49, sell: 49 } },
    'a flat strategy splits the volumes evenly (97 MWh: 48.5 each, rounded)',
  );
  assert.deepEqual(
    C.strategyVolumes('trader', 'buyer'),
    { cont: { buy: 99, sell: 11 }, auc: { buy: 25, sell: 3 } },
    'a buyer buys 90%',
  );
  const sites = C.fromAnswers(answers('asset', { capacityMW: 45, sites: 3 }));
  assert.deepEqual(
    [sites.connectionsMW, sites.smartSd, sites.shiftShare],
    ['15, 15, 15', 450, 1],
    'portfolio: equal sites, reconciliation spread from capacity, production with consumption shifts between periods',
  );
  const production = { portfolio: { production: true, consumption: false }, capacityMW: 20, sites: 1 };
  const trader = C.fromAnswers(answers('trader', production));
  assert.deepEqual([trader.connectionsMW, trader.shiftShare], ['20', 0], 'a trader with 20 MW of production: one site');
  const noAssets = C.fromAnswers(
    answers('trader', { ...production, portfolio: { production: false, consumption: false } }),
  );
  assert.equal(noAssets.connectionsMW, '', 'no assets ticked: the capacity is ignored');
  assert.deepEqual(
    [
      C.suggestBalance('trader', { production: true }),
      C.suggestBalance('asset', { consumption: true }),
      C.suggestBalance('trader', {}),
    ],
    ['forecast', 'normal', 'tight'],
    'the portfolio suggests how closely positions are matched',
  );
  assert.deepEqual(
    [
      C.fromAnswers(answers('trader', { weekend: 'no' })).weekend,
      C.fromAnswers(answers('trader', { weekend: 'both' })).weekend,
    ],
    [false, true],
    'weekends: no, and "show me both" maps to trading at weekends (the page runs both)',
  );
  assertMoney(
    C.compute(C.fromAnswers(answers('trader', { carry: 'none' }))).expected.settlement.float,
    0,
    'no positions over 16:00',
  );
});

test('the presets compare like with like', () => {
  const volume = (id) => {
    const settings = C.preset(id);
    return settings.contBuy + settings.contSell + settings.aucBuy + settings.aucSell;
  };
  assert.deepEqual(MEMBERS.map(volume), [138, 137, 137], 'MWh a day traded');
  assert.ok(
    MEMBERS.every((id) => Math.abs((volume(id) * 365) / 1000 - 50) < 0.5),
    'about 50 GWh a year each, within 0.5 GWh',
  );
  assert.deepEqual(
    MEMBERS.map((id) => C.preset(id).s),
    [0.34, 0, 0],
    "the trader's largest open position is 66% of its buys",
  );
  const trader = C.defaultAnswers('trader');
  assert.deepEqual(
    [trader.netting, C.fromAnswers(trader).s],
    ['mixed', 0.34],
    'traders: buys and sells mixed by default',
  );
  const totals = ['block', 'mixed', 'flat'].map(
    (netting) => C.compute(C.fromAnswers({ ...C.defaultAnswers('trader'), netting })).expected.total,
  );
  assert.ok(
    totals[0] > totals[1] && totals[1] > totals[2],
    `more offsetting, less wallet: ${totals.map(Math.round).join(' / ')}`,
  );
  assert.equal(
    C.fromAnswers({ ...C.defaultAnswers('asset'), netting: 'flat' }).s,
    0,
    'the netting answer only applies to traders',
  );
  const wallets = MEMBERS.map((id) => C.compute(C.preset(id)).expected.total);
  assert.ok(
    Math.max(...wallets) <= 3 * Math.min(...wallets),
    `within a factor of 3: ${wallets.map(Math.round).join(' / ')}`,
  );
});

test('collateral carried over from the limit calculator: that amount, flagged when short', () => {
  const own = C.compute(C.preset('trader')).expected.ecc;
  const carried = (extra = {}) =>
    C.compute({
      ...C.preset('trader'),
      eccCollateral: own.C,
      splitMode: 'mine',
      key: own.key,
      blContBD: own.baseLimits.cont.bd,
      blContNBD: own.baseLimits.cont.nbd,
      blAucBD: own.baseLimits.da.bd,
      blAucNBD: own.baseLimits.da.nbd,
      ...extra,
    }).expected.ecc;
  const same = carried();
  assert.ok(
    Math.abs(same.C - own.C) < 0.5 && Math.abs(same.fixed.need - own.C) < 0.5 && !same.fixed.short,
    'its own setup carried back',
  );
  const short = carried({ eccCollateral: own.C - 5000 });
  assert.ok(short.C === own.C - 5000 && short.fixed.short, '€5,000 less than the trading needs is flagged as short');
  const lopsided = carried({ key: 100 });
  assert.ok(
    lopsided.fixed.need === null && lopsided.fixed.short,
    'a split that cannot reach the auction targets is short',
  );
  const larger = carried({ blContBD: 50000 });
  assert.ok(larger.baseLimits.cont.bd === 50000 && larger.fixed.need > own.C, 'carried base limits are used');
  assert.equal(C.compute(C.preset('trader')).expected.ecc.fixed, null, 'without a carried amount nothing is fixed');
});

test('bad days: room for one (normal week) or two (tough week), traders only', () => {
  // Direct+ decision, 26 Sep 2026: the open position × €100/MWh.
  const trader = C.compute(C.preset('trader'));
  assertMoney(
    trader.expected.settlement.openMWh,
    0.66 * 55 + 14,
    'trader: open position = 66% of 55 MWh M7 buys + 14 MWh auctions',
  );
  assertMoney(
    trader.expected.settlement.badDay,
    50.3 * 100,
    'trader, normal week: one bad day, 50.3 MWh × €100 = €5,030',
  );
  assertMoney(trader.stress.settlement.badDay, 2 * 50.3 * 100, 'trader, tough week: two bad days, €10,060');
  assertMoney(trader.stress.settlement.flows, 0, 'no loss every day in a tough week');
  assertMoney(
    C.compute(C.preset('asset')).expected.settlement.badDay,
    0,
    'asset owner: buying is a planned cost, no bad days',
  );
  assertMoney(
    C.compute(C.preset('aggregator')).stress.settlement.badDay,
    0,
    'aggregator: no bad days, not even in a tough week',
  );
  const buyer = C.compute(
    C.fromAnswers({
      ...C.defaultAnswers('asset'),
      strategy: 'buyer',
      contBuy: 40,
      contSell: 5,
      aucBuy: 60,
      aucSell: 5,
    }),
  );
  assert.ok(
    buyer.expected.settlement.flows > 0 && buyer.expected.settlement.badDay === 0,
    'a buying asset owner pays through settlement',
  );
  const noBuying = C.compute({ ...C.preset('trader'), contBuy: 0, aucBuy: 0 });
  assertMoney(noBuying.expected.settlement.badDay, 0, 'no buying, no bad-day loss');
});

test('BRP collateral: its price, and the daily net volume the rules read', () => {
  const asset = C.compute(C.preset('asset'));
  assert.deepEqual(
    [asset.expected.brp.price, asset.stress.brp.price],
    [40, 40],
    '€40/MWh for now, in a tough week too',
  );
  assert.equal(
    C.compute({ ...C.preset('asset'), brpPrice: '' }).expected.brp.price,
    100,
    'blank: the market average price',
  );
  // INTERPRETATION settings. The asset owner buys 21 and sells 116 MWh a day: net over the day 95 MWh; netted per
  // settlement period, the 21 MWh bought and sold in other periods count twice.
  const volume = (member, extra = {}) => C.scenario({ ...C.preset(member), ...extra }).brp.volume;
  assert.deepEqual(
    [volume('asset'), volume('asset', { perPeriod: 'ii' })],
    [95, 137],
    'reading (i) 95 MWh, reading (ii) 95 + 2 × 21',
  );
  // The aggregator buys 8 on the exchange, nominates 121 in and sells 129: the largest single counterparty is 121 MWh,
  // and all counterparties netted together come to zero.
  assert.deepEqual(
    [volume('aggregator'), volume('aggregator', { counterparties: 'total' })],
    [121, 0],
    'counterparties',
  );
});
