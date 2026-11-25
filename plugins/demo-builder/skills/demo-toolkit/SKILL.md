---
name: demo-toolkit
description: How to run the demo-builder toolkit (demo.mjs) and write demo.yaml — the spec that drives automated screen recording with Playwright (smooth cursor, click ripples, highlight/spotlight/callouts, zoom, privacy blur), AI voice-over, cards, captions, music and ffmpeg assembly into MP4 / vertical / square / GIF. Use whenever you create or edit a demo.yaml, run tts/record/assemble/review, debug a failed recording, or need the list of actions and options.
---

# Demo toolkit

A dependency-light Node CLI that turns `demo.yaml` into a narrated product demo video.

```
demo.yaml ─┬─ tts ──────► audio/<scene>.mp3 + manifest.json (durations)
           ├─ record ───► recordings/take-*.webm + timeline.json  (paced to the audio)
           │              cards/<scene>.png
           ├─ assemble ─► output/<name>.mp4 (+ -vertical, -square, -preview.gif, .srt/.vtt, .chapters.txt, -thumbnail.png)
           ├─ review ───► review/*.jpg, contact-sheet.jpg, report.md
           └─ guide ────► guide/images/*.png, steps.json, guide.md, guide-draft.pdf → guide.pdf   (optional, no voice/video)
```

## Locate the CLI

Resolve the absolute path once, then use it literally in later commands (shell variables do not persist between Bash calls):

```bash
DEMO="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/demo-toolkit/scripts/demo.mjs}"; [ -f "$DEMO" ] || DEMO="$(find ~/.claude/plugins "$PWD" -path '*demo-builder*/skills/demo-toolkit/scripts/demo.mjs' 2>/dev/null | head -1)"; echo "$DEMO"
```

## Requirements

Node ≥ 18, `ffmpeg`/`ffprobe`, Playwright + Chromium (`node demo.mjs setup` installs Playwright and `yaml` into `~/.cache/demo-builder`; a global or project install also works), and for free voices `pip install edge-tts`. `node demo.mjs doctor` checks everything.

## Commands

| Command | What it does |
|---|---|
| `doctor` / `setup` | Check / install prerequisites |
| `init <dir> [--title --lang --url]` | Scaffold `<dir>/demo.yaml` and `.gitignore` |
| `validate <spec>` | Schema check + estimated length per scene |
| `inspect <url> [--spec s] [--storage auth.json] [--out dir]` | Screenshot + table of clickable elements with suggested selectors |
| `voices [--lang vi-VN]` | List Edge TTS voices |
| `tts <spec> [--scenes a,b] [--provider p] [--force]` | Generate voice-over (cached by text+voice) |
| `record <spec> [--scenes a,b] [--dry] [--headed]` | Record screen scenes + render cards. `--dry` = fast selector/flow check, no video |
| `cards <spec>` | Render card scenes only |
| `assemble <spec> [--draft] [--formats mp4,vertical,square,gif] [--burn]` | Cut, sync, mix, export |
| `captions <spec>` | Write .srt/.vtt + chapters without rendering |
| `review <spec>` | Frames per scene, contact sheet, loudness, dead air, pacing → `review/report.md` |
| `status <spec>` | Per scene: voice ok? recording ok/STALE? |
| `guide plan <spec> [--json]` | Validate `guide.yaml`, list the guide steps, classify the environment, warn. No browser, writes nothing |
| `guide capture <spec> [--confirm-env=<host[,host]>] [--headed] [--json]` | Run the flow (en-US, no cursor) and write `guide/images/`, `steps.json`, `guide.skeleton.md` (+ `guide.md` only if missing) |
| `guide render <spec> [--json]` | `guide.md` → `guide.html` → `guide-draft.pdf`, `preview/contact-sheet.png`, checks |
| `guide refresh <spec> [--confirm-env=<host[,host]>] [--json]` | Re-capture images (same file names), keep `guide.md`, re-render. Exit 2 = plan changed, nothing touched |
| `guide approve <spec>` | After the user's explicit OK: `guide-draft.pdf` → `guide.pdf` |
| `build <spec> [--provider p]` | tts → record → assemble → review |
| `clean <spec> [--all]` | Delete unused takes and `build/` (`--all`: everything generated) |

## How sync works

1. Voice first: `tts` measures every scene's narration.
2. `record` runs one continuous browser take. For each screen scene it performs the actions, honouring `at:` sync points (seconds from scene start), then waits until `audioDelay + narration + tail` has passed. Scene start/end times go to `recordings/timeline.json`.
3. `assemble` cuts each scene from the take, freezes the last frame if narration is longer, lays the narration at `audioDelay`, and concatenates. So: **change narration → re-run `tts` and re-record that scene.** `status` flags scenes recorded before their audio existed as STALE.

Retakes: `record --scenes x,y` records only those scenes into a new take and updates their timeline entries. A scene without `url:` is reached by replaying the preceding scenes off-camera first (warm-up).

## Spec essentials

```yaml
title: "…"            language: vi-VN          targetDuration: 90
baseUrl: https://staging.app.com                # relative urls resolve against it (or ./file.html locally)
viewport: { width: 1600, height: 900 }           # keep 16:9
output: { name: demo, formats: [mp4, vertical, gif], thumbnail: { title: "…" } }
voice: { provider: edge, voice: vi-VN-HoaiMyNeural, rate: "+0%", lexicon: { SaaS: "sát" } }
music: { file: assets/bgm.mp3, volume: 0.12, duck: true }
captions: { sidecar: true, burn: false }
brand: { primary: "#4f46e5", accent: "#22d3ee", background: "#0b0d12", logo: assets/logo.png }
mask: [".email", "[data-pii]"]                   # blurred in every video frame; in guide images: opaque grey box (redacted)
hide: ["#intercom-container"]                    # display:none
auth: { storageState: session.auth.json, save: session.auth.json }
setup:                                           # off-camera, before recording
  - goto: /login
  - fill: { selector: "#email", text: "${DEMO_USER}" }
  - fill: { selector: "#password", text: "${DEMO_PASSWORD}" }
  - click: "button[type=submit]"
  - waitForUrl: /dashboard
scenes:
  - id: intro
    type: card
    title: "…"  subtitle: "…"  eyebrow: "…"  bullets: [..]  cta: "…"
    narration: "…"
  - id: create-invoice
    url: /invoices                               # optional; makes the scene standalone for retakes
    chapter: "Tạo hoá đơn"
    narration: "…"
    actions:
      - click: "text=Tạo hoá đơn"
      - type: { selector: "#customer", text: "Công ty ABC" }
      - at: 6.5                                   # wait until 6.5 s into the scene
      - spotlight: { selector: ".total", label: "Tự động tính VAT", ms: 1800 }
      - zoom: { selector: ".total", scale: 1.6, hold: 2 }
```

Full field and action reference: [references/spec-reference.md](references/spec-reference.md).

## User guide (`guide`)

Turns the same `demo.yaml` flow (it must pass `record --dry`) into an English how-to guide. The spec is not changed; options live in an optional `.demo/<slug>/guide.yaml` (reference: [references/spec-reference.md](references/spec-reference.md#guideyaml)).

1. `guide plan` — which actions become steps (`click`, `dblclick`, `type`, `fill`, `select`, `check`, `uncheck`, `upload`, `press`; video effects like `highlight`/`zoom`/`caption` are skipped), environment (`env.class`, `env.needsConfirm`), warnings. It runs no browser and writes nothing. Environment policy: a host is trusted only if it is local (loopback only: `127.0.0.0/8`, `::1`, `localhost`/`*.localhost`, `*.test`, the `file:` protocol; RFC1918, link-local and `*.local` are not local), listed in `guide.yaml` `env.allow`, or named by the user in `--confirm-env=<host[,host]>` (exact hosts only, no wildcards; `env.allow` wildcards need two labels after `*.` and must not sit on a public suffix such as `*.co.uk`, `*.com.vn`, `*.github.io`, `*.vercel.app`). Every other host (staging-looking names included: the staging/production keyword guess is only an advisory label) stops `capture`/`refresh` with `ENV_UNCONFIRMED`; a bare `--confirm-env` confirms nothing. During capture and `setup:` every request is routed through the same policy: any navigation (main frame, popup, `target=_blank`, `<iframe src>`; when the request cannot be classified it counts as a navigation), any non-read request (not GET/HEAD/OPTIONS, e.g. a fetch/XHR `POST`) and any WebSocket to an unapproved host is blocked before it is sent and stops the run with `ENV_UNCONFIRMED` naming the host and method. Service workers are disabled in the capture context. Plain GET sub-resources (CDN, analytics) are allowed but recorded, and listed in the `ENV_CONTACTED_UNAPPROVED` warning (host and methods). **Residual risk:** a redirect cannot be blocked in advance (Playwright does not route redirect hops). The redirected request itself reaches the unapproved host once, with its method and body kept for a 307/308 redirect of a POST; it is detected right after, the host is flagged, every further request to it is aborted, and the run stops before the next action. `steps.json` `env` records `confirmed`, `contacted` (hosts) and `contactedMethods` (per host, request counts by method; `file:` stands for local pages). Only the user may decide to confirm or to add hosts to `env.allow`.
2. `guide capture` — before each step: a full screenshot with frame, number badge, arrow and label, plus a close-up; `steps.json` (contract v1) and `guide.skeleton.md`. `guide.md` is created once and then belongs to the writer and the user: the toolkit never overwrites it (if the plan changed, it is backed up to `guide/history/` and `MERGE_NEEDED` is raised). A failed capture (including a failed `setup:`/login) leaves previous files intact and writes `guide/errors/error-*.png`. Goto/reload/waitForUrl steps (only with `include: true`) are captured after they run, without a box.
3. Write the prose into `guide/guide.md` (agent `guide-writer`), keeping the `<!-- guide:step -->` markers and image lines.
4. `guide render` — `guide-draft.pdf` (A4, tagged, offline) and `preview/contact-sheet.png`; error findings (`MISSING_IMAGE`, `EMPTY_ALT`, `REMOTE_IMAGE`, `SECRET_LEAK`) make it exit 1 and write nothing; warnings such as `TODO_PLACEHOLDER` or `STEP_MARKERS_MISMATCH` do not. It also writes `render.json`.
5. `guide approve` — only after the user's explicit OK; renames the draft to `guide.pdf` (so `guide-draft.pdf` disappears) and writes `approval.json`. Refuses (`STALE_RENDER`) if `guide.md`, images or the plan changed since the render, or while `TODO(guide)` or render errors remain.

Exit codes: 0 ok, 1 error (including `render` with error findings), 2 `refresh` found a different plan (steps added/removed/moved/changed action). With `--json`, stdout is only the JSON result (logs go to stderr) and a failure prints `{ok:false, code, error}`. Typed values come from `guide.yaml` `value:` (fake data); password and `${ENV}` values are never written out, and capture stops with `SECRET_VALUE` if a `${ENV}` is typed into a non-password field (in any screen scene, listed in `scenes` or not), is used by `select`, or is used by `press`/`evaluate` outside `setup:`, unless a `value:` override replaces it; if the target cannot be inspected the guard fails closed. `mask`/`hide` must be complete plain CSS selectors: capture stops with `MASK_INVALID` on anything else (Playwright-only `text=`, `:has-text()`, `>>`, `xpath=`, or unbalanced `"`, `(`, `[`, `/*`, trailing `\`); `validate` and `record` reject bad `mask`/`hide` selectors of the video spec the same way, and warns `MASK_UNMATCHED` when a mask never matched. **Guide images are redacted, not blurred:** every screenshot (full, close-up and error screenshots) is taken with Playwright's `mask`, which draws an opaque grey box over every element a `mask` selector matches and over all its descendants (open shadow roots and same-origin iframes included), on top of the CSS blur (the mask rule also sets `contain: paint`, so overflowing content such as floats, dropdowns and `::after` is clipped to the element; video gets the same rule); blur alone leaves large text readable. The page is checked before each shot: the CSS layer is re-attached if the page removed it, and `MASK_CSS_DEFEATED` warns when a matched element still has no blur, is `display:contents`, or has text outside its own and its descendants' boxes (check the images); if Playwright cannot apply the boxes, or an element renders text but has no box at all (bare text under `display:contents`), capture stops with `MASK_NOT_APPLIED` and writes nothing. Capture also disables `SharedWorker` (its requests are invisible to the host gate; dedicated workers are routed normally) and service workers. Limits: closed shadow roots (and overflow of content inside open shadow roots of a masked element), `::after`/`::before` text of a descendant is only hidden by the CSS layer (`contain: paint`), cross-origin iframe internals depend on the frame being reachable by Playwright (a different-port frame was verified, cross-site out-of-process frames are not), `<canvas>`/`<img>` pixels that merely contain data (mask the element, not its text), `<option>` text shown by a `<select>` (mask the `<select>`), the same data shown elsewhere (page title, URL, other elements), and top-layer elements (`<dialog>`, popover) that are not matched themselves are not covered: add a selector for them. **Known limitation (video):** the video path still only blurs (`blur(7px)`), so large text can stay legible in recordings; making it opaque is a follow-up. The label of a masked element (or of one whose `<label>`/`aria-labelledby` node is masked) is never read from the DOM: use `label:` in `guide.yaml`. Warning/error codes are listed in the `guide-writer` agent. Capture re-runs the flow, so flows that save data create data again each run.

## Troubleshooting

- **Selector timeout** → error screenshot in `recordings/error-*.png`; run `inspect` on the URL shown; prefer `data-testid`, ids, `button:has-text("…")`, `nav >> text=…`.
- **Blank page / about:blank** → the scene has no `url` and no `baseUrl` is set.
- **"actions run longer than the narration"** → fewer actions, smaller `typeDelay`, `fill` instead of `type`, or longer narration.
- **"at: reached late"** → earlier actions take longer than the `at` time; move the `at` later.
- **Black bars** → viewport not 16:9.
- **Narration fast** in review → cut words (preferred) or slow the voice.
- **Missing yaml parser** → `node demo.mjs setup`, or install PyYAML, or write `demo.json`.
- **Burned captions fail** → ffmpeg build without libass; use sidecar captions.
