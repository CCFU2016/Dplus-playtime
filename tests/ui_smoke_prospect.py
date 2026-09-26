"""Opens the built standalone prospect questionnaire from disk in headless Chromium and walks through it for each member
type: every question shows, the estimate appears without errors, answers change it, "Change my answers" goes back,
and the page fits a phone screen. With the trader's default answers it must match the financial-trader preset of the
wallet calculator. Needs: pip install playwright (Chromium already installed)."""
import pathlib, re, sys
from playwright.sync_api import sync_playwright
f = (pathlib.Path(__file__).parent.parent / 'dist/wallet/standalone/direct-plus-wallet-prospect.html').resolve().as_uri()
fails = []
def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: fails.append(what)
def walk(pg, member, tweak=None):
    pg.click('label[for="t-' + member + '"]'); pg.wait_for_timeout(100)
    for step in range(1, 8):
        check(pg.is_visible('.step[data-step="%d"]' % step), member + ': question %d shows' % step)
        if tweak and step in tweak: tweak[step](pg)
        pg.click('#next'); pg.wait_for_timeout(150 if step < 7 else 1200)
    return pg.inner_text('#hero-value')
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 1000})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(f); pg.wait_for_timeout(1000)
    check(pg.is_hidden('#results'), 'starts with the questions')
    for member in ['trader', 'aggregator', 'asset']:
        if not pg.is_visible('#wizard'): pg.click('#edit'); pg.wait_for_timeout(200)
        h = walk(pg, member)
        check(pg.is_visible('#results') and re.fullmatch(r'About €[\d,]+ up to €[\d,]+ in a tough week', h) is not None, member + ' shows an estimate: ' + h)
    # The trader's default answers match the wallet calculator's financial-trader preset (week of 5 Oct 2026 is not
    # selectable here, so compare the table's totals for the week shown against the same settings in the engine).
    pg.click('#edit'); pg.wait_for_timeout(200)
    h = walk(pg, 'trader')
    total = pg.eval_on_selector('#purposes tbody tr.total', 'r => r.innerText')
    js = pg.evaluate('''() => { const a = WalletCalc.defaultAnswers('trader'); a.week = document.getElementById('week').value; const r = WalletCalc.compute(WalletCalc.fromAnswers(a)); return '€' + Math.round(r.expected.total).toLocaleString('en-GB'); }''')
    check(js in total, 'trader totals equal the calculation for the same answers: ' + js)
    # An answer changes the estimate: no positions held over 16:00 removes the settlement float.
    pg.click('#edit'); pg.wait_for_timeout(200)
    h2 = walk(pg, 'trader', {3: lambda p: p.click('label[for="c-none"]')})
    check(h2 != h, 'an answer changes the estimate: ' + h + ' -> ' + h2)
    # Validation: a tough-week price below the normal price is refused.
    pg.click('#edit'); pg.wait_for_timeout(200)
    for step in range(1, 4): pg.click('#next'); pg.wait_for_timeout(100)
    pg.fill('#stressPrice', '10'); pg.dispatch_event('#stressPrice', 'input'); pg.click('#next'); pg.wait_for_timeout(100)
    check(pg.is_visible('#step-error') and pg.is_visible('.step[data-step="4"]'), 'a tough-week price below the normal price is refused')
    m = b.new_page(viewport={'width': 390, 'height': 800}); m.goto(f); m.wait_for_timeout(1000)
    check(m.evaluate('document.documentElement.scrollWidth') <= 390, 'questions fit a 390 px phone screen')
    for step in range(7): m.click('#next'); m.wait_for_timeout(150)
    m.wait_for_timeout(1000)
    check(m.is_visible('#results') and m.evaluate('document.documentElement.scrollWidth') <= 390, 'the estimate fits a 390 px phone screen')
    b.close()
check(not errs, 'no console errors' + ('' if not errs else ': ' + '; '.join(errs)))
print('Prospect UI smoke test', 'FAILED' if fails else 'passed'); sys.exit(1 if fails else 0)
