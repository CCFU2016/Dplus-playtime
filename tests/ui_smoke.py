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
    b.close()
ok = not errs and '602,986' in tile
print('first tile:', tile); print('errors:', errs or 'none')
print('UI smoke test', 'passed' if ok else 'FAILED'); sys.exit(0 if ok else 1)
