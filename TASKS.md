# Tasks

Work top to bottom. Run `npm test` before and after each task. One commit per task.

## 1. Get green
- [x] `npm test` passes, and so does `npm run test:ui` (install python playwright if needed).
- [x] `npm run build` reproduces `dist/` with no diff: `git status` stays clean.

## 2. Generalise the engine to any number of markets (no number changes)
- [x] Replace the fixed `cont` / `da` parameters with a list of markets. Each market has a definition taken from `reference/ecc/markets_table.csv`: reset rule (`business day` / `day`), auction flag, own trading calendar, currency.
- [x] Keep `cont` / `da` as a thin compatibility layer, or update `src/page.html` in the same change.
- [x] The snapshot and ECC-example tests must pass **unchanged**. This task changes no numbers.
- [x] The solver (`solve`, `cheapestKey`) must work for N markets. `cheapestKey` currently scans one split from 0 to 100; with more than two markets it needs a different search. Propose one before building it.
  Proposed 26 Sep 2026: exact search on per-market minimum keys (see `docs/model.md`, "Cheapest split"). No explicit go-ahead; built as the recommended option once GO was left out. Same results as the old scan for two markets.

## 3. Add EPEX GO auctions (EPEX_GOEU_EUR)
**Left out for now (Niki, 26 Sep 2026).** Not started. What ECC's tool does for GO is written up in
`docs/model.md` ("Markets with their own trading calendar"), and the open points are questions 5–9.
The trading-day question below is still open.

- [ ] Market definition from the table: reset `day`, auction flag 1, own trading calendar.
- [ ] Trading-day calendar from `reference/epex/go_auction_dates_2026.csv`. Decide with the user which date counts as the trading day: see open questions 5 and 6. ECC's 2025 calendar in `reference/ecc/separate_trading_day_calendars_2025.csv` suggests the closing day.
- [ ] Port the VBA behaviour: base limit only on GO trading days; the market only counts when the next business day is a GO trading day; reset count 1.
- [ ] GO-only member: limit = collateral (ECC deck p.15). Add a test.
- [ ] Add ECC-style tests for a GO week (for example the week of 12 Oct 2026), with the expected values worked out by hand and written into the test with the reasoning.
- [ ] Page: add GO as an optional market. Explain in one line that only buy orders use the limit, and that the limit must cover all production months in the auction.
- [ ] Mark everything that rests on open questions 5–7 as `// ASSUMPTION:` and state it on the page.

## 4. Wording
- [ ] Once ECC confirms question 4: relabel "day-ahead" as "auctions (day-ahead + intraday)" in the page.

## Not decided (ask the user before starting)
- EPEX GB (continuous and auction, GBP): needs currency, exchange rate and delivery risk (£140 per MWh, sell only, since 22 Jan 2026, Circular 04/2026).
- EPEX capacity auctions (EPEX_CPCTY_EUR).
- Base-limit change latency from form O09 (open question 3).

## Wallet calculator
Brief `docs/wallet-brief.md`, model `docs/wallet-model.md`.
- [x] Phases 0–5 (26 Sep 2026). Presets are approved for now; every assumption is on the page's Settings view.
- [x] Phase 6: documentation.
- [ ] Open points W1–W12 in `docs/open-questions.md`.
