# Open questions for ECC

These are to ask Florian Dorgerloh (ECC). Until he answers, the engine's choice is an assumption,
and the page must say so.

| # | Question | Engine's current choice |
|---|---|---|
| 1 | **Monday after a weekend.** On Monday morning after settlement, which does ECC apply to the day-ahead limit? (a) Friday evening's limit plus the payment received, with the unused Saturday and Sunday auction limit added back; or (b) a fresh calculation using Monday's base-limit reserve. In the deck example (a) gives €280k continuous / €190k day-ahead, and (b) gives €284k / €186k. ECC's Excel tool gives €90k for day-ahead, which Florian said is wrong. | `min(carry, level)` for day-ahead (€186k); `carry` for continuous. |
| 2 | **Thursday/Friday reserve.** In the deck example (continuous BD €20k / NBD €10k, day-ahead €10k / €10k) the engine reserves €100k: continuous `2·BD + 2·NBD` = €60k, following p.7, plus day-ahead €40k. Is that right, or is it €80k, with the weekend NBD not reserved twice for continuous? | €100k, following p.7. |
| 3 | **Base-limit timing.** Form O09 says a decrease takes effect the same day at 16:00 and an increase the next business day at 16:00. The page doesn't model this latency yet. | Not modelled. |
| 4 | **Intraday auctions.** The manual (§3.10) says the EPEX auction limit covers day-ahead **and** intraday auctions. Does the DCP dynamic limit for "auction" work the same way, one shared limit? | Labelled "day-ahead" only. |
| 5 | **GO orders held over 16:00.** The GO order book opens at 17:00 and closes at 11:00 two days later (and over a weekend when it opens on a Friday, e.g. 8–12 May 2026). Which DCP limit covers a firmed GO order across the 16:00 reset in between? Is it reserved as base limit? | Not modelled yet. |
| 6 | **GO dates in DCP.** ECC's tool marks GO trading days with dates that look like the order-book **closing** day (e.g. 2025-01-22, a Wednesday). Is the GO base limit needed on the day before the close, the day the book opens, or both? | Not modelled yet. |
| 7 | **GO pre-auction margin.** The manual (§3.9) says the GO trading limit is charged as a pre-auction margin two days and one day before the auction. For a DCP, is that on top of the DCP collateral use, or the same thing? | Not modelled yet. |
| 8 | **ECC's deck says GO auctions are "once a month".** EPEX runs two a month (2025 and 2026). Presumably the deck is out of date; confirm nothing else on that slide changed. | Uses EPEX's calendar. |
