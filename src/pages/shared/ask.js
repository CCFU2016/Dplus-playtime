/* Direct+ pages: the "Ask about your result" panel. One tab asks the assistant, which explains the page's results from
   the calculator's own reference and the member's case (scripts/assistant.js); the other sends a question or feedback
   to the Direct+ team. It needs the hosted site's server (scripts/api.js), so the page mounts it only there. Nothing
   is stored in the browser: a conversation lasts as long as the page. */
const AskPanel = (() => {
  'use strict';

  const { el, clear } = PageUI;

  const MAX_QUESTION = 1000;
  const MAX_TURNS = 8; // earlier questions and answers sent along, as the server keeps them

  const TEMPLATE = `
    <div class="ask-head">
      <h2 id="ask-title">Ask about your result</h2>
      <button type="button" class="ask-close" aria-label="Close">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 1l10 10M11 1L1 11"/></svg>
      </button>
    </div>
    <div class="ask-tabs" role="tablist" aria-label="Who answers">
      <button type="button" role="tab" id="ask-tab-ai" aria-controls="ask-ai" aria-selected="true">Ask the assistant</button>
      <button type="button" role="tab" id="ask-tab-team" aria-controls="ask-team" aria-selected="false" tabindex="-1">Question or feedback</button>
    </div>
    <div class="ask-pane" id="ask-ai" role="tabpanel" aria-labelledby="ask-tab-ai">
      <div class="ask-log" aria-live="polite">
        <p class="ask-intro">The assistant explains the figures on this page, using only this calculator's rules and your
          current inputs.</p>
        <div class="ask-chips"></div>
      </div>
      <form class="ask-form">
        <label class="visually-hidden" for="ask-question">Your question</label>
        <textarea id="ask-question" rows="2" maxlength="${MAX_QUESTION}" placeholder="For example: why is Friday's limit the lowest?"></textarea>
        <button type="submit" class="btn">Ask</button>
      </form>
      <p class="ask-fine">The assistant is an AI (Claude) and can be wrong: ECC's own calculation prevails. Questions and
        answers are kept to improve the calculator. <button type="button" class="linkbtn ask-new" hidden>New conversation</button></p>
    </div>
    <div class="ask-pane" id="ask-team" role="tabpanel" aria-labelledby="ask-tab-team" hidden>
      <form class="team-form">
        <div class="ask-kind" role="radiogroup" aria-label="What you are sending">
          <label><input type="radio" name="ask-kind" value="question" checked> A question</label>
          <label><input type="radio" name="ask-kind" value="feedback"> Feedback</label>
        </div>
        <label for="team-message">Your message to the Direct+ team</label>
        <textarea id="team-message" rows="5" maxlength="4000" required></textarea>
        <label for="team-email">Your email address, if you'd like a reply</label>
        <input id="team-email" type="email" maxlength="200" autocomplete="email" spellcheck="false">
        <label class="check"><input type="checkbox" id="team-case" checked> Include my inputs and results on this page</label>
        <div class="team-send"><button type="submit" class="btn">Send</button><span class="team-state" role="status"></span></div>
      </form>
      <div class="team-sent" hidden>
        <p><b>Thank you.</b> Your message is with the Direct+ team.</p>
        <button type="button" class="linkbtn team-again">Send another</button>
      </div>
    </div>`;

  const ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4.5h14v9H8l-4 3v-3H3z"/></svg>';

  /** Posts JSON to the server; resolves to the fetch response. */
  const post = (url, body, signal) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });

  /** The error message the server sent, or a general one. */
  async function errorOf(response) {
    try {
      return (await response.json()).error || 'Something went wrong. Try again later.';
    } catch {
      return 'Something went wrong. Try again later.';
    }
  }

  /** Each JSON line of a streamed response body, as it arrives. */
  async function readLines(response, onLine) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line) onLine(JSON.parse(line));
      }
      if (done) return;
    }
  }

  /**
   * Adds the panel to the page. `page` names the page for the team; `caseText()` gives the member's case as text at the
   * moment they ask or send; `suggestions()` gives a few questions to start with. Each tab shows only when the server
   * offers it (the assistant needs its API key, the team form a place to keep messages); with neither, or without a
   * server, nothing shows.
   */
  async function mount({ page, caseText, suggestions }) {
    let offers;
    try {
      const response = await fetch('/api/panel');
      if (!response.ok) return;
      offers = await response.json();
    } catch {
      return;
    }
    if (!offers.ask && !offers.feedback) return;

    const launcher = el('button', 'ask-launcher');
    launcher.type = 'button';
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', 'ask-panel');
    launcher.innerHTML = `${ICON}<span>${offers.ask ? 'Ask about your result' : 'Question or feedback'}</span>`;
    const panel = el('section', 'ask-panel');
    panel.id = 'ask-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'ask-title');
    panel.hidden = true;
    panel.innerHTML = TEMPLATE;
    document.body.append(launcher, panel);
    document.body.classList.add('has-ask');
    const find = (selector) => panel.querySelector(selector);

    // ---------- open, close, tabs ----------

    const tabs = [find('#ask-tab-ai'), find('#ask-tab-team')];
    function showTab(tab) {
      for (const one of tabs) {
        const selected = one === tab;
        one.setAttribute('aria-selected', String(selected));
        one.tabIndex = selected ? 0 : -1;
        find(`#${one.getAttribute('aria-controls')}`).hidden = !selected;
      }
    }
    for (const tab of tabs) tab.addEventListener('click', () => showTab(tab));
    find('.ask-tabs').addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const next = tabs.find((tab) => tab !== document.activeElement);
      showTab(next);
      next.focus();
    });
    // One tab on offer: no tab bar.
    find('.ask-tabs').hidden = !(offers.ask && offers.feedback);
    if (!offers.ask) {
      find('#ask-title').textContent = 'Question or feedback';
      showTab(tabs[1]);
    }

    function open() {
      panel.hidden = false;
      launcher.setAttribute('aria-expanded', 'true');
      const field = find('#ask-ai').hidden ? find('#team-message') : find('#ask-question');
      field.focus();
    }
    function close() {
      panel.hidden = true;
      launcher.setAttribute('aria-expanded', 'false');
      launcher.focus();
    }
    launcher.addEventListener('click', () => (panel.hidden ? open() : close()));
    find('.ask-close').addEventListener('click', close);
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });

    // ---------- the assistant ----------

    const log = find('.ask-log');
    const question = find('#ask-question');
    const askButton = find('.ask-form .btn');
    const turns = []; // { question, answer } of the answered questions
    let asking = null; // the AbortController of the answer on its way
    const scrollToEnd = () => {
      log.scrollTop = log.scrollHeight;
    };

    function showSuggestions() {
      const box = clear(find('.ask-chips'));
      box.hidden = turns.length > 0 || Boolean(asking);
      for (const text of suggestions()) {
        const chip = el('button', 'ask-chip', text);
        chip.type = 'button';
        chip.addEventListener('click', () => ask(text));
        box.appendChild(chip);
      }
    }

    function setAsking(controller) {
      asking = controller;
      askButton.textContent = controller ? 'Stop' : 'Ask';
      find('.ask-new').hidden = !turns.length || Boolean(controller);
      find('.ask-chips').hidden = turns.length > 0 || Boolean(controller);
    }

    async function ask(text) {
      const history = turns.slice(-MAX_TURNS);
      log.appendChild(el('p', 'ask-q', text));
      const answer = el('p', 'ask-a waiting', 'Working it out…');
      log.appendChild(answer);
      scrollToEnd();
      question.value = '';
      const controller = new AbortController();
      setAsking(controller);
      let received = '';
      let failure = null;
      let complete = false;
      try {
        const response = await post('/api/ask', { question: text, case: caseText(), history }, controller.signal);
        if (!response.ok) failure = await errorOf(response);
        else {
          await readLines(response, (line) => {
            if (line.text) {
              received += line.text;
              answer.classList.remove('waiting');
              answer.textContent = received;
              scrollToEnd();
            } else if (line.error) failure = line.error;
            else if (line.done) {
              complete = true;
              if (line.outcome === 'short') answer.appendChild(el('span', 'ask-note', ' (The answer was cut short.)'));
            }
          });
        }
      } catch (error) {
        failure = error.name === 'AbortError' ? 'Stopped.' : 'The assistant could not be reached. Try again later.';
      }
      answer.classList.remove('waiting');
      if (complete && !failure) turns.push({ question: text, answer: received });
      else if (controller.signal.aborted && received) answer.appendChild(el('span', 'ask-note', ' (Stopped.)'));
      else {
        answer.classList.add('failed');
        answer.textContent = failure || 'The answer stopped. Try again.';
      }
      setAsking(null);
      scrollToEnd();
    }

    // The button asks, or stops the answer on its way; Enter asks too (Shift+Enter starts a new line).
    find('.ask-form').addEventListener('submit', (event) => {
      event.preventDefault();
      if (asking) asking.abort();
      else if (question.value.trim()) ask(question.value.trim());
    });
    question.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      if (!asking && question.value.trim()) ask(question.value.trim());
    });
    find('.ask-new').addEventListener('click', () => {
      turns.length = 0;
      for (const node of [...log.querySelectorAll('.ask-q, .ask-a')]) node.remove();
      setAsking(null);
      showSuggestions();
      question.focus();
    });
    launcher.addEventListener('click', showSuggestions); // the suggestions follow the page's current mode

    // ---------- the team ----------

    const teamForm = find('.team-form');
    const teamState = find('.team-state');
    teamForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = find('#team-message').value.trim();
      if (!message) {
        teamState.textContent = 'Write your message first.';
        return find('#team-message').focus();
      }
      const sendButton = teamForm.querySelector('.btn');
      sendButton.disabled = true;
      teamState.textContent = 'Sending…';
      try {
        const response = await post('/api/feedback', {
          page,
          kind: teamForm.querySelector('input[name="ask-kind"]:checked').value,
          message,
          email: find('#team-email').value.trim(),
          case: find('#team-case').checked ? caseText() : '',
        });
        if (!response.ok) teamState.textContent = await errorOf(response);
        else {
          teamForm.reset();
          teamState.textContent = '';
          teamForm.hidden = true;
          find('.team-sent').hidden = false;
          find('.team-again').focus();
        }
      } catch {
        teamState.textContent = 'Your message could not be sent. Try again later.';
      }
      sendButton.disabled = false;
    });
    find('.team-again').addEventListener('click', () => {
      find('.team-sent').hidden = true;
      teamForm.hidden = false;
      find('#team-message').focus();
    });
  }

  return { mount };
})();
