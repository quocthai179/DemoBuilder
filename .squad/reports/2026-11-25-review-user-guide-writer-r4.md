# Code review: user-guide-writer, round 4

- Date: 2026-11-25
- Reviewer: `dev-squad:code-reviewer` (report saved by the orchestrator)
- Scope: working tree vs `main` @ 0d981a0
- **Verdict: APPROVE WITH NITS**
- Suite: `node --test tests` passed 195/195 in 237.7 s

## Round-3 should-fix

The redirect wording is **FIXED**. `guide.mjs:466`, `SKILL.md:106`, `spec-reference.md:131`, `guide-writer.md:75` and `README.md:165` now agree with each other.

## 🔴 Blocking

None.

## 🟡 Should fix

1. **The opaque mask does not cover elements inside iframes.** Locations: `lib/selectors.mjs:85-99` and `lib/guide.mjs:353-366, 570`.
   - `page.locator('css=…')` resolves only in the main frame. Elements inside an iframe are covered only by the CSS blur from the init script.
   - `checkMaskCss` and the `maskHits` counts also look only at the main document. The result is a false `MASK_UNMATCHED`, and `MASK_CSS_DEFEATED` cannot detect a defeated blur inside an iframe.
   - The documentation's claim that "the opaque box covers them in every image" is wrong for iframes.
   - Fix, in order of preference:
     - Draw an opaque in-page overlay per frame.
     - Or document the limitation and adjust the `MASK_UNMATCHED` message.
     - Or emit a `MASK_IFRAME_PRESENT` warning.

## 🟢 Nits

1. Per-shot cost: `ensurePrivacy`, `checkMaskCss` and repeated `locator.count()` calls run on every shot. This is acceptable as is; optionally reuse the counts for the close-up.
2. The `css=` prefix is correct for comma lists and pseudo-classes. Top-level `>>` and `text=` are already rejected by `MASK_INVALID`. No action needed.
3. `overlay.mjs:53,86`: `importantRules(sheet) >= privacyKept` assumes the only `!important` rules in the sheet are the privacy rules. Add a comment, or count only the privacy selectors.
4. The WebSocket policy is documented. Optionally add "typical cause: analytics/chat widget socket" to `guide-writer.md`.
5. `MASK_NOT_APPLIED` during a navigation race fails closed. Optionally retry once.

## Checks

- **Video path without masks:** unchanged. Two small, reasonable behaviour changes:
  - `assertMaskSelectors` now fails fast before recording.
  - Coded `DemoError`s are rethrown.
- **gate():** consistent. Tests cover popup, `target=_blank`, iframe, WebSocket, service worker and redirect.
- **`mask` + `clip`:** supported.
- **`checkMaskCss`:** no false positives. A `null` result is treated as defeated, which is conservative.
- **`isPublicSuffix`:** fine. The list is documented as not the full Public Suffix List.
- **Tests:** ports are dynamic and the suite is stable at about 4 minutes.
- **Docs:** consistent with the code, apart from the iframe limitation.
