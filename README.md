# Direct+ calculators

Browser calculators for Direct+ members, who trade on EPEX SPOT and clear with ECC as Direct Clearing Participants:

- **Limit calculator** (`/limits`): the trading limits a member's collateral gives on M7 continuous and the MATS
  auctions, day by day through weekends and holidays, or the collateral that target limits need. It applies ECC's
  dynamic limit rules and reproduces ECC's own worked examples exactly. EPEX GO auctions are left out for now
  (`TASKS.md`).
- **Wallet estimate** (`/estimate`): a short questionnaire for prospects, then how much money their Direct+ wallet
  needs, what for and when: ECC collateral and settlement, TenneT BRP collateral, imbalance invoices. All in cash.
- **Wallet calculator** (`/wallet`, for Direct+ staff): the same calculation, with every assumption and its source in a
  Settings view.

The limit calculator and the estimate hand setups to each other in the link (after the `#`); nothing is stored.

> A proof of concept by NVS: explanatory tools, not ECC's or TenneT's calculations. Their own figures always prevail.

## How it is built

Plain JavaScript: no framework and no runtime dependencies. Each page builds into one self-contained HTML file, so it
opens from disk, runs as a claude.ai artifact, or is served by a small Node server.

    src/
      engine.js     ECC's limit rules: the calendar, base limits, evening and morning limits, sizing
      wallet/       the wallet calculation, one module per part, no DOM
      pages/        one folder per page (markup, stylesheet, script), and shared/ for what the pages share
    scripts/
      build.js      inlines each page's stylesheets and scripts into dist/
      serve.js      the hosted site: /, /estimate, /limits and /wallet
    tests/
      engine/       ECC's worked examples, the engine snapshot, the market definitions
      wallet/       the wallet modules, and the worked example of docs/wallet-model.md
      ui/           browser checks of the built pages (Python, Playwright)
    docs/           the models, the open questions and the sources

**Why the numbers can be trusted.** ECC's worked examples are the ground truth (`tests/engine/ecc-examples.test.js`).
A snapshot pins the engine's output on every business day, the wallet tests pin the model document's worked example,
and the ECC calculator's published files are pinned by their SHA-256. Every rule parameter cites its source, and the
code marks where it fills a gap in the rules (`ASSUMPTION`, `INTERPRETATION`); `docs/open-questions.md` lists what is
still to be confirmed.

## Commands

    npm install
    npm test              # the Node tests (node:test)
    npm run build         # rebuild dist/ after a change in src/
    npm run test:ui       # build, then the browser tests
    npm run lint          # ESLint (npm run lint:py: ruff on the browser tests)
    npm run format        # Prettier (npm run format:py: ruff format)
    npm start             # serve dist/ on $PORT (default 3000)

Node 22 or later. The browser tests need Python 3.11+ with Playwright:
`pip install -r requirements-dev.txt && python3 -m playwright install chromium`. GitHub Actions runs all of it on
every push (`.github/workflows/ci.yml`).

**Hosting.** `npm start` runs `scripts/serve.js`, which only uses Node's built-in modules. The wallet calculator at
`/wallet` is only served when `WALLET_PASSWORD` is set, behind a browser login (user name `WALLET_USER`, default
`directplus`). `dist/` is committed, and the build also runs on deploy.

## Documentation

- How the limits are modelled: `docs/model.md`
- The wallet: the brief `docs/wallet-brief.md` and the model `docs/wallet-model.md`
- What ECC and TenneT have not confirmed: `docs/open-questions.md`
- Sources: `docs/sources.md`
- Working rules for Claude Code: `CLAUDE.md`
