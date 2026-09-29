/* Direct+ wallet estimate for prospects: a short questionnaire, then how much money the Direct+ wallet needs, what for
   and when. The answers map onto the calculator's settings (src/wallet/answers.js), and WalletCalc does the rest.
   Amounts are rounded to the nearest €1,000: this is an estimate (a Direct+ decision); prices typed in are shown as
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
    addDays,
    last,
    tableHead,
    stackedBars,
    legendItem,
  } = PageUI;

  const STEPS = 7;
  const ASSETS = ['production', 'consumption'];
  const TYPE = { trader: 'Trader', aggregator: 'Aggregator', asset: 'Asset owner' };
  const TYPE_WITH_ARTICLE = { trader: 'a trader', aggregator: 'an aggregator', asset: 'an asset owner' };
  const LEAN_TEXT = { neither: 'either way', short: 'usually short', long: 'usually long' };
  const TOPUP_TEXT = { none: 'Not during the week', daily: 'Every business day', weekly: 'Every Monday' };
  const SEGMENTS = [
    { id: 'trading', label: 'Trading collateral at ECC', color: 'var(--s-trading)' },
    { id: 'available', label: 'Available balance', color: 'var(--s-available)' },
    { id: 'brp', label: 'BRP collateral', color: 'var(--s-brp)' },
  ];
  const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

  // The weeks to show: next week, and the weeks with an ECC holiday in the next 12 months.
  const NEXT_WEEK = PageUI.nextMonday();
  const WEEKS = [
    { monday: NEXT_WEEK, label: `Next week (${dateLabel(NEXT_WEEK, true)})` },
    ...PageUI.holidayWeeks()
      .filter(({ monday }) => monday !== NEXT_WEEK)
      .map(({ monday, days, names }) => ({
        monday,
        label: `${names.join(' and ')} ${E.parse(last(days)).getUTCFullYear()} (from ${dateLabel(monday)})`,
      })),
  ];

  // ---------- page state ----------

  const form = $('q');
  let answers = { ...C.defaultAnswers('trader'), week: NEXT_WEEK };
  let step = 1;
  let example = false; // typical answers, shown for show only, not the prospect's own
  let eccSetup = null; // carried over from the limit calculator: { C, key, cbd, cnbd, abd, anbd, week }

  // ---------- links to and from the limit calculator ----------
  // The answers ride along in the link too, so Back, or coming back from the limit calculator, reopens the same
  // estimate.

  /** Adds a week to the list when it is missing; false when `iso` is not a Monday. */
  function ensureWeek(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '') || E.parse(iso).getUTCDay() !== 1) return false;
    if (!$('week').querySelector(`option[value="${iso}"]`)) {
      const option = el('option', null, `Week of ${dateLabel(iso, true)}`);
      option.value = iso;
      $('week').appendChild(option);
    }
    return true;
  }

  function stateHash() {
    const pairs = [['a', Handoff.encode(answers)]];
    if (example) pairs.push(['ex', '1']);
    if (eccSetup) pairs.push(['ecc', Handoff.encode(eccSetup)]);
    return Handoff.hashOf(pairs);
  }

  /** The settings with the limit calculator's collateral, split and base limits, when they were carried over. */
  function applySetup(settings) {
    if (!eccSetup) return settings;
    return Object.assign(settings, {
      eccCollateral: eccSetup.C,
      splitMode: 'mine',
      key: eccSetup.key,
      blContBD: eccSetup.cbd,
      blContNBD: eccSetup.cnbd,
      blAucBD: eccSetup.abd,
      blAucNBD: eccSetup.anbd,
    });
  }

  /* The limit calculator, prefilled with this estimate's ECC part: the collateral, split, base limits and open risk of
     the calculation day that sets the amount (the highest day when collateral changes daily), and what the wallet
     needs that day. */
  function limitsLink(x) {
    const page = Handoff.linkTo('limits');
    if (!page) return null;
    const { ecc } = x;
    let day = ecc.binding && ecc.binding.date;
    let key = ecc.key;
    if (ecc.mode === 'daily') {
      const peak = ecc.perDay.reduce((top, one) => (one.C > top.C ? one : top));
      day = peak.date;
      key = peak.key;
    }
    if (!day) return null;
    const window = x.settlement.windows.find((one) => one.close === day);
    const next = E.iso(E.nextBD(E.parse(day)));
    let aucTarget = 0;
    for (let date = addDays(E.parse(day), 1); E.iso(date) <= next; date = addDays(date, 1)) {
      aucTarget = Math.max(aucTarget, ecc.targets.auc[E.iso(date)] || 0);
    }
    const handover = {
      week: answers.week,
      C: Math.ceil(ecc.C),
      key,
      or: Math.floor(window ? window.OR : 0),
      cbd: Math.round(ecc.baseLimits.cont.bd),
      cnbd: Math.round(ecc.baseLimits.cont.nbd),
      abd: Math.round(ecc.baseLimits.da.bd),
      anbd: Math.round(ecc.baseLimits.da.nbd),
      day,
      tc: Math.round(ecc.targets.cont[day] || 0),
      ta: Math.round(aucTarget),
      daily: ecc.mode === 'daily',
      carried: Boolean(ecc.fixed),
    };
    return `${page}#w=${Handoff.encode(handover)}&${stateHash()}`;
  }

  function setupNote() {
    const note = clear($('setup-note'));
    note.hidden = !eccSetup;
    if (!eccSetup) return;
    note.appendChild(el('b', null, 'Your limit calculator setup is carried over'));
    note.appendChild(
      el(
        'p',
        null,
        `${thousands(eccSetup.C)} trading collateral at ECC, split ${eccSetup.key}% continuous / ${100 - eccSetup.key}% ` +
          `auctions, with its base limits, for the week of ${dateLabel(eccSetup.week, true)}. The estimate uses it for ` +
          'the trading collateral at ECC and tells you if your trading needs more. Answer the questions for the rest of ' +
          'your wallet, or skip to an example.',
      ),
    );
    const button = el('button', 'linkbtn', "Don't use it: let the estimate work out the collateral");
    button.type = 'button';
    button.addEventListener('click', dropSetup);
    note.appendChild(button);
  }

  function dropSetup() {
    eccSetup = null;
    setupNote();
    if (!$('results').hidden) showResults();
  }

  // ---------- the questions ----------

  const hasAssets = () => ASSETS.some((kind) => answers.portfolio[kind]);

  function setRadio(name, value) {
    const radio = form.querySelector(`input[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
  }

  /** Shows the answers in the questions. */
  function fillForm() {
    setRadio('type', answers.type);
    setRadio('weekend', answers.weekend);
    setRadio('tough', answers.tough ? 'yes' : 'no');
    setRadio('strategy', answers.strategy);
    setRadio('netting', answers.netting);
    setRadio('balance', answers.balance);
    setRadio('lean', answers.lean);
    setRadio('replenish', answers.replenish);
    setRadio('collateral', answers.collateral);
    for (const input of form.querySelectorAll('[data-a]')) {
      const value = answers[input.dataset.a];
      if (value == null) input.value = '';
      else input.value = input.hasAttribute('data-pct') ? Math.round(value * 1000) / 10 : value;
    }
    for (const kind of ASSETS) $(`a-${kind}`).checked = Boolean(answers.portfolio[kind]);
    $('a-none').checked = !hasAssets();
    $('topup').value = answers.replenish;
    $('cmode').value = answers.collateral;
    updateVisibility();
  }

  /** Shows only the questions that apply to these answers. */
  function updateVisibility() {
    $('bid-q').hidden = !(answers.aucBuy > 0);
    for (const question of form.querySelectorAll('[data-type]'))
      question.hidden = answers.type !== question.dataset.type;
    $('size-q').hidden = !hasAssets();
    $('tough-price').hidden = !answers.tough;
  }

  function showNote(text) {
    const note = $('vol-note');
    note.textContent = text;
    note.hidden = false;
  }

  function changePortfolio(input) {
    if (input.value !== 'none') answers.portfolio[input.value] = input.checked;
    else if (input.checked) for (const kind of ASSETS) answers.portfolio[kind] = false;
    if (hasAssets() && !(answers.capacityMW > 0)) {
      answers.capacityMW = 10;
      answers.sites = 1;
    }
    const suggested = C.suggestBalance(answers.type, answers.portfolio);
    if (suggested !== answers.balance) {
      answers.balance = suggested;
      const note = $('pf-note');
      note.textContent =
        'We set the next question, how closely you match your positions, to fit this portfolio. Change it there if needed.';
      note.hidden = false;
    }
    fillForm();
  }

  function changeChoice(input) {
    const { name, value } = input;
    if (name === 'type') {
      answers = { ...C.defaultAnswers(value), week: answers.week };
      fillForm();
      const type = input.parentNode.querySelector('b').textContent.toLowerCase();
      showNote(`We filled in typical answers for ${type}s. Change any of them.`);
      return;
    }
    if (name === 'tough') answers.tough = value === 'yes';
    else answers[name] = value;
    if (name === 'strategy') {
      const volumes = C.strategyVolumes(answers.type, answers.strategy);
      answers.contBuy = volumes.cont.buy;
      answers.contSell = volumes.cont.sell;
      answers.aucBuy = volumes.auc.buy;
      answers.aucSell = volumes.auc.sell;
      fillForm();
      showNote("We adjusted your volumes to match. Change them if they don't fit.");
    }
    updateVisibility();
  }

  function changeNumber(input) {
    const key = input.dataset.a;
    if (!key) return;
    const value = input.value === '' ? NaN : parseFloat(input.value);
    if (!Number.isFinite(value)) answers[key] = null;
    else answers[key] = input.hasAttribute('data-pct') ? value / 100 : value;
    if (key === 'aucBuy') updateVisibility();
  }

  /** The problem with the answers to question `number`, or null. */
  function validate(number) {
    const missing = (key) => answers[key] == null || !(answers[key] >= 0);
    const aggregator = answers.type === 'aggregator';
    if (number === 3) {
      const keys = ['contBuy', 'contSell', 'aucBuy', 'aucSell', ...(aggregator ? ['nominatedIn', 'nonDelivery'] : [])];
      if (keys.some(missing)) return 'Please fill in every volume (0 is fine).';
      if (aggregator && answers.nonDelivery > 1) return "The share not delivered can't be over 100%.";
    }
    if (number === 4) {
      if (!(answers.price > 0)) return 'Please fill in the normal price.';
      if (answers.tough && !(answers.stressPrice > 0)) return 'Please fill in the tough-week price.';
      if (answers.tough && answers.stressPrice < answers.price)
        return 'The tough-week price should be at least the normal price.';
      if (answers.aucBuy > 0 && !(answers.aucLimitPrice > 0))
        return "Please fill in the highest price you'd bid in auctions.";
    }
    if (number === 5 && hasAssets()) {
      if (!(answers.capacityMW > 0)) return 'Please fill in the total capacity.';
      if (!(answers.sites >= 1) || Math.round(answers.sites) !== answers.sites) {
        return 'Please fill in the number of sites (a whole number, at least 1).';
      }
    }
    return null;
  }

  function showStep(number) {
    step = number;
    for (const fieldset of form.querySelectorAll('.step')) fieldset.hidden = Number(fieldset.dataset.step) !== number;
    $('step-label').textContent = `Question ${number} of ${STEPS}`;
    $('progress').style.width = `${(number / STEPS) * 100}%`;
    $('back').style.visibility = number === 1 ? 'hidden' : 'visible';
    $('next').textContent = number === STEPS ? 'See my estimate' : 'Next';
    $('step-error').hidden = true;
    setupNote();
  }

  function nextStep() {
    const error = validate(step);
    if (error) {
      $('step-error').textContent = error;
      $('step-error').hidden = false;
      return;
    }
    if (step < STEPS) {
      showStep(step + 1);
      $('wizard').scrollIntoView({ block: 'start' });
      return;
    }
    example = false;
    showResults();
  }

  /** Skip the questions: the results with the typical answers for the type chosen, marked as an example throughout. */
  function skipToExample() {
    const type = form.querySelector('input[name="type"]:checked');
    answers = { ...C.defaultAnswers(type ? type.value : 'trader'), week: answers.week };
    fillForm();
    example = true;
    showResults();
    window.scrollTo(0, 0);
  }

  /** The example for another member type: its typical answers, keeping the week, collateral and top-ups shown. */
  function switchExample(type) {
    const { week, collateral, replenish } = answers;
    answers = { ...C.defaultAnswers(type), week, collateral, replenish };
    fillForm();
    example = true;
    showResults();
  }

  function editAnswers() {
    $('results').hidden = true;
    $('wizard').hidden = false;
    document.querySelector('.page').classList.remove('showing-results');
    showStep(1);
    window.scrollTo(0, 0);
  }

  // ---------- the estimate ----------

  /** Runs the estimate for the answers; "show me both" runs it without and with weekend trading. The last run, the one
   *  shown in detail, also gets the sensitivities. */
  function estimate() {
    const variants =
      answers.weekend === 'both'
        ? [
            { weekend: 'no', label: 'Business days only' },
            { weekend: 'yes', label: 'Also at weekends' },
          ]
        : [{ weekend: answers.weekend, label: '' }];
    return variants.map(({ weekend, label }, i) => {
      const settings = applySetup(C.fromAnswers({ ...answers, weekend }));
      const full = i === variants.length - 1 ? C.compute(settings) : null;
      let stress = null;
      if (answers.tough) stress = full ? full.stress : C.scenario(settings, { stress: true });
      return { label, settings, full, expected: full ? full.expected : C.scenario(settings), stress };
    });
  }

  /** Shows the estimate for the answers; false when it can't be worked out (the reason shows above the page). */
  function showResults() {
    let runs;
    try {
      runs = estimate();
    } catch (error) {
      $('estimate-error').textContent = `We can't estimate this: ${error.message}`;
      $('estimate-error').hidden = false;
      return false;
    }
    $('estimate-error').hidden = true;
    const primary = runs[runs.length - 1];
    const { settings } = primary;
    try {
      history.replaceState(null, '', `${location.pathname}${location.search}#${stateHash()}`);
    } catch {
      // the link just doesn't update
    }
    $('wizard').hidden = true;
    $('results').hidden = false;
    document.querySelector('.page').classList.add('showing-results');
    $('week').value = answers.week;
    $('topup').value = answers.replenish;
    $('cmode').value = answers.collateral;
    $('example').hidden = !example;
    for (const button of document.querySelectorAll('[data-extype]')) {
      button.setAttribute('aria-pressed', String(button.dataset.extype === answers.type));
    }
    $('example-text').textContent =
      `These numbers use typical answers for ${TYPE_WITH_ARTICLE[answers.type]}, not your plans. They show what the ` +
      'estimate looks like; your own wallet needs can be very different.';
    $('results-title').textContent = example ? 'Example estimate' : 'Your estimate';
    $('answers-title').textContent = example ? 'Example answers' : 'Your answers';
    $('answers-hint').textContent = example ? 'Typical answers for the example' : 'What you told us';
    $('edit').textContent = example ? 'Answer the questions' : 'Change my answers';
    $('edit2').textContent = example ? 'Answer the questions' : 'Change my answers';
    const columns = runs.map((run) => ({ label: run.label || 'Normal week', result: run.expected }));
    if (answers.tough) {
      for (const run of runs)
        columns.push({ label: run.label ? `${run.label}, tough week` : 'Tough week', result: run.stress });
    }
    renderHero(runs, settings);
    renderPurposes(columns, primary);
    renderBars(columns);
    renderWhen(primary, runs.length > 1);
    renderTopups(primary);
    renderSensitivities(primary.full, settings);
    renderAnswers(settings);
    renderAssumed(primary.full, settings);
    renderCore(primary.full, settings);
    window.scrollTo(0, 0);
    return true;
  }

  function renderHero(runs, settings) {
    const who = example
      ? `Example: money a typical ${TYPE[answers.type].toLowerCase()}'s Direct+ wallet needs`
      : 'Money your Direct+ wallet needs';
    $('hero-label').textContent = `${who}, for the week of ${dateLabel(settings.week, true)}`;
    const hero = clear($('hero-value'));
    const normal = runs.map((run) => run.expected.total);
    const low = thousands(Math.min(...normal));
    const high = thousands(Math.max(...normal));
    if (answers.collateral === 'daily') {
      const weekday = thousands(Math.min(...runs.map((run) => run.expected.weekdayTotal)));
      hero.appendChild(document.createTextNode(`About ${weekday} during the week, ${high} around the weekend `));
    } else {
      hero.appendChild(document.createTextNode(`About ${low}${high !== low ? ` to ${high}` : ''} `));
    }
    if (answers.tough) {
      const tough = Math.max(...runs.map((run) => run.stress.total));
      hero.appendChild(el('span', 'to', `up to ${thousands(tough)} in a tough week`));
    }
    const sub = [];
    if (runs.length > 1) {
      sub.push(
        `${thousands(runs[0].expected.total)} if you trade on business days only, ` +
          `${thousands(runs[1].expected.total)} if you also trade at weekends and on holidays.`,
      );
    }
    if (answers.collateral === 'daily') {
      sub.push(
        'With your trading collateral adjusted every business day, it is lower Monday to Thursday and raised for the ' +
          'evening calculation before a weekend or holiday.',
      );
    }
    sub.push('All in cash: Direct+ does not accept bank guarantees.');
    if (answers.tough) {
      const badDays =
        settings.badDaysStress > 0
          ? `, room for ${settings.badDaysStress} bad trading days instead of ${settings.badDays}`
          : '';
      sub.push(`A tough week here means prices at ${euros(settings.stressPrice)}/MWh${badDays} and more imbalance.`);
    }
    $('hero-sub').textContent = sub.join(' ');
  }

  // ---------- what the money is for ----------

  const PURPOSE_LABEL = {
    ecc: 'Trading collateral at ECC',
    settlement: 'Daily settlement',
    brp: 'BRP collateral',
    invoices: 'Imbalance invoices',
  };

  /** A stress price to the cent and an open position to the tenth, so that the open-position buffer's line adds up:
   *  €255.86/MWh, 50.3 MWh. */
  const perMWh = (price) => `€${price.toFixed(2)}/MWh`;
  const TENTHS = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
  const positionMWh = (value) => `${TENTHS.format(value)} MWh`;
  /** What an open position on `side` is: sold and not yet bought back, or bought and not yet sold. */
  const HELD = { short: 'sold and not yet bought back', long: 'bought and not yet sold' };

  function describe(part, { expected, settings }) {
    const { ecc, settlement } = expected;
    if (part.id === 'ecc') {
      let text =
        'Lets you trade: ECC turns it into your trading limits for continuous trading and the auctions. It stays at ECC while you trade.';
      if (ecc.mode === 'daily') {
        text += ` Adjusted every business day: about ${thousands(ecc.weekday)} on normal weekdays, the amount shown for the weekend.`;
      }
      return text;
    }
    if (part.id === 'settlement') {
      let text = "ECC settles each business day's trades from your wallet as one net payment.";
      if (settlement.float > 0.5) {
        text +=
          ' Purchases you sell only after the 16:00 cut are paid before their sale comes back, so part of this stays in the wallet all the time.';
      } else if (settlement.flows < 0.5) {
        text += ' Your days net to about zero or to money coming in.';
      }
      if (settlement.badDay > 0.5) {
        const days = settlement.badDays === 1 ? 'a bad day' : `${settlement.badDays} bad days`;
        text +=
          ` It also keeps room for ${days}: €${wholeNumber.format(Math.round(settings.badMove))} lost on each MWh of ` +
          `your open position (about ${wholeNumber.format(Math.round(settlement.openMWh))} MWh), ${thousands(settlement.badDay)}.`;
      }
      return text;
    }
    if (part.id === 'brp') {
      const { brp } = expected;
      const { open } = brp;
      if (brp.rule === 'open') {
        return (
          "Your share of the Direct+ BRP's security towards TenneT. Without assets, what you buy and sell nets out " +
          "unless you leave it open, and Direct+ can't limit that: it covers your largest open position, " +
          `${positionMWh(open.position)}, at a high imbalance price, ${thousands(open.security)}.`
        );
      }
      let text =
        "Your share of the Direct+ BRP's security towards TenneT. You only put up the marginal part your trading and assets add: there is no minimum.";
      if (open) {
        text +=
          ` It also covers your largest open position, ${positionMWh(open.position)}, which TenneT would settle at its ` +
          `imbalance price: ${thousands(open.security)}, or the rule's amount if that is larger.`;
      }
      return text;
    }
    if (part.id === 'invoices') return 'TenneT invoices imbalance every week, about four weeks after delivery.';
    return '';
  }

  /** The ECC part's links: the limit calculator, and the setup carried over from it. */
  function eccDetails(cell, x) {
    const { fixed } = x.ecc;
    if (fixed) {
      let text = `From your limit calculator: ${thousands(fixed.C)}, split ${x.ecc.key} / ${100 - x.ecc.key}, with its base limits. `;
      if (fixed.need === null)
        text += "At this split your trading can't be covered: one market gets too small a share.";
      else if (fixed.short)
        text += `Your trading as answered needs about ${thousands(fixed.need)} at this split, so your limits may run out.`;
      else text += `Enough for your trading as answered (it needs about ${thousands(fixed.need)} at this split).`;
      cell.appendChild(el('span', fixed.short ? 'carried short' : 'carried', text));
    }
    const links = el('div', 'detail-links no-print');
    const href = limitsLink(x);
    if (href) {
      const link = el('a', 'linkbtn detail', 'Detailed calculation');
      link.href = href;
      links.appendChild(link);
    }
    if (fixed) {
      const button = el('button', 'linkbtn', "Use the estimate's own amount");
      button.type = 'button';
      button.addEventListener('click', dropSetup);
      links.appendChild(button);
    }
    if (links.childNodes.length) cell.appendChild(links);
  }

  /* The BRP collateral step by step, with the figures used: TenneT's rule in force (for a member without assets,
     Direct+'s open-position rule in its place) and ACM's draft from 2027, with a switch between them that starts on the
     rule the estimate uses for the week shown. A table: one step per line, its amount on the right, the result at the
     bottom. Exact euros, not rounded to €1,000. */
  function brpDetails(cell, x, settings) {
    const { brp } = x;
    const { current, draft } = brp;
    const marginal = brp.basis === 'marginal';
    const mwh = (value) => `${wholeNumber.format(Math.round(value))} MWh`;
    const countedMW = current.price > 0 ? current.B / (24 * current.price) : 0;
    // The draft's lines are worked from the rounded components shown, so the table adds up (±€1 against the estimate).
    const [dA, dB, dC, dD] = [draft.A, draft.B, draft.C, draft.D].map((value) => Math.round(value));
    const draftSum = 3 * dA + 4 * dB + 6 * dC + 6 * dD;
    const draftResult = Math.max(draftSum, marginal ? 0 : 96000);
    const [cA, cB] = [Math.round(current.A), Math.round(current.B)];
    const currentSecurity = current.twoA ? 2 * cA : cA + cB;
    const currentResult = Math.max(currentSecurity, marginal ? 0 : Math.round(current.security));
    const nominated = settings.nominatedIn > 0 && Math.abs(brp.volume - settings.nominatedIn) < 0.5;
    const volume = {
      label: 'Daily volume at the TenneT boundary',
      how: nominated ? 'the volume nominated from other BRPs' : 'what you sell minus what you buy',
      value: mwh(brp.volume),
    };
    const fixedPrice = settings.brpPrice != null && settings.brpPrice !== '';
    // What a member without assets may leave open, step by step: its largest open position at any time of the day on
    // the side that loses most, what its plan leaves open if that is more, the days at risk and the stress price.
    const { open } = brp;
    const openRows = () => {
      const rows = [
        {
          label: 'Your largest open position',
          how: `${HELD[open.side]}, at the most during the day (${open.side}, the side that loses most)`,
          value: positionMWh(open.largest[open.side]),
        },
      ];
      if (open.fromPlan) {
        rows.push(
          {
            label: 'Your plan leaves open',
            how:
              open.planned > 0
                ? 'you sell more than you buy, with no assets to deliver it'
                : 'you buy more than you sell, with no assets to use it',
            value: positionMWh(Math.abs(open.planned)),
          },
          { label: 'Open position', how: 'the larger of the two', value: positionMWh(open.position) },
        );
      }
      rows.push(
        {
          label: 'Days at risk',
          how: 'before Direct+ can act',
          value: `${open.days} day${open.days === 1 ? '' : 's'}`,
        },
        { label: 'Stress price', how: `${open.description}: ${open.loses}`, value: perMWh(open.price) },
      );
      return rows;
    };
    // Next to a TenneT rule: the rule's amount becomes one line, the buffer follows, and the larger counts.
    const withBuffer = (rows, ruleResult) => {
      if (!open) return rows;
      const buffer = Math.round(open.security);
      return [
        ...rows.slice(0, -1),
        { ...rows[rows.length - 1], label: 'Under the rule', sum: false },
        ...openRows(),
        { label: 'Open-position buffer', how: 'open position × days × price', value: euros(buffer) },
        {
          label: 'BRP collateral',
          how: 'the larger of the two',
          value: euros(Math.max(ruleResult, buffer)),
          sum: true,
        },
      ];
    };
    const RULES = {
      current: {
        label: 'Rule in force (2026)',
        title: "TenneT's rule in force: Systeemcode elektriciteit 2026, article 10.8",
        result: currentResult,
        rows: [
          volume,
          {
            label: 'Price',
            how: fixedPrice ? "TenneT's price floor, used for now" : 'average of the last three months, at least €40',
            value: `${euros(current.price)}/MWh`,
          },
          { label: 'A', how: 'volume × price', value: euros(cA) },
          {
            label: 'Connection capacity counted',
            how:
              countedMW > 0
                ? `the size class your ${wholeNumber.format(answers.capacityMW || 0)} MW falls in`
                : 'no connections join the Direct+ BRP',
            value: `${wholeNumber.format(Math.round(countedMW))} MW`,
          },
          { label: 'B', how: 'capacity × 24 hours × price', value: euros(cB) },
          { label: '2A', how: '2 × A', value: euros(2 * cA) },
          {
            label: current.twoA ? 'Security = 2A' : 'Security = A + B',
            how: current.twoA ? '2A is at least B' : '2A is below B',
            value: euros(currentSecurity),
          },
          {
            label: 'BRP collateral',
            how: marginal ? 'your marginal part, never below €0' : 'as your own BRP',
            value: euros(currentResult),
            sum: true,
          },
        ],
        note: marginal
          ? 'As a Direct+ member you have no 50 MW volume floor: it applies once to the Direct+ BRP.'
          : 'As your own BRP, with the 50 MW volume floor.',
      },
      draft: {
        label: 'ACM draft (from 2027)',
        title: "ACM's draft rule from 1 January 2027 (ACM/25/196985, not yet final)",
        result: draftResult,
        rows: [
          volume,
          {
            label: 'Price',
            how: fixedPrice ? '€40 used for now' : 'average of the last two months',
            value: `${euros(brp.price)}/MWh`,
          },
          { label: 'A', how: 'volume × price', value: euros(dA) },
          { label: 'B', how: 'weekly imbalance invoices, last 10 weeks: average + 2σ', value: euros(dB) },
          { label: 'C', how: 'profile-metered reconciliation, 12 months: average + 0.5σ', value: euros(dC) },
          {
            label: 'D',
            how: 'telemetry and smart-meter reconciliation, 12 months: average + 0.5σ',
            value: euros(dD),
          },
          { label: '3 × A', value: euros(3 * dA) },
          { label: '4 × B', value: euros(4 * dB) },
          { label: '6 × C', value: euros(6 * dC) },
          { label: '6 × D', value: euros(6 * dD) },
          {
            label: 'BRP collateral',
            how: `3A + 4B + 6C + 6D${marginal ? ', never below €0' : ', at least €96,000'}`,
            value: euros(draftResult),
            sum: true,
          },
        ],
        note: marginal
          ? 'As a Direct+ member you have no €96,000 minimum: it applies once to the Direct+ BRP.'
          : 'As your own BRP, with the €96,000 minimum.',
      },
    };
    for (const id of ['current', 'draft']) RULES[id].rows = withBuffer(RULES[id].rows, RULES[id].result);
    // Without assets, Direct+'s open-position rule takes the place of TenneT's rule in force.
    if (open && (brp.rule === 'open' || brp.other === 'open')) {
      RULES.open = {
        label: 'Open-position rule (2026)',
        title: "Direct+'s open-position rule for members without assets, in place of TenneT's rule in force",
        rows: [
          ...openRows(),
          {
            label: 'BRP collateral',
            how: 'open position × days × price',
            value: euros(Math.round(open.security)),
            sum: true,
          },
        ],
        note:
          "Without assets, what you buy and sell nets out unless you leave it open, and Direct+ can't limit that. So " +
          "your largest open position is covered instead of TenneT's rule in force.",
      };
    }

    const details = el('details', 'calc');
    details.appendChild(el('summary', null, 'Detailed calculation'));
    const box = el('div', 'calc-body');
    const switcher = el('div', 'rule-switch');
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', 'Which rule to show');
    const body = el('div', 'rule-body');
    const showRule = (id) => {
      const rule = RULES[id];
      clear(body);
      for (const button of switcher.children) button.setAttribute('aria-pressed', String(button.dataset.rule === id));
      body.appendChild(el('b', null, rule.title));
      const table = el('table', 'calc-table');
      const rows = el('tbody');
      for (const row of rule.rows) {
        const line = el('tr', row.sum ? 'sum' : null);
        const head = el('th', null);
        head.scope = 'row';
        head.appendChild(el('span', 'cl', row.label));
        if (row.how) head.appendChild(el('span', 'ch', row.how));
        line.appendChild(head);
        line.appendChild(el('td', null, row.value));
        rows.appendChild(line);
      }
      table.appendChild(rows);
      body.appendChild(table);
      const week = dateLabel(answers.week, true);
      const which =
        id === brp.rule
          ? `This is the rule the estimate uses for the week of ${week}.`
          : `The estimate uses the other rule for the week of ${week}.`;
      body.appendChild(el('p', null, `${rule.note} ${which}`));
    };
    // The rule before the draft (TenneT's in force, or the open-position rule), and the draft.
    for (const id of [brp.rule === 'draft' ? brp.other : brp.rule, 'draft']) {
      const button = el('button', null, RULES[id].label);
      button.type = 'button';
      button.dataset.rule = id;
      button.addEventListener('click', () => showRule(id));
      switcher.appendChild(button);
    }
    box.appendChild(switcher);
    box.appendChild(body);
    showRule(brp.rule);
    details.appendChild(box);
    cell.appendChild(details);
  }

  function renderPurposes(columns, primary) {
    const table = clear($('purposes'));
    tableHead(table, [{ text: 'What for' }, ...columns.map((column) => ({ text: column.label, className: 'r' }))]);
    const body = el('tbody');
    columns[0].result.parts.forEach((part, i) => {
      const row = el('tr');
      const cell = el('td');
      cell.appendChild(el('b', null, PURPOSE_LABEL[part.id]));
      const why = el('details', 'why');
      why.appendChild(el('summary', null, 'What is it?'));
      why.appendChild(el('span', 'what', describe(part, primary)));
      cell.appendChild(why);
      if (part.id === 'ecc') eccDetails(cell, primary.expected);
      if (part.id === 'brp') brpDetails(cell, primary.expected, primary.settings);
      row.appendChild(cell);
      for (const column of columns) row.appendChild(el('td', 'r', thousands(column.result.parts[i].value)));
      body.appendChild(row);
    });
    const total = el('tr', 'total');
    total.appendChild(el('td', null, 'Total'));
    for (const column of columns) total.appendChild(el('td', 'r', thousands(column.result.total)));
    body.appendChild(total);
    table.appendChild(body);
  }

  function renderBars(columns) {
    const rows = columns.map(({ label, result }) => ({
      label,
      total: result.total,
      totalText: thousands(result.total),
      segments: SEGMENTS.map((segment) => {
        const value = result.segments[segment.id] || 0;
        return {
          value,
          color: segment.color,
          lightInk: segment.id !== 'trading',
          text: shortThousands(value),
          tip: { value: thousands(value), label: `${label} · ${segment.label}` },
        };
      }),
    }));
    stackedBars($('bars'), rows, 100);
    const legend = clear($('legend'));
    const [first] = columns;
    const which = columns.length > 1 ? ` (${first.label.toLowerCase()})` : '';
    for (const segment of SEGMENTS) {
      legend.appendChild(
        legendItem(segment.color, `${segment.label}: ${thousands(first.result.segments[segment.id] || 0)}${which}`),
      );
    }
  }

  // ---------- when you need it, and how often you top up ----------

  function whenItem(list, when, text) {
    const item = el('li');
    item.appendChild(el('b', null, when));
    item.appendChild(el('span', null, text));
    list.appendChild(item);
  }

  function renderWhen(primary, both) {
    const list = clear($('when'));
    const { expected: x, stress: y, settings } = primary;
    const se = x.settlement;
    $('when-sub').hidden = !both;
    $('when-sub').textContent = 'Shown for trading at weekends and on holidays too.';
    const parts = Object.fromEntries(x.parts.map((part) => [part.id, part.value]));
    let start =
      x.ecc.mode === 'daily'
        ? `Trading collateral at ECC: ${thousands(x.ecc.weekday)}. Raise it to ${thousands(x.ecc.C)} for the evening ` +
          'calculation before each weekend or holiday, and lower it again after.'
        : `Trading collateral at ECC: ${thousands(parts.ecc)}.`;
    if (parts.brp > 0.5) start += ` BRP collateral: ${thousands(parts.brp)}.`;
    if (se.float > 0.5) start += ` Float for positions held over 16:00: ${thousands(se.float)}.`;
    if (se.badDay > 0.5) {
      start += ` Room for ${se.badDays === 1 ? 'a bad trading day' : `${se.badDays} bad trading days`}: ${thousands(se.badDay)}.`;
    }
    whenItem(list, 'Before your first trade', start);
    const toughFlows = y ? y.settlement.flows : 0;
    const TOPUPS = {
      none: 'no top-up during the week.',
      daily: 'a top-up every business day.',
      weekly: 'a top-up every Monday.',
    };
    whenItem(
      list,
      'Every business day, by 18:00',
      se.flows > 0.5 || toughFlows > 0.5
        ? "ECC collects the day's net purchases from your wallet, with value the next business day. In the week shown " +
            `that comes to ${thousands(se.flows)}` +
            (toughFlows > se.flows + 0.5 ? `, up to ${thousands(toughFlows)} in a tough week` : '') +
            `, with ${TOPUPS[settings.replenish]}`
        : "ECC settles each day's trades as one net payment. Yours come to about zero or to money coming in, apart from fees.",
    );
    whenItem(
      list,
      'Around 18:00 each business day',
      'ECC updates your trading limits (best effort). Until then, the base limit you set in the Direct+ platform covers trading from 16:00.',
    );
    whenItem(
      list,
      'About four weeks after each week',
      `TenneT's imbalance invoice: ${thousands(x.tennet.invoice)} a week` +
        (y ? `, up to ${thousands(y.tennet.invoice)} in a tough week.` : '.'),
    );
    if (settings.connectionsMW) {
      whenItem(
        list,
        'Months later',
        'Metered volumes are reconciled: smart-meter and telemetry about six months after each month.',
      );
    }
  }

  function renderTopups(primary) {
    const table = clear($('topups'));
    const columns = [
      { text: 'Top-ups' },
      { text: 'Daily settlement', className: 'r' },
      { text: 'Total', className: 'r' },
    ];
    if (answers.tough)
      columns.push(
        { text: 'Daily settlement, tough week', className: 'r' },
        { text: 'Total, tough week', className: 'r' },
      );
    tableHead(table, columns);
    const settlementOf = (scenario) => scenario.parts.find((part) => part.id === 'settlement').value;
    const body = el('tbody');
    for (const id of ['none', 'weekly', 'daily']) {
      const settings = { ...primary.settings, replenish: id };
      const expected = C.scenario(settings);
      const stress = answers.tough ? C.scenario(settings, { stress: true }) : null;
      const mine = id === primary.settings.replenish;
      const row = el('tr', mine ? 'total' : null);
      row.appendChild(el('td', null, TOPUP_TEXT[id] + (mine ? ' (your answer)' : '')));
      row.appendChild(el('td', 'r', thousands(settlementOf(expected))));
      row.appendChild(el('td', 'r', thousands(expected.total)));
      if (stress) {
        row.appendChild(el('td', 'r', thousands(settlementOf(stress))));
        row.appendChild(el('td', 'r', thousands(stress.total)));
      }
      body.appendChild(row);
    }
    table.appendChild(body);
  }

  // ---------- what moves the estimate, the answers and the assumptions ----------

  function renderSensitivities(result, settings) {
    const table = clear($('sens'));
    const LABELS = {
      'vol+': 'Volumes 50% higher',
      'vol-': 'Volumes 50% lower',
      price: `All prices at ${euros(settings.stressPrice)}/MWh`,
      imb: 'Twice as much imbalance',
    };
    tableHead(table, [
      { text: 'Change' },
      { text: 'Normal week', className: 'r' },
      { text: 'Difference', className: 'r' },
    ]);
    const body = el('tbody');
    const line = (label, total, difference) => {
      const row = el('tr');
      row.appendChild(el('td', null, label));
      row.appendChild(el('td', 'r', total));
      row.appendChild(el('td', 'r', difference));
      body.appendChild(row);
    };
    line('Your answers', thousands(result.expected.total), '');
    for (const one of result.sensitivity) {
      if (one.id === 'price' && !answers.tough) continue;
      line(LABELS[one.id], thousands(one.total), thousandsDiff(one.total - result.expected.total));
    }
    table.appendChild(body);
  }

  const portfolioText = (kinds, joiner) =>
    `${kinds.join(joiner)}, ${wholeNumber.format(answers.capacityMW)} MW at ${answers.sites} site${answers.sites > 1 ? 's' : ''}`;

  function renderAnswers(settings) {
    const list = clear($('answers'));
    const add = (term, value) => {
      list.appendChild(el('dt', null, term));
      list.appendChild(el('dd', null, value));
    };
    const NETTING = {
      block: "Build a position, then close it (largest open position: all of a day's buys)",
      mixed: "Buys and sells mixed (largest open position: 66% of a day's buys)",
      flat: "Many small trades, close to flat (largest open position: 33% of a day's buys)",
    };
    const BALANCE = { tight: 'Very close', normal: 'Normal', forecast: 'Forecast-driven' };
    const volumes = (buy, sell) => `${wholeNumber.format(buy)} / ${wholeNumber.format(sell)} MWh a day`;
    add('You are', TYPE[answers.type]);
    add('Weekends and holidays', { yes: 'Yes', no: 'No', both: 'Show me both' }[answers.weekend]);
    add('Continuous intraday, buy / sell', volumes(settings.contBuy, settings.contSell));
    add('Auctions (day-ahead + intraday), buy / sell', volumes(settings.aucBuy, settings.aucSell));
    if (answers.type === 'trader') add('Continuous trades through the day', NETTING[answers.netting]);
    if (answers.type === 'aggregator') {
      const notDelivered = Math.round(settings.nonDelivery * 100);
      add(
        'Nominated from other BRPs',
        `${wholeNumber.format(settings.nominatedIn)} MWh a day, ${notDelivered}% may not be delivered`,
      );
    }
    if (answers.tough)
      add('Normal / tough-week price', `${euros(settings.price)} / ${euros(settings.stressPrice)} per MWh`);
    else add('Normal price', `${euros(settings.price)} per MWh`);
    add('Tough week', answers.tough ? 'Shown' : 'Not shown');
    if (settings.aucBuy > 0) add('Highest auction bid', `${euros(settings.aucLimitPrice)}/MWh`);
    const kinds = ASSETS.filter((kind) => answers.portfolio[kind]);
    add('Portfolio', kinds.length ? capitalise(portfolioText(kinds, ', ')) : 'None');
    add('Imbalance', `${BALANCE[answers.balance]}, ${LEAN_TEXT[answers.lean]}`);
    add('Trading collateral', answers.collateral === 'daily' ? 'Adjusted every business day' : 'The same all week');
    add('Top-ups', TOPUP_TEXT[settings.replenish]);
  }

  /* The few assumptions that move the estimate most, next to what the money is for; the full list is further down. */
  function renderCore(result, settings) {
    const list = clear($('core'));
    const x = result.expected;
    const add = (term, value) => {
      const item = el('div');
      item.appendChild(el('dt', null, term));
      item.appendChild(el('dd', null, value));
      list.appendChild(item);
    };
    const mwh = (value) => `${wholeNumber.format(Math.round(value))} MWh`;
    const buySell = (buy, sell) => `${wholeNumber.format(buy)} buy / ${wholeNumber.format(sell)} sell MWh a day`;
    const daysAYear = settings.weekend ? 365 : 255; // 255: about the business days in a year
    const perYear = ((settings.contBuy + settings.contSell + settings.aucBuy + settings.aucSell) * daysAYear) / 1000;
    const BASE_TEXT = { traded: 'traded volume', nominated: 'nominations', production: 'net production' };
    add(
      'Volume a year',
      `about ${perYear >= 10 ? wholeNumber.format(Math.round(perYear)) : perYear.toFixed(1)} GWh traded`,
    );
    add('M7 continuous', buySell(settings.contBuy, settings.contSell));
    add('MATS auctions', buySell(settings.aucBuy, settings.aucSell));
    if (answers.type === 'aggregator') {
      add('Nominated from other BRPs', `${mwh(settings.nominatedIn)} a day`);
      add('Not delivered', `${Math.round(settings.nonDelivery * 100)}% of nominations`);
    }
    if (hasAssets()) {
      const kinds = ASSETS.filter((kind) => answers.portfolio[kind]).map((kind, i) => (i ? kind : capitalise(kind)));
      add('Portfolio', portfolioText(kinds, ' and '));
    }
    if (answers.type !== 'trader') {
      add(
        'Imbalance',
        `${Math.round(settings.imbShare * 100)}% of ${BASE_TEXT[settings.imbBase]}, ${LEAN_TEXT[answers.lean]}`,
      );
    }
    add('Price', `${euros(settings.price)}/MWh${answers.tough ? `, tough week ${euros(settings.stressPrice)}` : ''}`);
    add('Weekends and holidays', { yes: 'Traded', no: 'Not traded', both: 'Shown both ways' }[answers.weekend]);
    if (x.settlement.badDay > 0.5) {
      add(
        'Bad day',
        `€${wholeNumber.format(Math.round(settings.badMove))}/MWh lost on about ${mwh(x.settlement.openMWh)} open` +
          (answers.tough ? ', 2 days in a tough week' : ''),
      );
    }
    add(
      'Held over the 16:00 cut',
      `${Math.round(settings.carryShare * 100)}% of a day's buys, about ${mwh(settings.carryShare * (settings.contBuy + settings.aucBuy))}`,
    );
    if (answers.type === 'trader') {
      add(
        'Largest open M7 position',
        `${Math.round((1 - settings.s) * 100)}% of a day's buys, about ${mwh((1 - settings.s) * settings.contBuy)}`,
      );
    }
    if (x.ecc.fixed) add('Trading collateral at ECC', `From your limit calculator, ${thousands(x.ecc.fixed.C)}`);
    add('Split continuous / auctions', `${x.ecc.key}% / ${100 - x.ecc.key}%`);
    const { open } = x.brp;
    const BRP_RULE = {
      current: `TenneT rule at ${euros(x.brp.price)}/MWh, no minimum`,
      draft: `ACM draft 2027 at ${euros(x.brp.price)}/MWh, no minimum`,
      open: "Open-position rule, in place of TenneT's rule in force (no assets)",
    };
    add(
      'BRP collateral',
      BRP_RULE[x.brp.rule] + (open && x.brp.rule !== 'open' ? ', or the open-position buffer if larger' : ''),
    );
    if (open) {
      const days = `${open.days} day${open.days === 1 ? '' : 's'}`;
      const over = open.measure === 'spread' ? ' over day-ahead' : '';
      add(
        'Open position',
        `Largest ${positionMWh(open.position)} ${open.side}, ${days} at risk, at ${perMWh(open.price)}${over}`,
      );
    }
    add('Collateral at ECC', answers.collateral === 'daily' ? 'Adjusted every business day' : 'The same all week');
    add('Top-ups', TOPUP_TEXT[settings.replenish]);
  }

  function renderAssumed(result, settings) {
    const list = clear($('assumed'));
    const x = result.expected;
    const add = (text) => list.appendChild(el('li', null, text));
    const rule =
      x.brp.rule === 'current'
        ? "TenneT's rule in force (Systeemcode elektriciteit 2026, article 10.8)"
        : "ACM's draft rule for 2027 (not yet final)";
    const split = `${x.ecc.key}% continuous, ${100 - x.ecc.key}% auctions`;
    if (x.ecc.fixed)
      add(
        `Your trading collateral at ECC, its split (${split}) and base limits come from your limit calculator setup.`,
      );
    else
      add(
        `Your split between continuous and auctions is the one that needs the least collateral: ${split}. You set it in the Direct+ platform.`,
      );
    add(
      `ECC updates limits around 18:00 on a best-effort basis${answers.tough ? '; a tough week assumes around 19:00' : ''}. ` +
        `Open orders over 16:00 and trading until the update, ${thousands(settings.restingCont)} and ` +
        `${thousands(settings.eveningCont)}, are covered by your base limit.`,
    );
    add(
      "You hold some positions over ECC's 16:00 booking cut, about a third of a day's buys (for example bought " +
        'day-ahead, sold intraday the next day). ECC collects those purchases a business day before the sale comes back, ' +
        'so that money waits in your wallet.',
    );
    if (x.settlement.badDay > 0.5) {
      add(
        `A bad trading day loses €${wholeNumber.format(Math.round(settings.badMove))} on each MWh of your largest open ` +
          'position (continuous buys not yet sold again, plus auction buys until sold or used). Your wallet keeps room ' +
          `for ${settings.badDays}${settings.badDays === 1 ? ' bad day' : ' bad days'}` +
          `${answers.tough ? `, ${settings.badDaysStress} in a tough week` : ''}, not for a whole bad week.`,
      );
    }
    add(
      `${Math.round(settings.negShare * 100)}% of hours have negative prices, averaging ${euros(settings.negPrice)}/MWh.`,
    );
    const floor =
      settings.brpPrice != null && settings.brpPrice !== ''
        ? " (TenneT's price floor, used for now instead of the market average)"
        : '';
    if (x.brp.rule === 'open') {
      add(
        "BRP collateral follows Direct+'s open-position rule, in place of TenneT's rule in force: without assets, what " +
          'you buy and sell nets out unless you leave it open.',
      );
    } else {
      add(
        `BRP collateral follows ${rule}, applied to your own figures, with no minimum, at ${euros(x.brp.price)}/MWh${floor}.`,
      );
    }
    const { open } = x.brp;
    if (open) {
      const planned = open.fromPlan
        ? ` Your plan leaves more open, ${positionMWh(Math.abs(open.planned))}: you ` +
          `${open.planned > 0 ? 'sell more than you buy' : 'buy more than you sell'}, with no assets.`
        : '';
      add(
        "Direct+ can't limit what you leave open, and TenneT settles what is left open at its imbalance price. So your " +
          `BRP collateral covers your largest open position at any time of the day: ` +
          `${positionMWh(open.largest[open.side])} ${HELD[open.side]}.${planned} It covers ${positionMWh(open.position)} ` +
          `for ${open.days === 1 ? 'one day' : `${open.days} days`} at ${perMWh(open.price)}, ${open.description}: ` +
          `${open.loses}.` +
          (open.measure === 'spread'
            ? ' That assumes the position was traded at day-ahead and its money stays in your wallet until TenneT settles.'
            : '') +
          (x.brp.rule === 'open' ? '' : " You put up this or the rule's amount, whichever is larger."),
      );
    }
    add(
      "Imbalance is settled at TenneT's imbalance prices; a small share of periods has separate prices for short and " +
        `long positions.${answers.tough ? ' A tough week takes a high but not extreme imbalance week.' : ''}`,
    );
    if (settings.connectionsMW) {
      add(
        'Your capacity is spread evenly over your sites, all metered by telemetry or smart meter; reconciliation of ' +
          'metered volumes varies by about €10 per MW a month.',
      );
    }
    add('Nothing nets between Direct+ members: the estimate is for you alone. Fees and VAT are not included.');
  }

  // ---------- arriving from a link ----------

  /** Answers (Back, or back from the limit calculator) and/or a limit calculator setup, from the link. */
  function arrive() {
    const hash = Handoff.readHash();
    const linked = hash.has('a') ? Handoff.decode(hash.get('a')) : null;
    const setup = hash.has('ecc') ? Handoff.decode(hash.get('ecc')) : null;
    if (setup && setup.C > 0 && setup.key >= 0 && setup.key <= 100 && ensureWeek(setup.week)) eccSetup = setup;
    if (linked && linked.type && C.PRESETS[linked.type]) {
      answers = { ...C.defaultAnswers(linked.type), ...linked };
      if (eccSetup) answers.week = eccSetup.week;
      if (!ensureWeek(answers.week)) answers.week = WEEKS[0].monday;
      example = hash.get('ex') === '1';
      fillForm();
      if (showResults()) return;
    }
    if (eccSetup) answers.week = eccSetup.week;
    fillForm();
    showStep(1);
  }

  // ---------- start ----------

  for (const week of WEEKS) {
    const option = el('option', null, week.label);
    option.value = week.monday;
    $('week').appendChild(option);
  }
  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('a[href="#assumed-card"]');
    if (!link) return;
    event.preventDefault();
    $('assumed-card').open = true;
    $('assumed-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  // Printing opens the folded sections, and closes them again afterwards.
  let openedForPrint = [];
  window.addEventListener('beforeprint', () => {
    openedForPrint = [...document.querySelectorAll('#results details')].filter((details) => !details.open);
    for (const details of openedForPrint) details.open = true;
  });
  window.addEventListener('afterprint', () => {
    for (const details of openedForPrint) details.open = false;
    openedForPrint = [];
  });
  form.addEventListener('change', (event) => {
    if (event.target.name === 'asset') changePortfolio(event.target);
    else if (event.target.type === 'radio') changeChoice(event.target);
  });
  form.addEventListener('input', (event) => changeNumber(event.target));
  $('next').addEventListener('click', nextStep);
  $('skip').addEventListener('click', skipToExample);
  $('back').addEventListener('click', () => {
    if (step > 1) showStep(step - 1);
  });
  $('example-own').addEventListener('click', editAnswers);
  for (const button of document.querySelectorAll('[data-extype]')) {
    button.addEventListener('click', () => switchExample(button.dataset.extype));
  }
  $('edit').addEventListener('click', editAnswers);
  $('edit2').addEventListener('click', editAnswers);
  $('print').addEventListener('click', () => window.print());
  $('week').addEventListener('change', () => {
    answers.week = $('week').value;
    showResults();
  });
  $('topup').addEventListener('change', () => {
    answers.replenish = $('topup').value;
    setRadio('replenish', answers.replenish);
    showResults();
  });
  $('cmode').addEventListener('change', () => {
    answers.collateral = $('cmode').value;
    setRadio('collateral', answers.collateral);
    showResults();
  });
  arrive();
})();
