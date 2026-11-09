// The "Ask about your result" panel's server side (scripts/api.js, assistant.js, inbox.js), through the web server,
// with a stand-in for the Claude API, a fake clock and a temporary inbox.
const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createHandler } = require('../scripts/serve.js');
const { SYSTEM } = require('../scripts/assistant.js');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dplus-ask-'));
const env = {};
let clock = Date.parse('2026-11-09T10:00:00Z');
const HOUR = 3600 * 1000;

// ---------- the Claude API's stand-in ----------

/** Server-sent events as the Messages API streams them. */
const sse = (events) => events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');

/** A response body that arrives in small chunks, so events and characters are split across them. */
function chunked(text, size = 7) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
}

/** A streamed answer: a thinking block, then the text in a few pieces, then the stop reason. */
function answer(text, stop = 'end_turn') {
  const pieces = text.match(/.{1,12}/gsu) || [];
  return new Response(
    chunked(
      sse([
        { type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 60, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        ...pieces.map((piece) => ({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: piece },
        })),
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 42 } },
        { type: 'message_stop' },
      ]),
    ),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

const claude = { calls: [], reply: () => answer('Friday reserves €100,000 — for the weekend.') };
async function fakeFetch(url, options) {
  claude.calls.push({ url, headers: options.headers, body: JSON.parse(options.body), signal: options.signal });
  return claude.reply(options);
}

// ---------- the server ----------

const server = http.createServer(createHandler(dataDir, env, { fetch: fakeFetch, dataDir, now: () => clock }));
let base = '';

const post = (route, body, headers = { 'content-type': 'application/json' }) =>
  fetch(base + route, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

/** Asks a question; the streamed lines, parsed. */
async function ask(body) {
  const response = await post('/api/ask', body);
  const text = await response.text();
  const lines = response.ok
    ? text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    lines,
    error: !response.ok && JSON.parse(text).error,
  };
}
const textOf = (lines) => lines.map((line) => line.text || '').join('');
const entries = (kind) =>
  fs.existsSync(path.join(dataDir, `${kind}.jsonl`))
    ? fs
        .readFileSync(path.join(dataDir, `${kind}.jsonl`), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
const basicAuth = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

before(async () => {
  // The server logs each question's tokens and the API's errors; the tests check what the member gets instead.
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  clock += 2 * 24 * HOUR; // a fresh day: the hourly and daily limits start over
  claude.calls.length = 0;
  claude.reply = () => answer('Friday reserves €100,000 — for the weekend.');
  env.ANTHROPIC_API_KEY = 'test-key';
});

// ---------- tests ----------

const offers = async (url = base) => (await fetch(`${url}/api/panel`)).json();

test('the page learns what the panel offers: the assistant with a key, the team form with a place to keep it', async () => {
  delete env.ANTHROPIC_API_KEY;
  assert.deepEqual(await offers(), { ask: false, feedback: true }, 'no assistant without a key');
  const off = await ask({ question: 'Why?' });
  assert.equal(off.status, 503, 'and no answer');
  assert.equal(claude.calls.length, 0, 'nor a call to the API');
  env.ANTHROPIC_API_KEY = 'test-key';
  assert.deepEqual(await offers(), { ask: true, feedback: true }, 'the assistant with a key');
});

test('on Railway without a volume nothing is kept, so the team form is off', async () => {
  const railway = { ANTHROPIC_API_KEY: 'k', RAILWAY_PROJECT_ID: 'p', WALLET_PASSWORD: 'pw' };
  const bare = http.createServer(createHandler(dataDir, railway, { fetch: fakeFetch, now: () => clock }));
  await new Promise((resolve) => bare.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${bare.address().port}`;
  assert.deepEqual(await offers(url), { ask: true, feedback: false });
  const sent = await fetch(`${url}/api/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"message":"Hello"}',
  });
  assert.equal(sent.status, 503, 'a message is refused rather than lost');
  const asked = await fetch(`${url}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"question":"Why?"}',
  });
  assert.match(await asked.text(), /"done":true/, 'the assistant still answers');
  const staff = await fetch(`${url}/feedback`, { headers: { authorization: basicAuth('directplus', 'pw') } });
  assert.match(await staff.text(), /Nothing is kept/, 'and the staff page says why it is empty');
  railway.RAILWAY_VOLUME_MOUNT_PATH = dataDir;
  const withVolume = http.createServer(createHandler(dataDir, railway, { fetch: fakeFetch, now: () => clock }));
  await new Promise((resolve) => withVolume.listen(0, '127.0.0.1', resolve));
  const volumeUrl = `http://127.0.0.1:${withVolume.address().port}`;
  assert.deepEqual(await offers(volumeUrl), { ask: true, feedback: true }, 'with a volume, it keeps them there');
  bare.close();
  withVolume.close();
});

test('a question streams its answer from the Claude API, with the reference, the case and the conversation', async () => {
  const history = [{ question: 'What is the excess?', answer: 'Collateral minus reserved minus open risk.' }];
  const result = await ask({ question: 'Why is Friday lower?', case: 'Collateral posted: €500,000', history });
  assert.equal(result.status, 200);
  assert.match(result.type, /application\/x-ndjson/);
  assert.equal(textOf(result.lines), 'Friday reserves €100,000 — for the weekend.', 'the text, whole across chunks');
  assert.ok(result.lines.filter((line) => line.text).length > 1, 'in pieces, as it comes');
  assert.deepEqual(result.lines.at(-1), { done: true, outcome: 'answered' }, 'then done');

  const [call] = claude.calls;
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.headers['x-api-key'], 'test-key');
  assert.equal(call.headers['anthropic-version'], '2026-10-21');
  assert.equal(call.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(call.body.model, 'claude-opus-5-5', 'the default model');
  assert.equal(call.body.stream, true);
  assert.equal(call.body.fallbacks, 'default');
  assert.deepEqual(call.body.system, [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }]);
  assert.ok(SYSTEM.includes('Reserved for base limits') && SYSTEM.includes('around 18:00'), 'carries the reference');
  assert.deepEqual(call.body.messages, [
    { role: 'user', content: 'What is the excess?' },
    { role: 'assistant', content: 'Collateral minus reserved minus open risk.' },
    { role: 'user', content: '<case>\nCollateral posted: €500,000\n</case>\n\nWhy is Friday lower?' },
  ]);

  const kept = entries('asked').at(-1);
  assert.equal(kept.question, 'Why is Friday lower?');
  assert.equal(kept.answer, 'Friday reserves €100,000 — for the weekend.');
  assert.equal(kept.outcome, 'answered');
  assert.equal(kept.case, 'Collateral posted: €500,000');
  assert.ok(!('ip' in kept), 'nothing about the visitor');

  env.ASK_MODEL = 'claude-sonnet-5-5';
  env.ANTHROPIC_BASE_URL = 'https://proxy.example/';
  await ask({ question: 'And Monday?' });
  assert.equal(claude.calls[1].body.model, 'claude-sonnet-5-5', 'ASK_MODEL');
  assert.equal(claude.calls[1].url, 'https://proxy.example/v1/messages', 'ANTHROPIC_BASE_URL');
  delete env.ASK_MODEL;
  delete env.ANTHROPIC_BASE_URL;
});

test('the reference and the instructions carry no personal names', () => {
  assert.doesNotMatch(SYSTEM, /\bNiki\b|Florian|Dorgerloh/);
});

test('questions are checked before anything is sent to the API', async () => {
  assert.equal((await ask({ question: '   ' })).status, 400, 'an empty question');
  assert.equal((await ask({ question: 'x'.repeat(1001) })).status, 400, 'a long question');
  assert.equal((await ask({ question: 'Why?', case: 42 })).status, 400, 'a case that is not text');
  assert.equal((await ask({ question: 'Why?', history: 'no' })).status, 400, 'a history that is not a list');
  assert.equal(
    (await ask({ question: 'Why?', history: [{ question: 'a' }] })).status,
    400,
    'a turn without its answer',
  );
  assert.equal((await post('/api/ask', 'question=Why', { 'content-type': 'text/plain' })).status, 415, 'not JSON');
  assert.equal(
    (await post('/api/ask', '{"question":', { 'content-type': 'application/json' })).status,
    400,
    'bad JSON',
  );
  assert.equal((await post('/api/ask', { question: 'x'.repeat(70 * 1024) })).status, 413, 'too much');
  assert.equal(claude.calls.length, 0);

  const long = Array.from({ length: 12 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
  await ask({ question: 'Why?', history: long });
  assert.equal(claude.calls[0].body.messages.length, 2 * 8 + 1, 'only the latest eight turns go along');
  assert.equal(claude.calls[0].body.messages[0].content, 'Q4');
});

test('a refusal, a cut-off answer and API errors reach the member as plain messages', async () => {
  claude.reply = () => answer('Partial', 'refusal');
  const refused = await ask({ question: 'Why?' });
  assert.match(refused.lines.at(-1).error, /can't answer that question/, 'a refusal');
  assert.equal(entries('asked').at(-1).outcome, 'refused');

  claude.reply = () => answer('A long answer', 'max_tokens');
  assert.deepEqual((await ask({ question: 'Why?' })).lines.at(-1), { done: true, outcome: 'short' }, 'cut short');

  claude.reply = () => new Response('{"type":"error","error":{"type":"rate_limit_error"}}', { status: 429 });
  assert.match((await ask({ question: 'Why?' })).lines.at(-1).error, /busy/, 'rate limited by the API');

  claude.reply = () => new Response('{"type":"error","error":{"type":"authentication_error"}}', { status: 401 });
  const broken = await ask({ question: 'Why?' });
  assert.match(broken.lines.at(-1).error, /could not answer just now/, 'a wrong key');
  assert.doesNotMatch(JSON.stringify(broken.lines), /authentication_error|test-key/, 'without the details');

  claude.reply = () =>
    new Response(chunked(sse([{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }])));
  assert.match((await ask({ question: 'Why?' })).lines.at(-1).error, /busy/, 'an error in the stream');

  claude.reply = () => Promise.reject(new TypeError('fetch failed'));
  assert.match((await ask({ question: 'Why?' })).lines.at(-1).error, /could not answer/, 'the API unreachable');
  assert.equal(entries('asked').at(-1).outcome, 'failed');
});

test('closing the panel stops the answer, and its cost', async () => {
  let upstream = null;
  claude.reply = ({ signal }) => {
    upstream = signal;
    const first = sse([{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Because' } }]);
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(first));
          signal.addEventListener('abort', () => controller.error(signal.reason));
        },
      }),
    );
  };
  const stop = new AbortController();
  const response = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'Why?' }),
    signal: stop.signal,
  });
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /Because/, 'the answer starts');
  stop.abort();
  for (let i = 0; i < 50 && entries('asked').at(-1).outcome !== 'stopped'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(upstream.aborted, true, 'the API request is cancelled');
  assert.deepEqual([entries('asked').at(-1).outcome, entries('asked').at(-1).answer], ['stopped', 'Because']);
});

test('each visitor may ask 20 questions an hour', async () => {
  for (let i = 0; i < 20; i++) assert.equal((await ask({ question: `Q${i}` })).status, 200, `question ${i + 1}`);
  const over = await ask({ question: 'One more' });
  assert.equal(over.status, 429, 'the 21st in the hour');
  assert.match(over.error, /a lot of questions/);
  clock += HOUR;
  assert.equal((await ask({ question: 'An hour later' })).status, 200, 'an hour later');
});

test('the daily cap stops all questions once reached', async () => {
  // A server of its own: the cap is read when the server starts.
  const capped = http.createServer(
    createHandler(
      dataDir,
      { ANTHROPIC_API_KEY: 'k', ASK_DAILY_LIMIT: '2' },
      { fetch: fakeFetch, dataDir, now: () => clock },
    ),
  );
  await new Promise((resolve) => capped.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${capped.address().port}/api/ask`;
  const askCapped = (headers) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: '{"question":"Why?"}',
    });
  assert.equal((await askCapped({ 'x-real-ip': '10.0.0.1' })).status, 200);
  assert.equal((await askCapped({ 'x-real-ip': '10.0.0.2' })).status, 200);
  const third = await askCapped({ 'x-real-ip': '10.0.0.3' });
  assert.equal(third.status, 429, 'the third question of the day, from anyone');
  assert.match((await third.json()).error, /all the questions it can for today/);
  clock += 24 * HOUR;
  assert.equal((await askCapped({ 'x-real-ip': '10.0.0.3' })).status, 200, 'a day later');
  capped.close();
});

test('a question or feedback for the team is kept, and only staff can read it', async () => {
  const sent = await post('/api/feedback', {
    page: 'limits',
    kind: 'question',
    message: 'Can ECC <b>confirm</b> the Monday rule?',
    email: 'trader@example.com',
    case: 'Collateral posted: €500,000',
  });
  assert.equal(sent.status, 200);
  assert.deepEqual(await sent.json(), { ok: true });
  await post('/api/feedback', { kind: 'feedback', message: '=HYPERLINK("http://x")' });
  const [first, second] = entries('feedback');
  assert.equal(first.kind, 'question');
  assert.equal(first.email, 'trader@example.com');
  assert.equal(first.case, 'Collateral posted: €500,000');
  assert.ok(first.time, 'with the time');
  assert.deepEqual([second.kind, second.page, second.email], ['feedback', 'limits', '']);

  assert.equal((await post('/api/feedback', { message: ' ' })).status, 400, 'an empty message');
  const badEmail = await post('/api/feedback', { message: 'Hi', email: 'not an address' });
  assert.equal(badEmail.status, 400, 'an email address that is not one');
  assert.match((await badEmail.json()).error, /email address/);

  delete env.WALLET_PASSWORD;
  assert.equal((await fetch(`${base}/feedback`)).status, 404, 'hidden without WALLET_PASSWORD');
  env.WALLET_PASSWORD = 'correct horse';
  assert.equal((await fetch(`${base}/feedback`)).status, 401, 'asks for the staff login');
  assert.equal((await fetch(`${base}/feedback.csv`)).status, 401, 'the CSV too');
  const staff = { headers: { authorization: basicAuth('directplus', 'correct horse') } };
  const page = await (await fetch(`${base}/feedback`, staff)).text();
  assert.ok(page.includes('Can ECC &lt;b&gt;confirm&lt;/b&gt; the Monday rule?'), 'the message, escaped');
  assert.ok(page.includes('mailto:trader@example.com'), 'a link to reply');
  assert.ok(page.includes('Friday reserves €100,000'), 'what the assistant answered');
  const csv = await fetch(`${base}/feedback.csv`, staff);
  assert.match(csv.headers.get('content-disposition'), /attachment/);
  const rows = await csv.text();
  assert.ok(rows.includes('"\'=HYPERLINK(""http://x"")"'), 'a formula stays text');
  assert.ok(rows.includes('"asked the assistant"'), 'with what was asked of the assistant');
  delete env.WALLET_PASSWORD;
});

test('each visitor may send 10 messages an hour', async () => {
  const from = (ip) =>
    fetch(`${base}/api/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': ip },
      body: '{"message":"Hello"}',
    });
  for (let i = 0; i < 10; i++) assert.equal((await from('10.0.0.9')).status, 200);
  assert.equal((await from('10.0.0.9')).status, 429, 'the 11th');
  assert.equal((await from('10.0.0.10')).status, 200, 'another visitor');
});

test('other API routes and methods are refused', async () => {
  assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
  assert.equal((await fetch(`${base}/api/__proto__`)).status, 404);
  const wrongMethod = await fetch(`${base}/api/feedback`);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
  assert.equal((await fetch(`${base}/api/ask`)).status, 405, 'GET /api/ask');
  assert.equal((await post('/api/panel', {})).status, 405, 'POST /api/panel');
});
