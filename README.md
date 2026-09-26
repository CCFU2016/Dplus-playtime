# Direct+ limit calculator and wallet calculator

Two single-file calculators for Direct+ members clearing with ECC as Direct Clearing Participants:

- **Limit calculator** (`src/engine.js`, `src/page.html`): collateral to trading limit and back, for EPEX continuous and day-ahead. GO auctions are left out for now (see `TASKS.md`).
- **Wallet calculator** (`src/wallet/`): how much money a member needs, in which part of the Direct+ wallet, and by when (Direct+ works with cash only). It covers ECC collateral and settlement, TenneT BRP security and imbalance invoices. Every assumption can be changed on its Settings page.
- **Prospect questionnaire** (`src/wallet/prospect.html`): a shareable page that asks seven questions (type, trading days, strategy and volumes, prices, portfolio, balancing, managing the wallet) and shows a plain-English estimate from the same calculation. "Skip the questions" on question 1 shows an example estimate from typical answers, marked as for show only.
- **Between the two:** "Detailed calculation" under "Trading collateral at ECC" opens the limit calculator prefilled with the estimate's collateral, split, base limits, open risk and week; "Use in the wallet estimate" on the limit calculator carries a setup back. Values travel in the link after the `#` (nothing is stored); the estimate keeps its answers there too, so Back reopens it. The links only show where the other page is reachable (the hosted site, or `dist/` on disk).

      npm test          # ECC's worked examples, engine snapshot, markets, ECC dist hashes, wallet tests
      npm run build     # writes dist/ (all pages)
      npm run test:ui   # headless checks of the built pages
      npm start         # serves dist/ on $PORT (default 3000): /, /estimate, /limits, /wallet

**Hosting (Railway or any Node host):** `npm start` runs `scripts/serve.js`, which uses only Node's built-in modules. It serves the landing page at `/`, the prospect questionnaire at `/estimate` and the limit calculator at `/limits`. The full wallet calculator at `/wallet` is for Direct+ staff: it is only served when `WALLET_PASSWORD` is set, behind a browser login with user name `WALLET_USER` (default `directplus`). The build runs on deploy, and `dist/` is committed as well.

- How the limits are modelled: `docs/model.md`
- The wallet: brief `docs/wallet-brief.md`, model `docs/wallet-model.md`
- What ECC and TenneT have not confirmed: `docs/open-questions.md`
- Sources: `docs/sources.md`
- Working rules for Claude Code: `CLAUDE.md`

These are explanatory tools, not ECC's or TenneT's calculations. Their own figures are what count.
