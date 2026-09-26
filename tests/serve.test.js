// The web server for the hosted site (scripts/serve.js), on pages built fresh into a temp dir:
//  1. the public routes serve the right page; unknown routes 404, other methods 405;
//  2. /wallet is hidden without WALLET_PASSWORD and needs the right basic-auth login with it;
//  3. the public pages carry no personal names from the repo's decision notes.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { buildEcc, buildWallet, buildIndex } = require('../scripts/build.js');
const { createHandler } = require('../scripts/serve.js');
const t = require('./wallet/assert.js')('serve');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dplus-serve-'));
buildEcc(dir); buildWallet(dir); buildIndex(dir);
const env = {};
const server = http.createServer(createHandler(dir, env));
const basic = (u, p) => 'Basic ' + Buffer.from(u + ':' + p).toString('base64');

server.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = (p, o) => fetch(base + p, o).then(async r => ({ status: r.status, type: r.headers.get('content-type'), auth: r.headers.get('www-authenticate'), text: await r.text() }));
  try {
    // 1. Public routes
    const home = await get('/');
    t.ok(home.status === 200 && /text\/html/.test(home.type) && home.text.includes('Direct+ calculators'), '/ serves the landing page');
    t.ok(home.text.includes('href="/estimate"') && home.text.includes('href="/limits"'), 'the landing page links both calculators');
    const est = await get('/estimate');
    t.ok(est.status === 200 && est.text === fs.readFileSync(path.join(dir, 'wallet/standalone/direct-plus-wallet-prospect.html'), 'utf8'), '/estimate serves the prospect questionnaire');
    const lim = await get('/limits');
    t.ok(lim.status === 200 && lim.text === fs.readFileSync(path.join(dir, 'standalone/direct-plus-limit-calculator.html'), 'utf8'), '/limits serves the ECC limit calculator');
    t.ok((await get('/estimate/?x=1')).status === 200 && (await get('/Limits')).status === 200, 'a trailing slash, a query or capitals still find the page');
    t.eq((await get('/healthz')).text, 'ok', '/healthz');
    t.eq((await get('/dist/index.html')).status, 404, 'files are only served by route');
    t.eq((await get('/../package.json')).status, 404, 'no path traversal');
    t.eq((await get('/', { method: 'POST' })).status, 405, 'POST is refused');
    const head = await get('/estimate', { method: 'HEAD' });
    t.ok(head.status === 200 && head.text === '', 'HEAD answers without a body');

    // 2. /wallet
    t.eq((await get('/wallet')).status, 404, '/wallet is hidden without WALLET_PASSWORD');
    env.WALLET_PASSWORD = 'correct horse';
    const noAuth = await get('/wallet');
    t.ok(noAuth.status === 401 && /^Basic /.test(noAuth.auth || ''), '/wallet asks for a login');
    t.eq((await get('/wallet', { headers: { authorization: basic('directplus', 'wrong') } })).status, 401, 'a wrong password is refused');
    t.eq((await get('/wallet', { headers: { authorization: basic('someone', 'correct horse') } })).status, 401, 'a wrong user name is refused');
    const ok = await get('/wallet', { headers: { authorization: basic('directplus', 'correct horse') } });
    t.ok(ok.status === 200 && ok.text.includes('Settings'), 'the right login opens the full wallet calculator');
    env.WALLET_USER = 'ops';
    t.eq((await get('/wallet', { headers: { authorization: basic('ops', 'correct horse') } })).status, 200, 'WALLET_USER sets the user name');

    // 3. No personal names on the public pages
    for (const p of ['/', '/estimate', '/limits']) {
      const text = (await get(p)).text;
      t.ok(!/\bNiki\b|Florian|Dorgerloh/.test(text), p + ' carries no personal names');
    }
  } catch (e) {
    t.ok(false, 'request failed: ' + e.message);
  }
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  t.done();
});
