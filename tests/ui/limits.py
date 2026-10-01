"""The limit calculator: the week list and its labels, the day view and ECC's calculations in a standard week and at
Easter, the chart, the method section, the market names (M7, MATS), the amount fields, the deck example's sizing
(EUR 602,986 at 33/67), collateral optimised by day, the phone layout, and printing a case on one A4 page."""

import re

from support import PHONE, fits, main, redrawn

ROW_TEXTS = 'rows => rows.map(row => row.innerText.replace(/\\s+/g, " "))'
TILE_TEXTS = 'tiles => tiles.map(tile => tile.innerText.replace(/\\n/g, " / "))'
DATED = re.compile(
    r'\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d{1,2}\b(?!:)'
)


def week_rows(tab):
    return tab.eval_on_selector_all('#week-table tbody tr', ROW_TEXTS)


def show(tab, view):
    tab.click(f'.view-switch [data-view="{view}"]')


def weeks(run):
    """A standard week by default, named by weekday only; the ECC holiday weeks of the next 12 months."""
    tab = run.open('limits')
    check = run.check
    options = tab.eval_on_selector_all('#week option', 'options => options.map(o => [o.value, o.textContent])')
    check(
        options[0] == ['2026-10-05', 'A standard week, no holidays'] and tab.input_value('#week') == '2026-10-05',
        'the standard week is selected: 5 Oct 2026',
    )
    check(tab.inner_text('#week-note').startswith('A standard week'), 'the note says it is a standard week')
    shown = ''.join(tab.inner_text(one) for one in ['#day-tabs', '#cycle', '#week-table', '#tiles', '#auction-chart'])
    check(
        not DATED.search(shown) and 'Oct' not in tab.inner_text('#day-tabs'), 'a standard week shows weekdays, no dates'
    )
    holidays = [
        ['2026-12-21', 'Christmas · Fri 25 Dec 2026'],
        ['2026-12-28', 'New Year · Fri 1 Jan 2027'],
        ['2027-03-22', 'Easter · 26–29 Mar 2027'],
    ]
    check(options[1:] == holidays, 'holiday weeks: Christmas, New Year, Easter 2027 (Easter as one option)')
    by_calculation = tab.get_attribute('.view-switch [data-view="calc"]', 'aria-pressed') == 'true'
    check(
        by_calculation and len(week_rows(tab)) == 5 and tab.is_visible('#view-sub-calc'),
        "the week shows ECC's calculations by default, one row per business day",
    )


def easter(run):
    """The Easter week keeps its dates, and Thursday's calculation carries the holidays."""
    tab = run.open('limits')
    check = run.check
    tab.select_option('#week', '2027-03-22')
    redrawn(tab)
    tabs = tab.inner_text('#day-tabs')
    check(
        'Thu 25' in tabs and 'Mar' in tabs and 'Good Friday' in tab.inner_text('#week-note'),
        'picking Easter jumps to the week of 22 Mar 2027, with dates: ' + tabs.replace('\n', ' '),
    )
    show(tab, 'days')
    rows = week_rows(tab)
    carried = len(rows) == 8 and '€216,000 across these 4 days' in rows[4] and '€216,000' not in ''.join(rows[5:8])
    check(
        carried
        and 'Fri 26 Mar' in rows[4]
        and 'Good Friday' in rows[4]
        and 'Mon 29 Mar' in rows[7]
        and 'Easter Monday' in rows[7],
        'day view, Easter: Monday to Easter Monday, holidays carried by Thursday',
    )
    show(tab, 'calc')
    week = tab.inner_text('#week-table')
    check(
        '× 4 (Fri–Mon)' in week and '× 5' not in week,
        'Easter week table: the Thursday share covers 4 auctions (Fri–Mon), not 5',
    )
    cycle = tab.inner_text('#cycle')
    check(
        "because Thursday's calculation lasts until Tuesday" in cycle and 'Mon 29' in cycle,
        'Easter panel: ÷ 5 until Tuesday, Easter Monday among the shared auctions',
    )


def standard_week(run):
    """The weekend in the day view, in ECC's calculations, in Friday's panel and in the chart."""
    tab = run.open('limits')
    check = run.check
    show(tab, 'days')
    rows = week_rows(tab)
    by_day = tab.get_attribute('.view-switch [data-view="days"]', 'aria-pressed') == 'true'
    check(by_day and len(rows) == 7 and tab.is_visible('#view-sub-days'), 'the day view: Monday to Sunday')
    saturday, sunday = rows[5], rows[6]
    weekend = (
        '€220,000 for the whole weekend' in saturday
        and 'One limit, not per day' in saturday
        and '€220,000' not in sunday
    )
    check(
        saturday.startswith('Saturday')
        and 'Weekend' in saturday
        and weekend
        and '€50,000' in saturday
        and '€50,000' in sunday
        and 'from Friday' in rows[0],
        "weekend days: M7 keeps Friday's evening limit all day, MATS a share; Monday morning from Friday: " + saturday,
    )
    show(tab, 'calc')
    week = tab.inner_text('#week-table')
    check(
        'RESERVED FOR BASE LIMITS' in week.upper() and len(week_rows(tab)) == 5,
        "the switch shows ECC's calculations, one row per business day",
    )
    check('€50,000 × 2 (Sat, Sun)' in week and '× 3' not in week, 'weekend in the week table: €50,000 × 2 (Sat, Sun)')
    cycle = tab.inner_text('#cycle')
    check(
        "Per weekend auction: Sat, Sun · ÷ 3 because Friday's calculation lasts until Monday" in cycle
        and 'Mon ·' not in cycle,
        'Friday panel: weekend auctions only, ÷ 3 explained',
    )
    bars = tab.evaluate("""() => {
      const chart = document.getElementById('auction-chart');
      const count = (series) => chart.querySelectorAll(`[data-series="${series}"]`).length;
      return [count('m7'), count('mats'), chart.textContent.includes('one limit'), chart.querySelectorAll('svg').length];
    }""")
    check(
        bars == [6, 7, True, 1],
        'chart (bars): one graph; M7 one bar per business day and one across the weekend (6), MATS one per auction (7): '
        + str(bars[:2]),
    )
    check(tab.query_selector('.chart-switch') is None, 'the chart is bars only: no style switch')


def method(run):
    """'How the calculation works' starts collapsed and opens on click."""
    tab = run.open('limits')
    check = run.check
    check(
        not tab.eval_on_selector('#method', 'details => details.open') and tab.is_hidden('.method-grid'),
        '"How the calculation works" starts collapsed',
    )
    tab.click('#method > summary')
    check(
        tab.is_visible('.method-grid') and 'Assumptions and limits' in tab.inner_text('#method'), 'and opens on click'
    )


def market_names(run):
    """M7 and MATS everywhere, explained once in the header."""
    tab = run.open('limits')
    check = run.check
    key = tab.inner_text('.markets-key')
    check(
        'M7 continuous' in key and 'MATS auctions' in key and 'day-ahead auction and intraday auctions' in key,
        'the header explains M7 continuous and MATS auctions',
    )
    text = tab.inner_text('body')
    check('Continuous' not in text and 'Day-ahead' not in text, 'no "Continuous" or "Day-ahead" labels left')
    legends = tab.eval_on_selector_all('fieldset.market legend', 'legends => legends.map(l => l.innerText.trim())')
    check(legends == ['M7 continuous', 'MATS auctions'], 'market sections are M7 continuous and MATS auctions')


def amounts(run):
    """Thousands separators as you type; the arrow keys and buttons step."""
    tab = run.open('limits')
    check = run.check
    check(
        tab.input_value('#collateral') == '500,000' and tab.input_value('#c-bd') == '20,000',
        'amounts start with separators',
    )
    before = tab.inner_text('#tiles')
    tab.fill('#collateral', '')
    tab.click('#collateral')
    tab.keyboard.type('1234567')
    redrawn(tab)
    check(tab.input_value('#collateral') == '1,234,567', 'typing 1234567 shows 1,234,567')
    check(tab.inner_text('#tiles') != before, 'the typed amount is read (limits change)')
    # The caret after the first digit (Home does not move it in a Mac text field, so place it directly).
    tab.evaluate("document.getElementById('collateral').setSelectionRange(1, 1)")
    tab.keyboard.type('0')
    check(tab.input_value('#collateral') == '10,234,567', 'typing in the middle keeps the separators: 10,234,567')
    tab.keyboard.type('9')
    check(tab.input_value('#collateral') == '109,234,567', 'the caret stays after the typed digit: 109,234,567')
    tab.fill('#collateral', '500,000')
    tab.click('#c-bd')
    tab.keyboard.press('ArrowUp')
    up = tab.input_value('#c-bd')
    tab.keyboard.press('ArrowDown')
    tab.keyboard.press('ArrowDown')
    check(
        up == '21,000' and tab.input_value('#c-bd') == '19,000',
        'base limits: arrow keys step by €1,000: 21,000 then 19,000',
    )
    tab.click('#c-bd + .steppers .step-up')
    tab.click('#c-bd + .steppers .step-up')
    check(tab.input_value('#c-bd') == '21,000', 'base limits: the up arrow button steps by €1,000: 21,000')
    tab.click('#c-bd + .steppers .step-down')
    check(tab.input_value('#c-bd') == '20,000', 'base limits: the down arrow button steps back: 20,000')
    tab.click('#collateral + .steppers .step-up')
    check(tab.input_value('#collateral') == '510,000', 'collateral: the up arrow button steps by €10,000: 510,000')
    tab.click('#collateral + .steppers .step-down')
    tab.locator('#a-nbd + .steppers .step-down').hover()
    tab.mouse.down()
    tab.wait_for_timeout(900)  # holding the button
    tab.mouse.up()
    held = tab.input_value('#a-nbd').replace(',', '')
    check(held.isdigit() and int(held) < 9000, f'holding an arrow keeps stepping: 10,000 down to {held}')
    tab.fill('#a-nbd', '10,000')
    tab.fill('#c-bd', '20,000')
    redrawn(tab)
    check(tab.inner_text('#tiles') == before, 'back to the defaults, the same limits as at the start')


def sizing(run):
    """Collateral for target limits: the deck example, and collateral optimised by day."""
    tab = run.open('limits')
    check = run.check
    tab.click('label[for=mode-inv]')
    first = tab.eval_on_selector('#scope-field input', 'input => input.id')
    check(first == 'scope-week' and tab.is_checked('#scope-week'), 'Size for: the whole week, first and by default')
    tab.click('label:has(#scope-week)')
    tab.click('label:has(#key-cheapest)')
    redrawn(tab)
    first = tab.eval_on_selector_all('.tile', TILE_TEXTS)[0]
    check(
        '602,986' in first and 'M7 continuous / MATS auctions split 33 / 67' in first,
        f'deck example: €602,986 at 33/67 ({first})',
    )
    # Optimised by day: each day on its own with its own cheapest split (Fri €580,282 at 29/71, Mon-Wed €350,323,
    # Thu €390,323), the static amount for comparison, and the average held weighted by calendar days.
    tab.click('label:has(#cmode-daily)')
    redrawn(tab)
    tiles = tab.eval_on_selector_all('.tile', TILE_TEXTS)
    by_day = len(tiles) == 3 and all(amount in tiles[0] for amount in ['580,282', '350,323', '390,323'])
    check(by_day and '602,986' in tiles[1] and '454,591' in tiles[2], 'optimised by day: ' + ' | '.join(tiles))
    check(
        'COLLATERAL THAT DAY' in tab.inner_text('#week-table').upper(),
        'the week table has the collateral-that-day column',
    )
    heads = tab.eval_on_selector_all(
        '#week-table thead tr:last-child th', 'heads => heads.map(h => h.innerText.trim())'
    )
    check(
        heads.count('16:00') == 2, 'the week table shows the 16:00 base limit for M7 and for MATS: ' + ' | '.join(heads)
    )
    first_row = tab.eval_on_selector_all(
        '#week-table tbody tr:first-child td', 'cells => cells.map(c => c.innerText.replace(/\\n/g, " "))'
    )
    check(
        any('M7 €' in cell and '+ MATS €' in cell for cell in first_row),
        'the reservation shows its M7 + MATS split: ' + ' | '.join(first_row),
    )
    tab.set_viewport_size(PHONE)
    redrawn(tab)  # the chart redraws for the new width in the next frame
    check(fits(tab, PHONE['width']), 'sizing fits a 390 px phone screen')


def phone(run):
    tab = run.open('limits', viewport=PHONE)
    run.check(fits(tab, PHONE['width']), 'fits a 390 px phone screen')


def day_tabs(run):
    """The day tabs: one tab stop, and the arrow keys move between the days."""
    tab = run.open('limits')
    check = run.check
    selected = '#day-tabs [aria-selected="true"]'
    check(
        tab.inner_text(selected).startswith('Fri') and len(tab.query_selector_all('#day-tabs [tabindex="0"]')) == 1,
        'Friday is selected, and it is the only tab stop',
    )
    tab.focus(selected)
    tab.keyboard.press('ArrowRight')
    focused = tab.evaluate('document.activeElement.getAttribute("aria-selected")') == 'true'
    check(
        tab.inner_text(selected) == 'Mon' and focused and 'Monday' in tab.inner_text('#day-title'),
        'ArrowRight wraps to Monday, keeps the focus and shows its calculation',
    )


def pdf_pages(tab):
    """The pages of the page printed to PDF on A4."""
    return len(re.findall(rb'/Type\s*/Page[^s]', tab.pdf(format='A4', prefer_css_page_size=True)))


def printing(run):
    """Print or save as PDF: one A4 page with the case's inputs and its results, in the light colours."""
    tab = run.open('limits')
    check = run.check
    check(tab.is_visible('#print'), 'the print button shows (hosted site, or the page on disk)')
    inputs = tab.eval_on_selector('#print-inputs', 'list => list.textContent')
    check('Collateral posted€500,000' in inputs, 'the printed page lists the case: ' + inputs[:80])
    check(pdf_pages(tab) == 1, 'limits from collateral: one page')
    # The longest case: target limits, collateral optimised by day (an extra column), shown by day.
    tab.click('label[for=mode-inv]')
    tab.click('label:has(#cmode-daily)')
    redrawn(tab)
    show(tab, 'days')
    redrawn(tab)
    check(pdf_pages(tab) == 1, 'target limits, optimised by day, shown by day: one page')
    tab.emulate_media(color_scheme='dark')
    tab.evaluate("window.dispatchEvent(new Event('beforeprint'))")
    theme = tab.evaluate("document.documentElement.getAttribute('data-theme')")
    tab.evaluate("window.dispatchEvent(new Event('afterprint'))")
    after = tab.evaluate("document.documentElement.getAttribute('data-theme')")
    check(theme == 'light' and after is None, 'dark screen: prints in the light colours, then back')


def check_limits(run):
    for scenario in [weeks, easter, standard_week, method, market_names, amounts, sizing, phone, day_tabs, printing]:
        scenario(run)


if __name__ == '__main__':
    main([('Limit calculator', check_limits)])
