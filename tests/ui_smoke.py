"""Opens the built standalone calculator in headless Chromium and checks it runs without errors
and still shows the known sizing result for the deck example (week of 5 Oct 2026, whole week,
cheapest split: EUR 602,986 at 33/67). Needs: pip install playwright (Chromium already installed)."""
import pathlib, sys
from playwright.sync_api import sync_playwright
f = (pathlib.Path(__file__).parent.parent / 'dist/standalone/direct-plus-limit-calculator.html').resolve().as_uri()
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 1000})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(f); pg.wait_for_timeout(600)
    pg.fill('#week', '2026-10-05'); pg.dispatch_event('#week', 'change'); pg.wait_for_timeout(200)
    pg.click('label[for=mode-inv]'); pg.wait_for_timeout(300)
    pg.click('label:has(#scope-week)'); pg.click('label:has(#key-cheapest)'); pg.wait_for_timeout(400)
    tile = pg.eval_on_selector_all('.tile', 'ts => ts.map(t => t.innerText.replace(/\\n/g, " / "))')[0]
    # Optimised by day: each day on its own with its own cheapest split (Fri €580,282 at 29/71, Mon-Wed €350,323,
    # Thu €390,323), the static amount for comparison, and the average held weighted by calendar days.
    pg.click('label:has(#cmode-daily)'); pg.wait_for_timeout(500)
    tiles = pg.eval_on_selector_all('.tile', 'ts => ts.map(t => t.innerText.replace(/\\n/g, " / "))')
    week = pg.inner_text('#week-table')
    b.close()
daily_ok = len(tiles) == 3 and '580,282' in tiles[0] and '350,323' in tiles[0] and '390,323' in tiles[0] and '602,986' in tiles[1] and '454,591' in tiles[2] and 'COLLATERAL THAT DAY' in week.upper()
print('optimised by day:', tiles, '| week table has the column:', 'COLLATERAL THAT DAY' in week.upper())
ok = not errs and '602,986' in tile and daily_ok
print('first tile:', tile); print('errors:', errs or 'none')
print('UI smoke test', 'passed' if ok else 'FAILED'); sys.exit(0 if ok else 1)
