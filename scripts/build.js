// Builds the calculator from src/: inlines the engine into the page.
//   dist/direct-plus-limit-calculator.html        page body, as published at the claude.ai artifact link
//   dist/standalone/direct-plus-limit-calculator.html  full HTML document that opens straight from disk
// usage: node scripts/build.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'src/engine.js'), 'utf8')
  .replace(/\nif \(typeof module !== 'undefined'\) module\.exports = LimitEngine;\s*$/, '');
const page = fs.readFileSync(path.join(root, 'src/page.html'), 'utf8');
if (!page.includes('/*__ENGINE__*/')) throw new Error('src/page.html lost its /*__ENGINE__*/ marker');
const body = page.replace('/*__ENGINE__*/', () => engine);
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
const split = '</style>\n\n<div class="page">';
if (!body.includes(split)) throw new Error('src/page.html: expected "</style>" followed by <div class="page"> to split head from body');
const standalone = head + body.replace(split, '</style>\n</head>\n<body>\n<div class="page">') + '</body>\n</html>\n';
fs.mkdirSync(path.join(root, 'dist/standalone'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/direct-plus-limit-calculator.html'), body);
fs.writeFileSync(path.join(root, 'dist/standalone/direct-plus-limit-calculator.html'), standalone);
console.log('built dist/direct-plus-limit-calculator.html and dist/standalone/direct-plus-limit-calculator.html');
