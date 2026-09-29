# Direct+ calculators

A browser calculator for Direct+ members (EPEX SPOT, clearing with ECC as Direct Clearing
Participants, DCP). It turns collateral into trading limits per market, and trading goals back into
the collateral needed. The audience is members and prospects, not ECC or EPEX staff: keep the
wording plain and every number traceable to ECC's rules. The wallet calculator and the estimate for prospects are
described below.

## Layout

- `src/engine.js` holds all the limit logic: calendar, base-limit reserve, evening/morning limits, sizing solver. It has no DOM; the pages and the tests use it.
- `src/pages/` holds the pages, one folder each: `limits/` (this calculator), `wallet/` and `estimate/` (the wallet calculator and the estimate for prospects) and `home/` (the landing page of the hosted site). Each has `index.html` (the markup, with `/*__STYLES__*/` and `/*__SCRIPTS__*/` markers), `style.css` and, when the page has a script, `main.js`. `shared/` holds what several pages use: `base.css` (tokens, dark mode, buttons, tables, tooltip), `wallet.css` (the wallet pages' stacked bars), `ui.js` (`PageUI`: DOM, formatting, date and chart helpers) and `handoff.js` (`Handoff`: the links between the calculator and the estimate).
- `scripts/build.js` inlines each page's stylesheets and scripts (its `PAGES` list says which) and writes `dist/direct-plus-limit-calculator.html` (the page body, as published at the claude.ai link) and `dist/standalone/...` (a full document that opens from disk), the same pair for the wallet pages under `dist/wallet/`, and `dist/index.html`. Never edit `dist/` by hand.
- `tests/dist.test.js`: builds the ECC pages into a temp directory and checks their SHA-256 against `tests/golden/ecc_dist.sha256`, and that every committed `dist/` file is what a fresh build makes. Any change to `src/engine.js`, `src/pages/limits/` or the shared files it uses (`base.css`, `ui.js`, `handoff.js`) changes these bytes. Re-record (`node tests/dist.test.js --write`) only on purpose, and say why in the commit message.
- `tests/engine/ecc-examples.test.js`: ECC's own worked examples (deck p.8 and p.10). **Must always pass.**
- `tests/engine/snapshot.test.js`: engine output for every business day in range, over 5 parameter sets, plus 3 sizing searches. A refactor must leave it unchanged. Only re-record (`node tests/engine/snapshot.test.js --write`) after a change that is meant to change numbers, and say which numbers changed and why in the commit message.
- `tests/engine/markets.test.js`: market definitions against ECC's table, the markets form against the two-market form, and the cheapest split with three markets against every split.
- `tests/ui/`: headless checks of the built pages (Playwright, Python): `limits.py`, `wallet.py`, `estimate.py`, `handoff.py`, with `support.py` and `run.py`.
- `scripts/diagnostics/monday-readings.js`: prints the readings of the open Monday question. It's a diagnostic, not a test.
- `reference/`: ECC and EPEX source material. `docs/model.md` explains the model; `docs/open-questions.md` lists what ECC has not confirmed.

## Commands

    npm test              # every Node test (node:test): engine, wallet, dist, server
    npm run build         # rebuild dist/ (ECC and wallet)
    npm run build:ecc     # ECC calculator only
    npm run build:wallet  # wallet calculator only
    npm run test:ui       # build + the headless UI tests (needs Python Playwright)
    npm run lint          # ESLint (npm run lint:py: ruff on the UI tests)
    npm run format        # Prettier (npm run format:py: ruff format)

Run `npm test` before and after every engine change. CI (`.github/workflows/ci.yml`) runs the lint, the format
check, `npm test` and the UI tests on every push.

## Code style

- Plain modern JavaScript, formatted by Prettier and checked by ESLint (`npm run format`, `npm run lint`); ruff for
  the Python UI tests. No dependencies at runtime and no build framework.
- Each module is an IIFE that defines one global (`LimitEngine`, `WalletCalc`, `PageUI`, `Handoff`, …). The
  calculation modules (`src/engine.js`, `src/wallet/`) end with `if (typeof module !== 'undefined') module.exports = X;`
  so the tests can load them in Node; the build strips that line. A page's `main.js` is an IIFE that defines nothing
  global. New globals go in `eslint.config.mjs`, and new modules in the `PAGES` list of `scripts/build.js`.
- Page code avoids browser APIs newer than 2021 (for example `Object.hasOwn` and `Array.prototype.at`): members
  and prospects don't all have new browsers.
- Node tests use `node:test`; money compares with `assertMoney` (`tests/helpers.js`). A deliberate change to a
  page's look shows in its UI test or in a screenshot check; say what changed in the commit message.

## Rules

1. **ECC's examples are the ground truth.** If a change breaks `tests/engine/ecc-examples.test.js`, the change is wrong, not the test.
2. **Separate ECC's rules from our assumptions.** Wherever the engine fills a gap ECC has not documented (see `docs/open-questions.md`), mark it in code with `// ASSUMPTION:` and say so in the page text. Never present an assumption as ECC's rule.
3. **The source for new markets is ECC's own tool.** Its logic is in `reference/ecc/DCP_SimulationTool4Clients_vba.txt`, and its market table is in `reference/ecc/markets_table.csv`. Port from there, and cite the VBA line numbers in comments. Where the VBA and ECC's slide deck disagree, flag it in `docs/open-questions.md` rather than picking one silently.
4. **Don't change what the page says about ECC timing without a source.** Say "around 18:00" and "best effort". Don't give 17:00 or 20:00 as fixed times.
5. **Each page must build into one self-contained HTML file.** Its sources are split (markup, stylesheet, script, shared files); `scripts/build.js` inlines them. A page may load fonts from Google Fonts and nothing else. No build framework: plain JS keeps it portable into the claude.ai artifact.
6. **No browser storage** (localStorage etc.) for anything that matters.
7. **Keep the engine's public API stable** (`day`, `week`, `weekDays`, `solve`, `binding`, `cheapestKey`, `parse`, `iso`, `isBD`, `nextBD`, `prevBD`, `holidayName`, `MARKETS`), or update the page and the deck copy in the same change. Both parameter forms stay supported: the markets list and the original `cont` / `da` (see `docs/model.md`).

## Wallet calculator (`src/wallet/`)

A second page in the same repo: how much money a Direct+ member needs, in which part of the wallet, and by when
(all cash: Direct+ accepts no bank guarantees). Brief: `docs/wallet-brief.md`. Model, sources and the worked example: `docs/wallet-model.md`.

- **Modules:** `dates.js`, `behaviour.js` → `settlement.js` → `ecc-link.js`, plus `brp.js`, `tennet-account.js` and `open-position.js`; `settings.js` (every setting, the presets) and `answers.js` (the questionnaire). `wallet.js` combines them and is the one object the pages use (`WalletCalc`). The build inlines the same `src/engine.js`.
- **Pages:** `src/pages/wallet/` is the full calculator with its Settings view. `src/pages/estimate/` is the shareable questionnaire for prospects, whose answers map onto settings through `answers.js` (`fromAnswers`, `docs/wallet-model.md` §12). Keep the estimate page free of internal references (question numbers, tags, document sections).
- **Hand-off with the limit calculator:** "Detailed calculation" (estimate → `/limits`, `#w=…` plus the estimate's own `#a=…` state) and "Use in the wallet estimate" (`/limits` → estimate, `#ecc=…`). The wallet side uses the settings `eccCollateral` and `blContBD`/`blContNBD`/`blAucBD`/`blAucNBD` (result `ecc.fixed`: amount, what the trading needs, short). Links show only on the hosted site or in `dist/` on disk, never in the claude.ai copy. `tests/ui/handoff.py` covers the round trip.
- **Engine:** the wallet uses only the engine's public API, in its two-market form. **Never edit `src/engine.js`, `src/pages/limits/` or the shared page files for the wallet alone**: `tests/dist.test.js` pins the ECC pages' bytes.
- **Settings:** every setting (label, unit, kind, tag, source, default) is listed once in `settings.js` (`GROUPS`). The Settings view and the "Assumptions and sources" table are generated from it. A new setting goes there, with its source. Presets (`PRESETS`) are approved by Niki for now.
- **Sources:** rule parameters carry their source in a comment (`brp.js` `RULES`). Say "TenneT" on this page (Niki, 26 Sep 2026); the Direct+ videos say "the TSO" instead.
- **Member model (Niki, 26 Sep 2026):** each member pays its own imbalance and reconciliation, and puts up only its **marginal** BRP collateral: the rule on its own figures, with no €96,000 minimum and no 50 MW floors (those apply once to the Direct+ BRP), never below €0. "On your own as a BRP" (with the minimum) is a Settings option for comparison. Direct+ accepts **cash only**, so there are no bank guarantees and no ECC default fund. The wallet pools all members at one connected bank; nothing nets between members.
- **Open-position buffer (Niki, 29 Sep 2026):** option 1 of Niki's options paper on open-position risk. S = the open position Direct+ allows (MWh a day) × days at risk (1) × a percentile (the 99th by default) of TenneT's 2025 imbalance prices averaged per day, or of their spread over the day-ahead price (a setting; Niki, 29 Sep 2026). On the Direct+ basis, BRP collateral = max(the marginal rule, S). For members without assets (no connections, nothing nominated in), S replaces TenneT's rule in force (`rule: 'open'`), and what their plan leaves open counts when it is more than the cap. The percentile table in `open-position.js` must match `reference/tennet/tennet-entsoe_imbalance-and-day-ahead-prices-2025_daily-averages_2026-09-29.csv` (`tests/wallet/open-position.test.js`). New price data comes from the imbalance analysis project (`~/imbalance_analysis`). Model: `docs/wallet-model.md` §4.5.
- **Tests:** `tests/wallet/` (run by `npm test`; money compares with |Δ| < €0.005) and `tests/ui/wallet.py` and `tests/ui/estimate.py` (run by `npm run test:ui`). `tests/wallet/wallet.test.js` pins the worked example of `docs/wallet-model.md` §8. If a change moves those numbers, update the model document in the same change.

## Outside this repo

- The published calculator lives at a claude.ai artifact link and is republished from a Claude chat, not from here. Hand over `dist/direct-plus-limit-calculator.html`. It changed on 26 Sep 2026 (the static vs daily-optimised collateral option; the markets named M7 and MATS; amounts with thousands separators and arrow buttons) and again on 28 Sep 2026 (the code restructured, with the same numbers and look, and a fix: the claude.ai copy could show the target-limit fields and an empty wallet button that should be hidden), so the published link needs republishing. The same page is also served at `/limits` on Railway (`scripts/serve.js`). The wallet calculator's equivalents are `dist/wallet/direct-plus-wallet-calculator.html` and, for prospects, `dist/wallet/direct-plus-wallet-prospect.html` (not published yet).
- The member slide deck (a claude.ai Slides artifact) holds a **copy** of `src/engine.js` to generate its example numbers. After an engine change that alters numbers, say so, so the deck copy can be synced. The engine's code was rewritten on 28 Sep 2026 without changing a number (it now defines `const LimitEngine`), so the deck's older copy needs no sync.
