// A snapshot of the engine's output: every business day in its calendar for five parameter sets, and three sizing
// searches (tests/engine/cases.js). A refactor must leave it unchanged.
//   node --test tests/engine/snapshot.test.js    compare with tests/golden/engine.json (npm test runs it)
//   node tests/engine/snapshot.test.js --write   re-record, only after a change that is meant to change numbers: say
//                                                which numbers changed and why in the commit message
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../../src/engine.js');
const { PARAMS, SOLVES } = require('./cases.js');

const GOLDEN = path.join(__dirname, '../golden/engine.json');
const DAY_MS = 864e5;

/** The engine's output for the cases, rounded to 1e-6 (as JSON data). */
function snapshot() {
  const out = { days: {}, solves: {} };
  for (const [name, params] of Object.entries(PARAMS)) {
    out.days[name] = [];
    for (let day = E.parse(E.MIN_DATE); E.iso(day) <= E.MAX_DATE; day = new Date(day.getTime() + DAY_MS)) {
      if (!E.isBD(day)) continue;
      const result = E.day(day, params);
      if (result.nextBD <= E.MAX_DATE) out.days[name].push(result);
    }
  }
  for (const { name, week, params, tgt } of SOLVES) {
    const days = E.weekDays(week);
    out.solves[name] = { C: E.solve(days, PARAMS[params], tgt), cheapest: E.cheapestKey(days, PARAMS[params], tgt) };
  }
  const rounded = (key, value) => (typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value);
  return JSON.parse(JSON.stringify(out, rounded));
}

if (process.argv.includes('--write')) {
  const now = snapshot();
  fs.writeFileSync(GOLDEN, JSON.stringify(now, null, 1));
  const days = Object.values(now.days).reduce((count, list) => count + list.length, 0);
  console.log(`snapshot written: ${days} days, ${Object.keys(now.solves).length} sizings`);
} else {
  test('the engine gives the recorded output on every business day and sizing', () => {
    assert.deepEqual(snapshot(), JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
  });
}
