# Security re-audit (r2): user-guide-writer

- Date: 2026-11-25
- Auditor: `dev-squad:security-auditor` (read-only; this file was saved by the orchestrator).
- Scope: working tree on `claude/hopeful-johnson-4plv7k` vs `main` @ 0d981a0.
- **Overall risk: High.** One new High finding, N1.

## Status of previous findings

| # | Previous finding | Status now | Severity now |
|---|---|---|---|
| 1 | One bad selector disables every mask | **Partially fixed.** Playwright-style selectors are rejected and each selector gets its own CSS rule. Unbalanced selectors still slip through (see N1). | **High** |
| 2 | Masked target label leaks | Fixed for the target, label, pill and alt text. Page title and path still leak (see N4). | Low |
| 3 | Environment classification | **Partially fixed.** Capture keeps running after a redirect (N2). fetch/XHR writes are not gated, and "local" covers too much (N3). | Medium |
| 4 | `SECRET_VALUE` guard | Fixed | Low (folded into #9) |
| 5 | Prompt injection | Fixed as far as prompt wording can go. The rules exist only as prose (N5). | Low |
| 6 | Image paths outside `guide/` | Not fixed (deferred) | Low |
| 7 | Markdown links from labels | Not fixed (deferred) | Low |
| 8 | Raw config in `<style>`; render runs with JS on | Not fixed (deferred) | Low |
| 9 | URLs and tokens in errors; setup screenshots | Partially fixed: capture errors strip the query; `init` ignores `guide/errors` and `.staging`. | Low |

## New findings

| # | Severity | CWE | Location | Title |
|---|---|---|---|---|
| N1 | **High** | CWE-359, CWE-20, CWE-754 | `overlay.mjs:13-14,33-34`; `guide.mjs:393-405,526`; `record.mjs:216-218` | Unbalanced mask/hide selectors pass validation and switch off every mask and hide after them |
| N2 | Medium | CWE-693, CWE-367 | `guide.mjs:455,473,482,592-618`; `SKILL.md:106` | After a redirect to an unapproved host, the flow keeps running there, and the error message says the request "was blocked" |
| N3 | Medium | CWE-693, CWE-183 | `guide.mjs:176-186,454-471` | Only main-frame navigations are gated: fetch/XHR writes to unapproved API hosts are not checked. RFC1918 addresses, `*.local` and a host named `file` are trusted automatically. |
| N4 | Low | CWE-359 | `guide.mjs:564`; `guide-md.mjs:57` | `page.title` and the URL path (which may hold masked data) go into `steps.json` and the sentence for `goto` steps |
| N5 | Low | CWE-1427 | `agents/guide-writer.md:4,23-28` | The trust boundaries are prose only. Changes to `env.allow` or masks are not detected. |

### N1

**What happens.** Each selector is validated on its own with `querySelector` and `CSS.supports`. Both accept selectors with an unclosed `"`, `(` or `/*`, or a trailing `\`, because the CSS tokenizer closes them at end of input. When the selectors are joined into one `<style>`, the open token swallows the rules that follow.

**Verified in Chromium:**
- `[data-testid="name]`, `:not(.public`, `tr:has(.x`, `.x /*` and `.x\` all disable `.pii` and `.email`.
- A bad selector placed last disables every `hide` rule.
- `MASK_UNMATCHED` stays silent, and `steps.json` reports `masked: true` while the pixels are unblurred.

**Remediation:**
1. Add each rule with `sheet.insertRule` inside its own try/catch, in both the video and the guide path.
2. Validate each selector with `new CSSStyleSheet().replaceSync(sel+'{color:red}\n.__probe{color:red}')`, which must produce exactly 2 rules.
3. Also reject `/*`, a trailing `\`, `{ } ;`, and unbalanced quotes, brackets or parens.
4. Run the same validation in `validate` and `record`.
5. Add tests.

### N2

**What happens.** The `request` listener only records the unapproved hop. `blocked` is checked only after setup and after all scenes.

**Verified:**
1. The flow ran `goto /redir`, which redirected with 302 to `prod.example.com`.
2. `click #save` then sent `POST prod.example.com /api/save`.
3. Capture threw "the request was blocked" only after that write.

The existing test passes only because the redirect target host does not resolve.

**Remediation:**
- Set a stop flag the moment the hop is seen, abort all further traffic to that host, and throw `envStop()` before the next action, including in `prepareSession`.
- Reword the error message and `SKILL.md`.
- Add a test whose redirect target resolves (via `--host-resolver-rules`), and assert that no request reaches it after the hop.

### N3

**Remediation:**
- Route every request in the context. Abort non-GET/HEAD/OPTIONS requests to unapproved hosts and stop with `ENV_UNCONFIRMED`.
- Record every host contacted, with method counts, in `env.contacted`.
- Narrow "local" to loopback, `*.localhost`, `*.test` and the `file:` protocol. RFC1918 addresses and `*.local` must require `env.allow` or confirmation.
- Reject wildcard allow entries with a single label (for example `*.com`).

### N4

- Do not use `page.title` in templates when masks apply, or prefer a `title:` override.
- Redact email-like, UUID and numeric segments in `page.path`.

### N5

- Store `env.allow` and the mask/hide lists, plus their hash, in `steps.json` and `render.json`.
- Warn at render when masks were removed or allowed hosts were added.
- `approve` should refuse when masks shrank.

## Checked and found sound

- Wildcard matching is anchored.
- Userinfo, IDN and trailing-dot inputs fail closed.
- `--confirm-env` requires exact hosts; the bare flag confirms nothing.
- The setup context and popups are gated.
- `SECRET_VALUE` runs before every action and fails closed.
- `MASK_INVALID` rejects Playwright-style selectors, `{}`, `;` and `@`.
- Error screenshots are masked.

## Lessons

- Validating each CSS selector on its own does not prove it is safe once concatenated into a stylesheet. Use `insertRule` per selector and validate with a `replaceSync` round trip.
- Detecting a redirect is not the same as stopping it. Abort and stop at the next action boundary, and test with a redirect target that resolves.
