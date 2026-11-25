# Tests for the user-guide feature (and video regression)

Zero dependencies: only `node:test` (Node >= 20; developed on Node 22).

## Run

```bash
node --test tests/                       # everything (Node 22: handled by tests/index.js)
node --test "tests/**/*.test.mjs"        # same, via glob (Node >= 21)
node --test tests/guide/unit.test.mjs    # one file (fast, ~3 s, no browser)
GUIDE_TEST_NO_BROWSER=1 node --test tests/   # force-skip every browser test (simulates a machine without Playwright)
```

Full run is about 1.5-2 minutes (E2E launches headless Chromium many times).

## Prerequisites

| Needed for | Requirement |
|---|---|
| unit tests | Node only; `python3` + PyYAML **or** the `yaml` npm package (the toolkit's own YAML loader) |
| E2E + `record --dry` regression | Playwright resolvable by the toolkit (`node demo.mjs setup`, or global `npm i -g playwright`) and an installed Chromium. If Playwright/Chromium is missing the browser tests are **skipped with a reason**, not failed |
| PDF content checks | poppler (`pdfinfo`, `pdftotext`, `pdffonts`); skipped individually when missing |

Tests copy fixtures into `os.tmpdir()` and delete the copies on exit; nothing is written into the repo or the plugin tree.
No network is used (all apps are `file://`).

## Layout

| File | What it covers |
|---|---|
| `guide/unit.test.mjs` | `parseRef`, `buildPlan` (step selection, skip/include, manual steps, card/setup exclusion, signIn, >12 steps), `planSignature`/`diffPlans`, `classifyEnv`, `loadGuideConfig` (all errors reported at once), `envRefs`/`loadYaml` from `spec.mjs`, `scanSecrets`/`secretValues`, `guide-md` templates, skeleton, `parseStepBlocks`, `scanImages`, `mdToHtml`, `printHtml`, `contactSheetHtml`, `writeSkeleton` (guide.md only if absent) |
| `guide/e2e.test.mjs` | CLI via `child_process`: plan/capture/render/refresh/approve lifecycle on the Vietnamese sample-app; plan mismatch (exit 2, guide/ unchanged); approve tamper refusal; FR-31 mid-flow failures; `ENV_UNCONFIRMED`; secrets (`SECRET_VALUE`, `SECRET_LEAK`, redaction); `--json` purity; PNG sizes; pixel checks that `mask`/`hide` apply to full and close-up images; PDF checks with poppler; `init` .gitignore |
| `guide/video-regression.test.mjs` | `validate` and `record --dry` on the sample-app are unchanged with/without `guide.yaml`; video modules do not import the guide modules |
| `guide/hardening.test.mjs` | review-finding fixes: `MASK_INVALID`/`MASK_UNMATCHED`, unbalanced mask/hide selectors (static checks, `validate`/`record --dry` rejection, per-selector CSSOM rules in `overlayInit`), masked targets (no DOM text), `SECRET_VALUE` guard (unlisted scenes, `select`, `press`/`evaluate`, fail closed), environment policy (`.dev`/`.qa`, SaaS hosts, `env.allow`, `--confirm-env=<host>`, blocked link and redirect to an unconfirmed host via a throw-away local HTTP server; redirect hops and fetch `POST`s to unapproved hosts that RESOLVE to that server via `--host-resolver-rules`, asserting the server saw no write; `env.contacted`/`contactedMethods`; loopback-only "local"; wildcard `*.com` rejected; popup/`target=_blank`/iframe/WebSocket to an unapproved host blocked before they are sent, service workers off, `ENV_CONTACTED_UNAPPROVED`), opaque redaction of guide stills (40px masked text is one flat colour in full image, close-up and error screenshot, also with `filter:none !important`, inside an open shadow root and with the style element removed; `MASK_CSS_DEFEATED`, `MASK_NOT_APPLIED`; R4-1: 40px text in a `display:contents` wrapper, floated children of a `height:0` container, an absolutely positioned and a transformed child, positioned `::after` text (clipped by `contain:paint`), bare text under `display:contents` fails closed, a same-origin iframe; R4-2: `SharedWorker` disabled, no POST reaches an unapproved host), public-suffix wildcards in `env.allow` (in `unit.test.mjs`), promote robustness, `UNCLOSED_COMMENT`, `--json` failure document, `prepareSession` |
| `guide/helpers.mjs` | temp dirs, CLI runner, snapshot hashing, minimal PNG decoder, browser availability probe |
| `fixtures/sample-app/` | copy of `examples/sample-app` + the `guide.yaml` used by the developer (manual step, value overrides, note/warning) |
| `fixtures/guide-app/` | English mini-app: password field, `${GUIDE_TEST_SECRET}`, select, checkbox, hidden file input with label, `press`, below-the-fold button, masked `.pii`, hidden `#chat`, hover (included via guide.yaml) |
| `fixtures/guide-prod/` | spec with a production-looking `baseUrl` (only used where no browser is launched) |

## Known gaps (manual / visual)

* Arrow/badge/label look, contrast, absence of cursor/ripple in screenshots (AC-3.2, AC-3.3, AC-3.4): only dimensions and mask/hide pixels are asserted; use `guide/preview/contact-sheet.png`.
* PDF page-break quality / no cropped images (AC-6.2 second half), cover branding with a logo.
* Full `build` regression of the video (timeline/contact sheet) needs TTS + ffmpeg and is not part of this suite.
* Tests marked `todo` document known defects (see the QA report); they do not fail the run.
