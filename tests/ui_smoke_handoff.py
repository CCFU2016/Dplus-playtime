"""Checks the hand-off between the wallet estimate and the limit calculator, on the built standalone pages opened from disk
(they link to each other there as on the hosted site):
  1. "Detailed calculation" under "Trading collateral at ECC" opens the limit calculator with the wallet's collateral, split,
     base limits, open risk and week, and on the day that sets the amount those limits meet what the wallet needs;
  2. "Back to the wallet estimate" reopens the same estimate;
  3. a changed setup taken back is used for the trading collateral at ECC and flagged when short; it can be dropped again;
  4. from the limit calculator on its own, "Use in the wallet estimate" carries the setup to the questions.
Needs: pip install playwright (Chromium already installed)."""
import base64, json, pathlib, re, sys
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).parent.parent / 'dist'
wallet = (root / 'wallet/standalone/direct-plus-wallet-prospect.html').resolve().as_uri()
limits = (root / 'standalone/direct-plus-limit-calculator.html').resolve().as_uri()
fails = []
def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: fails.append(what)
def dec(t): return json.loads(base64.urlsafe_b64decode(t + '=' * (-len(t) % 4)).decode('utf-8'))
def money(t): return int(re.sub(r'[^\d]', '', t))
def ecc_value(pg): return money(pg.eval_on_selector('#purposes tbody tr', 'r => r.lastElementChild.innerText'))
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 1000})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.clock.set_fixed_time('2026-09-28T09:00:00')

    # 1. Wallet -> limit calculator
    pg.goto(wallet); pg.wait_for_timeout(800)
    pg.click('#skip'); pg.wait_for_timeout(1500)
    hero, own = pg.inner_text('#hero-value'), ecc_value(pg)
    check('#a=' in pg.url and '&ex=1' in pg.url, 'the estimate keeps its answers in the link')
    href = pg.get_attribute('#purposes a.detail', 'href') or ''
    check(href.startswith('../../standalone/direct-plus-limit-calculator.html#w='), 'Detailed calculation links to the limit calculator: ' + href[:60])
    w = dec(re.search(r'#w=([^&]+)', href).group(1))
    pg.click('#purposes a.detail'); pg.wait_for_timeout(1200)
    check(pg.is_visible('#handoff') and 'From your wallet estimate' in pg.inner_text('#handoff'), 'the limit calculator says the values come from the wallet')
    check(pg.eval_on_selector('#mode-fwd', 'n => n.checked') and money(pg.input_value('#collateral')) == w['C'] and pg.input_value('#split') == str(w['key']),
          'prefilled: limits from €%s collateral at %s / %s' % (w['C'], w['key'], 100 - w['key']))
    check(money(pg.input_value('#open-risk')) == w['or'] and money(pg.input_value('#c-bd')) == w['cbd'] and money(pg.input_value('#a-nbd')) == w['anbd'], 'open risk and base limits prefilled')
    check(pg.input_value('#week') == w['week'], 'the same week: ' + w['week'])
    met = pg.evaluate('''w => { const E = LimitEngine, r = E.day(E.parse(w.day), { C: w.C, OR: w.or, cont: { bd: w.cbd, nbd: w.cnbd, key: w.key }, da: { bd: w.abd, nbd: w.anbd, key: 100 - w.key } });
      return [r.cont.l18, Math.min.apply(null, r.da.auctions.filter(a => !a.settled).map(a => a.limit).concat([r.da.l09]))]; }''', w)
    check(met[0] >= w['tc'] - 1 and met[1] >= w['ta'] - 1, 'on %s those limits meet what the wallet needs: M7 %d >= %d, MATS %d >= %d' % (w['day'], met[0], w['tc'], met[1], w['ta']))
    check(w['day'] in pg.inner_text('#day-tabs') or pg.eval_on_selector('#day-tabs [aria-selected="true"], #day-tabs .on', 'n => !!n') , 'the day that sets the amount is selected')

    # 2. Back
    pg.click('#handoff-back'); pg.wait_for_timeout(1500)
    check(pg.is_visible('#results') and pg.is_hidden('#wizard') and pg.inner_text('#hero-value') == hero and pg.is_visible('#example'), 'Back reopens the same estimate (still the example): ' + hero)

    # 3. A changed setup taken back
    pg.click('#purposes a.detail'); pg.wait_for_timeout(1200)
    pg.fill('#collateral', str(w['C'] - 10000)); pg.wait_for_timeout(400)
    pg.click('#handoff-use'); pg.wait_for_timeout(1500)
    note = pg.inner_text('#purposes .carried') if pg.query_selector('#purposes .carried') else ''
    check(pg.is_visible('#results') and abs(ecc_value(pg) - (w['C'] - 10000)) <= 500, 'the wallet uses the carried collateral: %d' % ecc_value(pg))
    check('From your limit calculator' in note and pg.query_selector('#purposes .carried.short') is not None and 'may run out' in note, 'short by €10,000: flagged')
    check('From your limit calculator' in pg.inner_text('#core'), 'core assumptions say where the collateral comes from')
    pg.click('#purposes button:has-text("Use the estimate")'); pg.wait_for_timeout(1200)
    check(ecc_value(pg) == own and pg.query_selector('#purposes .carried') is None and 'ecc=' not in pg.url, 'dropping it gives the estimate\'s own amount again')

    # 4. From the limit calculator on its own
    pg.goto(limits); pg.wait_for_timeout(1000)
    check(pg.is_hidden('#handoff') and pg.is_visible('#to-wallet'), 'the limit calculator offers "Use in the wallet estimate"')
    c = money(pg.input_value('#collateral'))
    pg.click('#to-wallet'); pg.wait_for_timeout(1200)
    check(pg.is_visible('#wizard') and pg.is_visible('#setup-note') and 'carried over' in pg.inner_text('#setup-note') and '€%s' % format(c, ',') in pg.inner_text('#setup-note'), 'the questions say the setup is carried over: €' + format(c, ','))
    pg.click('#skip'); pg.wait_for_timeout(1500)
    check(ecc_value(pg) == c and pg.query_selector('#purposes .carried') is not None, 'the estimate uses it: €' + format(ecc_value(pg), ','))
    b.close()
check(not errs, 'no page errors' + ('' if not errs else ': ' + '; '.join(errs)))
print('Hand-off UI smoke test', 'failed' if fails else 'passed'); sys.exit(1 if fails else 0)
