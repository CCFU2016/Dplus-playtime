// Snapshot of the engine's output. Use it to prove a refactor changes nothing.
//   node tests/snapshot.js --write   record the current output in tests/golden/engine.json (only after an intended change)
//   node tests/snapshot.js           compare the current output with the recording
const fs = require('fs'), path = require('path');
const E = require('../src/engine.js');
const { PARAMS, SOLVES } = require('./golden_cases.js');
const file = path.join(__dirname, 'golden/engine.json');

function run() {
  const out = { days: {}, solves: {} };
  for (const [name, p] of Object.entries(PARAMS)) {
    out.days[name] = [];
    for (let d = E.parse(E.MIN_DATE); E.iso(d) <= E.MAX_DATE; d = new Date(d.getTime() + 864e5)) {
      if (!E.isBD(d)) continue;
      const r = E.day(d, p);
      if (E.iso(E.parse(r.nextBD)) > E.MAX_DATE) continue;
      out.days[name].push(r);
    }
  }
  for (const s of SOLVES) {
    const days = E.weekDays(s.week), p = PARAMS[s.params];
    out.solves[s.name] = { C: E.solve(days, p, s.tgt), cheapest: E.cheapestKey(days, p, s.tgt) };
  }
  return JSON.parse(JSON.stringify(out, (k, v) => typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));
}

const now = run();
if (process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(now, null, 1));
  console.log('snapshot written:', Object.values(now.days).reduce((a, x) => a + x.length, 0), 'days,', Object.keys(now.solves).length, 'solves');
} else {
  const was = JSON.parse(fs.readFileSync(file, 'utf8'));
  let diffs = 0;
  const cmp = (a, b, where) => {
    if (diffs > 20) return;
    if (typeof a !== typeof b || (typeof a !== 'object' && a !== b) || a === null !== (b === null)) { diffs++; console.log('DIFF', where, JSON.stringify(a), '->', JSON.stringify(b)); return; }
    if (a && typeof a === 'object') for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) cmp(a[k], b[k], where + '.' + k);
  };
  cmp(was, now, 'engine');
  if (diffs) { process.exitCode = 1; console.log(diffs > 20 ? 'more than 20 differences' : diffs + ' differences'); }
  else console.log('engine output matches the snapshot');
}
