// Serves the built calculators (Railway or any Node host). No dependencies.
//   /           the landing page
//   /estimate   the wallet estimate for prospects
//   /limits     the ECC limit calculator
//   /wallet     the full wallet calculator with its Settings view. It is for Direct+ staff, so it is only served when
//               WALLET_PASSWORD is set, behind HTTP basic auth (user name WALLET_USER, default "directplus").
//   /healthz    "ok"
// usage: npm start   (PORT defaults to 3000; the pages come from dist/: run npm run build after changing src/)
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PAGES = {
  '/': 'index.html',
  '/estimate': 'wallet/standalone/direct-plus-wallet-prospect.html',
  '/limits': 'standalone/direct-plus-limit-calculator.html',
  '/wallet': 'wallet/standalone/direct-plus-wallet-calculator.html',
};
const HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };
const DEFAULT_USER = 'directplus';

/** Compares two secrets in constant time, whatever their lengths (their SHA-256 digests have the same length). */
function sameSecret(given, expected) {
  const digest = (text) => crypto.createHash('sha256').update(String(text)).digest();
  return crypto.timingSafeEqual(digest(given), digest(expected));
}

function signedIn(req, env) {
  const match = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!match) return false;
  const [user, ...password] = Buffer.from(match[1], 'base64').toString('utf8').split(':');
  const rightUser = sameSecret(user, env.WALLET_USER || DEFAULT_USER);
  const rightPassword = sameSecret(password.join(':'), env.WALLET_PASSWORD);
  return rightUser && rightPassword;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...HEADERS, ...headers });
  res.end(body);
}

/** The request handler, for the pages built in `dir`. Each page is read once; `env` is read per request (WALLET_USER,
 *  WALLET_PASSWORD). */
function createHandler(dir, env = process.env) {
  const cache = new Map();
  const page = (file) => {
    if (!cache.has(file)) cache.set(file, fs.readFileSync(path.join(dir, file)));
    return cache.get(file);
  };
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return send(res, 405, 'Method not allowed', { allow: 'GET, HEAD' });
    const route = (req.url.split('?')[0].replace(/\/+$/, '') || '/').toLowerCase();
    if (route === '/healthz') return send(res, 200, 'ok');
    if (!Object.hasOwn(PAGES, route)) return send(res, 404, 'Not found');
    if (route === '/wallet') {
      if (!env.WALLET_PASSWORD) return send(res, 404, 'Not found');
      if (!signedIn(req, env)) {
        return send(res, 401, 'Sign in to see the full wallet calculator.', {
          'www-authenticate': 'Basic realm="Direct+ wallet calculator", charset="UTF-8"',
        });
      }
    }
    let body;
    try {
      body = page(PAGES[route]);
    } catch (error) {
      console.error(`Cannot read ${PAGES[route]}: ${error.message}`);
      return send(res, 500, 'The pages are not built: run npm run build.');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', ...HEADERS });
    return res.end(req.method === 'HEAD' ? undefined : body);
  };
}

module.exports = { createHandler, PAGES };

if (require.main === module) {
  const dist = path.join(__dirname, '..', 'dist');
  const missing = Object.values(PAGES).filter((file) => !fs.existsSync(path.join(dist, file)));
  if (missing.length) {
    console.error(`Missing in dist/: ${missing.join(', ')}. Run npm run build first.`);
    process.exit(1);
  }
  const port = Number(process.env.PORT) || 3000;
  const server = http.createServer(createHandler(dist)).listen(port, '0.0.0.0', () => {
    const wallet = process.env.WALLET_PASSWORD ? ', full wallet calculator at /wallet' : '';
    console.log(`Direct+ calculators on port ${port}${wallet}`);
  });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
