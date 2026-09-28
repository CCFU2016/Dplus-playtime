// The built pages in dist/:
//   1. the ECC calculator's files must not change by accident: the claude.ai publishing flow and the member deck depend
//      on them, so their SHA-256 is recorded in tests/golden/ecc_dist.sha256;
//   2. every committed file in dist/ is what the build makes from src/ (after a change in src/, run npm run build).
//   node --test tests/dist.test.js    check (npm test runs it)
//   node tests/dist.test.js --write   re-record the ECC files' hashes, only on purpose: say why in the commit message
// The golden file is in `shasum -a 256` format, so `shasum -a 256 -c tests/golden/ecc_dist.sha256` also works.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildEcc, buildWallet, buildIndex } = require('../scripts/build.js');

const ROOT = path.join(__dirname, '..');
const GOLDEN = path.join(__dirname, 'golden/ecc_dist.sha256');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Builds into a temporary directory; returns each file's place in dist/ and its SHA-256. */
function freshBuild(...builders) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dplus-dist-'));
  try {
    return builders
      .flatMap((build) => build(dir))
      .map((file) => ({ file: `dist/${file}`, hash: sha256(path.join(dir, file)) }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function recordedHashes() {
  const hashes = {};
  for (const line of fs.readFileSync(GOLDEN, 'utf8').trim().split('\n')) {
    const [hash, file] = line.split('  ');
    hashes[file] = hash;
  }
  return hashes;
}

if (process.argv.includes('--write')) {
  const built = freshBuild(buildEcc);
  fs.writeFileSync(GOLDEN, built.map(({ hash, file }) => `${hash}  ${file}\n`).join(''));
  console.log(`recorded ${built.length} hashes in tests/golden/ecc_dist.sha256`);
} else {
  test("the ECC calculator's files have their recorded SHA-256", () => {
    const recorded = recordedHashes();
    const built = freshBuild(buildEcc);
    assert.deepEqual(
      built.map(({ file }) => file).sort(),
      Object.keys(recorded).sort(),
      'the build writes the recorded files',
    );
    for (const { file, hash } of built) {
      assert.equal(hash, recorded[file], `${file}: a fresh build matches the recorded hash`);
    }
  });

  test('every file in dist/ is what the build makes from src/ (else run npm run build)', () => {
    for (const { file, hash } of freshBuild(buildEcc, buildWallet, buildIndex)) {
      const committed = path.join(ROOT, file);
      assert.ok(fs.existsSync(committed), `${file} is in dist/`);
      assert.equal(sha256(committed), hash, `${file} matches a fresh build`);
    }
  });
}
