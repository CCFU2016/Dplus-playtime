// The web server of the hosted site (scripts/serve.js), on pages built fresh into a temporary directory.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { buildEcc, buildWallet, buildIndex } = require('../scripts/build.js');
const { createHandler } = require('../scripts/serve.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dplus-serve-'));
const env = {};
const server = http.createServer(createHandler(dir, env));
let base = '';

const basicAuth = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
async function get(route, options) {
  const response = await fetch(base + route, options);
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    auth: response.headers.get('www-authenticate'),
    text: await response.text(),
  };
}
const built = (file) => fs.readFileSync(path.join(dir, file), 'utf8');

before(async () => {
  buildEcc(dir);
  buildWallet(dir);
  buildIndex(dir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the landing page links both calculators and says it is a proof of concept', async () => {
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(home.type, /text\/html/);
  assert.ok(home.text.includes('Direct+ calculators'), 'the landing page');
  assert.ok(home.text.includes('href="/estimate"') && home.text.includes('href="/limits"'), 'links both calculators');
  assert.ok(home.text.includes('Proof of concept by NVS, not a finished product'), 'the proof-of-concept disclaimer');
});

test('the public routes serve their pages', async () => {
  assert.equal((await get('/estimate')).text, built('wallet/standalone/direct-plus-wallet-prospect.html'), '/estimate');
  assert.equal((await get('/limits')).text, built('standalone/direct-plus-limit-calculator.html'), '/limits');
  assert.equal((await get('/estimate/?x=1')).status, 200, 'a trailing slash and a query');
  assert.equal((await get('/Limits')).status, 200, 'capitals');
  assert.equal((await get('/healthz')).text, 'ok', '/healthz');
  const head = await get('/estimate', { method: 'HEAD' });
  assert.deepEqual([head.status, head.text], [200, ''], 'HEAD answers without a body');
});

test('anything else is refused', async () => {
  assert.equal((await get('/dist/index.html')).status, 404, 'files are only served by route');
  assert.equal((await get('/../package.json')).status, 404, 'no path traversal');
  assert.equal((await get('/', { method: 'POST' })).status, 405, 'POST');
});

test('/wallet is hidden without WALLET_PASSWORD, and needs the right login with it', async () => {
  assert.equal((await get('/wallet')).status, 404, 'hidden without WALLET_PASSWORD');
  env.WALLET_PASSWORD = 'correct horse';
  const noLogin = await get('/wallet');
  assert.equal(noLogin.status, 401, 'asks for a login');
  assert.match(noLogin.auth || '', /^Basic /);
  const as = (user, password) => get('/wallet', { headers: { authorization: basicAuth(user, password) } });
  assert.equal((await as('directplus', 'wrong')).status, 401, 'a wrong password');
  assert.equal((await as('directplus', 'correct horse and more')).status, 401, 'a longer password');
  assert.equal((await as('someone', 'correct horse')).status, 401, 'a wrong user name');
  const signedIn = await as('directplus', 'correct horse');
  assert.equal(signedIn.status, 200, 'the right login');
  assert.ok(signedIn.text.includes('Settings'), 'opens the full wallet calculator');
  env.WALLET_USER = 'ops';
  assert.equal((await as('ops', 'correct horse')).status, 200, 'WALLET_USER sets the user name');
});

test('the public pages carry no personal names from the decision notes', async () => {
  for (const route of ['/', '/estimate', '/limits']) {
    assert.doesNotMatch((await get(route)).text, /\bNiki\b|Florian|Dorgerloh/, route);
  }
});
