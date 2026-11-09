// The pages' JSON endpoints, for the "Ask about your result" panel on /limits:
//   GET  /api/panel      { ask, feedback }: whether the assistant is on, and whether messages can be kept
//   POST /api/ask        { question, case, history: [{ question, answer }] }: the assistant's answer, streamed as JSON
//                        lines: { text } for each piece, then { done, outcome } or { error }
//   POST /api/feedback   { kind: 'question' | 'feedback', message, email, case, page }: kept for the Direct+ team
// Without an inbox (no place to keep what is sent, see scripts/serve.js) the panel offers no feedback form, and the
// questions put to the assistant are not kept.
// Each visitor may ask 20 questions and send 10 messages an hour, and the assistant answers at most ASK_DAILY_LIMIT
// questions (default 300) in any 24 hours, which caps its cost. Posts must be JSON, which a page on another site can't
// send here without this server's consent (CORS), and nothing is stored about the visitor.
const { AssistantError } = require('./assistant.js');

const HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'cache-control': 'no-store' };
const HOUR = 3600 * 1000;
const MAX_BODY = 64 * 1024;
const MAX = { question: 1000, answer: 8000, case: 30000, message: 4000, email: 200, turns: 8 };
const PAGES = ['limits', 'estimate', 'wallet'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MESSAGES = {
  failed: 'The assistant could not answer just now. Try again later, or send your question to the team instead.',
  refused: "The assistant can't answer that question. Try asking it another way, or send it to the team.",
  askedOften: "You've asked a lot of questions in the last hour. Try again later, or send your question to the team.",
  dailyCap: 'The assistant has answered all the questions it can for today. Send your question to the team instead.',
  noInbox: 'Messages cannot be sent just now.',
  sentOften: "You've sent a lot of messages in the last hour. Try again later.",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

/** The request's JSON body: at most MAX_BODY bytes, sent as application/json. */
async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    throw new HttpError(415, 'Send JSON.');
  }
  // Read to the end, so the answer reaches the visitor, but keep at most MAX_BODY bytes.
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= MAX_BODY) chunks.push(chunk);
  }
  if (size > MAX_BODY) throw new HttpError(413, 'That is too much text to send.');
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    // answered below
  }
  throw new HttpError(400, 'Send a JSON object.');
}

/** A text field: trimmed, at most `max` characters, and not empty when `required`. */
function textField(value, what, max, required = false) {
  if (value != null && typeof value !== 'string') throw new HttpError(400, `The ${what} must be text.`);
  const text = (value || '').trim();
  if (required && !text) throw new HttpError(400, `The ${what} is empty.`);
  if (text.length > max) {
    throw new HttpError(400, `The ${what} is too long: at most ${max.toLocaleString('en')} characters.`);
  }
  return text;
}

/** The earlier questions and answers of a conversation, the latest MAX.turns of them. */
function turnsOf(history) {
  if (history == null) return [];
  if (!Array.isArray(history)) throw new HttpError(400, 'The history must be a list.');
  return history.slice(-MAX.turns).map((turn) => ({
    question: textField(turn && turn.question, 'earlier question', MAX.question, true),
    answer: textField(turn && turn.answer, 'earlier answer', MAX.answer, true),
  }));
}

/** Allows `max` uses per key in any `windowMs`: allow(key) says whether one more is allowed now, and counts it. */
function rateLimit(max, windowMs, now) {
  const uses = new Map();
  return (key = '') => {
    const time = now();
    const recent = (uses.get(key) || []).filter((at) => time - at < windowMs);
    const allowed = recent.length < max;
    if (allowed) recent.push(time);
    uses.set(key, recent);
    if (uses.size > 10000) {
      for (const [other, times] of uses) if (!times.some((at) => time - at < windowMs)) uses.delete(other);
    }
    return allowed;
  };
}

/** The visitor's address, as Railway's proxy reports it, for the hourly limits. */
function visitorOf(req) {
  const forwarded = (req.headers['x-forwarded-for'] || '').split(',').map((part) => part.trim());
  return req.headers['x-real-ip'] || forwarded.pop() || req.socket.remoteAddress || '';
}

/**
 * The endpoints, with the assistant (scripts/assistant.js) and the inbox (scripts/inbox.js), or null when nothing can
 * be kept. handle(route, req, res) answers one request to /api/…; `now` is Date.now, or a fake clock in the tests.
 */
function createApi({ env, assistant, inbox, now = Date.now }) {
  const askLimit = rateLimit(20, HOUR, now);
  const sendLimit = rateLimit(10, HOUR, now);
  const dailyLimit = rateLimit(Number(env.ASK_DAILY_LIMIT) || 300, 24 * HOUR, now);

  function keep(kind, entry) {
    if (!inbox) return false;
    try {
      inbox.add(kind, entry);
      return true;
    } catch (error) {
      console.error(`Cannot keep a ${kind} entry: ${error.message}`);
      return false;
    }
  }

  async function ask(req, res) {
    if (!assistant.available()) throw new HttpError(503, MESSAGES.failed);
    const body = await readJson(req);
    const conversation = {
      question: textField(body.question, 'question', MAX.question, true),
      caseText: textField(body.case, 'case', MAX.case),
      history: turnsOf(body.history),
    };
    if (!askLimit(visitorOf(req))) throw new HttpError(429, MESSAGES.askedOften);
    if (!dailyLimit()) throw new HttpError(429, MESSAGES.dailyCap);

    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', ...HEADERS });
    const line = (value) => res.write(`${JSON.stringify(value)}\n`);
    // A visitor who presses Stop or leaves the page ends the answer, and its cost.
    const stop = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) stop.abort();
    });
    let answer = '';
    let outcome;
    let model = null;
    try {
      const result = await assistant.ask(
        conversation,
        (text) => {
          answer += text;
          line({ text });
        },
        stop.signal,
      );
      model = result.model;
      outcome = { refusal: 'refused', max_tokens: 'short' }[result.stop] || 'answered';
      line(outcome === 'refused' ? { error: MESSAGES.refused } : { done: true, outcome });
      const {
        input_tokens: fresh = 0,
        cache_creation_input_tokens: written = 0,
        output_tokens: output = 0,
      } = result.usage;
      const cached = result.usage.cache_read_input_tokens || 0;
      console.log(`Ask: ${outcome}, ${model}, ${fresh + written + cached} tokens in (${cached} cached), ${output} out`);
    } catch (error) {
      if (stop.signal.aborted) outcome = 'stopped';
      else {
        outcome = 'failed';
        if (!(error instanceof AssistantError)) console.error(`Ask: ${error.stack || error.message}`);
        line({ error: error instanceof AssistantError ? error.message : MESSAGES.failed });
      }
    }
    res.end();
    keep('asked', {
      page: 'limits',
      question: conversation.question,
      answer,
      outcome,
      model,
      case: conversation.caseText,
    });
  }

  async function feedback(req, res) {
    if (!inbox) throw new HttpError(503, MESSAGES.noInbox);
    const body = await readJson(req);
    const kind = body.kind === 'question' ? 'question' : 'feedback';
    const message = textField(body.message, 'message', MAX.message, true);
    const email = textField(body.email, 'email address', MAX.email);
    if (email && !EMAIL.test(email)) throw new HttpError(400, "That email address doesn't look right.");
    const page = PAGES.includes(body.page) ? body.page : 'limits';
    const caseText = textField(body.case, 'case', MAX.case);
    if (!sendLimit(visitorOf(req))) throw new HttpError(429, MESSAGES.sentOften);
    if (!keep('feedback', { page, kind, message, email, case: caseText })) {
      throw new HttpError(500, 'Your message could not be saved. Try again later.');
    }
    sendJson(res, 200, { ok: true });
  }

  const ROUTES = {
    '/api/panel': { GET: (req, res) => sendJson(res, 200, { ask: assistant.available(), feedback: Boolean(inbox) }) },
    '/api/ask': { POST: ask },
    '/api/feedback': { POST: feedback },
  };

  return async function handle(route, req, res) {
    if (!Object.hasOwn(ROUTES, route)) return sendJson(res, 404, { error: 'Not found.' });
    const methods = ROUTES[route];
    if (!Object.hasOwn(methods, req.method)) {
      return sendJson(res, 405, { error: 'Method not allowed.' }, { allow: Object.keys(methods).join(', ') });
    }
    const answer = methods[req.method];
    try {
      await answer(req, res);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(`${req.method} ${route}: ${error.stack || error.message}`);
      if (res.headersSent) return res.end();
      sendJson(res, error.status || 500, {
        error: error instanceof HttpError ? error.message : 'Something went wrong.',
      });
    }
  };
}

module.exports = { createApi };
