/* Direct+ limit calculator: collateral to ECC trading limits for M7 continuous and MATS auctions, and back. The engine
   (src/engine.js) does the calculation; this script reads the form and draws the results. */
(() => {
  'use strict';

  const E = LimitEngine;
  const {
    $,
    el,
    clear,
    euros,
    shortEuros,
    wholeNumber,
    dateLabel,
    WEEKDAYS,
    WEEKDAYS_LONG,
    MONTHS,
    DAY_MS,
    addDays,
    plusDays,
    hoverable,
    headerRow,
    tableHead,
    tableRow,
    svgCanvas,
    barPath,
    niceStep,
    last,
  } = PageUI;

  const minBy = (list, value) =>
    list.reduce((best, item) => (best === null || value(item) < value(best) ? item : best), null);
  const maxBy = (list, value) =>
    list.reduce((best, item) => (best === null || value(item) > value(best) ? item : best), null);
  const weekdayOf = (iso) => E.parse(iso).getUTCDay();
  const gapAfter = (day) => Math.round((E.nextBD(day) - day) / DAY_MS);

  // ---------- page state ----------

  let selectedDay = null; // the calculation day shown in the daily cycle (ISO)
  let weekView = 'calc'; // the week table: ECC's calculations (the default, a Direct+ decision) or 'days'
  let current = null; // the last drawing: the form, its results and its day labels
  let fromWallet = null; // what the wallet estimate handed over, when it opened this page
  let walletState = []; // the wallet estimate's own state in the link, as [key, value], to take back

  // ---------- day labels ----------

  /* In a standard week (no ECC holiday from the Friday before to the Monday after) the dates don't matter, so the page
     names days by weekday only: 'Friday', 'Mon'. Holiday weeks keep their dates: 'Fri 25 Dec', 'Fri 25'. */
  function dayLabels(standardWeek) {
    return {
      day: (iso, withYear) => (standardWeek ? WEEKDAYS_LONG[weekdayOf(iso)] : dateLabel(iso, withYear)),
      short: (iso) =>
        standardWeek ? WEEKDAYS[weekdayOf(iso)] : `${WEEKDAYS[weekdayOf(iso)]} ${E.parse(iso).getUTCDate()}`,
    };
  }
  const DATED = dayLabels(false);

  const dayNote = (name) => (name === 'Weekend' ? 'weekend' : name);

  /** The auctions that get a share of a calculation: all but the settled one on the next business day. */
  const shareAuctions = (row) => row.da.auctions.filter((auction) => !auction.settled);

  function shareDaysShort(auctions) {
    const names = auctions.map((auction) => WEEKDAYS[weekdayOf(auction.date)]);
    return names.length > 2 ? `${names[0]}–${last(names)}` : names.join(', ');
  }

  // ---------- amount fields ----------
  // Whole euros, shown with thousands separators as you type. The arrow keys and the arrow buttons step by data-step.

  function amount(id) {
    const value = parseFloat($(id).value.replace(/[^\d.]/g, ''));
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  /** Regroups the digits with thousands separators, keeping the caret after the same digit. */
  function groupDigits(input) {
    const raw = input.value;
    const caret = input.selectionStart ?? raw.length;
    const digitsBefore = raw.slice(0, caret).replace(/\D/g, '').length;
    const digits = raw
      .replace(/\D/g, '')
      .replace(/^0+(?=\d)/, '')
      .slice(0, 12);
    const grouped = digits ? wholeNumber.format(+digits) : '';
    if (grouped === raw) return;
    input.value = grouped;
    if (document.activeElement !== input) return;
    let position = 0;
    for (let seen = 0; position < grouped.length && seen < digitsBefore; position++) {
      if (/\d/.test(grouped[position])) seen++;
    }
    input.setSelectionRange(position, position);
  }

  function stepAmount(input, direction) {
    const step = +input.dataset.step || 1;
    const value = amount(input.id);
    const next =
      direction > 0 ? Math.floor(value / step) * step + step : Math.max(0, Math.ceil(value / step) * step - step);
    input.value = wholeNumber.format(next);
    schedule();
  }

  const STEPPERS = [
    { direction: 1, name: 'up', label: 'Increase', path: 'M1 5l4-4 4 4' },
    { direction: -1, name: 'down', label: 'Decrease', path: 'M1 1l4 4 4-4' },
  ];

  /* Arrow buttons like a number field's: a press steps once, holding keeps stepping. They are out of the tab order (the
     arrow keys do the same), but still announced and clickable for screen readers. */
  function addSteppers(input) {
    const box = el('div', 'steppers');
    const by = ` by €${wholeNumber.format(+input.dataset.step || 1)}`;
    for (const { direction, name, label, path } of STEPPERS) {
      const button = el('button', `step-${name}`);
      button.type = 'button';
      button.tabIndex = -1;
      button.setAttribute('aria-label', label + by);
      button.innerHTML = `<svg viewBox="0 0 10 6" aria-hidden="true"><path d="${path}"/></svg>`;
      let timer = null;
      const stop = () => {
        clearTimeout(timer);
        timer = null;
      };
      const repeat = () => {
        stepAmount(input, direction);
        timer = setTimeout(repeat, 80);
      };
      button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        stop();
        stepAmount(input, direction);
        timer = setTimeout(repeat, 450);
      });
      for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, stop);
      button.addEventListener('click', (event) => {
        if (event.detail === 0) stepAmount(input, direction); // a keyboard or screen reader click
      });
      box.appendChild(button);
    }
    input.parentNode.appendChild(box);
  }

  function setUpAmount(input) {
    input.addEventListener('input', () => groupDigits(input));
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      stepAmount(input, event.key === 'ArrowUp' ? 1 : -1);
    });
    addSteppers(input);
  }

  // ---------- weeks ----------

  const holidaysByWeek = {}; // the holidays of each holiday week in the list
  const walletWeeks = new Set(); // weeks added to the list for a wallet estimate

  /** The weekday ECC holidays from the Friday before the week to the Monday after it. */
  function nearbyHolidays(monday) {
    const days = [];
    for (let i = -3; i <= 7; i++) {
      const iso = plusDays(monday, i);
      const weekday = weekdayOf(iso);
      if (weekday !== 0 && weekday !== 6 && !E.isBD(E.parse(iso))) days.push(iso);
    }
    return days;
  }

  /** A standard week: its weekdays, the Friday before and the Monday after are all ECC business days, so no
   *  calculation in it covers a holiday. */
  const isStandardWeek = (monday) => nearbyHolidays(monday).length === 0;

  function firstStandardWeek() {
    for (let monday = PageUI.nextMonday(); plusDays(monday, 7) <= E.MAX_DATE; monday = plusDays(monday, 7)) {
      if (isStandardWeek(monday)) return monday;
    }
    return PageUI.nextMonday();
  }

  function holidayOptionLabel({ days, names }) {
    const first = E.parse(days[0]);
    const end = E.parse(last(days));
    let when;
    if (days.length === 1) when = DATED.day(days[0], true);
    else if (first.getUTCMonth() === end.getUTCMonth()) {
      when = `${first.getUTCDate()}–${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
    } else when = `${DATED.day(days[0]).slice(4)} – ${DATED.day(last(days), true).slice(4)}`;
    return `${names.join(' and ')} · ${when}`;
  }

  function fillWeeks() {
    const select = $('week');
    const standard = el('option', null, 'A standard week, no holidays');
    standard.value = firstStandardWeek();
    select.appendChild(standard);
    const weeks = PageUI.holidayWeeks();
    if (!weeks.length) return;
    const group = document.createElement('optgroup');
    group.label = 'Weeks with an ECC holiday, next 12 months';
    for (const week of weeks) {
      const option = el('option', null, holidayOptionLabel(week));
      option.value = week.monday;
      holidaysByWeek[week.monday] = week.days;
      group.appendChild(option);
    }
    select.appendChild(group);
  }

  const holidayList = (days) => days.map((day) => `${E.HOLIDAYS[day]} (${DATED.short(day)})`).join(' and ');

  function weekNote() {
    const monday = $('week').value;
    const from = E.parse(monday);
    const to = E.parse(plusDays(monday, 4));
    const sameMonth = from.getUTCMonth() === to.getUTCMonth();
    const span =
      `Mon ${from.getUTCDate()}${sameMonth ? '' : ` ${MONTHS[from.getUTCMonth()]}`} – ` +
      `Fri ${to.getUTCDate()} ${MONTHS[to.getUTCMonth()]} ${to.getUTCFullYear()}`;
    const plain = '. Every day is an ECC business day; the Friday calculation covers the weekend.';
    const holidays = holidaysByWeek[monday];
    const fromEstimate = walletWeeks.has(monday);
    let note;
    if (!holidays && isStandardWeek(monday)) {
      note =
        `${fromEstimate ? 'The week of your wallet estimate, a standard week' : 'A standard week'}: ` +
        'every day is an ECC business day, and the Friday calculation covers the weekend.';
    } else if (!holidays && fromEstimate) {
      const near = nearbyHolidays(monday);
      note = `Showing ${span}, the week of your wallet estimate`;
      note += near.length
        ? `. ${holidayList(near)} ${near.length > 1 ? 'are' : 'is'} not an ECC business day, which affects this week's calculations.`
        : plain;
    } else if (holidays) {
      note = `Showing ${span}. ${holidayList(holidays)}`;
      note += holidays.length > 1 ? ' are not ECC business days.' : ' is not an ECC business day.';
    } else {
      note = `Showing ${span}${plain}`;
    }
    $('week-note').textContent = note;
  }

  /** Adds the week of a wallet estimate to the list when it is missing; false when `iso` is not a Monday in range. */
  function ensureWeek(iso) {
    const isMonday = /^\d{4}-\d{2}-\d{2}$/.test(iso || '') && weekdayOf(iso) === 1;
    if (!isMonday || iso < E.MIN_DATE || plusDays(iso, 7) > E.MAX_DATE) return false;
    if (!$('week').querySelector(`option[value="${iso}"]`)) {
      const option = el('option', null, `Week of ${DATED.day(iso, true)}, from your wallet estimate`);
      option.value = iso;
      $('week').appendChild(option);
      walletWeeks.add(iso);
    }
    return true;
  }

  // ---------- the form and the calculation ----------

  const checked = (name) => document.querySelector(`input[name="${name}"]:checked`).value;

  function readForm() {
    return {
      mode: checked('mode'),
      week: PageUI.clampWeek($('week').value || firstStandardWeek()),
      C: amount('collateral'),
      OR: amount('open-risk'),
      cont: { bd: amount('c-bd'), nbd: amount('c-nbd') },
      da: { bd: amount('a-bd'), nbd: amount('a-nbd') },
      split: Math.max(0, Math.min(100, parseInt($('split').value, 10) || 0)),
      tCont: amount('t-cont'),
      tContMeasure: checked('t-cont-when'),
      tDa: amount('t-da'),
      tDaNonBD: $('t-da-nonbd').checked,
      keyMode: checked('keymode'),
      cmode: checked('cmode'),
      scope: checked('scope'),
    };
  }

  /** The engine's two-market parameters for the form, with continuous share `key` and collateral C. */
  const engineParams = (input, key, C) => ({
    C,
    OR: input.OR,
    cont: { bd: input.cont.bd, nbd: input.cont.nbd, key },
    da: { bd: input.da.bd, nbd: input.da.nbd, key: 100 - key },
  });

  /**
   * The collateral that the target limits need (the second mode), with the split chosen: the cheapest split or the
   * member's own. 'Weekend only' sizes the calculation before the weekend or holiday and reports the other days;
   * 'optimised by day' sizes every calculation day on its own.
   */
  function sizeCollateral(input, days) {
    const base = engineParams(input, input.split);
    const targets = { cont: input.tCont, contMeasure: input.tContMeasure, da: input.tDa, daNonBD: input.tDaNonBD };
    const cheapestSplit = input.keyMode === 'cheapest';
    const weekendOnly = input.scope === 'weekend';
    let solveDays = weekendOnly ? days.filter((day) => gapAfter(day) > 1) : days;
    if (!solveDays.length) solveDays = days;
    const sizing = {
      targets,
      days: solveDays,
      mine: E.solve(solveDays, base, targets),
      cheapest: E.cheapestKey(solveDays, base, targets),
      otherDays: null,
      byDay: null,
      staticWeek: null,
      binding: null,
    };
    if (weekendOnly && solveDays.length < days.length) {
      const rest = days.filter((day) => gapAfter(day) === 1);
      sizing.otherDays = { mine: E.solve(rest, base, targets), cheapest: E.cheapestKey(rest, base, targets) };
    }
    let C = cheapestSplit ? (sizing.cheapest ? sizing.cheapest.C : null) : sizing.mine;
    let key = cheapestSplit && sizing.cheapest ? sizing.cheapest.key : input.split;
    if (input.cmode === 'daily') {
      const sized = (list) =>
        cheapestSplit ? E.cheapestKey(list, base, targets) : { key: input.split, C: E.solve(list, base, targets) };
      const byDay = days.map((day) => sized([day]));
      sizing.staticWeek = sized(days);
      if (byDay.some((one) => !one || one.C === null)) {
        C = null;
      } else {
        const peak = byDay.reduce((top, one) => (!top || one.C > top.C ? one : top), null);
        sizing.byDay = byDay;
        C = peak.C;
        key = peak.key;
      }
    }
    if (C !== null && !sizing.byDay) sizing.binding = E.binding(C, solveDays, engineParams(input, key), targets);
    return { ...sizing, C, key };
  }

  function compute(input) {
    const days = E.weekDays(input.week);
    const sizing = input.mode === 'inv' ? sizeCollateral(input, days) : null;
    const key = sizing ? sizing.key : input.split;
    const C = sizing ? sizing.C : input.C;
    const p = engineParams(input, key, C === null ? 0 : C);
    const rows = days.map((day, i) => {
      const own = sizing && sizing.byDay ? engineParams(input, sizing.byDay[i].key, sizing.byDay[i].C) : p;
      return { ...E.day(day, own), p: own };
    });
    return { input, days, rows, p, key, C, sizing };
  }

  /** Every auction of the week's calculations, with the calculation that set it. */
  const allAuctions = (rows) =>
    rows.flatMap((row) =>
      row.da.auctions.map(({ date, limit, settled, rollover, bd, note }) => ({
        date,
        limit,
        settled,
        rollover,
        bd,
        note,
        calc: row.date,
      })),
    );

  // ---------- tiles ----------

  function tile(label, value, sub, { hero = false, swatch = null } = {}) {
    const node = el('div', hero ? 'tile hero' : 'tile');
    const head = el('div', 't-label');
    if (swatch) head.appendChild(el('span', `swatch ${swatch}`));
    head.appendChild(document.createTextNode(label));
    node.appendChild(head);
    node.appendChild(el('div', 't-value', value));
    if (sub) node.appendChild(el('div', 't-sub', sub));
    return node;
  }

  function limitTiles({ rows, labels }) {
    const lowCont = minBy(rows, (row) => row.cont.l18);
    const highCont = maxBy(rows, (row) => row.cont.l18);
    const auctions = allAuctions(rows);
    const lowAuction = minBy(auctions, (auction) => auction.limit);
    const highAuction = maxBy(auctions, (auction) => auction.limit);
    const highReserve = maxBy(rows, (row) => row.blr);
    const lowReserve = minBy(rows, (row) => row.blr);
    const auctionNote = lowAuction.note ? ` (${dayNote(lowAuction.note)})` : '';
    return [
      tile(
        'M7 continuous, from 18:00',
        shortEuros(lowCont.cont.l18),
        `lowest, ${labels.day(lowCont.date)} · highest ${shortEuros(highCont.cont.l18)}`,
        { swatch: 'sw-cont' },
      ),
      tile(
        'MATS auctions, per day-ahead auction',
        shortEuros(lowAuction.limit),
        `lowest, ${labels.day(lowAuction.date)}${auctionNote} · highest ${shortEuros(highAuction.limit)}`,
        { swatch: 'sw-da' },
      ),
      tile(
        'Reserved for base limits',
        shortEuros(highReserve.blr),
        `peak, ${labels.day(highReserve.date)}` +
          (lowReserve.blr < highReserve.blr ? ` · lowest ${shortEuros(lowReserve.blr)}` : ''),
      ),
    ];
  }

  function dailyTiles({ rows, sizing, labels }) {
    const peak = maxBy(rows, (row) => row.p.C);
    const others = rows.filter((row) => row !== peak);
    const low = minBy(others, (row) => row.p.C);
    const high = maxBy(others, (row) => row.p.C);
    let held = 0;
    let daysHeld = 0;
    for (const row of rows) {
      held += row.p.C * row.gap1;
      daysHeld += row.gap1;
    }
    let peakSub = `highest for ${labels.day(peak.date)}'s calculation`;
    if (peak.gap1 > 1) peakSub += ` (covers ${peak.gap1} days)`;
    if (low) {
      peakSub += ` · other days ${euros(low.p.C)}`;
      if (Math.round(high.p.C) !== Math.round(low.p.C)) peakSub += ` to ${euros(high.p.C)}`;
    }
    const fixed = sizing.staticWeek;
    const reachable = fixed && fixed.C !== null;
    return [
      tile('Collateral, optimised by day', euros(peak.p.C), peakSub, { hero: true }),
      tile(
        'Static, for comparison',
        reachable ? euros(fixed.C) : 'Not reachable',
        reachable ? `one amount all week, split ${fixed.key} / ${100 - fixed.key}` : '',
      ),
      tile(
        'Average held over the week',
        euros(held / daysHeld),
        'weighted by the calendar days each amount is in place',
      ),
    ];
  }

  function bindingText(binding, labels) {
    if (!binding) return '–';
    if (binding.market === 'base') return 'Base limits';
    if (binding.market === 'cont') return `M7 continuous, ${labels.short(binding.date)}`;
    return `MATS auctions, ${labels.short(binding.date)}`;
  }

  function bindingSub(binding, labels) {
    if (!binding) return '';
    if (binding.market === 'base')
      return `Collateral must at least cover the reserved base limits on ${labels.day(binding.date)}`;
    if (binding.market === 'cont') return `the evening calculation on ${labels.day(binding.date)} is the tightest`;
    const name = E.holidayName(E.parse(binding.date));
    const share = name ? ` (${dayNote(name)}, share of ${labels.short(binding.calc)}'s calculation)` : '';
    return `day-ahead auction on ${labels.day(binding.date)}${share}`;
  }

  function sizingTiles(view) {
    const { input, days, sizing, labels } = view;
    if (sizing.C === null) {
      const why = 'A market with a 0% split cannot get above its base limit. Change the split or the target.';
      return [tile('Collateral needed', 'Not reachable', why, { hero: true })];
    }
    if (sizing.byDay) return dailyTiles(view);
    const cheapestSplit = input.keyMode === 'cheapest';
    const scope =
      input.scope === 'weekend' && sizing.days.length < days.length
        ? `for ${sizing.days.map((day) => labels.short(E.iso(day))).join(' and ')}'s calculation, which covers the weekend`
        : 'for every day this week';
    let otherDays = '';
    if (sizing.otherDays) {
      const cheapest = cheapestSplit ? sizing.otherDays.cheapest : null;
      const mine = sizing.otherDays.mine;
      if (cheapest)
        otherDays = ` · the other days need about ${euros(cheapest.C)} at ${cheapest.key} / ${100 - cheapest.key}`;
      else if (mine !== null) otherDays = ` · the other days need ${euros(mine)} with this split`;
    }
    const sub =
      `${scope}, M7 continuous / MATS auctions split ${sizing.key} / ${100 - sizing.key}` +
      (cheapestSplit ? ' (least collateral)' : '') +
      otherDays;
    const tiles = [tile('Collateral needed', euros(sizing.C), sub, { hero: true })];
    if (cheapestSplit) {
      const { mine } = sizing;
      let mineSub = '';
      if (mine !== null) {
        mineSub =
          mine - sizing.C > 0.5
            ? `${euros(mine - sizing.C)} more than the cheapest split`
            : 'already the cheapest split';
      }
      tiles.push(
        tile(
          `With your split (${input.split} / ${100 - input.split})`,
          mine === null ? 'Not reachable' : euros(mine),
          mineSub,
        ),
      );
    } else {
      const { cheapest } = sizing;
      let cheapestSub = '';
      if (cheapest) {
        cheapestSub =
          sizing.C - cheapest.C > 0.5 ? `saves ${euros(sizing.C - cheapest.C)}` : 'your split is already the cheapest';
      }
      tiles.push(
        tile(
          `Cheapest split${cheapest ? ` (${cheapest.key} / ${100 - cheapest.key})` : ''}`,
          cheapest ? euros(cheapest.C) : 'Not reachable',
          cheapestSub,
        ),
      );
    }
    tiles.push(tile('What sets the amount', bindingText(sizing.binding, labels), bindingSub(sizing.binding, labels)));
    return tiles;
  }

  function renderTiles(view) {
    const box = clear($('tiles'));
    const tiles = view.input.mode === 'inv' ? sizingTiles(view) : limitTiles(view);
    for (const node of tiles) box.appendChild(node);
  }

  // ---------- shortfall alert ----------

  function renderAlert({ rows, labels }) {
    const box = clear($('alert'));
    const uncovered = rows.filter((row) => row.baseUncovered);
    const short = rows.filter((row) => !row.baseUncovered && row.excess < 0);
    box.hidden = !uncovered.length && !short.length;
    if (box.hidden) return;
    const dayList = (list) => list.map((row) => labels.short(row.date)).join(', ');
    let message;
    if (uncovered.length) {
      const worst = maxBy(uncovered, (row) => row.blr);
      message =
        `Your reserved base limits (${euros(worst.blr)} on ${labels.day(worst.date)}) exceed your collateral on ` +
        `${dayList(uncovered)}. ECC's tool flags this setup as invalid: lower the base limits or add collateral.`;
    } else {
      const worst = minBy(short, (row) => row.excess);
      message =
        `On ${dayList(short)} unsettled purchases and reserved base limits exceed your collateral by up to ` +
        `${euros(-worst.excess)}. No dynamic limit is added those evenings; you keep only your base limits until settlement.`;
    }
    box.appendChild(el('span', 'tag', 'Shortfall'));
    box.appendChild(el('span', null, message));
  }

  // ---------- calculation day: tabs, daily cycle, where the collateral goes ----------

  /** The day to show first: the smallest excess collateral, and on a tie the longest gap. */
  function defaultDay(rows) {
    let best = null;
    for (const row of rows) {
      const tied = best && Math.abs(row.excess - best.excess) <= 0.5;
      if (!best || row.excess < best.excess - 0.5 || (tied && row.gap1 > best.gap1)) best = row;
    }
    return best ? best.date : null;
  }

  function renderTabs({ rows, labels, standardWeek }) {
    const box = clear($('day-tabs'));
    if (!rows.some((row) => row.date === selectedDay)) selectedDay = defaultDay(rows);
    for (const row of rows) {
      const tab = el('button', 'tab');
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', row.date === selectedDay ? 'true' : 'false');
      tab.appendChild(document.createTextNode(labels.short(row.date)));
      if (row.gap1 > 1 || !standardWeek) {
        tab.appendChild(
          el('small', null, row.gap1 > 1 ? `to ${labels.short(row.nextBD)}` : MONTHS[E.parse(row.date).getUTCMonth()]),
        );
      }
      tab.addEventListener('click', () => {
        selectedDay = row.date;
        render();
      });
      box.appendChild(tab);
    }
  }

  function cycleHeader(time, what) {
    const cell = el('div', 'h step');
    cell.appendChild(el('span', 'time', time));
    cell.appendChild(el('span', 'what', what));
    return cell;
  }

  function cycleMarket(swatch, name) {
    const cell = el('div', 'mk');
    cell.appendChild(el('span', `swatch ${swatch}`));
    cell.appendChild(document.createTextNode(name));
    return cell;
  }

  function cycleCell(value, note) {
    const cell = el('div', 'step');
    cell.appendChild(el('div', 'v', value));
    if (note) cell.appendChild(el('div', 'n', note));
    return cell;
  }

  function renderCycle(row, { labels }) {
    const box = clear($('cycle'));
    $('day-title').textContent = `Your limits after the calculation on ${labels.day(row.date, true)}`;
    const next = labels.day(row.nextBD);
    const nextShort = labels.short(row.nextBD);
    const long = row.gap1 > 1;
    const shared = shareAuctions(row);
    const kind = shared.every((auction) => auction.note === 'Weekend') ? 'weekend' : 'weekend or holiday';
    const perAuction = long
      ? `Per ${kind} auction: ${shared.map((auction) => labels.short(auction.date)).join(', ')} · ÷ ${row.gap1} because ` +
        `${WEEKDAYS_LONG[weekdayOf(row.date)]}'s calculation lasts until ${WEEKDAYS_LONG[weekdayOf(row.nextBD)]}`
      : 'Per auction';
    const cells = [
      el('div', 'h'),
      cycleHeader('16:00', 'Limit resets to the base limit'),
      cycleHeader(
        'From ~18:00 (best effort)',
        `Dynamic limit added, until ${long ? `${next} morning` : 'the next morning'}`,
      ),
      cycleHeader(`By 10:45, ${next}`, 'Settled purchases added back'),
      cycleMarket('sw-cont', 'M7 continuous'),
      cycleCell(
        euros(row.cont.l16),
        long ? `Covers ${row.gap1} days, until ${nextShort} 16:00` : 'Until the dynamic limit arrives',
      ),
      cycleCell(euros(row.cont.l18), long ? `Must last until ${nextShort} morning` : 'Until settlement'),
      cycleCell(euros(row.cont.l09), `+ ${euros((row.refill * row.p.cont.key) / 100)} settled, until 16:00`),
      cycleMarket('sw-da', 'MATS auctions'),
      cycleCell(euros(row.da.l16), long ? 'Per auction day (max of BD, NBD)' : 'Base limit'),
      cycleCell(euros(row.da.l18), perAuction),
      cycleCell(
        euros(row.da.l09),
        `At ${nextShort}'s 12:00 auction${long ? ', full limit again if the weekend auctions went unused' : ''}`,
      ),
    ];
    for (const cell of cells) box.appendChild(cell);
  }

  function renderAllocation(row, { labels }) {
    const bar = clear($('alloc-bar'));
    const legend = clear($('alloc-legend'));
    $('alloc-title').textContent = `Where your collateral goes on ${labels.day(row.date)}`;
    const C = row.p.C;
    const parts = [
      { value: row.p.OR, swatch: 'sw-owed', label: 'Unsettled purchases (open risk)' },
      { value: row.blrC, swatch: 'sw-cont-res', label: 'M7 continuous: reserved for base limits' },
      { value: row.shareC, swatch: 'sw-cont', label: 'M7 continuous: share of excess' },
      { value: row.blrA, swatch: 'sw-da-res', label: 'MATS auctions: reserved for base limits' },
      { value: row.shareA, swatch: 'sw-da', label: 'MATS auctions: share of excess' },
    ];
    const total = Math.max(
      C,
      parts.reduce((sum, part) => sum + part.value, 0),
    );
    for (const part of parts) {
      if (part.value <= 0 || total <= 0) continue;
      const segment = el('div', `seg-b ${part.swatch}`);
      segment.style.flex = `${part.value} 0 0`;
      hoverable(segment, euros(part.value), part.label);
      bar.appendChild(segment);
    }
    if (total > C + 0.5 && total > 0) {
      const marker = el('div', 'marker');
      marker.style.left = `${(C / total) * 100}%`;
      marker.appendChild(el('span', null, `Collateral ${shortEuros(C)}`));
      bar.appendChild(marker);
    }
    for (const part of parts) {
      const item = el('div', 'li');
      item.appendChild(el('span', `swatch ${part.swatch}`));
      item.appendChild(el('span', null, part.label));
      item.appendChild(el('b', null, euros(part.value)));
      legend.appendChild(item);
    }
    const footer = el('div', 'total');
    footer.appendChild(el('span', null, `Collateral${row.excess < 0 ? ` (short by ${euros(-row.excess)})` : ''}`));
    footer.appendChild(el('b', null, euros(C)));
    legend.appendChild(footer);
  }

  // ---------- the week table: by ECC calculation, or by day ----------

  function groupHeader({ name, swatch, span }) {
    const cell = el('th', 'gl group');
    cell.colSpan = span;
    const title = el('span');
    title.appendChild(el('span', `swatch ${swatch}`));
    title.appendChild(document.createTextNode(name));
    cell.appendChild(title);
    return cell;
  }

  /** The table head: a row naming the markets over their columns, then the column names. */
  function weekTableHead(table, blanks, groups, columns) {
    const head = el('thead');
    const groupRow = el('tr', 'grp');
    for (let i = 0; i < blanks; i++) groupRow.appendChild(el('th', null, ''));
    for (const group of groups) groupRow.appendChild(groupHeader(group));
    head.appendChild(groupRow);
    head.appendChild(headerRow(columns));
    table.appendChild(head);
  }

  function withNote(cell, note) {
    if (note) cell.appendChild(el('div', 'small-split', note));
    return cell;
  }

  function pill(cell, className, text) {
    cell.appendChild(el('span', `pill ${className}`, text));
  }

  /* One row per calculation day: ECC's evening calculation, what it reserves, and the limits it sets. */
  function renderCalculations({ rows, sizing, labels }) {
    const table = clear($('week-table'));
    const byDay = Boolean(sizing && sizing.byDay);
    const columns = [
      'Calculation day',
      ...(byDay ? ['Collateral that day'] : []),
      'Reserved for base limits',
      'Excess collateral',
      '16:00',
      'From 18:00',
      'After settlement',
      '16:00',
      'Per auction from 18:00',
      "Next business day's auction",
    ];
    const offset = byDay ? 1 : 0;
    weekTableHead(
      table,
      byDay ? 4 : 3,
      [
        { name: 'M7 continuous', swatch: 'sw-cont', span: 3 },
        { name: 'MATS auctions', swatch: 'sw-da', span: 3 },
      ],
      columns.map((text, i) => ({ text, className: i === 3 + offset || i === 6 + offset ? 'gl' : null })),
    );
    const body = el('tbody');
    const lowCont = minBy(rows, (row) => row.cont.l18);
    const lowAuction = minBy(rows, (row) => row.da.l18);
    for (const row of rows) {
      const line = el('tr', row.date === selectedDay ? 'sel' : null);
      const day = el('td');
      day.appendChild(document.createTextNode(labels.day(row.date)));
      if (row.gap1 > 1) pill(day, 'info', `${row.gap1}-day gap`);
      if (row.excess < 0) pill(day, 'crit', 'Shortfall');
      line.appendChild(day);
      if (byDay) line.appendChild(withNote(el('td', null, euros(row.p.C)), `${row.p.cont.key} / ${row.p.da.key}`));
      // Today's and the next business day's base limits, for both markets: split so it adds up to what is reserved.
      line.appendChild(
        withNote(el('td', null, euros(row.blr)), `M7 ${shortEuros(row.blrC)} + MATS ${shortEuros(row.blrA)}`),
      );
      line.appendChild(el('td', row.excess < 0 ? 'neg' : null, euros(row.excess)));
      line.appendChild(el('td', 'gl', euros(row.cont.l16)));
      line.appendChild(el('td', row === lowCont ? 'low' : null, euros(row.cont.l18)));
      line.appendChild(el('td', null, euros(row.cont.l09)));
      line.appendChild(withNote(el('td', 'gl', euros(row.da.l16)), row.gap1 > 1 ? 'per auction day' : null));
      const shared = shareAuctions(row);
      const perAuction = euros(row.da.l18) + (row.gap1 > 1 ? ` × ${shared.length} (${shareDaysShort(shared)})` : '');
      line.appendChild(el('td', row === lowAuction ? 'low' : null, perAuction));
      line.appendChild(el('td', null, euros(row.da.l09)));
      body.appendChild(line);
    }
    table.appendChild(body);
  }

  /* The week by calendar day, Monday to Sunday: the limits a member has each day. A business day has a morning limit
     (after settlement, from the previous business day's calculation), the base limit from 16:00 and the evening limit;
     a weekend or holiday keeps the last business day's evening limit for M7. MATS: the limit at that day's 12:00
     auction. */
  function renderDays({ input, rows, labels }) {
    const table = clear($('week-table'));
    const byDate = Object.fromEntries(rows.map((row) => [row.date, row]));
    const lastRow = last(rows);
    // The calculation of a business day; outside the week, with the same parameters as the week's last one.
    const calculationOf = (iso) => {
      if (!byDate[iso]) byDate[iso] = E.day(E.parse(iso), lastRow.p);
      return byDate[iso];
    };
    weekTableHead(
      table,
      1,
      [
        { name: 'M7 continuous', swatch: 'sw-cont', span: 3 },
        { name: 'MATS auctions', swatch: 'sw-da', span: 1 },
      ],
      [
        { text: 'Day' },
        { text: 'Morning, after settlement', className: 'gl' },
        { text: 'From 16:00' },
        { text: 'From ~18:00' },
        { text: 'Day-ahead auction, 12:00', className: 'gl' },
      ],
    );
    const body = el('tbody');
    const monday = E.parse(input.week);
    // Monday to Sunday, or on to the next business day when the week ends in a holiday (Easter Monday).
    const end = Math.max(7, Math.round((E.parse(lastRow.nextBD) - monday) / DAY_MS));
    for (let i = 0; i < end; i++) {
      const date = addDays(monday, i);
      const iso = E.iso(date);
      const businessDay = E.isBD(date);
      const previous = E.iso(E.prevBD(date));
      const before = calculationOf(previous);
      const auction = before.da.auctions.find((one) => one.date === iso);
      const line = el('tr', businessDay ? (iso === selectedDay ? 'sel' : null) : 'off');
      const day = el('td');
      day.appendChild(document.createTextNode(labels.day(iso)));
      if (!businessDay) pill(day, 'info', E.holidayName(date));
      line.appendChild(day);
      if (businessDay) {
        const own = calculationOf(iso);
        line.appendChild(
          withNote(
            el('td', 'gl', euros(before.cont.l09)),
            before.gap1 > 1 ? `from ${labels.day(previous)}'s calculation` : null,
          ),
        );
        line.appendChild(el('td', null, euros(own.cont.l16)));
        line.appendChild(
          withNote(
            el('td', null, euros(own.cont.l18)),
            own.gap1 > 1 ? `until ${labels.day(own.nextBD)} morning` : null,
          ),
        );
      } else if (i === 0 || E.isBD(addDays(date, -1))) {
        // M7 doesn't reset on weekends and holidays: one limit for the whole stretch, so one cell across those days.
        let length = 0;
        while (length < end - i && !E.isBD(addDays(date, length))) length++;
        const weekend = length === 2 && date.getUTCDay() === 6;
        const stretch = el('td', 'gl span-note weekend-block');
        stretch.colSpan = 3;
        stretch.rowSpan = length;
        const reach = length === 1 ? ' all day' : weekend ? ' for the whole weekend' : ` across these ${length} days`;
        stretch.appendChild(el('b', null, euros(before.cont.l18) + reach));
        const oneLimit = length > 1 ? 'One limit, not per day: ' : '';
        stretch.appendChild(
          el(
            'div',
            'small-split',
            `${oneLimit}${labels.day(previous)}'s evening limit, until ${labels.day(before.nextBD)} morning`,
          ),
        );
        line.appendChild(stretch);
      }
      const share = auction && !auction.settled ? `a share of ${labels.day(previous)}'s calculation` : null;
      line.appendChild(withNote(el('td', 'gl', auction ? euros(auction.limit) : '–'), share));
      body.appendChild(line);
    }
    table.appendChild(body);
  }

  const renderWeek = (view) => (weekView === 'days' ? renderDays(view) : renderCalculations(view));

  // ---------- the chart: limits at 12:00 each day ----------

  /* M7 (blue) and MATS (orange) side by side each business day. Over a weekend or holiday M7 is one limit, so one blue
     bar spans the days, between the first day's orange bar (left) and the last day's (right); orange bars of days in
     between stand in front of it, outlined in the surface colour. */
  function renderAuctions(view) {
    const box = clear($('auction-chart'));
    const { rows, labels } = view;
    const items = allAuctions(rows);
    const byCalc = Object.fromEntries(rows.map((row) => [row.date, row]));
    for (const item of items) {
      const row = byCalc[item.calc];
      item.m7 = item.bd ? row.cont.l09 : row.cont.l18;
      item.m7Until = row.nextBD;
    }
    // Runs of days with one M7 limit: a business day on its own, or a weekend or holiday stretch of one calculation.
    const runs = [];
    items.forEach((item, i) => {
      const previous = last(runs);
      if (!item.bd && previous && !previous.bd && previous.calc === item.calc) previous.to = i;
      else
        runs.push({
          from: i,
          to: i,
          bd: item.bd,
          calc: item.calc,
          value: item.m7,
          until: item.m7Until,
          date: item.date,
        });
    });
    const target = view.sizing && view.sizing.C !== null ? view.input.tDa : 0;

    const width = Math.max(300, box.clientWidth || 600);
    const height = 270;
    const margin = { left: 52, right: 12, top: 34, bottom: 30 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const highest = Math.max(target, maxBy(items, (item) => item.limit).limit, maxBy(items, (item) => item.m7).m7) || 1;
    const step = niceStep(highest * 1.15, 4);
    const top = Math.ceil((highest * 1.15) / step) * step;
    const y = (value) => margin.top + plotHeight - (value / top) * plotHeight;
    const { root, add } = svgCanvas(width, height);
    const label = (x, yPos, className, text) =>
      add('text', { x, y: yPos, 'text-anchor': 'middle', class: className }, text);
    const bar = (x, barWidth, value, fill, series, ring) => {
      const barTop = y(value);
      const bottom = y(0);
      if (bottom - barTop > 0.5) {
        const shape = { d: barPath(x, barWidth, barTop, bottom), fill };
        if (ring) Object.assign(shape, { stroke: 'var(--surface)', 'stroke-width': 2 });
        add('path', { ...shape, 'data-series': series });
      }
      return barTop;
    };

    const slot = plotWidth / items.length;
    const barWidth = Math.min(20, slot * 0.3);
    const gap = 2; // between the blue and the orange bar of a day
    const centre = (i) => margin.left + i * slot + slot / 2;
    items.forEach((item, i) => {
      if (!item.bd)
        add('rect', { x: margin.left + i * slot, y: margin.top, width: slot, height: plotHeight, fill: 'var(--band)' });
    });
    for (let value = 0; value <= top + 1e-9; value += step) {
      const stroke = value === 0 ? 'var(--rule-strong)' : 'var(--rule)';
      add('line', { x1: margin.left, x2: width - margin.right, y1: y(value), y2: y(value), stroke, 'stroke-width': 1 });
      add('text', { x: margin.left - 8, y: y(value) + 4, 'text-anchor': 'end', class: 'tick' }, shortEuros(value));
    }
    items.forEach((item, i) => label(centre(i), height - margin.bottom + 18, 'xl', labels.short(item.date)));

    // Where each orange bar goes: right of the blue one on a business day; in a stretch, left on its first day, right
    // on its last, and centred in front of the blue bar in between.
    const matsX = {};
    const lowRun = minBy(runs, (run) => run.value);
    const highRun = maxBy(runs, (run) => run.value);
    for (const run of runs) {
      run.days = run.to - run.from + 1;
      let x;
      let runWidth;
      if (run.days === 1) {
        x = centre(run.from) - barWidth - gap / 2;
        runWidth = barWidth;
        matsX[run.from] = centre(run.from) + gap / 2;
      } else {
        matsX[run.from] = centre(run.from) - barWidth - gap / 2;
        matsX[run.to] = centre(run.to) + gap / 2;
        for (let k = run.from + 1; k < run.to; k++) matsX[k] = centre(k) - barWidth / 2;
        x = centre(run.from) + gap / 2;
        runWidth = centre(run.to) - gap / 2 - x;
      }
      const barTop = bar(x, runWidth, run.value, 'var(--cont)', 'm7');
      const middle = x + runWidth / 2;
      if (run.days > 1 && runWidth < 170) {
        label(middle, barTop - 20, 'dl', shortEuros(run.value));
        label(middle, barTop - 7, 'xv', 'one limit');
      } else if (run.days > 1) {
        label(middle, barTop - 7, 'dl', `${shortEuros(run.value)}, one limit for ${run.days} days`);
      } else if (run === lowRun || run === highRun) {
        label(middle, barTop - 7, 'dl', shortEuros(run.value));
      }
      const hit = add('rect', { x: x - 2, y: margin.top, width: runWidth + 4, height: plotHeight, class: 'hit' });
      const stretch =
        `M7 continuous · ${labels.day(items[run.from].date)}` +
        (run.days > 1 ? ` to ${labels.day(items[run.to].date)}` : '') +
        `: one limit${run.days > 1 ? ` for all ${run.days} days` : ''}, ` +
        `${labels.day(run.calc)}'s evening limit until ${labels.day(run.until)} morning`;
      const businessDay = `M7 continuous · ${labels.day(run.date)} at 12:00, after the morning settlement (${labels.day(run.calc)}'s calculation)`;
      hoverable(hit, euros(run.value), run.bd ? businessDay : stretch);
    }

    const lowItem = minBy(items, (item) => item.limit);
    const highItem = maxBy(items, (item) => item.limit);
    items.forEach((item, i) => {
      const run = runs.find((one) => i >= one.from && i <= one.to);
      const inFront = run.days > 2 && i > run.from && i < run.to;
      const x = matsX[i];
      const barTop = bar(x, barWidth, item.limit, 'var(--da)', 'mats', inFront);
      if (item === lowItem || item === highItem) label(x + barWidth / 2, barTop - 7, 'dl', shortEuros(item.limit));
      const hit = add('rect', { x: x - 2, y: margin.top, width: barWidth + 4, height: plotHeight, class: 'hit' });
      let when;
      if (!item.settled)
        when = `${item.note ? `${dayNote(item.note)}, ` : ''}share of ${labels.short(item.calc)}'s calculation`;
      else if (item.rollover)
        when = 'after settlement, full limit again if the weekend or holiday auctions went unused';
      else when = 'after settlement';
      hoverable(hit, euros(item.limit), `MATS auctions · ${labels.day(item.date)} day-ahead auction · ${when}`);
    });

    if (target > 0) {
      add('line', {
        x1: margin.left,
        x2: width - margin.right,
        y1: y(target),
        y2: y(target),
        stroke: 'var(--ink)',
        'stroke-width': 1.5,
        'stroke-dasharray': '5 4',
      });
      add(
        'text',
        { x: width - margin.right, y: y(target) - 6, 'text-anchor': 'end', class: 'dl' },
        `MATS target ${shortEuros(target)}`,
      );
    }
    box.appendChild(root);

    const key = clear($('auction-key'));
    const keyItem = (className, text) => {
      const item = el('span');
      item.appendChild(el('span', className));
      item.appendChild(document.createTextNode(text));
      key.appendChild(item);
    };
    keyItem('swatch sw-cont', 'M7 continuous at 12:00 (one bar across a weekend: one limit)');
    keyItem('swatch sw-da', 'MATS auctions: limit at the day-ahead auction');
    if (items.some((item) => !item.bd)) keyItem('band-key', 'Weekend or holiday');
    if (target > 0) keyItem('line-key', 'Your MATS target');
  }

  // ---------- settings for the Direct+ platform (ECC's O09 form) ----------

  const platformSettings = ({ p }) => [
    { market: 'M7 continuous', bd: p.cont.bd, nbd: p.cont.nbd, key: p.cont.key },
    { market: 'MATS auctions', bd: p.da.bd, nbd: p.da.nbd, key: p.da.key },
  ];

  function renderPlatformSettings(view) {
    $('o09-note').hidden = !(view.sizing && view.sizing.byDay);
    const table = clear($('o09-table'));
    tableHead(table, [
      { text: 'Market' },
      { text: 'Base limit, business day', className: 'r' },
      { text: 'Base limit, non-business day', className: 'r' },
      { text: 'Split of excess collateral', className: 'r' },
    ]);
    const body = el('tbody');
    for (const setting of platformSettings(view)) {
      tableRow(body, [
        { text: setting.market },
        { text: euros(setting.bd), className: 'r' },
        { text: euros(setting.nbd), className: 'r' },
        { text: `${setting.key}%`, className: 'r' },
      ]);
    }
    table.appendChild(body);
  }

  async function copyPlatformSettings() {
    if (!current) return;
    const lines = [
      'Market\tBase limit, business day\tBase limit, non-business day\tSplit %',
      ...platformSettings(current).map((setting) =>
        [setting.market, Math.round(setting.bd), Math.round(setting.nbd), setting.key].join('\t'),
      ),
    ];
    const state = $('copy-state');
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      state.textContent = 'Copied.';
    } catch {
      state.textContent = 'Copy blocked here. Select the table and copy it instead.';
    }
  }

  // ---------- links to and from the wallet estimate ----------
  // From the wallet the link also carries the wallet's own answers, so "Back" and "Use these limits" reopen the same
  // estimate.

  function walletLink(view) {
    const page = Handoff.linkTo('estimate');
    if (!page || view.C === null || !(view.C > 0)) return null;
    const { input } = view;
    const setup = {
      C: Math.round(view.C),
      key: view.key,
      cbd: input.cont.bd,
      cnbd: input.cont.nbd,
      abd: input.da.bd,
      anbd: input.da.nbd,
      week: input.week,
    };
    const pairs = [...walletState.filter(([key]) => key !== 'ecc'), ['ecc', Handoff.encode(setup)]];
    return `${page}#${Handoff.hashOf(pairs)}`;
  }

  function updateLinks(view) {
    const link = walletLink(view);
    $('to-wallet').hidden = !link;
    if (link) $('to-wallet').href = link;
    $('handoff').hidden = !fromWallet;
    if (!fromWallet) return;
    if (link) $('handoff-use').href = link;
    $('handoff-use').hidden = !link;
    $('handoff-back').href = `${Handoff.linkTo('estimate')}#${Handoff.hashOf(walletState)}`;
  }

  /** Opened from the wallet estimate: take over its collateral, split, base limits, open risk and week. */
  function arriveFromWallet() {
    const hash = Handoff.readHash();
    const w = hash.has('w') ? Handoff.decode(hash.get('w')) : null;
    const valid = w && w.C > 0 && w.key >= 0 && w.key <= 100;
    if (!valid || !ensureWeek(w.week) || !Handoff.linkTo('estimate')) return;
    fromWallet = w;
    walletState = [...hash].filter(([key]) => key !== 'w');
    $('mode-fwd').checked = true;
    $('week').value = w.week;
    weekNote();
    const fields = {
      collateral: w.C,
      'open-risk': w.or,
      'c-bd': w.cbd,
      'c-nbd': w.cnbd,
      'a-bd': w.abd,
      'a-nbd': w.anbd,
    };
    for (const [id, value] of Object.entries(fields)) $(id).value = wholeNumber.format(Math.max(0, +value || 0));
    $('split').value = w.key;
    if (w.day) selectedDay = w.day;
    const standardWeek = isStandardWeek(w.week);
    const labels = dayLabels(standardWeek);
    let text =
      `Collateral ${euros(w.C)} at a ${w.key} / ${100 - w.key} split, with the base limits and open risk ` +
      `(${euros(w.or)}) of your wallet estimate, for ${standardWeek ? 'a standard week' : `the week of ${labels.day(w.week, true)}`}.`;
    if (w.daily) text += ' Your wallet adjusts the collateral every business day; this is its highest day.';
    if (w.day) {
      text +=
        ` On ${labels.day(w.day)}'s calculation, the one that sets the amount, your trading needs M7 continuous ` +
        `${euros(w.tc)} from 18:00${w.ta > 0 ? ` and MATS auctions ${euros(w.ta)} per auction` : ''}.`;
    }
    $('handoff-text').textContent = `${text} Change anything here, then take it back to the wallet.`;
  }

  // ---------- drawing ----------

  function syncForm(input) {
    $('fwd-fields').hidden = input.mode !== 'fwd';
    $('inv-fields').hidden = input.mode !== 'inv';
    $('scope-field').hidden = input.cmode === 'daily';
    $('split').style.setProperty('--split', `${input.split}%`);
    $('split-c').textContent = `${input.split}%`;
    $('split-a').textContent = `${100 - input.split}%`;
    const comparing = input.mode === 'inv' && input.keyMode === 'cheapest';
    $('split-label').textContent = comparing
      ? 'Your current split (for comparison)'
      : 'Your split of excess collateral';
  }

  function render() {
    const input = readForm();
    syncForm(input);
    const standardWeek = isStandardWeek(input.week);
    current = { ...compute(input), standardWeek, labels: dayLabels(standardWeek) };
    renderTiles(current);
    renderAlert(current);
    renderTabs(current);
    const row = current.rows.find((one) => one.date === selectedDay) || current.rows[0];
    renderCycle(row, current);
    renderAllocation(row, current);
    renderWeek(current);
    renderAuctions(current);
    renderPlatformSettings(current);
    updateLinks(current);
  }

  let renderTimer = null;
  function schedule() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
  }

  function showWeekView(view) {
    weekView = view;
    for (const button of document.querySelectorAll('.view-switch button')) {
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    }
    $('view-sub-days').hidden = view !== 'days';
    $('view-sub-calc').hidden = view !== 'calc';
    render();
  }

  // ---------- start ----------

  for (const input of document.querySelectorAll('.money input')) setUpAmount(input);
  fillWeeks();
  weekNote();
  arriveFromWallet();
  $('setup').addEventListener('input', schedule);
  $('setup').addEventListener('change', schedule);
  $('setup').addEventListener('submit', (event) => event.preventDefault());
  $('week').addEventListener('change', () => {
    selectedDay = null;
    weekNote();
  });
  for (const button of document.querySelectorAll('.view-switch button')) {
    button.addEventListener('click', () => showWeekView(button.dataset.view));
  }
  $('copy-o09').addEventListener('click', copyPlatformSettings);
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (current) renderAuctions(current);
    }).observe($('auction-chart'));
  }
  render();
})();
