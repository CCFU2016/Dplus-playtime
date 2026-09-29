// Builds the pages into dist/: each page's markup with its stylesheets and scripts inlined, so that every page is one
// self-contained HTML file. No build framework: the pages keep working as a claude.ai artifact and straight from disk.
//   ECC limit calculator:  direct-plus-limit-calculator.html              the page body, as published at the claude.ai link
//                          standalone/direct-plus-limit-calculator.html   a full document that opens from disk
//   Wallet calculator and the wallet estimate for prospects: the same pair each, under wallet/
//   Landing page for the hosted site (scripts/serve.js): index.html
// usage: node scripts/build.js [ecc|wallet|all] [--out <dir>]   (default: all, into dist/)
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const ENGINE = 'src/engine.js';
const WALLET_MODULES = [
  'dates',
  'behaviour',
  'settlement',
  'ecc-link',
  'brp',
  'tennet-account',
  'open-position',
  'settings',
  'answers',
  'wallet',
];
const WALLET = WALLET_MODULES.map((name) => `src/wallet/${name}.js`);
const SHARED = 'src/pages/shared';

// Each page: its folder (index.html, style.css and, for scripted pages, main.js) and what it inlines before its own
// style.css and main.js, in dependency order.
const PAGES = {
  limits: {
    dir: 'src/pages/limits',
    out: 'direct-plus-limit-calculator.html',
    styles: [`${SHARED}/base.css`],
    scripts: [ENGINE, `${SHARED}/ui.js`, `${SHARED}/handoff.js`],
  },
  wallet: {
    dir: 'src/pages/wallet',
    out: 'wallet/direct-plus-wallet-calculator.html',
    styles: [`${SHARED}/base.css`, `${SHARED}/wallet.css`],
    scripts: [ENGINE, ...WALLET, `${SHARED}/ui.js`],
  },
  estimate: {
    dir: 'src/pages/estimate',
    out: 'wallet/direct-plus-wallet-prospect.html',
    styles: [`${SHARED}/base.css`, `${SHARED}/wallet.css`],
    scripts: [ENGINE, ...WALLET, `${SHARED}/ui.js`, `${SHARED}/handoff.js`],
  },
  home: {
    dir: 'src/pages/home',
    out: 'index.html',
    styles: [`${SHARED}/base.css`],
    scripts: [],
    standalone: false, // already a full document
  },
};

// Modules end with a Node export line; in the page each module is just a global.
const stripExport = (source) =>
  source.replace(/\nif \(typeof module !== 'undefined'\) module\.exports = \w+;\s*$/, '\n');

/** The page's markup with its stylesheets and scripts in place of the /*__STYLES__*\/ and /*__SCRIPTS__*\/ markers. */
function assemble(page) {
  const template = read(`${page.dir}/index.html`);
  const styles = [...page.styles, `${page.dir}/style.css`].map(read).join('\n');
  const own = fs.existsSync(path.join(ROOT, page.dir, 'main.js')) ? [`${page.dir}/main.js`] : [];
  const scripts = [...page.scripts, ...own].map((file) => stripExport(read(file))).join('\n');
  for (const marker of ['/*__STYLES__*/', ...(scripts ? ['/*__SCRIPTS__*/'] : [])]) {
    if (!template.includes(marker)) throw new Error(`${page.dir}/index.html has no ${marker} marker`);
  }
  return template.replace('/*__STYLES__*/', () => styles).replace('/*__SCRIPTS__*/', () => scripts);
}

// A full document around a page body, for opening the file straight from disk.
const HEAD = `<!doctype html>
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
function standalone(body, name) {
  const split = '</style>\n\n<div class="page">';
  if (!body.includes(split))
    throw new Error(`${name}: expected "</style>" followed by <div class="page"> to split head from body`);
  return `${HEAD}${body.replace(split, '</style>\n</head>\n<body>\n<div class="page">')}</body>\n</html>\n`;
}

function write(out, file, text) {
  const target = path.join(out, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
  return file;
}

/** Builds one page into `out`: the file itself and, for a page body, its standalone document. Returns the files. */
function buildPage(name, out) {
  const page = PAGES[name];
  const body = assemble(page);
  const files = [write(out, page.out, body)];
  if (page.standalone !== false) {
    const dir = path.dirname(page.out);
    files.push(write(out, path.join(dir, 'standalone', path.basename(page.out)), standalone(body, name)));
  }
  return files;
}

const buildEcc = (out) => buildPage('limits', out);
const buildWallet = (out) => [...buildPage('wallet', out), ...buildPage('estimate', out)];
const buildIndex = (out) => buildPage('home', out);

module.exports = { PAGES, buildPage, buildEcc, buildWallet, buildIndex };

if (require.main === module) {
  const { values, positionals } = parseArgs({ options: { out: { type: 'string' } }, allowPositionals: true });
  const out = values.out ? path.resolve(values.out) : path.join(ROOT, 'dist');
  const what = positionals[0] || 'all';
  const builders = { ecc: [buildEcc], wallet: [buildWallet], all: [buildEcc, buildWallet, buildIndex] }[what];
  if (!builders || positionals.length > 1)
    throw new Error('usage: node scripts/build.js [ecc|wallet|all] [--out <dir>]');
  const built = builders.flatMap((build) => build(out));
  console.log(`built ${built.map((file) => path.relative(ROOT, path.join(out, file))).join(', ')}`);
}
