# Sources

In `reference/`:
- `ecc/20250507_DCP_Client_second_Introduction_Slidedecks.pdf`: ECC DCP client deck (July 2025). Timings p.2–4, reset rules p.5, base-limit requirement p.7 and p.9, worked examples p.8 and p.10, delivery risk p.11, nEHS p.13–14, GO p.15.
- `ecc/DCP_SimulationTool4Clients.xlsm`: ECC's DCP limit tool. `DCP_SimulationTool4Clients_vba.txt` is its extracted VBA; `markets_table.csv` and `separate_trading_day_calendars_2025.csv` are extracted from its sheets.
- `ecc/ECC_Risk_Management_Services_056_valid_from_20260701.pdf`: exchange-side trading limits per market (not DCP-specific). EPEX auction §3.10, continuous §3.11–3.12, GO §3.9.
- `epex/go_auction_dates_2026.csv`: transcribed from EPEX's "GOs Auction Dates 2026 Overview" (last updated 1 June 2026). Check it against the PDF before relying on it.

Added for the wallet calculator (`docs/wallet-brief.md`, `docs/wallet-model.md`), all retrieved 26 September 2026:
- `ecc/ecc_connected-bank-account-setup-dcp-eur-gbp-2025-2026_2025-12-08.pdf`: ECC, *Linking a Connected Bank Settlement Account with ECC, EUR+GBP, 2025/2026* (published 8 Dec 2025). Settlement timing (p.3) and account requirements (p.6).
- `ecc/web_dcp-risk-management_2026-09-26.(html|txt)` and `ecc/web_dcp-payments_2026-09-26.(html|txt)`: snapshots of ECC's DCP Risk Management and DCP Payments pages (collateral forms, €40m guarantee-only limit, default fund, cap limit, 16:00 cut, net payment per member).
- `tennet/systeemcode-elektriciteit_wetten-overheid_art-10.8-10.26-10.27-10.29_2026-09-26.txt`: the Systeemcode elektriciteit 2026 text in force (wetten.overheid.nl, BWBR0052336, valid from 9 July 2026) for art. 10.8, 10.26, 10.27 and 10.29, verbatim. The full page is saved next to it as `.html`.
- `tennet/acm_systeemcode-elektriciteit-2026-h10-h11_vergelijking_BR-2025-2203_2026-02-20.pdf`: ACM's comparison document for chapters 10–11 (February 2026). It has three text columns, so read the current text from the `.txt` above.
- `tennet/acm-25-196985_gecorrigeerd-ontwerpbesluit_2026-08-25.pdf`: ACM corrected draft decision ACM/25/196985 of 25 Aug 2026 (new art. 10.8: 3A + 4B + 6C + 6D, minimum €96,000, from 1 Jan 2027). `tennet/acm-25-196985_ontwerpbesluit-oorspronkelijk-vervallen_2026-08-17.pdf` is the superseded version, with the wrong formula "A + 4B + 6C + 6D"; don't use it.
- `tennet/nbnl_BR-2024-2077_codewijzigingsvoorstel-financiele-zekerstelling-brps_2025-07-02.pdf`: the system operators' proposal BR-2024-2077 of 2 July 2025. It uses the old Netcode numbering (see `docs/wallet-brief.md` §10).
- `tennet/tennet_imbalance-prices-2025_daily-averages_2026-09-29.csv`: TenneT's final imbalance prices for 2025, averaged per local day (Europe/Amsterdam) over the 15-minute periods, each weighted equally. Columns: the shortage price a short BRP pays, the surplus price a long BRP receives, and the number of periods (365 days, 35,040 periods). Made on 29 Sep 2026 by `~/imbalance_analysis/nl_daily_export.py` from TenneT's settlement-price export `settlement_prices_202412312300_202512312300_CET.csv` (exported 4 Apr 2026). It sets the open-position buffer's stress prices (`docs/wallet-model.md` §4.5).

Not retrievable automatically: TenneT's BRP recognition page (tennet.eu blocks scripted access), TenneT's "inzake rekening" document, and TenneT's billing terms for imbalance invoices.

Online:
- ECC DCP risk management: https://www.ecc.de/en/access/dcp-clearing-members/dcp-risk-management
- ECC DCP deck: https://www.ecc.de/fileadmin/ECC/Downloads/Access/DCP_Clearing_Members/20250507_DCP_Client_second_Introduction_Slidedecks_.pdf
- ECC Risk Management Services Manual v056: https://www.ecc.de/fileadmin/ECC/Downloads/Member_Section/User_Guides_and_Manuals/ECC_Risk_Management_Services_Manual/ECC_Risk_Management_Services_056_valid_from_20260701.pdf
- EPEX GO auction dates 2026: https://www.epexspot.com/sites/default/files/download_center_files/GOs%20Auction%20Dates%202026%20Overview.pdf
- ECC Clearing Circular 04/2026 (GB delivery risk): https://www.ecc.de/en/newsroom/detail?tx_news_pi1%5Baction%5D=detail&tx_news_pi1%5Bcontroller%5D=News&tx_news_pi1%5Bnews%5D=14837&cHash=8ddd0b1719875fda7f8dbb0466c6347d
- ECC forms O09 (limit adjustment), O10/O11 (collateral): https://www.ecc.de/en/access/admission-forms
