# Merged review: user-guide-writer (final)

- **Date:** 2026-11-25
- **Scope:** working tree on `claude/hopeful-johnson-4plv7k` vs `main` @ 0d981a0. This is the user-guide feature for the demo-builder plugin.
- **Tests:** `node --test tests/` passes **206/206** (about 254 s), run by the orchestrator after the last fix.

## Gate decision: READY TO PUSH

No 🔴 code-review finding and no Critical or High security finding remains.

## Review history

| Round | Code review | Security | Main fixes after the round |
|---|---|---|---|
| r1 | APPROVE WITH NITS (6 🟡) | **High**: one bad mask selector disabled every mask. Also 4 Medium and 4 Low. | Per-selector CSS rules and `MASK_INVALID`. Masked labels withheld. Secret guard on all scenes, fail-closed. Env allowlist plus `--confirm-env=<host>`. Prompt hardening. All 6 🟡. |
| r2 | APPROVE WITH NITS | **High N1**: unbalanced selectors. Medium N2 (redirect) and N3 (non-GET egress, "local" too broad). | CSSOM `insertRule` plus a round-trip validator, also run in `validate` and `record`. Stop right after a redirect. All requests gated. "Local" narrowed. |
| r3 | APPROVE WITH NITS | **High R3-1**: 7px blur is readable. Medium R3-2 (masks not verified) and R3-3 (popups and iframes). | Opaque Playwright `mask` on every guide and error still image. `ensurePrivacy`, `MASK_CSS_DEFEATED` and `MASK_NOT_APPLIED`. Popup and iframe gating. WebSocket and service-worker blocking. Public-suffix check. |
| r4 | APPROVE WITH NITS (🟡 iframe) | Medium R4-1 (overflow and `display:contents`), Low R4-2 (SharedWorker) | Descendants masked. `contain: paint`. Per-frame locators. SharedWorker disabled. |
| r5 | APPROVE WITH NITS | **No High/Critical.** Medium R5-1 (`display:contents` mixed text), Low R5-2 (inline `::after`), Low R5-3 (PSL) | Fixed by the orchestrator: R5-1 now fails closed. R5-2: pseudo-elements hidden and `text-shadow: none`. R5-3: suffix list extended and `core.windows.net` matched by suffix. Regression tests added and checked against the unfixed code. |

## Accepted residuals and follow-ups (non-blocking)

- **Video path:** still uses the 7px CSS blur, not an opaque box. This predates the change. Follow-up: make the video mask opaque.
- **Video layout:** `contain: paint` also affects masked elements in video. Overflowing dropdowns are clipped, floats are enclosed, and margins no longer collapse. This is documented.
- **Network gate limits:**
  - A redirect hop, including a 307/308 POST with its body, reaches the unapproved host once, and capture then stops.
  - GET egress to unapproved hosts is only recorded and warned about (`ENV_CONTACTED_UNAPPROVED`).
- **Masking limits:**
  - Closed shadow DOM, canvas or image pixels, and `<option>` text of an unmasked `<select>` are not covered.
  - The same data shown elsewhere, such as the page title or URL (N4), is not covered.
  - A page rule that overrides the mask CSS with higher specificity defeats it.
- **Low items deferred:**
  - N5: the trust rules are prose only, with no diff of `env.allow` or masks at the checkpoint.
  - #6: image paths outside `guide/` are not enforced.
  - #7: Markdown in labels is not escaped.
  - #8: brand/font CSS values are not validated, and render runs with JS on.
  - #9: URLs appear in setup errors, setup error screenshots are unmasked, and `goto` env vars are not scanned.
- **Public-suffix list:** static, not the full PSL.
- **Tooling:** there is no `package.json` or lockfile, so no dependency audit is possible.

## Reports

- Code review: `2026-11-25-review-user-guide-writer.md`, `-r2.md`, `-r3.md` and `-r4.md`. The r5 report was given inline: APPROVE WITH NITS, no blocking.
- Security: `2026-11-25-security-user-guide-writer.md`, `-r2.md`, `-r3.md` and `-r4.md`. The r5 report was given inline: no High/Critical. R5-1 and R5-2 are fixed as described above.
