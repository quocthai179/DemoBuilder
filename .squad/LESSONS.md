# Lessons

## 2026-11-25 — `record --dry` still injects the video overlay; screenshots there are not clean
- Area: demo-toolkit record.mjs / overlay.mjs · Tags: playwright, dry-run, screenshot
- Lesson: In `--dry` the overlay (cursor, ripple, masks) is injected and the `screenshot` action still runs, while `wait` is a no-op; highlight/callout have a 0.3 s CSS transition, so stills taken in dry show half-faded boxes plus cursor/ripple. For clean stills pass `cursor: {show:false, clickRipple:false}` to `overlayInit`, draw static annotations, and use `page.screenshot({animations:'disabled'})`.
- Evidence: plugins/demo-builder/skills/demo-toolkit/scripts/lib/record.mjs:118,148,204-207; lib/overlay.mjs:330,334-341,378; .squad/adr/0004-guide-capture-engine.md
- Source: software-architect

## 2026-11-25 — Chromium `setContent` cannot load `file://` images
- Area: demo-toolkit (cards / PDF rendering) · Tags: playwright, pdf, offline
- Lesson: HTML loaded with `page.setContent()` runs on about:blank and silently fails to load `file://` images. Either inline them as data URIs (as cards.mjs does) or write the HTML to disk and `page.goto('file://…')` with relative `src`. System fonts used by the page are embedded (subset) by `page.pdf()`.
- Evidence: lib/cards.mjs:8,54; .squad/adr/0005-guide-pdf-rendering.md
- Source: software-architect

## 2026-11-25 — Playwright `route` does not see redirect hops; use the `request` event to detect them
- Area: demo-toolkit guide capture (env gating) · Tags: playwright, security, redirects
- Lesson: `context.route()` is invoked for the first main-frame navigation request only; a 302 to another host is followed by Chromium without calling the handler (verified: the redirected request reached DNS). Direct navigations can be blocked in `route`; a redirect hop can only be DETECTED after it happened (`context.on('request')` with `redirectedFrom()`). Detecting is not stopping: set a stop flag at once, abort every further request to that host in `route`, and check the flag before each action (after goto, top of each action, before act, in setup). Test with a redirect target that RESOLVES to a local server (`--host-resolver-rules`) and assert the server saw no write after the hop; a non-resolving target hides the bug.
- Evidence: lib/guide.mjs `gate()`; tests/guide/hardening.test.mjs ("a redirect from an approved host...")
- Source: developer

## 2026-11-25 — Stills need Playwright `mask` (opaque); popups throw in `req.frame()`; gate WebSockets with a predicate
- Area: demo-toolkit guide capture (redaction, egress gate) · Tags: playwright, privacy, security
- Lesson: CSS `blur(7px)` leaves text of ~20px+ readable in lossless PNGs and is defeated by page CSS, shadow roots and removed styles. For stills pass `page.screenshot({ mask: [page.locator('css=' + sel)], maskColor })` (works with `clip`, pierces open shadow roots) and keep the blur only as a second layer. In `route`, `req.frame()` throws for a popup's first navigation: use `req.isNavigationRequest()` only and treat "cannot tell" as a navigation. `context.routeWebSocket((url) => !approved(host), ws => ws.close())` closes unapproved sockets before any handshake reaches the server and leaves approved ones untouched.
- Evidence: lib/selectors.mjs `redactedScreenshot`; lib/guide.mjs `gate()`; tests/guide/hardening.test.mjs (R3-1/R3-2, R3-3/R3-4)
- Source: developer
