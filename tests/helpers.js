// Assertions shared by the tests (they run with node:test: npm test).
const assert = require('node:assert/strict');

/** Two amounts of money are equal to within half a cent. */
function assertMoney(actual, expected, message) {
  assert.ok(
    typeof actual === 'number' && Math.abs(actual - expected) < 0.005,
    `${message}: got ${actual}, want ${expected}`,
  );
}

/** Two numbers are equal to within `tolerance`. */
function assertNear(actual, expected, message, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: got ${actual}, want ${expected}`);
}

module.exports = { assertMoney, assertNear };
