# Code review r3: demo-builder user guide (working tree vs main)
Verdict: APPROVE WITH NITS

Suite: `node --test tests/` 179/179 pass (194 s). Extra probe of lib/selectors.mjs against real Chromium (21 selectors).

## Blocking
None.

## Should fix
1. `lib/guide.mjs:445` (envStop text) and the comment at `:451` say a redirect "reaches it with one GET". Redirect hops are not routed, so a 307/308 redirect of a POST sent to an approved host reaches the unapproved host with its method and body. The code does record `redirect POST` (`:468`), so the data model is right and only the claim is wrong. Scenario: approved app form POST -> 307 -> third-party host receives the body. Fix: say "one request (method and body preserved for 307/308)" in the message, the docs and the comment. Add this to the residual risk the security-auditor already tracks. WebSocket upgrades are not gated either, because only `https?` routes are registered. Document that too.

## Nits
1. `lib/selectors.mjs:12` rejects valid selectors that contain `;`, `{` or `}`. Examples: `[href*="a;b"]`, `[data-x="{"]`, `.a\;b`. Probed: all rejected, all valid CSS. The failure is loud (MASK_INVALID), so this is safe, but the message "not valid CSS" is misleading. Fix: skip quoted and escaped characters in the `{};` test, or word the message "contains {, } or ; (not supported)".
2. `lib/guide.mjs:144-145` accepts `*.co.uk`, because the wildcard has 2 labels after `*.`. That is a public suffix. Fix: reject known public suffixes, or require 3 labels for ccTLD second-level domains. Low risk, since the user writes guide.yaml.
3. `lib/overlay.mjs` `privacyRules`: if the page CSP blocks the inline `<style>`, `style.sheet` is null and masks silently do nothing. The old text stylesheet had the same problem, so this is not a regression. A one-line `log` or `console.warn` would help.
4. `demo.mjs` validate launches Chromium whenever mask/hide is set (about 1 s). It degrades correctly: `requireModule` and launch failures are caught, and it prints a dim notice and runs only the static checks. Acceptable.

## Verified (the r3 questions)
- (a) `record`: `assertMaskSelectors` reuses the same `browser` with `newPage()`, so there is no extra browser. It runs before `renderCards` and also in `--dry`. Accepted in the probe: `:has(> b)`, `:is()`, `:not(a,b)`, attribute selectors with escaped quotes, `+ ~ >` combinators, `::before`, `#\31 23`, `*`, `:root`, forgiving `:is(a,:foo)`, and non-ASCII. Rejected correctly: `svg|rect` (unknown namespace), leading `> a`, and Playwright-only syntax. I found no valid selector that a real user would write being wrongly rejected, apart from nit 1.
- (a) `validate`: static checks run first. The browser round trip is skipped when a static problem was already found. If Chromium is missing it degrades gracefully. `build` awaits the new async `validate`.
- (a) `overlayInit`: each rule goes in with `insertRule` inside its own try/catch, and rules whose property did not parse are deleted. A bad selector can no longer swallow the rules after it.
- (b) `halt()` is checked after `goto`, in `act`, in `shoot` and in `prepareSession`. For `runActions` the video recorder is unchanged: `DemoError` has no `code` outside guide, so the rethrow branch never fires for `record`, and `halt` is null. The error-screenshot dir is the same default. In capture the ENV_UNCONFIRMED stop is preserved (`:608`, `:626`) and staging is removed.
- (c) Routing: the non-GET, navigation and flagged-host cases are aborted. Unapproved GET subresources are counted in `contacted` and `contactedMethods`. "Local" is narrowed to loopback, `localhost`, `*.localhost`, `*.test` and `file:`, and the tests cover `10.x`, `192.168.x`, `*.local` and `::ffff:7f00:1`. `*.com` is rejected. The `file:` sentinel is used consistently in `classifyEnv`, `isLocalHost` and the request counter. Nothing in the code reads `env.hosts` or `env.contacted` back from steps.json: `approve`, `refresh` and `render` compare only `plan.signature`, which hashes the steps and not the env. So steps.json files from older runs, which used `file`, stay compatible. At worst `contacted` is a different shape in them.
- (d) tests/index.js now includes hardening.test.mjs, and all 179 tests pass.
- (e) Docs: no bare `--confirm-env` remains in the plugin tree. Every mention is `=<host>` or the literal-text rule. The remaining bare occurrence is the CLI boolean declaration, so a bare flag confirms nothing.

## r2 items
- r2 should-fix 1 (redirect to an unapproved host keeps going): FIXED, with a residual documented in Should fix 1 above.
- r2 should-fix 2 (bare flag in guide-writer.md): FIXED (`agents/guide-writer.md:19` now requires the literal `confirm-env: <host>` from the user).
- Security N1-N3: I did not re-audit these. The routing and halt changes address the capture-time gate. Recommend a quick security-auditor pass on the 307/308 and WebSocket residuals.

## What is good
The selector validation is layered: a static pass first, then a real-parser round trip, and the same helper is shared by `validate`, `record` and `capture`. Per-rule `insertRule` removes the "one bad selector unblurs everything" failure. `prepareSession` is a clean extraction that keeps video behaviour identical. The suite now actually runs the hardening tests.

## Questions
None.

Lessons: none new.

### Handoff
- Status: done
- Artifacts: report inline; /home/user/DemoBuilder/.squad/reports/2026-11-25-review-user-guide-writer-r3.md
- Next: developer — fix the redirect wording (Should fix 1) and optionally the nits; security-auditor — optional re-check of 307/308 and WebSocket residuals. Then user — run /dev-squad:review before confirming the push/MR.
- User actions: none
- Risks / open questions: redirect hops (including 307/308 POST) and WebSockets to an unapproved host cannot be blocked pre-hop by Playwright routing; they are detected or documented only.
