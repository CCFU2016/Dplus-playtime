"""Support for the UI tests: they open the built pages in dist/ from disk in headless Chromium (npm run test:ui builds
them first), with today's date fixed, and print every check.
Needs: pip install -r requirements-dev.txt (Playwright, with its Chromium installed)."""

import pathlib
import sys

from playwright.sync_api import sync_playwright

DIST = pathlib.Path(__file__).resolve().parents[2] / 'dist'
PAGES = {
    'limits': DIST / 'standalone/direct-plus-limit-calculator.html',
    'wallet': DIST / 'wallet/standalone/direct-plus-wallet-calculator.html',
    'estimate': DIST / 'wallet/standalone/direct-plus-wallet-prospect.html',
}
# The pages pick their weeks from today: fixed at Monday 28 Sep 2026, so the default week is 5 Oct 2026, the week of
# the worked examples, and the rule in force is the current one.
TODAY = '2026-09-28T09:00:00'
# The calculators redraw a moment after an input (the limit calculator after 60 ms, the wallet after 120 ms), and their
# charts in the next frame after a resize (a ResizeObserver).
REDRAW_MS = 250
DESKTOP = {'width': 1280, 'height': 1000}
PHONE = {'width': 390, 'height': 844}


def url(page):
    return PAGES[page].as_uri()


def redrawn(tab):
    """Waits until the page has redrawn after an input or a resize."""
    tab.wait_for_timeout(REDRAW_MS)


def fits(tab, width):
    """Nothing on the page is wider than the screen."""
    return tab.evaluate('document.documentElement.scrollWidth') <= width


class Run:
    """One UI test: opens pages, prints each check, and collects the failures and the pages' errors."""

    def __init__(self, name, browser):
        self.name = name
        self.browser = browser
        self.failures = []
        self.errors = []

    def open(self, page, viewport=DESKTOP, hash=''):
        """A new tab on one of the built pages (optionally with a # link), with today fixed."""
        tab = self.browser.new_page(viewport=viewport)
        tab.on('pageerror', lambda error: self.errors.append(str(error)))
        tab.on('console', lambda message: self.errors.append(message.text) if message.type == 'error' else None)
        tab.clock.set_fixed_time(TODAY)
        tab.goto(url(page) + hash)
        return tab

    def check(self, ok, what):
        print(('ok   ' if ok else 'FAIL ') + what)
        if not ok:
            self.failures.append(what)

    def finish(self):
        """Checks that no page reported an error; True when every check passed."""
        self.check(not self.errors, 'no page errors' + (': ' + '; '.join(self.errors) if self.errors else ''))
        print(f'{self.name}: {"FAILED" if self.failures else "passed"}\n')
        return not self.failures


def run_tests(tests, browser):
    """Runs (name, test) pairs in one browser; True when all passed."""
    results = []
    for name, test in tests:
        run = Run(name, browser)
        test(run)
        results.append(run.finish())
    return all(results)


def main(tests):
    """Runs UI tests from the command line, and exits with 1 when any failed."""
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        passed = run_tests(tests, browser)
        browser.close()
    sys.exit(0 if passed else 1)
