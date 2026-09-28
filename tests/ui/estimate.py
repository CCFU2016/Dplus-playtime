"""The wallet estimate for prospects: every question shows for each member type, the example (skip the questions),
the estimate and what moves it (the optional tough week, weekends "show me both", the portfolio, top-ups, daily
collateral), the BRP calculation, the folded sections and printing, validation, errors, the week list, and the phone
layout. With the trader's default answers it matches the calculation for the same settings. Each scenario starts on a
fresh page."""

import base64
import json
import re

from support import PHONE, fits, main

HERO = re.compile(r'About €[\d,]+( to €[\d,]+)?( up to €[\d,]+ in a tough week)?')
MEMBERS = ['trader', 'aggregator', 'asset']


def results_shown(tab):
    tab.wait_for_selector('#results', state='visible')


def skip(tab):
    tab.click('#skip')
    results_shown(tab)


def walk(run, tab, member, tweak=None, report=False):
    """Answers the seven questions for a member type, with `tweak` {step: function(tab)} on the way; returns the hero."""
    tab.click(f'label[for="t-{member}"]')
    for step in range(1, 8):
        if report:
            run.check(tab.is_visible(f'.step[data-step="{step}"]'), f'{member}: question {step} shows')
        if tweak and step in tweak:
            tweak[step](tab)
        tab.click('#next')
    results_shown(tab)
    return tab.inner_text('#hero-value')


def open_all(tab):
    tab.evaluate("document.querySelectorAll('#results details').forEach(details => details.open = true)")


def heads(tab, table):
    return tab.eval_on_selector_all(f'#{table} thead th', 'heads => heads.map(h => h.innerText.trim().toLowerCase())')


def calc_rows(details):
    return details.eval_on_selector_all(
        '.calc-table tr',
        'rows => rows.map(row => [row.querySelector(".cl").innerText, row.querySelector("td").innerText])',
    )


def amount(text):
    return int(re.search(r'€([\d,]+)', text).group(1).replace(',', ''))


def core(tab):
    return tab.inner_text('#core')


def type_into(tab, selector, value):
    tab.fill(selector, value)
    tab.dispatch_event(selector, 'input')


def example(run):
    """Skip the questions: an example, marked as for show, for each member type."""
    tab = run.open('estimate')
    check = run.check
    check(tab.is_hidden('#results'), 'starts with the questions')
    check(tab.is_visible('#skip'), 'question 1 offers to skip the questions')
    skip(tab)
    shown = tab.inner_text('#hero-value')
    check(
        tab.is_hidden('#wizard') and HERO.fullmatch(shown) is not None, 'skip shows an estimate straight away: ' + shown
    )
    banner = tab.inner_text('#example')
    check(
        tab.is_visible('#example') and 'for show only' in banner and 'a trader' in banner,
        'the example banner says the figures are for show',
    )
    marked = tab.inner_text('#results-title') == 'Example estimate' and tab.inner_text('#hero-label').startswith(
        'Example:'
    )
    check(marked and tab.inner_text('#answers-title') == 'Example answers', 'title, hero and answers say example')
    heroes = {}
    for member in ['aggregator', 'asset', 'trader']:
        tab.click(f'[data-extype="{member}"]')
        heroes[member] = tab.inner_text('#hero-value')
        pressed = tab.get_attribute(f'[data-extype="{member}"]', 'aria-pressed') == 'true'
        check(pressed and tab.is_visible('#example'), f'the example switches to {member}: {heroes[member]}')
    check(
        len(set(heroes.values())) == 3 and heroes['trader'] == shown,
        'each type shows its own example; back to the trader gives the first one again',
    )
    tab.click('#example-own')
    check(
        tab.is_visible('#wizard') and tab.is_visible('.step[data-step="1"]'),
        'the banner button goes back to question 1',
    )
    tab.click('label[for="t-asset"]')
    skip(tab)
    check(
        'an asset owner' in tab.inner_text('#example') and 'asset owner' in tab.inner_text('#hero-label'),
        'skip uses the type already picked: asset owner',
    )


def questions(run):
    """Every question shows for each member type, and each gets an estimate."""
    for member in MEMBERS:
        tab = run.open('estimate')
        shown = walk(run, tab, member, report=True)
        run.check(HERO.fullmatch(shown) is not None, f'{member} shows an estimate: {shown}')


def default_trader(run):
    """A trader who keeps the typical answers gets the example's figures, without the example marks."""
    tab = run.open('estimate')
    check = run.check
    skip(tab)
    shown = tab.inner_text('#hero-value')
    tab = run.open('estimate')
    answered = walk(run, tab, 'trader')
    check(answered == shown, 'the example equals a trader who keeps the typical answers: ' + answered)
    labels = tab.eval_on_selector_all('#bars .sg span', 'labels => labels.map(label => label.textContent)')
    check(
        labels and all(re.fullmatch(r'€\d+k|<€1k', label) for label in labels),
        'bar labels in whole €1,000s like the table: ' + ', '.join(labels),
    )
    unmarked = tab.is_hidden('#example') and tab.inner_text('#results-title') == 'Your estimate'
    check(
        unmarked and not tab.inner_text('#hero-label').startswith('Example'),
        'answering the questions removes the example marks',
    )
    check(
        'tough week' not in answered and heads(tab, 'purposes') == ['what for', 'normal week'],
        'the tough week is optional and off by default: ' + answered,
    )
    total = tab.eval_on_selector('#purposes tbody tr.total', 'row => row.innerText')
    calculated = tab.evaluate("""() => {
      const answers = { ...WalletCalc.defaultAnswers('trader'), week: document.getElementById('week').value };
      const result = WalletCalc.compute(WalletCalc.fromAnswers(answers));
      return '€' + (Math.round(result.expected.total / 1000) * 1000).toLocaleString('en-GB');
    }""")
    check(
        calculated in total,
        'trader total equals the calculation for the same answers, rounded to €1,000: ' + calculated,
    )
    listed = [
        'Price', '€100', 'Bad day', '€100/MWh lost on about 50 MWh open', 'Held over the 16:00 cut', '30%',
        'Largest open M7 position', '66% of a day', 'about 36 MWh', 'about 21 MWh', '55 buy / 55 sell MWh a day',
        '14 buy / 14 sell MWh a day', 'Volume a year', 'about 50 GWh traded', 'Split continuous / auctions', 'BRP collateral',
    ]  # fmt: skip
    check(
        all(item in core(tab) for item in listed),
        'core assumptions sit next to what the money is for: ' + core(tab).replace('\n', ' | '),
    )
    corner = 'node => { const box = node.getBoundingClientRect(); return [box.top, box.left]; }'
    purposes, assumptions = tab.eval_on_selector('#purposes', corner), tab.eval_on_selector('#core', corner)
    check(
        assumptions[1] > purposes[1] and abs(assumptions[0] - purposes[0]) < 80,
        'on a wide screen they are side by side',
    )


def netting(run):
    """Traders are asked how their trades run; the folded sections, and printing."""
    check = run.check
    tab = run.open('estimate')
    mixed = walk(run, tab, 'trader')

    def trades(tab):
        check(
            tab.eval_on_selector('#n-mixed', 'radio => radio.checked'),
            'traders are asked how their trades run; mixed is the default',
        )
        tab.click('label[for="n-flat"]')

    tab = run.open('estimate')
    flat = walk(run, tab, 'trader', {3: trades})
    check(amount(flat) < amount(mixed), f'many small trades, close to flat, needs less: {flat} against {mixed}')
    folded = tab.eval_on_selector_all('#results details.fold', 'sections => sections.map(d => d.open)')
    check(len(folded) == 6 and not any(folded), 'the six detail sections start collapsed')
    check(
        tab.is_visible('#purposes') and tab.is_visible('#core') and tab.is_hidden('#topups'),
        'the chart, what the money is for and core assumptions stay open',
    )
    tab.click('#core + a')
    check(
        tab.eval_on_selector('#assumed-card', 'd => d.open') and tab.is_visible('#assumed'),
        '"All assumptions and sources" opens that section',
    )
    tab.emulate_media(media='print')
    tab.evaluate("window.dispatchEvent(new Event('beforeprint'))")
    check(
        all(tab.eval_on_selector_all('#results details', 'sections => sections.map(d => d.open)')),
        'printing unfolds every section',
    )
    tab.evaluate("window.dispatchEvent(new Event('afterprint'))")
    tab.emulate_media(media='screen')
    open_all(tab)
    check('close to flat' in tab.inner_text('#answers'), 'the answer is listed with the estimate')


def asset_questions(run):
    tab = run.open('estimate')
    walk(
        run,
        tab,
        'asset',
        {
            3: lambda tab: run.check(
                tab.is_hidden('.q[data-type="trader"]'), 'asset owners are not asked the trader question'
            )
        },
    )


def brp_details(run):
    """The BRP row's "Detailed calculation" shows the rule and the figures; the asset and imbalance assumptions."""
    tab = run.open('estimate')
    check = run.check
    skip(tab)
    tab.click('[data-extype="asset"]')
    row = next(
        row for row in tab.query_selector_all('#purposes tbody tr') if row.inner_text().startswith('BRP collateral')
    )
    details = row.query_selector('details.calc')
    check(details is not None and not details.evaluate('d => d.open'), 'BRP row: "Detailed calculation", closed')
    details.query_selector('summary').click()
    text = details.inner_text()
    steps = [
        ['Daily volume at the TenneT boundary', '95 MWh'],
        ['Price', '€40/MWh'],
        ['A', '€3,800'],
        ['Connection capacity counted', '26 MW'],
        ['B', '€24,960'],
        ['2A', '€7,600'],
        ['Security = A + B', '€28,760'],
        ['BRP collateral', '€28,760'],
    ]
    check(
        'article 10.8' in text and calc_rows(details)[:8] == steps and 'no 50 MW volume floor' in text,
        'the BRP calculation shows the rule and the figures: ' + text.replace('\n', ' | ')[:300],
    )
    pressed = details.query_selector('.rule-switch [data-rule="current"]').get_attribute('aria-pressed') == 'true'
    check(pressed and 'the rule the estimate uses' in text, 'the switch starts on the rule in force for October 2026')
    details.query_selector('.rule-switch [data-rule="draft"]').click()
    draft, rows = details.inner_text(), calc_rows(details)
    draft_rows = ['3 × A', '€11,400'] in rows and ['4 × B', '€11,040'] in rows and ['BRP collateral', '€23,340'] in rows
    check(
        'ACM' in draft
        and '3A + 4B + 6C + 6D' in draft
        and draft_rows
        and 'no €96,000 minimum' in draft
        and 'uses the other rule' in draft,
        'the switch shows the draft rule: ' + draft.replace('\n', ' | ')[:260],
    )
    details.query_selector('.rule-switch [data-rule="current"]').click()
    check('article 10.8' in details.inner_text(), 'and back to the rule in force')
    check(
        'Production and consumption, 30 MW at 1 site' in core(tab)
        and '5% of net production, usually long' in core(tab),
        'asset owner: portfolio and imbalance assumptions',
    )
    tab.click('[data-extype="aggregator"]')
    check(
        '3% of nominations, usually short' in core(tab) and '5% of nominations' in core(tab),
        'aggregator: imbalance and non-delivery assumptions',
    )
    tab.click('[data-extype="trader"]')
    check('Imbalance' not in core(tab), 'trader: no imbalance line (kept short)')


def topups(run):
    """The top-up table compares the three rhythms and marks the answer; the selector recomputes."""
    tab = run.open('estimate')
    skip(tab)
    open_all(tab)
    rows = tab.eval_on_selector_all('#topups tbody tr', 'rows => rows.map(row => row.innerText)')
    run.check(
        len(rows) == 3 and any('(your answer)' in row for row in rows), 'top-ups: three rhythms, the answer marked'
    )
    tab.select_option('#topup', 'daily')
    run.check(
        'Every business day (your answer)' in tab.inner_text('#topups'), 'the top-up selector recomputes the estimate'
    )


def tough_week(run):
    """The tough week, when chosen: its price is asked and the estimate shows "up to". For a net buyer (ECC collects
    purchases every day) the top-up rhythm changes the tough week; a flat trader's days net to zero."""
    check = run.check

    def tough(tab):
        check(tab.is_hidden('#tough-price'), 'no tough week: its price is not asked')
        tab.click('label[for="h-yes"]')
        check(tab.is_visible('#tough-price'), 'choosing a tough week asks for its price')

    tab = run.open('estimate')
    shown = walk(run, tab, 'trader', {3: lambda tab: tab.click('label[for="s-buyer"]'), 4: tough})
    check('up to' in shown and 'tough week' in heads(tab, 'purposes'), 'tough week shown when chosen: ' + shown)
    open_all(tab)
    totals = tab.eval_on_selector_all('#topups tbody tr', 'rows => rows.map(row => row.innerText.split("\\t").pop())')
    check(len(set(totals)) > 1, f"a buyer's top-ups change the tough-week total: {totals}")


def weekends_both(run):
    tab = run.open('estimate')
    shown = walk(run, tab, 'trader', {2: lambda tab: tab.click('label[for="w-both"]')})
    both = heads(tab, 'purposes') == ['what for', 'business days only', 'also at weekends']
    run.check(
        both and 'business days only' in tab.inner_text('#hero-sub'),
        'weekends "show me both": two columns and both amounts: ' + shown,
    )


def portfolio(run):
    """A trader with 20 MW of production sees the size question and gets BRP collateral: one site in the 11-25 MW class
    counts 11 MW, so 11 × 24 × €40 = €10,560, shown as €11,000 (BRP at €40/MWh for now)."""
    check = run.check

    def production(tab):
        check(tab.is_hidden('#size-q'), 'no assets: the size question is hidden')
        tab.click('label[for="a-production"]')
        check(
            tab.is_visible('#size-q') and tab.is_visible('#pf-note'),
            'ticking production shows the size question and the balancing note',
        )
        type_into(tab, '#capacityMW', '20')
        type_into(tab, '#sites', '1')

    tab = run.open('estimate')
    walk(run, tab, 'trader', {5: production})
    rows = tab.eval_on_selector_all('#purposes tbody tr', 'rows => rows.map(row => row.innerText)')
    brp = [row for row in rows if row.startswith('BRP collateral')]
    check(brp and '€11,000' in brp[0], 'production adds BRP collateral: ' + (brp[0].split('\t')[-1] if brp else 'none'))


def daily_collateral(run):
    """Collateral adjusted every business day: the headline shows the weekday and the weekend amount."""
    tab = run.open('estimate')
    shown = walk(run, tab, 'trader', {7: lambda tab: tab.click('label[for="k-daily"]')})
    run.check(
        'during the week' in shown and 'around the weekend' in shown,
        'daily collateral: weekday and weekend amounts: ' + shown,
    )
    tab.select_option('#cmode', 'static')
    run.check(
        'during the week' not in tab.inner_text('#hero-value'),
        'the collateral selector switches back to static: ' + tab.inner_text('#hero-value'),
    )


def no_auction_buys(run):
    """0 volume means a market isn't traded; the auction bid price is only asked when there are auction buys."""
    tab = run.open('estimate')
    walk(
        run,
        tab,
        'trader',
        {
            3: lambda tab: type_into(tab, '#aucBuy', '0'),
            4: lambda tab: run.check(tab.is_hidden('#bid-q'), 'no auction buys: the bid-price question is not asked'),
        },
    )
    run.check(tab.is_visible('#results'), 'an estimate without auction buys')


def validation(run):
    """With a tough week, a tough-week price below the normal price is refused."""
    tab = run.open('estimate')
    for _ in range(3):
        tab.click('#next')
    tab.click('label[for="h-yes"]')
    type_into(tab, '#stressPrice', '10')
    tab.click('#next')
    run.check(
        tab.is_visible('#step-error') and tab.is_visible('.step[data-step="4"]'),
        'a tough-week price below the normal price is refused',
    )


def errors(run):
    """A link whose answers can't be estimated opens on question 1, with the reason above the page."""
    tab = run.open('estimate')
    answers = {**tab.evaluate("WalletCalc.defaultAnswers('trader')"), 'aucLimitPrice': None}
    encoded = base64.urlsafe_b64encode(json.dumps(answers).encode()).decode().rstrip('=')
    tab = run.open('estimate', hash=f'#a={encoded}')
    message = tab.inner_text('#estimate-error') if tab.is_visible('#estimate-error') else ''
    shows = "We can't estimate this" in message and tab.inner_text('#step-label') == 'Question 1 of 7'
    run.check(shows and tab.is_hidden('#results'), 'an estimate that fails says why, above question 1: ' + message)


def weeks(run):
    """The weeks to show: next week and every week with an ECC holiday in the next 12 months."""
    tab = run.open('estimate')
    options = tab.eval_on_selector_all('#week option', 'options => options.map(o => [o.value, o.textContent])')
    weeks = [
        ['2026-10-05', 'Next week (Mon 5 Oct 2026)'],
        ['2026-12-21', 'Christmas 2026 (from Mon 21 Dec)'],
        ['2026-12-28', 'New Year 2027 (from Mon 28 Dec)'],
        ['2027-03-22', 'Easter 2027 (from Mon 22 Mar)'],
    ]
    run.check(options == weeks, 'the week list: next week and the ECC holiday weeks: ' + str(options))


def phone(run):
    tab = run.open('estimate', viewport=PHONE)
    run.check(fits(tab, PHONE['width']), 'questions fit a 390 px phone screen')
    walk(run, tab, 'trader', {2: lambda tab: tab.click('label[for="w-both"]')})
    run.check(fits(tab, PHONE['width']), 'the estimate fits a 390 px phone screen (with both weekend columns)')


def check_estimate(run):
    scenarios = [
        example, questions, default_trader, netting, asset_questions, brp_details, topups, tough_week, weekends_both,
        portfolio, daily_collateral, no_auction_buys, validation, errors, weeks, phone,
    ]  # fmt: skip
    for scenario in scenarios:
        scenario(run)


if __name__ == '__main__':
    main([('Wallet estimate', check_estimate)])
