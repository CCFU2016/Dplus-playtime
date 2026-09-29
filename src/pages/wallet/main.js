/* Direct+ wallet calculator (internal): what one member needs in the Direct+ wallet, by purpose and by wallet segment,
   with every assumption in the Settings view. The calculation is WalletCalc (src/wallet/). Amounts are rounded to the
   nearest €1,000: they are estimates, not exact figures (a Direct+ decision); prices and typed amounts are shown as
   entered. */
(() => {
  'use strict';

  const E = LimitEngine;
  const C = WalletCalc;
  const {
    $,
    el,
    clear,
    euros,
    thousands,
    thousandsDiff,
    shortThousands,
    wholeNumber,
    dateLabel,
    tableHead,
    tableRow,
    hoverable,
    svgCanvas,
    barPath,
    niceStep,
    stackedBars,
    legendItem,
  } = PageUI;

  const FIELDS = C.GROUPS.flatMap((group) => group.fields);
  const fieldOf = (key) => FIELDS.find((field) => field.key === key);
  /** A stress price to the cent, so that the open-position buffer's line adds up: €255.86/MWh. */
  const perMWh = (price) => `€${price.toFixed(2)}/MWh`;

  // ---------- page state ----------

  let settings = C.preset('trader'); // the settings in use
  let preset = C.preset('trader'); // the member type's preset, to mark the settings changed from it
  let barsBy = 'purpose'; // the bars: by purpose or by wallet segment ('account')
  let timelineScenario = 'expected';
  let lastResult = null;
  settings.week = PageUI.nextMonday();
  preset.week = settings.week;

  // ---------- controls ----------

  function loadPreset(id) {
    const { week } = settings;
    settings = C.preset(id);
    preset = C.preset(id);
    settings.week = week;
    preset.week = week;
    buildSettings();
    schedule();
  }

  function setView(view, focusKey) {
    $('view-wallet').hidden = view !== 'wallet';
    $('view-settings').hidden = view !== 'settings';
    $('tab-wallet').setAttribute('aria-selected', view === 'wallet' ? 'true' : 'false');
    $('tab-settings').setAttribute('aria-selected', view === 'settings' ? 'true' : 'false');
    const field = focusKey && document.querySelector(`input[data-key="${focusKey}"], select[data-key="${focusKey}"]`);
    if (field) {
      field.scrollIntoView({ block: 'center' });
      field.focus();
    } else if (!focusKey) {
      window.scrollTo(0, 0);
    }
  }

  // ---------- the Settings view, generated from WalletCalc.GROUPS ----------

  const TAGS = {
    input: 'Your plan',
    ASSUMPTION: 'Assumed',
    INTERPRETATION: 'Interpretation',
    'ECC setting': 'ECC setting',
  };
  const tagOf = (tag) =>
    el('span', tag === 'ASSUMPTION' || tag === 'INTERPRETATION' ? 'tag assume' : 'tag', TAGS[tag] || tag);

  function toInput(field, value) {
    if (value == null) return '';
    return field.kind === 'share' ? Math.round(value * 10000) / 100 : value;
  }

  function fromInput(field, input) {
    if (field.kind === 'bool') return input.checked;
    if (field.kind === 'list') return input.value;
    if (field.kind === 'select') {
      const option = field.options.find(([value]) => String(value) === input.value);
      return option ? option[0] : input.value;
    }
    const value = parseFloat(input.value);
    if (input.value === '' || !Number.isFinite(value)) return field.kind === 'optional' ? null : 0;
    return field.kind === 'share' ? value / 100 : value;
  }

  function inputFor(field) {
    if (field.kind === 'select') {
      const select = el('select');
      for (const [value, text] of field.options) {
        const option = el('option', null, text);
        option.value = String(value);
        select.appendChild(option);
      }
      return select;
    }
    const input = el('input');
    if (field.kind === 'bool') {
      input.type = 'checkbox';
      return input;
    }
    input.type = field.kind === 'list' ? 'text' : 'number';
    if (field.kind !== 'list') input.step = 'any';
    if (field.kind === 'optional') input.placeholder = 'not set';
    return input;
  }

  function settingField(field) {
    const wrap = el('div', 'fld');
    wrap.dataset.field = field.key;
    const label = el('label', 'fl');
    label.htmlFor = `f-${field.key}`;
    label.appendChild(document.createTextNode(field.label));
    label.appendChild(tagOf(field.tag));
    wrap.appendChild(label);
    const box = el('div', 'fi');
    const input = inputFor(field);
    input.id = `f-${field.key}`;
    input.dataset.key = field.key;
    input.addEventListener(field.kind === 'select' || field.kind === 'bool' ? 'change' : 'input', () => {
      settings[field.key] = fromInput(field, input);
      if (field.key === 'rule') $('rule-quick').value = settings.rule;
      markChanged(field.key);
      schedule();
    });
    box.appendChild(input);
    if (field.unit) box.appendChild(el('span', 'unit', field.unit));
    wrap.appendChild(box);
    wrap.appendChild(el('div', 'src', field.src));
    return wrap;
  }

  function buildSettings() {
    const box = clear($('groups'));
    for (const group of C.GROUPS) {
      const section = el('section', 'panel sgroup');
      section.appendChild(el('h2', null, group.title));
      if (group.note) section.appendChild(el('p', 'note', group.note));
      const fields = el('div', 'fields');
      for (const field of group.fields) fields.appendChild(settingField(field));
      section.appendChild(fields);
      box.appendChild(section);
    }
    for (const field of FIELDS) syncField(field.key);
  }

  /** Shows a setting's current value in its input. */
  function syncField(key) {
    const field = fieldOf(key);
    const input = document.querySelector(`input[data-key="${key}"], select[data-key="${key}"]`);
    if (!field || !input) return;
    if (field.kind === 'bool') input.checked = Boolean(settings[key]);
    else if (field.kind === 'select') input.value = String(settings[key]);
    else input.value = toInput(field, settings[key]);
    markChanged(key);
  }

  function markChanged(key) {
    const wrap = document.querySelector(`[data-field="${key}"]`);
    if (wrap) wrap.classList.toggle('changed', String(settings[key]) !== String(preset[key]));
  }

  // ---------- the bars and the table by purpose ----------

  const PURPOSE_COLOR = {
    ecc: 'var(--p-ecc)',
    settlement: 'var(--p-settlement)',
    brp: 'var(--p-brp)',
    invoices: 'var(--p-invoices)',
  };
  const SEGMENT_ORDER = ['trading', 'available', 'brp'];
  const SEGMENT_COLOR = { trading: 'var(--s-trading)', available: 'var(--s-available)', brp: 'var(--s-brp)' };
  const LIGHT_FILL = new Set(['settlement', 'brp', 'invoices', 'available']); // dark label text in light mode

  function barItems(scenario) {
    if (barsBy === 'purpose') {
      return scenario.parts.map(({ id, label, value }) => ({ id, label, value, color: PURPOSE_COLOR[id] }));
    }
    return SEGMENT_ORDER.map((id) => ({
      id,
      label: C.SEGMENTS[id],
      value: scenario.segments[id] || 0,
      color: SEGMENT_COLOR[id],
    }));
  }

  function renderBars(result) {
    const rows = [
      { label: 'Expected', scenario: result.expected },
      { label: 'Stress', scenario: result.stress },
    ].map(({ label, scenario }) => ({
      label,
      total: scenario.total,
      totalText: thousands(scenario.total),
      segments: barItems(scenario).map((item) => ({
        value: item.value,
        color: item.color,
        lightInk: LIGHT_FILL.has(item.id),
        text: shortThousands(item.value),
        tip: { value: thousands(item.value), label: `${label} · ${item.label}` },
      })),
    }));
    stackedBars($('bars'), rows, 110);
    const legend = clear($('legend'));
    for (const item of barItems(result.expected)) legend.appendChild(legendItem(item.color, item.label));
    $('split-title').textContent = barsBy === 'purpose' ? 'By purpose' : 'By wallet segment';
    $('by-purpose').setAttribute('aria-pressed', barsBy === 'purpose' ? 'true' : 'false');
    $('by-account').setAttribute('aria-pressed', barsBy === 'account' ? 'true' : 'false');
  }

  function renderPurposeTable(result) {
    const table = clear($('purpose-table'));
    tableHead(table, [
      { text: 'Purpose' },
      { text: 'Wallet segment' },
      { text: 'Basis' },
      { text: 'Expected', className: 'r' },
      { text: 'Stress', className: 'r' },
    ]);
    const body = el('tbody');
    result.expected.parts.forEach((part, i) => {
      tableRow(body, [
        { node: legendItem(PURPOSE_COLOR[part.id], part.label) },
        { text: C.SEGMENTS[part.segment] },
        { node: el('span', 'tag', part.confidence) },
        { text: thousands(part.value), className: 'r' },
        { text: thousands(result.stress.parts[i].value), className: 'r' },
      ]);
    });
    const total = tableRow(body, [
      { text: 'Total' },
      { text: '' },
      { text: '' },
      { text: thousands(result.expected.total), className: 'r' },
      { text: thousands(result.stress.total), className: 'r' },
    ]);
    total.className = 'total';
    table.appendChild(body);
  }

  // ---------- one card per purpose ----------

  /** A link to a setting in the Settings view. */
  function lever({ key, label }) {
    const button = el('button', 'linkbtn', label);
    button.type = 'button';
    button.dataset.goto = 'settings';
    button.dataset.focus = key;
    return button;
  }

  function partCard(color, title, expected, stress, text, levers) {
    const card = el('section', 'panel card part');
    const heading = el('h3');
    const swatch = el('span', 'swatch');
    swatch.style.background = color;
    heading.appendChild(swatch);
    heading.appendChild(document.createTextNode(title));
    card.appendChild(heading);
    const value = el('div', 'pv');
    value.appendChild(document.createTextNode(thousands(expected)));
    if (Math.round(stress) !== Math.round(expected)) {
      value.appendChild(el('span', 'to', ' to '));
      value.appendChild(document.createTextNode(thousands(stress)));
    }
    card.appendChild(value);
    card.appendChild(el('p', null, text));
    const row = el('div', 'levers');
    row.appendChild(el('span', 'muted', 'Would lower it most:'));
    for (const one of levers) row.appendChild(lever(one));
    card.appendChild(row);
    return card;
  }

  function eccCard({ expected: x, stress: y, settings: st }) {
    const { ecc } = x;
    const binding = ecc.binding;
    let text =
      ecc.mode === 'daily'
        ? `Optimised by day: ${thousands(ecc.weekday)} on normal weekdays, ${thousands(ecc.C)} at the highest (the ` +
          'calculation before a weekend or holiday), each day with its own split. Static would be one amount all week.'
        : `Set by the calculation on ${dateLabel(binding.date)}` +
          (binding.gap > 1 ? `, whose limit has to last ${binding.gap} days until the next business day,` : '') +
          ` at a ${ecc.key} / ${100 - ecc.key} split between continuous and auctions.`;
    if (ecc.overCap || y.ecc.overCap) {
      text +=
        ` Your cap limit is ${thousands(+st.cap)}: collateral above it does not raise limits, so this plan needs ECC to ` +
        `raise the cap${ecc.overCap ? '.' : ' at the stress end.'}`;
    }
    const levers =
      binding.gap > 1 && st.weekend
        ? [
            { key: 'collateralMode', label: 'Collateral optimised by day' },
            { key: 'weekend', label: 'Weekend trading' },
          ]
        : [
            { key: 'contBuy', label: 'Continuous buying' },
            { key: 'aucLimitPrice', label: 'Auction bid prices' },
          ];
    return partCard('var(--p-ecc)', 'ECC trading collateral', ecc.C, y.ecc.C, text, levers);
  }

  function settlementCard({ expected: x, stress: y, settings: st }) {
    const se = x.settlement;
    let text = "ECC settles each business day's trades from the wallet as one net payment. ";
    if (se.float > 0.5) {
      text +=
        'Purchases you sell only after the 16:00 cut are paid one collection before the sale comes back, so about ' +
        `${thousands(se.float)} stays in the wallet as a float.` +
        (se.flows < 0.5
          ? ' Otherwise your buys and sells net to about zero.'
          : ` On top of that come the week's net purchases, ${thousands(se.flows)}.`);
    } else if (se.flows < 0.5) {
      text += 'Yours net to about zero or to money coming in, so apart from fees nothing has to wait in the wallet.';
    } else {
      text += 'This is the most ECC collects over the week before you top up.';
    }
    if (se.badDay > 0.5) {
      text +=
        ` It keeps room for ${se.badDays}${se.badDays === 1 ? ' bad day' : ' bad days'} (${y.settlement.badDays} at the ` +
        `stress end): €${wholeNumber.format(Math.round(st.badMove))} lost on each MWh of the open position, about ` +
        `${wholeNumber.format(Math.round(se.openMWh))} MWh, so ${thousands(se.badDay)}.`;
    }
    text += ' Fees are not included yet.';
    if (st.lossShare > 0) {
      text += ` The stress end also assumes a loss of ${Math.round(st.lossShare * 100)}% of gross buys in every window.`;
    }
    const levers = [
      { key: 'carryShare', label: 'Positions held over 16:00' },
      { key: 'replenish', label: 'Topping up' },
    ];
    return partCard('var(--p-settlement)', 'ECC settlement', se.need, y.settlement.need, text, levers);
  }

  function brpCard({ expected: x, stress: y, settings: st }) {
    const br = x.brp;
    const { open } = br;
    const current = br.rule === 'current';
    const ruleName = current ? 'the rule in force (Systeemcode 2026, art. 10.8)' : "ACM's draft for 2027";
    const formula = current ? (br.current.twoA ? '2 × A' : 'A + B') : '3A + 4B + 6C + 6D';
    const ruleSecurity = br[br.rule].security;
    let text;
    if (br.basis === 'marginal') {
      text =
        ruleSecurity < 0.5 && current
          ? 'Your marginal collateral: you add no net volume with other BRPs and no large connections to the Direct+ ' +
            `BRP, so under ${ruleName} it is €0. There is no minimum for members.`
          : `Your marginal collateral under ${ruleName}: ${formula} on your own figures. There is no minimum for ` +
            'members: the €96,000 and the 50 MW floors apply once to the Direct+ BRP.';
      if (C.openSets(br)) {
        text +=
          ` What you may leave open is larger, so it sets the amount: ${wholeNumber.format(open.cap)} MWh a day × ` +
          `${open.days} day${open.days === 1 ? '' : 's'} at risk × ${perMWh(open.price)} (${open.description}), ` +
          `${euros(open.amount)}.`;
      } else if (open) {
        text += ` The open-position buffer for what you may leave open, ${thousands(open.amount)}, is smaller.`;
      }
    } else if (current) {
      text =
        st.reading === '1200' && br.volume < 1200
          ? `On your own as a BRP, under ${ruleName} the 50 MW floor sets it: 2 × 1,200 MWh × ${euros(Math.max(br.price, 40))}/MWh.`
          : `On your own as a BRP, under ${ruleName}: ${formula}.`;
    } else {
      text =
        br.draft.sum < 96000
          ? `On your own as a BRP, under ${ruleName} the €96,000 minimum applies: 3A + 4B + 6C + 6D is ${thousands(br.draft.sum)}.`
          : `On your own as a BRP, under ${ruleName}: 3A + 4B + 6C + 6D.`;
    }
    const levers = current
      ? [
          { key: 'perPeriod', label: 'How daily net volume is read' },
          { key: 'connectionsMW', label: 'Large connections' },
        ]
      : [
          { key: 'imbShare', label: 'Imbalance' },
          { key: 'bias', label: 'Short or long bias' },
        ];
    if (open) {
      levers.push({ key: 'openCap', label: 'Open position allowed' }, { key: 'openPercentile', label: 'Stress price' });
    }
    const title = br.basis === 'marginal' ? 'BRP collateral (marginal)' : 'BRP security on your own';
    return partCard('var(--p-brp)', title, br.security, y.brp.security, text, levers);
  }

  function invoiceCard({ expected: x, stress: y, settings: st }) {
    const text =
      `One week's imbalance, invoiced about ${st.debitLagWeeks} weeks after delivery and debited from the available ` +
      `balance (around ${dateLabel(x.tennet.debit, true)} for this week).`;
    const levers = [
      { key: 'imbShare', label: 'Imbalance share' },
      { key: 'bias', label: 'Short or long bias' },
    ];
    return partCard('var(--p-invoices)', 'Imbalance invoices', x.tennet.invoice, y.tennet.invoice, text, levers);
  }

  function renderParts(result) {
    const box = clear($('parts'));
    for (const card of [eccCard, settlementCard, brpCard, invoiceCard]) box.appendChild(card(result));
  }

  // ---------- the week, step by step ----------

  const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

  function renderTimeline(result) {
    const scenario = timelineScenario === 'expected' ? result.expected : result.stress;
    const st = result.settings;
    const table = clear($('timeline'));
    $('tl-exp').setAttribute('aria-pressed', timelineScenario === 'expected' ? 'true' : 'false');
    $('tl-str').setAttribute('aria-pressed', timelineScenario === 'stress' ? 'true' : 'false');
    const { ecc, settlement, tennet } = scenario;
    const events = [];
    for (const window of settlement.windows) {
      const params = { C: ecc.C, OR: window.OR, ...WalletEccLink.marketParams(ecc.baseLimits, ecc.key) };
      const limits = E.day(E.parse(window.close), params);
      const days = window.days.length;
      events.push({
        at: `${window.close} 16:00`,
        what: `Booking cut: ${days} day${days > 1 ? 's' : ''} of trades close`,
        amount: window.net,
      });
      events.push({
        at: `${window.close} 18:00`,
        what:
          `Fund by 18:00 (transfer to ECC, value ${dateLabel(window.valueDate)}). Around 18:00, best effort: new limits, ` +
          `continuous ${shortThousands(limits.cont.l18)}, auctions ${shortThousands(limits.da.l18)}` +
          (limits.gap1 > 1 ? ' per auction day' : ''),
        amount: null,
      });
    }
    const WHAT = {
      collect: 'ECC receives the collection (before 08:00)',
      credit: 'ECC pays out a credit',
      'top-up': 'You top up the wallet',
    };
    for (const step of settlement.path) {
      if (step.kind === 'fund') {
        for (const event of events) if (event.at === step.at) event.level = step.level;
      } else {
        events.push({
          at: step.at,
          what: WHAT[step.kind],
          amount: step.kind === 'collect' ? -step.amount : step.amount,
          level: step.level,
        });
      }
    }
    events.push({
      at: `${tennet.debit} 12:00`,
      what: `TenneT debits the imbalance invoice for this week (about ${st.debitLagWeeks} weeks later; day to be confirmed)`,
      amount: tennet.invoice,
      dayOnly: true,
    });
    const float = settlement.float;
    if (float > 0.5) {
      // The float stays in the wallet throughout.
      for (const event of events) if (event.level != null) event.level += float;
      events.push({
        at: `${st.week} 00:00`,
        what: 'Float for purchases paid before their sale (positions held over the 16:00 cut); it stays in the wallet',
        amount: float,
        level: float,
        dayOnly: true,
      });
    }
    events.sort(byTime);
    tableHead(table, [
      { text: 'When' },
      { text: 'What happens' },
      { text: 'Amount', className: 'r' },
      { text: 'Wallet needs', className: 'r' },
    ]);
    const body = el('tbody');
    for (const event of events) {
      const day = dateLabel(event.at.slice(0, 10));
      tableRow(body, [
        { text: event.dayOnly ? day : `${day} ${event.at.slice(11)}` },
        { text: event.what },
        { text: event.amount == null ? '' : thousands(event.amount), className: 'r' },
        { text: event.level == null ? '' : thousands(event.level), className: 'r' },
      ]);
    }
    table.appendChild(body);
    $('tl-title').textContent = `The week of ${dateLabel(st.week, true)}, step by step`;
  }

  // ---------- BRP security ----------

  function renderBrp(result) {
    const { expected: x, stress: y, settings: st } = result;
    const br = x.brp;
    const { open } = br;
    const other = br.other;
    // The other rule as this one: with the open-position buffer when the larger.
    const withBuffer = (brp, amount) => Math.max(amount, brp.open ? brp.open.amount : 0);
    const otherExpected = withBuffer(br, br[other].security);
    const otherStress = withBuffer(y.brp, y.brp[other].security);
    $('brp-sub').textContent =
      (br.rule === 'current'
        ? `Rule in force on ${dateLabel(st.week, true)}: Systeemcode elektriciteit 2026, art. 10.8 (TenneT rule).`
        : 'ACM draft decision of 25 August 2026 for dates from 1 January 2027 (draft rule, not yet final).') +
      ` Under the ${other === 'current' ? 'rule in force now' : 'ACM draft'} it would be ${thousands(otherExpected)}` +
      (Math.round(otherStress) !== Math.round(otherExpected) ? ` to ${thousands(otherStress)}` : '') +
      '. ' +
      (br.basis === 'marginal'
        ? 'Direct+ members put up their marginal collateral: the rule applied to their own figures, with no minimum' +
          (open ? ', or the open-position buffer for what they may leave open if that is larger.' : '.')
        : 'Shown on your own as a BRP, with the minimum (for comparison).');
    const table = clear($('brp-table'));
    tableHead(table, [{ text: 'Component' }, { text: 'Expected', className: 'r' }, { text: 'Stress', className: 'r' }]);
    const body = el('tbody');
    const line = (label, expected, stress, format = thousands) =>
      tableRow(body, [
        { text: label },
        { text: format(expected), className: 'r' },
        { text: format(stress), className: 'r' },
      ]);
    line('Daily net volume used (MWh)', br.volume, y.brp.volume, (value) => wholeNumber.format(value));
    let ruleLine;
    if (br.rule === 'current') {
      const [c, cs] = [br.current, y.brp.current];
      line('A (first calculation)', c.A, cs.A);
      line('A if TenneT asks for more (para 5)', c.Aup, cs.Aup);
      line('A if you ask for less (para 6)', c.Adown, cs.Adown);
      line('B (large connections)', c.B, cs.B);
      ruleLine = line(c.twoA ? 'Security: 2 × A' : 'Security: A + B', c.security, cs.security);
    } else {
      const [d, ds] = [br.draft, y.brp.draft];
      line('A (trading, × 3)', d.A, ds.A);
      line('B (imbalance, × 4)', d.B, ds.B);
      line('C (profile reconciliation, × 6)', d.C, ds.C);
      line('D (smart meter and telemetry, × 6)', d.D, ds.D);
      line('3A + 4B + 6C + 6D', d.sum, ds.sum);
      const label =
        br.basis === 'marginal' ? 'Your marginal collateral (no minimum, not below €0)' : 'Security (minimum €96,000)';
      ruleLine = line(label, d.security, ds.security);
    }
    if (open) {
      const days = `${open.days} day${open.days === 1 ? '' : 's'}`;
      line(
        `Open-position buffer: ${wholeNumber.format(open.cap)} MWh × ${days} × ${perMWh(open.price)} ` +
          `(${open.label.toLowerCase()} of ${open.measureName})`,
        open.amount,
        y.brp.open.amount,
      );
      line('Your BRP collateral: the larger of the two', br.security, y.brp.security).className = 'total';
    } else {
      ruleLine.className = 'total';
    }
    table.appendChild(body);
    renderRamp(br.ramp);
    const exit = br.exit;
    const tail = [`imbalance by about ${dateLabel(exit.imbalance, true)}`];
    if (exit.smart) tail.push(`smart-meter and telemetry reconciliation by ${dateLabel(exit.smart, true)}`);
    if (exit.profile) tail.push(`profile reconciliation up to ${dateLabel(exit.profile, true)}`);
    $('exit-text').textContent =
      'If you stopped at the end of this week, security and cash stay committed until the last invoices are settled: ' +
      `${tail.join('; ')}. The security would be released after ${dateLabel(exit.released, true)}.`;
  }

  function renderRamp(ramp) {
    const box = clear($('ramp'));
    const months = ramp.months;
    const width = Math.max(280, box.clientWidth || 480);
    const height = 220;
    const margin = { left: 52, right: 8, top: 22, bottom: 30 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const highest = Math.max(...months.map((month) => month.security), 96000) * 1.08;
    const step = niceStep(highest, 4);
    const top = Math.ceil(highest / step) * step;
    const y = (value) => margin.top + plotHeight - (value / top) * plotHeight;
    const { root, add } = svgCanvas(width, height);
    for (let value = 0; value <= top + 1e-9; value += step) {
      const stroke = value === 0 ? 'var(--rule-strong)' : 'var(--rule)';
      add('line', { x1: margin.left, x2: width - margin.right, y1: y(value), y2: y(value), stroke, 'stroke-width': 1 });
      add('text', { x: margin.left - 8, y: y(value) + 4, 'text-anchor': 'end', class: 'tick' }, shortThousands(value));
    }
    const slot = plotWidth / months.length;
    const barWidth = Math.min(24, slot * 0.6);
    months.forEach((month, i) => {
      const centre = margin.left + i * slot + slot / 2;
      const barTop = y(month.security);
      const bottom = y(0);
      if (bottom - barTop > 0.5)
        add('path', { d: barPath(centre - barWidth / 2, barWidth, barTop, bottom), fill: 'var(--series)' });
      if (i % 3 === 0 || i === months.length - 1) {
        add(
          'text',
          { x: centre, y: height - margin.bottom + 16, 'text-anchor': 'middle', class: 'tick' },
          `M${month.month}`,
        );
      }
      if (month === ramp.peak)
        add('text', { x: centre, y: barTop - 7, 'text-anchor': 'middle', class: 'dl' }, shortThousands(month.security));
      const hit = add('rect', {
        x: margin.left + i * slot,
        y: margin.top,
        width: slot,
        height: plotHeight,
        class: 'hit',
      });
      const { B, C: profile, D } = month.invoices;
      hoverable(
        hit,
        thousands(month.security),
        `Month ${month.month} · invoices in the window: ${B} weekly, ${profile} profile, ${D} smart-meter/telemetry`,
      );
    });
    box.appendChild(root);
    const table = clear($('ramp-table'));
    tableHead(table, [
      { text: 'Month' },
      { text: 'Security', className: 'r' },
      { text: '3A + 4B + 6C + 6D', className: 'r' },
    ]);
    const body = el('tbody');
    for (const month of months) {
      tableRow(body, [
        { text: String(month.month) },
        { text: thousands(month.security), className: 'r' },
        { text: thousands(month.sum), className: 'r' },
      ]);
    }
    table.appendChild(body);
    const standalone = lastResult && lastResult.expected.brp.basis === 'standalone';
    $('ramp-title').textContent =
      `${standalone ? 'On your own as a new BRP' : 'Your marginal collateral as a new member'} under the ACM draft, months ` +
      `1-18 (peak ${thousands(ramp.peak.security)} in month ${ramp.peak.month})`;
  }

  // ---------- what moves the total, and the assumptions ----------

  function renderSensitivities(result) {
    const table = clear($('sens'));
    tableHead(table, [
      { text: 'Change' },
      { text: 'Expected total', className: 'r' },
      { text: 'Difference', className: 'r' },
    ]);
    const body = el('tbody');
    tableRow(body, [
      { text: 'As set' },
      { text: thousands(result.expected.total), className: 'r' },
      { text: '', className: 'r' },
    ]);
    for (const one of result.sensitivity) {
      tableRow(body, [
        { text: one.label },
        { text: thousands(one.total), className: 'r' },
        { text: thousandsDiff(one.total - result.expected.total), className: 'r' },
      ]);
    }
    table.appendChild(body);
  }

  function valueText({ key, value, kind, unit }) {
    if (value == null || value === '') return 'not set';
    if (kind === 'bool') return value ? 'yes' : 'no';
    if (kind === 'share') return `${Math.round(value * 10000) / 100}%`;
    if (kind === 'select') {
      const option = fieldOf(key).options.find(([one]) => String(one) === String(value));
      return option ? option[1] : String(value);
    }
    if (kind === 'list') return `${value} MW`;
    if (unit === '€') return euros(+value);
    return wholeNumber.format(+value) + (unit ? ` ${unit}` : '');
  }

  function renderAssumptions(result) {
    const table = clear($('assumptions'));
    tableHead(table, [{ text: 'Assumption' }, { text: 'Value' }, { text: 'Kind' }, { text: 'Source' }]);
    const body = el('tbody');
    for (const assumption of result.assumptions) {
      const name = el('span');
      name.appendChild(lever({ key: assumption.key, label: assumption.label }));
      tableRow(body, [
        { node: name },
        { text: valueText(assumption) },
        { node: tagOf(assumption.tag) },
        { text: assumption.src, className: 'small muted' },
      ]);
    }
    table.appendChild(body);
  }

  // ---------- drawing ----------

  function render() {
    $('member').value = settings.member;
    $('week').value = settings.week;
    $('rule-quick').value = settings.rule;
    $('preset-note').textContent = `${C.PRESETS[settings.member].note} Values are assumed; adjust them in Settings.`;
    let result;
    try {
      result = C.compute(settings);
      $('error').hidden = true;
    } catch (error) {
      $('error').hidden = false;
      $('error').textContent = `Can't calculate this: ${error.message} Adjust it in Settings.`;
      return;
    }
    lastResult = result;
    $('hero-label').textContent = `Money needed in your Direct+ wallet, week of ${dateLabel(settings.week, true)}`;
    const hero = clear($('hero-value'));
    hero.appendChild(document.createTextNode(`${thousands(result.expected.total)} `));
    hero.appendChild(el('span', 'to', 'to'));
    hero.appendChild(document.createTextNode(` ${thousands(result.stress.total)}`));
    let sub = 'Expected to stress. All of it is cash: Direct+ does not accept bank guarantees.';
    if (result.expected.ecc.mode === 'daily') {
      sub +=
        ` With collateral optimised by day, the wallet needs about ${thousands(result.expected.weekdayTotal)} on ` +
        'normal weekdays; the full amount from the evening calculation before a weekend or holiday until after it.';
    }
    $('hero-sub').textContent = sub;
    renderBars(result);
    renderPurposeTable(result);
    renderParts(result);
    renderTimeline(result);
    renderBrp(result);
    renderSensitivities(result);
    renderAssumptions(result);
  }

  let renderTimer = null;
  function schedule() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 120);
  }

  // ---------- start ----------

  for (const [id, { label }] of Object.entries(C.PRESETS)) {
    const option = el('option', null, label);
    option.value = id;
    $('member').appendChild(option);
  }
  $('week').min = E.MIN_DATE;
  $('week').max = E.MAX_DATE;
  $('member').addEventListener('change', () => loadPreset($('member').value));
  $('week').addEventListener('change', () => {
    settings.week = PageUI.clampWeek($('week').value || PageUI.nextMonday());
    schedule();
  });
  $('rule-quick').addEventListener('change', () => {
    settings.rule = $('rule-quick').value;
    syncField('rule');
    schedule();
  });
  $('reset').addEventListener('click', () => loadPreset(settings.member));
  $('tab-wallet').addEventListener('click', () => setView('wallet'));
  $('tab-settings').addEventListener('click', () => setView('settings'));
  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('[data-goto]');
    if (link) setView(link.dataset.goto, link.dataset.focus);
  });
  $('by-purpose').addEventListener('click', () => {
    barsBy = 'purpose';
    render();
  });
  $('by-account').addEventListener('click', () => {
    barsBy = 'account';
    render();
  });
  $('tl-exp').addEventListener('click', () => {
    timelineScenario = 'expected';
    render();
  });
  $('tl-str').addEventListener('click', () => {
    timelineScenario = 'stress';
    render();
  });
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (lastResult) renderRamp(lastResult.expected.brp.ramp);
    }).observe($('ramp'));
  }
  buildSettings();
  setView('wallet');
  render();
})();
