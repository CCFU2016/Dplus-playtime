# Direct+ limit calculator

Collateral to trading limit and back, for Direct+ members clearing with ECC as Direct Clearing
Participants. Covers EPEX continuous and day-ahead today; GO auctions are next (see `TASKS.md`).

    npm test          # ECC's worked examples + engine snapshot
    npm run build     # writes dist/
    npm run test:ui   # headless check of the built page

- How the limits are modelled: `docs/model.md`
- What ECC has not confirmed: `docs/open-questions.md`
- Sources: `docs/sources.md`
- Working rules for Claude Code: `CLAUDE.md`

This is an explanatory tool, not ECC's calculation. ECC's figures in the ECC Member Area are what count.
