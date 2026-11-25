# demo.yaml reference

Paths are relative to the spec file. Strings in `baseUrl`, `setup`, scene `url` and `actions` may use `${ENV_VAR}` or `${ENV_VAR:-default}`; a missing variable without a default is an error (secrets never live in the file). A `.json` spec with the same structure also works.

## Top level

| Key | Default | Meaning |
|---|---|---|
| `title` | folder name | Video title (cards, thumbnail) |
| `language` | `en-US` | Narration language (TTS defaults, words-per-minute estimates) |
| `locale` | `language` | Browser locale while recording |
| `timezone`, `colorScheme` | – / `light` | Browser emulation |
| `targetDuration` | – | Seconds; review warns when off by > 15 % |
| `baseUrl` | – | Base for relative scene/action URLs |
| `viewport` | `1600×900` | Browser size; keep 16:9 for 16:9 output |
| `headless` | `true` | `false` to watch (same as `--headed`) |
| `ignoreHTTPSErrors` | `false` | For self-signed staging certificates |
| `hideScrollbars` | `true` | Hide page scrollbars |
| `output.dir` / `name` | `output` / `demo` | Output folder / base file name |
| `output.width/height/fps/crf` | 1920/1080/30/20 | Render settings |
| `output.background` | `#0b0d12` | Letterbox colour |
| `output.formats` | `[mp4]` | Extra: `vertical`, `square`, `gif` |
| `output.gif` | `{start:0,duration:12,width:960,fps:12}` | GIF preview |
| `output.thumbnail` | `{}` | `{ title, eyebrow, subtitle, at }`; `title: false` = plain frame |
| `voice` | edge | See below; scenes may override any field |
| `timing` | see below | Global pacing |
| `cursor` | shown | `{ show, color, ring, size, clickRipple }` |
| `captions` | sidecar | `{ sidecar, burn, maxChars: 42, maxLines: 2, style }` (`style` = ASS force_style) |
| `music` | none | `{ file, volume: 0.15, duck: true }` |
| `loudness` | `-16` | Target integrated LUFS (-14 for social) |
| `brand` | indigo/dark | `{ primary, accent, background, text, font, logo }` for cards, highlights, thumbnail |
| `mask` | `[]` | Complete CSS selectors blurred on every page of the video (each is its own rule; blur only, large text can stay legible: known limitation). In guide images the same selectors are covered by an opaque grey box (redacted). `validate`/`record` reject unbalanced or non-CSS selectors (`[a="b`, `:not(.a`, `.a /*`, `text=...`) instead of silently unmasking |
| `hide` | `[]` | CSS selectors hidden on every page |
| `auth` | – | `{ storageState: file, save: file }` — reuse/save a logged-in session |
| `setup` | `[]` | Off-camera actions run in a separate context before recording; its session carries into the take |
| `paths` | – | Override work dirs: `{ audio, recordings, cards, build, review }` (e.g. reuse recordings from another language) |
| `scenes` | required | List of scenes |

### `voice`

| Key | Providers | Meaning |
|---|---|---|
| `provider` | – | `edge` · `openai` · `elevenlabs` · `google` · `espeak` · `silent` · (per scene `audio:` file) |
| `voice` | all | Voice name/id (edge `vi-VN-HoaiMyNeural`, openai `alloy`/`nova`/…, elevenlabs voice id, google `vi-VN-Neural2-A`…) |
| `rate`, `pitch`, `volume` | edge | `"+10%"`, `"-2Hz"`, `"+0%"` |
| `model` | openai, elevenlabs | e.g. `gpt-4o-mini-tts`, `eleven_multilingual_v2` |
| `instructions` | openai | Delivery style: "Warm, confident presenter, medium pace" |
| `speed` | openai, silent | 0.25–4 |
| `stability`, `similarity`, `style`, `languageCode` | elevenlabs | Voice settings |
| `speakingRate` | google | 0.25–4 |
| `wpm` | espeak | Words per minute |
| `lexicon` | all | `{ written: spoken }` replacements for audio only |

### `timing`

| Key | Default | Meaning |
|---|---|---|
| `audioDelay` | 0.4 s | Silence before narration starts in each scene |
| `tail` | 0.6 s | Hold after narration ends |
| `typeDelay` | 55 ms | Per keystroke for `type` |
| `moveMs` | 650 ms | Max cursor travel time |
| `actionGap` | 350 ms | Pause after each action |
| `highlightMs` | 1400 ms | Default highlight duration |

## Scene

| Key | Meaning |
|---|---|
| `id` | Unique, `[a-zA-Z0-9_-]` (used for files and `--scenes`) |
| `type` | `screen` (default when `url`/`actions` exist) or `card` |
| `narration` | Spoken text. `[pause]` adds a pause; `*word*` is spoken plain. |
| `audio` | Use a recorded file instead of TTS |
| `voice` | Per-scene voice override (e.g. `{ rate: "-5%" }`) |
| `chapter` | Chapter label (cards default to their title) |
| `url` | Navigate here at scene start |
| `actions` | List of actions (screen scenes) |
| `audioDelay`, `tail`, `minDuration` | Per-scene timing |
| `trimStart`, `trimEnd` | Seconds cut from the recorded segment |
| `transition` | `fade` (cards default) or `none` |
| Card fields | `eyebrow`, `title`, `titleSize`, `subtitle`, `bullets`, `cta`, `footer`, `layout: center|left`, `background` (image), `brand` override, `duration`, or raw `html` |

## Actions

Write each action as `- name: value` or `- name: { …options }`. Every action accepts `gap` (ms pause after it), `timeout` (ms), `guideId` (optional label used only by `guide.yaml` refs, no effect on the video), and element actions accept `nth` (pick the n-th match), `move: false` (no cursor travel), `moveMs`, `offsetX`/`offsetY` (0–1 inside the element).

| Action | Short form | Options |
|---|---|---|
| `goto` | url | `waitUntil` |
| `click`, `dblclick` | selector | `force` |
| `hover` | selector | `ms` |
| `type` | – | `selector`, `text`, `delay`, `clear` (default true), `enter` |
| `fill` | – | `selector`, `text` (instant) |
| `press` | key | e.g. `Enter`, `Control+K` |
| `select` | – | `selector`, `value`/`label` |
| `check`, `uncheck` | selector | |
| `upload` | – | `selector`, `files` |
| `scroll` | selector | or `{ y: 600 }`, `{ to: top|bottom }`, `ms` |
| `wait` | ms | |
| `waitFor` | selector | `state: visible|hidden|attached` |
| `waitForUrl` | url | substring or glob |
| `highlight` | selector | `label`, `ms`, `hold`, `style: glow|spot`, `padding`, `position: top|bottom`, `move` |
| `spotlight` | selector | same as highlight with dimmed surroundings |
| `callout` | selector | alias of highlight with `label`/`text` |
| `clear` | – | remove held highlights |
| `zoom` | selector | `scale` (1.6), `ms` (700), `hold` (seconds, then auto-unzoom) |
| `unzoom` | – | `ms` |
| `moveTo` | selector | or `{ x, y }` |
| `at` | seconds | wait until N s after scene start (sync with narration) |
| `caption` | text | on-screen caption bubble inside the recording (`""` hides) |
| `screenshot` | path | save a still |
| `evaluate` | script | run JS in the page (escape hatch) |
| `reload` | – | |

Selectors are Playwright selectors: CSS (`#save`, `[data-testid=total]`), text (`text=Save`), `:has-text("…")`, chained (`nav >> text=Customers`), XPath (`xpath=//button`).

## `guide.yaml`

Optional file next to `demo.yaml`, used only by `demo.mjs guide …`; `record`, `tts` and `assemble` never read it. Unknown keys are an error (typo guard).

| Key | Default | Meaning |
|---|---|---|
| `version` | `1` | Schema version |
| `locale` | `en-US` | Browser locale for guide capture only (the video keeps `language`/`locale`) |
| `title`, `goal`, `expectedResult` | – | Guide title, 1–2 sentence goal, expected outcome (missing → `TODO(guide)` in the skeleton) |
| `prerequisites` | `[]` | Extra prerequisites |
| `signIn` | `true` if the spec has `setup`/`auth` | Adds `Sign in to the app.` to the prerequisites (no screenshot, no credentials) |
| `scenes` | all screen scenes | Scenes that contribute steps (others still run to keep app state); each must exist and be a screen scene |
| `steps` | `{}` | Per-step overrides keyed by ref (below) |
| `manual` | `[]` | Extra look-only steps that only take a screenshot of a selector |
| `mask`, `hide` | `[]` | Added to the spec's `mask`/`hide` for guide images only. **Complete plain CSS selectors only**: each is inserted as its own CSSOM rule, and `guide capture`, `validate` and `record` validate all of them first (static checks for unbalanced quotes/brackets/parens, `/*`, trailing `\`, `{ } ;`, plus a round trip through Chromium's CSS parser). `MASK_INVALID` lists the bad ones; Playwright selectors such as `text=`, `:has-text()`, `>>`, `xpath=` are rejected too. The same applies to the video `mask`/`hide` in `demo.yaml`: `validate` and `record` fail with the list of bad selectors. `MASK_UNMATCHED` warns when a mask matched nothing on any captured screen. **Redaction:** guide screenshots (full, close-up, error) are taken with Playwright `mask`: an opaque grey box over each matched element and its descendants (open shadow roots and same-origin iframes included), on top of the CSS blur; the mask rule also sets `contain: paint` and `text-shadow: none` and hides `::before`/`::after` of masked elements and their descendants (shared with video: masked elements are paint-contained, so overflowing content such as an open dropdown is clipped, floats are enclosed and margins no longer collapse through them; `contain` has no effect on inline elements, which is why pseudo-elements are hidden). The CSS layer is re-attached before each shot; `MASK_CSS_DEFEATED` warns when a matched element has no blur, is `display:contents`, or has text outside its own and its descendants' boxes; `MASK_NOT_APPLIED` stops capture if the boxes cannot be drawn, or if text renders where neither an opaque box nor the blur reaches it (no box at all, or text outside every box under a `display:contents`/unblurred element). Capture disables `SharedWorker` and service workers during guide capture. Not covered: closed shadow roots, `::after`/`::before` content (hidden by the mask CSS; a page rule that overrides it with higher specificity defeats this), cross-origin iframe internals unless Playwright can reach the frame (different-port frame verified), canvas/image pixels (mask the element), `<option>` text shown by an unmasked `<select>`, the same data elsewhere (title, URL), top-layer `<dialog>`/popover elements that are not matched themselves; the video path still only blurs |
| `env.allow` | `[]` | Hosts (bare host names, e.g. `app.acme.com`, or `*.acme.com` for subdomains) that capture/refresh may use without confirmation. "Local" means loopback only: `127.0.0.0/8`, `::1`, `localhost`/`*.localhost`, `*.test`, and the `file:` protocol (matched by protocol; a host literally named `file` is not local). RFC1918 (`10/8`, `172.16/12`, `192.168/16`), link-local and `*.local` hosts are NOT local: list them here or confirm them. A wildcard needs at least two labels after `*.` (`*.acme.com` is fine, `*.com` is `CONFIG_INVALID`). A wildcard on a public suffix is `CONFIG_INVALID` too: `*.co.uk`, `*.com.vn`, `*.org.au` (any `co|com|org|net|gov|edu|ac|or|ne|go|...` + 2-letter country code), `*.github.io`, `*.vercel.app`, `*.netlify.app`, `*.herokuapp.com`, `*.azurewebsites.net`, `*.pages.dev` and a few similar hosting domains (a small static list, not the full Public Suffix List); use `*.acme.co.uk`. During capture, unapproved hosts are gated: navigations (including popups and iframes), WebSockets and non-read requests are blocked; plain GET sub-resources are allowed and reported in `ENV_CONTACTED_UNAPPROVED`; a redirect hop cannot be blocked in advance (one request, with method and body for 307/308, reaches the host before capture stops). Every other host needs `--confirm-env=<host[,host]>` from the user (exact host names only, no wildcards). Keyword guesses (`staging`, `.dev`, ...) never approve a host. Only the user edits this list |
| `capture.padding` | `48` | Close-up padding (px) |
| `capture.closeupMin` | `{ width: 360, height: 200 }` | Minimum close-up size |
| `capture.settleMs` | `1500` | Max wait for the target to stop moving |
| `capture.timeout` | `15000` | Wait for the target to be visible |
| `capture.parkMouse` | `false` | Move the mouse to a corner before shooting |
| `capture.freshSession` | `false` | Ignore `auth.storageState` so setup logs in again under the guide locale |
| `pdf.format` | `A4` | `A4` or `Letter` |
| `pdf.fonts` | `[]` | `{ family, file, weight?, style? }` local font files (path relative to the spec file; must exist) |

**Step refs:** `<sceneId>.<n>`, where `n` is the 1-based position of the action in that scene (all actions counted), or `<sceneId>.<guideId>` when the action carries the passive key `guideId` (unique within the scene):

```yaml
- click: { selector: "#save", guideId: save }     # guideId must start with a letter; video behaviour is unchanged
```

**Step override** (`steps.<ref>`, one per action): `include: true` (turn `hover`/`goto`/`reload`/`waitForUrl`/... into a step; an error on visual-only actions), `skip: true` (not both), `title`, `text`, `note`, `warning`, `label` (text on the screenshot label), `value` (fake data; only for `type`/`fill`/`select`). Required whenever a `type`/`fill` uses a `${ENV}` value in a non-password field, or a `select` uses one, in **any** screen scene (also scenes not listed in `scenes`), otherwise capture fails with `SECRET_VALUE`. `${ENV}` in `press`/`evaluate` of a screen scene is always refused (put sign-in in `setup:`). `label` also replaces the DOM label in the sentence when the DOM label is missing or the target is masked.

**Manual step** (`manual[]`): `id` (starts with a letter), exactly one of `after: <ref>` / `before: <ref>` (its scene must be in `scenes`), `selector` (required), optional `nth`, `verb`, `title`, `text`, `note`, `warning`, `label` (used in the screenshot label, the sentence and the alt text). Its step id is `<scene>.<id>`. `verb` picks the screenshot label and the sentence: `look` (default, "Look at"), `find` ("Find"), `click` ("Click"), `type` ("Type in"), `select` ("Choose in"), `check` ("Check"), `hover` ("Point to"); any other value is a config error.

Which actions become steps: `click, dblclick, type, fill, select, check, uncheck, upload, press`. Run but not a step unless `include: true`: `goto, reload, hover, moveTo, scroll, waitFor, waitForUrl, wait, evaluate` (`goto`/`reload`/`waitForUrl` are then captured after they run: no box, label pill only). Skipped entirely (`include` is a config error): `highlight, spotlight, callout, clear, zoom, unzoom, caption, at, screenshot`. Card scenes and `setup:` never produce steps.

```yaml
version: 1
title: Add a new contact
goal: Create a contact record so your sales team can follow up.
expectedResult: The new contact appears at the top of the Customers list.
scenes: [add-contact]
steps:
  add-contact.3: { value: "Jane Doe" }
  add-contact.4: { value: "jane.doe@example.com", note: "The email address is blurred in screenshots for privacy." }
  add-contact.5: { warning: "Each run creates a new contact. Use a test workspace." }
manual:
  - id: new-row
    after: add-contact.5
    selector: "#rows tr:first-child"
    label: New contact
```

## Files written

```
audio/<id>.mp3|wav, audio/manifest.json
recordings/take-<time>.webm, recordings/timeline.json, recordings/error-*.png
cards/<id>.png
build/NN-<id>.mp4, build/joined.mp4
output/<name>.mp4, <name>-vertical.mp4, <name>-square.mp4, <name>-preview.gif, <name>-thumbnail.png,
       <name>.srt, <name>.vtt, <name>.chapters.txt, <name>.timeline.json
review/NNN-<id>-start|mid|end.jpg, review/contact-sheet.jpg, review/report.md, review/inspect/*
guide/guide.md (never overwritten), guide/guide.skeleton.md, guide/steps.json, guide/images/NN-<scene>-<n|guideId>[-closeup].png,
      guide/guide.html, guide/guide-draft.pdf (removed by approve), guide/guide.pdf (after approve), guide/preview/contact-sheet.png,
      guide/render.json, guide/approval.json, guide/history/guide.md.<time> (backup when the plan changed), guide/errors/error-*.png, guide/.staging/ (temporary), guide/assets/ (yours)
```
