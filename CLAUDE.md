# Direct+ limit calculator

A browser calculator for Direct+ members (EPEX SPOT, clearing with ECC as Direct Clearing
Participants, DCP). It turns collateral into trading limits per market, and trading goals back into
the collateral needed. The audience is members and prospects, not ECC or EPEX staff: keep the
wording plain and every number traceable to ECC's rules.

## Layout

- `src/engine.js` holds all the limit logic: calendar, base-limit reserve, evening/morning limits, sizing solver. It has no DOM, and the page and the tests both use it.
- `src/page.html` is the page (HTML, CSS, UI script). `/*__ENGINE__*/` marks where the build inlines the engine.
- `scripts/build.js` writes `dist/direct-plus-limit-calculator.html` (the page body, as published at the claude.ai link) and `dist/standalone/...` (a full document that opens from disk). Never edit `dist/` by hand.
- `tests/ecc_examples.test.js`: ECC's own worked examples (deck p.8 and p.10). **Must always pass.**
- `tests/snapshot.js`: engine output for every business day in range, over 5 parameter sets, plus 3 sizing searches. A refactor must leave it unchanged. Only re-record (`--write`) after a change that is meant to change numbers, and say which numbers changed and why in the commit message.
- `tests/ui_smoke.py`: headless check of the built page.
- `tests/monday_readings.js`: prints the readings of the open Monday question. It's a diagnostic, not a test.
- `reference/`: ECC and EPEX source material. `docs/model.md` explains the model; `docs/open-questions.md` lists what ECC has not confirmed.

## Commands

    npm test          # ECC examples + snapshot
    npm run build     # rebuild dist/
    npm run test:ui   # build + headless smoke test (needs python playwright)

Run `npm test` before and after every engine change.

## Rules

1. **ECC's examples are the ground truth.** If a change breaks `ecc_examples.test.js`, the change is wrong, not the test.
2. **Separate ECC's rules from our assumptions.** Wherever the engine fills a gap ECC has not documented (see `docs/open-questions.md`), mark it in code with `// ASSUMPTION:` and say so in the page text. Never present an assumption as ECC's rule.
3. **The source for new markets is ECC's own tool.** Its logic is in `reference/ecc/DCP_SimulationTool4Clients_vba.txt`, and its market table is in `reference/ecc/markets_table.csv`. Port from there, and cite the VBA line numbers in comments. Where the VBA and ECC's slide deck disagree, flag it in `docs/open-questions.md` rather than picking one silently.
4. **Don't change what the page says about ECC timing without a source.** Say "around 18:00" and "best effort". Don't give 17:00 or 20:00 as fixed times.
5. **The page must stay one self-contained HTML file.** It may load fonts from Google Fonts and nothing else. No build framework: plain JS keeps it portable into the claude.ai artifact.
6. **No browser storage** (localStorage etc.) for anything that matters.
7. **Keep the engine's public API stable** (`day`, `week`, `weekDays`, `solve`, `binding`, `cheapestKey`, `parse`, `iso`, `isBD`, `nextBD`, `prevBD`, `holidayName`), or update the page and the deck copy in the same change.

## Outside this repo

- The published calculator lives at a claude.ai artifact link and is republished from a Claude chat, not from here. Hand over `dist/direct-plus-limit-calculator.html`.
- The member slide deck (a claude.ai Slides artifact) holds a **copy** of `src/engine.js` to generate its example numbers. After an engine change that alters numbers, say so, so the deck copy can be synced.
