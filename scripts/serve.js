// Serves the built calculators (Railway or any Node host). No dependencies.
//   /           landing page (dist/index.html)
//   /estimate   the prospect questionnaire
//   /limits     the ECC limit calculator
//   /wallet     the full wallet calculator with its Settings view. It is for Direct+ staff, so it is only served when
//               WALLET_PASSWORD is set, behind HTTP basic auth (user name WALLET_USER, default "directplus").
//   /healthz    "ok"
// usage: npm start   (PORT defaults to 3000; the pages come from dist/, run npm run build after changing src/)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PAGES = {
  '/': 'index.html',
  '/estimate': 'wallet/standalone/direct-plus-wallet-prospect.html',
  '/limits': 'standalone/direct-plus-limit-calculator.html',
  '/wallet': 'wallet/standalone/direct-plus-wallet-calculator.html'
};
const HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function authorised(req, env) {
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const [user, ...rest] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
  return same(user, env.WALLET_USER || 'directplus') && same(rest.join(':'), env.WALLET_PASSWORD);
}
function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'content-type': 'text/plain; charset=utf-8' }, HEADERS, headers));
  res.end(body);
}
// Reads each page once from dir; env is read per request (WALLET_USER, WALLET_PASSWORD).
function createHandler(dir, env) {
  env = env || process.env;
  const cache = {};
  const page = rel => cache[rel] || (cache[rel] = fs.readFileSync(path.join(dir, rel)));
  return function (req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { allow: 'GET, HEAD' });
    const route = (req.url.split('?')[0].replace(/\/+$/, '') || '/').toLowerCase();
    if (route === '/healthz') return send(res, 200, 'ok');
    if (!(route in PAGES)) return send(res, 404, 'Not found');
    if (route === '/wallet') {
      if (!env.WALLET_PASSWORD) return send(res, 404, 'Not found');
      if (!authorised(req, env)) return send(res, 401, 'Sign in to see the full wallet calculator.', { 'www-authenticate': 'Basic realm="Direct+ wallet calculator", charset="UTF-8"' });
    }
    let body;
    try { body = page(PAGES[route]); } catch { return send(res, 500, 'The pages are not built: run npm run build.'); }
    res.writeHead(200, Object.assign({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }, HEADERS));
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
module.exports = { createHandler, PAGES };

if (require.main === module) {
  const dist = path.join(__dirname, '..', 'dist');
  const missing = Object.values(PAGES).filter(rel => !fs.existsSync(path.join(dist, rel)));
  if (missing.length) { console.error('Missing in dist/: ' + missing.join(', ') + '. Run npm run build first.'); process.exit(1); }
  const port = +process.env.PORT || 3000;
  const server = http.createServer(createHandler(dist)).listen(port, '0.0.0.0', () =>
    console.log('Direct+ calculators on port ' + port + (process.env.WALLET_PASSWORD ? ', full wallet calculator at /wallet' : '')));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
