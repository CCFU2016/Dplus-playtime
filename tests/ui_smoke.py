"""Opens the built standalone calculator in headless Chromium and checks it runs without errors
and still shows the known sizing result for the deck example (week of 5 Oct 2026, whole week,
cheapest split: EUR 602,986 at 33/67). Also checks the market names (M7, MATS), the amounts'
thousands separators and arrow-key steps, and the phone layout. Needs: pip install playwright
(Chromium already installed)."""
import pathlib, re, sys
from playwright.sync_api import sync_playwright
f = (pathlib.Path(__file__).parent.parent / 'dist/standalone/direct-plus-limit-calculator.html').resolve().as_uri()
checks = []
def check(ok, what): checks.append((bool(ok), what)); print('ok  ' if ok else 'FAIL', what)
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 1000})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    # The page picks its weeks from today: fix today at Mon 28 Sep 2026, so the standard week is the deck's, 5 Oct.
    pg.clock.set_fixed_time('2026-09-28T09:00:00')
    pg.goto(f); pg.wait_for_timeout(600)

    # Week: a standard week by default, and the ECC holiday weeks of the next 12 months.
    opts = pg.eval_on_selector_all('#week option', 'os => os.map(o => [o.value, o.textContent])')
    print('     weeks:', opts)
    check(opts[0] == ['2026-10-05', 'A standard week, no holidays'] and pg.input_value('#week') == '2026-10-05', 'the standard week is selected: 5 Oct 2026')
    check(pg.inner_text('#week-note').startswith('A standard week'), 'the note says it is a standard week')
    plain = pg.inner_text('#day-tabs') + pg.inner_text('#cycle') + pg.inner_text('#week-table') + pg.inner_text('#tiles')
    check(not re.search(r'\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d{1,2}\b(?!:)', plain + pg.inner_text('#auction-chart')) and 'Oct' not in pg.inner_text('#day-tabs'), 'a standard week shows weekdays, no dates')
    check([o[0] for o in opts[1:]] == ['2026-12-21', '2026-12-28', '2027-03-22'] and [o[1] for o in opts[1:]] == ['Christmas · Fri 25 Dec 2026', 'New Year · Fri 1 Jan 2027', 'Easter · 26–29 Mar 2027'], 'holiday weeks: Christmas, New Year, Easter 2027 (Easter as one option)')
    pg.select_option('#week', '2027-03-22'); pg.wait_for_timeout(400)
    tabs = pg.inner_text('#day-tabs')
    check('Thu 25' in tabs and 'Mar' in tabs and 'Good Friday' in pg.inner_text('#week-note'), 'picking Easter jumps to the week of 22 Mar 2027, with dates: ' + tabs.replace(chr(10), ' '))
    rows = pg.eval_on_selector_all('#week-table tbody tr', 'rs => rs.map(r => r.innerText.replace(/\\s+/g, " "))')
    check(len(rows) == 8 and 'Fri 26 Mar' in rows[4] and 'Good Friday' in rows[4] and 'Mon 29 Mar' in rows[7] and 'Easter Monday' in rows[7] and '€216,000 across these 4 days' in rows[4] and '€216,000' not in rows[5] + rows[6] + rows[7], 'day view, Easter: Monday to Easter Monday, holidays carried by Thursday')
    pg.click('.view-switch [data-view="calc"]'); pg.wait_for_timeout(300)
    week = pg.inner_text('#week-table')
    check('× 4 (Fri–Mon)' in week and '× 5' not in week, 'Easter week table: the Thursday share covers 4 auctions (Fri–Mon), not 5')
    pg.click('.view-switch [data-view="days"]'); pg.wait_for_timeout(300)
    check('because Thursday\'s calculation lasts until Tuesday' in pg.inner_text('#cycle') and 'Mon 29' in pg.inner_text('#cycle'), 'Easter panel: ÷ 5 until Tuesday, Easter Monday among the shared auctions')
    pg.select_option('#week', '2026-10-05'); pg.wait_for_timeout(400)
    rows = pg.eval_on_selector_all('#week-table tbody tr', 'rs => rs.map(r => r.innerText.replace(/\\s+/g, " "))')
    check(pg.get_attribute('.view-switch [data-view="days"]', 'aria-pressed') == 'true' and len(rows) == 7, 'the week shows by day by default, Monday to Sunday')
    check(rows[5].startswith('Saturday') and 'Weekend' in rows[5] and '€220,000 for the whole weekend' in rows[5] and 'One limit, not per day' in rows[5] and '€50,000' in rows[5] and '€220,000' not in rows[6] and '€50,000' in rows[6] and 'from Friday' in rows[0], 'weekend days: M7 keeps Friday\'s evening limit all day, MATS a share; Monday morning from Friday: ' + rows[5])
    pg.click('.view-switch [data-view="calc"]'); pg.wait_for_timeout(300)
    check('RESERVED FOR BASE LIMITS' in pg.inner_text('#week-table').upper() and len(pg.query_selector_all('#week-table tbody tr')) == 5, 'the switch shows ECC\'s calculations, one row per business day')
    week = pg.inner_text('#week-table'); cyc = pg.inner_text('#cycle')
    check('€50,000 × 2 (Sat, Sun)' in week and '× 3' not in week, 'weekend in the week table: €50,000 × 2 (Sat, Sun)')
    check('Per weekend auction: Sat, Sun · ÷ 3 because Friday\'s calculation lasts until Monday' in cyc and 'Mon ·' not in cyc, 'Friday panel: weekend auctions only, ÷ 3 explained')
    bars = pg.evaluate("""() => { const ps = Array.from(document.querySelectorAll('#auction-chart path')); return [ps.filter(p => p.getAttribute('fill') === 'var(--cont)').length, ps.filter(p => p.getAttribute('fill') === 'var(--da)').length, document.getElementById('auction-chart').textContent]; }""")
    check(bars[0] == 6 and bars[1] == 7 and 'one limit for 2 days' in bars[2], 'chart: M7 has one bar for the weekend (6 bars), MATS one per auction (7): ' + str(bars[:2]))

    # Market names: M7 and MATS everywhere, explained once in the header.
    text = pg.inner_text('body')
    key = pg.inner_text('.markets-key')
    check('M7 continuous' in key and 'MATS auctions' in key and 'day-ahead auction and intraday auctions' in key, 'the header explains M7 continuous and MATS auctions')
    check('Continuous' not in text and 'Day-ahead' not in text, 'no "Continuous" or "Day-ahead" labels left')
    check(pg.eval_on_selector_all('fieldset.market legend', 'ls => ls.map(l => l.innerText.trim())') == ['M7 continuous', 'MATS auctions'], 'market sections are M7 continuous and MATS auctions')

    # Amounts: thousands separators, formatted as you type; arrow keys step.
    check(pg.input_value('#collateral') == '500,000' and pg.input_value('#c-bd') == '20,000', 'amounts start with separators')
    before = pg.inner_text('#tiles')
    pg.fill('#collateral', ''); pg.click('#collateral'); pg.keyboard.type('1234567'); pg.wait_for_timeout(300)
    check(pg.input_value('#collateral') == '1,234,567', 'typing 1234567 shows 1,234,567')
    check(pg.inner_text('#tiles') != before, 'the typed amount is read (limits change)')
    # the cursor after the first digit (Home does not move it in a Mac text field, so place it directly)
    pg.evaluate("document.getElementById('collateral').setSelectionRange(1, 1)"); pg.keyboard.type('0'); pg.wait_for_timeout(100)
    check(pg.input_value('#collateral') == '10,234,567', 'typing in the middle keeps the separators: 10,234,567')
    pg.keyboard.type('9'); pg.wait_for_timeout(100)
    check(pg.input_value('#collateral') == '109,234,567', 'the caret stays after the typed digit: 109,234,567')
    pg.fill('#collateral', '500,000'); pg.click('#c-bd'); pg.keyboard.press('ArrowUp'); pg.wait_for_timeout(100)
    up = pg.input_value('#c-bd')
    pg.keyboard.press('ArrowDown'); pg.keyboard.press('ArrowDown'); pg.wait_for_timeout(300)
    check(up == '21,000' and pg.input_value('#c-bd') == '19,000', 'base limits: arrow keys step by €1,000: 21,000 then 19,000')
    pg.click('#c-bd + .steppers .step-up'); pg.click('#c-bd + .steppers .step-up'); pg.wait_for_timeout(100)
    check(pg.input_value('#c-bd') == '21,000', 'base limits: the up arrow button steps by €1,000: 21,000')
    pg.click('#c-bd + .steppers .step-down'); pg.wait_for_timeout(100)
    check(pg.input_value('#c-bd') == '20,000', 'base limits: the down arrow button steps back: 20,000')
    pg.click('#collateral + .steppers .step-up'); pg.wait_for_timeout(100)
    check(pg.input_value('#collateral') == '510,000', 'collateral: the up arrow button steps by €10,000: 510,000')
    pg.click('#collateral + .steppers .step-down'); pg.wait_for_timeout(100)
    down = pg.locator('#a-nbd + .steppers .step-down'); down.hover(); pg.mouse.down(); pg.wait_for_timeout(900); pg.mouse.up(); pg.wait_for_timeout(200)
    held = pg.input_value('#a-nbd')
    check(held.replace(',', '').isdigit() and int(held.replace(',', '')) < 9000, 'holding an arrow keeps stepping: 10,000 down to ' + held)
    pg.fill('#a-nbd', '10,000'); pg.fill('#c-bd', '20,000'); pg.wait_for_timeout(300)
    check(pg.inner_text('#tiles') == before, 'back to the defaults, the same limits as at the start')

    pg.click('label[for=mode-inv]'); pg.wait_for_timeout(300)
    pg.click('label:has(#scope-week)'); pg.click('label:has(#key-cheapest)'); pg.wait_for_timeout(400)
    tile = pg.eval_on_selector_all('.tile', 'ts => ts.map(t => t.innerText.replace(/\\n/g, " / "))')[0]
    check('602,986' in tile and 'M7 continuous / MATS auctions split 33 / 67' in tile, 'deck example: €602,986 at 33/67 (' + tile + ')')
    # Optimised by day: each day on its own with its own cheapest split (Fri €580,282 at 29/71, Mon-Wed €350,323,
    # Thu €390,323), the static amount for comparison, and the average held weighted by calendar days.
    pg.click('label:has(#cmode-daily)'); pg.wait_for_timeout(500)
    tiles = pg.eval_on_selector_all('.tile', 'ts => ts.map(t => t.innerText.replace(/\\n/g, " / "))')
    week = pg.inner_text('#week-table')
    check(len(tiles) == 3 and '580,282' in tiles[0] and '350,323' in tiles[0] and '390,323' in tiles[0] and '602,986' in tiles[1] and '454,591' in tiles[2], 'optimised by day: ' + ' | '.join(tiles))
    check('COLLATERAL THAT DAY' in week.upper(), 'the week table has the collateral-that-day column')
    heads = pg.eval_on_selector_all('#week-table thead tr:last-child th', 'hs => hs.map(h => h.innerText.trim())')
    check(heads.count('16:00') == 2, 'the week table shows the 16:00 base limit for M7 and for MATS: ' + ' | '.join(heads))
    first = pg.eval_on_selector_all('#week-table tbody tr:first-child td', 'ts => ts.map(t => t.innerText.replace(/\\n/g, " "))')
    check(any('M7 €' in c and '+ MATS €' in c for c in first), 'the reservation shows its M7 + MATS split: ' + ' | '.join(first))

    # Phone width: nothing wider than the screen.
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
    check(pg.evaluate('document.documentElement.scrollWidth') <= 390, 'fits a 390 px phone screen')
    b.close()
check(not errs, 'no console errors' + ('' if not errs else ': ' + '; '.join(errs)))
ok = all(c[0] for c in checks)
print('UI smoke test', 'passed' if ok else 'FAILED'); sys.exit(0 if ok else 1)
