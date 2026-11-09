# The Direct+ Limit Calculator: reference for the assistant

This is everything the assistant knows. It describes the calculator at /limits on the Direct+ site: what it
calculates, how, and what the page shows. Where the calculator fills a gap that ECC has not documented, this text says
"assumption".

## What the calculator is

- Direct+ members trade on EPEX SPOT and clear with ECC as Direct Clearing Participants (DCP). ECC gives each member a
  trading limit per market, worked out from the collateral the member posts.
- The calculator has two modes:
  - **Limits from my collateral:** the trading limits a given amount of collateral gives, day by day for one week.
  - **Collateral for a target limit:** the collateral a target trading limit needs.
- It covers two markets, each with its own limit:
  - **M7 continuous:** EPEX continuous intraday trading.
  - **MATS auctions:** the EPEX day-ahead auction and the intraday auctions. ECC's clearing manual says the auction
    limit covers both. The calculator assumes ECC's DCP limit works the same way, one limit for all MATS auctions,
    until ECC confirms (assumption). The auction times on the page are the day-ahead auction's (12:00); intraday
    auctions draw on the same limit at other times of day.
- It is an unofficial tool, built on ECC's public DCP client materials (July 2025) and ECC's DCP Simulation Tool
  v1.3.5. Figures are indicative; ECC's own calculation always prevails.
- Netherlands, EUR only. GB markets (GBP, FX, delivery risk) are out of scope, and so are EPEX GO (guarantee of origin)
  auctions.

## Words the page uses

- **Collateral:** the money the member has posted with ECC.
- **Business day (BD):** an ECC business day. **Non-business day (NBD):** a weekend day or an ECC holiday. ECC's
  business days for 2026–2027 come from ECC's calendar.
- **Base limit:** a fixed amount per market that bridges the time from the 16:00 reset until the evening update. The
  member sets two per market: one for business days (BD) and one for non-business days (NBD). Base limits are used as
  entered (ECC's tool rounds them up to the next €10).
- **Split (of excess collateral):** how the excess collateral is divided between the two markets, in whole percent,
  adding up to 100%. The page shows it as "M7 continuous / MATS auctions", for example 60 / 40.
- **Open risk, "unsettled net purchases":** what the member bought in the last trading day (volume × price, with sales
  netted), which is paid the next morning. It never goes below zero. Only net buying counts, so a sale at a negative
  price adds to what the member owes.
- **Reserved for base limits:** the collateral ECC holds back for base limits (see below).
- **Excess collateral:** collateral minus what is reserved for base limits minus open risk.
- **Dynamic limit:** the share of the excess collateral that ECC adds to a market's limit in the evening.
- **Gap:** the number of calendar days from a calculation day to the next business day. It is 1 on most days, 3 on a
  Friday (the calculation lasts until Monday), and longer around holidays. The week table marks it as "3-day gap".
- **Calculation day:** a business day on which ECC runs its evening calculation. Each one sets the limits until the
  next business day.

## ECC's daily cycle

1. **16:00 on every business day:** each market's limit resets to its base limit. Resting orders above it, including
   bids for future auctions, are deleted.
2. **Around 18:00 (best effort, no guaranteed time):** ECC adds the dynamic limit to what is left of the base limit.
   There is no fixed time for this update; the page always says "around 18:00".
3. **The next business morning, by 10:45:** once yesterday's purchases have been paid, that amount comes back, split by
   the member's split.

Base limits must therefore carry the member from 16:00 until the evening update, and cover any orders kept in the
system over 16:00. There is no MATS auction in that window.

## The formulas

For a calculation day with a gap of g1 days to the next business day, and g2 days from that business day to the one
after it:

- **M7 continuous base limit for a gap of g days:** BD + (g − 1) × NBD. M7 does not reset on weekends and holidays, so
  the base limit that goes live at 16:00 must last the whole gap. Reset days are always 1.
- **MATS auctions base limit:** BD on a normal day. Before a weekend or holiday, every auction day gets max(BD, NBD).
  MATS resets every calendar day.
- **Reserved for base limits** = today's base limit + the next business day's base limit, for each market. ECC reserves
  the next one because it goes live at 16:00 on the next business day, before ECC's next calculation has seen today's
  trades.
  - M7 continuous: [BD + (g1 − 1) × NBD] + [BD + (g2 − 1) × NBD].
  - MATS auctions: for each of g1 and g2, BD when the gap is 1 day, otherwise gap × max(BD, NBD).
- **Excess** = Collateral − Reserved − Open risk. It can be negative (a shortfall).
- **Dynamic** = max(Excess, 0) × split ÷ reset days. The excess is floored at zero, as in ECC's client deck.
- **M7 continuous:**
  - From 16:00 = BD + (g1 − 1) × NBD.
  - From around 18:00 = the 16:00 base limit + max(Excess, 0) × M7 split.
  - After settlement (next business morning) = the 18:00 limit + settled purchases × M7 split.
  - Over a weekend or holiday M7 keeps the last business day's evening limit until the next business morning: one
    limit for the whole stretch, not one per day.
- **MATS auctions:**
  - From 16:00 = the base limit per auction day.
  - Per auction from around 18:00 = that base limit + max(Excess, 0) × MATS split ÷ g1. On a Friday g1 is 3, because
    Friday's calculation lasts until Monday: the Saturday and Sunday auctions each get a third.
  - A calculation covers the auctions of each calendar day after it, up to and including the next business day. The
    weekend or holiday auctions in between each get the 18:00 amount; the next business day's auction gets the
    after-settlement amount.
  - After settlement, on a normal day = the 18:00 amount + settled purchases × MATS split.
  - The next business day's auction after a weekend or holiday is back at the full limit, if the weekend or holiday
    auctions went unused, as in ECC's client deck (ECC's simulation tool shows only one day's share there). ECC's
    worked example fits two readings, and the calculator shows the lower one (assumption):
    - the unused limit carried over: the 18:00 amount × g1 + settled purchases × MATS split;
    - the normal weekday level: MATS BD base limit + max(Collateral − the next business day's reserve, 0) × MATS split.
    With both markets and weekend base limits the two differ by a few thousand euros.
- **Settled purchases:** the open risk, paid in full the next morning (assumption). If the collateral was short, the
  calculator assumes the payment first refills the shortfall, and only the rest comes back as limit (assumption: ECC's
  materials do not say). So settled purchases = max(Open risk − shortfall, 0), where shortfall = max(−Excess, 0).

### Worked figures for a standard week

With the page's starting values (M7 base limits €20,000 BD and €10,000 NBD, MATS €10,000 BD and €10,000 NBD):

- Monday to Wednesday: M7 reserves 20,000 + 20,000 = €40,000, MATS 10,000 + 10,000 = €20,000: €60,000 in all.
- Thursday (g1 = 1, g2 = 3): M7 reserves 20,000 + (20,000 + 2 × 10,000) = €60,000, MATS 10,000 + 3 × 10,000 = €40,000:
  €100,000 in all.
- Friday (g1 = 3, g2 = 1): M7 reserves (20,000 + 2 × 10,000) + 20,000 = €60,000, MATS 3 × 10,000 + 10,000 = €40,000:
  €100,000 in all. Friday's M7 limit from 16:00 is €40,000, and each weekend MATS auction day gets €10,000 base.

Thursday and Friday reserve more because the next base limit (Thursday) or today's (Friday) must cover the weekend.
Friday is usually the hardest day: it reserves more, its M7 evening limit must last until Monday morning, and its MATS
share is divided by 3.

## Shortfalls

- When open risk and the reserved base limits exceed the collateral (a negative excess), no dynamic limit is added
  that evening. The member keeps only the base limits until settlement. The page shows a "Shortfall" alert.
- When the collateral does not even cover the reserved base limits, ECC's tool flags the setup as invalid. The page says
  so: lower the base limits or add collateral.

## What the page shows (Limits from my collateral)

- **Three tiles:** "M7 continuous, from 18:00" (the lowest evening limit in the week, on which day, and the highest);
  "MATS auctions, per day-ahead auction" (the lowest and the highest auction limit); "Reserved for base limits" (the
  peak, on which day, and the lowest).
- **"Your limits after the calculation on <day>":** one tab per calculation day. The page opens on the day with the
  least excess collateral (on a tie, the longest gap). Three columns per market: at 16:00 (the base limit), from around
  18:00 (dynamic limit added), and by 10:45 on the next business day (settled purchases added back).
- **"Where your collateral goes":** the collateral divided into open risk, M7 reserved, M7 share of the excess, MATS
  reserved and MATS share of the excess. When these add up to more than the collateral, it says how short it is.
- **"This week, day by day"**, in two views:
  - **By ECC calculation** (the default): one row per evening calculation, with what is reserved (split into M7 and
    MATS), the excess, and per market the 16:00, 18:00 and after-settlement limits. For MATS: the limit per auction from
    18:00 (× the number of weekend or holiday auctions it covers) and the next business day's auction.
  - **By day, weekend included:** what the member can trade each calendar day, Monday to Sunday. A business day has a
    morning limit (after settlement, from the previous business day's calculation), the 16:00 base limit and the
    evening limit. Weekends and holidays show M7 as one limit for the whole stretch, and MATS at that day's 12:00
    auction.
- **"Your limits at 12:00 each day":** a bar chart. On business days both markets after the morning settlement; M7 as
  one bar across a weekend or holiday; MATS per auction.
- **"Your settings for the Direct+ platform":** base limits and the split per market, as the member enters them in the
  Direct+ platform. Base limits are optional; the two splits add up to 100%.
- Limits are shown before any new trades. Trading uses them up.

## Collateral for a target limit

The member enters:

- **The M7 continuous limit needed,** measured either from around 18:00 (before the next morning's settlement) or after
  the next morning's settlement.
- **The MATS auctions limit needed at each day-ahead auction,** optionally also at the weekend and holiday auctions.
- **Collateral: static or optimised by day.**
  - **Static:** one amount all week, sized for its hardest day.
  - **Optimised by day:** each business day's calculation is sized on its own, with its own split when the cheapest
    split is chosen. It assumes the member changes collateral (and split) every business day, in time for that day's
    evening calculation (assumption: collateral changes run through ECC's daily payment cycle, so check the timing with
    ECC or in the Direct+ platform). The tiles show the highest day (the amount to plan for), the static amount for
    comparison, and the average held over the week, weighted by the calendar days each amount is in place.
- **Size for** (static only):
  - **The whole week** (the default): one split that meets the targets on every calculation day of the week.
  - **The weekend only:** solves only the calculation before the next weekend or holiday (usually Friday), as ECC's
    client deck does. The other days are shown with the same split, so their M7 continuous limit can fall below the
    target. The tile then says what the other days need with a split of their own.
- **Split:** "Find the split that needs the least collateral" (the default), or "Use my split below" (the slider).

How the amount is found:

- The calculator finds the smallest whole-euro collateral that covers the reserved base limits and meets every target
  on every calculation day it sizes for. The targets apply to: the M7 limit at the chosen moment on each calculation
  day; the MATS limit at every business-day auction, and at weekend and holiday auctions when that box is ticked.
- **The cheapest split:** each market's limits depend only on the collateral and that market's own share. At a given
  collateral, each market needs a smallest whole-percent share to meet its target; the collateral works with some split
  exactly when those smallest shares add up to 100% or less. The calculator finds the smallest such collateral. Any
  percentage left over then goes as close to the member's own split (the slider) as possible. ECC's own tool has no
  such search: it uses the split the member enters.
- Consequences worth explaining:
  - At the least collateral the split is usually tight: each market gets just the share it needs on its hardest day,
    and no more. Extra collateral beyond that is not spread to make other days look better.
  - A market whose base limits alone already meet its target needs 0%, and then the other market can take 100%. For
    example, a Friday's M7 limit from 16:00 is BD + 2 × NBD, which can meet a modest M7 target without any dynamic
    limit.
  - A market with a 0% split cannot get above its base limit. If a target is above it, the result is "Not reachable".
  - With one split for the whole week, the split is set by the hardest day of each market (often Friday for MATS,
    because its share is divided by 3). On easier days that market then has more than its target, and the limits on the
    page show it.
- **Tiles in this mode:**
  - "Collateral needed": the amount, which days it is sized for, the split ("least collateral" when it is the cheapest
    one), and with "the weekend only" what the other days need.
  - "With your split (x / y)": what the member's own split needs, and how much more that is than the cheapest split.
    Or, with "Use my split below", "Cheapest split (x / y)": what the cheapest split needs and how much it saves.
  - "What sets the amount": the binding constraint, the one with the least room at that collateral. It is "Base
    limits" when the collateral must at least cover the reserved base limits, "M7 continuous, <day>" when that day's
    evening calculation is the tightest, or "MATS auctions, <day>" when that day's auction is (for a weekend or holiday
    auction, it is a share of the previous business day's calculation).

## Assumptions and limits, as the page states them

- Formulas follow ECC's DCP Simulation Tool v1.3.5 and ECC's client deck (July 2025). ECC's production system may
  differ in detail; ECC's calculation always prevails.
- Limits are shown before any new trades; unsettled purchases are assumed to be paid in full the next morning.
- After a weekend or holiday the next business day's auction is back at the full limit, showing the lower of two
  readings (see the formulas).
- A shortfall is refilled first by the next morning's payment (ECC's materials do not say).
- One limit for all MATS auctions, day-ahead and intraday (until ECC confirms).
- "Optimised by day" assumes collateral and split can change every business day in time for the evening calculation.
- Not modelled: when a change of base limit takes effect (ECC's form says a decrease takes effect the same day at 16:00
  and an increase the next business day at 16:00); fees; GB markets; GO auctions.

## Beyond the calculator

- The Direct+ wallet estimate (a separate page) works out the total money a member needs: ECC collateral and
  settlement, and TenneT's balance responsible party (BRP) security and invoices. This calculator covers only ECC's
  trading limits.
- The calculator gives no trading or investment advice, and does not know a member's actual positions, trades or ECC
  account. For confirmed figures, ECC's own calculation and the Direct+ platform prevail.
