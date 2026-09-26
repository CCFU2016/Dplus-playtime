"""Opens the built standalone wallet calculator from disk in headless Chromium and checks that it runs without errors,
that each member-type preset shows a total, that a change on the Settings page reaches the wallet, and that it fits a
phone screen. The financial trader's week of 5 Oct 2026 must show the worked example of docs/wallet-model.md §8.5.
Needs: pip install playwright (Chromium already installed)."""
import pathlib, re, sys
from playwright.sync_api import sync_playwright
f = (pathlib.Path(__file__).parent.parent / 'dist/wallet/standalone/direct-plus-wallet-calculator.html').resolve().as_uri()
fails = []
def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: fails.append(what)
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 1000})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(f); pg.wait_for_timeout(1200)
    pg.fill('#week', '2026-10-05'); pg.dispatch_event('#week', 'change'); pg.wait_for_timeout(900)
    hero = pg.inner_text('#hero-value')
    check(hero == '€134,000 to €468,000', 'financial trader, week of 5 Oct 2026: ' + hero)
    for member in ['trader', 'aggregator', 'asset']:
        pg.select_option('#member', member); pg.wait_for_timeout(900)
        h = pg.inner_text('#hero-value')
        check(re.fullmatch(r'€[\d,]+ to €[\d,]+', h) is not None and pg.is_hidden('#error'), member + ' shows a total: ' + h)
    # A change on the Settings page reaches the wallet: BRP security on your own as a BRP, for comparison.
    pg.select_option('#member', 'trader'); pg.wait_for_timeout(900)
    pg.click('#tab-settings'); pg.select_option('[data-key="brpBasis"]', 'standalone'); pg.wait_for_timeout(900)
    check(pg.is_visible('[data-field="brpBasis"].changed'), 'the changed setting is marked')
    pg.click('#tab-wallet')
    check(pg.inner_text('#hero-value') == '€326,000 to €756,000', 'Settings change reaches the wallet: ' + pg.inner_text('#hero-value'))
    pg.click('#tab-settings'); pg.click('#reset'); pg.wait_for_timeout(900)
    check(pg.eval_on_selector('[data-key="brpBasis"]', 'n => n.value') == 'marginal', 'reset puts the preset value back in the input')
    pg.click('#tab-wallet')
    check(pg.inner_text('#hero-value') == '€134,000 to €468,000', 'reset to the preset')
    # A "would lower it most" link opens Settings with that field focused.
    pg.click('#parts button[data-focus="replenish"]'); pg.wait_for_timeout(200)
    check(pg.is_visible('#view-settings') and pg.evaluate('document.activeElement.getAttribute("data-key")') == 'replenish', 'a lever link focuses its setting')
    m = b.new_page(viewport={'width': 390, 'height': 800}); m.goto(f); m.wait_for_timeout(1200)
    for v in ['wallet', 'settings']:
        if v == 'settings': m.click('#tab-settings'); m.wait_for_timeout(300)
        check(m.evaluate('document.documentElement.scrollWidth') <= 390, v + ' view fits a 390 px phone screen')
    b.close()
check(not errs, 'no console errors' + ('' if not errs else ': ' + '; '.join(errs)))
print('Wallet UI smoke test', 'FAILED' if fails else 'passed'); sys.exit(1 if fails else 0)
