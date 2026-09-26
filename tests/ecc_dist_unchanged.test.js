// The ECC calculator's published files must not change by accident (docs/wallet-brief.md §2): the claude.ai
// publishing flow and the member deck depend on them. Builds them into a temporary directory and compares their
// SHA-256 with tests/golden/ecc_dist.sha256, then checks the committed dist/ files against the same hashes.
//   node tests/ecc_dist_unchanged.test.js --write   re-record (only on purpose; say why in the commit message)
// The golden file is in `shasum -a 256` format, so `shasum -a 256 -c tests/golden/ecc_dist.sha256` also works.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { buildEcc } = require('../scripts/build.js');
const root = path.join(__dirname, '..'), golden = path.join(__dirname, 'golden/ecc_dist.sha256');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-dist-'));
let built;
try { built = buildEcc(tmp).map(rel => ({ file: 'dist/' + rel, hash: sha(path.join(tmp, rel)) })); }
finally { fs.rmSync(tmp, { recursive: true, force: true }); }

if (process.argv.includes('--write')) {
  fs.writeFileSync(golden, built.map(b => b.hash + '  ' + b.file).join('\n') + '\n');
  console.log('recorded', built.length, 'hashes in tests/golden/ecc_dist.sha256');
} else {
  const want = {};
  fs.readFileSync(golden, 'utf8').trim().split('\n').forEach(l => { const m = l.match(/^([0-9a-f]{64}) {2}(.+)$/); if (m) want[m[2]] = m[1]; });
  let fails = 0;
  const check = (ok, what) => { if (!ok) { fails++; console.log('FAIL', what); } };
  check(built.length === Object.keys(want).length, 'the build writes exactly the recorded files');
  built.forEach(b => {
    check(want[b.file] === b.hash, b.file + ': a fresh build matches the recorded hash');
    check(fs.existsSync(path.join(root, b.file)) && sha(path.join(root, b.file)) === want[b.file], b.file + ': the committed file matches the recorded hash');
  });
  if (fails) process.exitCode = 1;
  console.log(fails ? fails + ' failures' : 'ECC dist unchanged: ' + built.length + ' files match their recorded SHA-256');
}
