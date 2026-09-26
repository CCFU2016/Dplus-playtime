"""Opens the built standalone calculator in headless Chromium and checks it runs without errors
and still shows the known sizing result for the deck example (week of 5 Oct 2026, whole week,
cheapest split: EUR 602,986 at 33/67). Also checks the market names (M7, MATS), the amounts'
thousands separators and arrow-key steps, and the phone layout. Needs: pip install playwright
(Chromium already installed)."""
import pathlib, sys
from playwright.sync_api import sync_playwright
f = (pathlib.Path(__file__).parent.parent / 'dist/standalone/direct-plus-limit-calculator.html').resolve().as_uri()
checks = []
def check(ok, what): checks.append((bool(ok), what)); print('ok  ' if ok else 'FAIL', what)
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 1000})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(f); pg.wait_for_timeout(600)
    pg.fill('#week', '2026-10-05'); pg.dispatch_event('#week', 'change'); pg.wait_for_timeout(200)

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
    pg.keyboard.press('Home'); pg.keyboard.press('ArrowRight'); pg.keyboard.type('0'); pg.wait_for_timeout(100)
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

    # Phone width: nothing wider than the screen.
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
    check(pg.evaluate('document.documentElement.scrollWidth') <= 390, 'fits a 390 px phone screen')
    b.close()
check(not errs, 'no console errors' + ('' if not errs else ': ' + '; '.join(errs)))
ok = all(c[0] for c in checks)
print('UI smoke test', 'passed' if ok else 'FAILED'); sys.exit(0 if ok else 1)
