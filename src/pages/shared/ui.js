/* Direct+ pages: the small DOM, formatting, calendar and chart helpers that every page uses. No framework: each page's
   script builds its own DOM with these. */
const PageUI = ((Engine) => {
  'use strict';

  const DAY_MS = 86400000;

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);

  /** A new element, with an optional class and text. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** Empties `node` and returns it. */
  function clear(node) {
    node.textContent = '';
    return node;
  }

  const isDark = () => getComputedStyle(document.documentElement).colorScheme === 'dark';

  /** A header row: columns = [{ text, className }]. */
  function headerRow(columns) {
    const row = el('tr');
    for (const { text, className } of columns) {
      const cell = el('th', className || null, text);
      cell.scope = 'col';
      row.appendChild(cell);
    }
    return row;
  }

  /** A table's head, with one header row. */
  function tableHead(table, columns) {
    const head = el('thead');
    head.appendChild(headerRow(columns));
    table.appendChild(head);
  }

  /** A body row: cells = [{ text | node, className }]. Returns the row. */
  function tableRow(body, cells) {
    const row = el('tr');
    for (const { text, node, className } of cells) {
      const cell = el('td', className || null);
      if (node) cell.appendChild(node);
      else cell.textContent = text == null ? '' : text;
      row.appendChild(cell);
    }
    body.appendChild(row);
    return row;
  }

  // ---------- numbers and euros ----------

  const wholeNumber = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
  const euroSign = (value) => (value < 0 ? '−€' : '€');

  /** Whole euros: €1,234 or −€1,234. */
  const euros = (value) => euroSign(value) + wholeNumber.format(Math.abs(Math.round(value)));

  /** To the nearest €1,000, as the wallet pages show every estimate: €12,000, 'under €1,000' or €0. */
  function thousands(value) {
    const size = Math.abs(value);
    if (size < 0.5) return '€0';
    if (size < 1000) return 'under €1,000';
    return euroSign(value) + wholeNumber.format(Math.round(size / 1000) * 1000);
  }

  /** A difference to the nearest €1,000: +€2,000, −€1,000 or 'about the same'. */
  function thousandsDiff(difference) {
    const rounded = Math.round(difference / 1000) * 1000;
    if (rounded === 0) return 'about the same';
    return (rounded > 0 ? '+€' : '−€') + wholeNumber.format(Math.abs(rounded));
  }

  const trimZeros = (text) => text.replace(/\.?0+$/, '');

  /** Short euros for chart labels: €950, €1.5k, €12k, €1.25m. */
  function shortEuros(value) {
    const size = Math.abs(value);
    const sign = euroSign(value);
    if (size >= 1e6) return `${sign}${trimZeros((size / 1e6).toFixed(size >= 1e7 ? 1 : 2))}m`;
    if (size >= 1e4) return `${sign}${Math.round(size / 1e3)}k`;
    if (size >= 1e3) return `${sign}${(size / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
    return `${sign}${Math.round(size)}`;
  }

  /** Short euros in whole thousands, as the wallet pages round: <€1k, €12k, €1.25m. */
  function shortThousands(value) {
    const size = Math.abs(value);
    const sign = euroSign(value);
    if (size >= 1e6) return `${sign}${trimZeros((size / 1e6).toFixed(2))}m`;
    if (size >= 500) return `${sign}${Math.round(size / 1e3)}k`;
    return size < 0.5 ? '€0' : '<€1k';
  }

  // ---------- dates (ISO strings, UTC days) ----------

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
  const plusDays = (iso, days) => Engine.iso(addDays(Engine.parse(iso), days));
  const mondayOf = (date) => addDays(date, -((date.getUTCDay() + 6) % 7));

  /** 'Mon 5 Oct', or 'Mon 5 Oct 2026' with the year. */
  function dateLabel(iso, withYear) {
    const date = Engine.parse(iso);
    const label = `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
    return withYear ? `${label} ${date.getUTCFullYear()}` : label;
  }

  // The weeks the pages can show: the full weeks of ECC's calendar in the engine.
  const FIRST_WEEK = Engine.iso(mondayOf(addDays(Engine.parse(Engine.MIN_DATE), 6)));
  const LAST_WEEK = Engine.iso(mondayOf(Engine.parse(Engine.MAX_DATE)));

  /** The Monday of the week that holds `iso`, within the calendar's weeks. */
  function clampWeek(iso) {
    const monday = Engine.iso(mondayOf(Engine.parse(iso)));
    if (monday < FIRST_WEEK) return FIRST_WEEK;
    if (monday > LAST_WEEK) return LAST_WEEK;
    return monday;
  }

  /** Next Monday (never today), within the calendar's weeks. */
  function nextMonday() {
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    return clampWeek(Engine.iso(addDays(today, (8 - today.getUTCDay()) % 7 || 7)));
  }

  const HOLIDAY_SHORT_NAMES = {
    "New Year's Day": 'New Year',
    'Good Friday': 'Easter',
    'Easter Monday': 'Easter',
    'Christmas Day': 'Christmas',
  };

  /**
   * The weekday ECC holidays of the next 12 months, by week: each goes to the week that holds the last business day
   * before it, whose calculation has to bridge the holiday. Holidays in the same week share it.
   * Returns [{ monday, days: [iso], names: [short names, once each] }].
   */
  function holidayWeeks() {
    const today = Engine.iso(new Date());
    const until = plusDays(today, 365);
    const weeks = new Map();
    for (const day of Object.keys(Engine.HOLIDAYS).sort()) {
      if (day < today || day > until || day > Engine.MAX_DATE) continue;
      const monday = Engine.iso(mondayOf(Engine.prevBD(Engine.parse(day))));
      if (monday < Engine.MIN_DATE) continue;
      if (!weeks.has(monday)) weeks.set(monday, { monday, days: [] });
      weeks.get(monday).days.push(day);
    }
    return [...weeks.values()].map((week) => {
      const names = week.days.map((day) => HOLIDAY_SHORT_NAMES[Engine.HOLIDAYS[day]] || Engine.HOLIDAYS[day]);
      return { ...week, names: [...new Set(names)] };
    });
  }

  // ---------- tooltip (the page's #tip element) ----------

  function showTip(event, value, label) {
    const tip = clear($('tip'));
    tip.appendChild(el('div', 'tv', value));
    tip.appendChild(el('div', 'tl', label));
    tip.hidden = false;
    let x;
    let y;
    if (event.clientX != null && event.type.startsWith('pointer')) {
      x = event.clientX;
      y = event.clientY;
    } else {
      const box = event.target.getBoundingClientRect();
      x = box.left + box.width / 2;
      y = box.top;
    }
    tip.style.left = `${Math.min(Math.max(8, x + 12), window.innerWidth - tip.offsetWidth - 8)}px`;
    const top = y - tip.offsetHeight - 12;
    tip.style.top = `${top < 8 ? y + 16 : top}px`;
  }
  const hideTip = () => {
    $('tip').hidden = true;
  };

  /** Makes `node` focusable, with a tooltip on hover and focus: the value in bold, then the label. */
  function hoverable(node, value, label) {
    node.tabIndex = 0;
    node.setAttribute('aria-label', `${label}: ${value}`);
    node.addEventListener('pointermove', (event) => showTip(event, value, label));
    node.addEventListener('pointerleave', hideTip);
    node.addEventListener('focus', (event) => showTip(event, value, label));
    node.addEventListener('blur', hideTip);
  }

  // ---------- charts ----------

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** An <svg> of the given size, and add(tag, attributes, text) to draw in it. */
  function svgCanvas(width, height) {
    const root = document.createElementNS(SVG_NS, 'svg');
    root.setAttribute('width', width);
    root.setAttribute('height', height);
    root.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const add = (tag, attributes, text) => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      if (text != null) node.textContent = text;
      root.appendChild(node);
      return node;
    };
    return { root, add };
  }

  /** The outline of a bar from `bottom` up to `top` (SVG y), with rounded top corners. */
  function barPath(x, width, top, bottom) {
    const r = Math.min(4, (bottom - top) / 2);
    return (
      `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}` +
      `H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${bottom}Z`
    );
  }

  /** A round step for about `count` gridlines up to `max`: 1, 2, 2.5 or 5 times a power of ten. */
  function niceStep(max, count) {
    const raw = max / count;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const factor = raw / magnitude;
    const nice = factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 2.5 ? 2.5 : factor <= 5 ? 5 : 10;
    return nice * magnitude;
  }

  /**
   * Horizontal stacked bars (the wallet pages): one row per bar, its width relative to the largest total.
   *   rows    [{ label, total, totalText, segments: [{ value, color, lightInk, text, tip: { value, label } }] }];
   *           segments of €0.50 or less are left out, and lightInk marks light fills that take dark text in light mode
   *   reserve the px each row keeps for its total, next to the bar
   * A segment's label that does not fit is hidden: the tooltip and the table still give it.
   */
  function stackedBars(box, rows, reserve) {
    clear(box);
    const max = Math.max(...rows.map((row) => row.total), 1);
    for (const row of rows) {
      const line = el('div', 'bar-row');
      line.appendChild(el('div', 'rl', row.label));
      const track = el('div', 'bar-track');
      const bar = el('div', 'bar');
      bar.style.width = `calc((100% - ${reserve}px) * ${row.total / max})`;
      for (const segment of row.segments) {
        if (segment.value <= 0.5) continue;
        const piece = el('div', segment.lightInk && !isDark() ? 'sg light-ink' : 'sg');
        piece.style.flex = `${segment.value} 0 0`;
        piece.style.background = segment.color;
        piece.appendChild(el('span', null, segment.text));
        hoverable(piece, segment.tip.value, segment.tip.label);
        bar.appendChild(piece);
      }
      track.appendChild(bar);
      track.appendChild(el('div', 'bar-total', row.totalText));
      line.appendChild(track);
      box.appendChild(line);
    }
    requestAnimationFrame(() => {
      for (const piece of box.querySelectorAll('.sg')) {
        const label = piece.firstChild;
        label.style.visibility = label.scrollWidth + 8 <= piece.clientWidth ? '' : 'hidden';
      }
    });
  }

  /** A legend entry: a colour swatch and its text. */
  function legendItem(color, text) {
    const item = el('span');
    const swatch = el('span', 'swatch');
    swatch.style.background = color;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(text));
    return item;
  }

  const last = (list) => list[list.length - 1];

  return {
    $,
    el,
    clear,
    isDark,
    headerRow,
    tableHead,
    tableRow,
    wholeNumber,
    euros,
    thousands,
    thousandsDiff,
    shortEuros,
    shortThousands,
    WEEKDAYS,
    WEEKDAYS_LONG,
    MONTHS,
    DAY_MS,
    addDays,
    plusDays,
    mondayOf,
    dateLabel,
    clampWeek,
    nextMonday,
    holidayWeeks,
    hoverable,
    svgCanvas,
    barPath,
    niceStep,
    stackedBars,
    legendItem,
    last,
  };
})(LimitEngine);
