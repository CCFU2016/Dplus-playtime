"""The hand-off between the wallet estimate and the limit calculator, on the built pages opened from disk (they link to
each other there as on the hosted site):
  1. "Detailed calculation" under "Trading collateral at ECC" opens the limit calculator with the estimate's
     collateral, split, base limits, open risk and week, on the day that sets the amount, whose limits meet what the
     estimate needs;
  2. "Back to the wallet estimate" reopens the same estimate;
  3. a changed setup taken back is used for the trading collateral at ECC, flagged when short, and can be dropped;
  4. from the limit calculator on its own, "Use in the wallet estimate" carries the setup to the questions."""

import base64
import datetime
import json
import re

from support import main, redrawn

WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']


def decode(text):
    return json.loads(base64.urlsafe_b64decode(text + '=' * (-len(text) % 4)).decode('utf-8'))


def euros(text):
    return int(re.sub(r'[^\d]', '', text))


def ecc_amount(tab):
    """The estimate's trading collateral at ECC (the first row of what the money is for)."""
    return euros(tab.eval_on_selector('#purposes tbody tr', 'row => row.lastElementChild.innerText'))


def wait_for(tab, selector):
    tab.wait_for_selector(selector, state='visible', timeout=15000)


def to_limits_and_back(run):
    check = run.check
    tab = run.open('estimate')
    tab.click('#skip')
    wait_for(tab, '#results')
    hero, own = tab.inner_text('#hero-value'), ecc_amount(tab)
    check('#a=' in tab.url and '&ex=1' in tab.url, 'the estimate keeps its answers in the link')
    href = tab.get_attribute('#purposes a.detail', 'href') or ''
    check(
        href.startswith('../../standalone/direct-plus-limit-calculator.html#w='),
        'Detailed calculation links to the limit calculator: ' + href[:60],
    )
    w = decode(re.search(r'#w=([^&]+)', href).group(1))

    # 1. The estimate's setup in the limit calculator
    tab.click('#purposes a.detail')
    wait_for(tab, '#handoff')
    check(
        'From your wallet estimate' in tab.inner_text('#handoff'),
        'the limit calculator says the values come from the wallet',
    )
    prefilled = (
        tab.eval_on_selector('#mode-fwd', 'radio => radio.checked') and euros(tab.input_value('#collateral')) == w['C']
    )
    check(
        prefilled and tab.input_value('#split') == str(w['key']),
        f'prefilled: limits from €{w["C"]} collateral at {w["key"]} / {100 - w["key"]}',
    )
    base = euros(tab.input_value('#c-bd')) == w['cbd'] and euros(tab.input_value('#a-nbd')) == w['anbd']
    check(euros(tab.input_value('#open-risk')) == w['or'] and base, 'open risk and base limits prefilled')
    check(tab.input_value('#week') == w['week'], 'the same week: ' + w['week'])
    limits = tab.evaluate(
        """w => {
          const E = LimitEngine;
          const r = E.day(E.parse(w.day), { C: w.C, OR: w.or, cont: { bd: w.cbd, nbd: w.cnbd, key: w.key }, da: { bd: w.abd, nbd: w.anbd, key: 100 - w.key } });
          const shares = r.da.auctions.filter(a => !a.settled).map(a => a.limit);
          return [r.cont.l18, Math.min(...shares, r.da.l09)];
        }""",
        w,
    )
    meets = limits[0] >= w['tc'] - 1 and limits[1] >= w['ta'] - 1
    check(
        meets,
        f'on {w["day"]} those limits meet what the wallet needs: M7 {limits[0]:.0f} >= {w["tc"]}, MATS {limits[1]:.0f} >= {w["ta"]}',
    )
    weekday = WEEKDAYS[datetime.date.fromisoformat(w['day']).weekday()]
    selected = tab.inner_text('#day-tabs [aria-selected="true"]')
    check(
        selected.startswith(weekday),
        f'the day that sets the amount ({w["day"]}, a {weekday}) is selected: {selected.split(chr(10))[0]}',
    )

    # 2. Back
    tab.click('#handoff-back')
    wait_for(tab, '#results')
    same = tab.is_hidden('#wizard') and tab.inner_text('#hero-value') == hero and tab.is_visible('#example')
    check(same, 'Back reopens the same estimate (still the example): ' + hero)

    # 3. A changed setup taken back
    tab.click('#purposes a.detail')
    wait_for(tab, '#handoff')
    tab.fill('#collateral', str(w['C'] - 10000))
    redrawn(tab)  # the calculator updates its links when it redraws
    tab.click('#handoff-use')
    wait_for(tab, '#results')
    note = tab.inner_text('#purposes .carried') if tab.query_selector('#purposes .carried') else ''
    check(abs(ecc_amount(tab) - (w['C'] - 10000)) <= 500, f'the wallet uses the carried collateral: {ecc_amount(tab)}')
    short = tab.query_selector('#purposes .carried.short') is not None
    check('From your limit calculator' in note and short and 'may run out' in note, 'short by €10,000: flagged')
    check(
        'From your limit calculator' in tab.inner_text('#core'), 'core assumptions say where the collateral comes from'
    )
    tab.click('#purposes button:has-text("Use the estimate")')
    dropped = tab.query_selector('#purposes .carried') is None and 'ecc=' not in tab.url
    check(ecc_amount(tab) == own and dropped, "dropping it gives the estimate's own amount again")


def from_limits(run):
    """4. From the limit calculator on its own."""
    check = run.check
    tab = run.open('limits')
    check(
        tab.is_hidden('#handoff') and tab.is_visible('#to-wallet'),
        'the limit calculator offers "Use in the wallet estimate"',
    )
    collateral = euros(tab.input_value('#collateral'))
    tab.click('#to-wallet')
    wait_for(tab, '#setup-note')
    note = tab.inner_text('#setup-note')
    check(
        tab.is_visible('#wizard') and 'carried over' in note and f'€{collateral:,}' in note,
        f'the questions say the setup is carried over: €{collateral:,}',
    )
    tab.click('#skip')
    wait_for(tab, '#results')
    check(
        ecc_amount(tab) == collateral and tab.query_selector('#purposes .carried') is not None,
        f'the estimate uses it: €{ecc_amount(tab):,}',
    )


def check_handoff(run):
    to_limits_and_back(run)
    from_limits(run)


if __name__ == '__main__':
    main([('Hand-off', check_handoff)])
