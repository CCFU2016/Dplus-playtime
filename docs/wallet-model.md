# Direct+ wallet calculator: model

Written as Phase 0 of `docs/wallet-brief.md` (26 September 2026). Built through Phase 5 on the same day: the code is
in `src/wallet/`, and the page (`dist/wallet/`) has a Settings view with every assumption below. Niki's answers to
the gate questions are in section 11.1.

**Choices made while building** (beyond the sections below):
- Auction sell orders are assumed to carry a limit price of €0 or more, so in parametric mode they add no exposure.
- The expected end of B uses μ + 2σ of the weekly model whichever σ type is set. The σ setting affects the ramp-up series and real invoice histories.
- The ramp-up series takes k real invoices of mean μ and spread σ, the rest €0, at their expected mean and spread (`brp.js`, `rampUp`). With σ = 0 this is the constant-invoice window of section 4.2.

The page answers: *how much money do I need, in which account, in what form (cash or bank guarantee), and by
which moment, to trade the way I plan to through Direct+?* This document gives every formula the wallet will use
and where it comes from, the presets, and one example worked through by hand. Section 10 lists where the brief and
the source texts differ. Section 11 holds the questions only Niki can answer.

**Labels.** Every amount carries one of the brief's labels:
- **ECC rule**
- **TenneT rule** (the Systeemcode in force)
- **Draft rule** (ACM draft)
- **Estimate** (follows from assumed behaviour)
- **Direct+ contract**

Settings are marked **ASSUMPTION** (a visible, editable default) or **INTERPRETATION** (one reading of an ambiguous
text, to be listed in `docs/open-questions.md` in Phase 1).

**Conventions.**
- Positive means money the member pays, or cash that must be available. EUR.
- Times are CET/CEST, as ECC and TenneT state them.
- Quotes are verbatim; Dutch is quoted in Dutch.

**Sources** (all in `reference/`, retrieved or checked 26 September 2026):

| Short name | File | What it is |
|---|---|---|
| Manual | `ecc/ECC_Risk_Management_Services_056_valid_from_20260701.pdf` | ECC Risk Management Services Manual, release 056 (informational; the binding texts are the EPEX Market Rules and ECC Clearing Conditions, not in the pack) |
| Deck | `ecc/20250507_DCP_Client_second_Introduction_Slidedecks.pdf` | ECC DCP client deck, July 2025 |
| CBA | `ecc/ecc_connected-bank-account-setup-dcp-eur-gbp-2025-2026_2025-12-08.pdf` | ECC, *Linking a Connected Bank Settlement Account with ECC, EUR+GBP, 2025/2026* |
| ECC risk page | `ecc/web_dcp-risk-management_2026-09-26.txt` | ecc.de DCP Risk Management page (snapshot) |
| ECC payments page | `ecc/web_dcp-payments_2026-09-26.txt` | ecc.de DCP Payments page (snapshot) |
| SC 2026 | `tennet/systeemcode-elektriciteit_wetten-overheid_art-10.8-10.26-10.27-10.29_2026-09-26.txt` | Systeemcode elektriciteit 2026, text in force since 9 July 2026, from wetten.overheid.nl (BWBR0052336) |
| SC comparison | `tennet/acm_systeemcode-elektriciteit-2026-h10-h11_vergelijking_BR-2025-2203_2026-02-20.pdf` | ACM comparison document, chapters 10–11 (Feb 2026 snapshot; SC 2026 above is the current consolidated text) |
| ACM draft | `tennet/acm-25-196985_gecorrigeerd-ontwerpbesluit_2026-08-25.pdf` | ACM corrected draft decision ACM/25/196985, 25 Aug 2026 (the uncorrected 17 Aug version is kept next to it, but superseded) |
| Proposal | `tennet/nbnl_BR-2024-2077_codewijzigingsvoorstel-financiele-zekerstelling-brps_2025-07-02.pdf` | System operators' proposal BR-2024-2077, 2 July 2025 |

**Not retrieved:**
- TenneT's BRP page (tennet.eu blocks automated access).
- TenneT's "inzake rekening" document.
- TenneT's billing terms for weekly imbalance invoices.

See section 11.

---

## 1. Module layout

All wallet code lives in `src/wallet/`. It uses only the engine's public API, in its two-market form
(`day(d, { C, OR, cont, da })`, `week`, `weekDays`, `solve`, `binding`, `cheapestKey`, `parse`, `iso`, `isBD`,
`nextBD`, `prevBD`, `holidayName`, `MIN_DATE`, `MAX_DATE`). `src/engine.js` is not edited.

| Module | Job | Uses |
|---|---|---|
| `behaviour.js` | Inputs and presets → per-day trade flows per market (volume, value, risk-bearing value), orders over 16:00, imbalance volumes, weekly invoice parameters | nothing |
| `settlement.js` | Booking windows, funding deadline and value date per window, net amount per window, cash path, `OR(D)` | behaviour, engine calendar |
| `ecc-link.js` | Limit targets per calculation day, base limits, the per-day solver, the split search, collateral form | behaviour, settlement, engine |
| `brp.js` | Current and draft art. 10.8 on the member's own figures (as its own BRP), NEMO, ramp-up series, seeded Monte Carlo for B | behaviour, rule configs |
| `tennet-account.js` | Imbalance and reconciliation invoices, the Dutch working-day calendar, payment dates, the account/security check, exit tail | behaviour, brp |
| `wallet.js` | Totals by purpose and by account, the expected–stress range, sensitivities | all |
| `page.html` | The page, with `/*__ENGINE__*/` and `/*__WALLET__*/` markers | |

- **Style:** every module is an IIFE with `module.exports` for node, ES5, no dependencies, as `engine.js` is.
- **Rule configs:** each rule version (current and draft art. 10.8, current and draft 10.26(5)) is one config object. Every entry carries its source: document, article, paragraph.
- **Build:** `scripts/build.js` is split.
  - `build:ecc` keeps today's output byte for byte.
  - `build:wallet` writes `dist/wallet/direct-plus-wallet-calculator.html` and `dist/wallet/standalone/…`, inlining the same `src/engine.js` file.
  - `build` runs both.
- **Hash test:** `tests/ecc_dist_unchanged.test.js` builds the ECC pages into a temporary directory and compares their SHA-256.
- **Engine version:** the engine on branch `worktree-limits-tasks` (Task 2) also accepts a list of markets. The wallet only uses the brief's list, so either version works. Record the ECC hashes after that branch is merged into `main`, or they will need re-recording.
- **Calendar:** the Dutch calendar, the ramp-up series (18 months) and the exit tail (up to 21 months) run past the engine's `MAX_DATE` (2027-12-24). They don't use ECC business days, so no engine change is needed. The Dutch working-day list must cover 2026–2029.

---

## 2. Part 1: ECC trading collateral

**Label:** ECC rule for turning targets into collateral; Estimate for the targets.

### 2.1 How the engine is used

For each ECC calculation day D, the engine's `day()` gives:
- the base limit at 16:00;
- the limit from the evening update, `l18`;
- the limit after the next morning's settlement, `l09`;
- one limit per auction day up to the next business day.

It computes these from collateral `C`, open risk `OR`, base limits and the split (`docs/model.md`). The wallet supplies:
- per-day targets (2.2, 2.3);
- base limits (2.4);
- per-day open risk (2.5).

It then finds the smallest `C` (2.6).

### 2.2 Continuous target (EPEX_CONTINUOUS_EUR)

**Source:** Manual §3.11, p.27.
- "It is therefore equivalent to the maximum financial amount across delivery areas, up to which the Trading Participant can trade during two consecutive ECC Booking Cuts (currently at 16:00 CET on ECC Business Days). The Trading Participant's net financial position from intraday trading in M7 is thus capped by the Cash Limit."
- "Orders that may result in a payment to the client (Sell at positive price/Buy at negative price), are considered risk-free and are always permitted."
- "When an Order is traded, the overall financial volume of the Trade, calculated as the product of the transaction's volume and price, is added to or subtracted from the Cash Limit."
- The limit covers "all delivery areas tradable in the trading system M7, except the GB market", "the combined exposures of the exchanges EPEX SPOT and SEMOpx", and "both order book trading and trade registration (OTC)".

The page says the inputs are NL only.

**Period.** The limit set by calculation day D serves D 16:00 to `nextBD(D)` 16:00. That is `gap1(D)` calendar days:
1 on Monday–Thursday, 3 on a normal Friday, and up to 5 around T2 holidays.

```
T_cont(D) = max( G(D) × (1 − s), P(D) ) + R_cont
```

- `G(D)` is the **risk-bearing trade value** in the period: buys at positive prices × price, plus sells at negative prices × |price|.
  - The brief says "gross buy value". Negative-price sells are added because §3.11 treats them as risk-bearing; without negative prices the two agree.
  - Weekend and holiday days count only if "weekend and holiday trading" is on.
- `s` is the share of `G` already offset by sells when the position peaks. **ASSUMPTION**, default 0.
- `P(D)` is the running peak of the cumulative net position in the period.
  - Parametric mode has only daily totals, so it uses the peak of the daily cumulative net value, a lower bound on the intraday peak.
  - Replay mode uses the member's own trades.
- `R_cont` is the value of risk-bearing continuous orders resting over 16:00.

**Brief test.** Buy 1,000 MWh at €80 and sell it back, with s = 0: G = 80,000 and P = 80,000, so T = **€80,000**.

**Which limit has to hold it.** The brief doesn't say.
- The evening limit `l18` applies until settlement (deck p.3: "Latest 10:45 CET: The trading limit is updated by adding resolved payment exposure"), and `l09` after that.
- **ASSUMPTION:** `l18 ≥ T_cont(D)`, the cautious reading, because gross buying with s = 0 builds up over the whole period. There is a setting for `l09`.

### 2.3 Auction target (EPEX_AUCTION_EUR)

**Source:** Manual §3.10, pp.24–26.
- "an overall Financial Limit per Trading Participant per auction trading day from 16:00 CET to next auction trading day 16:00 CET across all delivery areas and portfolios".
- "the exposure per order is calculated as the maximum value of (price*quantity) for the complete order. Only orders with a positive exposure are applied against the limit."
- "For orders, which have been submitted without limit price, the maximum price of the respective market area will be applied, unless the Clearing Member has specified a Realistic Price Range."
- "The Trading Limits cover hourly day-ahead as well as any intraday auctions."
- "once a specific auction has taken place … the corresponding exposure from orders is released from the limit and the respective exposure from trades is debited against the Available Limit amount simultaneously. Any residual limit amount remains available for the next auction of the same trading day."
- Realistic Price Range (p.25): a sell below the minimum realistic price counts only down to that price, and a buy above the maximum only up to it. "In case of usage, both values have to be set." Only the Clearing Member can edit it (p.26 table). Whether a DCP counts as its own Clearing Member for this purpose is part of Q9.

**Per order:**

```
exposure = max over the curve of (p × q),  p capped to [p_min_real, p_max_real] if a range is set
```
- q is positive for buys and negative for sells. So a sell at a negative price has positive exposure, and a sell at a positive price has none.
- Orders without a limit price count at `p_max_market`, or at `p_max_real` if a range is set.
- `p_max_market`, `p_min_real` and `p_max_real` are settings with **no built-in values** (Q9).

**Per auction day d:**

```
T_auc(d) = E_DA(d) + E_IDA(d) + V_DA(d)
```
- `E_DA` and `E_IDA` are the order exposures of the day-ahead and intraday auctions in that 16:00–16:00 window.
- `V_DA` is the day-ahead trade value still debited when later IDA orders are placed.
- Sells do not credit the limit (Q10: default no credit).
- ECC's DCP limit covering intraday auctions the same way is an **ASSUMPTION** (repo open question 4).
- In parametric mode, an auction buy is one order: `q_buy × p_limit_buy`. `p_limit_buy` is an input, and "no limit price" means `p_max_market`.

The engine returns one limit per auction date: the one after settlement on a business day, and the shares on
weekends and holidays. The wallet requires each to be ≥ `T_auc` for that date. Weekend and holiday auctions count only
if weekend trading is on.

### 2.4 Base limits

**Source.**
- Deck p.2: "Trading during the limit reset period (between 16:00 CET until approximately 18:00-19:00 CET on best effort basis) is covered by a base limit."
- Deck p.4: "future orders will be deleted if they exceed the Base Limit after 16:00", and "It is not required to have a base limit."

```
BD_cont  = R_cont + N_cont × (t_update − 16:00) / 2 h
NBD_cont = 0                (continuous does not reset on weekends; Friday's 16:00 base limit covers Friday until the update)
BD_auc   = R_auc            (auction orders resting at 16:00)
NBD_auc  = R_auc_weekend    (weekend and holiday auction orders placed on Friday before 16:00)
```

- `N_cont` is the expected net buy value traded between 16:00 and an 18:00 update.
- `t_update` is an **ASSUMPTION**: 18:00, and 19:00 in the stress case.
- The page only ever says "around 18:00, best effort" (CLAUDE.md rule 4).
- Every base limit can be overridden.

### 2.5 Open risk from settlement

`OR(D) = max(net payable of the booking window closing on D at 16:00, 0)`, from Part 2.
- The engine subtracts it in the evening calculation: `excess = C − BLR − OR`, floored at zero (`docs/open-questions.md`, "Settled").
- After a weekend or holiday, OR carries 3–5 days of net buying. For example, Tuesday 30 March 2027 carries Thursday 25 March 16:00 to Tuesday 30 March 16:00.

### 2.6 The solver (`ecc-link.js`)

The engine's `solve` holds `OR` and the targets constant across days. The wallet needs both per day, so it has its own
solver, built on the public `day()`:

```
meets(C, k) = for every calculation day D in the horizon:
                r = day(D, { C, OR: OR(D), cont: {BD_cont, NBD_cont, key: k}, da: {BD_auc, NBD_auc, key: 100 − k} })
                not r.baseUncovered
                and r.cont[measure] ≥ T_cont(D) − 1e-6
                and every auction a in r.da.auctions (weekend ones only if traded): a.limit ≥ T_auc(a.date) − 1e-6
C*(k) = smallest whole euro with meets(C, k)   (doubling from €1m, then bisection)
split = the k in 0..100 with the smallest C*(k); ties go to the member's own split
```

**Per-day targets** are an addition to the brief, which only mentions per-day OR. Without them the Friday period
couldn't ask for three days of continuous trading.

**Split search.** The engine's own `cheapestKey` takes a constant OR, so the wallet scans the 101 splits. That's
fast enough for two markets.

**Tests (Phase 2):**
- With constant OR and constant targets, it returns exactly `E.solve` and `E.cheapestKey`.
- On a Monday, OR covers three days.
- The deck example needs **€502,986 at OR 0 and €602,986 at OR €100k**, both at 33/67. I checked both against the current engine on 26 Sep 2026.

### 2.7 Collateral form, default fund, cap

**Direct+ accepts cash only (Niki, 26 Sep 2026).** The wallet never uses a bank guarantee, so ECC's guarantee cap and
the default-fund contribution below don't apply to Direct+ members. They stay documented here because they are ECC's
rules for DCPs generally, and `ecc-link.js` (`form`) still implements them.

**Source:** ECC risk page.
- **Accepted collateral:** "Cash funds in EUR and GBP" and "Bank Guarantee in EUR and GBP".
- **Guarantee cap:** "there is a bank-guarantee-only collateral limit of currently 40 million EUR … For trading limits exceeding 40 million EUR, the excess amount must be backed by a minimum of 50% in cash collateral."

```
guarantee_max = C                          if C ≤ 40,000,000
              = 40,000,000 + 0.5 × (C − 40,000,000) otherwise
cash_min      = C − guarantee_max
```

**Default fund (purpose 1b).** "A minimum default fund contribution is required of every DCP member … posting
guarantees as collateral … 4% of the guarantee value." It is "cash only" and settled through the connected account
(CBA p.3: "cash collaterals and clearing funds").

```
default_fund ≥ 0.04 × guarantee
```

Stress-test add-ons ("the amount of exceedance is allocated to the DCP member as an additional clearing fund
contribution") are shown as a possible extra, never as a number.

**Cap limit.** The ECC risk page says it's set "as part of the KYC process and reassessed once a year"; deck p.4
says "starting at 3 mio €". It's an optional input, off by default. Collateral above the cap doesn't raise limits.

**Settings changes.** O09 timing is not modelled (Q8).

---

## 3. Part 2: ECC settlement cash

**Label:** ECC rule for the timing; Estimate for the amounts.

**Sources:**
- CBA p.3:
  - "all trades conducted before 4 PM CET are settled in the next morning."
  - "ECC initiates one urgent MT101 Request for transfer at the end of the business day (6 PM CET) with value date the next business day. Ideally this is processed overnight, as it is required, ECC receives all collections the next morning before 8 AM (EUR)."
  - "ECC performs cash settlement for all transactions concluded at the partner exchanges, all stock exchange fees, all ECC fees, cash collaterals and clearing funds."
- CBA p.6, account requirements: "The account is on the name of theapplicant. The account will be used exclusively for ECC clearing. Third party (ECC AG) will be allowed to debit the account."
- ECC payments page:
  - "commodity amounts from all trades are netted into a single net payment amount per DCP member and Connected Bank."
  - "EUR payments are processed until 8:00 a.m. CET (T+1) on T2 operating days."

**Windows.** Window D covers trades in [`prevBD(D)` 16:00, D 16:00). It has one net amount and three moments:
- **fund by** D 18:00, when the MT101 is sent;
- **value date** `nextBD(D)`;
- **received by ECC** before 08:00 on the value date.

**Net amount (signed):**

```
N(D) = Σ buys × price − Σ sells × price + fees + clearing-fund change + cash-collateral change
```

Negative prices flip the sign by themselves. Fees are inputs with no defaults (Q7).

**Cash path and need:**

```
out(t) = Σ over windows funded by t of N(D)   (credits count from their value date)
need   = max over the horizon of ( out(t) − replenished(t) )
```

Replenishment is an **ASSUMPTION**, default none:
- **none:** `need` is the peak cumulative net outflow over the horizon;
- **daily:** each collection is topped up the next business day, so `need` is the largest single net amount;
- **weekly:** topped up every Monday.

`OR(D) = max(N(D) − fees and collateral items, 0)`: trades only, for Part 1.

**Holiday stacking (2027).** Good Friday 26 March and Easter Monday 29 March are ECC holidays.
- The window closing Thursday 25 March has value date Tuesday 30 March.
- The window closing Tuesday 30 March covers five days of trading and has value date Wednesday 31 March.

**Positions held over the 16:00 cut (the float).** ECC nets each business day, but a purchase made before the 16:00
cut and sold after it is collected one business day before the sale's proceeds come back. An example is buying
day-ahead and selling intraday the next day. In steady state each collection pays for the newly carried purchases and
receives the previous ones, so this amount stays in the wallet all the time:

```
float = c × (gross MWh bought in a trading day) × price
```

`c` is the share of a day's buys that is carried: an **ASSUMPTION**, 30% for the financial-trader preset (about its
day-ahead buying) and 0 for the sellers. The float counts in the settlement need, in both the expected and the stress
case. It doesn't change `OR`, because ECC's exposure nets buys and sells (deck p.4).

The first model left this out, so a flat trader showed €0 in the expected case. Niki pointed out on 26 Sep 2026 that
money is needed there every day.

**Flat traders' losses.** With one price per market, equal buys and sells net to zero apart from the float. **ASSUMPTION**
for the stress end: each window's net payable is `x` % of its gross buy value at the stress price (default 5%), with no
replenishment.

**Missed payments** follow ECC's Clearing Conditions (not in the pack). They are never modelled as a state and never
fed into `OR`.

**Aggregators:** ECC settles only the exchange leg. Whether the wallet funds the bilateral leg is Q6.

---

## 4. Part 3: BRP security for TenneT

**Label:**
- TenneT rule (SC 2026) for dates before 1 January 2027;
- Draft rule (ACM draft) from then on (ACM draft, Artikel II B: "Artikel I, onderdeel A, B en D treden in werking met ingang van 1 januari 2027");
- Direct+ contract for the member's share.

A rule selector keyed on the calculation date has a manual override (Q3).

### 4.1 Current rule: SC 2026, art. 10.8

**Form** (para 1): "een bankgarantie … al dan niet, naar keuze van de balanceringsverantwoordelijke, aangevuld met een bij de transmissiesysteembeheerder aangehouden deposito."

**A** (paras 2a, 3–6): "het hoogste netto-transactievolume in MWh van die balanceringsverantwoordelijke met enige andere balanceringsverantwoordelijke voor alle uren gedurende één kalenderdag", × the average market price over the three months before, with a floor of € 40 per MWh.

```
price       = max(P_3m, 40)
A_first     = max(V_expected, F) × price     (para 3: "met een ondergrens van 50 MW")
A_up        = max over the last 42 days of V_day × price   (para 5, on TenneT's written request; no volume floor)
A_down      = max(mean over the last 42 days of V_day, F) × price   (para 6, on the BRP's request; "ondergrens van 50 MW")
```

- `V_day` is that day's highest net volume with a single counterparty BRP.
- The page shows A_up and A_down with who triggers them.

**B** (paras 2b, 8–12):
- Connections are counted per class at the class's lowest value: 2–10 MW counts 2, 11–25 counts 11, 26–50 counts 26, and above 50 MW counts actual capacity. Three 30 MW connections therefore count **78 MW**.
- The total is × 24, "met een ondergrens van 50 MW", × the same price.

```
B = max(Cap_counted × 24, F) × price
```

**Security** (para 13): 2A if 2A ≥ B, otherwise A + B.
- **NEMO** (para 14): € 100,000.
- **Recalculation:** six-weekly per TenneT's page, which we couldn't retrieve; monthly in practice per ACM draft para 35.

**The 50 MW floor and the €96,000 minimum (INTERPRETATION, toggle).** The current text has **no €96,000 minimum**; that
figure comes from TenneT's page. Two readings:
- **"1,200 MWh reading"** (default): `F = 50 MW × 24 h = 1,200 MWh`, applied to A (first calculation and reductions) and to B. The effective minimum is 2 × 1,200 × price, which moves with the price: €96,000 at €40 and €192,000 at €80.
- **"Flat €96,000"**: the formula without the volume floors, then `max(…, 96,000)`.
- Support for the first reading: 96,000 = 2 × 1,200 × 40, and the proposal (p.3) says the current rule sets "voor de afzonderlijke componenten van de zekerstelling een minimale waarde … in plaats van voor het totaal", and that the new total minimum is "ongevoelig voor marktbewegingen".
- Para 11 floors B at 50 MW **for every BRP, even one with no large connections**, so B ≥ 1,200 × price always.

**Edge cases (INTERPRETATION, settings):**
- Connections under 2 MW aren't in any class; default: they don't count.
- A connection between classes (10.5 MW) is rounded down to the lower class (counts 2); a setting rounds it up instead (counts 11).

### 4.2 Draft rule: ACM draft, art. 10.8 (from 1 January 2027)

**Formula** (paras 1–8, ACM draft pp.1–2):
- **Recalculation:** "maandelijks" (para 1).
- **Formula and minimum:** "3A + 4B + 6C + 6D en hanteert daarbij een minimumbedrag van € 96.000,-" (para 7).
- **NEMO:** € 100,000 (para 8).
- **Missing invoices:** "een fictieve factuur van € 0,- voor de weken respectievelijk maanden waarvoor geen factuur bestaat" (para 6).

```
A = V_max,2m × P_DA,2m       realised highest daily net volume over two months × average day-ahead reference price; no floors
B = mean(W_1..10) + 2σ(W)    weekly imbalance invoices, last 10 weeks
C = mean(R_1..12) + 0.5σ(R)  monthly reconciliation invoices under art. 10.26 (profile), last 12 months
D = mean(T_1..12) + 0.5σ(T)  the same under art. 10.27 (smart-meter allocation and telemetry-metered connections)
S = max(3A + 4B + 6C + 6D, 96,000)
```

**Details:**
- **Invoices are signed.** Components can be negative and are not floored. Proposal p.8: "De afzonderlijke componenten kunnen negatief zijn"; p.3: "kunnen deze weggestreept worden tegen risico's in andere componenten". Only the total has a minimum.
- **σ is an INTERPRETATION:** population by default, with a sample setting (× √(10/9) = 1.0541 for B).
- **Why "3A":** ACM draft para 25: "de kosten van drie dagen energie-inkoop … (D-1, D en D+1)". This is worth one line on the page.
- **Form** (para 9): a balance on the account TenneT holds, a bank guarantee, or both.
- **Obligations** (para 10):
  - (a) enough balance for the weekly and monthly settlements;
  - (b) enough security **after** them;
  - (c) enough security after withdrawal of recognition, for invoices still to come.

**Ramp-up for a new BRP (a new member, section 4.4):**
- **A:** 0 at the first calculation (no realised volume), then the realised two-month maximum.
- **B:** the first imbalance invoice arrives about four weeks after delivery (ACM draft para 15: "Tussen het moment van levering en facturatie zitten vier weken"). Missing weeks count as €0, so B can peak at about 1.618 × its steady-state value with 7 of 10 real invoices (the maximum of p + 2√(p(1−p)) is at p = 0.724, exactly the golden ratio). For C and D the peak is about 1.055× at 11 of 12.
  - **Monthly recalculation doesn't necessarily hit that week.** With delivery starting on the 1st and TenneT recalculating at the start of each month (ASSUMPTION), the window holds 0, 0, 4, 9 and then 10 invoices in months 1–5. B's monthly peak is then **1.5×** (9 of 10), found in Phase 3 (`tests/wallet/brp.test.js`). The page shows the monthly series. The 1.618× is a weekly worst case, not the series maximum.
  - Counted at a start-of-month recalculation, the first C invoice (paid in month 6) enters in month 7, and the first D (paid in month 7) enters in month 8.
- **C:** month M's profile reconciliation is stated by the 10th working day of M+5 and paid the first Tuesday after (SC 2026 art. 10.26(4)–(5)). With delivery starting in month 1, **the first C invoice falls in month 6**.
- **D:** month M's smart-meter and telemetry reconciliation is paid on "de eerste werkdag van de zesde maand na de reconciliatiemaand" (art. 10.27(13)). With delivery starting in month 1, **the first D invoice falls in month 7**.
- The brief said months 5 and 6 (section 10).
- The page shows months 1–18 with their peak.

**cSMA** (ACM draft para 29): since 1 May 2026 collective smart-meter allocation replaces profile allocation, so C may be zero for new connections (Q15).

### 4.3 Readings that change A a lot (INTERPRETATION, settings)

- **Per period.** (i) |Σ over the day's settlement periods of net volume|, or (ii) Σ over the day's periods of |net volume|. The texts say "voor alle uren gedurende één kalenderdag" (current) and "één etmaal" (draft).
  - Default: (i).
  - It matters for batteries and anyone who buys in some hours and sells in others.
  - A trader who is flat in every period has A = 0 under both.
- **Counterparties.** The maximum over single counterparties, or the total across all.
  - Default: the maximum over single counterparties. Supported by "met enige andere balanceringsverantwoordelijke" (current), "met een andere balanceringsverantwoordelijke" (draft) and "met één andere BRP" (proposal p.2).
  - For aggregators, each bilateral counterparty and the exchange are separate counterparties.
- **Price.** Default: the arithmetic mean of NL day-ahead prices over the period (three months current, two months draft).

### 4.4 How the security reaches a member: marginal collateral, no minimum (Niki, 26 Sep 2026)

The Direct+ BRP is a **commercial BRP**, not EPEX SPOT's NEMO recognition. Each member pays what is equal to its share
as if it were its own BRP. Then, the same day: **"there is no minimum for Direct+ members, it's only the marginal
collateral."**

**Marginal collateral** (the default, "Basis" on the Settings page) is the rule's formula on the member's own figures,
without a minimum and without the volume floors. The €96,000 minimum and the 50 MW floors apply once, to the Direct+
BRP.
- **Current rule:** A = the member's own daily net volume × max(3-month price, €40), with no 50 MW floor. B = its own counted capacity × 24 × the same price, with no floor. The member pays 2A if 2A ≥ B, else A + B. The €40 price floor stays, because it prices the BRP's own calculation.
- **Draft:** 3A + 4B + 6C + 6D on the member's own figures, with no minimum.
- **ASSUMPTION:** never below €0. A member whose imbalance tends to earn money adds nothing rather than a negative amount.
- **ASSUMPTION:** netting inside the Direct+ portfolio (a member's imbalance offsetting another's) is not modelled. The member's own spread is used, which usually overstates its true marginal share.
- **Ramp-up:** the series still shows how a new member's own components build up.
- **Comparison basis:** "On your own as a BRP" applies the minimum and floors, as in the brief's standalone mode. It's a Settings option only and isn't shown on the wallet view by default, because whether to show that comparison to members is open (W11).
- **NEMO:** the rule stays in `brp.js` because both texts have it, but it doesn't apply to Direct+ members.

The brief's pricelist mode is dropped.

---

## 5. Part 4: TenneT account cash for invoices

**Label:** Estimate for the amounts; TenneT rule or Draft rule for dates.

**Imbalance price per settlement period** (SC 2026 art. 10.29). Short means the BRP took energy ("afnemen"); long means
it fed energy in ("invoeden").

| Regulation state | Short pays | Long receives |
|---|---|---|
| −1 | afregelen (downward) price | afregelen price |
| +1 | opregelen (upward) price | opregelen price |
| 0 | middenprijs | middenprijs |
| 2 | max(mid, upward) | min(mid, downward) |

- In state 2, the text sets the short price to "de middenprijs" if mid is above upward, else upward (para 4a, 4c). The long price is mid if mid is below downward, else downward (para 4b, 4d). Hence the max and min.
- **Tests:** mid 100, upward 120, downward 60 → short pays **120**, long receives **60**. With mid 150, short pays **150**.
- It is the **full** imbalance price, not a spread against day-ahead. Negative prices flip the flow.

**Invoices and dates:**
- **Imbalance:** weekly, about **four weeks** after delivery (ACM draft para 15), debited from the BRP's TenneT account. The debit weekday isn't in the pack (TenneT's billing terms), so it's a setting until Q11.
- **Profile reconciliation (C invoices):**
  - Current 10.26(5): the first Tuesday after the statement, "tenzij tussen bedoelde moment en de eerste dinsdag niet meer dan drie werkdagen zijn gelegen", in which case the Tuesday after.
  - Draft 10.26(5): the first Tuesday, with no exception, paid into the account.
  - Payouts come on the Wednesday after (10.26(6)).
  - If the Tuesday or Wednesday isn't a working day, the dates move to the next working day (10.26(8), renumbered (7) in the draft).
- **Smart-meter and telemetry reconciliation (D invoices):** the first working day of the sixth month after the reconciliation month (10.27(13)–(14)).
- **Calendar:** Dutch working days, not T2. A separate calendar whose holiday list needs confirming (Q11).
- **Keying:** the date rules are keyed on the date, like the rule selector.

**Account vs security (draft para 10). INTERPRETATION**, processed in date order:

```
balance before a debit ≥ max(invoice, 0)
balance after the debit + guarantee ≥ S
```

Under the current rule, invoice cash and security are **additive**. That gives the same total and only changes the
split between the TenneT account and the guarantee.

**Exit tail** (draft para 10(c); proposal p.2: "nog vier wekelijkse onbalansfacturen" and "nog 21 maandelijkse
reconciliatiefacturen"). After a member or the BRP stops, security and cash stay committed for:
- about 4 weeks for imbalance;
- up to 21 months for profile reconciliation (ACM draft para 16);
- 6 months for smart-meter and telemetry reconciliation (para 17).

The page shows the release dates.

---

## 6. Behaviour and the imbalance model

### 6.1 Inputs

**Quick section** (about two minutes):
- markets;
- gross buy and sell MWh per day per market;
- weekend and holiday trading on/off;
- typical price, stress price, and the stress 2–3-month average price (for BRP security);
- share of hours with negative prices, and the **average price in those hours**.

**Advanced section:**
- `s`;
- resting orders over 16:00;
- net buying between 16:00 and the update;
- the auction limit price;
- the settlement stress share `x`;
- imbalance: share, bias and volatility;
- regulation-state shares and the state-2 price gap;
- aggregator nominations and non-delivery;
- connections by metering type and capacity class;
- fees.

**Additions to the brief's list:**
- the average price in negative hours (needed to value them);
- the auction limit price (needed for max p × q);
- the stress average price (security uses 2–3-month averages, not spot);
- the settlement stress share (see flat traders in section 3).

### 6.2 Parametric weekly imbalance model (Estimate)

The model works directly on **weekly invoice totals**, as the brief asks, because summing independent 15-minute periods
understates the spread. It's labelled "a normal model; it understates NL imbalance-price tails".

```
V_w = imbalance share × weekly reference volume          (traded MWh; nominated MWh for aggregators; production for assets)
Δ   = π₂ × gap₂                                          (average short-minus-long price gap; only state 2 has one)
μ_w = V_w × ( β × P̄ + (1 − |β|) × Δ / 2 )                (β = net bias: +1 always short, −1 always long)
σ_w = cv × V_w × P̄                                       (ASSUMPTION: cv default 0.5; replay mode measures it)
```

- `P̄` is the typical imbalance price (the day-ahead price plus its mean deviation).
- The unbiased part pays half the average gap: half its volume is short at the short price, half long at the long price.
- **Expected end:** `B = μ_w + 2σ_w`.
- **Stress end:** the 95th percentile of `B` over 10,000 simulated 10-week windows of `W ~ N(μ_w, σ_w)` (seeded mulberry32; its snapshot is a Phase 4 test).
- **C and D** use monthly means and σ as inputs, with the same approach.

**Replay mode:** local CSVs (no upload, no storage):
- NL day-ahead prices;
- TenneT imbalance data per period (state, upward, downward, mid);
- or the member's own invoices or volumes.

Everything is then computed from the real series.

---

## 7. Presets (for approval: Q5)

Every value shows as "assumed" on the page. The prices are placeholders to check against current NL data before
release; I haven't verified them against market data.

**Financial trader**

| Input | Value | Why |
|---|---|---|
| Continuous, buy / sell | 240 / 240 MWh a day | About 10 MW each way around the clock: a small desk that ends each day flat |
| Auctions, buy / sell | 100 / 100 MWh a day | A day-ahead position closed later |
| Auction buy limit price | €150/MWh | Bids capped at a price the desk would really pay, not the market maximum |
| Weekend and holiday trading | on | The cautious choice: weekend periods set the Friday limit |
| Typical / stress price | €80 / €250 per MWh | A normal day and a spike day |
| Stress 2–3-month average | €120 | Security uses averages, which move less than spot |
| Negative-price hours | 5%, at −€20 average | A few hundred negative hours a year |
| s | 0 | The brief's cautious default |
| Resting orders over 16:00 / net buying 16:00–update | €10,000 / €5,000 | A few open orders and some trading while ECC recalculates |
| Imbalance | 0.5% of traded volume, no bias, cv 0.5 | Only partial fills and slips at gate closure |
| State-2 share / gap | 5% / €150 | Dual pricing is rare but expensive |
| Settlement stress share x | 5% | A bad week for a flat desk |
| Purchases paid before their sale | 30% of a day's buys | Roughly the day-ahead buying, sold intraday the next day |
| Connections | none | |

**Aggregator** (flexibility held in other BRPs' portfolios, as in the aggregator video)

| Input | Value | Why |
|---|---|---|
| Nominated in from other BRPs | 150 MWh a day | Flex bought bilaterally from customers' assets |
| Auctions, buy / sell | 0 / 120 MWh a day | Sells most of the flex day-ahead |
| Continuous, buy / sell | 10 / 40 MWh a day | Sells the rest intraday and corrects |
| Non-delivery | 5% of nominated volume | By contract the aggregator carries it, as a short imbalance |
| Imbalance | 3% of nominated volume plus non-delivery, bias short, cv 0.5 | Nominations are forecasts |
| Weekend trading, prices | as for the financial trader | |
| Connections | none in the Direct+ BRP | The assets stay in their own BRPs |

**Asset-controlling party** (a 30 MW solar park with a 10 MW battery)

| Input | Value | Why |
|---|---|---|
| Connections | one telemetry-metered connection, 30 MW (class 26–50, counts 26) | The park joins the Direct+ BRP |
| Auctions, buy / sell | 0 / 90 MWh a day | Day-ahead sale of forecast output |
| Continuous, buy / sell | 20 / 20 MWh a day | Battery shifting and forecast corrections |
| Imbalance | 5% of production, bias long 0.2, cv 0.5 | Forecast error, slightly more output than sold |
| Reconciliation D | monthly mean €0, σ €300 | Telemetry-metered connections reconcile little |
| Reconciliation C | €0 | No profile connections (Q15) |
| Weekend trading, prices | as for the financial trader | |

---

## 8. Worked example: financial trader, week of Monday 5 October 2026

This uses the financial-trader preset above, Direct+ marginal BRP collateral (section 4.4), everything as cash unless stated, and
replenishment none. A throwaway script repeated each step with the engine, and every figure matches.

### 8.1 Part 1: ECC collateral

**Continuous risk-bearing value per day, typical:**
- buys at positive prices: 240 × 95% × €80 = 18,240
- sells at negative prices: 240 × 5% × €20 = 240
- **G = €18,480**

**Targets (s = 0):**
- Monday–Thursday: `T_cont` = 18,480 + 10,000 = **€28,480**.
- Friday: the period runs Friday 16:00 → Monday 16:00, three days, so `T_cont` = 3 × 18,480 + 10,000 = **€65,440**.
- `T_auc` = 100 × €150 = **€15,000** every calendar day, weekends included.

**Base limits:**
- `BD_cont` = 10,000 + 5,000 = €15,000.
- `NBD_cont` = 0.
- Auction base limits 0 (orders are placed after the update).

**Friday 9 October binds:**
- **Reserve:** today's continuous base limit (15,000 + 2 × 0) plus Monday's (15,000) = **€30,000**.
- **Open risk:** 0 (the trader is flat).
- `free = C − 30,000`.
- **Continuous:** l18 = 15,000 + free × k ≥ 65,440, so free × k ≥ 50,440.
- **Saturday and Sunday auctions:** each gets free × (1 − k) ÷ 3 ≥ 15,000, so free × (1 − k) ≥ 45,000. Monday's auction gets the same amount back, and both readings of open question 1 agree here.
- **Split:** balanced at k = 50,440 / 95,440 = 52.85%. As whole percentages:

| Split | Continuous needs free ≥ | Auctions need free ≥ | Binding |
|---|---|---|---|
| 53 / 47 | 95,170 | 95,745 | 95,745 |
| 52 / 48 | 97,000 | 93,750 | 97,000 |

- **Result:** 53/47 with free = 95,745, so **C = €125,745**.
- **Other days:** Monday–Thursday have free = 95,745. Continuous l18 = 15,000 + 50,745 = 65,745 ≥ 28,480, and auctions 45,000 ≥ 15,000, so they don't bind.

**Stress.** Stress price €250, so every value scales by 250/80 = 3.125. The update comes at 19:00.
- `BD_cont` = 31,250 + 1.5 × 15,625 = 54,687.50.
- G = 57,750.
- `T_cont(Fri)` = 204,500.
- `T_auc` = 46,875.
- OR(Friday) = 4,250, from section 8.2.
- Reserve 109,375.
- **Result:** free ≥ 3 × 46,875 / 0.48 = 292,968.75 at 52/48, so **C = €406,594**. Without the open risk it would be €402,344.

**Form:**
- All cash, as Direct+ requires, so there is no default-fund contribution. (With a guarantee, ECC would ask at least 4% of it, €5,029.80 to €16,263.76, in cash.)

### 8.2 Part 2: ECC settlement cash

| Window (trades) | Days | Fund by | Value date | Net, typical | Net, stress |
|---|---|---|---|---|---|
| Fri 2 Oct 16:00 → Mon 5 Oct 16:00 | 3 | Mon 5 Oct 18:00 | Tue 6 Oct (before 08:00) | 0 | 12,750 |
| Mon 5 → Tue 6 | 1 | Tue 6 18:00 | Wed 7 | 0 | 4,250 |
| Tue 6 → Wed 7 | 1 | Wed 7 18:00 | Thu 8 | 0 | 4,250 |
| Wed 7 → Thu 8 | 1 | Thu 8 18:00 | Fri 9 | 0 | 4,250 |
| Thu 8 → Fri 9 | 1 | Fri 9 18:00 | **Mon 12 Oct** | 0 | 4,250 |

- **Typical:** buys and sells have equal volumes at one price, so every window nets to 0 apart from the float. The trader carries 30% of a day's buys over the 16:00 cut: 0.3 × 340 MWh × €80 = **€8,160**. That stays in the wallet, plus fees (not set, Q7).
- **Stress float:** 0.3 × 340 × €250 = €25,500, on top of the stress windows below.
- **Stress:** 5% of the window's gross buys at €250. One day is 5% × 340 MWh × €250 = €4,250; the three-day Monday window is €12,750.
- **Stress need:** with no replenishment, the peak cumulative outflow is €29,750, plus the €25,500 float: **€55,250**.
- **Open risk:** OR(D) equals these amounts, and OR(Friday) = €4,250 feeds section 8.1.

### 8.3 Part 3: BRP collateral (marginal; 5 October 2026, so the current rule)

The trader is flat in every settlement period, so the realised net volume with the exchange's BRP is 0 under both
readings.

**Marginal collateral** (Direct+, section 4.4):
- A = 0 × €80 = 0.
- B = 0 (no connections).
- 2A ≥ B, so **€0**, both typical and stress.

**On your own as a BRP, for comparison** (the minimum and floors apply):

| Reading | A | B | Security, typical (€80) | Stress (average €120) |
|---|---|---|---|---|
| 1,200 MWh | 1,200 × 80 = 96,000 (the 50 MW floor) | 1,200 × 80 = 96,000 (the 50 MW floor, no connections) | 2A ≥ B → **€192,000** | 2 × 1,200 × 120 = **€288,000** |
| Flat €96,000 | 0 | 0 | **€96,000** | **€96,000** |

**Draft rule** (from 1 January 2027): A = 0 and C = D = 0, so only 4B counts.

**Imbalance:**
- V_w = 0.5% × 680 MWh × 7 = 23.8 MWh.
- Δ = 5% × €150 = €7.50.
- μ_w = 23.8 × 7.50 / 2 = **€89.25**.
- σ_w = 0.5 × 23.8 × 80 = **€952**.

**B:**
- Typical: B = 89.25 + 2 × 952 = **€1,993.25**, so 4B = **€7,973**. That is the marginal collateral under the draft; on your own as a BRP, the €96,000 minimum.
- Stress: σ_w = 2,975. The page takes B's stress end as the 95th percentile of the seeded simulation: B = 8,288.51, so 4B = **€33,154** (on your own: €96,000).

Under the draft, the marginal ramp-up series builds to €7,973 by month 5: B has 0, 0, 4, 9 and then 10 real invoices in its window. On your own as a BRP it stays at €96,000. With no connections, the exit tail is about four weeks.

### 8.4 Part 4: TenneT account

- **Week of 5–11 October:** it will be invoiced about four weeks later, in the week of 2 November 2026. The exact debit day is Q11.
- **Cash for the invoice:** expected €89.25; stress (μ + 2σ at €250) **€6,039.25**.
- **Current rule:** the marginal collateral is €0. On your own as a BRP it would be €192,000 or €96,000. Either way, the account needs only the invoice amount.

### 8.5 The total

Direct+ marginal collateral, rule in force on 5 October 2026, all cash (Direct+ accepts no guarantees, so no default fund). Pinned by
`tests/wallet/wallet.test.js` and shown on the page:

| Purpose | Wallet segment | Form | Label | Expected | Stress |
|---|---|---|---|---|---|
| 1. ECC collateral | Trading collateral (at ECC) | cash | Estimate · ECC rule | 125,745 | 406,594 |
| 2. ECC settlement (float + net payments) | Available balance | cash | Estimate · ECC rule | 8,160 + fees | 55,250 |
| 3. BRP collateral (marginal) | BRP collateral | cash | TenneT rule · Direct+ contract | 0 | 0 |
| 4. Imbalance invoices | Available balance | cash | Estimate | 89.25 | 6,039.25 |
| **Total** | | | | **€133,994** | **€467,883** |

- **The same week with dates in 2027 (the draft):** the BRP collateral is €7,973 to €33,154.
- **On your own as a BRP, for comparison:** €325,994 to €755,883 with the 1,200 MWh reading, or €229,994 to €563,883 with the flat €96,000.
- **Largest driver for this trader:** the ECC collateral, and within it the Friday period and the weekend auctions.

---

## 9. Settings introduced (to go into `docs/open-questions.md` in Phase 1)

**ASSUMPTION** (visible defaults):
- `s` = 0.
- Continuous target held by `l18`.
- Update time 18:00, stress 19:00.
- Weekend trading on (presets).
- Replenishment none.
- Settlement stress share 5%.
- Imbalance cv 0.5.
- State-2 share and gap.
- Stress average price.
- The DCP limit covers intraday auctions (repo Q4).
- Sells don't credit the auction limit (Q10).
- Imbalance debit weekday (Q11).

**INTERPRETATION** (readings of source texts):
- The 50 MW floor as 1,200 MWh vs a flat €96,000 minimum (current 10.8).
- Connections under 2 MW and between classes.
- A per period, (i) vs (ii).
- A across counterparties.
- σ population vs sample.
- "Market price" and "day-ahead reference price" as the NL day-ahead mean.
- The account/security check (draft para 10).
- Current rule treated as additive.

---

## 10. Where the brief and the sources differ

1. **No €96,000 minimum in the current text.** SC 2026 art. 10.8 has the 50 MW floors (paras 3, 6, 11) and the €40 price floor, but no minimum amount. The €96,000 is from TenneT's page, which we couldn't retrieve. Both toggle readings stand, but the "flat" one rests only on that page.
2. **The current B has its own floor.** Para 11 floors B at 50 MW for every BRP, including one with no large connections.
3. **Ramp-up months.** The first C invoice falls in month 6 and the first D in month 7 (10.26(4)–(5), 10.27(13)), not months 5 and 6. The page shows dates rather than a month count.
4. **Continuous "gross buy value"** should also count sells at negative prices (Manual §3.11).
5. **The brief doesn't say which limit holds the continuous target** (`l18` vs `l09`). It's now a setting.
6. **The solver needs per-day targets,** not only per-day OR.
7. **Deck p.3 is the limit cycle, not settlement.** Settlement timing comes from the CBA document (p.3).
8. **Flat traders' settlement is €0** at a single price, so the stress end needs its own assumption (section 3).
9. **The auction target with intraday auctions** needed a definition (section 2.3).
10. **Horizon.** The ramp-up and exit tail run past the engine's `MAX_DATE`. They only use the Dutch calendar, so no engine change is needed.

Everything else the brief states, I found in the sources as described:
- art. 10.29 state-2 pricing;
- the 10.26/10.27 payment dates;
- the draft formula, minimum, NEMO, €0 invoices, monthly recalculation and start date;
- ECC's settlement timing;
- the €40m guarantee cap with 50% cash above it;
- the 4% default fund;
- the proposal's p.3 and p.8 statements.

---

## 11. Questions for Niki

### 11.1 Answers (26 September 2026)

1. **BRP:** a commercial BRP, not EPEX SPOT's NEMO recognition. Section 4.4.
2. **Accounts:** the Direct+ wallet pools all members at one connected bank, so the calculator shows each member's individual need. There is no netting between members.
   - The default account mapping uses the wallet's segments, as in the member video:

| Purpose | Wallet segment |
|---|---|
| 1. ECC trading collateral | "Trading collateral (at ECC)", locked |
| 2. ECC settlement | available balance, paid from the pooled connected bank account |
| 3. BRP security | "BRP collateral" segment |
| 4. Imbalance and reconciliation invoices | available balance |

   - Flag for Niki, not for the calculator: ECC's CBA p.6 asks that the settlement account be "on the name of the applicant" and "used exclusively for ECC clearing". A pooled account works if that is squared with ECC (for example with per-member sub-accounts). The page labels the pooling as Direct+ contract and doesn't describe ECC's account rules beyond that.
3. **Rule timing:** both options. For dates from 1 January 2027 the page defaults to the draft, and shows the current rule's figure beside it (and the other way round before 2027). The manual selector stays.
4. **Imbalance and reconciliation:** each member pays its own, as if it were its own BRP. Part 4 uses the member's own invoices.
   - Same day, later: **no minimum for Direct+ members, only the marginal collateral.** BRP security is the rule on the member's own figures, without the €96,000 minimum or the 50 MW floors (section 4.4).
   - Same day: **Direct+ accepts cash only, no bank guarantees.** Every part of the wallet is cash, and there is no ECC default-fund contribution.
5. **Presets:** not approved; waiting for Niki. Phases 1–4 don't use them.

### 11.2 The original gate questions (from the brief)

1. **BRP** *(Part 3)*
   - Who holds the Direct+ BRP recognition?
   - Is it the recognition EPEX SPOT holds as NEMO (€100,000 under both rules)?
   - Who is the counterparty BRP for EPEX trades in NL?
   - Which pass-through mode applies to members?
2. **Accounts** *(all parts)*
   - Is each member its own DCP with its own connected account?
   - What does "the wallet" mean in practice?
3. **Rule timing** *(Part 3)*: use the draft from 1 January 2027 for 2027 dates until ACM decides? (Comments on the draft close on 6 October 2026, Staatscourant 2026-30314.)
4. **Imbalance allocation** *(Part 4)*: does each member pay its own imbalance and reconciliation, or a share of the portfolio's?
5. **Presets** *(section 7)*: approve, or change.

**Sources still missing** (they'd close INTERPRETATIONs):
- **TenneT's BRP recognition page:** the €96,000 minimum and six-weekly recalculation. A saved PDF or a paste of the text would do.
- **"TenneT inzake rekening"** (Q14): the formula TenneT actually applies today.
- **TenneT's billing terms for weekly imbalance invoices** ("Algemene voorwaarden voor facturering en betaling bij onbalans"): the debit day (Q11).

---

## 12. The prospect questionnaire (`src/wallet/prospect.html`)

A shareable page for prospects, built into `dist/wallet/direct-plus-wallet-prospect.html`. It asks seven questions
(Niki asked for portfolio questions rather than per-connection BRP details) and shows a plain-English estimate: what the money is for, where it sits in the wallet, when it's needed, what moves
it, the answers, the assumptions and the sources. It can be printed or saved as a PDF.

- **Calculation:** the same as the calculator (`WalletCalc.compute`).
- **What it leaves out:** internal references, tags and the "on your own as a BRP" comparison (W11).
- **Rounding:** every amount is shown to the nearest €1,000 (on the calculator page too): these are estimates, not exact figures (Niki, 26 Sep 2026).

Answers map onto settings in `wallet.js` (`defaultAnswers`, `strategyVolumes`, `fromAnswers`). With each type's
default answers the settings equal that type's preset exactly, and `tests/wallet/wallet.test.js` checks this.

| Question | Settings |
|---|---|
| Which describes you best? | Preset: trader, aggregator or asset owner |
| Markets, weekends | Volumes of markets not traded are set to 0; weekend trading |
| Strategy | Fills the volumes. The type's own strategy keeps the preset; otherwise each market's total is split evenly (close positions), 10/90 (mainly sell) or 90/10 (mainly buy) |
| Volumes | Buys and sells per market. Orders resting over 16:00 and evening buying scale with continuous buying (the preset's ratio) |
| Aggregators: nominated in, not delivered | `nominatedIn`, `nonDelivery` |
| Held over the 16:00 cut | Settlement float share: none 0, some 30%, most 70% |
| Prices | Typical and stress price. The stress two-to-three-month average is 1.5 × typical (ASSUMPTION) |
| Highest auction bid | `aucLimitPrice` (required when buying in auctions) |
| Portfolio (solar, wind, battery, flexible demand, none), total capacity, number of sites | Capacity split over equal sites (ASSUMPTION) for the current rule's B. Reconciliation spread of €10 per MW a month (ASSUMPTION), in D: telemetry or smart meter, no profile metering (Q15). A battery means buying and selling in different periods (`shiftShare` 1). Solar or wind pre-selects "depends on a forecast" on the next question, battery or demand "normal" (`suggestBalance`); the prospect can change it |
| How close, which way | Imbalance 0.5%, 3% or 5% of volume; bias 0, +0.3 (short) or −0.2 (long) |
| Top-ups | Top-up rhythm (Direct+ accepts cash only, so there is no question about guarantees) |

Everything else stays at the preset. The page lists it under "What we assumed".
