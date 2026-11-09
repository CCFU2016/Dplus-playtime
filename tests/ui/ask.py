"""The "Ask about your result" panel on the limit calculator. It needs the hosted site's server, so the built page is
served at a made-up address with the server's endpoints answered by the test (Run.serve):
  1. from disk, the page has no panel;
  2. on the site, a suggested question sends the page's case and shows the answer, a follow-up sends the earlier
     question and answer along, an error shows as such, and "New conversation" starts over;
  3. the team tab sends a question with the case; without the assistant, only that tab shows;
  4. the suggestions follow the page's mode, the panel stays off the printed page, and it fits a phone."""

import json

from support import PHONE, fits, main, redrawn

ANSWER = 'Friday reserves €100,000: the weekend base limits.'


class FakeServer:
    """The server's endpoints: GET /api/panel says what the panel offers; POST /api/ask answers every question with
    ANSWER, or with an error when the question says "fail"; POST /api/feedback accepts. Keeps what was posted."""

    def __init__(self, ask=True, feedback=True):
        self.offers = {'ask': ask, 'feedback': feedback}
        self.asked = []
        self.sent = []

    def __call__(self, method, path, body):
        if path == '/api/panel':
            return 200, 'application/json', json.dumps(self.offers)
        if path == '/api/ask':
            self.asked.append(body)
            if 'fail' in body['question']:
                lines = [{'error': 'The assistant is busy. Try again in a minute.'}]
            else:
                lines = [{'text': ANSWER[:20]}, {'text': ANSWER[20:]}, {'done': True, 'outcome': 'answered'}]
            return 200, 'application/x-ndjson', ''.join(json.dumps(line) + '\n' for line in lines)
        if path == '/api/feedback':
            self.sent.append(body)
            return 200, 'application/json', '{"ok": true}'
        return 404, 'application/json', '{"error": "Not found."}'


def answered(tab, count):
    """Waits until the panel has `count` answers that are no longer on their way."""
    tab.wait_for_function(
        f'document.querySelectorAll(".ask-a:not(.waiting)").length === {count} && '
        'document.querySelector(".ask-form .btn").textContent === "Ask"',
        timeout=5000,
    )


def not_on_disk(run):
    tab = run.open('limits')
    redrawn(tab)
    run.check(tab.locator('.ask-launcher').count() == 0, 'from disk: no panel (no server to answer)')


def conversation(run):
    check = run.check
    server = FakeServer()
    tab = run.serve('limits', server)
    launcher = tab.locator('.ask-launcher')
    launcher.wait_for()
    check(launcher.inner_text() == 'Ask about your result', 'on the site: the "Ask about your result" button')
    launcher.click()
    check(tab.is_visible('#ask-panel') and not launcher.is_visible(), 'it opens the panel in its place')
    check(tab.evaluate('document.activeElement.id') == 'ask-question', 'with the question field focused')
    chips = tab.locator('.ask-chip')
    check(chips.count() == 3, 'three questions to start with')

    first = chips.first.inner_text()
    chips.first.click()
    answered(tab, 1)
    asked = server.asked[0]
    check(asked['question'] == first and asked['history'] == [], 'a suggestion asks itself: ' + first)
    case = asked['case']
    check(
        'Mode: Limits from my collateral' in case and 'Collateral posted: €500,000' in case,
        'with the case: the mode and the inputs',
    )
    check('- M7 continuous, from 18:00: €200k' in case, 'the results at the top of the page')
    check(
        'Fri 9 Oct (3-day gap, until Mon 12 Oct)' in case and 'reserved €100,000 (M7 €60,000 + MATS €40,000)' in case,
        "and each of the week's calculations, with full dates",
    )
    check(tab.inner_text('.ask-a') == ANSWER, 'the answer shows, whole')
    check(
        not tab.is_visible('.ask-chips') and tab.is_visible('.ask-new'), 'the suggestions give way to the conversation'
    )

    tab.fill('#ask-question', 'And on Monday?')
    tab.press('#ask-question', 'Enter')
    answered(tab, 2)
    check(
        server.asked[1]['history'] == [{'question': first, 'answer': ANSWER}],
        'Enter asks a follow-up, with the earlier question and answer',
    )
    tab.fill('#ask-question', 'Please fail')
    tab.click('.ask-form .btn')
    answered(tab, 3)
    failed = tab.locator('.ask-a').nth(2)
    check('failed' in failed.get_attribute('class') and 'busy' in failed.inner_text(), 'an error shows as one')
    tab.fill('#ask-question', 'Once more?')
    tab.press('#ask-question', 'Enter')
    answered(tab, 4)
    check(len(server.asked[3]['history']) == 2, 'the failed question is not sent along')

    tab.click('.ask-new')
    check(tab.locator('.ask-q').count() == 0 and tab.is_visible('.ask-chips'), '"New conversation" starts over')
    tab.keyboard.press('Escape')
    check(not tab.is_visible('#ask-panel') and launcher.is_visible(), 'Escape closes the panel')
    check(tab.evaluate('document.activeElement.className') == 'ask-launcher', 'and gives the focus back to its button')

    tab.click('label[for=mode-inv]')
    redrawn(tab)
    launcher.click()
    check(chips.first.inner_text() == 'What sets the collateral needed?', 'the suggestions follow the mode')

    tab.emulate_media(media='print')
    check(not tab.is_visible('#ask-panel') and not launcher.is_visible(), 'the printed page leaves the panel out')


def team(run):
    check = run.check
    server = FakeServer()
    tab = run.serve('limits', server)
    tab.locator('.ask-launcher').click()
    tab.click('#ask-tab-team')
    check(tab.is_visible('#team-message') and not tab.is_visible('#ask-question'), 'the team tab')
    tab.fill('#team-message', 'Can ECC confirm the Monday rule?')
    tab.fill('#team-email', 'trader@example.com')
    tab.click('.team-form .btn')
    tab.locator('.team-sent').wait_for()
    sent = server.sent[0]
    check(
        sent['kind'] == 'question'
        and sent['message'] == 'Can ECC confirm the Monday rule?'
        and sent['page'] == 'limits',
        'sends a question for the team',
    )
    check(sent['email'] == 'trader@example.com' and 'Collateral posted: €500,000' in sent['case'], 'with the case')
    check('with the Direct+ team' in tab.inner_text('.team-sent'), 'and says it arrived')
    tab.click('.team-again')
    tab.click('label:has(input[value=feedback])')
    tab.uncheck('#team-case')
    tab.fill('#team-message', 'Nice tool.')
    tab.click('.team-form .btn')
    tab.locator('.team-sent').wait_for()
    check(server.sent[1]['kind'] == 'feedback' and server.sent[1]['case'] == '', 'feedback, without the case')

    tab = run.serve('limits', FakeServer(ask=False))
    launcher = tab.locator('.ask-launcher')
    launcher.wait_for()
    launcher.click()
    check(
        launcher.inner_text() == 'Question or feedback'
        and not tab.is_visible('.ask-tabs')
        and tab.is_visible('#team-message'),
        'without the assistant: only the question or feedback form',
    )
    tab = run.serve('limits', FakeServer(feedback=False))
    launcher = tab.locator('.ask-launcher')
    launcher.wait_for()
    launcher.click()
    check(
        not tab.is_visible('.ask-tabs') and tab.is_visible('#ask-question') and not tab.is_visible('#team-message'),
        'without a place to keep messages: only the assistant',
    )
    tab = run.serve('limits', FakeServer(ask=False, feedback=False))
    redrawn(tab)
    check(tab.locator('.ask-launcher').count() == 0, 'with neither: no panel')


def phone(run):
    tab = run.serve('limits', FakeServer(), viewport=PHONE)
    tab.locator('.ask-launcher').click()
    box = tab.locator('#ask-panel').bounding_box()
    run.check(box['x'] >= 0 and box['x'] + box['width'] <= PHONE['width'], 'the panel fits a 390 px phone screen')
    run.check(fits(tab, PHONE['width']), 'and so does the page')


def check_ask(run):
    for scenario in [not_on_disk, conversation, team, phone]:
        scenario(run)


if __name__ == '__main__':
    main([('Ask about your result', check_ask)])
