// Builds the calculators from src/: inlines the engine (and the wallet modules) into the pages.
//   ECC limit calculator (src/page.html):
//     dist/direct-plus-limit-calculator.html              page body, as published at the claude.ai artifact link
//     dist/standalone/direct-plus-limit-calculator.html   full HTML document that opens straight from disk
//   Wallet calculator (src/wallet/page.html, skipped until it exists):
//     dist/wallet/direct-plus-wallet-calculator.html and dist/wallet/standalone/direct-plus-wallet-calculator.html
// usage: node scripts/build.js [ecc|wallet|all] [--out <dir>]   (default: all, into dist/)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
// Wallet modules in dependency order; each ends with the same node export line as the engine.
const WALLET_MODULES = ['behaviour', 'settlement', 'ecc-link', 'brp', 'tennet-account', 'wallet'];

function stripExport(src) { return src.replace(/\nif \(typeof module !== 'undefined'\) module\.exports = \w+;\s*$/, ''); }
const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
  :root { color-scheme: light; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
  body { margin: 0; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
`;
function standalone(body, src) {
  const split = '</style>\n\n<div class="page">';
  if (!body.includes(split)) throw new Error(src + ': expected "</style>" followed by <div class="page"> to split head from body');
  return head + body.replace(split, '</style>\n</head>\n<body>\n<div class="page">') + '</body>\n</html>\n';
}
function write(out, rel, text) {
  const f = path.join(out, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  return rel;
}

function buildEcc(out) {
  const page = read('src/page.html');
  if (!page.includes('/*__ENGINE__*/')) throw new Error('src/page.html lost its /*__ENGINE__*/ marker');
  const body = page.replace('/*__ENGINE__*/', () => stripExport(read('src/engine.js')));
  return [write(out, 'direct-plus-limit-calculator.html', body),
          write(out, 'standalone/direct-plus-limit-calculator.html', standalone(body, 'src/page.html'))];
}
function buildWallet(out) {
  if (!fs.existsSync(path.join(root, 'src/wallet/page.html'))) return [];
  const page = read('src/wallet/page.html');
  ['/*__ENGINE__*/', '/*__WALLET__*/'].forEach(m => { if (!page.includes(m)) throw new Error('src/wallet/page.html lost its ' + m + ' marker'); });
  const wallet = WALLET_MODULES.map(m => stripExport(read('src/wallet/' + m + '.js'))).join('\n');
  const body = page.replace('/*__ENGINE__*/', () => stripExport(read('src/engine.js'))).replace('/*__WALLET__*/', () => wallet);
  return [write(out, 'wallet/direct-plus-wallet-calculator.html', body),
          write(out, 'wallet/standalone/direct-plus-wallet-calculator.html', standalone(body, 'src/wallet/page.html'))];
}

module.exports = { buildEcc, buildWallet };

if (require.main === module) {
  const args = process.argv.slice(2), o = args.indexOf('--out');
  const out = o >= 0 ? path.resolve(args[o + 1]) : path.join(root, 'dist');
  const what = args.find((a, i) => !a.startsWith('--') && !(o >= 0 && i === o + 1)) || 'all';
  if (!['ecc', 'wallet', 'all'].includes(what)) throw new Error('usage: node scripts/build.js [ecc|wallet|all] [--out <dir>]');
  const built = [];
  if (what !== 'wallet') built.push(...buildEcc(out));
  if (what !== 'ecc') {
    const w = buildWallet(out);
    if (!w.length) console.log('wallet: skipped, src/wallet/page.html does not exist yet');
    built.push(...w);
  }
  if (built.length) console.log('built ' + built.map(f => path.relative(root, path.join(out, f))).join(' and '));
}
