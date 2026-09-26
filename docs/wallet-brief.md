# Brief v2: Direct+ wallet calculator

For Claude Code, in the `direct-plus-limits` repo. Start with: *"Read docs/wallet-brief.md and do Phase 0."*

This brief is a specification, not a design to accept as-is.
- **ASK** means stop and ask Niki.
- **ASSUMPTION** means build it as a visible, editable setting, never a hidden constant.
- **INTERPRETATION** means the source text allows more than one reading. Implement the stated reading behind a setting and list it in `docs/open-questions.md`.

Legal and ECC texts are in `reference/`. Work from those texts, not from this brief's paraphrase, and read §10 (traps in the sources) before you start.

---

## 1. Goal and audience

Build the **Direct+ wallet calculator**: a single-file HTML page for Direct+ members and prospects that answers:

> *How much money do I need, in which account, in what form (cash or bank guarantee), and by which moment, to trade the way I plan to through Direct+?*

Direct+ is EPEX SPOT's pilot combining ECC direct clearing (DCP), an e-wallet and a BRP service in the Netherlands. There are three member types: financial traders, aggregators and asset-controlling parties. Members set their clearing settings (collateral, base limits, split between markets) in the Direct+ platform, and can change them daily.

Every number carries a **confidence label**:
- **ECC rule**: published ECC rules applied to the inputs.
- **TenneT rule**: the Systeemcode text in force today.
- **Draft rule**: the ACM draft, not yet in force.
- **Estimate**: follows from assumed trading behaviour.
- **Direct+ contract**: depends on Direct+ terms not yet fixed.

The total is shown as a range (expected to stress), never as one precise figure.

## 2. Hard constraints: the ECC calculator stays standalone and unchanged

- **Output files:** `dist/direct-plus-limit-calculator.html` and `dist/standalone/direct-plus-limit-calculator.html` keep **their paths and their bytes**.
  - Add `tests/ecc_dist_unchanged.test.js`. It builds the ECC outputs **into a temporary directory** and compares their SHA-256 with `tests/golden/ecc_dist.sha256`.
  - Re-record the hashes only on purpose, with the reason in the commit message.
  - The claude.ai publishing flow and the member deck depend on these files.
- **Engine:** **do not edit `src/engine.js` in this project, and do not move it or `src/page.html`.**
  - The build inlines `engine.js` verbatim into the ECC pages, so any edit changes their bytes.
  - The member deck keeps a copy of `engine.js`.
  - The existing tests require it at `../src/engine.js`.
  - If an engine change seems unavoidable, **ASK** first.
- **Wallet code:** lives in `src/wallet/` and uses only the engine's public API (`day`, `week`, `weekDays`, `solve`, `binding`, `cheapestKey`, `parse`, `iso`, `isBD`, `nextBD`, `prevBD`, `holidayName`, `MIN_DATE`, `MAX_DATE`).
- **Calendar:** the engine's calendar runs `MIN_DATE`–`MAX_DATE` (currently 2026-01-01 to 2027-12-24), with T2 holidays hard-coded. The wallet only offers dates in that range. Extending it means an engine change, so **ASK**.
- **Existing tests** (`ecc_examples`, `snapshot`, `ui_smoke`) pass unchanged throughout.
- **Build:**
  - `npm run build:ecc` gives today's output.
  - `npm run build:wallet` writes `dist/wallet/direct-plus-wallet-calculator.html` and `dist/wallet/standalone/…`.
  - `npm run build` runs both.
- **Both pages:**
  - single self-contained files: inline JS and CSS, Google Fonts only, no framework, no browser storage for anything that matters;
  - the wallet page inlines the **same** `engine.js` file, never a copy.

## 3. The wallet: four purposes, several accounts

Show the result **by purpose** and **by account**. Which accounts Direct+ uses is **ASK** (Q2), so the purpose-to-account mapping is a config table, within these fixed constraints:

| Purpose | Account | Form | Fixed constraint |
|---|---|---|---|
| 1. ECC trading collateral | ECC (form O10) | cash or bank guarantee | Guarantee-only collateral is capped at €40m. Above that, 50% of the excess must be cash. |
| 1b. ECC default-fund contribution (only when a guarantee is posted) | collected via the connected account | cash | "a minimum of … 4% of the guarantee value", plus possible stress-test add-ons |
| 2. ECC settlement | the DCP's **connected bank account** | cash | ECC: "The account is on the name of the applicant. The account will be used exclusively for ECC clearing." Cash collateral and clearing-fund payments also run through it. |
| 3. BRP security | TenneT: account balance and/or bank guarantee | either (see Part 3 for the current rule) | held by whoever is the BRP |
| 4. Imbalance and reconciliation invoices | TenneT account balance | cash | debited by TenneT |

The ECC connected account cannot be pooled with the TenneT account. It can be "Direct+'s" only if Direct+ is the DCP, not the member.

### Part 1: ECC trading collateral (ECC rule for the conversion; Estimate for the targets)

The engine turns limit **targets** into collateral. What's new is (a) deriving the targets from behaviour and (b) feeding in **open risk from Part 2 day by day**.

**(a) Targets.** Use ECC's exchange-side rules (Risk Management Services Manual v056, `reference/ecc/`). The manual is informational; the binding rules are the EPEX Market Rules and ECC's Clearing Conditions.

- **Continuous (§3.11, EPEX_CONTINUOUS_EUR):**
  - The limit caps the member's **net** financial position between two booking cuts (16:00 CET on ECC business days). A weekend or T2 holiday gives one long period of 3, 4 or 5 days.
  - A buy at a positive price uses limit; a sell at a positive price gives it back. Orders that may pay the member (sell > 0, buy < 0) are risk-free.
  - **Risk-bearing** resting orders (buys at positive prices, sells at negative prices) also use limit.
  - The limit covers **all M7 delivery areas except GB, for EPEX and SEMOpx combined, including trade registration (OTC)**. The inputs are NL-only, so say so on the page.
  - **One definition of the target per period:** `max(gross buy value × (1 − s), running peak of the cumulative net position) + resting risk-bearing order value`. Here `s` is the share of buy value already offset by sells when the position peaks (ASSUMPTION, **default 0**, conservative).
  - Test: buy 1,000 MWh at €80, then sell it back, with s = 0 → **€80,000**, not 0.
- **Auctions (§3.10, EPEX_AUCTION_EUR):**
  - One limit per auction day, 16:00 to 16:00, across all delivery areas.
  - Exchange-side, it covers day-ahead **and intraday auctions**. That the DCP limit works the same way is an ASSUMPTION until ECC confirms (repo open question 4).
  - An order's exposure is the **largest price × quantity** on its curve; only positive exposure counts. A sell at a negative price has positive exposure, capped at the *minimum* realistic price if one is set.
  - Orders without a limit price count at the market maximum unless a realistic price range is set (**ASK**, Q9). Both the maximum and the minimum price are settings; don't hard-code values.
  - After each auction, order exposure is released and trade value debited. The remainder serves the next auction the same day.
  - Whether sell trades credit the auction limit is not stated (**ASK ECC**, Q10). Default: no credit.
- **Base limits** (business day and non-business day) must cover:
  - risk-bearing orders resting at 16:00, including weekend orders placed on Friday;
  - **plus the expected net buy value traded between 16:00 and the evening update** (ECC deck p.2: 16:00 until "approximately 18:00–19:00 CET on best effort basis").
  - The update time is an input: default 18:00, to match the member deck's "around 18:00, best effort", with 19:00 in the stress case. Don't show other times on the page.
  - The member can override the base limits.

**(b) Open risk from settlement.**
- The engine's evening calculation subtracts `OR`, meaning purchases not yet paid: `excess = C − BLR − OR` (`engine.js`, `docs/model.md`).
- For the wallet, `OR(D) = max(net payable of the booking window closing on D at 16:00, 0)`, taken from `settlement.js`. After a weekend or holiday, OR covers 3–5 days of net buying. For example, Tuesday 30 March 2027's evening calculation carries the window from Thursday 25 March 16:00 to Tuesday 30 March 16:00.
- The engine's `solve` holds OR constant across days, so write the solver in `src/wallet/ecc-link.js`:
  - reproduce the engine's `meets()` logic (base limit covered, continuous measure, every auction);
  - call the public `day(d, {C, OR: OR[d], cont, da})` for each day;
  - bisect on C.
- **Tests:**
  - With a constant OR it must return exactly what `E.solve` returns for the same inputs.
  - On a Monday, OR covers three days.
  - With OR = 0 vs €100k, the deck example's cheapest-split collateral is €502,986 vs €602,986.

**Collateral form and caps:**
- With a guarantee, add the default-fund contribution (1b). ECC's daily stress test can add more; show that as a possible add-on, not a number.
- Cap limit: optional input, off by default. ECC sets it per member at KYC and reviews it yearly.

**Settings changes:** don't model ECC's O09 timing. Direct+ members change settings in the Direct+ platform, which may work differently (**ASK**, Q8).

### Part 2: ECC settlement cash (ECC rule for the timing; Estimate for the amounts)

Sources:
- *Connected Bank Account Setup, DCP, EUR/GBP 2025/2026* (`reference/ecc/`):
  - "all trades conducted before 4 PM CET are settled in the next morning";
  - an MT101 is sent "at the end of the business day (6 PM CET) with value date the next business day";
  - ECC must receive the money "before 8 AM (EUR)";
  - the same cycle settles trades, "all stock exchange fees, all ECC fees, cash collaterals and clearing funds".
- ECC's DCP Payments page: "commodity amounts from all trades are netted into a single net payment amount per DCP member and Connected Bank", on T2 operating days.

Model:
- **Booking windows:** trades in [previous business day 16:00, business day D 16:00) → one net amount.
  - **Fund the account by D 18:00**, when the MT101 can be executed.
  - The value date is `nextBD(D)`, and ECC receives the money before 08:00.
  - Show all three moments on the timeline.
- **Net amount:** Σ buys × price − Σ sells × price, plus fees, clearing fund and cash-collateral changes. **Negative prices flip the sign.**
- **Cash need = the peak cumulative net outflow over the horizon**, given a replenishment setting (none, daily or weekly; ASSUMPTION, default none). It is not the largest single collection.
- **Holiday stacking example:** Good Friday 26 March and Easter Monday 29 March 2027 are ECC holidays.
  - The window closing Thursday 25 March 16:00 has value date Tuesday 30 March.
  - The window closing Tuesday 30 March 16:00 covers about five days of trading and has value date Wednesday 31 March.
- **Missed payments:** what happens after a missed collection is governed by ECC's Clearing Conditions, which are not in the pack. Never model it as an allowed state, and never use `OR` for it.
- **Fees:** inputs with no defaults until Niki provides them (**ASK**, Q7).
- **Aggregators:** ECC settles only the exchange leg. Whether the wallet also funds the bilateral leg is **ASK** (Q6).

### Part 3: BRP security for TenneT (TenneT rule or Draft rule; Direct+ contract for the member's share)

Two texts are in `reference/tennet/`. Implement both behind a **rule selector keyed on the calculation date**, with a manual override. The draft takes effect on 1 January 2027 once ACM's decision is final (**ASK**, Q3).

**In force now:** Systeemcode elektriciteit 2026, art. 10.8, in `art-10.8-current.md`.
- **A** = the highest net transaction volume (MWh) with **any single other BRP** in one calendar day, × the average market price over the past **three months**, with a price floor of €40/MWh.
  - Volume window: **six weeks**.
  - An increase (para 5, on TenneT's request) uses the **highest** daily volume in the six weeks.
  - A reduction (para 6, on the BRP's request) uses the **average of the daily highs** over the six weeks, with a 50 MW floor.
  - The first calculation (para 3) uses the **expected** volume, with a 50 MW floor.
  - Show A_up and A_down, labelled by who triggers them.
- **B** = capacity of large connections × 24 × the same price.
  - Capacity is counted by class (paras 8–11): each connection of 2–10, 11–25 or 26–50 MW counts at the **lowest value of its class**; above 50 MW counts actual capacity. Floor 50 MW.
  - Inputs: number of connections per class, and actual MW above 50.
  - Flag how connections under 2 MW and between classes (e.g. 10.5 MW) are treated.
  - Test: three 30 MW connections count as **78 MW**.
- **Security** = **2A if 2A ≥ B, otherwise A + B** (para 13).
- **Form:** a bank guarantee, optionally supplemented by a TenneT-held deposit (para 1).
- **Minimum:** TenneT's BRP page states a €96,000 minimum and recalculation every six weeks. ACM's decision (para 35) says TenneT recalculates monthly in practice.
  - INTERPRETATION: 96,000 = 2 × 50 MW × 24 h × €40, so the 50 MW floor probably means 1,200 MWh/day. In that reading the effective minimum rises with the price (€192,000 at €80).
  - Support for this reading: the 2025 proposal (p.3) says the current rule floors the components separately, and the new minimum is "ongevoelig voor marktbewegingen".
  - Build a toggle: "1,200 MWh reading" vs "flat €96,000 minimum". Ask Niki for TenneT's formula document "TenneT inzake rekening", which the BRP page cites but doesn't link (Q14).

**Draft from 1 January 2027:** ACM corrected draft decision of 25 August 2026, in `art-10.8-draft-2027.md`.
- **Security** = **3A + 4B + 6C + 6D, minimum €96,000**, recalculated **monthly**.
- **A** = the **realised** highest daily net volume with another BRP over the past two months × the average day-ahead reference price over those two months. No floors. The "first time uses expected volume" rule is gone.
- **B** = average **weekly** imbalance invoice over 10 weeks + 2σ.
- **C** = average **monthly** reconciliation invoice for **profile allocation** (art. 10.26) over 12 months + 0.5σ.
- **D** = the same for **smart-meter allocation and telemetry-metered connections** (art. 10.27).
- Missing weeks or months count as €0 invoices (para 6).
- Components are **not floored at zero**. A BRP that mostly receives imbalance money can have a negative B, and the 2025 proposal says negative components may offset others. Only the total has a minimum.
- **Ramp-up** (a new BRP; for a new member only in Mode 1 below):
  - A = 0 at first, so the first calculations give the €96,000 minimum.
  - The first imbalance invoice arrives about 4 weeks after the first delivery (ACM para 15). Profile reconciliation starts around month 5, smart-meter/telemetry around month 6 (ACM paras 16–17).
  - Because missing invoices count as €0, **B does not rise steadily**. With a constant invoice, B peaks at about 1.618× its steady-state value, with about 7 of 10 real invoices. For C and D the peak is about 1.055×.
  - Show a monthly series (months 1–18) with its maximum.
- **Profile reconciliation (C) may be zero for new connections:** since 1 May 2026, collective smart-meter allocation (cSMA) replaces profile allocation (ACM para 29). **ASK**, Q15.

**NEMO:** a BRP that is a designated NEMO (on the CACM art. 4(10) list) posts security of **€100,000** instead (current para 14, draft para 8).

**Unclear points.** Each is a setting and goes in `docs/open-questions.md`:
- **A, per period:** (i) |Σ over the day's periods of net volume| or (ii) Σ over the day's periods of |net volume|. It matters a lot for traders who buy and sell the same day.
- **A, counterparties:** the maximum over single counterparties (supported by the current text, "enige andere", and the proposal, "met één andere BRP"), or the total across counterparties. For aggregators, bilateral nominations and the exchange are separate counterparties.
- **σ:** population or sample. With 10 invoices, the sample value is 5.4% larger.
- **Price:** which "market price" or "day-ahead reference price". Default: the arithmetic mean of NL day-ahead prices over the period.
- **Invoices** are signed: positive means the BRP pays.

**How BRP security reaches a member is a Direct+ design question** (**ASK**, Q1). Build three modes and don't choose one yourself:
1. **Standalone:** as if the member were its own BRP. Use it for comparison ("what you'd post without Direct+"). The ramp-up applies.
2. **Share of the Direct+ BRP:**
   - The BRP's security is computed on the **aggregate** portfolio. Imbalances and exchange positions net inside it, and the minimum or NEMO amount applies **once per BRP**.
   - Multiply by a sharing key: volume share, imbalance share or equal split.
   - A new member joins an existing history, so there is no ramp-up.
3. **Contract:** a fixed or tiered amount from the Direct+ pricelist.

### Part 4: TenneT account cash for invoices (Estimate)

- **Timing:**
  - Imbalance is invoiced **weekly**, about **four weeks after delivery** (ACM para 15), and debited from the BRP's TenneT account (TenneT BRP page, "automatische incasso").
  - Reconciliation tails: profile up to **21 months** after delivery, smart-meter/telemetry **6 months** (ACM paras 16–17).
  - Payment dates:
    - Current 10.26(5): the first Tuesday after the statement; the following Tuesday if there are no more than three working days in between.
    - Draft 10.26(5): the first Tuesday, with no exception.
    - TenneT pays out on the Wednesday.
    - 10.27: the first working day of the sixth month after the reconciliation month.
    - Key these on the date, like the rule selector.
- **Calendar:** Dutch working days for TenneT deadlines are **not** ECC's T2 calendar. Keep a separate Dutch calendar and get the holiday list confirmed (Q11).
- **Account vs security.** The draft (paras 9–10) requires enough balance for the weekly and monthly invoices, and enough security after they are paid. INTERPRETATION, implemented as:
  - process debits in date order;
  - `balance before a debit ≥ max(invoice, 0)`;
  - `balance after the debit + guarantee ≥ security`.
  - For the current rule, treat invoice cash and security as additive. That gives the same total; it only changes the split by account.
- **Imbalance invoice model (signed), per settlement period:**
  - Short volume is charged at the short price; long volume is credited at the long price. The prices depend on the regulation state (current art. 10.29):
    - state −1: both sides at the *afregelen* (downward) price;
    - state +1: both at the *opregelen* (upward) price;
    - state 0: both at the mid price;
    - **state 2: short pays max(mid, upward); long receives min(mid, downward)**.
  - It is the **full** imbalance price, not a spread against day-ahead. Negative prices flip the flow.
  - The weekly invoice is the sum over the week.
- **Exit tail:** after a member or the BRP stops, security and cash stay committed until the last invoices are settled (draft para 10(c)): about 4 weeks for imbalance, up to 21 months for profile, 6 for smart-meter/telemetry reconciliation. Show this on the page.

## 4. Trading behaviour (the requested assumptions)

Inputs a prospect can fill in within about two minutes, plus an "advanced" section:
- **Markets:** EPEX continuous NL; EPEX day-ahead + intraday auctions NL.
- **Volumes and prices:**
  - gross buy and sell MWh per day per market;
  - weekend and holiday trading on/off;
  - typical price and stress price;
  - share of hours with negative prices.
- **Timing:**
  - the offset share `s` (Part 1);
  - resting risk-bearing orders over 16:00;
  - net buying between 16:00 and the evening update.
- **Imbalance:**
  - expected imbalance as % of traded or nominated volume, with its bias (short or long) and volatility;
  - imbalance prices: share of periods in each regulation state, and each price's deviation from day-ahead (mean, volatility).
  - Label the normal model: it understates NL imbalance-price tails.
- **Aggregators:**
  - MWh per day nominated in from other BRPs;
  - non-delivery rate. By contract, the aggregator carries imbalance from non-delivery.
- **Connections in the Direct+ BRP:** none / smart-meter / telemetry-metered / profile, plus capacity per class for the current rule's B. These drive B (current), and C and D (draft). Never hide them as a zero.
- **Presets** for the three member types. In Phase 0, propose values with a one-line rationale each, for Niki to approve. Each shows as "assumed" on the page.

Two ways to compute the Estimate parts:
- **Parametric** (default):
  - Work directly with **weekly invoice totals** (μ_w, σ_w).
  - Deriving σ_w from per-period statistics as if the periods were independent understates it.
  - B is a 10-sample statistic, so the stress end comes from a seeded Monte Carlo (e.g. mulberry32) over 10-week windows.
- **Replay:** the member loads CSVs locally (a file input; no upload, no storage):
  - NL day-ahead prices;
  - TenneT imbalance data per period: regulation state, upward, downward and mid price;
  - or their own invoice or volume history.
  - The engine then computes everything from the real series.

## 5. Conventions

- **Amounts:** EUR. **Sign:** positive means money the member pays, or cash that must be available.
- **Times:** CET/CEST as ECC and TenneT state them. Dates as ISO `YYYY-MM-DD`.
- **Code:** plain ES5-compatible JS in the style of `engine.js` (an IIFE with `module.exports` for node, no dependencies). Modules:
  - `behaviour.js`: inputs → daily flows, volumes, imbalance series;
  - `settlement.js`: windows, value dates, cash path, OR per day;
  - `ecc-link.js`: targets, the per-day OR solver, collateral;
  - `brp.js`: both rules, NEMO, the three modes, ramp-up;
  - `tennet-account.js`: invoices, calendars, the account/security check;
  - `wallet.js`: combines everything.
- **Rule parameters** (multipliers, σ factors, floors, windows, minimums, NEMO amount, dates) live in one config object per rule version. Every entry carries its source: document, article, paragraph, and line where useful.
- **Money in tests:** compare with |Δ| < €0.005. Round only final amounts, never intermediates.

## 6. The page

- **Top:** the total wallet as a range. A stacked bar by purpose, with a toggle to show it by account. Each block has its confidence label and "cash only" or "cash or guarantee".
- **Per part:** the main driver in one sentence, and the one or two inputs that would lower it most.
- **Timeline:** for the chosen week or holiday period: ECC limit; settlement funding deadlines (D 18:00), value dates and amounts; TenneT debit dates; the cash balance under the replenishment setting.
- **BRP view:** the rule in force on the chosen date; the ramp-up series (months 1–18, with its peak); the pass-through mode; the exit tail. Optional (**ASK**, Q12): "standalone BRP vs through Direct+".
- **Sensitivity:** the total at ±50% volume, at the stress price, and with imbalance at 2× the assumption.
- **Assumptions and sources:** generated from the inputs, each with its label and source.
- **Tone:** plain English, as on the ECC page. It must not read as advice. ECC's and TenneT's own figures are what count.

## 7. Phases, gates and done-criteria

**Phase 0: understand and ask (no code).**
- Read `CLAUDE.md`, `docs/`, this brief and `reference/`, including §10.
- Ask the gate questions (Q1–Q5).
- Write `docs/wallet-model.md`: every formula with its source, the module layout, the preset proposals, and one fully worked example done by hand (a financial trader, one week, all four parts).
- **Stop until Niki approves.**

**Phase 1: set up, and prove nothing changed.**
- Add the ECC dist-hash test and split the build scripts.
- Done when all existing tests pass, the hashes match, and `git status` shows no change to `dist/` after `npm run build`.

**Phase 2: behaviour, settlement and the ECC link.** Done when tests cover:
- the continuous target (buy 1,000 MWh at €80 and sell back, s = 0 → €80,000);
- the auction max(p × q) rule, including a no-limit-price order at the configured maximum, the realistic-price cap, and a sell at a negative price;
- a negative-price day in settlement;
- value dates: the window closing Friday 2 October 2026 → Monday 5 October; closing Monday 5 October → Tuesday 6 October; closing Thursday 25 March 2027 → Tuesday 30 March; closing Tuesday 30 March 2027 → Wednesday 31 March;
- the cash path with and without replenishment;
- the per-day OR solver: it matches `E.solve` at constant OR; the Monday case; €502,986 vs €602,986 for the deck example at OR 0 vs €100k (inputs of the `week-oct5-cont150-da100` case in `tests/golden_cases.js`).

**Phase 3: BRP rules.** Done when these pass. They were checked by hand; if the code disagrees, recheck both before changing either.

| Case | Inputs | Expected |
|---|---|---|
| Draft, positive B | A = 300 MWh × €80 = €24,000. Ten weekly invoices alternating €2,000 / €8,000. C = D = 0. Population σ. | B = 5,000 + 2 × 3,000 = 11,000. Total 72,000 + 44,000 = **€116,000** |
| Draft, sample σ | as above | σ = 3,162.2777, B = 11,324.5553, total **€117,298.22** |
| Draft, negative B | A = 400 × €80 = €32,000. Invoices alternating −€1,500 / −€2,500. Population σ. | B = −1,000. 3A + 4B = 92,000, so the **€96,000** minimum applies |
| Draft, ramp-up (1) | invoices [2,000, 8,000, then 0 × 8], population σ | mean 1,000, σ 2,408.32, **B = 5,816.64** |
| Draft, ramp-up (2) | invoices [10,000 × 7, then 0 × 3], population σ | **B = 16,165.15** (steady state is 10,000) |
| NEMO | any | **€100,000** under both rules |
| Current, 1,200 MWh reading | expected 500 MWh/day, 3-month average €80 | A = 1,200 × 80 = 96,000. 2A = **€192,000** |
| Current, price floor | 1,200 MWh, average €35 | A = 1,200 × 40 = 48,000. **€96,000** |
| Current, large connections | A = €50,000, B = €150,000 | 2A < B, so **€200,000** |
| Current, capacity classes | three connections of 30 MW | counts **78 MW** |

- Also test: A_up vs A_down on a six-week series; the A-per-period toggle (i vs ii) on a day with buys and sells in different periods; the counterparty toggle.

**Phase 4: TenneT account and imbalance.** Done when tests cover:
- dual pricing in state 2: mid 100, upward 120, downward 60 → short pays **120**, long receives **60**; with mid 150 → short pays **150**;
- the account/security check in date order, with and without a guarantee, including a credit invoice;
- the Dutch working-day shift of the Tuesday/Wednesday dates, in both the current and the draft version;
- a seeded Monte Carlo reproducing its snapshot.

**Phase 5: the wallet page.**
- Build both pages. Add `tests/ui_smoke_wallet.py`: no console errors, and each preset shows a total.
- Both standalone files open from disk.

**Phase 6: documentation.**
- Update `docs/model.md`, `docs/open-questions.md` and `docs/sources.md`, and add a wallet section to `CLAUDE.md`.
- Confirm that the member deck's engine copy is unaffected.

## 8. Questions for Niki

**Gate questions.** Don't build the affected part without an answer.
1. **BRP:**
   - Who holds the Direct+ BRP recognition (EPEX SPOT, the partner, another party)?
   - Is it the recognition EPEX SPOT holds as NEMO (€100,000 under current para 14 / draft para 8)?
   - Who is the counterparty BRP for EPEX trades in NL?
   - Which pass-through mode applies to members? *(Part 3)*
2. **Accounts:**
   - Is each member its own DCP with its own connected account? ECC requires the account to be in the applicant's name and used only for ECC.
   - What does "the wallet" mean in practice: the ECC collateral, the connected account, the TenneT account or guarantee, or a Direct+ account that funds these? *(All parts)*
3. **Rule timing:** use the draft from 1 January 2027 for dates in 2027 until ACM decides? *(Part 3)*
4. **Imbalance allocation:** does each member pay its own imbalance and reconciliation, or a share of the portfolio's? *(Part 4)*
5. **Presets:** approve the Phase 0 proposals. *(§4)*

**Can proceed with a visible default:**

6. Aggregators: does the wallet fund the bilateral (non-exchange) leg?
7. Fees: ECC, EPEX, Direct+ pricelist.
8. Do ECC's O09 timing and any per-adjustment fee apply to changes made in the Direct+ platform?
9. Realistic price range for auctions (minimum and maximum), and the maximum price used for orders without a limit price.
10. Does a sell trade in an auction credit the auction limit? (For ECC.)
11. TenneT's weekly invoicing calendar, and the Dutch working-day list it uses.
12. Show "standalone BRP vs through Direct+" on a member-facing page?
13. VAT: is any flow not reverse-charged for some member types?
14. TenneT's "inzake rekening" document: the formula it actually applies today, including the minimum and the recalculation frequency.
15. Can new connections in the Direct+ BRP still be profile-allocated after cSMA (1 May 2026), or is C always zero?

## 9. Sources (in `reference/`, or linked in `docs/sources.md`)

**ECC**
- Risk Management Services Manual v056: §3.10 auction (pp. 24–26), §3.11 continuous (pp. 27–28).
- DCP client deck, July 2025: p.2 base limit window, p.3 settlement.
- Excel limit tool and its extracted VBA.
- *Connected Bank Account Setup DCP 2025/2026*: settlement timing and account requirements.
- DCP risk-management page (collateral, the €40m guarantee limit, default fund, cap limit): https://www.ecc.de/en/access/dcp-clearing-members/dcp-risk-management
- DCP payments page (16:00 cut, 08:00, net payment per member, T2 days): https://www.ecc.de/en/access/dcp-clearing-members/dcp-payments

**TenneT and ACM**
- Systeemcode elektriciteit 2026, chapters 10–11, comparison document (the current art. 10.8, 10.26, 10.27, 10.29).
- ACM corrected draft decision of 25 August 2026, ACM/25/196985: the draft articles, and the explanatory notes paras 15–17 (invoice lags), 29 (cSMA) and 35 (monthly recalculation).
- System operators' proposal BR-2024-2077 of 2 July 2025: rationale, negative components, invoices outstanding on exit.
- TenneT BRP page (€96,000 minimum, six-weekly recalculation, account and direct debit): https://www.tennet.eu/nl/aanvragen-brp-erkenning

## 10. Traps in the sources

- **The proposal BR-2024-2077 uses the old Netcode:**
  - Its "Artikel 10.27" is *profile* reconciliation. In the Systeemcode 2026 and the ACM draft, 10.26 is profile and 10.27 is smart-meter/telemetry.
  - It labels its components differently from the draft.
  - It proposes 2σ for reconciliation; **ACM changed that to 0.5σ**.
  - The draft's formula is 3A + 4B + 6C + 6D. The proposal's annex shows A + 4B + 6C.
- **The Systeemcode comparison PDF has three columns:** old text with pending changes, **current text**, and notes. `pdftotext` interleaves them. Use `reference/tennet/art-10.8-current.md` or crop the right-hand column.
- **The ECC manual is informational.** The binding texts are the EPEX Market Rules and ECC's Clearing Conditions, which are not in the pack.
- **The ECC deck's "once a month" for GO auctions is out of date** (not in scope here, but don't reuse it).
