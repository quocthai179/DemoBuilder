# Security re-audit, round 4 (verification): user-guide-writer

- **Date:** 2026-11-25
- **Auditor:** `dev-squad:security-auditor`. The orchestrator saved this report.
- **Scope:** working tree vs `main` @ 0d981a0
- **Overall risk:** Medium. No High or Critical finding remains.

## Status of previous findings

| # | Status |
|---|---|
| R3-1: blur is not redaction | **Fixed** for content that paints inside the element's own box. Verified flat `#9aa0a6` in 5 variants, in both the full image and the close-up. |
| R3-2: no mask check at screenshot time | **Fixed**, except `display:contents` (see R4-1). |
| R3-3: popups and iframes | **Fixed.** 10 vectors were refused before any byte left the browser. |
| R3-4: GET egress, WebSocket, service worker | **Fixed**, except `SharedWorker` (see R4-2). |
| R3-5: public-suffix wildcards | **Partially fixed (Low).** The list is static with exact matching, so `*.s3.amazonaws.com`, `*.r2.dev`, `*.surge.sh` and similar still pass. |
| N1, N2, N3 | Fixed |
| N4, N5, #6–#9 | Deferred (Low) |

## New findings

| # | Severity | CWE | Location | Title |
|---|---|---|---|---|
| R4-1 | Medium | CWE-359, CWE-693 | `selectors.mjs:85-99`; `guide.mjs:354-366,557-563`; `overlay.mjs:44` | The opaque box covers only the matched element's own box. Content that overflows it (floats, `height:0`, absolutely positioned or transformed children, `::after`, `text-shadow`) is only blurred. A `display:contents` element shows plain text, and no warning is raised. |
| R4-2 | Low | CWE-693, CWE-863 | `guide.mjs:475-509` | `SharedWorker` requests are neither gated nor recorded. A POST reaches an unapproved host. |

## Remediation

- **R4-1**
  1. Also mask descendants, using `css=:is(sel) *`.
  2. Add `contain: paint !important` to the mask CSS rule (or `overflow: clip` plus `text-shadow: none`).
  3. In `checkMaskCss`, treat `display:contents` as not blurred, and detect text rects that fall outside the covered boxes. Fail closed or warn.
  4. Add a test for each layout.
  5. Correct the docs wording.
- **R4-2:** Use `addInitScript` in `gate()` to disable `window.SharedWorker`. Add a test and document it.

## Low / Info follow-ups

- **Iframe content is not covered by the opaque box.** `page.frames().flatMap(f => f.locator(...))` should work with Playwright `mask`.
- **A `screenshot` action in `setup:` writes an unmasked image in guide mode.** This is pre-existing.
- **Small timing window between box placement and the screenshot.** Error shots also lack `animations:'disabled'`.
- **Weak public-suffix check (R3-5).** Match by suffix instead of exact host, or vendor the PSL.
- **Accepted residuals:** the redirect hop, GET egress (warned), closed shadow DOM, canvas content, title/URL (N4), `*.test` hosts, and blur-only masking in video.

## Lessons

- An opaque mask built from `getBoundingClientRect` misses overflowing content and `display:contents` elements. Mask the descendants and clip paint. A computed `filter` value does not prove the filter is rendered.
- `context.route` does not see `SharedWorker` traffic. Disable `SharedWorker` when egress must be gated.

## Probes

All probes are in `/tmp/claude-0/-home-user-DemoBuilder/bdd65a6a-85cd-5f77-adab-0f38acc3d122/scratchpad/r5/`: `byp.mjs`, `byp2.mjs`, `e2e.mjs`, `selcmp.mjs`, `net.mjs` and `nsrv.cjs`.
