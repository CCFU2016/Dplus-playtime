"""Opens the built standalone prospect questionnaire from disk in headless Chromium and walks through it: every question
shows for each member type, the estimate appears without errors, answers change it (the optional tough week, weekends
"show me both", the portfolio, top-ups), "Change my answers" goes back, and the page fits a phone screen. With the
trader's default answers it matches the calculation for the same settings.
Needs: pip install playwright (Chromium already installed)."""
import pathlib, re, sys
from playwright.sync_api import sync_playwright
f = (pathlib.Path(__file__).parent.parent / 'dist/wallet/standalone/direct-plus-wallet-prospect.html').resolve().as_uri()
HERO = r'About €[\d,]+( to €[\d,]+)?( up to €[\d,]+ in a tough week)?'
fails = []
def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: fails.append(what)
def walk(pg, member, tweak=None, quiet=True):
    if not pg.is_visible('#wizard'): pg.click('#edit'); pg.wait_for_timeout(200)
    pg.click('label[for="t-' + member + '"]'); pg.wait_for_timeout(100)
    for step in range(1, 8):
        if not quiet: check(pg.is_visible('.step[data-step="%d"]' % step), member + ': question %d shows' % step)
        if tweak and step in tweak: tweak[step](pg)
        pg.click('#next'); pg.wait_for_timeout(150 if step < 7 else 1500)
    return pg.inner_text('#hero-value')
def heads(pg, table):
    return pg.eval_on_selector_all('#' + table + ' thead th', 'hs => hs.map(h => h.innerText.trim().toLowerCase())')
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 1000})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(f); pg.wait_for_timeout(1000)
    check(pg.is_hidden('#results'), 'starts with the questions')
    # Skip on question 1: straight to the results with a trader's typical answers, marked as an example.
    check(pg.is_visible('#skip'), 'question 1 offers to skip the questions')
    pg.click('#skip'); pg.wait_for_timeout(1500)
    ex_hero = pg.inner_text('#hero-value')
    check(pg.is_visible('#results') and pg.is_hidden('#wizard') and re.fullmatch(HERO, ex_hero) is not None, 'skip shows an estimate straight away: ' + ex_hero)
    check(pg.is_visible('#example') and 'for show only' in pg.inner_text('#example') and 'a trader' in pg.inner_text('#example'), 'the example banner says the figures are for show')
    check(pg.inner_text('#results-title') == 'Example estimate' and pg.inner_text('#hero-label').startswith('Example:') and pg.inner_text('#answers-title') == 'Example answers', 'title, hero and answers say example')
    ex = {}
    for m in ['aggregator', 'asset', 'trader']:
        pg.click('[data-extype="%s"]' % m); pg.wait_for_timeout(1200)
        ex[m] = pg.inner_text('#hero-value')
        check(pg.get_attribute('[data-extype="%s"]' % m, 'aria-pressed') == 'true' and pg.is_visible('#example'), 'the example switches to ' + m + ': ' + ex[m])
    check(len(set(ex.values())) == 3 and ex['trader'] == ex_hero, 'each type shows its own example; back to the trader gives the first one again')
    pg.click('#example-own'); pg.wait_for_timeout(200)
    check(pg.is_visible('#wizard') and pg.is_visible('.step[data-step="1"]'), 'the banner button goes back to question 1')
    pg.click('label[for="t-asset"]'); pg.click('#skip'); pg.wait_for_timeout(1500)
    check('an asset owner' in pg.inner_text('#example') and 'asset owner' in pg.inner_text('#hero-label'), 'skip uses the type already picked: asset owner')
    for member in ['trader', 'aggregator', 'asset']:
        h = walk(pg, member, quiet=False)
        check(pg.is_visible('#results') and re.fullmatch(HERO, h) is not None, member + ' shows an estimate: ' + h)
    # Default answers: no tough week, one column, and the total matches the calculation for the same answers.
    h = walk(pg, 'trader')
    check(h == ex_hero, 'the example equals a trader who keeps the typical answers: ' + h)
    check(pg.is_hidden('#example') and pg.inner_text('#results-title') == 'Your estimate' and not pg.inner_text('#hero-label').startswith('Example'), 'answering the questions removes the example marks')
    check('tough week' not in h and heads(pg, 'purposes') == ['what for', 'normal week'], 'the tough week is optional and off by default: ' + h)
    total = pg.eval_on_selector('#purposes tbody tr.total', 'r => r.innerText')
    js = pg.evaluate('''() => { const a = WalletCalc.defaultAnswers('trader'); a.week = document.getElementById('week').value; const r = WalletCalc.compute(WalletCalc.fromAnswers(a)); return '€' + (Math.round(r.expected.total / 1000) * 1000).toLocaleString('en-GB'); }''')
    check(js in total, 'trader total equals the calculation for the same answers, rounded to €1,000: ' + js)
    # Top-ups: the table compares the three rhythms and marks the answer; the selector recomputes.
    rows = pg.eval_on_selector_all('#topups tbody tr', 'rs => rs.map(r => r.innerText)')
    check(len(rows) == 3 and any('(your answer)' in r for r in rows), 'top-ups: three rhythms, the answer marked')
    pg.select_option('#topup', 'daily'); pg.wait_for_timeout(1500)
    check('Every business day (your answer)' in pg.inner_text('#topups'), 'the top-up selector recomputes the estimate')
    # The tough week, when chosen: its price is asked, the estimate shows "up to", and top-ups change the tough week.
    def tough(p):
        check(p.is_hidden('#tough-price'), 'no tough week: its price is not asked')
        p.click('label[for="h-yes"]'); p.wait_for_timeout(100)
        check(p.is_visible('#tough-price'), 'choosing a tough week asks for its price')
    h = walk(pg, 'trader', {4: tough})
    check('up to' in h and 'tough week' in heads(pg, 'purposes'), 'tough week shown when chosen: ' + h)
    tt = pg.eval_on_selector_all('#topups tbody tr', 'rs => rs.map(r => r.innerText.split("\\t").pop())')
    check(len(set(tt)) > 1, 'top-ups change the tough-week total: ' + str(tt))
    # Weekends: "show me both" gives two columns and both amounts in the headline.
    h = walk(pg, 'trader', {2: lambda p: p.click('label[for="w-both"]'), 4: lambda p: p.click('label[for="h-no"]')})
    check(heads(pg, 'purposes') == ['what for', 'business days only', 'also at weekends'] and 'business days only' in pg.inner_text('#hero-sub'), 'weekends "show me both": two columns and both amounts: ' + h)
    # Portfolio: a trader with 20 MW of production sees the size question and gets BRP collateral (one site in the
    # 11-25 MW class counts 11 MW: 11 × 24 × €80 = €21,120, rounded to €21,000).
    def production(p):
        check(p.is_hidden('#size-q'), 'no assets: the size question is hidden')
        p.click('label[for="a-production"]'); p.wait_for_timeout(100)
        check(p.is_visible('#size-q') and p.is_visible('#pf-note'), 'ticking production shows the size question and the balancing note')
        p.fill('#capacityMW', '20'); p.dispatch_event('#capacityMW', 'input'); p.fill('#sites', '1'); p.dispatch_event('#sites', 'input')
    walk(pg, 'trader', {2: lambda p: p.click('label[for="w-yes"]'), 5: production})
    brp = [r for r in pg.eval_on_selector_all('#purposes tbody tr', 'rs => rs.map(r => r.innerText)') if r.startswith('BRP collateral')]
    check(brp and '€21,000' in brp[0], 'production adds BRP collateral: ' + (brp[0].split('\t')[-1] if brp else 'none'))
    # Collateral adjusted every business day: the headline shows the weekday and the weekend amount; the selector switches.
    h = walk(pg, 'trader', {7: lambda p: p.click('label[for="k-daily"]')})
    check('during the week' in h and 'around the weekend' in h, 'daily collateral: weekday and weekend amounts: ' + h)
    pg.select_option('#cmode', 'static'); pg.wait_for_timeout(1500)
    check('during the week' not in pg.inner_text('#hero-value'), 'the collateral selector switches back to static: ' + pg.inner_text('#hero-value'))
    # No separate markets question: 0 volume means a market isn't traded, and the auction bid price is only asked
    # when there are auction buys (day-ahead and intraday auctions share one ECC limit).
    def no_auction_buys(p):
        p.fill('#aucBuy', '0'); p.dispatch_event('#aucBuy', 'input'); p.wait_for_timeout(100)
    def bid_hidden(p):
        check(p.is_hidden('#bid-q'), 'no auction buys: the bid-price question is not asked')
    walk(pg, 'trader', {3: no_auction_buys, 4: bid_hidden})
    check(pg.is_visible('#results'), 'an estimate without auction buys')
    # Validation: with a tough week, a tough-week price below the normal price is refused.
    pg.click('#edit'); pg.wait_for_timeout(200)
    for step in range(1, 4): pg.click('#next'); pg.wait_for_timeout(100)
    pg.click('label[for="h-yes"]'); pg.fill('#stressPrice', '10'); pg.dispatch_event('#stressPrice', 'input'); pg.click('#next'); pg.wait_for_timeout(100)
    check(pg.is_visible('#step-error') and pg.is_visible('.step[data-step="4"]'), 'a tough-week price below the normal price is refused')
    m = b.new_page(viewport={'width': 390, 'height': 800}); m.goto(f); m.wait_for_timeout(1000)
    check(m.evaluate('document.documentElement.scrollWidth') <= 390, 'questions fit a 390 px phone screen')
    m.click('#next'); m.click('label[for="w-both"]')
    for step in range(6): m.click('#next'); m.wait_for_timeout(150)
    m.wait_for_timeout(1500)
    check(m.is_visible('#results') and m.evaluate('document.documentElement.scrollWidth') <= 390, 'the estimate fits a 390 px phone screen (with both weekend columns)')
    b.close()
check(not errs, 'no console errors' + ('' if not errs else ': ' + '; '.join(errs)))
print('Prospect UI smoke test', 'FAILED' if fails else 'passed'); sys.exit(1 if fails else 0)
