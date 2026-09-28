"""Runs every UI test in one browser: python3 tests/ui/run.py (npm run test:ui builds the pages first)."""

from estimate import check_estimate
from handoff import check_handoff
from limits import check_limits
from support import main
from wallet import check_wallet

if __name__ == '__main__':
    main(
        [
            ('Limit calculator', check_limits),
            ('Wallet calculator', check_wallet),
            ('Wallet estimate', check_estimate),
            ('Hand-off', check_handoff),
        ]
    )
