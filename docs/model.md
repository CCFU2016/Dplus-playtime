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

The engine currently implements EPEX_CONTINUOUS_EUR and EPEX_AUCTION_EUR only.

What the VBA does for markets with their own trading calendar (the GO and capacity auctions):

- Base limits only count on that market's trading days. See `DistributeValues`, around VBA line 1030, and `ECCCalendar.IsTradingDay`.
- The market is only included when the next business day is one of its trading days (`clsCalcForBD.Initiate`).
- The limit reset count is fixed at 1, around VBA line 5500.

## Exchange-side rules worth knowing (ECC Risk Management Services Manual v056)

- **§3.10 / p.53, EPEX auction:** one limit per auction day, 16:00 to 16:00, covering **day-ahead and intraday auctions**, continental and GB. An order's exposure is the maximum of price × quantity over its bid curve.
- **§3.9, EPEX GO:**
  - The limit is the maximum payment per auction and must cover every production month auctioned.
  - It must be above zero to take part.
  - Only buy orders are checked; sell orders don't offset them.
  - If the limit is lowered below the orders already firmed, those orders fall back to draft.
  - The limit is also used as a pre-auction margin (end of day two days before and one day before the auction; zero on auction day). How this interacts with DCP collateral is not documented.
