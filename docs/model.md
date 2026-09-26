# How the engine models ECC's DCP limits

The main source is ECC's DCP client deck (July 2025, `reference/ecc/`); page numbers below refer to it.
ECC's Excel tool (`DCP_SimulationTool4Clients.xlsm`, VBA extracted next to it) is the second source.

## The daily cycle (p.2–4)

- **16:00, every business day.** The limit resets to the **base limit (BL)** the member set per market, and ECC starts calculating exposure from the previous limit period.
- **Evening update, around 18:00 (best effort, not guaranteed).** ECC adds the dynamic limit:
  `dynamic = max(C − BLR − OR, 0) × key ÷ resetDays`
  - `C`: collateral.
  - `OR`: open risk, i.e. unpaid purchases.
  - `key`: the member's split between markets (percentages summing to 100).
  - `BLR`: base limit requirement, below.
  - `resetDays`: 1 for continuous markets. For auction markets it is the number of days until the next business day, because auction markets reset every calendar day ("for weekend a third, but that third is reset every day", p.5).
- **Next morning (settlement around 09:30, limit by 10:45).** Paid purchases × key are added back.

## Base limit requirement (p.7, p.9)

`BLR` = today's base limit + next business day's base limit, per market. ECC reserves both, because the next one goes live at 16:00 before ECC has seen today's trades.

- **Continuous:** BL for a gap of `g` days = `BD + (g − 1) × NBD`. With a weekend ahead (Thursday and Friday) this becomes `2·BD + 2·NBD`.
- **Auction:** `BD + 3 × max(BD, NBD)` before a weekend.

Here BD is the business-day base limit and NBD the non-business-day base limit.

## Monday after a weekend (open, see open-questions.md)

The engine takes `min(carry, level)` for the day-ahead auction on the first business day after a gap:

- `carry` = Friday's evening limit × gap + payment × key. This is the unused weekend limit carried over.
- `level` = BD + max(C − Monday's reserve, 0) × key. This is back to the normal weekday level.

Continuous stays at `carry`. ECC's p.10 example gives Monday = 9, and the engine reproduces it. ECC's Excel tool gives a lower figure, which Florian (ECC) said is wrong.

## Markets in ECC's tool (`reference/ecc/markets_table.csv`)

| Market | Reset | Auction flag | Own trading calendar | Currency |
|---|---|---|---|---|
| EPEX_CONTINUOUS_EUR / _GBP | business day | 0 | no | EUR / GBP |
| EPEX_AUCTION_EUR / _GBP | day | 0 | no | EUR / GBP |
| EPEX_GOEU_EUR (GO auctions) | day | 1 | yes | EUR |
| EPEX_CPCTY_EUR (capacity auctions) | day | 1 | yes | EUR |
| HUPX_AUCTION / HUPX_CONTINUOUS | day / business day | 0 | no | EUR |
| BSP_AUCTION / BSP_SEEPX_CONT | day / business day | 0 | no | EUR |
| SEMOPX_AUCTION_EUR / _GBP | day | 0 | no | EUR / GBP |
| EEX_GAS_SPOT_EUR | business day | 0 | no | EUR |
| EEX_GOFR_POWER / _GAS, EEX_NEHS | day | 1 | yes | EUR |

The engine currently implements EPEX_CONTINUOUS_EUR and EPEX_AUCTION_EUR only. `LimitEngine.MARKETS` holds
their definitions from this table (`tests/markets.test.js` checks them against it). The rules follow from the
reset column: "business day" markets work like continuous, "day" markets like the day-ahead auction.

## Engine API with a list of markets

`day(t, p)` takes either form:

- `p = { C, OR, markets: [{ id, bd, nbd, key }, ...] }` gives one result per market in `r.markets[id]`: `blr`, `share`, `l16`, `l18`, `l09`, `resetDays`, and `auctions` for "day" markets.
- `p = { C, OR, cont: {...}, da: {...} }`, the original two-market form, gives the original result (`cont`, `da`, `blrC`, …). The page and the deck copy use this form.

`solve`, `binding` and `cheapestKey` take targets per market id with the first form (`{ <id>: { limit, measure } }` for business-day markets, `{ <id>: { limit, nonBD } }` for day markets), and the original `{ cont, contMeasure, da, daNonBD }` with the second.

**Cheapest split.** A market's limits depend only on the collateral and its own key. So at collateral C each market has a smallest whole-% key that meets its target, and C works with some split exactly when those keys add up to 100% or less. `cheapestKey` bisects on C for the smallest such amount. It then places the leftover percentage as close to the member's current split as it can: markets below their minimum are raised, and the others give up the difference in proportion to their spare share. With two markets this gives the same result as trying every split from 0 to 100 (the previous method), about twelve times faster. ECC's tool has no such search: it uses the split the member enters.

## Markets with their own trading calendar (GO, capacity auctions): not implemented

EPEX GO auctions were left out for now (September 2026). What ECC's tool does, for when they come back (line numbers in `DCP_SimulationTool4Clients_vba.txt`):

- **Trading days** are the dates in the tool's calendar sheet, matched exactly (`IsTradingDay`, 1703). ECC's 2025 GO dates are the order-book closing days: 18 Wednesdays and 4 Tuesdays, the same pattern as EPEX's closing days. EPEX's order book never opens on those weekdays.
- **The market is only included** in a calculation when the next business day is one of its trading days (`clsCalcForBD.Initiate`, 1220–1224). For a Wednesday close that is Tuesday's calculation only. GO then has a limit from Tuesday 16:00 until the close at 11:00 on Wednesday, and none between the Monday 17:00 opening and Tuesday 16:00 (open question 5).
- **Base limit requirement:** base limits count only on trading days (`DistributeValues`, 1048–1051), and the Auction Flag drops the last day of the window from the reserve (`CalcExposure`, 1160). So GO reserves **one** base limit, the closing day's, not today's plus the next business day's.
- **Reset count** is fixed at 1 for EPEX_GOEU_EUR and EPEX_CPCTY_EUR (5500–5504). The check meant for EEX_GOFR (5502) never matches a market name, so the EEX GO markets divide by the gap to the next business day.
- **On days the market is not included,** its key share of the excess goes to no market: each market's dynamic limit is its own `excess × key ÷ reset days` (5534), with no redistribution.
- **GO-only member:** the evening limit is base limit + (C − base limit − open risk) = C − open risk. This matches the deck (p.15: "the limit will be equal to the posted collateral").

## Exchange-side rules worth knowing (ECC Risk Management Services Manual v056)

- **§3.10 / p.53, EPEX auction:** one limit per auction day, 16:00 to 16:00, covering **day-ahead and intraday auctions**, continental and GB. An order's exposure is the maximum of price × quantity over its bid curve.
- **§3.9, EPEX GO:**
  - The limit is the maximum payment per auction and must cover every production month auctioned.
  - It must be above zero to take part.
  - Only buy orders are checked; sell orders don't offset them.
  - If the limit is lowered below the orders already firmed, those orders fall back to draft.
  - The limit is also used as a pre-auction margin (end of day two days before and one day before the auction; zero on auction day). How this interacts with DCP collateral is not documented.

## The wallet calculator

`src/wallet/` builds a second page on this engine: what a Direct+ member needs in total (ECC collateral and
settlement, TenneT BRP security and invoices). It uses the engine's public API only, with its own solver for
open risk that changes day by day. See `docs/wallet-model.md`.
