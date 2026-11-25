// Validation of `mask:` / `hide:` CSS selectors, shared by `validate`, `record` (video) and `guide capture`.
// A selector that is syntactically "valid" on its own can still swallow the rules after it once it is placed in a stylesheet
// (unclosed quote, bracket, paren or comment, trailing backslash). So: a cheap static pass, then a round trip through a real
// CSS parser (see `assertMaskSelectors`). Both must pass; a bad selector would silently leave PII unblurred.
import { DemoError } from './util.mjs';

/** Why `sel` must not be used as a mask/hide selector, or null when it passes the static checks. */
export function staticSelectorProblem(sel) {
  if (typeof sel !== 'string' || !sel.trim()) return 'empty or not a string';
  if (/[{};]/.test(sel)) return 'contains "{", "}" or ";"';
  if (sel.includes('/*')) return 'contains a comment opener "/*"';
  if (sel.trim().startsWith('@')) return 'starts with "@" (an at-rule, not a selector)';
  let trailing = 0;
  for (let i = sel.length - 1; i >= 0 && sel[i] === '\\'; i--) trailing++;
  if (trailing % 2 === 1) return 'ends with a lone backslash';
  const close = { '[': ']', '(': ')' };
  const stack = []; let quote = null;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '\\') { i++; continue; }
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\n' || c === '\r' || c === '\f') return 'has a line break inside a quoted string';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '(') stack.push(close[c]);
    else if (c === ']' || c === ')') { if (stack.pop() !== c) return `has an unbalanced "${c}"`; }
  }
  if (quote) return 'has an unterminated quote';
  if (stack.length) return `has an unclosed "${stack[stack.length - 1] === ']' ? '[' : '('}"`;
  return null;
}

/** Static problems of a spec's mask/hide lists: [{ kind, selector, reason }]. Needs no browser. */
export function staticMaskProblems({ mask = [], hide = [] }) {
  return [...mask.map((s) => ['mask', s]), ...hide.map((s) => ['hide', s])]
    .map(([kind, selector]) => ({ kind, selector, reason: staticSelectorProblem(selector) })).filter((p) => p.reason);
}

/** Runs in the page: true when `sel` survives a stylesheet round trip as exactly one style rule followed by the probe rule. */
function roundTrip(list) {
  return list.map((sel) => {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`${sel}{color:red}\n.__probe{color:red}`);
      const r = sheet.cssRules;
      if (r.length !== 2 || r[0].type !== 1 || !r[0].selectorText || r[1].selectorText !== '.__probe') return false;
      document.querySelector(sel); // must also be usable from script (target lookup / mask hit counting)
      return true;
    } catch { return false; }
  });
}

/**
 * Throws DemoError (code MASK_INVALID) listing every mask/hide selector that fails the static checks or the CSS round trip.
 * `where` names the files to fix in the message.
 */
export async function assertMaskSelectors(browser, { mask = [], hide = [] }, where = 'demo.yaml') {
  const entries = [...mask.map((s) => ['mask', s]), ...hide.map((s) => ['hide', s])];
  if (!entries.length) return;
  const stat = entries.map(([, s]) => staticSelectorProblem(s));
  const sane = entries.filter((_, i) => !stat[i]);
  let ok = [];
  if (sane.length) {
    const page = await browser.newPage();
    try { ok = await page.evaluate(roundTrip, sane.map(([, s]) => s)); } finally { await page.close().catch(() => {}); }
  }
  let k = 0;
  const bad = entries.filter((_, i) => (stat[i] ? true : !ok[k++])).map(([kind, s]) => [kind, s]);
  if (!bad.length) return;
  const e = new DemoError(`${bad.length} mask/hide selector(s) are not valid CSS and would not blur or hide anything (or would switch off the rules after them):\n${bad.map(([kind, s]) => `  - ${kind}: ${s}`).join('\n')}\n  Use plain, complete CSS selectors (.class, #id, [data-testid="x"], :has(...)). Playwright-only selectors (text=, :has-text(), >>, xpath=) are not supported for mask/hide.\n  Fix mask/hide in ${where}; nothing was run.`);
  e.code = 'MASK_INVALID';
  throw e;
}

// ---------- opaque redaction of still images ----------
/** Colour of the opaque boxes drawn over masked elements in guide screenshots (neutral grey, no data in it). */
export const MASK_COLOR = '#9aa0a6';

/**
 * Playwright locators for the mask selectors and their current match counts (summed over the page's frames).
 * Per frame (main and child frames) and selector: the element itself and all its descendants (`css=:is(sel) *`), so content that overflows the
 * element's box (floats, absolute/transformed children, ::after hosts that are descendants, display:contents wrappers) is covered by its own box.
 * `counts` is per base selector (for MASK_UNMATCHED). Open shadow roots are pierced by Playwright's CSS engine.
 * Throws DemoError MASK_NOT_APPLIED when Playwright cannot resolve a selector: an image without the opaque layer must not be written.
 */
export async function maskLocators(page, selectors) {
  const frames = page.frames();
  const base = frames.map((f) => selectors.map((s) => f.locator(`css=${s}`)));
  const locs = frames.flatMap((f, i) => [...base[i], ...selectors.map((s) => f.locator(`css=:is(${s}) *`))]);
  try {
    const per = await Promise.all(base.map((row) => Promise.all(row.map((l) => l.count()))));
    return { locs, counts: selectors.map((_, k) => per.reduce((n, row) => n + row[k], 0)) };
  } catch (err) {
    const e = new DemoError(`Cannot apply the opaque redaction to mask selector(s): ${String(err.message).split('\n')[0]}\n  No image was written. Fix the selector (plain CSS) in demo.yaml or guide.yaml mask:, or retry if the page was navigating.`);
    e.code = 'MASK_NOT_APPLIED';
    throw e;
  }
}

/** page.screenshot with every `mask` selector covered by an opaque box (Playwright `mask`, also for `clip`). Returns the match count per selector. */
export async function redactedScreenshot(page, selectors, options) {
  if (!selectors.length) { await page.screenshot(options); return []; }
  const { locs, counts } = await maskLocators(page, selectors);
  await page.screenshot({ ...options, mask: locs, maskColor: MASK_COLOR });
  return counts;
}
