# Direct+ limit calculator and wallet calculator

Two single-file calculators for Direct+ members clearing with ECC as Direct Clearing Participants:

- **Limit calculator** (`src/engine.js`, `src/page.html`): collateral to trading limit and back, for EPEX continuous and day-ahead. GO auctions are left out for now (see `TASKS.md`).
- **Wallet calculator** (`src/wallet/`): how much money a member needs, in which part of the Direct+ wallet, and by when (Direct+ works with cash only). It covers ECC collateral and settlement, TenneT BRP security and imbalance invoices. Every assumption can be changed on its Settings page.
- **Prospect questionnaire** (`src/wallet/prospect.html`): a shareable page that asks seven questions (type, markets, volumes and strategy, prices, assets, balancing, funding) and shows a plain-English estimate from the same calculation.

      npm test          # ECC's worked examples, engine snapshot, markets, ECC dist hashes, wallet tests
      npm run build     # writes dist/ (all pages)
      npm run test:ui   # headless checks of the built pages

- How the limits are modelled: `docs/model.md`
- The wallet: brief `docs/wallet-brief.md`, model `docs/wallet-model.md`
- What ECC and TenneT have not confirmed: `docs/open-questions.md`
- Sources: `docs/sources.md`
- Working rules for Claude Code: `CLAUDE.md`

These are explanatory tools, not ECC's or TenneT's calculations. Their own figures are what count.
