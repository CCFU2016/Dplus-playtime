/* Direct+ pages: the links between the limit calculator and the wallet estimate. Values travel in the link after the #:
   browsers don't send that part to the server, and nothing is stored. */
const Handoff = (() => {
  'use strict';

  // Where each page is: its route on the hosted site (scripts/serve.js), and its file in dist/.
  const PAGES = {
    limits: { route: '/limits', file: 'standalone/direct-plus-limit-calculator.html' },
    estimate: { route: '/estimate', file: 'wallet/standalone/direct-plus-wallet-prospect.html' },
  };

  /** A value as URL-safe base64 of its JSON. */
  function encode(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** The value encode() wrote, or null for anything else. */
  function decode(text) {
    try {
      const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
    } catch {
      return null;
    }
  }

  /** The parts of the address after the #, as a Map of key → value (in order). */
  function readHash() {
    const parts = new Map();
    for (const part of location.hash.replace(/^#/, '').split('&')) {
      const split = part.indexOf('=');
      if (split > 0) parts.set(part.slice(0, split), part.slice(split + 1));
    }
    return parts;
  }

  /** The text after the # for [key, value] pairs. */
  const hashOf = (pairs) => pairs.map(([key, value]) => `${key}=${value}`).join('&');

  /**
   * The link to page `target` ('limits' or 'estimate'): its route on the hosted site, or its file next to this one when
   * the page is opened from dist/ on disk. Anywhere else, such as the claude.ai copy, there is no link (null).
   */
  function linkTo(target) {
    const { pathname, protocol } = location;
    for (const page of Object.values(PAGES)) {
      if (new RegExp(`${page.route}/?$`).test(pathname)) return PAGES[target].route;
      if (protocol === 'file:' && pathname.endsWith(`/${page.file}`)) {
        const up = '../'.repeat(page.file.split('/').length - 1);
        return up + PAGES[target].file;
      }
    }
    return null;
  }

  return { encode, decode, readHash, hashOf, linkTo };
})();
