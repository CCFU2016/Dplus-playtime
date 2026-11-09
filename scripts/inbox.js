// What members send from the pages, kept for the Direct+ team: questions and feedback from the form, and the questions
// put to the assistant with its answers. One JSON line per entry, in `dir`: on Railway the service's volume (its mount
// path), locally data/. Staff read them at /feedback, or download them at /feedback.csv.
const fs = require('fs');
const path = require('path');

const FILES = { feedback: 'feedback.jsonl', asked: 'asked.jsonl' };

/** The inbox in `dir`: add(kind, entry) keeps an entry with the time, list(kind) gives them newest first. */
function createInbox(dir) {
  const file = (kind) => path.join(dir, FILES[kind]);
  return {
    add(kind, entry) {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(file(kind), `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);
    },
    list(kind) {
      let text;
      try {
        text = fs.readFileSync(file(kind), 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
      const entries = [];
      for (const line of text.split('\n')) {
        try {
          if (line) entries.push(JSON.parse(line));
        } catch {
          // A line cut short (the server stopped while writing it): skip it.
        }
      }
      return entries.reverse();
    },
  };
}

// ---------- the staff page ----------

const escapeHtml = (text) =>
  String(text == null ? '' : text).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

const when = (iso) => escapeHtml(iso.slice(0, 16).replace('T', ' ')) + ' UTC';

const caseDetails = (text) =>
  text ? `<details><summary>Their case</summary><pre>${escapeHtml(text)}</pre></details>` : '';

const OUTCOMES = {
  answered: 'Answered',
  short: 'Cut short',
  refused: 'Declined',
  failed: 'Failed',
  stopped: 'Stopped',
};

function feedbackRow(entry) {
  const email = entry.email ? `<a href="mailto:${escapeHtml(entry.email)}">${escapeHtml(entry.email)}</a>` : '–';
  return `<tr><td>${when(entry.time)}</td><td>${entry.kind === 'question' ? 'Question' : 'Feedback'}</td>
<td><p>${escapeHtml(entry.message)}</p>${caseDetails(entry.case)}</td><td>${email}</td></tr>`;
}

function askedRow(entry) {
  return `<tr><td>${when(entry.time)}</td><td><p>${escapeHtml(entry.question)}</p>${caseDetails(entry.case)}</td>
<td><p>${escapeHtml(entry.answer)}</p></td><td>${escapeHtml(OUTCOMES[entry.outcome] || entry.outcome)}</td></tr>`;
}

function table(head, rows, empty) {
  if (!rows.length) return `<p class="empty">${empty}</p>`;
  const header = head.map((name) => `<th>${name}</th>`).join('');
  return `<table><thead><tr>${header}</tr></thead><tbody>${rows.join('\n')}</tbody></table>`;
}

/** The staff page: the questions and feedback, then what was asked of the assistant. */
function inboxPage(inbox) {
  const feedback = inbox.list('feedback');
  const asked = inbox.list('asked');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Direct+ questions and feedback</title>
<style>
:root { color-scheme: light dark; --rule: #dbe0e7; --muted: #6b7686; }
@media (prefers-color-scheme: dark) { :root { --rule: #27313c; --muted: #8f9aa7; } }
body { font: 15px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; margin: 0 auto; padding: 24px 16px 48px; max-width: 1100px; }
h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 32px 0 8px; }
.lede, .empty, th { color: var(--muted); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px 8px 0; border-bottom: 1px solid var(--rule); }
th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
td:first-child { white-space: nowrap; font-variant-numeric: tabular-nums; }
p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
summary { cursor: pointer; color: var(--muted); font-size: 13px; margin-top: 6px; }
pre { font-size: 12px; white-space: pre-wrap; margin: 6px 0 0; }
</style></head><body>
<h1>Questions and feedback</h1>
<p class="lede">From the limit calculator, newest first. <a href="/feedback.csv">Download as CSV</a></p>
<h2>Sent to the team (${feedback.length})</h2>
${table(['Sent', 'Type', 'Message', 'Reply to'], feedback.map(feedbackRow), 'Nothing yet.')}
<h2>Asked the assistant (${asked.length})</h2>
${table(['Asked', 'Question', 'Answer', 'Outcome'], asked.map(askedRow), 'Nothing yet.')}
</body></html>`;
}

/** Everything in one CSV file: what was sent to the team and what was asked of the assistant. */
function inboxCsv(inbox) {
  const cell = (value) => {
    const text = String(value == null ? '' : value);
    // Text a spreadsheet would take for a formula starts with a quote, so it stays text.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = [
    ...inbox.list('feedback').map((entry) => [entry.time, entry.kind, entry.message, '', entry.email, entry.case]),
    ...inbox
      .list('asked')
      .map((entry) => [entry.time, 'asked the assistant', entry.question, entry.answer, '', entry.case]),
  ].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const lines = [['Time (UTC)', 'Type', 'Message or question', 'Answer', 'Reply to', 'Their case'], ...rows];
  return `\ufeff${lines.map((line) => line.map(cell).join(',')).join('\r\n')}\r\n`;
}

module.exports = { createInbox, inboxPage, inboxCsv };
