"""The wallet calculator: the worked example of docs/wallet-model.md §8.5 (the financial trader's week of 5 Oct 2026), a
total for every member type, a change in Settings reaching the wallet, reset, the setting links, and the phone
layout."""

import re

from support import PHONE, fits, main, redrawn

# The financial trader preset, week of 5 Oct 2026: a normal to a tough week.
TRADER_EXAMPLE = '€35,000 to €79,000'


def hero(tab):
    return tab.inner_text('#hero-value')


def presets(run):
    tab = run.open('wallet')
    check = run.check
    check(
        tab.input_value('#week') == '2026-10-05' and hero(tab) == TRADER_EXAMPLE,
        'financial trader, week of 5 Oct 2026: ' + hero(tab),
    )
    for member in ['trader', 'aggregator', 'asset']:
        tab.select_option('#member', member)
        redrawn(tab)
        total = hero(tab)
        check(
            re.fullmatch(r'€[\d,]+ to €[\d,]+', total) is not None and tab.is_hidden('#error'),
            f'{member} shows a total: {total}',
        )


def settings(run):
    """A change in Settings reaches the wallet, and reset brings the preset back."""
    tab = run.open('wallet')
    check = run.check
    tab.click('#tab-settings')
    tab.select_option('[data-key="brpBasis"]', 'standalone')  # BRP security on your own, for comparison
    redrawn(tab)
    check(tab.is_visible('[data-field="brpBasis"].changed'), 'the changed setting is marked')
    tab.click('#tab-wallet')
    check(hero(tab) == '€126,000 to €170,000', 'Settings change reaches the wallet: ' + hero(tab))
    tab.click('#tab-settings')
    tab.select_option('[data-key="collateralMode"]', 'daily')
    redrawn(tab)
    tab.click('#tab-wallet')
    sub = tab.inner_text('#hero-sub')
    check('optimised by day' in sub, 'collateral optimised by day shows the weekday amount: ' + sub[-150:])
    tab.click('#tab-settings')
    tab.click('#reset')
    redrawn(tab)
    check(
        tab.eval_on_selector('[data-key="brpBasis"]', 'select => select.value') == 'marginal',
        'reset puts the preset value back in the input',
    )
    tab.click('#tab-wallet')
    check(hero(tab) == TRADER_EXAMPLE, 'reset to the preset')


def open_position(run):
    """The trader preset may leave 20 MWh a day open: the buffer sets its BRP collateral, and the percentile and the
    days at risk in Settings move it."""
    tab = run.open('wallet')
    check = run.check
    total = tab.inner_text('#brp-table tbody tr:last-child')
    check('the larger of the two' in total and '€5,000' in total, 'the buffer sets the BRP collateral: ' + total)
    tab.click('#tab-settings')
    tab.select_option('[data-key="openPercentile"]', 'p98')
    tab.fill('[data-key="openDays"]', '3')
    redrawn(tab)
    tab.click('#tab-wallet')
    total = tab.inner_text('#brp-table tbody tr:last-child')
    check('€13,000' in total, 'p98 and three days at risk: 20 × 3 × €220.63 = €13,238: ' + total)
    tab.click('#tab-settings')
    tab.select_option('[data-key="openMeasure"]', 'spread')
    redrawn(tab)
    tab.click('#tab-wallet')
    total = tab.inner_text('#brp-table tbody tr:last-child')
    check('€7,000' in total, 'the spread over day-ahead at p98: 20 × 3 × €120.10 = €7,206: ' + total)


def levers(run):
    """A "would lower it most" link opens Settings with that field focused."""
    tab = run.open('wallet')
    tab.click('#parts button[data-focus="replenish"]')
    focused = tab.evaluate('document.activeElement.getAttribute("data-key")')
    run.check(tab.is_visible('#view-settings') and focused == 'replenish', 'a lever link focuses its setting')


def phone(run):
    tab = run.open('wallet', viewport=PHONE)
    run.check(fits(tab, PHONE['width']), 'wallet view fits a 390 px phone screen')
    tab.click('#tab-settings')
    run.check(fits(tab, PHONE['width']), 'settings view fits a 390 px phone screen')


def check_wallet(run):
    for scenario in [presets, settings, open_position, levers, phone]:
        scenario(run)


if __name__ == '__main__':
    main([('Wallet calculator', check_wallet)])
