# Security re-audit, round 3: user-guide-writer

- **Date:** 2026-11-25
- **Auditor:** `dev-squad:security-auditor` (saved by the orchestrator)
- **Scope:** working tree on `claude/hopeful-johnson-4plv7k` vs `main` @ 0d981a0
- **Overall risk: High.** One High remains: R3-1, newly reported in this round. There are no Critical findings.

## Status of earlier findings

| # | Status | Severity now |
|---|---|---|
| N1: unbalanced selectors | **Fixed.** `insertRule` is now called once per selector, a static check plus a `replaceSync` round-trip runs in `validate`, `record` and `capture`, and every bypass attempted failed. | — |
| N2: run continues after a redirect | **Fixed** in scenes and in `setup:`. Only the single redirect hop (a GET) still arrives. | — |
| N3: egress gating, "local" too broad | **Mostly fixed.** Popups and iframes are not covered (R3-3), and GET requests are silent (R3-4). WebSockets are not gated, which is documented. | Medium / Low |
| N4, N5, #6–#9 | Deferred | Low |

## New findings

| # | Severity | CWE | Location | Title |
|---|---|---|---|---|
| R3-1 | **High** | CWE-359, CWE-200 | `overlay.mjs:47`; `guide.mjs:539,544,389`; `record.mjs:166` | Text of about 20px or larger stays readable through the `blur(7px)` mask in lossless guide PNGs (verified at 20–72px) |
| R3-2 | Medium | CWE-693, CWE-754 | `overlay.mjs:36-58`; `guide.mjs:528-539` | Nothing checks that masks are actually applied when a screenshot is taken. Each of these defeats the mask silently: app CSS with higher specificity or `!important` (including inline styles and `@layer`), removal of `<style>`, `document.open`, open shadow DOM, and top-layer `dialog`/`popover` elements. |
| R3-3 | Medium | CWE-693, CWE-863 | `guide.mjs:458,473-476` | A popup's first navigation (`window.open`, `target=_blank`) throws in `req.frame()` and ends up treated as a GET sub-resource. Iframes to unapproved hosts load, and capture still succeeds. |
| R3-4 | Low | CWE-778 | `guide.mjs:450,462,654` | GET requests to unapproved hosts (img, EventSource, prefetch, `@import`, GET calls with side effects) are only recorded, with no warning. WebSocket and service-worker traffic is not gated. |
| R3-5 | Low | CWE-183 | `guide.mjs:142-146,184,200-203` | `env.allow` accepts wildcards on a public suffix (`*.co.uk`, `*.github.io`). `*.test` is trusted whatever DNS returns for it. |

## Remediation

- **R3-1:**
  - Guide and error screenshots: use Playwright `page.screenshot({ mask: [...locators], maskColor })`, which draws opaque boxes. Keep the CSS blur as a second layer.
  - Fix the "blurred" wording in the docs.
  - Add a test that masked 40px text produces a uniform region.
  - The video path's blur predates this work. Make it opaque or scale the blur to the font size (follow-up).
- **R3-2:** before each shot, re-attach `#__demo-style` if it is missing, then assert that every matched mask element has a computed filter. Otherwise fail closed with `MASK_NOT_APPLIED`. Also document the shadow-DOM and top-layer limits.
- **R3-3:**
  - Treat a navigation request whose `frame()` throws as a top-level navigation.
  - Check `pg.url()` when a `page` event fires.
  - Gate sub-frame navigations to unapproved hosts.
  - Add tests for `window.open`, `target=_blank` and an iframe, each with a resolving host.
- **R3-4:**
  - Add an `ENV_CONTACTED_UNAPPROVED` warning.
  - Gate WebSockets with `context.routeWebSocket`.
  - Set `serviceWorkers: 'block'`.
- **R3-5:** reject wildcards whose base is a public suffix.

## Lessons

- Blur is not redaction. Published stills need opaque masks.
- Playwright `request.frame()` throws for a popup's first navigation. Treat it as a top-level navigation.

Probes: `/tmp/claude-0/-home-user-DemoBuilder/bdd65a6a-85cd-5f77-adab-0f38acc3d122/scratchpad/r3/`
