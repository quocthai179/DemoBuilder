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
           └─ review ───► review/*.jpg, contact-sheet.jpg, report.md
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
mask: [".email", "[data-pii]"]                   # blurred in every frame
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

## Troubleshooting

- **Selector timeout** → error screenshot in `recordings/error-*.png`; run `inspect` on the URL shown; prefer `data-testid`, ids, `button:has-text("…")`, `nav >> text=…`.
- **Blank page / about:blank** → the scene has no `url` and no `baseUrl` is set.
- **"actions run longer than the narration"** → fewer actions, smaller `typeDelay`, `fill` instead of `type`, or longer narration.
- **"at: reached late"** → earlier actions take longer than the `at` time; move the `at` later.
- **Black bars** → viewport not 16:9.
- **Narration fast** in review → cut words (preferred) or slow the voice.
- **Missing yaml parser** → `node demo.mjs setup`, or install PyYAML, or write `demo.json`.
- **Burned captions fail** → ffmpeg build without libass; use sidecar captions.
