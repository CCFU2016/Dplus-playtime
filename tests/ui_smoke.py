"""Opens the built standalone calculator in headless Chromium and checks it runs without errors
and still shows the known sizing result for the deck example (week of 5 Oct 2026, whole week,
cheapest split: EUR 602\u00a0986 at 33/67). Also checks the market names (M7, MATS), the amounts'
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
    check('Showing Mon 5 – Fri 9 Oct 2026' in pg.inner_text('#week-note'), 'the note says which dates are shown')
    check([o[0] for o in opts[1:]] == ['2026-12-21', '2026-12-28', '2027-03-22'] and [o[1] for o in opts[1:]] == ['Christmas · Fri 25 Dec 2026', 'New Year · Fri 1 Jan 2027', 'Easter · 26–29 Mar 2027'], 'holiday weeks: Christmas, New Year, Easter 2027 (Easter as one option)')
    pg.select_option('#week', '2027-03-22'); pg.wait_for_timeout(400)
    tabs = pg.inner_text('#day-tabs')
    check('Thu 25' in tabs and 'Mar' in tabs and 'Good Friday' in pg.inner_text('#week-note'), 'picking Easter jumps to the week of 22 Mar 2027: ' + tabs.replace(chr(10), ' '))
    pg.select_option('#week', '2026-10-05'); pg.wait_for_timeout(400)

    # Market names: M7 and MATS everywhere, explained once in the header.
    text = pg.inner_text('body')
    key = pg.inner_text('.markets-key')
    check('M7 continuous' in key and 'MATS auctions' in key and 'day-ahead auction and intraday auctions' in key, 'the header explains M7 continuous and MATS auctions')
    check('Continuous' not in text and 'Day-ahead' not in text, 'no "Continuous" or "Day-ahead" labels left')
    check(pg.eval_on_selector_all('fieldset.market legend', 'ls => ls.map(l => l.innerText.trim())') == ['M7 continuous', 'MATS auctions'], 'market sections are M7 continuous and MATS auctions')

    # Amounts: thousands separators, formatted as you type; arrow keys step.
    check(pg.input_value('#collateral') == '500\u00a0000' and pg.input_value('#c-bd') == '20\u00a0000', 'amounts start with space separators: 500 000')
    before = pg.inner_text('#tiles')
    pg.fill('#collateral', ''); pg.click('#collateral'); pg.keyboard.type('1234567'); pg.wait_for_timeout(300)
    check(pg.input_value('#collateral') == '1\u00a0234\u00a0567', 'typing 1234567 shows 1\u00a0234\u00a0567')
    check(pg.inner_text('#tiles') != before, 'the typed amount is read (limits change)')
    pg.keyboard.press('Home'); pg.keyboard.press('ArrowRight'); pg.keyboard.type('0'); pg.wait_for_timeout(100)
    check(pg.input_value('#collateral') == '10\u00a0234\u00a0567', 'typing in the middle keeps the separators: 10\u00a0234\u00a0567')
    pg.keyboard.type('9'); pg.wait_for_timeout(100)
    check(pg.input_value('#collateral') == '109\u00a0234\u00a0567', 'the caret stays after the typed digit: 109\u00a0234\u00a0567')
    pg.fill('#collateral', '500\u00a0000'); pg.click('#c-bd'); pg.keyboard.press('ArrowUp'); pg.wait_for_timeout(100)
    up = pg.input_value('#c-bd')
    pg.keyboard.press('ArrowDown'); pg.keyboard.press('ArrowDown'); pg.wait_for_timeout(300)
    check(up == '21\u00a0000' and pg.input_value('#c-bd') == '19\u00a0000', 'base limits: arrow keys step by €1\u00a0000: 21\u00a0000 then 19\u00a0000')
    pg.click('#c-bd + .steppers .step-up'); pg.click('#c-bd + .steppers .step-up'); pg.wait_for_timeout(100)
    check(pg.input_value('#c-bd') == '21\u00a0000', 'base limits: the up arrow button steps by €1\u00a0000: 21\u00a0000')
    pg.click('#c-bd + .steppers .step-down'); pg.wait_for_timeout(100)
    check(pg.input_value('#c-bd') == '20\u00a0000', 'base limits: the down arrow button steps back: 20\u00a0000')
    pg.click('#collateral + .steppers .step-up'); pg.wait_for_timeout(100)
    check(pg.input_value('#collateral') == '510\u00a0000', 'collateral: the up arrow button steps by €10\u00a0000: 510\u00a0000')
    pg.click('#collateral + .steppers .step-down'); pg.wait_for_timeout(100)
    down = pg.locator('#a-nbd + .steppers .step-down'); down.hover(); pg.mouse.down(); pg.wait_for_timeout(900); pg.mouse.up(); pg.wait_for_timeout(200)
    held = pg.input_value('#a-nbd')
    check(held.replace('\u00a0', '').isdigit() and int(held.replace('\u00a0', '')) < 9000, 'holding an arrow keeps stepping: 10\u00a0000 down to ' + held)
    pg.fill('#a-nbd', '10\u00a0000'); pg.fill('#c-bd', '20\u00a0000'); pg.wait_for_timeout(300)
    check(pg.inner_text('#tiles') == before, 'back to the defaults, the same limits as at the start')

    pg.click('label[for=mode-inv]'); pg.wait_for_timeout(300)
    pg.click('label:has(#scope-week)'); pg.click('label:has(#key-cheapest)'); pg.wait_for_timeout(400)
    tile = pg.eval_on_selector_all('.tile', 'ts => ts.map(t => t.innerText.replace(/\\n/g, " / "))')[0]
    check('602\u00a0986' in tile and 'M7 continuous / MATS auctions split 33 / 67' in tile, 'deck example: €602\u00a0986 at 33/67 (' + tile + ')')
    # Optimised by day: each day on its own with its own cheapest split (Fri €580,282 at 29/71, Mon-Wed €350,323,
    # Thu €390,323), the static amount for comparison, and the average held weighted by calendar days.
    pg.click('label:has(#cmode-daily)'); pg.wait_for_timeout(500)
    tiles = pg.eval_on_selector_all('.tile', 'ts => ts.map(t => t.innerText.replace(/\\n/g, " / "))')
    week = pg.inner_text('#week-table')
    check(len(tiles) == 3 and '580\u00a0282' in tiles[0] and '350\u00a0323' in tiles[0] and '390\u00a0323' in tiles[0] and '602\u00a0986' in tiles[1] and '454\u00a0591' in tiles[2], 'optimised by day: ' + ' | '.join(tiles))
    check('COLLATERAL THAT DAY' in week.upper(), 'the week table has the collateral-that-day column')

    body = pg.inner_text('body')
    check(not re.search(r'\d,\d{3}', body) and '602\u00a0986' in body, 'thousands are separated by spaces, never commas')

    # Phone width: nothing wider than the screen.
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
    check(pg.evaluate('document.documentElement.scrollWidth') <= 390, 'fits a 390 px phone screen')
    b.close()
check(not errs, 'no console errors' + ('' if not errs else ': ' + '; '.join(errs)))
ok = all(c[0] for c in checks)
print('UI smoke test', 'passed' if ok else 'FAILED'); sys.exit(0 if ok else 1)
